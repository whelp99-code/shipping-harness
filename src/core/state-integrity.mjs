// State integrity: proves that .shipping/state.json was written by this engine and still
// agrees with the append-only ledger, the release receipt, and the evidence on disk.
//
// A model that hand-edits state.json (for example to "state": "CLOSED") changes bytes the
// digest covers, leaves the ledger head behind, or claims a state the ledger never proved.
// Every one of those is detected here. This module never mutates anything and never throws
// for a merely suspicious state: it classifies. Callers decide whether to refuse.
import path from 'node:path';
import { hashObject, sha256, stableStringify } from './crypto.mjs';
import { exists, readJson, readJsonLines } from './fs.mjs';
import { runtimePaths } from './paths.mjs';

export const INTEGRITY_ALGORITHM = 'sha256';

/** Ledger event types that accompany a write to state.json. */
export const STATE_WRITE_EVENT_TYPES = Object.freeze([
  'state.initialized',
  'state.transition',
  'state.patch',
  'release.prepared',
]);

/**
 * @typedef {{algorithm: string, ledgerHead: string, digest: string}} StateIntegrity
 * @typedef {{ok: boolean, level: 'VERIFIED'|'UNVERIFIED_LEGACY'|'TAMPERED', reason: string, expected: string|null, observed: string|null, ledgerState: string|null}} IntegrityAssessment
 */

/**
 * Content digest of one ledger event, excluding the digest field itself.
 * @param {Record<string, any>} event
 * @returns {string}
 */
export function ledgerEventDigest(event) {
  const { digest: _digest, ...body } = event;
  return hashObject(body);
}

/**
 * @param {Record<string, any>} state
 * @returns {Record<string, any>}
 */
function withoutIntegrity(state) {
  const { integrity: _integrity, ...rest } = state;
  return rest;
}

/**
 * Digest that binds a state document to the ledger event that produced it.
 * @param {Record<string, any>} state
 * @param {string} ledgerHead
 * @returns {string}
 */
export function stateDigest(state, ledgerHead) {
  return sha256(`${stableStringify(withoutIntegrity(state))}\n${ledgerHead}`);
}

/**
 * @param {Record<string, any>} state
 * @param {string} ledgerHead
 * @returns {StateIntegrity}
 */
export function buildStateIntegrity(state, ledgerHead) {
  return {
    algorithm: INTEGRITY_ALGORITHM,
    ledgerHead,
    digest: stateDigest(state, ledgerHead),
  };
}

/**
 * Verify the ledger hash chain. Events written before v1.10 carry neither `prev` nor
 * `digest`; they are legal and simply leave the chain unproven up to the first signed event.
 * @param {Array<Record<string, any>>} events
 * @returns {{ok: boolean, reason: string, signedCount: number, firstSignedIndex: number}}
 */
export function verifyLedgerChain(events) {
  let signedCount = 0;
  let firstSignedIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (typeof event?.digest !== 'string') continue;
    if (firstSignedIndex === -1) firstSignedIndex = index;
    signedCount += 1;
    if (ledgerEventDigest(event) !== event.digest) {
      return { ok: false, reason: `ledger event ${String(event.id)} digest does not match its content`, signedCount, firstSignedIndex };
    }
    const expectedPrev = index === 0 ? null : events[index - 1].digest ?? null;
    if ((event.prev ?? null) !== expectedPrev) {
      return { ok: false, reason: `ledger hash chain breaks at event ${String(event.id)}`, signedCount, firstSignedIndex };
    }
  }
  return { ok: true, reason: 'ledger chain verified', signedCount, firstSignedIndex };
}

/** States whose claim grants release authority and must always be backed by the ledger. */
const UPWARD_CLAIM_STATES = new Set(['SHIPPABLE', 'CLOSED']);

/**
 * @param {unknown} value
 * @returns {number[]|null}
 */
function semverParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(typeof value === 'string' ? value : '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * @param {unknown} candidate
 * @param {unknown} previous
 * @returns {boolean}
 */
function isLaterRelease(candidate, previous) {
  const left = semverParts(candidate);
  const right = semverParts(previous);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

/**
 * The state an unsigned (pre-v1.10) ledger proves.
 *
 * `release prepare` before v1.10 wrote a fresh DRAFT straight to state.json and recorded a
 * `release.prepared` ledger event that carried no `to` field, so the ledger of a legitimately
 * prepared repository still ends at the previous release's CLOSED. That exact shape — the
 * ledger ends CLOSED, the state is not itself an authority claim, and the state names a
 * `previousRelease` with a greater `release` — is the legacy prepare, and the state it proves
 * is DRAFT. Every other disagreement is left to the caller to judge.
 * @param {Record<string, any>} state
 * @param {string|null} ledgerState
 * @returns {string|null}
 */
export function legacyProvenState(state, ledgerState) {
  if (ledgerState !== 'CLOSED') return ledgerState;
  if (UPWARD_CLAIM_STATES.has(state.state)) return ledgerState;
  if (typeof state.previousRelease !== 'string') return ledgerState;
  return isLaterRelease(state.release, state.previousRelease) ? 'DRAFT' : ledgerState;
}

/**
 * The last state the ledger actually proves.
 * @param {Array<Record<string, any>>} events
 * @returns {string|null}
 */
export function ledgerProvenState(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (typeof events[index]?.to === 'string') return events[index].to;
  }
  return null;
}

/**
 * @param {'VERIFIED'|'UNVERIFIED_LEGACY'|'TAMPERED'} level
 * @param {string} reason
 * @param {string|null} ledgerState
 * @param {string|null} [expected]
 * @param {string|null} [observed]
 * @returns {IntegrityAssessment}
 */
function assessment(level, reason, ledgerState, expected = null, observed = null) {
  return { ok: level !== 'TAMPERED', level, reason, expected, observed, ledgerState };
}

/**
 * Checks (c), (d) and (e): the state must agree with the ledger, a CLOSED state must be
 * backed by a matching receipt, and a SHIPPABLE state by an evidence manifest.
 *
 * An unsigned legacy state is judged only in the upward direction: a pre-v1.10 ledger is an
 * incomplete record, so it can disprove a claim of SHIPPABLE or CLOSED but cannot disprove a
 * claim that grants no authority. A signed state is judged in both directions.
 * @param {string} root
 * @param {Record<string, any>} state
 * @param {string|null} ledgerState
 * @param {boolean} legacy
 * @returns {Promise<IntegrityAssessment|null>}
 */
async function semanticChecks(root, state, ledgerState, legacy) {
  const divergent = Boolean(ledgerState) && state.state !== ledgerState;
  if (divergent && (!legacy || UPWARD_CLAIM_STATES.has(state.state))) {
    return assessment('TAMPERED', 'state.json claims a state the ledger never recorded', ledgerState, ledgerState, String(state.state));
  }
  if (state.state === 'CLOSED') return closedChecks(root, state, ledgerState);
  if (state.state === 'SHIPPABLE') {
    const manifest = path.join(runtimePaths(root).evidence, String(state.lastRunId ?? ''), 'manifest.json');
    if (!state.lastRunId || !(await exists(manifest))) {
      return assessment('TAMPERED', 'SHIPPABLE state has no evidence manifest on disk', ledgerState, 'evidence manifest', String(state.lastRunId ?? 'none'));
    }
  }
  return null;
}

/**
 * @param {string} root
 * @param {Record<string, any>} state
 * @param {string|null} ledgerState
 * @returns {Promise<IntegrityAssessment|null>}
 */
async function closedChecks(root, state, ledgerState) {
  const relative = typeof state.releaseReceipt === 'string' && state.releaseReceipt
    ? state.releaseReceipt
    : path.posix.join('.shipping', 'releases', `${String(state.release)}.json`);
  const receiptPath = path.resolve(root, relative);
  if (!(await exists(receiptPath))) {
    return assessment('TAMPERED', 'CLOSED state has no release receipt on disk', ledgerState, relative, 'missing');
  }
  const receipt = await readJson(receiptPath);
  if (receipt.closedGitSha !== state.closedGitSha) {
    return assessment('TAMPERED', 'release receipt closedGitSha does not match state.json', ledgerState, String(receipt.closedGitSha), String(state.closedGitSha ?? null));
  }
  if (receipt.contractHash !== state.contractHash) {
    return assessment('TAMPERED', 'release receipt contractHash does not match state.json', ledgerState, String(receipt.contractHash), String(state.contractHash ?? null));
  }
  return null;
}

/**
 * @param {Record<string, any>} state
 * @param {Array<Record<string, any>>} events
 * @param {string|null} ledgerState
 * @returns {IntegrityAssessment|null}
 */
function signatureChecks(state, events, ledgerState) {
  const integrity = state.integrity;
  if (integrity.algorithm !== INTEGRITY_ALGORITHM) {
    return assessment('TAMPERED', 'state integrity algorithm is not supported', ledgerState, INTEGRITY_ALGORITHM, String(integrity.algorithm));
  }
  const expected = stateDigest(state, String(integrity.ledgerHead));
  if (expected !== integrity.digest) {
    return assessment('TAMPERED', 'state.json content does not match its integrity digest', ledgerState, expected, String(integrity.digest));
  }
  const chain = verifyLedgerChain(events);
  if (!chain.ok) return assessment('TAMPERED', chain.reason, ledgerState, null, null);
  const lastWrite = [...events].reverse().find((event) => event?.stateWrite === true) ?? null;
  if (!lastWrite || lastWrite.id !== integrity.ledgerHead) {
    return assessment('TAMPERED', 'state.json does not point at the last recorded state write', ledgerState, String(integrity.ledgerHead), String(lastWrite?.id ?? 'none'));
  }
  return null;
}

/**
 * Classify a state document against the ledger, receipt and evidence on disk.
 * @param {string} root
 * @param {Record<string, any>} state
 * @param {Array<Record<string, any>>} events
 * @returns {Promise<IntegrityAssessment>}
 */
export async function evaluateStateIntegrity(root, state, events) {
  const ledgerState = ledgerProvenState(events);
  if (!state.integrity) {
    const signedWrite = events.some((event) => event?.stateWrite === true && typeof event?.digest === 'string');
    if (signedWrite) {
      return assessment('TAMPERED', 'state.json lost its integrity signature while the ledger is signed', ledgerState, 'integrity', 'missing');
    }
    const proven = legacyProvenState(state, ledgerState);
    return (await semanticChecks(root, state, proven, true))
      ?? assessment('UNVERIFIED_LEGACY', 'state.json predates state integrity signing', proven);
  }
  return signatureChecks(state, events, ledgerState)
    ?? (await semanticChecks(root, state, ledgerState, false))
    ?? assessment('VERIFIED', 'state.json matches the ledger, receipt and evidence', ledgerState);
}

/**
 * Pure read-only integrity assessment of a repository's `.shipping/state.json`.
 * @param {string} root
 * @returns {Promise<IntegrityAssessment>}
 */
export async function assessStateIntegrity(root) {
  const paths = runtimePaths(root);
  const state = await readJson(paths.state);
  const events = await readJsonLines(paths.ledger);
  return evaluateStateIntegrity(root, state, events);
}

/**
 * Assessment that never throws; used by reporting surfaces (status, MCP, plain brief).
 * @param {string} root
 * @returns {Promise<IntegrityAssessment>}
 */
export async function assessStateIntegritySafe(root) {
  try {
    return await assessStateIntegrity(root);
  } catch (error) {
    return assessment('TAMPERED', `state integrity could not be read: ${error instanceof Error ? error.message : String(error)}`, null);
  }
}

/**
 * One bounded line for the plain brief and CLI status.
 * @param {IntegrityAssessment} value
 * @returns {string}
 */
export function integritySummaryLine(value) {
  if (value.level === 'VERIFIED') return 'State integrity verified against the ledger.';
  if (value.level === 'UNVERIFIED_LEGACY') return 'State integrity unverified (legacy state written before v1.10).';
  return `State integrity broken: ${value.reason}.`;
}

/**
 * Derived BLOCKER shown by reporting surfaces when the state is TAMPERED. It is never
 * persisted into issues.json: it exists only as long as the tampering does.
 * @param {IntegrityAssessment} value
 * @returns {Record<string, any>}
 */
export function stateIntegrityIssue(value) {
  const now = new Date().toISOString();
  return {
    id: 'ISSUE-STATE-INTEGRITY',
    title: 'Release state file does not match the proven release history',
    description: `${value.reason}. Restore .shipping/state.json from trusted history before running any command.`,
    classification: 'BLOCKER',
    requestedClassification: 'BLOCKER',
    basisId: 'false-user-state',
    evidenceRef: '.shipping/ledger.jsonl',
    source: 'state-integrity',
    runId: null,
    path: '.shipping/state.json',
    createdAt: now,
    updatedAt: now,
    derived: true,
    diagnostics: [`expected=${String(value.expected)}`, `observed=${String(value.observed)}`],
  };
}
