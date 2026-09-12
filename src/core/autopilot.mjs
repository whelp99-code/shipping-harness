import { appendFile, open, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { assertLockedContract } from './contract.mjs';
import { hashObject } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { assertContainedPath, exists, readJson, readText, writeJsonAtomic } from './fs.mjs';
import { currentGitSha } from './git.mjs';
import { runtimePaths } from './paths.mjs';
import { loadApprovedReleaseTrain, validateReleaseTrain } from './release-train.mjs';
import {
  autopilotPolicySummary,
  compileAutopilotPolicy,
  decideAutopilot,
  validateAutopilotDecision,
  validateAutopilotPolicy,
} from './autopilot-policy.mjs';

const AUTOPILOT_STATE_SCHEMA = 'shipping-harness/autopilot-state-v1';
const AUTOPILOT_EVENT_SCHEMA = 'shipping-harness/autopilot-event-v1';
const AUTOPILOT_MUTATION_SCHEMA = 'shipping-harness/autopilot-mutation-v1';
const PHASES = Object.freeze([
  'POLICY_READY',
  'TRAIN_READY',
  'RELEASE_PREPARING',
  'BASELINE_PRESERVING',
  'CONTRACT_ACTIVATING',
  'IMPLEMENTING',
  'VERIFYING',
  'FIXING_BLOCKERS',
  'SHIPPABLE',
  'CLOSING',
  'RELEASE_CLOSED',
  'REPLAN_CHECK',
  'NEXT_RELEASE',
  'TRAIN_COMPLETE',
  'PAUSED',
  'ASKING',
  'REPLAN_REQUIRED',
  'STOPPED',
  'ABORTED',
]);
const TERMINAL_PHASES = new Set(['TRAIN_COMPLETE', 'ABORTED']);
const AUTOPILOT_LOCK_ATTEMPTS = 100;
const MAX_AUTOPILOT_LEDGER_EVENTS = 512;
const MAX_AUTOPILOT_LEDGER_BYTES = 2 * 1024 * 1024;

function stateHash(state) {
  const { hash: _hash, ...body } = state;
  return hashObject(body);
}

function eventHash(event) {
  const { hash: _hash, ...body } = event;
  return hashObject(body);
}

function mutationHash(receipt) {
  const { hash: _hash, ...body } = receipt;
  return hashObject(body);
}

function boundedText(value, label, max = 500) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(text.length > 0 && text.length <= max, 'ERR_AUTOPILOT_STATE', `${label} must be between 1 and ${max} characters`);
  return text;
}

function exactHash(value, label, length) {
  const text = boundedText(value, label, length);
  invariant(new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(text), 'ERR_AUTOPILOT_STATE', `${label} must be lowercase hexadecimal`);
  return text;
}

async function withAutopilotLock(root, operation) {
  const lockPath = runtimePaths(root).autopilotLock;
  await assertContainedPath(root, lockPath);
  let handle;
  for (let attempt = 0; attempt < AUTOPILOT_LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
      break;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
      await delay(10);
    }
  }
  invariant(handle, 'ERR_AUTOPILOT_BUSY', 'Another autopilot operation is still active');
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

/** @param {Record<string,any>} state */
export function validateAutopilotState(state) {
  invariant(state?.schema === AUTOPILOT_STATE_SCHEMA, 'ERR_AUTOPILOT_STATE_SCHEMA', 'Unsupported autopilot state schema');
  invariant(PHASES.includes(state.phase), 'ERR_AUTOPILOT_PHASE', `Unsupported autopilot phase: ${String(state.phase)}`);
  invariant(Number.isInteger(state.sequence) && state.sequence >= 1, 'ERR_AUTOPILOT_SEQUENCE', 'Autopilot sequence must be a positive integer');
  exactHash(state.policyHash, 'policy hash', 64);
  exactHash(state.releaseTrainHash, 'release train hash', 64);
  exactHash(state.baselineSha, 'baseline SHA', 40);
  invariant(state.released === false, 'ERR_AUTOPILOT_RELEASED', 'Autopilot state can never be RELEASED');
  invariant(state.modelAuthority === false, 'ERR_AUTOPILOT_AUTHORITY', 'Host model cannot be autopilot authority');
  invariant(state.lastEventHash === null || /^[a-f0-9]{64}$/u.test(state.lastEventHash), 'ERR_AUTOPILOT_STATE', 'Invalid last event hash');
  invariant(state.lastDecisionHash === null || /^[a-f0-9]{64}$/u.test(state.lastDecisionHash), 'ERR_AUTOPILOT_STATE', 'Invalid last decision hash');
  invariant(state.hash === stateHash(state), 'ERR_AUTOPILOT_STATE_HASH', 'Autopilot state hash does not match its content');
  return state;
}

