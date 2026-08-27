import { randomUUID } from 'node:crypto';
import { appendJsonLine, exists, readJson, writeJsonAtomic } from './fs.mjs';
import { invariant, ShippingError } from './errors.mjs';
import { runtimePaths } from './paths.mjs';

export const STATES = Object.freeze([
  'DRAFT',
  'LOCKED',
  'RUNNING',
  'VERIFYING',
  'TRIAGE',
  'FIXING',
  'SHIPPABLE',
  'BLOCKED',
  'PAUSED',
  'CLOSED',
  'ABORTED',
]);

const TRANSITIONS = Object.freeze({
  DRAFT: ['LOCKED', 'ABORTED'],
  LOCKED: ['RUNNING', 'VERIFYING', 'PAUSED', 'ABORTED'],
  RUNNING: ['VERIFYING', 'BLOCKED', 'PAUSED', 'ABORTED'],
  VERIFYING: ['TRIAGE', 'SHIPPABLE', 'BLOCKED', 'PAUSED', 'ABORTED'],
  TRIAGE: ['FIXING', 'VERIFYING', 'SHIPPABLE', 'BLOCKED', 'PAUSED', 'ABORTED'],
  FIXING: ['RUNNING', 'VERIFYING', 'BLOCKED', 'PAUSED', 'ABORTED'],
  SHIPPABLE: ['CLOSED', 'VERIFYING', 'PAUSED', 'ABORTED'],
  BLOCKED: ['FIXING', 'PAUSED', 'ABORTED'],
  PAUSED: ['LOCKED', 'RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING', 'SHIPPABLE', 'BLOCKED', 'ABORTED'],
  CLOSED: [],
  ABORTED: [],
});

/** @param {string} root @param {Record<string, unknown>} [overrides] */
export async function initializeState(root, overrides = {}) {
  const paths = runtimePaths(root);
  if (await exists(paths.state)) return readJson(paths.state);
  const now = new Date().toISOString();
  const state = {
    schema: 'shipping-harness/state-v1',
    state: 'DRAFT',
    release: null,
    contractHash: null,
    baselineSha: null,
    currentEvidenceSha: null,
    lastRunId: null,
    agentRuns: 0,
    fixCycles: 0,
    blockerCount: 0,
    nextCount: 0,
    ignoreCount: 0,
    resumeState: null,
    humanStop: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await writeJsonAtomic(paths.state, state);
  await recordLedger(root, { type: 'state.initialized', to: state.state, state });
  return state;
}

/** @param {string} root */
export async function readState(root) {
  const state = await readJson(runtimePaths(root).state);
  invariant(STATES.includes(state.state), 'ERR_STATE_INVALID', `Unknown state: ${state.state}`);
  return state;
}

/** @param {string} root @param {Record<string, unknown>} event */
export async function recordLedger(root, event) {
  await appendJsonLine(runtimePaths(root).ledger, {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...event,
  });
}

/**
 * @param {string} root
 * @param {string} next
 * @param {Record<string, unknown>} [patch]
 * @param {string} [reason]
 */
export async function transitionState(root, next, patch = {}, reason = 'unspecified') {
  invariant(STATES.includes(next), 'ERR_STATE_INVALID', `Unknown target state: ${next}`);
  const current = await readState(root);
  invariant(TRANSITIONS[current.state].includes(next), 'ERR_STATE_TRANSITION', `Invalid transition ${current.state} → ${next}`, {
    from: current.state,
    to: next,
  });
  const updated = {
    ...current,
    ...patch,
    state: next,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(runtimePaths(root).state, updated);
  await recordLedger(root, { type: 'state.transition', from: current.state, to: next, reason, patch });
  return updated;
}

/** @param {string} root @param {Record<string, unknown>} patch @param {string} reason */
export async function patchState(root, patch, reason) {
  const current = await readState(root);
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(runtimePaths(root).state, updated);
  await recordLedger(root, { type: 'state.patch', state: current.state, reason, patch });
  return updated;
}

/** @param {string} root @param {string} reason */
export async function pause(root, reason) {
  const current = await readState(root);
  if (current.state === 'PAUSED') return current;
  invariant(!['CLOSED', 'ABORTED'].includes(current.state), 'ERR_STATE_TERMINAL', `Cannot pause ${current.state}`);
  return transitionState(root, 'PAUSED', { resumeState: current.state, humanStop: true }, reason);
}

/** @param {string} root @param {string} reason */
export async function resume(root, reason) {
  const current = await readState(root);
  invariant(current.state === 'PAUSED', 'ERR_NOT_PAUSED', 'Release is not paused');
  const target = current.resumeState || 'LOCKED';
  invariant(TRANSITIONS.PAUSED.includes(target), 'ERR_STATE_INVALID', `Cannot resume to ${target}`);
  return transitionState(root, target, { resumeState: null, humanStop: false }, reason);
}

/** @param {string} root @param {string} reason */
export async function abort(root, reason) {
  const current = await readState(root);
  if (current.state === 'ABORTED') return current;
  if (current.state === 'CLOSED') throw new ShippingError('ERR_STATE_TERMINAL', 'A closed release cannot be aborted');
  return transitionState(root, 'ABORTED', { humanStop: true, abortReason: reason }, reason);
}