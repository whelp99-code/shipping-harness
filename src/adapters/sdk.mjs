import { spawnSync } from 'node:child_process';
import { redactSecrets } from '../core/redaction.mjs';

export const VERIFICATION_LEVELS = Object.freeze([
  'live',
  'configured',
  'fixture',
  'unavailable',
]);

export const CAPABILITY_KEYS = Object.freeze([
  'execute',
  'resume',
  'cancel',
  'jsonOutput',
  'hooks',
  'durableGoals',
  'durableLedger',
  'artifactCollection',
  'costTelemetry',
]);

/** @param {Record<string, boolean>} [overrides] */
export function capabilities(overrides = {}) {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, Boolean(overrides[key])]));
}

/** @param {string | string[]} candidates @param {NodeJS.ProcessEnv} [env] */
export function findExecutable(candidates, env = process.env) {
  const names = Array.isArray(candidates) ? candidates : [candidates];
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  for (const candidate of names) {
    const result = spawnSync(lookup, [candidate], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env,
    });
    if (result.status !== 0) continue;
    const executable = (result.stdout ?? '').split(/\r?\n/u).find(Boolean)?.trim();
    if (executable) return { candidate, executable };
  }
  return null;
}

/**
 * Probe an executable without a shell and without mutating project state.
 * @param {string} executable
 * @param {string[][]} [attempts]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function safeProbe(executable, attempts = [['--version'], ['version'], ['--help']], env = process.env) {
  const receipts = [];
  for (const args of attempts) {
    const result = spawnSync(executable, args, {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env,
    });
    const receipt = {
      args,
      exitCode: result.status ?? 1,
      stdout: redactSecrets((result.stdout ?? '').trim().slice(0, 4096)),
      stderr: redactSecrets((result.stderr ?? '').trim().slice(0, 4096)),
      error: result.error?.message ?? null,
    };
    receipts.push(receipt);
    if (receipt.exitCode === 0) return { ok: true, ...receipt, attempts: receipts };
  }
  const last = receipts.at(-1) ?? { args: [], exitCode: 1, stdout: '', stderr: '', error: 'No probe attempted.' };
  return { ok: false, ...last, attempts: receipts };
}

/** @param {Record<string, any>} contract @param {string} adapterName */
export function adapterConfiguration(contract, adapterName) {
  const value = contract?.adapters?.[adapterName];
  return value && typeof value === 'object' ? value : {};
}

/** @param {Record<string, any>} config */
export function configuredCommand(config) {
  return typeof config?.command === 'string' && config.command.trim() ? config.command.trim() : null;
}

/** @param {Record<string, any>} input */
export function normalizeCapabilityReport(input) {
  const verificationLevel = VERIFICATION_LEVELS.includes(input.verificationLevel)
    ? input.verificationLevel
    : 'unavailable';
  const diagnostics = Array.isArray(input.diagnostics)
    ? [...new Set(input.diagnostics.filter((entry) => typeof entry === 'string' && entry.trim()))]
    : [];
  return {
    schema: 'shipping-harness/adapter-capabilities-v1',
    name: String(input.name),
    displayName: String(input.displayName ?? input.name),
    installed: Boolean(input.installed),
    executable: typeof input.executable === 'string' ? input.executable : null,
    verificationLevel,
    version: typeof input.version === 'string' && input.version.trim() ? input.version.trim() : null,
    capabilities: capabilities(input.capabilities),
    diagnostics,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

/** @param {{stdout?: string, stderr?: string}} probe */
export function probeVersion(probe) {
  const text = probe.stdout || probe.stderr || '';
  return text.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? null;
}