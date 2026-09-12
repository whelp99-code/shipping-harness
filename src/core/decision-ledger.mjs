import { appendFile, open, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { assertContainedPath, ensureDir, exists, readText } from './fs.mjs';
import { runtimePaths } from './paths.mjs';

const SCHEMA = 'shipping-harness/decision-ledger-event-v1';
const EVENT_TYPES = new Set([
  'discovery.created',
  'discovery.refined',
  'question.resolved',
  'direction.ready',
  'direction.accepted',
  'direction.superseded',
  'replan.triggered',
]);
const MAX_EVENTS = 256;
const MAX_BYTES = 1024 * 1024;
const MAX_DETAILS_BYTES = 16 * 1024;
const LOCK_ATTEMPTS = 100;

function eventHash(event) {
  const { hash: _hash, ...body } = event;
  return hashObject(body);
}

/** @param {unknown} value @param {string} label @param {number} [max] @param {boolean} [nullable] */
function bounded(value, label, max = 2000, nullable = false) {
  if ((value === undefined || value === null || value === '') && nullable) return null;
  const result = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(result.length > 0 && result.length <= max, 'ERR_DECISION_LEDGER', `${label} must be between 1 and ${max} characters`);
  return result;
}

/** @param {unknown} value @param {string} label @param {number} length */
function exactHash(value, label, length) {
  const text = bounded(value, label, length);
  invariant(typeof text === 'string' && new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(text), 'ERR_DECISION_LEDGER', `${label} must be lowercase hexadecimal`);
  return text;
}

function eventKey(input) {
  return hashObject({
    proposalId: input.proposalId,
    proposalRevision: input.proposalRevision,
    proposalHash: input.proposalHash,
    type: input.type,
    questionId: input.questionId ?? null,
    directionHash: input.directionHash ?? null,
    choice: input.choice ?? null,
    discoveryHash: input.discoveryHash ?? null,
  });
}

/** @param {Record<string, any>} event @param {Record<string, any> | null} [previous] */
export function validateDecisionLedgerEvent(event, previous = null) {
  invariant(event?.schema === SCHEMA, 'ERR_DECISION_LEDGER_SCHEMA', 'Unsupported decision-ledger event schema');
  invariant(Number.isInteger(event.sequence) && event.sequence >= 1, 'ERR_DECISION_LEDGER_SEQUENCE', 'Decision-ledger sequence must be a positive integer');
  invariant(EVENT_TYPES.has(event.type), 'ERR_DECISION_LEDGER_TYPE', `Unsupported decision-ledger event type: ${String(event.type)}`);
  invariant(typeof event.proposalId === 'string' && /^[A-Za-z0-9._-]+$/u.test(event.proposalId), 'ERR_DECISION_LEDGER_PROPOSAL', 'Invalid decision-ledger proposal ID');
  invariant(Number.isInteger(event.proposalRevision) && event.proposalRevision >= 1, 'ERR_DECISION_LEDGER_PROPOSAL', 'Invalid decision-ledger proposal revision');
  exactHash(event.proposalHash, 'proposal hash', 64);
  exactHash(event.gitSha, 'Git SHA', 40);
  exactHash(event.discoveryHash, 'discovery hash', 64);
  invariant(event.directionHash === null || /^[a-f0-9]{64}$/u.test(event.directionHash), 'ERR_DECISION_LEDGER_DIRECTION', 'Invalid direction hash');
  invariant(event.previousHash === null || /^[a-f0-9]{64}$/u.test(event.previousHash), 'ERR_DECISION_LEDGER_CHAIN', 'Invalid previous event hash');
  invariant(event.eventKey && /^[a-f0-9]{64}$/u.test(event.eventKey), 'ERR_DECISION_LEDGER_REPLAY', 'Invalid decision-ledger event key');
  invariant(event.modelAuthority === false, 'ERR_DECISION_LEDGER_AUTHORITY', 'Host model cannot be decision-ledger authority');
  invariant(event.released === false, 'ERR_DECISION_LEDGER_RELEASED', 'Decision ledger cannot mark RELEASED');
  invariant(event.hash === eventHash(event), 'ERR_DECISION_LEDGER_HASH', 'Decision-ledger event hash does not match its content');
  invariant(Buffer.byteLength(stableStringify(event.details ?? {})) <= MAX_DETAILS_BYTES, 'ERR_DECISION_LEDGER_SIZE', 'Decision-ledger details exceed the bounded size');
  if (previous) {
    invariant(event.sequence === previous.sequence + 1, 'ERR_DECISION_LEDGER_SEQUENCE', 'Decision-ledger sequence has a gap');
    invariant(event.previousHash === previous.hash, 'ERR_DECISION_LEDGER_CHAIN', 'Decision-ledger hash chain is broken');
  } else {
    invariant(event.sequence === 1 && event.previousHash === null, 'ERR_DECISION_LEDGER_CHAIN', 'Decision ledger must start at sequence 1');
  }
  return event;
}

async function snapshot(root) {
  const target = runtimePaths(root).decisionLedger;
  if (!(await exists(target))) return { events: [], bytes: 0 };
  await assertContainedPath(root, target);
  const raw = await readText(target);
  const bytes = Buffer.byteLength(raw, 'utf8');
  invariant(bytes <= MAX_BYTES, 'ERR_DECISION_LEDGER_RETENTION', `Decision ledger exceeds ${MAX_BYTES} bytes`);
  const lines = raw.split('\n').filter(Boolean);
  invariant(lines.length <= MAX_EVENTS, 'ERR_DECISION_LEDGER_RETENTION', `Decision ledger exceeds ${MAX_EVENTS} events`);
  const events = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      // A corrupted ledger line must fail closed rather than be silently skipped, since the ledger is append-only evidence.
      throw Object.assign(new Error('Decision ledger contains invalid JSON'), { code: 'ERR_DECISION_LEDGER_PARSE' });
    }
  });
  let previous = null;
  const keys = new Set();
  for (const event of events) {
    validateDecisionLedgerEvent(event, previous);
    invariant(!keys.has(event.eventKey), 'ERR_DECISION_LEDGER_REPLAY', 'Decision ledger contains a replayed event key');
    keys.add(event.eventKey);
    previous = event;
  }
  return { events, bytes };
}

