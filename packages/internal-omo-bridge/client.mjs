import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runtimePaths } from '../../src/core/paths.mjs';
import { ensureDir, readJson, writeJsonAtomic } from '../../src/core/fs.mjs';
import { invariant, ShippingError } from '../../src/core/errors.mjs';
import { loadPrivateOmoConfig, verifyPrivateOmoPromotion } from './config.mjs';
import { loadOrCreateBridgeKey } from './key.mjs';
import { createPrivateOmoWorkOrder } from './work-order.mjs';
import { validatePrivateOmoReceipt } from './receipt.mjs';

function runJson(config, argv, { key, timeoutMs = 120_000 } = {}) {
  const result = spawnSync(config.nodePath, [config.cliPath, ...argv, '--json'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      SHIPPING_OMO_NODE: config.nodePath,
      ...(key ? { SHIPPING_OMO_HMAC_KEY: key } : {}),
    },
  });
  if (result.error) throw new ShippingError('ERR_OMO_RUNTIME_EXEC', 'Unable to execute the private OMO runtime', { cause: result.error.message });
  let parsed;
  try { parsed = JSON.parse(String(result.stdout || '').trim()); }
  catch {
    throw new ShippingError('ERR_OMO_RUNTIME_OUTPUT', 'Private OMO runtime did not return bounded JSON', {
      exitCode: result.status ?? 1,
      stderr: String(result.stderr || '').trim().slice(0, 4000),
    });
  }
  return { exitCode: result.status ?? 1, stderr: String(result.stderr || '').trim(), data: parsed };
}

/** @param {string} root */
export async function privateOmoDoctor(root) {
  const config = await loadPrivateOmoConfig(root);
  const promotion = await verifyPrivateOmoPromotion(root, config);
  const result = runJson(config, ['doctor']);
  invariant(result.exitCode === 0 && result.data.healthy === true, 'ERR_OMO_RUNTIME_UNAVAILABLE', 'Private OMO runtime doctor failed', { doctor: result.data, stderr: result.stderr });
  invariant(result.data.internalOnly === true && result.data.publicPublish === false, 'ERR_OMO_BRIDGE_BOUNDARY', 'Private OMO doctor violates the internal-use boundary');
  invariant(result.data.teamMode === false && result.data.dagMode === false, 'ERR_OMO_BRIDGE_BUDGET', 'Private OMO doctor enabled v0.8 features');
  return Object.freeze({ config, promotion, doctor: result.data });
}

/**
 * @param {string} root
 * @param {Parameters<typeof createPrivateOmoWorkOrder>[1] & {timeoutMs?: number}} options
 */
export async function executePrivateOmoRuntime(root, options = {}) {
  const health = await privateOmoDoctor(root);
  const keyRecord = await loadOrCreateBridgeKey(root, health.config);
  const order = await createPrivateOmoWorkOrder(root, { ...options, hmacKey: keyRecord.key });
  const directory = path.join(runtimePaths(root).tmp, 'private-omo', order.shipping_session_id);
  await ensureDir(directory);
  const orderPath = path.join(directory, 'work-order.json');
  const receiptPath = path.join(directory, 'receipt.json');
  await writeJsonAtomic(orderPath, order);
  const argv = [
    'execute', '--order', orderPath,
    '--state-root', health.config.stateRoot,
    '--receipt-out', receiptPath,
  ];
  for (const allowedRoot of health.config.allowedRoots) argv.push('--allowed-root', allowedRoot);
  const result = runJson(health.config, argv, { key: keyRecord.key, timeoutMs: options.timeoutMs ?? (order.budgets.wall_clock_seconds + 30) * 1000 });
  const receipt = result.data.receipt ?? await readJson(receiptPath);
  const validated = validatePrivateOmoReceipt(root, receipt, { order, hmacKey: keyRecord.key });
  return Object.freeze({
    schema: 'shipping-harness/private-omo-execution-v1',
    health: { runtimeVersion: health.promotion.runtimeVersion, buildDigest: health.promotion.buildDigest },
    keyCreated: keyRecord.created,
    order,
    receipt: validated,
    runtimeExitCode: result.exitCode,
    runtimeStderr: result.stderr,
    orderPath,
    receiptPath,
  });
}

/** @param {string} root @param {string} sessionId */
export async function privateOmoStatus(root, sessionId) {
  const config = await loadPrivateOmoConfig(root);
  const result = runJson(config, ['status', '--state-root', config.stateRoot, '--session', sessionId]);
  invariant(result.exitCode === 0, 'ERR_OMO_RUNTIME_STATUS', 'Private OMO runtime status failed', { stderr: result.stderr });
  return result.data;
}

/** @param {string} root @param {string} sessionId @param {string} reason */
export async function cancelPrivateOmo(root, sessionId, reason = 'human stop') {
  const config = await loadPrivateOmoConfig(root);
  const result = runJson(config, ['cancel', '--state-root', config.stateRoot, '--session', sessionId, '--reason', reason]);
  invariant(result.exitCode === 0, 'ERR_OMO_RUNTIME_CANCEL', 'Private OMO runtime cancellation failed', { stderr: result.stderr });
  return result.data;
}
