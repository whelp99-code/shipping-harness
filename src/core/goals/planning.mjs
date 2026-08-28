import { hashObject } from '../crypto.mjs';
import { invariant } from '../errors.mjs';
import { writeJsonAtomic } from '../fs.mjs';
import { appendExecutionEvent, readExecutionLedger } from './ledger.mjs';
import { goalRuntimePaths } from './paths.mjs';
import { readGoalRuntime, writeGoalSnapshots } from './store.mjs';
import { transitionTaskRecord } from './states.mjs';

const PLANNING_ROLES = Object.freeze(['planner', 'reviewer']);
const ACTIVE_TASK_STATES = new Set(['PENDING', 'READY', 'RUNNING', 'VERIFYING', 'FAILED', 'RETRY_READY']);

/** @param {unknown} value */
export function normalizePlanningSignature(value) {
  return String(value ?? '')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu, '<timestamp>')
    .replace(/(?:[A-Za-z]:\\|\/)[^\s:]+/gu, '<path>')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 4000);
}

/** @param {string[]} signatures */
export function detectPlanningOscillation(signatures) {
  if (signatures.length < 4) return false;
  const tail = signatures.slice(-4);
  return tail[0] === tail[2] && tail[1] === tail[3] && tail[0] !== tail[1];
}

/**
 * @param {string} root
 * @param {{taskId: string, role: 'planner'|'reviewer', signature: unknown, maxCycles?: number, maxRepeatedSignature?: number, at?: string, eventId?: string, transitionEventId?: string}} input
 */
export async function recordPlanningCycle(root, input) {
  invariant(PLANNING_ROLES.includes(input.role), 'ERR_PLANNING_ROLE', `Unsupported planning role: ${String(input.role)}`);
  const maxCycles = input.maxCycles ?? 2;
  const maxRepeatedSignature = input.maxRepeatedSignature ?? 2;
  invariant(Number.isInteger(maxCycles) && maxCycles >= 1 && maxCycles <= 10, 'ERR_PLANNING_BUDGET', 'maxCycles must be from 1 to 10');
  invariant(Number.isInteger(maxRepeatedSignature) && maxRepeatedSignature >= 1 && maxRepeatedSignature <= 10, 'ERR_PLANNING_BUDGET', 'maxRepeatedSignature must be from 1 to 10');

  const graph = await readGoalRuntime(root);
  const task = graph.tasks.find((candidate) => candidate.id === input.taskId);
  invariant(task, 'ERR_TASK_NOT_FOUND', `Task not found: ${input.taskId}`);
  invariant(ACTIVE_TASK_STATES.has(task.state), 'ERR_PLANNING_STATE', `Task ${task.id} cannot accept planning cycles from ${task.state}`);
  const normalized = normalizePlanningSignature(input.signature);
  invariant(normalized.length > 0, 'ERR_PLANNING_SIGNATURE', 'Planning signature is required');
  const signatureHash = hashObject({ normalized });
  const { events } = await readExecutionLedger(root, { allowTruncatedTail: false });
  const priorRecords = events
    .filter((event) => event.type === 'PLANNING_CYCLE_RECORDED' && event.payload?.record)
    .map((event) => event.payload.record);
  const prior = priorRecords.filter((record) => record.taskId === task.id);
  const roleCount = prior.filter((record) => record.role === input.role).length + 1;
  const signatures = [...prior.map((record) => record.signatureHash), signatureHash];
  const repeatedCount = prior.filter((record) => record.signatureHash === signatureHash).length + 1;
  const oscillation = detectPlanningOscillation(signatures);
  const exhausted = roleCount > maxCycles || repeatedCount >= maxRepeatedSignature || oscillation;
  const reason = roleCount > maxCycles
    ? `${input.role}-cycle-budget-exhausted`
    : repeatedCount >= maxRepeatedSignature
      ? 'repeated-planning-signature'
      : oscillation
        ? 'planning-role-ping-pong'
        : null;
  const recordedAt = input.at ?? new Date().toISOString();
  const record = {
    taskId: task.id,
    role: input.role,
    signatureHash,
    roleCount,
    repeatedCount,
    maxCycles,
    maxRepeatedSignature,
    oscillation,
    exhausted,
    reason,
    recordedAt,
  };
  let stateTransition = null;
  if (exhausted) {
    graph.tasks = graph.tasks.map((candidate) => {
      if (candidate.id !== task.id) return candidate;
      stateTransition = { taskId: task.id, from: candidate.state, to: 'PLANNING_STUCK', reason };
      return transitionTaskRecord(candidate, 'PLANNING_STUCK');
    });
  }
  await appendExecutionEvent(root, {
    type: 'PLANNING_CYCLE_RECORDED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    entityType: 'task',
    entityId: task.id,
    payload: { record, stateTransition },
    at: recordedAt,
    eventId: input.eventId,
  });
  const target = goalRuntimePaths(root).planningCounters;
  const document = {
    schema: 'shipping-harness/planning-counters-v1',
    project: graph.project,
    release: graph.release,
    contractHash: graph.contractHash,
    records: [...priorRecords, record].slice(-500),
  };
  await writeJsonAtomic(target, document);
  if (stateTransition) await writeGoalSnapshots(root, graph, recordedAt);
  return { ...record, nextState: stateTransition ? 'PLANNING_STUCK' : task.state };
}