/**
 * @param {*} root
 * @returns {Promise<*>}
 */
export async function readDecisionLedger(root) {
  return (await snapshot(root)).events;
}

async function withLedgerLock(root, operation) {
  const paths = runtimePaths(root);
  await ensureDir(paths.directory);
  await assertContainedPath(root, paths.decisionLedgerLock);
  let handle;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(paths.decisionLedgerLock, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
      break;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
      await delay(10);
    }
  }
  invariant(handle, 'ERR_DECISION_LEDGER_BUSY', 'Another decision-ledger operation is active');
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await rm(paths.decisionLedgerLock, { force: true }).catch(() => {});
  }
}

/**
 * @param {*} root
 * @param {*} input
 * @returns {Promise<*>}
 */
export async function appendDecisionLedgerEvent(root, input) {
  return withLedgerLock(root, async () => {
    invariant(EVENT_TYPES.has(input.type), 'ERR_DECISION_LEDGER_TYPE', `Unsupported decision-ledger event type: ${String(input.type)}`);
    const current = await snapshot(root);
    const key = eventKey(input);
    const duplicate = current.events.find((entry) => entry.eventKey === key);
    if (duplicate) return { event: duplicate, duplicate: true };
    invariant(current.events.length < MAX_EVENTS, 'ERR_DECISION_LEDGER_RETENTION', `Decision ledger reached ${MAX_EVENTS} events`);
    const previous = current.events.at(-1) ?? null;
    const body = {
      schema: SCHEMA,
      sequence: (previous?.sequence ?? 0) + 1,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
      proposalId: bounded(input.proposalId, 'proposal ID', 160),
      proposalRevision: input.proposalRevision,
      proposalHash: exactHash(input.proposalHash, 'proposal hash', 64),
      gitSha: exactHash(input.gitSha, 'Git SHA', 40),
      type: input.type,
      questionId: bounded(input.questionId, 'question ID', 80, true),
      directionHash: input.directionHash ? exactHash(input.directionHash, 'direction hash', 64) : null,
      discoveryHash: exactHash(input.discoveryHash, 'discovery hash', 64),
      choice: bounded(input.choice, 'choice', 2000, true),
      provenance: bounded(input.provenance ?? 'mechanical', 'provenance', 80),
      evidenceRefs: [...new Set((input.evidenceRefs ?? []).map((entry) => bounded(entry, 'evidence reference', 200)))].slice(0, 16),
      details: input.details && typeof input.details === 'object' && !Array.isArray(input.details) ? input.details : {},
      eventKey: key,
      previousHash: previous?.hash ?? null,
      modelAuthority: false,
      released: false,
    };
    const event = { ...body, hash: hashObject(body) };
    validateDecisionLedgerEvent(event, previous);
    const line = `${JSON.stringify(event)}\n`;
    invariant(current.bytes + Buffer.byteLength(line, 'utf8') <= MAX_BYTES, 'ERR_DECISION_LEDGER_RETENTION', `Decision ledger reached ${MAX_BYTES} bytes`);
    const target = runtimePaths(root).decisionLedger;
    await assertContainedPath(root, target);
    await appendFile(target, line, { encoding: 'utf8', mode: 0o600 });
    return { event, duplicate: false };
  });
}

/**
 * @param {*} root
 * @param {*} proposalId
 * @returns {Promise<*>}
 */
export async function decisionLedgerSummary(root, proposalId = null) {
  const events = await readDecisionLedger(root);
  const filtered = proposalId ? events.filter((entry) => entry.proposalId === proposalId) : events;
  const last = filtered.at(-1) ?? null;
  return {
    schema: 'shipping-harness/decision-ledger-summary-v1',
    eventCount: filtered.length,
    lastSequence: last?.sequence ?? 0,
    lastHash: last?.hash ?? null,
    lastType: last?.type ?? null,
    acceptedDirectionHash: [...filtered].reverse().find((entry) => entry.type === 'direction.accepted')?.directionHash ?? null,
    modelAuthority: false,
    released: false,
    bounded: { maxEvents: MAX_EVENTS, maxBytes: MAX_BYTES },
  };
}

export const DECISION_LEDGER = Object.freeze({
  schema: SCHEMA,
  eventTypes: [...EVENT_TYPES],
  maxEvents: MAX_EVENTS,
  maxBytes: MAX_BYTES,
  maxDetailsBytes: MAX_DETAILS_BYTES,
});
