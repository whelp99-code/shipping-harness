import { spawnSync } from 'node:child_process';
import { invariant } from '../../../src/core/errors.mjs';

/** @param {string} version */
export function nodeMajor(version) {
  const match = String(version).match(/^(?:v)?(\d+)/u);
  return match ? Number(match[1]) : Number.NaN;
}

/**
 * @param {{nodeVersion?: string, gitExecutable?: string, codexExecutable?: string, host?: string, run?: typeof spawnSync}} [options]
 */
export function checkPluginCompatibility(options = {}) {
  const run = options.run ?? spawnSync;
  const version = options.nodeVersion ?? process.versions.node;
  const major = nodeMajor(version);
  const node = {
    version,
    major,
    supported: Number.isInteger(major) && major >= 22,
  };
  const gitExecutable = options.gitExecutable ?? 'git';
  const gitProbe = run(gitExecutable, ['--version'], { encoding: 'utf8', windowsHide: true });
  const git = {
    executable: gitExecutable,
    available: gitProbe.status === 0,
    version: gitProbe.status === 0 ? String(gitProbe.stdout).trim() : null,
    error: gitProbe.status === 0 ? null : String(gitProbe.stderr || gitProbe.error?.message || 'git unavailable').trim(),
  };
  let codex = null;
  if (options.host === 'codex') {
    const codexExecutable = options.codexExecutable ?? 'codex';
    const probe = run(codexExecutable, ['mcp', '--help'], { encoding: 'utf8', windowsHide: true });
    codex = {
      executable: codexExecutable,
      available: probe.status === 0 && /Manage external MCP servers/iu.test(String(probe.stdout)),
      error: probe.status === 0 ? null : String(probe.stderr || probe.error?.message || 'codex unavailable').trim(),
    };
  }
  return {
    schema: 'shipping-harness/plugin-compatibility-v1',
    ok: node.supported && git.available && (codex?.available ?? true),
    node,
    git,
    codex,
  };
}

/** @param {ReturnType<typeof checkPluginCompatibility>} report */
export function assertPluginCompatibility(report) {
  invariant(report.node.supported, 'ERR_PLUGIN_NODE_UNSUPPORTED', `Shipping plugin requires Node 22+, received ${report.node.version}`);
  invariant(report.git.available, 'ERR_PLUGIN_GIT_UNAVAILABLE', 'Shipping plugin requires Git', report.git);
  if (report.codex) invariant(report.codex.available, 'ERR_PLUGIN_CODEX_UNAVAILABLE', 'Codex MCP registration is unavailable', report.codex);
  return report;
}
