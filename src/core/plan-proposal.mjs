// Plan-aware proposal tiers. PROGRAM is a projection with no authority, MILESTONE is
// the stage that becomes the contract, PATCH is the small-change fallback that also
// covers "no plan file", "invalid plan file", "no READY stage" and "plan complete".
// Only the active proposal is ever approvable; the PROGRAM projection deliberately
// carries no proposal hash.
import { validateContract } from './contract.mjs';
import { invariant } from './errors.mjs';
import { buildAcceptanceCriteria } from './project-analysis.mjs';
import { RELEASE_TRAIN_MAX_RELEASES } from './release-train.mjs';
import { PLAN_LIMITS, PLAN_TIER_BUDGETS, resolveAcceptanceRefs } from './shipping-plan.mjs';
import { extractGoalPaths } from './goal-paths.mjs';
import { matchesAnyGlob } from './glob.mjs';

export const PLAN_PROJECTION_SCHEMA = 'shipping-harness/plan-projection-v1';

/** @param {string} value @param {number} [max] */
function shortText(value, max = PLAN_LIMITS.projectionOutcomeLength) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Stage IDs that cannot gate a release: one whose acceptance references the analyzer could
 * not resolve, and one that carries no acceptance reference at all. An empty
 * `acceptanceRefs` used to leave a stage READY with nothing to prove it, which let a stage
 * close on review alone. A stage with no gate is not ready; it is ungated.
 * @param {Map<string, {resolved: Array<Record<string, any>>, unresolved: string[]}>} resolution
 * @returns {string[]}
 */
export function unresolvedStageIds(resolution) {
  return [...resolution.entries()]
    .filter(([, entry]) => entry.unresolved.length > 0 || entry.resolved.length === 0)
    .map(([id]) => id);
}

/**
 * Stage IDs that name no acceptance reference at all, separated from unresolved ones so
 * the diagnostic can say which of the two problems a stage has.
 * @param {Record<string, any>} plan
 * @returns {string[]}
 */
export function ungatedStageIds(plan) {
  return (plan?.stages ?? []).filter((stage) => (stage.acceptanceRefs ?? []).length === 0).map((stage) => stage.id);
}

/**
 * Remaining (not DONE) stages in dependency order, keeping file order between peers.
 * @param {Record<string, any>} plan
 * @param {Record<string, any>} progress
 * @returns {Array<Record<string, any>>}
 */
export function remainingStagesInOrder(plan, progress) {
  const states = new Map(progress.stages.map((entry) => [entry.id, entry.state]));
  const remaining = plan.stages.filter((stage) => states.get(stage.id) !== 'DONE');
  const emitted = new Set();
  const ordered = [];
  const visit = (stage, trail) => {
    if (emitted.has(stage.id) || trail.includes(stage.id)) return;
    for (const dependency of stage.dependsOn) {
      const parent = remaining.find((entry) => entry.id === dependency);
      if (parent) visit(parent, [...trail, stage.id]);
    }
    if (!emitted.has(stage.id)) {
      emitted.add(stage.id);
      ordered.push(stage);
    }
  };
  for (const stage of remaining) visit(stage, []);
  return ordered;
}

/** @param {Record<string, any>} plan @param {Record<string, any>} progress */
function programReleaseTrain(plan, progress) {
  const ordered = remainingStagesInOrder(plan, progress);
  const releases = ordered.slice(0, RELEASE_TRAIN_MAX_RELEASES).map((stage, index) => ({
    order: index + 1,
    stageId: stage.id,
    title: shortText(stage.title),
    size: stage.size,
    state: progress.stages.find((entry) => entry.id === stage.id)?.state ?? 'BLOCKED_BY_DEPENDENCY',
  }));
  return {
    authority: 'none',
    maxReleases: RELEASE_TRAIN_MAX_RELEASES,
    releases,
    truncated: Math.max(0, ordered.length - releases.length),
  };
}

/**
 * Decide which tier the current request produces.
 * @param {{plan: Record<string, any>, progress: Record<string, any>, resolution: Map<string, any>, requestedStageId?: string | null}} input
 * @returns {{tier: string, stage: Record<string, any> | null, diagnostics: string[]}}
 */
