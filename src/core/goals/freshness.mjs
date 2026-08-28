import { hashObject } from '../crypto.mjs';
import { invariant } from '../errors.mjs';

/**
 * @param {{graph: Record<string, any>, task: Record<string, any>, gitSha: string, evidenceRef: string, status?: string, recordedAt?: string, command?: string|null}} input
 */
export function createTaskEvidenceReceipt(input) {
  invariant(typeof input.gitSha === 'string' && /^[a-f0-9]{40}$/u.test(input.gitSha), 'ERR_TASK_EVIDENCE', 'Task evidence gitSha must be a full Git SHA');
  invariant(typeof input.evidenceRef === 'string' && input.evidenceRef.length > 0 && input.evidenceRef.length <= 1000, 'ERR_TASK_EVIDENCE', 'Task evidence reference is required');
  const receipt = {
    schema: 'shipping-harness/task-evidence-v1',
    taskId: input.task.id,
    consumer: { ...input.task.consumer },
    release: input.graph.release,
    contractHash: input.graph.contractHash,
    graphHash: input.graph.graphHash,
    gitSha: input.gitSha,
    status: input.status ?? 'PASS',
    evidenceRef: input.evidenceRef,
    commandDigest: input.command ? hashObject({ command: input.command }) : null,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  return { ...receipt, receiptHash: hashObject(receipt) };
}

/**
 * @param {Record<string, any>} graph
 * @param {Record<string, any>} task
 * @param {unknown} value
 * @param {string} currentGitSha
 */
export function assertFreshTaskEvidence(graph, task, value, currentGitSha) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_TASK_EVIDENCE_REQUIRED', `Task ${task.id} cannot become DONE without evidence`);
  const receipt = /** @type {Record<string, any>} */ (value);
  invariant(receipt.schema === 'shipping-harness/task-evidence-v1', 'ERR_TASK_EVIDENCE', 'Unsupported Task evidence schema');
  invariant(receipt.taskId === task.id, 'ERR_TASK_EVIDENCE', `Evidence belongs to ${receipt.taskId}, not ${task.id}`);
  invariant(receipt.release === graph.release, 'ERR_TASK_EVIDENCE', 'Task evidence release is stale');
  invariant(receipt.contractHash === graph.contractHash, 'ERR_TASK_EVIDENCE', 'Task evidence contract hash is stale');
  invariant(receipt.graphHash === graph.graphHash, 'ERR_TASK_EVIDENCE', 'Task evidence graph hash is stale');
  invariant(receipt.gitSha === currentGitSha, 'ERR_TASK_EVIDENCE_STALE', `Task evidence Git SHA ${receipt.gitSha} does not match current ${currentGitSha}`);
  invariant(receipt.status === 'PASS', 'ERR_TASK_EVIDENCE', `Task evidence status must be PASS, received ${String(receipt.status)}`);
  invariant(receipt.consumer?.type === task.consumer.type && receipt.consumer?.id === task.consumer.id, 'ERR_TASK_EVIDENCE', 'Task evidence consumer does not match the locked Task');
  invariant(typeof receipt.evidenceRef === 'string' && receipt.evidenceRef.length > 0, 'ERR_TASK_EVIDENCE', 'Task evidence reference is required');
  const { receiptHash, ...body } = receipt;
  invariant(receiptHash === hashObject(body), 'ERR_TASK_EVIDENCE', 'Task evidence receipt hash is invalid');
  return receipt;
}
