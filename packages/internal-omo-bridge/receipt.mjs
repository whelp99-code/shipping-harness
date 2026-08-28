import { hashObject } from '../../src/core/crypto.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { invariant } from '../../src/core/errors.mjs';
import { verifySignature } from './canonical.mjs';

const STATUS = new Set(['completed', 'failed', 'cancelled', 'blocked', 'unavailable']);

function hashBody(receipt) {
  const { receipt_hash: _hash, signature: _signature, ...body } = receipt;
  return body;
}

function signatureBody(receipt) {
  const { signature: _signature, ...body } = receipt;
  return body;
}

/** @param {string[]} left @param {string[]} right @param {string} label */
function sameArray(left, right, label) {
  invariant(JSON.stringify(left) === JSON.stringify(right), 'ERR_OMO_RECEIPT_BINDING', `${label} does not match the signed work order`);
}

/** @param {string} root @param {Record<string, any>} receipt @param {{order: Record<string, any>, hmacKey: string}} context */
export function validatePrivateOmoReceipt(root, receipt, context) {
  invariant(receipt?.schema === 'shipping-omo-receipt/v1', 'ERR_OMO_RECEIPT_SCHEMA', 'Unsupported private OMO receipt schema');
  invariant(STATUS.has(receipt.status), 'ERR_OMO_RECEIPT_STATUS', `Unsupported private OMO receipt status: ${String(receipt.status)}`);
  invariant(receipt.requires_shipping_verification === true && receipt.shipping_finisher_authority === true, 'ERR_OMO_RECEIPT_AUTHORITY', 'Private OMO receipt attempted to bypass Shipping authority');
  invariant(receipt.terminal_replay_allowed === false, 'ERR_OMO_RECEIPT_REPLAY', 'Private OMO terminal receipt replay must be disabled');
  invariant(receipt.receipt_hash === hashObject(hashBody(receipt)), 'ERR_OMO_RECEIPT_HASH', 'Private OMO receipt hash is invalid');
  invariant(verifySignature(signatureBody(receipt), receipt.signature, context.hmacKey), 'ERR_OMO_RECEIPT_SIGNATURE', 'Private OMO receipt signature is invalid');
  const order = context.order;
  for (const key of ['work_order_id', 'shipping_session_id', 'release_id', 'contract_hash']) {
    invariant(receipt[key] === order[key], 'ERR_OMO_RECEIPT_BINDING', `Private OMO receipt ${key} does not match the work order`);
  }
  invariant(receipt.source_git_sha === order.git_sha, 'ERR_OMO_RECEIPT_BINDING', 'Private OMO receipt source Git SHA does not match the work order');
  sameArray(receipt.goal_ids, order.goal_ids, 'Goal IDs');
  sameArray(receipt.shipping_task_ids, order.task_ids, 'Task IDs');
  sameArray(receipt.requirement_ids, order.requirement_ids, 'Requirement IDs');
  sameArray(receipt.acceptance_ids, order.acceptance_ids, 'Acceptance IDs');
  invariant(receipt.usage.turns <= order.budgets.turns && receipt.usage.tool_calls <= order.budgets.tool_calls && receipt.usage.continuations <= order.budgets.continuations, 'ERR_OMO_RECEIPT_BUDGET', 'Private OMO receipt exceeds the signed budget');
  invariant(Array.isArray(receipt.path_analysis?.violations), 'ERR_OMO_RECEIPT_SCOPE', 'Private OMO receipt has no path analysis');
  if (receipt.status === 'completed') {
    invariant(receipt.path_analysis.violations.length === 0, 'ERR_OMO_RECEIPT_SCOPE', 'Completed private OMO receipt contains scope violations');
    invariant(receipt.result_git_sha === currentGitSha(root), 'ERR_OMO_RECEIPT_STALE', 'Private OMO completion is stale for the current Git SHA');
  }
  return Object.freeze({ ...receipt, trustedRuntimeReceipt: true, releaseCompletionTrusted: false });
}
