import { randomUUID } from 'node:crypto';
import { assertLockedContract } from './contract.mjs';
import { appendJsonLine } from './fs.mjs';
import { currentGitSha } from './git.mjs';
import { countIssues, loadIssues } from './issues.mjs';
import { runtimePaths } from './paths.mjs';
import { redactSecrets } from './redaction.mjs';
import { readState, readTrustedState, recordLedger } from './state.mjs';
import { assessStateIntegritySafe } from './state-integrity.mjs';
import { invariant } from './errors.mjs';
import { resolveAdapter } from '../adapters/registry.mjs';

export const LIFECYCLE_EVENTS = Object.freeze([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'Custom',
]);

const SENSITIVE_KEY = /(api[_-]?key|token|secret|password|passwd|authorization|credential)/iu;

/** @param {unknown} value @param {string | null} [key] @param {number} [depth] */
export function sanitizeHookPayload(value, key = null, depth = 0) {
  if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (depth >= 8) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return redactSecrets(value.slice(0, 8192));
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeHookPayload(entry, null, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([nestedKey, nested]) => [nestedKey, sanitizeHookPayload(nested, nestedKey, depth + 1)]),
    );
  }
  return String(value);
}

/** @param {unknown} payload */
function validatePayloadBudget(payload) {
  let serialized;
  try {
    serialized = JSON.stringify(payload ?? null);
  } catch (error) {
    // Circular structures or BigInt values throw from JSON.stringify; surface that as a ShippingError with the cause.
    invariant(false, 'ERR_HOOK_PAYLOAD', 'Hook payload must be JSON-serializable', { reason: String(error?.message ?? error) });
  }
  invariant(Buffer.byteLength(serialized, 'utf8') <= 64 * 1024, 'ERR_HOOK_PAYLOAD_TOO_LARGE', 'Hook payload exceeds 64 KiB');
}

/**
 * Pure Stop/SubagentStop decision. A broken state file outranks every other signal: the
 * host must not continue on a release whose recorded state cannot be trusted.
 * @param {{state: Record<string, any>, counts: Record<string, number>, integrityOk: boolean, agentBudgetExhausted: boolean, fixBudgetExhausted: boolean}} input
 * @returns {{action: string, allowStop: boolean, continue: boolean, reasonCode: string, priority: number}}
 */
function chooseStopDecision({ state, counts, integrityOk, agentBudgetExhausted, fixBudgetExhausted }) {
  const terminal = ['CLOSED', 'ABORTED'].includes(state.state);
  const humanStop = state.humanStop || state.state === 'PAUSED';
  if (!integrityOk) {
    return { action: 'DENY_CONTINUATION', allowStop: true, continue: false, reasonCode: 'STATE_INTEGRITY_TAMPERED', priority: 0 };
  }
  if (humanStop || terminal) {
    return { action: 'DENY_CONTINUATION', allowStop: true, continue: false, reasonCode: humanStop ? 'HUMAN_STOP_WINS' : 'TERMINAL_RELEASE_STATE', priority: 1 };
  }
  if (state.state === 'BLOCKED' || (counts.BLOCKER > 0 && (agentBudgetExhausted || fixBudgetExhausted))) {
    return { action: 'DENY_CONTINUATION', allowStop: true, continue: false, reasonCode: 'EXECUTION_BUDGET_EXHAUSTED', priority: 2 };
  }
  if (state.state === 'SHIPPABLE') {
    return { action: 'ALLOW_STOP', allowStop: true, continue: false, reasonCode: 'RELEASE_SHIPPABLE', priority: 3 };
  }
  if (counts.BLOCKER > 0) {
    return { action: 'CONTINUE', allowStop: false, continue: true, reasonCode: 'RELEASE_BLOCKER_REMAINS', priority: 3 };
  }
  if (['LOCKED', 'RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING'].includes(state.state)) {
    return { action: 'CONTINUE', allowStop: false, continue: true, reasonCode: 'VERIFICATION_OR_CLOSURE_REQUIRED', priority: 4 };
  }
  return { action: 'DENY_CONTINUATION', allowStop: true, continue: false, reasonCode: 'RELEASE_NOT_EXECUTABLE', priority: 5 };
}

