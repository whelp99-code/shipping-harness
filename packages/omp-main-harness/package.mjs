import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { defaultNpmCommand, exists, invariant, parseJsonOutput, runCommand, sha256, validateAbsoluteRoot } from './io.mjs';
import { packageRoot } from './paths.mjs';
import { singleNpmPackEntry } from '../../src/core/npm-pack.mjs';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** @param {string} prefix */
export function shippingPrefixPaths(prefix) {
  const root = validateAbsoluteRoot(prefix, 'shippingPrefix');
  return Object.freeze({
    root,
    bin: path.join(root, 'bin'),
    cli: path.join(root, 'bin', 'shipping-harness'),
    mcp: path.join(root, 'bin', 'shipping-harness-mcp'),
    omp: path.join(root, 'bin', 'shipping-harness-omp'),
    package: path.join(root, 'lib', 'node_modules', 'shipping-harness'),
  });
}

/** @param {string} archive */
export async function inspectPackageArchive(archive) {
  const absolute = path.resolve(archive);
  const body = await readFile(absolute);
  const manifestText = runCommand('tar', ['-xOf', absolute, 'package/package.json'], { timeoutMs: 30000 }).stdout;
  const manifest = JSON.parse(manifestText);
  invariant(manifest?.name === 'shipping-harness', 'ERR_OMP_PACKAGE_NAME', 'Package archive is not shipping-harness');
  invariant(typeof manifest.version === 'string' && SEMVER.test(manifest.version), 'ERR_OMP_PACKAGE_VERSION', 'Package archive has an invalid version');
  return {
    path: absolute,
    version: manifest.version,
    sha256: sha256(body),
    manifest,
  };
}

/** @param {string} prefix */
export function installedShippingVersion(prefix) {
  const paths = shippingPrefixPaths(prefix);
  if (!existsSyncExecutable(paths.cli)) return null;
  try {
    return runCommand(paths.cli, ['version'], { timeoutMs: 30000 }).stdout.trim();
  } catch {
    // A doctor/status probe: an unreadable or failing binary means "no usable installed version", not a hard error.
    return null;
  }
}

/** @param {string} target */
function existsSyncExecutable(target) {
  try {
    const result = runCommand('/usr/bin/test', ['-x', target], { timeoutMs: 5000 });
    return result.status === 0;
  } catch {
    // /usr/bin/test itself being unavailable means the executability check cannot be confirmed; treat as "not executable".
    return false;
  }
}

/** @param {{sourceRoot?: string, destination: string, npmCommand?: string}} input */
export async function packShippingSource(input) {
  const sourceRoot = path.resolve(input.sourceRoot ?? packageRoot());
  const destination = validateAbsoluteRoot(input.destination, 'package destination');
  const npm = input.npmCommand ?? defaultNpmCommand();
  const result = runCommand(npm, ['pack', '--json', '--pack-destination', destination], {
    cwd: sourceRoot,
    timeoutMs: 180000,
  });
  const parsed = parseJsonOutput(result.stdout, 'npm pack');
  const packed = singleNpmPackEntry(parsed, 'ERR_OMP_PACKAGE_PACK');
  return inspectPackageArchive(path.join(destination, packed.filename));
}

/** @param {{prefix: string, destination: string, npmCommand?: string}} input */
export async function backupInstalledShippingPackage(input) {
  const prefix = shippingPrefixPaths(input.prefix);
  if (!(await exists(prefix.package))) return null;
  const npm = input.npmCommand ?? defaultNpmCommand();
  const destination = validateAbsoluteRoot(input.destination, 'package backup destination');
  const result = runCommand(npm, ['pack', '--json', '--pack-destination', destination, prefix.package], {
    cwd: prefix.package,
    timeoutMs: 180000,
  });
  const parsed = parseJsonOutput(result.stdout, 'npm pack installed shipping-harness');
  const packed = singleNpmPackEntry(parsed, 'ERR_OMP_PACKAGE_BACKUP');
  const receipt = await inspectPackageArchive(path.join(destination, packed.filename));
  return {
    ...receipt,
    installedRoot: await realpath(prefix.package),
  };
}

/** @param {{prefix: string, archive: string, npmCommand?: string, expectedVersion?: string, requireOmpCli?: boolean}} input */
export async function installShippingPackage(input) {
  const prefix = shippingPrefixPaths(input.prefix);
  const archive = await inspectPackageArchive(input.archive);
  if (input.expectedVersion) invariant(archive.version === input.expectedVersion, 'ERR_OMP_PACKAGE_VERSION', `Expected Shipping ${input.expectedVersion}, package contains ${archive.version}`);
  const npm = input.npmCommand ?? defaultNpmCommand();
  runCommand(npm, [
    'install', '--offline', '--global', '--prefix', prefix.root, archive.path,
    '--ignore-scripts', '--no-audit', '--no-fund',
  ], { timeoutMs: 180000 });
  const observed = installedShippingVersion(prefix.root);
  invariant(observed === archive.version, 'ERR_OMP_INSTALL_VERSION', `Installed Shipping version is ${observed ?? 'missing'}, expected ${archive.version}`);
  invariant(existsSyncExecutable(prefix.mcp), 'ERR_OMP_INSTALL_MCP', 'Installed shipping-harness-mcp is missing or not executable');
  if (input.requireOmpCli !== false) invariant(existsSyncExecutable(prefix.omp), 'ERR_OMP_INSTALL_CLI', 'Installed shipping-harness-omp is missing or not executable');
  return {
    prefix: prefix.root,
    version: observed,
    packageSha256: archive.sha256,
    packagePath: archive.path,
    commands: { cli: prefix.cli, mcp: prefix.mcp, omp: prefix.omp },
  };
}

/** @param {{sourceRoot?: string, tag?: string, gitCommand?: string}} input */
export function verifyTaggedSource(input = {}) {
  const sourceRoot = path.resolve(input.sourceRoot ?? packageRoot());
  const manifest = JSON.parse(runCommand('cat', [path.join(sourceRoot, 'package.json')], { timeoutMs: 10000 }).stdout);
  const tag = input.tag ?? `v${manifest.version}`;
  const git = input.gitCommand ?? 'git';
  const tagType = runCommand(git, ['cat-file', '-t', tag], { cwd: sourceRoot, timeoutMs: 30000 }).stdout.trim();
  invariant(tagType === 'tag', 'ERR_OMP_TAG', `${tag} must be an annotated tag`);
  const head = runCommand(git, ['rev-parse', 'HEAD'], { cwd: sourceRoot, timeoutMs: 30000 }).stdout.trim();
  const tagCommit = runCommand(git, ['rev-parse', `${tag}^{commit}`], { cwd: sourceRoot, timeoutMs: 30000 }).stdout.trim();
  invariant(head === tagCommit, 'ERR_OMP_TAG', `Current source HEAD does not match ${tag}`);
  const dirty = runCommand(git, ['status', '--porcelain'], { cwd: sourceRoot, timeoutMs: 30000 }).stdout.trim();
  invariant(dirty === '', 'ERR_OMP_TAG_DIRTY', 'Tagged source worktree must be clean before bootstrap');
  return { tag, head, version: manifest.version };
}
