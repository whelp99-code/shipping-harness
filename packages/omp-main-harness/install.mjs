import os from 'node:os';
import path from 'node:path';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createOmpBackup, restoreOmpBackup } from './backup.mjs';
import { applyOmpConfiguration } from './config.mjs';
import { SHIPPING_TOOL_NAMES, TESTED_OMP_HOSTS } from './constants.mjs';
import { doctorOmpMainHarness } from './doctor.mjs';
import { defaultNpmCommand, invariant, parseOmpVersion, resolveOnPath, runCommand, writeJsonAtomic } from './io.mjs';
import {
  inspectPackageArchive,
  installShippingPackage,
  installedShippingVersion,
  packShippingSource,
  shippingPrefixPaths,
  verifyTaggedSource,
} from './package.mjs';
import { ompMainPaths, packageRoot } from './paths.mjs';

/** @param {Record<string, any>} input */
async function resolvedInput(input = {}) {
  const paths = ompMainPaths(input);
  const shippingPrefix = path.resolve(input.shippingPrefix ?? path.join(paths.home, '.local'));
  const prefix = shippingPrefixPaths(shippingPrefix);
  const omp = resolveOnPath(input.ompCommand ?? 'omp');
  const npmCommand = input.npmCommand ?? defaultNpmCommand();
  const manifest = JSON.parse(await readFile(path.join(packageRoot(), 'package.json'), 'utf8'));
  return { paths, prefix, omp, npmCommand, manifest };
}

/** @param {string} omp */
function inspectOmpHost(omp) {
  const versionOutput = runCommand(omp, ['--version'], { timeoutMs: 60000 }).stdout.trim();
  const version = parseOmpVersion(versionOutput);
  const supported = TESTED_OMP_HOSTS.find((entry) => entry.version === version) ?? null;
  invariant(supported, 'ERR_OMP_UNSUPPORTED', `OMP ${version} has not passed the Shipping main-harness compatibility gate`, {
    supported: TESTED_OMP_HOSTS.map((entry) => entry.version),
  });
  const smoke = runCommand(omp, ['--smoke-test'], { timeoutMs: 120000 }).stdout.trim();
  invariant(/smoke-test:\s*ok/iu.test(smoke), 'ERR_OMP_SMOKE', `OMP worker smoke failed: ${smoke}`);
  return { version, versionOutput, smoke, supported };
}

/**
 * @param {{home?: string, agentDir?: string, shippingPrefix?: string, ompCommand?: string, npmCommand?: string, packagePath?: string|null}} [input]
 */
export async function planOmpMainHarness(input = {}) {
  const resolved = await resolvedInput(input);
  const omp = inspectOmpHost(resolved.omp);
  const packageReceipt = input.packagePath ? await inspectPackageArchive(input.packagePath) : null;
  return {
    schema: 'shipping-harness/omp-main-plan-v1',
    dryRun: true,
    currentShippingVersion: installedShippingVersion(resolved.prefix.root),
    targetShippingVersion: packageReceipt?.version ?? resolved.manifest.version,
    packagePath: packageReceipt?.path ?? null,
    packageSha256: packageReceipt?.sha256 ?? null,
    omp: { command: resolved.omp, version: omp.version, smoke: 'PASS', protocol: omp.supported.protocol },
    shippingPrefix: resolved.prefix.root,
    agentDir: resolved.paths.agentDir,
    changes: [
      'Back up the existing Shipping package and five managed OMP files.',
      'Install the local Shipping package without registry access.',
      'Merge the Shipping STDIO MCP entry, nine-tool approval policy, AGENTS block, and Skill.',
      'Run OMP host smoke, exact MCP protocol/tool inventory, and doctor checks.',
      'Write a local install receipt and rollback command.',
    ],
    publicPublish: false,
  };
}

/**
 * @param {{home?: string, agentDir?: string, shippingPrefix?: string, ompCommand?: string, npmCommand?: string, packagePath?: string|null, dryRun?: boolean, sourceTag?: string|null}} [input]
 */