/** @param {string} root @param {{adapter?: string, event?: string, runId?: string | null, record?: boolean}} [input] */
export async function decideStop(root, input = {}) {
  const adapter = resolveAdapter(input.adapter ?? 'omo').name;
  const event = input.event ?? 'Stop';
  invariant(event === 'Stop' || event === 'SubagentStop', 'ERR_HOOK_EVENT', 'Stop decisions require Stop or SubagentStop');
  const { contract, lock } = await assertLockedContract(root);
  const state = await readState(root);
  const issueDocument = await loadIssues(root);
  const counts = issueDocument.counts ?? countIssues(issueDocument.issues);
  const integrity = await assessStateIntegritySafe(root);
  const agentBudgetExhausted = state.agentRuns >= contract.budgets.maxAgentRuns;
  const fixBudgetExhausted = state.fixCycles >= contract.budgets.maxFixCycles;

  const decision = chooseStopDecision({ state, counts, integrityOk: integrity.ok, agentBudgetExhausted, fixBudgetExhausted });

  const receipt = {
    schema: 'shipping-harness/stop-decision-v1',
    id: randomUUID(),
    at: new Date().toISOString(),
    adapter,
    event,
    runId: input.runId ?? null,
    release: contract.release,
    contractHash: lock.contractHash,
    gitSha: currentGitSha(root),
    state: integrity.level === 'TAMPERED' && integrity.ledgerState ? integrity.ledgerState : state.state,
    integrity,
    humanStop: Boolean(state.humanStop),
    blockers: counts.BLOCKER,
    budgets: {
      agentRuns: state.agentRuns,
      maxAgentRuns: contract.budgets.maxAgentRuns,
      fixCycles: state.fixCycles,
      maxFixCycles: contract.budgets.maxFixCycles,
      agentBudgetExhausted,
      fixBudgetExhausted,
    },
    ...decision,
  };
  if (input.record !== false) {
    await appendJsonLine(runtimePaths(root).hooks, { type: 'stop.decision', ...receipt });
    await recordLedger(root, {
      type: 'hook.stop-decision',
      adapter,
      runId: receipt.runId,
      action: receipt.action,
      reasonCode: receipt.reasonCode,
    });
  }
  return receipt;
}

/**
 * @param {string} root
 * @param {{adapter?: string, event: string, runId?: string | null, payload?: unknown}} input
 */
export async function ingestLifecycleEvent(root, input) {
  const adapter = resolveAdapter(input.adapter ?? 'omo').name;
  invariant(LIFECYCLE_EVENTS.includes(input.event), 'ERR_HOOK_EVENT', `Unsupported lifecycle event: ${input.event}`, {
    allowed: LIFECYCLE_EVENTS,
  });
  validatePayloadBudget(input.payload);
  const { contract, lock } = await assertLockedContract(root);
  const state = await readTrustedState(root);
  const receipt = {
    schema: 'shipping-harness/hook-event-v1',
    id: randomUUID(),
    at: new Date().toISOString(),
    adapter,
    event: input.event,
    runId: input.runId ?? null,
    release: contract.release,
    contractHash: lock.contractHash,
    gitSha: currentGitSha(root),
    state: state.state,
    payload: sanitizeHookPayload(input.payload ?? null),
  };
  await appendJsonLine(runtimePaths(root).hooks, { type: 'hook.received', ...receipt });
  await recordLedger(root, {
    type: 'hook.received',
    adapter,
    event: input.event,
    runId: receipt.runId,
  });
  const decision = input.event === 'Stop' || input.event === 'SubagentStop'
    ? await decideStop(root, { adapter, event: input.event, runId: receipt.runId })
    : null;
  return { event: receipt, decision };
}