function createEvent(state, input) {
  const body = {
    schema: AUTOPILOT_EVENT_SCHEMA,
    sequence: state ? state.sequence + 1 : 1,
    previousHash: state?.lastEventHash ?? null,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    type: boundedText(input.type, 'autopilot event type', 120),
    policyHash: exactHash(input.policyHash, 'policy hash', 64),
    releaseTrainHash: exactHash(input.releaseTrainHash, 'release train hash', 64),
    release: boundedText(input.release, 'release', 80),
    action: input.action ?? null,
    decision: input.decision ?? null,
    decisionHash: input.decisionHash ?? null,
    phase: boundedText(input.phase, 'autopilot phase', 80),
    details: input.details ?? {},
    released: false,
  };
  invariant(PHASES.includes(body.phase), 'ERR_AUTOPILOT_PHASE', `Unsupported autopilot event phase: ${body.phase}`);
  return { ...body, hash: hashObject(body) };
}

/** @param {Record<string, any>} event @param {Record<string, any> | null} [previous] */
function validateAutopilotEvent(event, previous = null) {
  invariant(event?.schema === AUTOPILOT_EVENT_SCHEMA, 'ERR_AUTOPILOT_EVENT_SCHEMA', 'Unsupported autopilot event schema');
  invariant(event.sequence === (previous ? previous.sequence + 1 : 1), 'ERR_AUTOPILOT_SEQUENCE', 'Autopilot ledger sequence is not contiguous');
  invariant(event.previousHash === (previous?.hash ?? null), 'ERR_AUTOPILOT_LEDGER_HASH', 'Autopilot ledger previous hash is invalid');
  invariant(event.released === false, 'ERR_AUTOPILOT_RELEASED', 'Autopilot ledger cannot mark RELEASED');
  invariant(event.hash === eventHash(event), 'ERR_AUTOPILOT_LEDGER_HASH', 'Autopilot event hash does not match its content');
  return event;
}

async function readAutopilotLedgerSnapshot(root) {
  const target = runtimePaths(root).autopilotLedger;
  if (!(await exists(target))) return { events: [], bytes: 0 };
  await assertContainedPath(root, target);
  const text = await readText(target);
  const bytes = Buffer.byteLength(text, 'utf8');
  invariant(bytes <= MAX_AUTOPILOT_LEDGER_BYTES, 'ERR_AUTOPILOT_RETENTION', `Autopilot ledger exceeds ${MAX_AUTOPILOT_LEDGER_BYTES} bytes`);
  const lines = text.split('\n').filter(Boolean);
  invariant(lines.length <= MAX_AUTOPILOT_LEDGER_EVENTS, 'ERR_AUTOPILOT_RETENTION', `Autopilot ledger exceeds ${MAX_AUTOPILOT_LEDGER_EVENTS} events`);
  const events = lines.map((line) => JSON.parse(line));
  let previous = null;
  for (const event of events) {
    validateAutopilotEvent(event, previous);
    previous = event;
  }
  return { events, bytes };
}

/**
 * @param {*} root
 * @returns {Promise<*>}
 */
export async function readAutopilotLedger(root) {
  return (await readAutopilotLedgerSnapshot(root)).events;
}

async function appendEvent(root, event) {
  const target = runtimePaths(root).autopilotLedger;
  await assertContainedPath(root, target);
  const snapshot = await readAutopilotLedgerSnapshot(root);
  const line = `${JSON.stringify(event)}\n`;
  invariant(snapshot.events.length < MAX_AUTOPILOT_LEDGER_EVENTS, 'ERR_AUTOPILOT_RETENTION', `Autopilot ledger reached ${MAX_AUTOPILOT_LEDGER_EVENTS} events`);
  invariant(snapshot.bytes + Buffer.byteLength(line, 'utf8') <= MAX_AUTOPILOT_LEDGER_BYTES, 'ERR_AUTOPILOT_RETENTION', `Autopilot ledger reached ${MAX_AUTOPILOT_LEDGER_BYTES} bytes`);
  await appendFile(target, line, { encoding: 'utf8', mode: 0o600 });
}

