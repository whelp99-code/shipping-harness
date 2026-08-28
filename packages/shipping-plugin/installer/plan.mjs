import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashObject } from '../../../src/core/crypto.mjs';
import { invariant } from '../../../src/core/errors.mjs';
import { exists } from '../../../src/core/fs.mjs';
import { pluginPaths, validateCodexHome } from './paths.mjs';

const REQUIRED_ASSETS = Object.freeze([
  'manifest/plugin.json',
  'skill/SKILL.md',
  'agent-instructions/AGENT.md',
  'hooks/lifecycle.json',
  'host-profiles/codex.json',
  'host-profiles/generic.json',
]);

/** @param {string} packageRoot */
async function packageMetadata(packageRoot) {
  const root = path.resolve(packageRoot);
  const manifestPath = path.join(root, 'package.json');
  const mcpBinary = path.join(root, 'bin', 'shipping-harness-mcp.mjs');
  const assetRoot = path.join(root, 'packages', 'shipping-plugin');
  invariant(await exists(manifestPath), 'ERR_PLUGIN_PACKAGE', `Missing package manifest: ${manifestPath}`);
  invariant(await exists(mcpBinary), 'ERR_PLUGIN_PACKAGE', `Missing MCP binary: ${mcpBinary}`);
  for (const relative of REQUIRED_ASSETS) {
    invariant(await exists(path.join(assetRoot, relative)), 'ERR_PLUGIN_PACKAGE', `Missing plugin asset: ${relative}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  invariant(typeof manifest.version === 'string' && manifest.version.length > 0, 'ERR_PLUGIN_PACKAGE', 'Package version is missing');
  return { root, manifestPath, manifest, mcpBinary, assetRoot };
}

/**
 * @param {{packageRoot: string, installRoot: string, host?: 'generic'|'codex', codexHome?: string|null, codexExecutable?: string, projectRoot?: string|null}} input
 */
export async function createPluginInstallPlan(input) {
  const host = input.host ?? 'generic';
  invariant(host === 'generic' || host === 'codex', 'ERR_PLUGIN_HOST', `Unsupported plugin host: ${String(host)}`);
  const pkg = await packageMetadata(input.packageRoot);
  const paths = pluginPaths(input.installRoot);
  const codexHome = host === 'codex' && input.codexHome ? validateCodexHome(input.codexHome) : null;
  const registration = host === 'codex'
    ? {
        host: 'codex',
        name: 'shipping-harness',
        transport: 'stdio',
        executable: input.codexExecutable ?? 'codex',
        argv: ['mcp', 'add', 'shipping-harness', '--', process.execPath, pkg.mcpBinary],
        removeArgv: ['mcp', 'remove', 'shipping-harness'],
        inspectArgv: ['mcp', 'get', 'shipping-harness'],
        codexHome,
        requiresExplicitCodexHome: true,
      }
    : {
        host: 'generic',
        name: 'shipping-harness',
        transport: 'stdio',
        command: process.execPath,
        args: [pkg.mcpBinary],
        cwdMode: 'project-root',
      };
  const plan = {
    schema: 'shipping-harness/plugin-install-plan-v1',
    packageRoot: pkg.root,
    packageVersion: pkg.manifest.version,
    installRoot: paths.installRoot,
    pluginHome: paths.pluginHome,
    assetSource: pkg.assetRoot,
    assetDestination: paths.assets,
    projectRoot: input.projectRoot ? path.resolve(input.projectRoot) : null,
    host,
    registration,
    writes: [paths.assets, paths.registration, paths.receipt],
    preserves: input.projectRoot ? [path.join(path.resolve(input.projectRoot), '.shipping')] : [],
    publicListener: false,
    arbitraryCommandInput: false,
    dryRunSupported: true,
  };
  return { ...plan, planHash: hashObject(plan) };
}
