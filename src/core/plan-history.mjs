// v1.12.1 Phase B: an append-only, hash-chained record of every distinct plan hash the
// harness has ever seen (`.shipping/plan-history.jsonl`). It is authority evidence, the
// same status as `.shipping/ledger.jsonl`, and reuses the same `prev`/`digest` hash-chain
// helpers so a deleted or rewritten line is detectable the same way a ledger tamper is.
import { randomUUID } from 'node:crypto';
import { stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { appendJsonLine, readJsonLines } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { planStageSnapshot } from './shipping-plan.mjs';
import { ledgerEventDigest, verifyLedgerChain } from './state-integrity.mjs';

export const PLAN_HISTORY_SCHEMA = 'shipping-harness/plan-history-event-v1';

/**
 * Every recorded plan-history entry, chain-verified. A broken chain (a deleted, reordered
 * or hand-edited line) fails closed rather than silently trusting a shorter history.
 * @param {string} root
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function readPlanHistory(root) {
  const entries = await readJsonLines(runtimePaths(root).planHistory);
  const chain = verifyLedgerChain(entries);
  invariant(chain.ok, 'ERR_PLAN_HISTORY_TAMPERED', `Plan history hash chain is broken: ${chain.reason}`, { reason: chain.reason });
  return entries;
}

/** @param {Record<string, any>} plan @returns {Array<{id: string, snapshot: Record<string, any>}>} */
function currentStageSnapshots(plan) {
  return [...plan.stages]
    .map((stage) => ({ id: stage.id, snapshot: planStageSnapshot(stage) }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Diff two bounded `{id, snapshot}` stage-snapshot lists into stage IDs added, modified
 * (present in both but a `PLAN_STAGE_SNAPSHOT_FIELDS` value differs) and removed. Sorted
 * so the result is deterministic regardless of file order.
 * @param {Array<{id: string, snapshot: Record<string, any>}>} previousStages
 * @param {Array<{id: string, snapshot: Record<string, any>}>} currentStages
 * @returns {{added: string[], modified: string[], removed: string[]}}
 */
export function diffPlanStages(previousStages, currentStages) {
  const previous = new Map((previousStages ?? []).map((entry) => [entry.id, entry.snapshot]));
  const current = new Map((currentStages ?? []).map((entry) => [entry.id, entry.snapshot]));
  const added = [];
  const modified = [];
  for (const [id, snapshot] of current) {
    if (!previous.has(id)) {
      added.push(id);
      continue;
    }
    if (stableStringify(snapshot) !== stableStringify(previous.get(id))) modified.push(id);
  }
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

/**
 * Append a plan-history entry when the plan's hash differs from the last recorded entry
 * (or none exists yet); a no-op when the hash is unchanged, so calling this at every
 * `plan check`/`shipping_start`/`shipping_refine`/`lock` is safe and idempotent.
 *
 * `plan.revision` (optional) must never go backwards, and the same revision can never
 * name two different plan hashes: both are user-visible authorship mistakes, not
 * something the harness silently accepts. A plan with no `revision` records `null` and
 * is otherwise unconstrained — that is the legacy (pre-v1.12.1) shape, warned elsewhere.
 * @param {string} root
 * @param {{plan: Record<string, any>, planHash: string, sourceDrift?: Array<{path: string}>}} input
 * @returns {Promise<{recorded: boolean, entry: Record<string, any>, entries: Array<Record<string, any>>}>}
 */
export async function recordPlanHistory(root, input) {
  const entries = await readPlanHistory(root);
  const last = entries.at(-1) ?? null;
  if (last && last.planHash === input.planHash) return { recorded: false, entry: last, entries };
  const revision = typeof input.plan.revision === 'number' ? input.plan.revision : null;
  if (last && revision !== null && last.revision !== null) {
    invariant(revision >= last.revision, 'ERR_PLAN_REVISION_REGRESSED', `plan.revision ${revision} is smaller than the last recorded revision ${last.revision}`, {
      revision,
      lastRevision: last.revision,
    });
    invariant(revision !== last.revision || last.planHash === input.planHash, 'ERR_PLAN_REVISION_REUSED', `plan.revision ${revision} was already recorded against a different plan hash`, {
      revision,
      lastPlanHash: last.planHash,
      planHash: input.planHash,
    });
  }
  const currentStages = currentStageSnapshots(input.plan);
  const changedStages = diffPlanStages(last?.stages ?? [], currentStages);
  const body = {
    schema: PLAN_HISTORY_SCHEMA,
    id: randomUUID(),
    at: new Date().toISOString(),
    revision,
    planHash: input.planHash,
    previousPlanHash: last?.planHash ?? null,
    changedStages,
    sourceDrift: (input.sourceDrift ?? []).map((entry) => entry.path),
    stages: currentStages,
    prev: last?.digest ?? null,
  };
  const entry = { ...body, digest: ledgerEventDigest(body) };
  await appendJsonLine(runtimePaths(root).planHistory, entry);
  return { recorded: true, entry, entries: [...entries, entry] };
}

/**
 * Bounded summary for `plan check --json` and `plan status`.
 * @param {string} root
 * @returns {Promise<{entries: number, lastRevision: number | null, lastPlanHash: string | null}>}
 */
export async function planHistorySummary(root) {
  const entries = await readPlanHistory(root);
  const last = entries.at(-1) ?? null;
  return { entries: entries.length, lastRevision: last?.revision ?? null, lastPlanHash: last?.planHash ?? null };
}