async function writeState(root, body) {
  const state = { ...body, hash: stateHash(body) };
  validateAutopilotState(state);
  await writeJsonAtomic(runtimePaths(root).autopilotState, state);
  return state;
}

/**
 * @param {*} root
 * @returns {Promise<*>}
 */
export async function loadAutopilotPolicy(root) {
  const target = runtimePaths(root).autopilotPolicy;
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  return validateAutopilotPolicy(await readJson(target));
}

/**
 * @param {*} root
 * @returns {Promise<*>}
 */
export async function loadAutopilotState(root) {
  const target = runtimePaths(root).autopilotState;
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  return validateAutopilotState(await readJson(target));
}

/**
 * Activate a policy that was explicitly approved together with the exact proposal and train.
 * @param {string} root
 * @param {{profile:string,proposalId:string,proposalHash:string,contractHash:string,baselineSha:string,releaseTrain:Record<string,any>,approvedAt:string,limits?:Record<string,number>}} input
 */
export async function activateAutopilot(root, input) {
  return withAutopilotLock(root, async () => {
    validateReleaseTrain(input.releaseTrain);
    const policy = compileAutopilotPolicy({
      profile: input.profile,
      proposalId: input.proposalId,
      proposalHash: input.proposalHash,
      contractHash: input.contractHash,
      baselineSha: input.baselineSha,
      releaseTrainHash: input.releaseTrain.hash,
      approvedAt: input.approvedAt,
      limits: input.limits,
    });
    const existingPolicy = await loadAutopilotPolicy(root);
    const existingState = await loadAutopilotState(root);
    if (existingPolicy?.hash === policy.hash && existingState?.policyHash === policy.hash) {
      return { policy: existingPolicy, state: existingState, reused: true };
    }
    invariant(!existingState || TERMINAL_PHASES.has(existingState.phase), 'ERR_AUTOPILOT_ACTIVE', 'A different autopilot policy is already active');
    const now = new Date().toISOString();
    const event = createEvent(null, {
      occurredAt: now,
      type: 'autopilot.activated',
      policyHash: policy.hash,
      releaseTrainHash: input.releaseTrain.hash,
      release: input.releaseTrain.currentRelease,
      phase: policy.enabled ? 'TRAIN_READY' : 'POLICY_READY',
      details: { profile: policy.profile, proposalId: input.proposalId },
    });
    const body = {
      schema: AUTOPILOT_STATE_SCHEMA,
      enabled: policy.enabled,
      profile: policy.profile,
      modelAuthority: false,
      policyHash: policy.hash,
      releaseTrainHash: input.releaseTrain.hash,
      currentRelease: input.releaseTrain.currentRelease,
      currentIndex: input.releaseTrain.currentIndex ?? 0,
      phase: event.phase,
      resumePhase: null,
      sequence: event.sequence,
      lastEventHash: event.hash,
      lastDecisionHash: null,
      lastAction: null,
      lastDecision: null,
      replanRequired: false,
      released: false,
      baselineSha: input.baselineSha,
      startedAt: now,
      updatedAt: now,
    };
    await writeJsonAtomic(runtimePaths(root).autopilotPolicy, policy);
    await appendEvent(root, event);
    const state = await writeState(root, body);
    return { policy, state, reused: false };
  });
}

/**
 * @param {*} root
 * @returns {Promise<*>}
 */
