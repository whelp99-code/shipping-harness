import { hmac, safeHex } from './crypto.mjs';
import { authorize } from './identity.mjs';
import {
  ALLOWED_ACTIONS,
  boundedString,
  invariant,
  rejectArbitraryExecution,
} from './policy.mjs';

const REQUEST_FIELDS = new Set([
  'schema',
  'requestId',
  'actorId',
  'projectId',
  'action',
  'params',
  'timestamp',
  'nonce',
  'approvalReceipt',
  'signature',
]);

/**
 * @param {*} unsigned
 * @param {*} credential
 * @returns {*}
 */
export function signRemoteRequest(unsigned, credential) {
  return { ...unsigned, signature: hmac(unsigned, credential) };
}

/**
 * @param {*} request
 * @param {*} config
 * @param {*} options
 * @returns {*}
 */
export function validateRemoteRequest(request, config, { now = Date.now() } = {}) {
  invariant(request && typeof request === 'object' && !Array.isArray(request), 'ERR_REMOTE_REQUEST', 'Request must be an object');
  for (const key of Object.keys(request)) {
    invariant(REQUEST_FIELDS.has(key), 'ERR_REMOTE_FIELD', `Unknown request field: ${key}`);
  }
  invariant(request.schema === 'shipping-remote/request-v1', 'ERR_REMOTE_SCHEMA', 'Unsupported remote request schema');
  boundedString(request.requestId, 'requestId', 160);
  boundedString(request.actorId, 'actorId', 160);
  boundedString(request.projectId, 'projectId', 160);
  invariant(ALLOWED_ACTIONS.includes(request.action), 'ERR_REMOTE_ACTION', 'Unsupported remote action');
  boundedString(request.nonce, 'nonce', 256);
  invariant(request.params === undefined || (request.params && typeof request.params === 'object' && !Array.isArray(request.params)), 'ERR_REMOTE_ARGUMENT', 'params must be an object');
  rejectArbitraryExecution(request.params ?? {});

  const when = Date.parse(request.timestamp);
  invariant(Number.isFinite(when) && Math.abs(now - when) <= config.maxClockSkewMs, 'ERR_REMOTE_TIME', 'Request timestamp is stale or too far in the future');

  const { actor, project, permission } = authorize(config, request);
  const unsigned = { ...request };
  delete unsigned.signature;
  invariant(safeHex(hmac(unsigned, actor.credential), request.signature), 'ERR_REMOTE_SIGNATURE', 'Request signature is invalid');
  return { request, unsigned, actor, project, permission, when };
}
