import { randomUUID } from 'node:crypto';
import { appendJsonLine, exists, readJson, readJsonLines, writeJsonAtomic } from './fs.mjs';
import { invariant, ShippingError } from './errors.mjs';
import { runtimePaths } from './paths.mjs';
import { assessStateIntegrity, buildStateIntegrity, ledgerEventDigest } from './state-integrity.mjs';

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
  const base = {
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
    verifyRuns: 0,
    redundantVerifyRuns: 0,
    resumeState: null,
    humanStop: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const state = await writeSignedState(root, base, { type: 'state.initialized', to: base.state, state: base });
  return state;
}

/** @param {string} root */
export async function readState(root) {
  const state = await readJson(runtimePaths(root).state);
  invariant(STATES.includes(state.state), 'ERR_STATE_INVALID', `Unknown state: ${state.state}`);
  return state;
}

/**
 * Append one signed event to the release ledger and return it.
 * Every event carries `prev` (the previous event's digest, or null) and its own `digest`,
 * so a deleted or rewritten line is detectable by `verifyLedgerChain`.
 * @param {string} root
 * @param {Record<string, unknown>} event
 * @returns {Promise<Record<string, any>>}
 */
export async function recordLedger(root, event) {
  const paths = runtimePaths(root);
  const previous = (await readJsonLines(paths.ledger)).at(-1) ?? null;
  const body = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...event,
    prev: previous?.digest ?? null,
  };
  const signed = { ...body, digest: ledgerEventDigest(body) };
  await appendJsonLine(paths.ledger, signed);
  return signed;
}

/**
 * Record the state-write ledger event first, then write state.json bound to that event.
 * The order matters: the integrity digest names the ledger head that proves the write.
 * @param {string} root
 * @param {Record<string, any>} state
 * @param {Record<string, unknown>} event
 * @returns {Promise<Record<string, any>>}
 */
export async function writeSignedState(root, state, event) {
  const recorded = await recordLedger(root, { ...event, stateWrite: true });
  const signed = { ...state, integrity: buildStateIntegrity(state, recorded.id) };
  await writeJsonAtomic(runtimePaths(root).state, signed);
  return signed;
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
  const { integrity: _previousIntegrity, ...carried } = current;
  const updated = {
    ...carried,
    ...patch,
    state: next,
    updatedAt: new Date().toISOString(),
  };
  return writeSignedState(root, updated, { type: 'state.transition', from: current.state, to: next, reason, patch });
}

/** @param {string} root @param {Record<string, unknown>} patch @param {string} reason */
export async function patchState(root, patch, reason) {
  const current = await readState(root);
  const { integrity: _previousIntegrity, ...carried } = current;
  const updated = { ...carried, ...patch, updatedAt: new Date().toISOString() };
  return writeSignedState(root, updated, { type: 'state.patch', state: current.state, to: updated.state, reason, patch });
}

/**
 * Read state and refuse to return it when its integrity is broken. Every command that
 * decides, mutates or reports authority uses this; only reporting surfaces use `readState`.
 * @param {string} root
 * @returns {Promise<Record<string, any>>}
 */
export async function readTrustedState(root) {
  const state = await readState(root);
  const integrity = await assessStateIntegrity(root);
  if (integrity.level === 'TAMPERED') {
    throw new ShippingError('ERR_STATE_TAMPERED', `Release state integrity is broken: ${integrity.reason}. Restore .shipping/state.json from trusted history before continuing.`, {
      level: integrity.level,
      reason: integrity.reason,
      expected: integrity.expected,
      observed: integrity.observed,
      ledgerState: integrity.ledgerState,
    });
  }
  return state;
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