export async function assertAutopilotBindingCurrent(root) {
  const policy = await loadAutopilotPolicy(root);
  const state = await loadAutopilotState(root);
  if (!policy || !state) return { current: false, reason: 'NO_AUTOPILOT_POLICY', policy, state, train: null };
  const trainEnvelope = await loadApprovedReleaseTrain(root);
  if (!trainEnvelope) return { current: false, reason: 'NO_APPROVED_RELEASE_TRAIN', policy, state, train: null };
  let locked;
  try {
    locked = await assertLockedContract(root);
  } catch {
    // No locked contract (DRAFT/CLOSED) is a normal state here, not a failure; report it through the reason field.
    return { current: false, reason: 'NO_CURRENT_LOCKED_CONTRACT', policy, state, train: trainEnvelope.train };
  }
  const current = policy.binding.contractHash === locked.lock.contractHash
    && policy.binding.baselineSha === locked.lock.baselineSha
    && policy.binding.releaseTrainHash === trainEnvelope.train.hash
    && state.policyHash === policy.hash
    && state.releaseTrainHash === trainEnvelope.train.hash
    && state.currentRelease === locked.contract.release;
  return {
    current,
    reason: current ? 'CURRENT' : 'BINDING_MISMATCH',
    policy,
    state,
    train: trainEnvelope.train,
    contract: locked.contract,
    lock: locked.lock,
  };
}

/**
 * @param {*} root
 * @param {*} decisionInput
 * @param {*} patch
 * @returns {Promise<*>}
 */
export async function recordAutopilotDecision(root, decisionInput, patch = {}) {
  return withAutopilotLock(root, async () => {
    const decision = validateAutopilotDecision(decisionInput);
    const policy = await loadAutopilotPolicy(root);
    const state = await loadAutopilotState(root);
    invariant(policy && state, 'ERR_AUTOPILOT_INACTIVE', 'No autopilot policy is active');
    invariant(decision.policyHash === policy.hash && state.policyHash === policy.hash, 'ERR_AUTOPILOT_POLICY_BINDING', 'Decision belongs to a different policy');
    const phase = patch.phase ?? decision.nextState;
    if (state.lastDecisionHash === decision.hash && state.phase === phase) return { state, duplicate: true, event: null };
    invariant(!TERMINAL_PHASES.has(state.phase), 'ERR_AUTOPILOT_TERMINAL', `Autopilot cannot continue from ${state.phase}`);
    const now = new Date().toISOString();
    const event = createEvent(state, {
      occurredAt: now,
      type: patch.type ?? 'autopilot.decision',
      policyHash: policy.hash,
      releaseTrainHash: state.releaseTrainHash,
      release: patch.currentRelease ?? state.currentRelease,
      action: decision.action,
      decision: decision.decision,
      decisionHash: decision.hash,
      phase,
      details: { code: decision.code, reasons: decision.reasons, ...(patch.details ?? {}) },
    });
    await appendEvent(root, event);
    const next = await writeState(root, {
      ...state,
      currentRelease: patch.currentRelease ?? state.currentRelease,
      currentIndex: Number.isInteger(patch.currentIndex) ? patch.currentIndex : state.currentIndex,
      phase,
      resumePhase: patch.resumePhase ?? (phase === 'PAUSED' ? state.phase : phase === 'ABORTED' ? null : state.resumePhase),
      sequence: event.sequence,
      lastEventHash: event.hash,
      lastDecisionHash: decision.hash,
      lastAction: decision.action,
      lastDecision: decision.decision,
      replanRequired: patch.replanRequired ?? (phase === 'REPLAN_REQUIRED'),
      released: false,
      updatedAt: now,
    });
    return { state: next, duplicate: false, event };
  });
}

/**
 * @param {*} root
 * @param {*} input
 * @returns {Promise<*>}
 */
export async function evaluateAutopilotAction(root, input) {
  const binding = await assertAutopilotBindingCurrent(root);
  invariant(binding.policy && binding.state, 'ERR_AUTOPILOT_INACTIVE', 'No autopilot policy is active');
  const decision = decideAutopilot(binding.policy, {
    ...input,
    policyBindingCurrent: binding.current,
    humanStop: input.humanStop ?? false,
    fixCycles: input.fixCycles ?? 0,
    maxFixCycles: input.maxFixCycles ?? binding.policy.limits.maxFixCycles,
  });
  if (binding.state.phase === 'PAUSED' && decision.decision === 'STOP' && decision.code === 'HUMAN_STOP') {
    return { ...binding, decision, recorded: { state: binding.state, duplicate: true, event: null, preservedHumanPause: true } };
  }
  const recorded = await recordAutopilotDecision(root, decision, input.statePatch ?? {});
  return { ...binding, decision, recorded };
}