export function selectPlanTier(input) {
  const { plan, progress, resolution } = input;
  const diagnostics = [];
  for (const [stageId, entry] of resolution.entries()) {
    if (entry.unresolved.length > 0) diagnostics.push(`UNRESOLVED_ACCEPTANCE: stage ${stageId} references undetected acceptance commands (${entry.unresolved.join(', ')}); the stage stays BLOCKED_BY_UNRESOLVED.`);
    else if (entry.resolved.length === 0) diagnostics.push(`UNGATED_STAGE: stage ${stageId} names no acceptance reference, so nothing can prove it. It stays BLOCKED_BY_UNRESOLVED until it references a detected command.`);
  }
  const requested = input.requestedStageId ?? null;
  if (requested) {
    const stage = plan.stages.find((entry) => entry.id === requested);
    invariant(stage, 'ERR_PLAN_STAGE_UNKNOWN', `Unknown plan stage: ${requested}`, { stageId: requested });
    const state = progress.stages.find((entry) => entry.id === requested);
    invariant(state.state === 'READY' || state.state === 'ACTIVE', 'ERR_PLAN_STAGE_NOT_READY', `Plan stage ${requested} is ${state.state}; unmet dependencies: ${state.unmetDependencies.join(', ') || 'none'}`, {
      stageId: requested,
      state: state.state,
      unmetDependencies: state.unmetDependencies,
    });
    return { tier: stage.size === 'PATCH' ? 'PATCH' : 'MILESTONE', stage, diagnostics };
  }
  if (progress.done === progress.total) {
    diagnostics.push('PLAN_COMPLETE: every plan stage has a closed release receipt; only a small patch scope remains.');
    return { tier: 'PATCH', stage: null, diagnostics };
  }
  if (!progress.nextStageId) {
    diagnostics.push('PLAN_NO_READY_STAGE: no plan stage is READY; the proposal falls back to a small patch scope.');
    return { tier: 'PATCH', stage: null, diagnostics };
  }
  const stage = plan.stages.find((entry) => entry.id === progress.nextStageId);
  return { tier: stage.size === 'PATCH' ? 'PATCH' : 'MILESTONE', stage, diagnostics };
}

/** @param {Record<string, any>} projection */
function boundProjection(projection) {
  let bounded = projection;
  while (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > PLAN_LIMITS.maxProjectionBytes && bounded.program.stages.length > 1) {
    bounded = {
      ...bounded,
      truncated: true,
      program: { ...bounded.program, stages: bounded.program.stages.slice(0, bounded.program.stages.length - 1) },
    };
  }
  return bounded;
}

/**
 * The bounded, authority-free plan projection returned with a proposal.
 * @param {{plan: Record<string, any>, planHash: string, path: string, progress: Record<string, any>, resolution: Map<string, any>, tier: string, stage: Record<string, any> | null, goal: string, diagnostics: string[]}} input
 * @returns {Record<string, any>}
 */
export function buildPlanProjection(input) {
  const { plan, progress, stage, tier } = input;
  const stageStates = new Map(progress.stages.map((entry) => [entry.id, entry]));
  const projection = {
    schema: PLAN_PROJECTION_SCHEMA,
    path: input.path,
    planHash: input.planHash,
    tier,
    truncated: false,
    progress: {
      total: progress.total,
      done: progress.done,
      active: progress.active,
      ready: progress.ready,
      percent: progress.percent,
      nextStageId: progress.nextStageId,
    },
    program: {
      authority: 'none',
      title: plan.program.title,
      outcome: plan.program.outcome,
      progress: { total: progress.total, done: progress.done, percent: progress.percent },
      stages: plan.stages.map((entry) => ({
        id: entry.id,
        title: shortText(entry.title),
        outcome: shortText(entry.outcome),
        size: entry.size,
        state: stageStates.get(entry.id)?.state ?? 'BLOCKED_BY_DEPENDENCY',
        dependsOn: entry.dependsOn,
      })),
      releaseTrain: programReleaseTrain(plan, progress),
    },
    milestone: stage
      ? {
          stageId: stage.id,
          title: stage.title,
          outcome: stage.outcome,
          size: stage.size,
          tier,
          acceptanceRefs: stage.acceptanceRefs,
          unresolvedAcceptanceRefs: input.resolution.get(stage.id)?.unresolved ?? [],
          scopeInclude: stage.scopeInclude,
          scopeExclude: stage.scopeExclude,
        }
      : null,
    patch: tier === 'PATCH'
      ? { tier: 'PATCH', goal: shortText(input.goal, PLAN_LIMITS.maxTitleLength), stageId: stage?.id ?? null }
      : null,
    diagnostics: input.diagnostics.slice(0, 24),
  };
  return boundProjection(projection);
}

/**
 * Path-shaped entries in a plan stage's scope statements that the contract's path
 * allowlist does not cover.
 *
 * v1.13.16: `applyPlanStageToContract` replaces `scope.include` and `scope.exclude` from
 * the stage and passes `scope.paths` straight through, so a stage that names a file in
 * its scope changes the prose a person reads and nothing the gate measures. That division
 * is right -- a plan file widening the path allowlist would be a far larger authority
 * than a plan file should have -- but a reporting session wrote `uv.lock` into a stage
 * scope, watched the contract's prose pick it up, and learned only from reading the
 * source that the allowlist had not moved. Saying so is cheap; finding out from a scope
 * violation later is not.
 *
 * Only tokens the conservative goal-path extractor accepts count, so ordinary prose
 * produces nothing.
 * @param {Record<string, any>} stage The bound plan stage.
 * @param {{include?: string[], exclude?: string[]}} scopePaths The contract's path allowlist.
 * @returns {string[]} One diagnostic per uncovered path-shaped entry.
 */
