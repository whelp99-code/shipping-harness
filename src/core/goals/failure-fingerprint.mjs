import { hashObject } from '../crypto.mjs';
import { invariant } from '../errors.mjs';
import { exists, readJson, writeJsonAtomic } from '../fs.mjs';
import { appendExecutionEvent } from './ledger.mjs';
import { goalRuntimePaths } from './paths.mjs';
import { readGoalRuntime, transitionStoredTask } from './store.mjs';

/** @param {unknown} value */
export function normalizeFailureText(value) {
  return String(value ?? '')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu, '<timestamp>')
    .replace(/\b0x[0-9a-f]+\b/giu, '<hex>')
    .replace(/(?:[A-Za-z]:\\|\/)[^\s:]+/gu, '<path>')
    .replace(/\b\d+(?:\.\d+)?ms\b/giu, '<duration>')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 4000);
}

/** @param {{taskId: string, command?: string|null, gitSha: string, error: unknown}} input */
export function createFailureFingerprint(input) {
  invariant(typeof input.gitSha === 'string' && /^[a-f0-9]{40}$/u.test(input.gitSha), 'ERR_FAILURE_FINGERPRINT', 'Failure gitSha must be a full Git SHA');
  const normalizedError = normalizeFailureText(input.error);
  invariant(normalizedError.length > 0, 'ERR_FAILURE_FINGERPRINT', 'Failure error text is required');
  const material = {
    taskId: input.taskId,
    command: String(input.command ?? '').trim(),
    gitSha: input.gitSha,
    normalizedError,
  };
  return { ...material, fingerprint: hashObject(material) };
}

/**
 * @param {string} root
 * @param {{taskId: string, command?: string|null, gitSha: string, error: unknown, maxIdenticalFailures?: number, at?: string, eventId?: string, transitionEventId?: string}} input
 */
export async function applyTaskFailurePolicy(root, input) {
  const graph = await readGoalRuntime(root);
  const task = graph.tasks.find((candidate) => candidate.id === input.taskId);
  invariant(task, 'ERR_TASK_NOT_FOUND', `Task not found: ${input.taskId}`);
  invariant(task.state === 'FAILED', 'ERR_FAILURE_STATE', `Task ${task.id} must be FAILED before retry policy evaluation`);
  const limit = input.maxIdenticalFailures ?? 2;
  invariant(Number.isInteger(limit) && limit >= 1 && limit <= 10, 'ERR_FAILURE_BUDGET', 'maxIdenticalFailures must be from 1 to 10');
  const material = createFailureFingerprint(input);
  const target = goalRuntimePaths(root).failureFingerprints;
  const document = (await exists(target))
    ? await readJson(target)
    : {
        schema: 'shipping-harness/failure-fingerprints-v1',
        project: graph.project,
        release: graph.release,
        contractHash: graph.contractHash,
        entries: [],
      };
  invariant(document.schema === 'shipping-harness/failure-fingerprints-v1', 'ERR_FAILURE_FINGERPRINT', 'Unsupported failure fingerprint schema');
  invariant(document.release === graph.release && document.contractHash === graph.contractHash, 'ERR_FAILURE_FINGERPRINT', 'Failure fingerprint state belongs to another release');
  const previous = [...document.entries].reverse().find((entry) => entry.taskId === task.id && entry.fingerprint === material.fingerprint);
  const identicalCount = (previous?.identicalCount ?? 0) + 1;
  const budgetExhausted = task.attempts >= task.maxAttempts;
  const allowRetry = identicalCount < limit && !budgetExhausted;
  const entry = {
    taskId: task.id,
    fingerprint: material.fingerprint,
    gitSha: material.gitSha,
    commandDigest: hashObject({ command: material.command }),
    errorDigest: hashObject({ normalizedError: material.normalizedError }),
    identicalCount,
    limit,
    allowRetry,
    budgetExhausted,
    recordedAt: input.at ?? new Date().toISOString(),
  };
  document.entries.push(entry);
  if (document.entries.length > 200) document.entries = document.entries.slice(-200);
  await writeJsonAtomic(target, document);
  await appendExecutionEvent(root, {
    type: 'FAILURE_RECORDED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    entityType: 'task',
    entityId: task.id,
    payload: entry,
    at: entry.recordedAt,
    eventId: input.eventId,
  });
  const transition = await transitionStoredTask(root, task.id, allowRetry ? 'RETRY_READY' : 'BLOCKED', {
    reason: allowRetry ? 'bounded-retry-allowed' : (budgetExhausted ? 'attempt-budget-exhausted' : 'identical-no-progress-failure'),
    at: entry.recordedAt,
    eventId: input.transitionEventId,
  });
  return { ...entry, nextState: transition.graph.tasks.find((candidate) => candidate.id === task.id).state };
}