/** @param {string} root @param {string} action @param {string | null} [reason] */
export async function setAutopilotHumanControl(root, action, reason = null) {
  const policy = await loadAutopilotPolicy(root);
  const state = await loadAutopilotState(root);
  if (!policy || !state) return null;
  return withAutopilotLock(root, async () => {
    const current = await loadAutopilotState(root);
    invariant(current, 'ERR_AUTOPILOT_INACTIVE', 'No autopilot state exists');
    const normalized = boundedText(action, 'human control action', 20).toLowerCase();
    invariant(['pause', 'resume', 'abort'].includes(normalized), 'ERR_AUTOPILOT_CONTROL', `Unsupported human control action: ${normalized}`);
    const phase = normalized === 'pause' ? 'PAUSED' : normalized === 'abort' ? 'ABORTED' : (current.resumePhase ?? 'TRAIN_READY');
    if ((normalized === 'pause' && current.phase === 'PAUSED') || (normalized === 'abort' && current.phase === 'ABORTED')) return { state: current, duplicate: true };
    invariant(normalized !== 'resume' || current.phase === 'PAUSED', 'ERR_AUTOPILOT_CONTROL', 'Autopilot can resume only from PAUSED');
    const now = new Date().toISOString();
    const event = createEvent(current, {
      occurredAt: now,
      type: `human.${normalized}`,
      policyHash: policy.hash,
      releaseTrainHash: current.releaseTrainHash,
      release: current.currentRelease,
      phase,
      details: { reason: typeof reason === 'string' ? reason.slice(0, 500) : null },
    });
    await appendEvent(root, event);
    const next = await writeState(root, {
      ...current,
      phase,
      resumePhase: normalized === 'pause' ? current.phase : normalized === 'resume' || normalized === 'abort' ? null : current.resumePhase,
      sequence: event.sequence,
      lastEventHash: event.hash,
      replanRequired: current.replanRequired,
      released: false,
      updatedAt: now,
    });
    return { state: next, duplicate: false, event };
  });
}

function passingText(manifest) {
  return (manifest?.results ?? [])
    .filter((entry) => entry.status === 'PASS')
    .map((entry) => `${entry.criterionId} ${entry.description} ${entry.command}`.toLowerCase())
    .join(' ');
}

function criterionProven(criterion, context) {
  const proof = criterion.proofClass;
  if (proof === 'CURRENT_ACCEPTANCE') return context.acceptancePassed;
  if (proof === 'ACCEPTANCE_COVERAGE') return context.acceptancePassed && context.currentRelease.acceptance.exactCommands.length > 0;
  if (proof === 'BASELINE_RECEIPT') return Boolean(context.train.source.baselinePlanHash || context.policy.binding.baselineSha);
  if (proof === 'USER_FLOW') return context.acceptancePassed && /e2e|end[- ]to[- ]end|user flow|workflow|smoke|pilot|integration|acceptance/u.test(context.passingText);
  if (proof === 'OPERATIONS_SMOKE') return context.acceptancePassed && /install|doctor|health|ready|smoke|start|run|operation|recovery/u.test(context.passingText);
  if (proof === 'ROLLBACK') return context.rollbackAvailable && (/rollback|restore|backup|recovery/u.test(context.passingText) || Boolean(context.policy.binding.baselineSha));
  if (proof === 'FIELD_PILOT') return context.acceptancePassed && /pilot|field|smoke|e2e|end[- ]to[- ]end/u.test(context.passingText);
  if (proof === 'ADVERSARIAL_METRIC') return context.acceptancePassed && /adversarial|attack|security|false|hostile/u.test(context.passingText);
  return false;
}

/**
 * @param {*} input
 * @returns {*}
 */
