import { invariant } from '../errors.mjs';

export const GOAL_STATES = Object.freeze(['PENDING', 'ACTIVE', 'VERIFYING', 'DONE', 'BLOCKED', 'SUPERSEDED']);
export const TASK_STATES = Object.freeze([
  'PENDING', 'READY', 'RUNNING', 'VERIFYING', 'DONE', 'FAILED',
  'RETRY_READY', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK',
]);
export const TASK_TERMINAL_STATES = Object.freeze(['DONE', 'BLOCKED', 'PLANNING_STUCK']);
export const GOAL_TERMINAL_STATES = Object.freeze(['DONE', 'BLOCKED', 'SUPERSEDED']);

const STABLE_ID = /^(?:GOAL|TASK|AC|REQ)-[A-Z0-9][A-Z0-9_-]*$/u;

/** @param {unknown} value @param {string} label @param {string} prefix */
export function assertStableId(value, label, prefix) {
  invariant(typeof value === 'string' && STABLE_ID.test(value) && value.startsWith(`${prefix}-`), 'ERR_GOAL_ID', `${label} must be a stable ${prefix}-* identifier`, { value });
  return value;
}

/** @param {unknown} value @param {string} label */
export function assertNonEmptyText(value, label) {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= 4000, 'ERR_GOAL_SCHEMA', `${label} must be a non-empty bounded string`);
  return value.trim();
}

/** @param {unknown} value */
export function validateConsumer(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_GOAL_CONSUMER', 'Task consumer must be an object');
  const consumer = /** @type {Record<string, any>} */ (value);
  invariant(consumer.type === 'acceptance' || consumer.type === 'requirement', 'ERR_GOAL_CONSUMER', 'Task consumer type must be acceptance or requirement');
  assertStableId(consumer.id, 'Task consumer ID', consumer.type === 'acceptance' ? 'AC' : 'REQ');
  return { type: consumer.type, id: consumer.id };
}

/** @param {unknown} value */
export function validateGoalRecord(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_GOAL_SCHEMA', 'Goal must be an object');
  const goal = /** @type {Record<string, any>} */ (value);
  assertStableId(goal.id, 'Goal ID', 'GOAL');
  assertNonEmptyText(goal.title, 'Goal title');
  invariant(GOAL_STATES.includes(goal.state), 'ERR_GOAL_STATE', `Unsupported Goal state: ${String(goal.state)}`);
  invariant(Array.isArray(goal.taskIds), 'ERR_GOAL_SCHEMA', 'Goal taskIds must be an array');
  invariant(Array.isArray(goal.acceptanceIds), 'ERR_GOAL_SCHEMA', 'Goal acceptanceIds must be an array');
  for (const taskId of goal.taskIds) assertStableId(taskId, 'Goal task ID', 'TASK');
  for (const acceptanceId of goal.acceptanceIds) assertStableId(acceptanceId, 'Goal acceptance ID', 'AC');
  invariant(new Set(goal.taskIds).size === goal.taskIds.length, 'ERR_GOAL_DUPLICATE', `Goal ${goal.id} contains duplicate task IDs`);
  invariant(new Set(goal.acceptanceIds).size === goal.acceptanceIds.length, 'ERR_GOAL_DUPLICATE', `Goal ${goal.id} contains duplicate acceptance IDs`);
  return goal;
}

/** @param {unknown} value */
export function validateTaskRecord(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_TASK_SCHEMA', 'Task must be an object');
  const task = /** @type {Record<string, any>} */ (value);
  assertStableId(task.id, 'Task ID', 'TASK');
  assertStableId(task.goalId, 'Task Goal ID', 'GOAL');
  assertNonEmptyText(task.title, 'Task title');
  invariant(TASK_STATES.includes(task.state), 'ERR_TASK_STATE', `Unsupported Task state: ${String(task.state)}`);
  invariant(Array.isArray(task.dependsOn), 'ERR_TASK_SCHEMA', 'Task dependsOn must be an array');
  for (const dependency of task.dependsOn) assertStableId(dependency, 'Task dependency', 'TASK');
  invariant(new Set(task.dependsOn).size === task.dependsOn.length, 'ERR_GOAL_DUPLICATE', `Task ${task.id} contains duplicate dependencies`);
  validateConsumer(task.consumer);
  invariant(Number.isInteger(task.maxAttempts) && task.maxAttempts >= 1 && task.maxAttempts <= 10, 'ERR_TASK_BUDGET', 'Task maxAttempts must be an integer from 1 to 10');
  invariant(Number.isInteger(task.attempts) && task.attempts >= 0 && task.attempts <= task.maxAttempts, 'ERR_TASK_BUDGET', 'Task attempts must be within maxAttempts');
  return task;
}
