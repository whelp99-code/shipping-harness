import { invariant } from './errors.mjs';

/** @param {unknown} value @returns {string} */
export function normalizeGoal(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

/**
 * Continuation identity is plan hash plus stage. Version number is not identity.
 * A different goal is unrelated even when the version matches.
 * @param {{planHash: string, stage: string, stageId?: string | null, goal: string}} expected
 * @param {{planHash: string, stage: string, stageId?: string | null, goal: string}} incoming
 * @returns {true}
 */
export function assertTrainContinuation(expected, incoming) {
  invariant(expected && incoming, 'ERR_TRAIN_CONTINUITY', 'Train continuation requires an expected stage and an incoming release');
  invariant(incoming.planHash === expected.planHash, 'ERR_TRAIN_CONTINUITY', 'Train continuation is bound to the plan hash, not the version number');
  invariant(incoming.stage === expected.stage, 'ERR_TRAIN_CONTINUITY', 'Train continuation is bound to the stage, not the version number');
  if (expected.stageId) {
    invariant(incoming.stageId === expected.stageId, 'ERR_TRAIN_CONTINUITY', 'Train continuation stage id does not match the plan');
  }
  invariant(normalizeGoal(incoming.goal) === normalizeGoal(expected.goal), 'ERR_TRAIN_UNRELATED_GOAL', 'Unrelated goal rejected');
  return true;
}