export function deriveAutopilotClosureFacts(input) {
  const { policy, train, verification } = input;
  validateAutopilotPolicy(policy);
  validateReleaseTrain(train);
  const currentRelease = train.releases[train.currentIndex ?? 0];
  const acceptancePassed = verification?.manifest?.summary?.requiredFailed === 0
    && verification?.manifest?.summary?.total > 0
    && verification?.decision === 'SHIPPABLE';
  const rollbackAvailable = currentRelease?.rollback?.required === true
    && currentRelease.rollback.evidenceRequired === true
    && /^[a-f0-9]{40}$/u.test(policy.binding.baselineSha);
  const context = {
    policy,
    train,
    currentRelease,
    acceptancePassed,
    rollbackAvailable,
    passingText: passingText(verification?.manifest),
  };
  const criteria = (currentRelease?.valueGate?.criteria ?? []).map((criterion) => ({
    code: criterion.code,
    proofClass: criterion.proofClass,
    proven: criterionProven(criterion, context),
  }));
  const valueGateProven = criteria.length > 0 && criteria.every((entry) => entry.proven);
  return {
    action: 'CLOSE',
    effects: ['LOCAL_REVERSIBLE'],
    localOnly: true,
    exactScope: (verification?.scope?.violations ?? []).length === 0,
    rollbackAvailable,
    valueGateProven,
    valueEvidence: criteria,
    acceptancePassed,
    evidenceFresh: verification?.state?.currentEvidenceSha === verification?.manifest?.gitSha,
    blockerCount: verification?.issues?.counts?.BLOCKER ?? verification?.state?.blockerCount ?? 0,
    unknownCount: verification?.issues?.counts?.UNKNOWN ?? verification?.state?.unknownCount ?? 0,
    scopeDrift: verification?.scope?.violations?.length ?? 0,
    releaseState: verification?.state?.state ?? verification?.decision ?? null,
  };
}

/**
 * @param {*} root
 * @param {*} closeResult
 * @param {*} decision
 * @returns {Promise<*>}
 */
export async function completeAutopilotClosure(root, closeResult, decision) {
  validateAutopilotDecision(decision);
  return recordAutopilotDecision(root, decision, {
    type: 'autopilot.release-closed',
    phase: 'RELEASE_CLOSED',
    replanRequired: true,
    details: {
      release: closeResult.receipt.release,
      receipt: path.relative(root, closeResult.receiptPath).replaceAll('\\', '/'),
      closedGitSha: closeResult.receipt.closedGitSha,
      released: false,
    },
  });
}

/**
 * @param {*} root
 * @param {*} input
 * @returns {Promise<*>}
 */
export async function rotateAutopilotPolicy(root, input) {
  return withAutopilotLock(root, async () => {
    const currentPolicy = await loadAutopilotPolicy(root);
    const currentState = await loadAutopilotState(root);
    invariant(currentPolicy && currentState, 'ERR_AUTOPILOT_INACTIVE', 'No prior autopilot policy exists');
    validateAutopilotDecision(input.authorization);
    invariant(input.authorization.policyHash === currentPolicy.hash, 'ERR_AUTOPILOT_POLICY_BINDING', 'Advance authorization belongs to a different policy');
    invariant(input.authorization.action === 'ADVANCE_RELEASE' && input.authorization.allowed === true, 'ERR_AUTOPILOT_ADVANCE', 'Policy did not authorize release-train advancement');
    invariant(currentState.phase === 'RELEASE_CLOSED' || currentState.phase === 'REPLAN_CHECK', 'ERR_AUTOPILOT_ADVANCE', `Autopilot cannot advance from ${currentState.phase}`);
    validateReleaseTrain(input.previousTrain);
    validateReleaseTrain(input.releaseTrain);
    const expectedNext = input.previousTrain.releases[(currentState.currentIndex ?? 0) + 1] ?? null;
    invariant(expectedNext && expectedNext.version === input.releaseTrain.currentRelease, 'ERR_AUTOPILOT_ADVANCE', 'Replanned release does not match the next advisory train version');
    const policy = compileAutopilotPolicy({
      profile: currentPolicy.profile,
      proposalId: input.proposalId,
      proposalHash: input.proposalHash,
      contractHash: input.contractHash,
      baselineSha: input.baselineSha,
      releaseTrainHash: input.releaseTrain.hash,
      approvedAt: input.approvedAt,
      limits: currentPolicy.limits,
    });
    const archive = {
      schema: 'shipping-harness/autopilot-release-archive-v1',
      release: currentState.currentRelease,
      policy: currentPolicy,
      state: currentState,
      releaseTrain: input.previousTrain,
      archivedAt: new Date().toISOString(),
      released: false,
    };
    archive.hash = hashObject(archive);
    await writeJsonAtomic(path.join(runtimePaths(root).releases, `${currentState.currentRelease}-autopilot.json`), archive);
    const now = new Date().toISOString();
    const event = createEvent(currentState, {
      occurredAt: now,
      type: 'autopilot.policy-rotated',
      policyHash: policy.hash,
      releaseTrainHash: input.releaseTrain.hash,
      release: input.releaseTrain.currentRelease,
      action: 'ADVANCE_RELEASE',
      decision: input.authorization.decision,
      decisionHash: input.authorization.hash,
      phase: 'TRAIN_READY',
      details: { previousPolicyHash: currentPolicy.hash, previousRelease: currentState.currentRelease, proposalId: input.proposalId },
    });
    await writeJsonAtomic(runtimePaths(root).autopilotPolicy, policy);
    await appendEvent(root, event);
    const state = await writeState(root, {
      ...currentState,
      enabled: policy.enabled,
      profile: policy.profile,
      policyHash: policy.hash,
      releaseTrainHash: input.releaseTrain.hash,
      currentRelease: input.releaseTrain.currentRelease,
      currentIndex: 0,
      phase: 'TRAIN_READY',
      resumePhase: null,
      sequence: event.sequence,
      lastEventHash: event.hash,
      lastDecisionHash: input.authorization.hash,
      lastAction: 'ADVANCE_RELEASE',
      lastDecision: input.authorization.decision,
      replanRequired: false,
      released: false,
      baselineSha: input.baselineSha,
      updatedAt: now,
    });
    return { policy, state, archive };
  });
}

