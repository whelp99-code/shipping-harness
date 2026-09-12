import { invariant } from '../errors.mjs';
import { GOAL_STATES, TASK_STATES } from './schema.mjs';

const GOAL_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['ACTIVE', 'BLOCKED', 'SUPERSEDED']),
  ACTIVE: Object.freeze(['VERIFYING', 'BLOCKED', 'SUPERSEDED']),
  VERIFYING: Object.freeze(['DONE', 'BLOCKED']),
  DONE: Object.freeze([]),
  BLOCKED: Object.freeze([]),
  SUPERSEDED: Object.freeze([]),
});

const TASK_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['READY', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK']),
  READY: Object.freeze(['RUNNING', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK']),
  RUNNING: Object.freeze(['VERIFYING', 'FAILED', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK']),
  VERIFYING: Object.freeze(['DONE', 'FAILED', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK']),
  FAILED: Object.freeze(['RETRY_READY', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK']),
  RETRY_READY: Object.freeze(['RUNNING', 'BLOCKED', 'PAUSED', 'PLANNING_STUCK']),
  PAUSED: Object.freeze(['PENDING', 'READY', 'RUNNING', 'VERIFYING', 'FAILED', 'RETRY_READY', 'BLOCKED']),
  DONE: Object.freeze([]),
  BLOCKED: Object.freeze([]),
  PLANNING_STUCK: Object.freeze([]),
});

/** @param {string} from @param {string} to */
export function assertGoalTransition(from, to) {
  invariant(GOAL_STATES.includes(from), 'ERR_GOAL_STATE', `Unsupported Goal state: ${from}`);
  invariant(GOAL_STATES.includes(to), 'ERR_GOAL_STATE', `Unsupported Goal state: ${to}`);
  invariant(GOAL_TRANSITIONS[from].includes(to), 'ERR_GOAL_TRANSITION', `Invalid Goal transition ${from} -> ${to}`, { from, to });
  return true;
}

/** @param {string} from @param {string} to */
export function assertTaskTransition(from, to) {
  invariant(TASK_STATES.includes(from), 'ERR_TASK_STATE', `Unsupported Task state: ${from}`);
  invariant(TASK_STATES.includes(to), 'ERR_TASK_STATE', `Unsupported Task state: ${to}`);
  invariant(TASK_TRANSITIONS[from].includes(to), 'ERR_TASK_TRANSITION', `Invalid Task transition ${from} -> ${to}`, { from, to });
  return true;
}

/** @param {Record<string, any>} goal @param {string} nextState @returns {Record<string, any>} */
export function transitionGoalRecord(goal, nextState) {
  assertGoalTransition(goal.state, nextState);
  return { ...goal, state: nextState };
}

/** @param {Record<string, any>} task @param {string} nextState @returns {Record<string, any>} */
export function transitionTaskRecord(task, nextState) {
  assertTaskTransition(task.state, nextState);
  return { ...task, state: nextState };
}