export function stageScopePathDiagnostics(stage, scopePaths) {
  const statements = [...(stage?.scopeInclude ?? []), ...(stage?.scopeExclude ?? [])];
  const include = Array.isArray(scopePaths?.include) ? scopePaths.include : [];
  const seen = new Set();
  const diagnostics = [];
  for (const statement of statements) {
    for (const token of extractGoalPaths(String(statement)).accepted) {
      if (seen.has(token) || matchesAnyGlob(token, include)) continue;
      seen.add(token);
      diagnostics.push(`PLAN_SCOPE_PATH_UNCOVERED: ${token} -- named in the plan stage scope, which states intent and never widens scope.paths.include, and no allowlist entry covers it, so changes there would count as scope drift. Add it to the contract's scope.paths.include, or name it in the goal sentence.`);
    }
  }
  return diagnostics;
}

/**
 * Bind one plan stage to the contract that the proposal would lock.
 * @param {Record<string, any>} contract
 * @param {{stage: Record<string, any>, resolved: Array<Record<string, any>>, analysis: Record<string, any>, path: string, planHash: string, tier: string}} input
 * @returns {Record<string, any>}
 */
export function applyPlanStageToContract(contract, input) {
  const { stage, resolved, tier } = input;
  const acceptance = resolved.length > 0
    ? buildAcceptanceCriteria(/** @type {any} */ ({ ...input.analysis, candidateCommands: resolved }))
    : contract.acceptance;
  const budgets = tier === 'PATCH' ? { ...contract.budgets, ...PLAN_TIER_BUDGETS.PATCH } : contract.budgets;
  return validateContract({
    ...contract,
    goal: stage.outcome,
    scope: {
      ...contract.scope,
      include: stage.scopeInclude.length > 0 ? stage.scopeInclude : contract.scope.include,
      exclude: stage.scopeExclude.length > 0 ? stage.scopeExclude : contract.scope.exclude,
    },
    acceptance,
    budgets,
    plan: { path: input.path, planHash: input.planHash, stageId: stage.id, tier },
  });
}

/**
 * Load the plan, compute progress, choose the tier, and project it — never throwing for
 * a broken plan file: an invalid plan is reported as a diagnostic and degrades to PATCH.
 * @param {{binding: {path: string, planHash: string, plan: Record<string, any>, diagnostics?: string[]} | null, planError: {code: string, message: string} | null, analysis: Record<string, any>, goal: string, requestedStageId?: string | null, progressFor: (plan: Record<string, any>, unresolved: string[]) => Promise<Record<string, any>>}} input
 * @returns {Promise<{tier: string, projection: Record<string, any> | null, stage: Record<string, any> | null, resolved: Array<Record<string, any>>, diagnostics: string[]}>}
 */
export async function compilePlanTiers(input) {
  const diagnostics = [];
  // v1.13.15: this used to stop at the offending field. Naming the defect without naming
  // what it costs leaves the reader to discover that the whole file was rejected and the
  // scope came from somewhere else -- which is what happened to a reporting session that
  // read "stages[2].size must be PATCH or MILESTONE" and had no reason to suspect the
  // proposal in front of it was no longer plan-derived. ERR_PLAN_HISTORY_LOST is the
  // shape to copy: say what changed, and say what follows from it.
  if (input.planError) {
    diagnostics.push(`PLAN_FILE_INVALID: ${input.planError.code}: ${input.planError.message} -- one invalid stage rejects the whole plan file, so this proposal's scope and tier come from the derived template, not from the plan. Fix the plan file and propose again to bind a stage.`);
  }
  if (input.binding?.diagnostics) diagnostics.push(...input.binding.diagnostics);
  if (!input.binding) return { tier: 'PATCH', projection: null, stage: null, resolved: [], diagnostics };
  const { plan, planHash: hash, path: planPath } = input.binding;
  const resolution = resolveAcceptanceRefs(plan, input.analysis);
  const progress = await input.progressFor(plan, unresolvedStageIds(resolution));
  const selected = selectPlanTier({ plan, progress, resolution, requestedStageId: input.requestedStageId ?? null });
  const allDiagnostics = [...diagnostics, ...selected.diagnostics];
  return {
    tier: selected.tier,
    stage: selected.stage,
    resolved: selected.stage ? (resolution.get(selected.stage.id)?.resolved ?? []) : [],
    diagnostics: allDiagnostics,
    projection: buildPlanProjection({
      plan,
      planHash: hash,
      path: planPath,
      progress,
      resolution,
      tier: selected.tier,
      stage: selected.stage,
      goal: input.goal,
      diagnostics: allDiagnostics,
    }),
  };
}