/**
 * @param {*} root
 * @param {*} closeResult
 * @returns {Promise<*>}
 */
export async function completeManualAutopilotClosure(root, closeResult) {
  const policy = await loadAutopilotPolicy(root);
  const state = await loadAutopilotState(root);
  if (!policy || !state) return null;
  return withAutopilotLock(root, async () => {
    const current = await loadAutopilotState(root);
    invariant(current, 'ERR_AUTOPILOT_STATE_MISSING', 'Autopilot state disappeared while awaiting the lock');
    if (current.phase === 'RELEASE_CLOSED' && current.currentRelease === closeResult.receipt.release) return { state: current, duplicate: true };
    const now = new Date().toISOString();
    const event = createEvent(current, {
      occurredAt: now,
      type: 'human.release-closed',
      policyHash: policy.hash,
      releaseTrainHash: current.releaseTrainHash,
      release: closeResult.receipt.release,
      action: 'CLOSE',
      decision: 'ASK',
      decisionHash: null,
      phase: 'RELEASE_CLOSED',
      details: { receipt: path.relative(root, closeResult.receiptPath).replaceAll('\\', '/'), closedGitSha: closeResult.receipt.closedGitSha, released: false },
    });
    await appendEvent(root, event);
    const next = await writeState(root, {
      ...current,
      currentRelease: closeResult.receipt.release,
      phase: 'RELEASE_CLOSED',
      resumePhase: null,
      sequence: event.sequence,
      lastEventHash: event.hash,
      lastAction: 'CLOSE',
      lastDecision: 'ASK',
      replanRequired: true,
      released: false,
      updatedAt: now,
    });
    return { state: next, duplicate: false, event };
  });
}

/**
 * @param {*} root
 * @param {*} input
 * @returns {Promise<*>}
 */
