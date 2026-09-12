import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInside, validateAbsoluteRoot } from './io.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @returns {string}
 */
export function packageRoot() {
  return PACKAGE_ROOT;
}

/**
 * @typedef {Readonly<{home: string, ompRoot: string, agentDir: string, backups: string, mcpConfig: string, config: string, agents: string, skill: string, receipt: string}>} OmpMainPaths
 */

/**
 * @param {{home?: string, agentDir?: string}} [input]
 * @returns {OmpMainPaths}
 */
export function ompMainPaths(input = {}) {
  const home = validateAbsoluteRoot(input.home ?? process.env.HOME, 'home');
  const agentDir = validateAbsoluteRoot(input.agentDir ?? path.join(home, '.omp', 'agent'), 'agentDir');
  const ompRoot = validateAbsoluteRoot(path.join(home, '.omp'), 'OMP root');
  assertInside(ompRoot, agentDir, 'agentDir');
  const backups = assertInside(ompRoot, path.join(ompRoot, 'backups'), 'backup root');
  const skill = assertInside(agentDir, path.join(agentDir, 'skills', 'shipping-harness', 'SKILL.md'), 'Shipping skill');
  return Object.freeze({
    home,
    ompRoot,
    agentDir,
    backups,
    mcpConfig: assertInside(agentDir, path.join(agentDir, 'mcp.json'), 'MCP config'),
    config: assertInside(agentDir, path.join(agentDir, 'config.yml'), 'OMP config'),
    agents: assertInside(agentDir, path.join(agentDir, 'AGENTS.md'), 'OMP agent rules'),
    skill,
    receipt: assertInside(agentDir, path.join(agentDir, 'shipping-harness-install.json'), 'install receipt'),
  });
}

/**
 * @param {{shippingCli?: string, shippingMcp?: string, ompCommand?: string}} [input]
 * @returns {Readonly<{shippingCli: string, shippingMcp: string, omp: string}>}
 */
export function packageCommands(input = {}) {
  const root = packageRoot();
  return Object.freeze({
    shippingCli: path.resolve(input.shippingCli ?? path.join(root, 'bin', 'shipping-harness.mjs')),
    shippingMcp: path.resolve(input.shippingMcp ?? path.join(root, 'bin', 'shipping-harness-mcp.mjs')),
    omp: input.ompCommand ?? process.env.OMP_COMMAND ?? 'omp',
  });
}