export async function installOmpMainHarness(input = {}) {
  const plan = await planOmpMainHarness(input);
  if (input.dryRun !== false) return plan;
  const resolved = await resolvedInput(input);
  const ompHost = inspectOmpHost(resolved.omp);
  const packageReceipt = input.packagePath ? await inspectPackageArchive(input.packagePath) : null;
  const targetVersion = packageReceipt?.version ?? resolved.manifest.version;
  const currentVersion = installedShippingVersion(resolved.prefix.root);
  invariant(packageReceipt || currentVersion === targetVersion, 'ERR_OMP_PACKAGE_REQUIRED', `Shipping ${targetVersion} is not installed; provide --package or use bootstrap`);
  if (packageReceipt) invariant(packageReceipt.version === resolved.manifest.version, 'ERR_OMP_PACKAGE_VERSION', `Bootstrap source is ${resolved.manifest.version}, package is ${packageReceipt.version}`);

  const backup = await createOmpBackup(resolved.paths, {
    shippingPrefix: resolved.prefix.root,
    npmCommand: resolved.npmCommand,
    ompVersion: ompHost.version,
  });

  let rollbackResult;
  try {
    let installed = {
      version: currentVersion,
      packageSha256: packageReceipt?.sha256 ?? null,
      packagePath: packageReceipt?.path ?? null,
      commands: { cli: resolved.prefix.cli, mcp: resolved.prefix.mcp, omp: resolved.prefix.omp },
    };
    if (packageReceipt) {
      installed = await installShippingPackage({
        prefix: resolved.prefix.root,
        archive: packageReceipt.path,
        npmCommand: resolved.npmCommand,
        expectedVersion: targetVersion,
      });
      const packageStore = path.join(resolved.prefix.root, 'share', 'shipping-harness', 'packages');
      await mkdir(packageStore, { recursive: true, mode: 0o700 });
      const storedPackage = path.join(packageStore, path.basename(packageReceipt.path));
      await copyFile(packageReceipt.path, storedPackage);
      installed.storedPackage = storedPackage;
    }

    const installedCommands = {
      omp: resolved.omp,
      shippingCli: resolved.prefix.cli,
      shippingMcp: resolved.prefix.mcp,
    };
    const integration = await applyOmpConfiguration(resolved.paths, installedCommands, { dryRun: false });
    const preReceiptDoctor = await doctorOmpMainHarness({
      home: resolved.paths.home,
      agentDir: resolved.paths.agentDir,
      shippingPrefix: resolved.prefix.root,
      ompCommand: resolved.omp,
      expectedVersion: targetVersion,
      requireReceipt: false,
    });
    invariant(preReceiptDoctor.healthy, 'ERR_OMP_DOCTOR', 'OMP main-harness doctor failed before receipt creation', preReceiptDoctor.checks);

    const receipt = {
      schema: 'shipping-harness/omp-main-install-v2',
      installedAt: new Date().toISOString(),
      shippingHarness: {
        version: targetVersion,
        sourceTag: input.sourceTag ?? null,
        packageSha256: installed.packageSha256,
        packageStore: installed.storedPackage ?? null,
        prefix: resolved.prefix.root,
        command: resolved.prefix.cli,
        mcpCommand: resolved.prefix.mcp,
      },
      omp: {
        version: ompHost.version,
        command: resolved.omp,
        protocol: ompHost.supported.protocol,
        surface: ompHost.supported.surface,
        smokeTest: 'PASS',
      },
      integration: {
        scope: 'user',
        server: 'shipping-harness',
        tools: SHIPPING_TOOL_NAMES.length,
        toolNames: SHIPPING_TOOL_NAMES,
        refineTool: true,
        approvalMode: integration.approvalMode,
        approvalPolicyHash: integration.approvalHash,
        mcpConfig: resolved.paths.mcpConfig,
        agentsFile: resolved.paths.agents,
        skill: resolved.paths.skill,
        projectRootMode: 'inherit-current-project',
        managerSmoke: 'PASS',
        protocolSmoke: preReceiptDoctor.details.protocol,
        mainHarness: true,
      },
      backup: {
        id: backup.id,
        path: backup.directory,
        previousShippingVersion: backup.manifest.previousShippingVersion,
        previousPackageSha256: backup.manifest.previousPackage?.sha256 ?? null,
      },
      rollback: {
        command: `${resolved.prefix.omp} rollback --backup-id ${backup.id} --apply`,
      },
      publicPublish: false,
    };
    await writeJsonAtomic(resolved.paths.receipt, receipt, 0o600);
    await writeJsonAtomic(path.join(backup.directory, 'install.json'), receipt, 0o600);

    const doctor = await doctorOmpMainHarness({
      home: resolved.paths.home,
      agentDir: resolved.paths.agentDir,
      shippingPrefix: resolved.prefix.root,
      ompCommand: resolved.omp,
      expectedVersion: targetVersion,
      requireReceipt: true,
    });
    invariant(doctor.healthy, 'ERR_OMP_DOCTOR', 'OMP main-harness doctor failed after receipt creation', doctor.checks);
    return {
      schema: 'shipping-harness/omp-main-install-result-v1',
      dryRun: false,
      installed: true,
      shippingVersion: targetVersion,
      ompVersion: ompHost.version,
      tools: SHIPPING_TOOL_NAMES.length,
      approvalMode: 'always-ask',
      mainHarness: true,
      backup: { id: backup.id, path: backup.directory },
      rollbackCommand: receipt.rollback.command,
      receipt: resolved.paths.receipt,
      doctor,
    };
  } catch (error) {
    try {
      rollbackResult = await restoreOmpBackup(resolved.paths, {
        backupId: backup.id,
        shippingPrefix: resolved.prefix.root,
        npmCommand: resolved.npmCommand,
        dryRun: false,
      });
    } catch (rollbackError) {
      const wrapped = /** @type {Error & {code?: string, rollback?: unknown}} */ (new Error(`OMP main-harness install failed and automatic rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      wrapped.code = 'ERR_OMP_INSTALL_ROLLBACK_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
    const wrapped = /** @type {Error & {code?: string, rollback?: unknown}} */ (new Error(`OMP main-harness install failed; previous package and configuration were restored: ${error instanceof Error ? error.message : String(error)}`));
    wrapped.code = 'ERR_OMP_INSTALL_ROLLED_BACK';
    wrapped.cause = error;
    wrapped.rollback = rollbackResult;
    throw wrapped;
  }
}

/**
 * Package the exact checked-out release and install it locally.
 * @param {{home?: string, agentDir?: string, shippingPrefix?: string, ompCommand?: string, npmCommand?: string, dryRun?: boolean, tag?: string, requireTag?: boolean}} [input]
 */
export async function bootstrapOmpMainHarness(input = {}) {
  const resolved = await resolvedInput(input);
  const source = input.requireTag === false
    ? { tag: input.tag ?? null, head: null, version: resolved.manifest.version }
    : verifyTaggedSource({ sourceRoot: packageRoot(), tag: input.tag });
  if (input.dryRun !== false) {
    return {
      ...(await planOmpMainHarness(input)),
      bootstrap: true,
      source,
    };
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shipping-omp-bootstrap-'));
  try {
    const packDir = path.join(temporary, 'pack');
    await mkdir(packDir, { recursive: true, mode: 0o700 });
    const packed = await packShippingSource({
      sourceRoot: packageRoot(),
      destination: packDir,
      npmCommand: resolved.npmCommand,
    });
    invariant(packed.version === source.version, 'ERR_OMP_PACKAGE_VERSION', 'Packed Shipping version differs from tagged source');
    // Await inside the try block so finally cannot delete the package while
    // install/backup/doctor/receipt operations still depend on it.
    return await installOmpMainHarness({
      ...input,
      packagePath: packed.path,
      sourceTag: source.tag,
      dryRun: false,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * @param {{home?: string, agentDir?: string, shippingPrefix?: string, ompCommand?: string, npmCommand?: string, backupId: string, dryRun?: boolean}} input
 */
export async function rollbackOmpMainHarness(input) {
  const resolved = await resolvedInput(input);
  return restoreOmpBackup(resolved.paths, {
    backupId: input.backupId,
    shippingPrefix: resolved.prefix.root,
    npmCommand: resolved.npmCommand,
    dryRun: input.dryRun,
  });
}
