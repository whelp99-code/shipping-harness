import { hmac, randomId, safeHex } from './crypto.mjs';
import { boundedString, invariant } from './policy.mjs';

const RECEIPT_FIELDS = new Set([
  'schema',
  'receiptId',
  'requestId',
  'actorId',
  'projectId',
  'release',
  'proposalId',
  'proposalHash',
  'gitSha',
  'nonce',
  'issuedAt',
  'expiresAt',
  'oneTime',
  'signature',
]);

function validateBindingValue(value, label, maximum = 256) {
  boundedString(value, label, maximum);
  return value;
}

/**
 * @typedef {{schema: string, receiptId: string, requestId: string, actorId: string, projectId: string, release: string, proposalId: string, proposalHash: string, gitSha: string, nonce: string, issuedAt: string, expiresAt: string, oneTime: boolean, signature: string}} ApprovalReceipt
 */

/**
 * @param {{requestId: string, actorId: string, projectId: string, release: string, proposalId: string, proposalHash: string, gitSha: string, requestNonce: string, serverCredential: string, now?: number, ttlMs?: number}} options
 * @returns {ApprovalReceipt}
 */
export function issueApprovalReceipt({
  requestId,
  actorId,
  projectId,
  release,
  proposalId,
  proposalHash,
  gitSha,
  requestNonce,
  serverCredential,
  now = Date.now(),
  ttlMs = 180000,
}) {
  for (const [key, value] of Object.entries({ requestId, actorId, projectId, release, proposalId, proposalHash, gitSha, requestNonce })) {
    validateBindingValue(value, key);
  }
  invariant(/^(?:sha256:)?[a-f0-9]{64}$/u.test(proposalHash), 'ERR_REMOTE_APPROVAL', 'proposalHash must be SHA-256');
  invariant(/^[a-f0-9]{40}$/u.test(gitSha), 'ERR_REMOTE_APPROVAL', 'gitSha must be a full Git SHA');
  invariant(Number.isInteger(ttlMs) && ttlMs >= 30000 && ttlMs <= 300000, 'ERR_REMOTE_APPROVAL', 'Approval TTL is invalid');
  boundedString(serverCredential, 'server signing credential', 8192);

  const body = {
    schema: 'shipping-remote-approval/v1',
    receiptId: randomId('APPROVAL'),
    requestId,
    actorId,
    projectId,
    release,
    proposalId,
    proposalHash,
    gitSha,
    nonce: randomId(`NONCE-${requestNonce.slice(0, 24)}`),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    oneTime: true,
  };
  return { ...body, signature: hmac(body, serverCredential) };
}

/**
 * @param {ApprovalReceipt} receipt
 * @param {{serverCredential: string, now?: number, requestId?: string, actorId?: string, projectId?: string, release?: string, proposalId?: string, proposalHash?: string, gitSha?: string}} expected
 * @returns {ApprovalReceipt}
 */
export function validateApprovalReceipt(receipt, expected) {
  invariant(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'ERR_REMOTE_APPROVAL', 'Approval receipt is missing or invalid');
  for (const key of Object.keys(receipt)) {
    invariant(RECEIPT_FIELDS.has(key), 'ERR_REMOTE_APPROVAL', `Unknown approval receipt field: ${key}`);
  }
  invariant(receipt.schema === 'shipping-remote-approval/v1', 'ERR_REMOTE_APPROVAL', 'Approval receipt schema is invalid');
  invariant(receipt.oneTime === true, 'ERR_REMOTE_APPROVAL', 'Approval receipt must be one-time');
  /** @type {Partial<ApprovalReceipt>} */
  const unsigned = { ...receipt };
  delete unsigned.signature;
  invariant(safeHex(hmac(unsigned, expected.serverCredential), receipt.signature), 'ERR_REMOTE_APPROVAL', 'Approval receipt signature is invalid');

  for (const key of ['requestId', 'actorId', 'projectId', 'release', 'proposalId', 'proposalHash', 'gitSha']) {
    if (expected[key] !== undefined) {
      invariant(receipt[key] === expected[key], 'ERR_REMOTE_APPROVAL', `Approval receipt ${key} binding mismatch`);
    }
  }
  validateBindingValue(receipt.receiptId, 'receiptId');
  validateBindingValue(receipt.nonce, 'approval nonce');
  const issued = Date.parse(receipt.issuedAt);
  const expires = Date.parse(receipt.expiresAt);
  const now = expected.now ?? Date.now();
  invariant(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now + 30000 && expires > now && expires > issued, 'ERR_REMOTE_APPROVAL', 'Approval receipt is expired or has invalid timestamps');
  invariant(expires - issued <= 300000, 'ERR_REMOTE_APPROVAL', 'Approval receipt lifetime exceeds policy');
  return receipt;
}
