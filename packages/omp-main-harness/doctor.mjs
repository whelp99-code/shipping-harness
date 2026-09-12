import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SHIPPING_TOOL_NAMES, TESTED_OMP_HOSTS } from './constants.mjs';
import { inspectOmpConfiguration } from './config.mjs';
import { createProtocolFixture } from './fixture.mjs';
import { exists, parseOmpVersion, readJson, resolveOnPath, runCommand } from './io.mjs';
import { runOmpMcpSmoke } from './mcp-smoke.mjs';
import { installedShippingVersion, shippingPrefixPaths } from './package.mjs';
import { ompMainPaths, packageRoot } from './paths.mjs';

/**
 * @param {{home?: string, agentDir?: string, shippingPrefix?: string, ompCommand?: string, expectedVersion?: string, requireReceipt?: boolean}} [input]
 */
export async function doctorOmpMainHarness(input = {}) {
  const paths = ompMainPaths(input);
  const prefix = shippingPrefixPaths(input.shippingPrefix ?? path.join(paths.home, '.local'));
  const omp = resolveOnPath(input.ompCommand ?? 'omp');
  const packageManifest = JSON.parse(await readFile(path.join(packageRoot(), 'package.json'), 'utf8'));
  const expectedVersion = input.expectedVersion ?? packageManifest.version;
  /** @type {Record<string, boolean>} */
  const checks = {};
  /** @type {Record<string, unknown>} */
  const details = {};

  const shippingVersion = installedShippingVersion(prefix.root);
  checks.shippingVersion = shippingVersion === expectedVersion;
  details.shippingVersion = { expected: expectedVersion, observed: shippingVersion };
  checks.shippingMcpExecutable = runExecutableCheck(prefix.mcp);
  checks.shippingOmpExecutable = runExecutableCheck(prefix.omp);

  let ompVersion = null;
  let ompSmoke = null;
  try {
    ompVersion = parseOmpVersion(runCommand(omp, ['--version'], { timeoutMs: 60000 }).stdout);
    ompSmoke = runCommand(omp, ['--smoke-test'], { timeoutMs: 120000 }).stdout.trim();
    checks.ompVersion = TESTED_OMP_HOSTS.some((entry) => entry.version === ompVersion);
    checks.ompSmoke = /smoke-test:\s*ok/iu.test(ompSmoke);
  } catch (error) {
    checks.ompVersion = false;
    checks.ompSmoke = false;
    details.ompError = error instanceof Error ? error.message : String(error);
  }
  details.omp = { command: omp, version: ompVersion, smoke: ompSmoke };

  const configuration = await inspectOmpConfiguration(paths, { omp, shippingMcp: prefix.mcp });
  checks.mcpConfiguration = configuration.checks.mcpServer;
  checks.approvalMode = configuration.checks.approvalMode;
  checks.approvalPolicy = configuration.checks.approval;
  checks.agentRules = configuration.checks.agents;
  checks.skill = configuration.checks.skill;
  details.configuration = configuration;

  let protocolSmoke = null;
  const fixture = await createProtocolFixture();
  try {
    protocolSmoke = await runOmpMcpSmoke({
      mcpCommand: prefix.mcp,
      projectRoot: fixture.root,
      ompVersion: ompVersion ?? 'unknown',
    });
    checks.protocol = protocolSmoke.connected === true
      && protocolSmoke.tools === SHIPPING_TOOL_NAMES.length
      && protocolSmoke.status === 'UNINITIALIZED';
  } catch (error) {
    checks.protocol = false;
    details.protocolError = error instanceof Error ? error.message : String(error);
  } finally {
    await fixture.cleanup();
  }
  details.protocol = protocolSmoke;

  const requireReceipt = input.requireReceipt !== false;
  let receipt = null;
  if (await exists(paths.receipt)) {
    try {
      receipt = await readJson(paths.receipt);
    } catch (error) {
      details.receiptError = error instanceof Error ? error.message : String(error);
    }
  }
  checks.receipt = !requireReceipt || Boolean(
    receipt
      && receipt.shippingHarness?.version === expectedVersion
      && receipt.omp?.version === ompVersion
      && receipt.integration?.tools === SHIPPING_TOOL_NAMES.length
      && receipt.integration?.mainHarness === true
      && receipt.integration?.managerSmoke === 'PASS',
  );
  details.receipt = receipt ? {
    schema: receipt.schema,
    shippingVersion: receipt.shippingHarness?.version,
    ompVersion: receipt.omp?.version,
    tools: receipt.integration?.tools,
    mainHarness: receipt.integration?.mainHarness,
    managerSmoke: receipt.integration?.managerSmoke,
    backupId: receipt.backup?.id,
  } : null;

  return {
    schema: 'shipping-harness/omp-main-doctor-v1',
    checkedAt: new Date().toISOString(),
    healthy: Object.values(checks).every(Boolean),
    expectedShippingVersion: expectedVersion,
    shippingVersion,
    ompVersion,
    checks,
    details,
    paths: {
      shippingPrefix: prefix.root,
      agentDir: paths.agentDir,
      receipt: paths.receipt,
    },
  };
}

/** @param {string} command */
function runExecutableCheck(command) {
  try {
    runCommand('/usr/bin/test', ['-x', command], { timeoutMs: 5000 });
    return true;
  } catch {
    // A non-zero exit from /usr/bin/test (or the test binary being missing) both mean "not executable" for this doctor check.
    return false;
  }
}