export async function createAutopilotMutationReceipt(root, input) {
  const binding = await assertAutopilotBindingCurrent(root);
  invariant(binding.current, 'ERR_AUTOPILOT_POLICY_BINDING', `Autopilot policy binding is not current: ${binding.reason}`);
  invariant(binding.policy && binding.contract, 'ERR_AUTOPILOT_POLICY_BINDING', 'Autopilot policy binding is missing its policy or contract');
  const action = boundedText(input.action, 'mutation action', 80).toUpperCase();
  invariant(['PRESERVE_BASELINE', 'LOCAL_COMMIT'].includes(action), 'ERR_AUTOPILOT_MUTATION', 'Only exact local baseline or commit receipts are supported');
  const paths = [...new Set((input.paths ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort();
  invariant(paths.length > 0 && paths.length <= 200, 'ERR_AUTOPILOT_MUTATION', 'Mutation receipt requires 1–200 exact paths');
  invariant(paths.every((entry) => !path.isAbsolute(entry) && !entry.startsWith('../') && !entry.includes('/../') && !entry.startsWith('.shipping/')), 'ERR_AUTOPILOT_MUTATION', 'Mutation receipt contains a forbidden path');
  const baseGitSha = exactHash(input.baseGitSha ?? currentGitSha(root), 'base Git SHA', 40);
  const decision = decideAutopilot(binding.policy, {
    action,
    effects: action === 'LOCAL_COMMIT' ? ['LOCAL_REVERSIBLE', 'FILESYSTEM_MUTATION', 'GIT_COMMIT'] : ['LOCAL_REVERSIBLE', 'FILESYSTEM_MUTATION'],
    rollbackAvailable: true,
    localOnly: true,
    exactScope: true,
    policyBindingCurrent: true,
  });
  invariant(decision.allowed, 'ERR_AUTOPILOT_MUTATION', `Policy does not authorize ${action}: ${decision.code}`);
  const now = new Date().toISOString();
  const body = {
    schema: AUTOPILOT_MUTATION_SCHEMA,
    action,
    policyHash: binding.policy.hash,
    releaseTrainHash: binding.train.hash,
    release: binding.contract.release,
    baseGitSha,
    paths,
    fileSetHash: hashObject(paths),
    purpose: boundedText(input.purpose, 'mutation purpose', 1000),
    rollbackRef: boundedText(input.rollbackRef, 'rollback reference', 1000),
    decisionHash: decision.hash,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + 15 * 60 * 1000).toISOString(),
    applied: false,
    released: false,
  };
  const receipt = { ...body, hash: hashObject(body) };
  await writeJsonAtomic(runtimePaths(root).autopilotMutation, receipt);
  return { receipt, decision };
}

/**
 * @param {*} receipt
 * @param {*} input
 * @returns {*}
 */
export function verifyAutopilotMutationReceipt(receipt, input) {
  invariant(receipt?.schema === AUTOPILOT_MUTATION_SCHEMA, 'ERR_AUTOPILOT_MUTATION_SCHEMA', 'Unsupported mutation receipt schema');
  invariant(receipt.hash === mutationHash(receipt), 'ERR_AUTOPILOT_MUTATION_HASH', 'Mutation receipt hash does not match its content');
  invariant(receipt.released === false, 'ERR_AUTOPILOT_RELEASED', 'Mutation receipt cannot mark RELEASED');
  invariant(Date.parse(receipt.expiresAt) > Date.now(), 'ERR_AUTOPILOT_MUTATION_EXPIRED', 'Mutation receipt has expired');
  const paths = [...new Set((input.paths ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort();
  invariant(hashObject(paths) === receipt.fileSetHash, 'ERR_AUTOPILOT_MUTATION_DRIFT', 'Mutation path set differs from the authorized receipt');
  invariant(input.baseGitSha === receipt.baseGitSha, 'ERR_AUTOPILOT_MUTATION_DRIFT', 'Mutation base Git SHA differs from the authorized receipt');
  invariant(input.policyHash === receipt.policyHash, 'ERR_AUTOPILOT_POLICY_BINDING', 'Mutation receipt belongs to a different policy');
  return { valid: true, action: receipt.action, paths, receiptHash: receipt.hash };
}

/**
 * @param {*} root
 * @returns {Promise<*>}
 */
export async function autopilotStatus(root) {
  const policy = await loadAutopilotPolicy(root);
  const state = await loadAutopilotState(root);
  if (!policy || !state) return null;
  const events = await readAutopilotLedger(root);
  const last = events.at(-1) ?? null;
  invariant(last?.hash === state.lastEventHash && last?.sequence === state.sequence, 'ERR_AUTOPILOT_RECOVERY', 'Autopilot state and ledger are inconsistent');
  const binding = await assertAutopilotBindingCurrent(root);
  return {
    schema: 'shipping-harness/autopilot-status-v1',
    enabled: policy.enabled,
    policy: autopilotPolicySummary(policy),
    state,
    bindingCurrent: binding.current,
    bindingReason: binding.reason,
    eventCount: events.length,
    released: false,
  };
}

export const AUTOPILOT = Object.freeze({
  stateSchema: AUTOPILOT_STATE_SCHEMA,
  eventSchema: AUTOPILOT_EVENT_SCHEMA,
  mutationSchema: AUTOPILOT_MUTATION_SCHEMA,
  phases: PHASES,
  maxLedgerEvents: MAX_AUTOPILOT_LEDGER_EVENTS,
  maxLedgerBytes: MAX_AUTOPILOT_LEDGER_BYTES,
  maxActiveMutationReceipts: 1,
});
