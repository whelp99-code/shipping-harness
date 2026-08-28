import { spawnSync } from 'node:child_process';
import { invariant, ShippingError } from '../../../src/core/errors.mjs';
import { validateCodexHome } from './paths.mjs';

/** @param {string} stdout */
export function parseCodexMcpGet(stdout) {
  const text = String(stdout ?? '');
  const command = text.match(/^\s*command:\s*(.+)$/imu)?.[1]?.trim() ?? null;
  const argsLine = text.match(/^\s*args:\s*(.*)$/imu)?.[1]?.trim() ?? '';
  const args = argsLine && argsLine !== '-' ? argsLine.split(/\s+/u) : [];
  return {
    enabled: /^\s*enabled:\s*true\s*$/imu.test(text),
    transport: text.match(/^\s*transport:\s*(.+)$/imu)?.[1]?.trim() ?? null,
    command,
    args,
    raw: text,
  };
}

/**
 * @param {Record<string, any>} registration
 * @param {{run?: typeof spawnSync}} [options]
 */
export function inspectCodexRegistration(registration, options = {}) {
  const run = options.run ?? spawnSync;
  const codexHome = validateCodexHome(registration.codexHome);
  const env = { ...process.env, CODEX_HOME: codexHome };
  const result = run(registration.executable, registration.inspectArgv, { encoding: 'utf8', windowsHide: true, env });
  if (result.status !== 0) {
    return {
      exists: false,
      exact: false,
      status: result.status,
      error: String(result.stderr || result.error?.message || 'registration not found').trim(),
      observed: null,
    };
  }
  const observed = parseCodexMcpGet(result.stdout);
  const desiredCommand = registration.argv.at(-2);
  const desiredArgument = registration.argv.at(-1);
  const exact = observed.transport === 'stdio' &&
    observed.command === desiredCommand &&
    observed.args.length === 1 && observed.args[0] === desiredArgument;
  return { exists: true, exact, status: 0, error: null, observed };
}

/**
 * @param {Record<string, any>} registration
 * @param {{replace?: boolean, run?: typeof spawnSync}} [options]
 */
export function applyCodexRegistration(registration, options = {}) {
  const run = options.run ?? spawnSync;
  const codexHome = validateCodexHome(registration.codexHome);
  const env = { ...process.env, CODEX_HOME: codexHome };
  const before = inspectCodexRegistration(registration, { run });
  if (before.exact) return { changed: false, idempotent: true, before, after: before };
  if (before.exists && options.replace !== true) {
    throw new ShippingError('ERR_PLUGIN_REGISTRATION_CONFLICT', 'An existing Shipping Harness Codex registration points somewhere else; explicit replace is required', { observed: before.observed });
  }
  if (before.exists) {
    const removed = run(registration.executable, registration.removeArgv, { encoding: 'utf8', windowsHide: true, env });
    invariant(removed.status === 0, 'ERR_PLUGIN_REGISTRATION', `Failed to remove the previous Codex MCP registration: ${String(removed.stderr).trim()}`);
  }
  const added = run(registration.executable, registration.argv, { encoding: 'utf8', windowsHide: true, env });
  invariant(added.status === 0, 'ERR_PLUGIN_REGISTRATION', `Failed to add the Codex MCP registration: ${String(added.stderr || added.error?.message).trim()}`);
  const after = inspectCodexRegistration(registration, { run });
  invariant(after.exact, 'ERR_PLUGIN_REGISTRATION', 'Codex MCP registration verification did not match the requested Shipping command', { after });
  return { changed: true, idempotent: false, before, after };
}

/**
 * @param {Record<string, any>} registration
 * @param {{run?: typeof spawnSync, allowMissing?: boolean}} [options]
 */
export function removeCodexRegistration(registration, options = {}) {
  const run = options.run ?? spawnSync;
  const codexHome = validateCodexHome(registration.codexHome);
  const before = inspectCodexRegistration(registration, { run });
  if (!before.exists && options.allowMissing !== false) return { changed: false, missing: true, before };
  invariant(before.exact, 'ERR_PLUGIN_REGISTRATION_CONFLICT', 'Refusing to remove a Codex registration not owned by this Shipping plugin installation', { observed: before.observed });
  const result = run(registration.executable, registration.removeArgv, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  invariant(result.status === 0, 'ERR_PLUGIN_REGISTRATION', `Failed to remove the Codex MCP registration: ${String(result.stderr).trim()}`);
  const after = inspectCodexRegistration(registration, { run });
  invariant(!after.exists, 'ERR_PLUGIN_REGISTRATION', 'Codex MCP registration still exists after removal');
  return { changed: true, missing: false, before, after };
}
