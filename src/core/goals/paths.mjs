import path from 'node:path';
import { invariant } from '../errors.mjs';
import { runtimePaths } from '../paths.mjs';

/** @param {string} value @param {string} label */
export function safeRuntimeSegment(value, label) {
  invariant(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/u.test(value), 'ERR_GOAL_PATH', `${label} contains unsafe path characters`, { value });
  return value;
}

/** @param {string} root */
export function goalRuntimePaths(root) {
  const shipping = runtimePaths(root);
  return {
    directory: shipping.directory,
    goals: path.join(shipping.directory, 'goals.json'),
    tasks: path.join(shipping.directory, 'tasks.json'),
    ledger: path.join(shipping.directory, 'execution-ledger.jsonl'),
    checkpoints: path.join(shipping.directory, 'checkpoints'),
    attempts: path.join(shipping.directory, 'attempts'),
    failureFingerprints: path.join(shipping.directory, 'failure-fingerprints.json'),
    planningCounters: path.join(shipping.directory, 'planning-counters.json'),
  };
}

/** @param {string} root @param {string} checkpointId */
export function checkpointPath(root, checkpointId) {
  return path.join(goalRuntimePaths(root).checkpoints, `${safeRuntimeSegment(checkpointId, 'Checkpoint ID')}.json`);
}

/** @param {string} root @param {string} taskId @param {string} attemptId */
export function attemptPath(root, taskId, attemptId) {
  return path.join(
    goalRuntimePaths(root).attempts,
    safeRuntimeSegment(taskId, 'Task ID'),
    `${safeRuntimeSegment(attemptId, 'Attempt ID')}.json`,
  );
}
