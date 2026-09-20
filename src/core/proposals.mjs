import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { createDefaultContract, loadContract, lockContract, validateContract } from './contract.mjs';
import { hashObject, stableStringify } from './crypto.mjs';
import { assertContainedPath, ensureDir, exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { currentGitSha, gitStatus } from './git.mjs';
import { BASELINE_UNDO_COMMAND, baselineCommitSummary, commitBaseline } from './baseline-commit.mjs';
import { goalPathDiagnostics } from './goal-paths.mjs';
import { unprovenObjectiveDiagnostics } from './goal-objectives.mjs';
import { VERSION } from '../version.mjs';
import { runAcceptancePreflight } from './contract-defect.mjs';
import { analyzeBaseline, verifyBaselinePreservation } from './baseline.mjs';
import { buildOneScreenApproval } from './project-intelligence.mjs';
import { compilePlainBriefSafe } from './plain-brief.mjs';
import { invariant } from './errors.mjs';
import { runtimePaths } from './paths.mjs';
import { buildShortPlan, goalScopePaths } from './project-analysis.mjs';
import { DEFAULT_PLAN_PATH, computePlanProgress, loadShippingPlan } from './shipping-plan.mjs';
import { recordPlanHistory } from './plan-history.mjs';
import { applyPlanStageToContract, compilePlanTiers } from './plan-proposal.mjs';
import { buildDecisionEvidence } from './decision-evidence.mjs';
import { compileDecisionContract, composeDefaultDecision, validateDecisionPackage } from './decision-package.mjs';
import { applyDecisionPolicy, buildApprovalBrief } from './decision-policy.mjs';
import {
  classifyAcceptanceStrength,
  deriveProposalState,
  isTerminalProposalState,
  proposalAuthorityStatus,
  proposalFingerprint,
  proposalSummary,
} from './proposal-state.mjs';
import { prepareNextRelease, compareSemver } from './release-transition.mjs';
import { buildReleaseTrain, persistApprovedReleaseTrain, releaseTrainSummary } from './release-train.mjs';
import { acceptGoalCharter, compileGoalCharterPreview, persistAcceptedGoalCharter, validateGoalCharter } from './goal-charter.mjs';
import { validateAutopilotDecision } from './autopilot-policy.mjs';
import { loadAutopilotPolicy } from './autopilot.mjs';
import { compileGoalDiscovery, goalDiscoverySummary, mergeGoalDiscoveryQuestions } from './goal-discovery.mjs';
import { compileIntentGate, intentAllowsImplementation, intentAllowsPlanning } from './intent-gate.mjs';
import { appendDecisionLedgerEvent, decisionLedgerSummary } from './decision-ledger.mjs';
import { initializeState, readState, recordLedger, transitionState } from './state.mjs';

const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const ACTIVE_PROPOSAL_FILE = '_active.json';
const PROPOSAL_LOCK_FILE = '.active.lock';
const PROPOSAL_LOCK_ATTEMPTS = 100;

/** @param {string} root */
function activeProposalPath(root) {
  return path.join(runtimePaths(root).proposals, ACTIVE_PROPOSAL_FILE);
}

/** @param {string} root */
function proposalLockPath(root) {
  return path.join(runtimePaths(root).proposals, PROPOSAL_LOCK_FILE);
}

/** @template T @param {string} root @param {() => Promise<T>} operation */
async function withProposalLock(root, operation) {
  const directory = runtimePaths(root).proposals;
  await ensureDir(directory);
  const lockPath = proposalLockPath(root);
  await assertContainedPath(root, lockPath);
  let handle;
  for (let attempt = 0; attempt < PROPOSAL_LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
      break;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
      await delay(10);
    }
  }
  invariant(handle, 'ERR_PROPOSAL_BUSY', 'Another proposal operation is still active');
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

/** @param {string} version */
function nextMinor(version) {
  const match = /^(\d+)\.(\d+)\.\d+/u.exec(version);
  return match ? `${match[1]}.${Number(match[2]) + 1}.0` : '0.1.0';
}

/**
 * The release number for the next contract when the caller named none.
 *
 * The analyzer already derives a recommendation from the repository's own version
 * evidence, including whether the change reads as a patch or a minor. Hardcoding a minor
 * bump threw that away: a patch-sized stage after 1.0.2 was proposed as 1.1.0 while the
 * evidence said 1.0.3 with high confidence. Prefer the recommendation whenever it is
 * actually ahead of the closed release, and keep the minor bump as the fallback.
 * @param {Record<string, any> | null | undefined} contract
 * @param {Record<string, any>} analysis
 * @returns {string}
 */
function nextReleaseAfter(contract, analysis) {
  const recommended = analysis?.versionEvidence?.recommendedVersion ?? null;
  if (!contract) return recommended ?? '0.1.0';
  const valid = typeof recommended === 'string' && SEMVER.test(recommended);
  return valid && compareSemver(recommended, contract.release) > 0 ? recommended : nextMinor(contract.release);
}

/** @param {string} root */
function currentBaseline(root) {
  const status = gitStatus(root);
  return analyzeBaseline(root, status.porcelain, { gitSha: status.sha });
}

/** @param {Record<string, any>} proposal */
function proposalHash(proposal) {
  const {
    hash: _hash,
    approval: _approval,
    briefFactGraph: _briefFactGraph,
    actionEnvelope: _actionEnvelope,
    plainBrief: _plainBrief,
    plainBriefText: _plainBriefText,
    plainBriefError: _plainBriefError,
    goalCharter: _goalCharter,
    ...body
  } = proposal;
  return hashObject(body);
}

/** Legacy v1 proposals hashed every serialized projection except hash/approval. */
function legacyProposalHash(proposal) {
  const { hash: _hash, approval: _approval, ...body } = proposal;
  return hashObject(body);
}

/** @param {Record<string, any>} value */
function decisionHash(value) {
  const { hash: _hash, ...body } = value;
  return hashObject(body);
}

/**
 * Return a safe authority projection without changing the stored proposal hash.
 * Historical proposal bytes remain untouched; all new proposals are projected
 * before their top-level hash is calculated.
 * @param {Record<string, any>} input
 */
export function projectProposalAuthority(input) {
  const proposal = structuredClone(input);
  proposal.intentGate = compileIntentGate(proposal.goal, {
    resolutions: proposal.decision?.resolutions ?? [],
  });
  const planningAllowed = intentAllowsPlanning(proposal.intentGate);
  if (planningAllowed && !proposal.goalDiscovery && proposal.evidence) {
    proposal.goalDiscovery = compileGoalDiscovery(proposal.evidence, {
      resolutions: proposal.decision?.resolutions ?? [],
    });
  } else if (!planningAllowed) {
    proposal.goalDiscovery = null;
  }
  const state = deriveProposalState(proposal);
  proposal.canonicalState = state;
  proposal.readyForApproval = state === 'READY_FOR_APPROVAL';
  if (proposal.decision && typeof proposal.decision === 'object') {
    proposal.decision.approvalStatus = proposalAuthorityStatus(state);
    proposal.decision.hash = decisionHash(proposal.decision);
    proposal.approvalBrief = buildApprovalBrief(proposal.decision, proposal.contract ?? null);
  }
  if (planningAllowed && proposal.goalCharter?.status === 'ACCEPTED') validateGoalCharter(proposal.goalCharter);
  else proposal.goalCharter = planningAllowed && proposal.goalDiscovery?.status === 'READY' && proposal.goalDiscovery?.direction
    ? compileGoalCharterPreview(proposal)
    : null;
  proposal.releaseTrain = planningAllowed && proposal.goalDiscovery?.status === 'READY' && proposal.goalDiscovery?.direction
    ? buildReleaseTrain({
        finalGoal: proposal.goalCharter?.outcome ?? proposal.goalDiscovery.direction.outcome,
        proposalRelease: proposal.release,
        gitSha: proposal.gitSha,
        proposalId: proposal.id,
        goalCharterHash: proposal.goalCharter?.status === 'ACCEPTED'
          ? proposal.goalCharter.binding.previewHash
          : proposal.goalCharter?.hash ?? null,
        projectName: proposal.contract?.project ?? proposal.analysis?.projectName ?? null,
        analysis: proposal.analysis,
        baseline: proposal.baseline,
        acceptanceStrength: proposal.acceptanceStrength,
        contract: proposal.contract,
      })
    : null;
  proposal.releaseTrainSummary = proposal.releaseTrain ? releaseTrainSummary(proposal.releaseTrain) : null;
  proposal.oneScreenApproval = buildOneScreenApproval(proposal);
  const compiled = compilePlainBriefSafe(proposal);
  proposal.briefFactGraph = compiled.plainBrief?.factGraph ?? null;
  proposal.actionEnvelope = compiled.plainBrief?.actionEnvelope ?? null;
  proposal.plainBrief = compiled.plainBrief ?? null;
  proposal.plainBriefText = compiled.plainBrief?.renderedText ?? null;
  proposal.plainBriefError = compiled.error ?? null;
  return proposal;
}

/** @param {Record<string, any>} proposal */
function normalizedFingerprintBaseline(proposal) {
  const baseline = structuredClone(proposal.baseline ?? null);
  if (baseline && typeof baseline === 'object') {
    baseline.entries = (baseline.entries ?? []).filter((entry) => entry.blocking === true);
    baseline.counts = {
      PRODUCT: baseline.counts?.PRODUCT ?? 0,
      RELEASE_EVIDENCE: baseline.counts?.RELEASE_EVIDENCE ?? 0,
      UNKNOWN: baseline.counts?.UNKNOWN ?? 0,
    };
    delete baseline.nonBlockingPaths;
    if (baseline.plan) {
      delete baseline.plan.excludePaths;
      delete baseline.plan.hash;
    }
  }
  return baseline;
}

/** @param {Record<string, any>} input */
function authorityFingerprint(input) {
  const proposal = projectProposalAuthority(input);
  const baseline = normalizedFingerprintBaseline(proposal);
  const evidence = structuredClone(proposal.evidence ?? null);
  if (evidence && typeof evidence === 'object') {
    delete evidence.createdAt;
    delete evidence.hash;
    delete evidence.baseline;
    evidence.facts = (evidence.facts ?? []).filter((entry) => entry.id !== 'EVID-009');
  }
  const goalDiscovery = structuredClone(proposal.goalDiscovery ?? null);
  if (goalDiscovery && typeof goalDiscovery === 'object') {
    delete goalDiscovery.hash;
    delete goalDiscovery.evidenceHash;
  }
  const intentGate = structuredClone(proposal.intentGate ?? null);
  if (intentGate && typeof intentGate === 'object') delete intentGate.hash;
  const decision = structuredClone(proposal.decision ?? null);
  if (decision && typeof decision === 'object') {
    delete decision.hash;
    delete decision.evidenceHash;
    delete decision.gitSha;
    decision.resolutions = decision.resolutions ?? [];
    for (const resolution of decision.resolutions) delete resolution.resolvedAt;
  }
  const goalCharter = structuredClone(proposal.goalCharter ?? null);
  if (goalCharter && typeof goalCharter === 'object' && goalCharter.status === 'PROPOSED') {
    delete goalCharter.hash;
    delete goalCharter.discoveryHash;
    delete goalCharter.proposalRevision;
  }
  const releaseTrain = structuredClone(proposal.releaseTrain ?? null);
  if (releaseTrain && typeof releaseTrain === 'object') {
    delete releaseTrain.hash;
    delete releaseTrain.id;
    if (releaseTrain.source) {
      delete releaseTrain.source.baselinePlanHash;
      delete releaseTrain.source.goalCharterHash;
    }
  }
  return hashObject({
    gitSha: proposal.gitSha,
    release: proposal.release,
    releaseSelection: proposal.releaseSelection,
    goal: proposal.goal,
    mode: proposal.mode,
    modeAuthorization: proposal.modeAuthorization ?? null,
    sourceChanges: proposal.sourceChanges ?? [],
    baseline,
    baselinePreservation: proposal.baselinePreservation ?? null,
    intelligence: proposal.intelligence ?? proposal.analysis?.intelligence ?? null,
    intentGate,
    goalDiscovery,
    goalCharter,
    acceptanceStrength: proposal.acceptanceStrength,
    workspace: proposal.workspace,
    workspaceCandidates: proposal.workspaceCandidates,
    versionEvidence: proposal.versionEvidence,
    analysis: proposal.analysis,
    evidence,
    decision,
    contract: proposal.contract,
    plan: proposal.plan,
    shippingPlan: proposal.shippingPlan ?? null,
    tier: proposal.tier ?? 'PATCH',
    diagnostics: proposal.diagnostics,
    releaseTrain,
    canonicalState: proposal.canonicalState,
  });
}

/** @param {unknown} value @param {string} fallback */
function safeProjectName(value, fallback) {
  // eslint-disable-next-line no-control-regex -- intentionally strips control characters from untrusted project names
  const normalized = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/gu, '').trim().slice(0, 120) : '';
  return normalized || fallback.slice(0, 120) || 'project';
}

/** @param {string} root */
async function currentReleaseContext(root) {
  const paths = runtimePaths(root);
  if (!(await exists(paths.state))) return { state: null, contract: null };
  const state = await readState(root);
  const contract = (await exists(paths.contract)) ? await loadContract(paths.contract) : null;
  return { state, contract };
}

/** @param {string} root */
async function readActiveProposalIndex(root) {
  const target = activeProposalPath(root);
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  const index = await readJson(target);
  invariant(index?.schema === 'shipping-harness/active-proposal-v1', 'ERR_PROPOSAL_INDEX', 'Unsupported active proposal index');
  invariant(typeof index.proposalId === 'string' && /^[A-Za-z0-9._-]+$/u.test(index.proposalId), 'ERR_PROPOSAL_INDEX', 'Active proposal index has an invalid proposal ID');
  return index;
}

/** @param {string} root @param {Record<string, any>} proposal */
async function writeActiveProposalIndex(root, proposal) {
  const summary = proposalSummary(proposal);
  await writeJsonAtomic(activeProposalPath(root), {
    schema: 'shipping-harness/active-proposal-v1',
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    fingerprint: proposal.fingerprint,
    revision: proposal.revision ?? 1,
    state: summary.state,
    updatedAt: new Date().toISOString(),
  });
}

/** @param {string} root */
export async function findActiveScopeProposal(root) {
  const index = await readActiveProposalIndex(root);
  if (!index) return null;
  const { proposal } = await loadScopeProposal(root, index.proposalId);
  invariant(proposal.fingerprint === index.fingerprint, 'ERR_PROPOSAL_INDEX', 'Active proposal fingerprint does not match the proposal');
  const projectedProposal = projectProposalAuthority(proposal);
  return { proposal, projectedProposal, index, summary: proposalSummary(projectedProposal) };
}

/** @param {string} root @param {Record<string, any>} proposal @param {string} supersededBy */
async function supersedeProposal(root, proposal, supersededBy) {
  if (isTerminalProposalState(deriveProposalState(proposal))) return proposal;
  const updated = {
    ...proposal,
    lifecycle: {
      ...(proposal.lifecycle ?? {}),
      state: 'SUPERSEDED',
      supersededAt: new Date().toISOString(),
      supersededBy,
    },
  };
  const projected = projectProposalAuthority(updated);
  projected.hash = proposalHash(projected);
  const target = path.join(runtimePaths(root).proposals, `${projected.id}.json`);
  await writeJsonAtomic(target, projected);
  if (projected.goalDiscovery) {
    await appendDecisionLedgerEvent(root, {
      type: 'direction.superseded',
      proposalId: projected.id,
      proposalRevision: projected.revision ?? 1,
      proposalHash: projected.hash,
      gitSha: projected.gitSha,
      discoveryHash: projected.goalDiscovery.hash,
      directionHash: projected.goalDiscovery.direction?.hash ?? null,
      provenance: 'mechanical-lifecycle',
      evidenceRefs: ['proposal.lifecycle.supersededBy'],
      details: { supersededBy },
    });
  }
  return projected;
}

/** Plan errors that refuse the whole request instead of degrading it to a PATCH proposal. */
const REFUSED_PLAN_ERRORS = new Set([
  'ERR_PLAN_PATH',
  'ERR_PLAN_PATH_FIXED',
  'ERR_PLAN_FILE_MISSING',
  'ERR_PATH_OUTSIDE_REPO',
  'ERR_PLAN_HISTORY_LOST',
  'ERR_PLAN_SUPERSEDES_UNKNOWN',
  'ERR_PLAN_HISTORY_TAMPERED',
  'ERR_PLAN_REVISION_REGRESSED',
  'ERR_PLAN_REVISION_REUSED',
]);

/**
 * Load the repository plan file and compile the proposal tiers. A missing plan file is
 * not an error; a broken one degrades to PATCH with a visible diagnostic.
 * @param {string} root @param {{planPath?: string | null, stageId?: string | null}} input @param {Record<string, any>} analysis @param {string} goal
 */
async function loadPlanTiers(root, input, analysis, goal) {
  let binding = null;
  /** @type {{code: string, message: string} | null} */
  let planError = null;
  try {
    binding = await loadShippingPlan(root, input.planPath ?? DEFAULT_PLAN_PATH, { auditHistory: true });
    // A new plan hash is recorded into `.shipping/plan-history.jsonl` the first time
    // shipping_start/shipping_refine sees it; the same hash re-seen is a no-op.
    if (binding) await recordPlanHistory(root, { plan: binding.plan, planHash: binding.planHash, sourceDrift: binding.sourceDrift });
  } catch (error) {
    // An unusable address is a request error; unusable content degrades to a visible PATCH.
    // A plan that fails the history audit is neither, and must never reach a proposal at
    // all: ERR_PLAN_INVALID means the file has no authority, so falling back to a PATCH
    // loses nothing, while ERR_PLAN_HISTORY_LOST means the file is trying to rewrite
    // evidence that already exists. Degrading that to a PATCH with a diagnostic would let
    // the rewrite stand and keep proposing work from it.
    if (REFUSED_PLAN_ERRORS.has(error?.code)) throw error;
    // v1.13.13: degrading is only honest when nobody asked for the plan. A caller that
    // passed planPath or stageId asked for a scope derived from that stage; handing back
    // a template PATCH marked READY_FOR_APPROVAL delivers something else under the name
    // of what was requested, and the diagnostic explaining it never reached the brief.
    // Reported from a live session that put MINOR in a stage size and got an approvable
    // proposal whose scope did not come from the plan at all.
    invariant(!input.planPath && !input.stageId, 'ERR_PLAN_REQUEST_UNMET',
      `${input.stageId ? `Stage ${input.stageId}` : 'The plan'} cannot be used because the plan file is invalid: ${String(error?.message ?? 'unknown reason').slice(0, 200)}. Nothing was proposed. Fix the plan file, or drop planPath and stageId to propose without it.`,
      { code: typeof error?.code === 'string' ? error.code : 'ERR_PLAN_INVALID', planPath: input.planPath ?? DEFAULT_PLAN_PATH, stageId: input.stageId ?? null });
    planError = {
      code: typeof error?.code === 'string' ? error.code : 'ERR_PLAN_INVALID',
      message: String(error?.message ?? 'Plan file could not be loaded').slice(0, 300),
    };
  }
  return compilePlanTiers({
    binding,
    planError,
    analysis,
    goal,
    requestedStageId: input.stageId ?? null,
    progressFor: (plan, unresolved) => computePlanProgress(root, plan, { unresolvedStageIds: unresolved, planHash: binding?.progressPlanHash ?? null }),
  });
}

/** @param {string} root @param {{goal: string, release?: string | null, projectName?: string | null, mode?: string | null, workspaceCandidateId?: string | null, planPath?: string | null, stageId?: string | null}} input @param {{sha: string, files: string[], untrackedIncluded: string[], undo: string} | null} [baselineCommit] */
async function loadProposalContext(root, input, baselineCommit = null) {
  const context = await currentReleaseContext(root);
  if (context.state) {
    invariant(['DRAFT', 'CLOSED'].includes(context.state.state), 'ERR_PROPOSAL_ACTIVE_RELEASE', `Cannot propose a new scope while release state is ${context.state.state}`);
  }
  const evidence = await buildDecisionEvidence(root, {
    goal: input.goal.trim(),
    mode: input.mode ?? undefined,
    workspaceCandidateId: input.workspaceCandidateId ?? null,
  });
  const analysis = evidence.analysis;
  const release = input.release?.trim()
    || (context.state?.state === 'DRAFT'
      ? (context.state.release || context.contract?.release || '0.1.0')
      : nextReleaseAfter(context.contract, analysis));
  invariant(SEMVER.test(release), 'ERR_RELEASE_VERSION', `Invalid semantic version: ${release}`);
  const goal = input.goal.trim();
  const projectName = safeProjectName(input.projectName, safeProjectName(analysis.projectName, path.basename(root)));
  const fingerprint = proposalFingerprint({
    projectRoot: path.resolve(root),
    gitSha: evidence.gitSha,
    goal,
    release,
    mode: evidence.mode,
    projectName,
  });
  const planTiers = await loadPlanTiers(root, input, analysis, goal);
  const planRequest = { path: input.planPath ?? null, stageId: input.stageId ?? null };
  const goalPaths = goalScopePaths(analysis, goal);
  for (const entry of goalPaths.added) await assertContainedPath(root, path.resolve(root, entry.token));
  return { context, evidence, analysis, release, goal, projectName, fingerprint, planTiers, planRequest, goalPaths, baselineCommit };
}

/** @param {string} root @param {Record<string, any>} ctx */
async function reuseMatchingProposal(root, ctx) {
  const active = await findActiveScopeProposal(root);
  if (active && !isTerminalProposalState(active.summary.state)) {
    invariant(active.proposal.mode === ctx.evidence.mode, 'ERR_PROPOSAL_MODE_CHANGE', `Active proposal mode is ${active.proposal.mode}; create or refine it without silently switching mode`);
    const samePlanBinding = (active.proposal.shippingPlan?.planHash ?? null) === (ctx.planTiers.projection?.planHash ?? null)
      && (active.proposal.shippingPlan?.milestone?.stageId ?? null) === (ctx.planTiers.projection?.milestone?.stageId ?? null);
    // A proposal stored by another build describes that build's judgement. Reusing it
    // silently served stale analysis after an upgrade, so a version change regenerates.
    const sameBuild = (active.proposal.harnessVersion ?? null) === VERSION;
    if (active.proposal.fingerprint === ctx.fingerprint && samePlanBinding && sameBuild) {
      return {
        active,
        reused: {
          proposal: active.projectedProposal,
          proposalPath: path.join(runtimePaths(root).proposals, `${active.proposal.id}.json`),
          reused: true,
          supersededProposalId: null,
        },
      };
    }
  }
  return { active, reused: null };
}

/**
 * Bind the selected plan stage to the compiled contract, or return it unchanged.
 * @param {Record<string, any>} contract @param {Record<string, any>} ctx
 */
function bindPlanStageContract(contract, ctx) {
  const tiers = ctx.planTiers;
  if (!tiers?.stage || !tiers.projection) return contract;
  return applyPlanStageToContract(contract, {
    stage: tiers.stage,
    resolved: tiers.resolved,
    analysis: ctx.analysis,
    path: tiers.projection.path,
    planHash: tiers.projection.planHash,
    tier: tiers.tier,
  });
}

/** @param {Record<string, any>} base @param {Record<string, any>} ctx @param {Record<string, any>} input */
function composeProposalDecision(base, ctx, input) {
  let decision = composeDefaultDecision(ctx.evidence, {
    release: ctx.release,
    projectName: ctx.projectName,
    proposerId: typeof input.proposerId === 'string' && input.proposerId.trim() ? input.proposerId.trim().slice(0, 160) : undefined,
  });
  decision = applyDecisionPolicy(ctx.evidence, decision, { budgets: base.budgets });
  const intentGate = compileIntentGate(ctx.goal);
  let goalDiscovery = null;
  if (intentGate.status === 'CONFIRMATION_REQUIRED') {
    decision.questions = [intentGate.question];
  } else if (intentAllowsPlanning(intentGate)) {
    goalDiscovery = compileGoalDiscovery(ctx.evidence);
    decision.questions = mergeGoalDiscoveryQuestions(decision, goalDiscovery, ctx.evidence.questionBudget);
  } else {
    decision.questions = [];
  }
  decision.approvalStatus = decision.questions.length > 0
    ? 'NEEDS_INPUT'
    : intentAllowsImplementation(intentGate)
      ? 'APPROVABLE'
      : 'NOT_READY';
  decision.hash = hashObject(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'hash')));
  decision = validateDecisionPackage(ctx.evidence, decision);
  // The contract is compiled first so the approval screen can show the scope that will
  // actually be locked, stage binding included, rather than the pre-binding default.
  const contract = bindPlanStageContract(compileDecisionContract(base, decision), ctx);
  const approvalBrief = buildApprovalBrief(decision, contract);
  return { decision, intentGate, goalDiscovery, approvalBrief, contract };
}

/** @param {Record<string, any>} analysis @param {Record<string, any>} decision @param {Record<string, any>} acceptanceStrength @param {string[]} inheritedCommands @param {string[]} sourceChanges @param {Record<string, any> | null} [intentGate] @param {string[]} [planDiagnostics] @param {string[]} [scopeDiagnostics] */
function buildProposalDiagnostics(analysis, decision, acceptanceStrength, inheritedCommands, sourceChanges, intentGate = null, planDiagnostics = [], scopeDiagnostics = [], objectiveDiagnostics = []) {
  return [
    ...analysis.diagnostics,
    ...planDiagnostics,
    ...scopeDiagnostics,
    ...objectiveDiagnostics,
    ...(intentGate?.status === 'CONFIRMATION_REQUIRED' ? ['Read-only analysis is complete; confirm whether to stop at analysis, plan, implement, or run policy Autopilot.'] : []),
    ...(sourceChanges.length > 0 ? ['Review and preserve the exact baseline plan before approval.'] : []),
    ...(decision.questions.length > 0 ? ['Mandatory risks or interview questions must be resolved before approval.'] : []),
    ...(acceptanceStrength.sufficient ? [] : [acceptanceStrength.level === 'UNCOVERED' ? `Acceptance does not cover: ${(acceptanceStrength.uncoveredPaths ?? []).join(', ')}` : 'A repository-owned build, test, verify, check, package, or equivalent acceptance command is required before approval.']),
    ...(inheritedCommands.length > 0 ? [`Existing adapter commands were removed from the generated proposal: ${inheritedCommands.join(', ')}.`] : []),
  ];
}

/** @param {string} root @param {Record<string, any>} ctx @param {Record<string, any>} decisionBundle @param {Record<string, any> | null} active @param {string[]} inheritedCommands @param {Record<string, any>} input */
function assembleProposal(root, ctx, decisionBundle, active, inheritedCommands, input) {
  const { decision, intentGate, goalDiscovery, approvalBrief, contract } = decisionBundle;
  const acceptance = contract.acceptance;
  const now = new Date();
  const baseline = ctx.evidence.baseline;
  const sourceChanges = baseline.blockingPaths;
  const acceptanceStrength = classifyAcceptanceStrength(ctx.analysis);
  const id = `proposal-${now.toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  return {
    schema: 'shipping-harness/proposal-v1',
    id,
    revision: 1,
    // The build that judged this repository. A later build regenerates instead of reusing.
    harnessVersion: VERSION,
    fingerprint: ctx.fingerprint,
    projectRoot: path.resolve(root),
    gitSha: ctx.evidence.gitSha,
    release: ctx.release,
    releaseSelection: {
      explicit: typeof input.release === 'string' && input.release.trim().length > 0,
      recommended: ctx.analysis.versionEvidence?.recommendedVersion ?? null,
      evidence: ctx.analysis.versionEvidence ?? null,
    },
    goal: ctx.goal,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    mode: decision.mode,
    lifecycle: { state: 'PLANNING', supersedes: active?.proposal?.id ?? null },
    sourceChanges,
    baseline,
    intelligence: ctx.evidence.intelligence,
    intentGate,
    goalDiscovery,
    acceptanceStrength,
    workspace: ctx.analysis.workspace,
    workspaceCandidates: ctx.analysis.workspaceCandidates,
    versionEvidence: ctx.analysis.versionEvidence,
    analysis: ctx.analysis,
    evidence: ctx.evidence,
    decision,
    approvalBrief,
    contract,
    plan: intentAllowsPlanning(intentGate) ? buildShortPlan(ctx.analysis, acceptance) : [],
    tier: ctx.planTiers.tier,
    shippingPlan: ctx.planTiers.projection,
    planRequest: ctx.planRequest,
    diagnostics: buildProposalDiagnostics(ctx.analysis, decision, acceptanceStrength, inheritedCommands, sourceChanges, intentGate, ctx.planTiers.diagnostics, goalPathDiagnostics(ctx.goalPaths),
      // Measured against the goal the approver stated, not the one the contract derived:
      // a plan-driven milestone rewrites contract.goal to the stage outcome, which hid the
      // enumerated objectives the person actually asked for.
      unprovenObjectiveDiagnostics({
        goalText: typeof input?.goal === 'string' && input.goal.trim() ? input.goal : contract.goal,
        requiredAcceptanceCount: acceptance.filter((entry) => entry.required !== false).length,
      })),
    baselineCommit: baselineCommitSummary(ctx.baselineCommit),
  };
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any> | null} active */
async function persistProposal(root, proposal, active) {
  const projectedProposal = projectProposalAuthority(proposal);
  projectedProposal.hash = proposalHash(projectedProposal);
  const proposalPath = path.join(runtimePaths(root).proposals, `${projectedProposal.id}.json`);
  await assertContainedPath(root, proposalPath);
  const supersedesActive = active && !isTerminalProposalState(active.summary.state);
  if (supersedesActive) await supersedeProposal(root, active.proposal, proposal.id);
  await writeJsonAtomic(proposalPath, projectedProposal);
  await writeActiveProposalIndex(root, projectedProposal);
  await recordGoalDiscoveryEvents(root, projectedProposal, 'discovery.created', []);
  return {
    proposal: projectedProposal,
    proposalPath,
    reused: false,
    supersededProposalId: supersedesActive ? active.proposal.id : null,
  };
}

/**
 * Commit the user's working tree as one baseline commit, before anything is analyzed, so
 * the proposal is bound to a commit that cannot move under it. Off unless the caller asks
 * for it; `shipping_start` asks for it by default.
 * @param {string} root
 * @param {boolean} requested
 */
async function autoCommitBaseline(root, requested) {
  if (!requested) return null;
  const result = commitBaseline(root);
  if (!result) return null;
  await recordLedger(root, {
    type: 'baseline.autocommitted',
    sha: result.sha,
    filesCommitted: result.files.length,
    untrackedIncluded: result.untrackedIncluded.length,
    undo: result.undo,
  });
  return result;
}

/**
 * v1.13.0 Phase A.6: an auto-commit that swept the implementation into the baseline would
 * let a release close having proved nothing. When (and only when) a commit was made, run
 * the v1.12.1 lock preflight once and warn if every required criterion already passes.
 * Advisory: it never blocks, and a preflight that cannot run is simply not reported.
 * @param {string} root
 * @param {Record<string, any>} contract
 * @returns {Promise<string[]>}
 */
async function baselineAlreadyPassingDiagnostics(root, contract) {
  try {
    const rows = await runAcceptancePreflight(root, contract);
    const required = rows.filter((row) => row.required === true);
    if (required.length === 0 || !required.every((row) => row.verdict === 'ALREADY_PASSING')) return [];
    return [`BASELINE_ALREADY_PASSING: every required acceptance criterion (${required.map((row) => row.id).join(', ')}) already passes on the committed baseline, so this release would prove nothing. Approve only if that is what you intend, or undo the baseline commit with \`${BASELINE_UNDO_COMMAND}\` and start again.`];
  } catch {
    // The preflight is evidence, not a gate: an unrunnable command must not fail a proposal.
    return [];
  }
}

/**
 * Create a reviewable, Git-bound release proposal without locking a release.
 * @param {string} root
 * @param {{goal: string, release?: string | null, projectName?: string | null, mode?: string | null, proposerId?: string | null, workspaceCandidateId?: string | null, planPath?: string | null, stageId?: string | null, commitBaseline?: boolean}} input
 */
export async function createScopeProposal(root, input) {
  invariant(typeof input.goal === 'string' && input.goal.trim().length >= 5, 'ERR_PROPOSAL_GOAL', 'A concrete goal of at least 5 characters is required');
  invariant(input.goal.length <= 4000, 'ERR_PROPOSAL_GOAL', 'Goal exceeds 4000 characters');
  return withProposalLock(root, async () => {
    // Before repository analysis, so the proposal's baselineSha is the new commit.
    const baselineCommit = await autoCommitBaseline(root, input.commitBaseline === true);
    const ctx = await loadProposalContext(root, input, baselineCommit);
    const { active, reused } = await reuseMatchingProposal(root, ctx);
    if (reused) return reused;

    const base = ctx.context.contract ? structuredClone(ctx.context.contract) : createDefaultContract(ctx.projectName);
    const inheritedCommands = Object.entries(base.adapters ?? {})
      .filter(([, config]) => typeof config?.command === 'string' && config.command.trim())
      .map(([name]) => name);
    const decisionBundle = composeProposalDecision(base, ctx, input);
    const proposal = assembleProposal(root, ctx, decisionBundle, active, inheritedCommands, input);
    if (baselineCommit) {
      proposal.diagnostics = [...proposal.diagnostics, ...(await baselineAlreadyPassingDiagnostics(root, decisionBundle.contract))];
    }
    return persistProposal(root, proposal, active);
  });
}

/** @param {string} root @param {string} proposalId */
export async function loadScopeProposal(root, proposalId) {
  invariant(/^[A-Za-z0-9._-]+$/u.test(proposalId), 'ERR_PROPOSAL_ID', 'Invalid proposal ID');
  const proposalPath = path.join(runtimePaths(root).proposals, `${proposalId}.json`);
  await assertContainedPath(root, proposalPath);
  const proposal = await readJson(proposalPath);
  invariant(proposal.schema === 'shipping-harness/proposal-v1', 'ERR_PROPOSAL_INVALID', 'Unsupported proposal schema');
  invariant(proposal.id === proposalId, 'ERR_PROPOSAL_ID', 'Proposal file identity does not match the requested proposal ID');
  invariant(proposal.projectRoot === path.resolve(root), 'ERR_PROPOSAL_ROOT', 'Proposal belongs to a different repository');
  const currentHash = proposalHash(proposal);
  const legacyHash = legacyProposalHash(proposal);
  invariant(proposal.hash === currentHash || proposal.hash === legacyHash, 'ERR_PROPOSAL_TAMPERED', 'Proposal hash does not match its content');
  const projectedProposal = projectProposalAuthority(proposal);
  return { proposal, projectedProposal, proposalPath, summary: proposalSummary(projectedProposal) };
}

/** @param {unknown} value @param {number} max */
function boundedRefinementText(value, max = 1000) {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'ERR_PROPOSAL_REFINE', `Refinement text must be between 1 and ${max} characters`);
  return value.trim();
}

/** @param {string} root @param {Record<string, any>} proposal @param {string} type @param {Array<Record<string, any>>} [resolutions] */
async function recordGoalDiscoveryEvents(root, proposal, type, resolutions = []) {
  const discovery = proposal.goalDiscovery;
  if (!discovery) return null;
  await appendDecisionLedgerEvent(root, {
    type,
    proposalId: proposal.id,
    proposalRevision: proposal.revision ?? 1,
    proposalHash: proposal.hash,
    gitSha: proposal.gitSha,
    discoveryHash: discovery.hash,
    directionHash: discovery.direction?.hash ?? null,
    provenance: 'mechanical-discovery',
    evidenceRefs: ['proposal.goalDiscovery', 'proposal.evidence.hash'],
    details: goalDiscoverySummary(discovery),
  });
  for (const resolution of resolutions) {
    await appendDecisionLedgerEvent(root, {
      type: 'question.resolved',
      proposalId: proposal.id,
      proposalRevision: proposal.revision ?? 1,
      proposalHash: proposal.hash,
      gitSha: proposal.gitSha,
      discoveryHash: discovery.hash,
      directionHash: discovery.direction?.hash ?? null,
      questionId: resolution.questionId,
      choice: resolution.choice,
      provenance: resolution.usedRecommendedChoice ? 'delegated-recommended-default' : 'explicit-user-refinement',
      evidenceRefs: ['proposal.decision.resolutions', 'proposal.goalDiscovery.questions'],
      details: { category: resolution.category, usedRecommendedChoice: resolution.usedRecommendedChoice === true },
    });
  }
  if (discovery.direction) {
    await appendDecisionLedgerEvent(root, {
      type: 'direction.ready',
      proposalId: proposal.id,
      proposalRevision: proposal.revision ?? 1,
      proposalHash: proposal.hash,
      gitSha: proposal.gitSha,
      discoveryHash: discovery.hash,
      directionHash: discovery.direction.hash,
      provenance: 'mechanical-critic',
      evidenceRefs: ['proposal.goalDiscovery.direction', 'proposal.goalDiscovery.critic'],
      details: { directionId: discovery.direction.id, criticHash: discovery.critic.hash },
    });
  }
  return decisionLedgerSummary(root, proposal.id);
}

function resolveDecisionQuestions(questions, answers) {
  const available = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set();
  const resolutions = [];
  for (const answer of answers) {
    invariant(answer && typeof answer === 'object' && !Array.isArray(answer), 'ERR_PROPOSAL_REFINE', 'Each refinement answer must be an object');
    const questionId = boundedRefinementText(answer.questionId, 80);
    invariant(!seen.has(questionId), 'ERR_PROPOSAL_REFINE', `Duplicate question answer: ${questionId}`);
    seen.add(questionId);
    const question = available.get(questionId);
    invariant(question, 'ERR_PROPOSAL_REFINE', `Unknown proposal question: ${questionId}`);
    const choice = boundedRefinementText(answer.choice, 1000);
    resolutions.push({
      questionId,
      category: question.category,
      choice: choice === 'recommended' ? question.recommendedChoice : choice,
      recommendedChoice: question.recommendedChoice,
      usedRecommendedChoice: choice === 'recommended' || choice === question.recommendedChoice,
      resolvedAt: new Date().toISOString(),
      authority: 'explicit-user-refinement',
    });
  }
  return {
    remaining: questions.filter((question) => !seen.has(question.id)),
    resolutions,
  };
}

/** @param {string} root @param {Record<string, any>} input */
async function validateRefineRequest(root, input) {
  const index = await readActiveProposalIndex(root);
  invariant(index, 'ERR_PROPOSAL_ACTIVE', 'No active proposal is available to refine');
  invariant(input.proposalId === index.proposalId, 'ERR_PROPOSAL_ACTIVE', 'Only the active proposal may be refined');
  const { proposal, proposalPath, summary } = await loadScopeProposal(root, input.proposalId);
  invariant(input.proposalHash === proposal.hash && input.proposalHash === index.proposalHash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match the active revision');
  invariant(!isTerminalProposalState(summary.state), 'ERR_PROPOSAL_REFINE_STATE', `Proposal cannot be refined from ${summary.state}`);

  const requestedMode = input.mode ?? proposal.mode;
  invariant(['AUTO', 'SAFE', 'INTERVIEW'].includes(requestedMode), 'ERR_DECISION_MODE', `Unsupported decision mode: ${String(requestedMode)}`);
  if (requestedMode !== proposal.mode) {
    invariant(input.modeAuthorizedByUser === true, 'ERR_PROPOSAL_MODE_AUTHORIZATION', 'Changing proposal mode requires explicit user authorization');
  } else {
    invariant(input.modeAuthorizedByUser !== true || input.mode !== undefined, 'ERR_PROPOSAL_MODE_AUTHORIZATION', 'Mode authorization cannot be supplied without a requested mode');
  }

  const workspaceCandidateId = input.workspaceCandidateId ?? (proposal.workspace?.requested === true ? proposal.workspace.id : null);
  if (input.workspaceCandidateId !== undefined && input.workspaceCandidateId !== null) {
    boundedRefinementText(input.workspaceCandidateId, 100);
    invariant((proposal.workspaceCandidates ?? []).some((candidate) => candidate.id === input.workspaceCandidateId), 'ERR_WORKSPACE_CANDIDATE', `Unknown workspace candidate: ${input.workspaceCandidateId}`);
  }
  let answers = [...(input.answers ?? [])];
  invariant(Array.isArray(answers), 'ERR_PROPOSAL_REFINE', 'Refinement answers must be an array');
  if (input.acceptRecommendedDiscoveryDefaults === true) {
    const delegated = [proposal.intentGate?.question, ...(proposal.goalDiscovery?.questions ?? [])]
      .filter(Boolean)
      .map((question) => ({ questionId: question.id, choice: 'recommended' }));
    const supplied = new Set(answers.map((entry) => entry?.questionId));
    answers = [...answers, ...delegated.filter((entry) => !supplied.has(entry.questionId))];
  }
  invariant(answers.length <= 3, 'ERR_PROPOSAL_REFINE', 'Refinement accepts at most three grouped answers');
  invariant(answers.length > 0 || input.workspaceCandidateId || requestedMode !== proposal.mode || input.rescan === true || typeof input.stageId === 'string', 'ERR_PROPOSAL_REFINE', 'Refinement must include an answer, workspace selection, authorized mode change, plan stage, or rescan');
  if (input.baselinePlanHash !== undefined) invariant(/^[a-f0-9]{64}$/u.test(input.baselinePlanHash), 'ERR_BASELINE_PLAN', 'baselinePlanHash must be a SHA-256 hex digest');
  if (input.baselineCommit !== undefined) invariant(/^[a-f0-9]{40}$/u.test(input.baselineCommit), 'ERR_BASELINE_COMMIT', 'baselineCommit must be a full Git SHA');
  invariant(input.baselineAuthorizedByUser !== true || (input.baselinePlanHash && input.baselineCommit), 'ERR_BASELINE_APPROVAL', 'Baseline authorization requires the reviewed plan hash and commit SHA');

  return { index, proposal, proposalPath, summary, requestedMode, workspaceCandidateId, answers };
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any>} summary @param {string} requestedMode @param {string | null} workspaceCandidateId @param {Record<string, any>} input */
async function buildRefineEvidence(root, proposal, summary, requestedMode, workspaceCandidateId, input) {
  const evidence = await buildDecisionEvidence(root, {
    goal: proposal.goal,
    mode: requestedMode,
    workspaceCandidateId,
  });
  const analysis = evidence.analysis;
  let baselinePreservation = proposal.baselinePreservation ?? null;
  const baselineChanged = proposal.baseline?.plan?.fileSetHash !== evidence.baseline?.plan?.fileSetHash
    || proposal.gitSha !== evidence.gitSha;
  if (summary.state === 'DIRTY_BASELINE' && baselineChanged) {
    invariant(proposal.gitSha !== evidence.gitSha, 'ERR_BASELINE_UNAUTHORIZED', 'Dirty baseline changed without a reviewed preservation commit');
    baselinePreservation = verifyBaselinePreservation(root, proposal.baseline, input);
  }
  const release = proposal.releaseSelection?.explicit
    ? proposal.release
    : (analysis.versionEvidence?.recommendedVersion ?? proposal.release);
  const context = await currentReleaseContext(root);
  const projectName = safeProjectName(analysis.projectName, proposal.decision?.projectName ?? path.basename(root));
  const base = context.contract ? structuredClone(context.contract) : createDefaultContract(projectName);
  const planRequest = {
    path: input.planPath ?? proposal.planRequest?.path ?? null,
    stageId: input.stageId ?? proposal.planRequest?.stageId ?? null,
  };
  const planTiers = await loadPlanTiers(root, planRequest, analysis, proposal.goal);
  return { evidence, analysis, baselinePreservation, release, projectName, base, planTiers, planRequest };
}

/** @param {Record<string, any>} evidenceCtx @param {Record<string, any>} proposal @param {Array<{questionId:string,choice:string}>} answers */
function composeRefineDecision(evidenceCtx, proposal, answers) {
  const { evidence, base, release, projectName } = evidenceCtx;
  let decision = composeDefaultDecision(evidence, {
    release,
    projectName,
    proposerId: proposal.decision?.proposer?.id ?? 'mcp-host-agent',
  });
  decision = applyDecisionPolicy(evidence, decision, { budgets: base.budgets });
  const policyQuestions = [...(decision.questions ?? [])];
  const priorResolutions = proposal.decision?.resolutions ?? [];
  const preliminaryIntent = compileIntentGate(proposal.goal, { resolutions: priorResolutions });
  const answeredDiscovery = answers.some((entry) => String(entry?.questionId ?? '').startsWith('Q-GOAL-'));
  const discoveryRound = Math.min(2, (proposal.goalDiscovery?.round ?? 1) + (answeredDiscovery ? 1 : 0));
  let goalDiscovery = intentAllowsPlanning(preliminaryIntent)
    ? compileGoalDiscovery(evidence, { resolutions: priorResolutions, round: discoveryRound })
    : null;
  if (preliminaryIntent.status === 'CONFIRMATION_REQUIRED') decision.questions = [preliminaryIntent.question];
  else if (goalDiscovery) decision.questions = mergeGoalDiscoveryQuestions({ ...decision, questions: policyQuestions }, goalDiscovery, evidence.questionBudget);
  else decision.questions = [];
  const availableQuestions = new Map([
    ...(proposal.decision?.questions ?? []).map((question) => [question.id, question]),
    ...(proposal.intentGate?.question ? [[proposal.intentGate.question.id, proposal.intentGate.question]] : []),
    ...((goalDiscovery?.questions ?? []).map((question) => [question.id, question])),
    ...(decision.questions ?? []).map((question) => [question.id, question]),
  ]);
  const previouslyResolvedIds = new Set(priorResolutions.map((entry) => entry.questionId));
  decision.questions = decision.questions.filter((question) => !previouslyResolvedIds.has(question.id));
  const resolved = resolveDecisionQuestions([...availableQuestions.values()], answers);
  const answeredIds = new Set(resolved.resolutions.map((entry) => entry.questionId));
  decision.questions = decision.questions.filter((question) => !answeredIds.has(question.id));
  decision.resolutions = [
    ...(proposal.decision?.resolutions ?? []),
    ...resolved.resolutions,
  ].slice(-20);
  const intentGate = compileIntentGate(proposal.goal, { resolutions: decision.resolutions });
  const resolvedIds = new Set(decision.resolutions.map((entry) => entry.questionId));
  if (intentGate.status === 'CONFIRMATION_REQUIRED') {
    goalDiscovery = null;
    decision.questions = [intentGate.question];
  } else if (intentAllowsPlanning(intentGate)) {
    goalDiscovery = compileGoalDiscovery(evidence, { resolutions: decision.resolutions, round: discoveryRound });
    decision.questions = mergeGoalDiscoveryQuestions({
      ...decision,
      questions: policyQuestions.filter((question) => !resolvedIds.has(question.id) && question.id !== intentGate.question?.id),
    }, goalDiscovery, evidence.questionBudget);
  } else {
    goalDiscovery = null;
    decision.questions = [];
  }
  decision.approvalStatus = decision.questions.length > 0
    ? 'NEEDS_INPUT'
    : intentAllowsImplementation(intentGate)
      ? 'APPROVABLE'
      : 'NOT_READY';
  decision.hash = hashObject(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'hash')));
  decision = validateDecisionPackage(evidence, decision);
  const contract = bindPlanStageContract(compileDecisionContract(base, decision), evidenceCtx);
  const approvalBrief = buildApprovalBrief(decision, contract);
  return { decision, intentGate, goalDiscovery, resolved, approvalBrief, contract };
}

/** @param {Record<string, any>} evidenceCtx @param {Record<string, any>} proposal @param {Record<string, any> | null} baselinePreservation */
function mergeRefineIntelligence(evidenceCtx, proposal, baselinePreservation) {
  const { evidence, analysis } = evidenceCtx;
  let intelligence = evidence.intelligence;
  let proposalAnalysis = analysis;
  if (baselinePreservation && proposal.intelligence) {
    intelligence = {
      ...intelligence,
      workThemes: proposal.intelligence.workThemes,
      goalRecommendation: proposal.intelligence.goalRecommendation,
      acceptanceCoverage: proposal.intelligence.acceptanceCoverage,
      preservedBaseline: {
        planHash: proposal.baseline?.plan?.hash ?? null,
        commit: baselinePreservation.commit,
      },
    };
    proposalAnalysis = { ...analysis, intelligence };
  }
  return { intelligence, proposalAnalysis };
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any>} evidenceCtx @param {Record<string, any>} decisionBundle @param {string} requestedMode */
function buildRefineCandidate(root, proposal, evidenceCtx, decisionBundle, requestedMode) {
  const { evidence, analysis, baselinePreservation, release, projectName } = evidenceCtx;
  const { decision, intentGate, goalDiscovery, approvalBrief, contract } = decisionBundle;
  const baseline = evidence.baseline;
  const sourceChanges = baseline.blockingPaths;
  const { intelligence, proposalAnalysis } = mergeRefineIntelligence(evidenceCtx, proposal, baselinePreservation);
  const acceptanceStrength = classifyAcceptanceStrength(proposalAnalysis);
  const now = new Date();
  /** @type {Record<string, any>} */
  const candidate = {
    ...proposal,
    revision: proposal.revision ?? 1,
    previousHash: proposal.previousHash,
    gitSha: evidence.gitSha,
    release,
    releaseSelection: {
      explicit: proposal.releaseSelection?.explicit === true,
      recommended: analysis.versionEvidence?.recommendedVersion ?? null,
      evidence: analysis.versionEvidence ?? null,
    },
    mode: decision.mode,
    modeAuthorization: requestedMode !== proposal.mode
      ? { userConfirmed: true, from: proposal.mode, to: requestedMode, recordedAt: now.toISOString() }
      : proposal.modeAuthorization ?? null,
    fingerprint: proposalFingerprint({
      projectRoot: path.resolve(root),
      gitSha: evidence.gitSha,
      goal: proposal.goal,
      release,
      mode: decision.mode,
      projectName,
    }),
    refinedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    lifecycle: { state: 'PLANNING', supersedes: proposal.lifecycle?.supersedes ?? null },
    sourceChanges,
    baseline,
    baselinePreservation,
    intelligence,
    intentGate,
    goalDiscovery,
    acceptanceStrength,
    workspace: proposalAnalysis.workspace,
    workspaceCandidates: proposalAnalysis.workspaceCandidates,
    versionEvidence: proposalAnalysis.versionEvidence,
    analysis: proposalAnalysis,
    evidence,
    decision,
    approvalBrief,
    contract,
    plan: intentAllowsPlanning(intentGate) ? buildShortPlan(proposalAnalysis, contract.acceptance) : [],
    tier: evidenceCtx.planTiers.tier,
    shippingPlan: evidenceCtx.planTiers.projection,
    planRequest: evidenceCtx.planRequest,
    diagnostics: [
      ...proposalAnalysis.diagnostics,
      ...evidenceCtx.planTiers.diagnostics,
      ...(intentGate?.status === 'CONFIRMATION_REQUIRED' ? ['Read-only analysis is complete; confirm whether to stop at analysis, plan, implement, or run policy Autopilot.'] : []),
      ...(sourceChanges.length > 0 ? ['Review and preserve the exact baseline plan before approval.'] : []),
      ...(decision.questions.length > 0 ? ['Mandatory risks or interview questions must be resolved before approval.'] : []),
      ...(acceptanceStrength.sufficient ? [] : [acceptanceStrength.level === 'UNCOVERED' ? `Acceptance does not cover: ${(acceptanceStrength.uncoveredPaths ?? []).join(', ')}` : 'A repository-owned build, test, verify, check, package, or equivalent acceptance command is required before approval.']),
    ],
  };
  delete candidate.approval;
  return candidate;
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any>} candidate @param {string} proposalPath @param {{resolutions: Array<Record<string, any>>}} resolved */
async function persistRefinedProposal(root, proposal, candidate, proposalPath, resolved) {
  const projectedCandidate = projectProposalAuthority(candidate);
  const projectedCurrent = projectProposalAuthority(proposal);
  if (authorityFingerprint(projectedCandidate) === authorityFingerprint(projectedCurrent)) {
    return {
      proposal: projectedCurrent,
      proposalPath,
      archivedRevisionPath: null,
      resolutions: [],
      changed: false,
    };
  }

  const revision = (proposal.revision ?? 1) + 1;
  const archivePath = path.join(runtimePaths(root).proposals, `${proposal.id}.r${proposal.revision ?? 1}.json`);
  await assertContainedPath(root, archivePath);
  if (await exists(archivePath)) {
    const archived = await readJson(archivePath);
    invariant(archived.hash === proposal.hash, 'ERR_PROPOSAL_REVISION', 'Archived proposal revision does not match the active revision');
  } else {
    await writeJsonAtomic(archivePath, proposal);
  }

  const updated = projectProposalAuthority({
    ...projectedCandidate,
    revision,
    previousHash: proposal.hash,
  });
  updated.hash = proposalHash(updated);
  await writeJsonAtomic(proposalPath, updated);
  await writeActiveProposalIndex(root, updated);
  await recordGoalDiscoveryEvents(root, updated, 'discovery.refined', resolved.resolutions);
  return {
    proposal: updated,
    proposalPath,
    archivedRevisionPath: path.relative(root, archivePath).replaceAll('\\', '/'),
    resolutions: resolved.resolutions,
    changed: true,
  };
}

/**
 * Refine one active proposal identity using bounded structured user decisions.
 * @param {string} root
 * @param {{proposalId:string, proposalHash:string, answers?:Array<{questionId:string,choice:string}>, acceptRecommendedDiscoveryDefaults?:boolean, workspaceCandidateId?:string|null, mode?:string|null, modeAuthorizedByUser?:boolean, rescan?:boolean, baselinePlanHash?:string, baselineCommit?:string, baselineAuthorizedByUser?:boolean, stageId?:string|null, planPath?:string|null}} input
 */
export async function refineScopeProposal(root, input) {
  return withProposalLock(root, async () => {
    const { proposal, proposalPath, summary, requestedMode, workspaceCandidateId, answers } = await validateRefineRequest(root, input);
    const evidenceCtx = await buildRefineEvidence(root, proposal, summary, requestedMode, workspaceCandidateId, input);
    const decisionBundle = composeRefineDecision(evidenceCtx, proposal, answers);
    const candidate = buildRefineCandidate(root, proposal, evidenceCtx, decisionBundle, requestedMode);
    return persistRefinedProposal(root, proposal, candidate, proposalPath, decisionBundle.resolved);
  });
}

/** @param {string} root @param {Record<string, any>} input */
async function authorizeApproval(root, input) {
  const approverType = input.approverType ?? 'human';
  const approverId = typeof input.approverId === 'string' && input.approverId.trim() ? input.approverId.trim().slice(0, 160) : 'local-user';
  if (approverType === 'human') {
    invariant(input.confirm === true, 'ERR_APPROVAL_REQUIRED', 'Explicit confirm=true is required to approve scope');
  } else {
    invariant(approverType === 'autopilot-policy', 'ERR_MODEL_SELF_APPROVAL', 'Only a human approver or a verified autopilot policy may lock a decision proposal');
    const policy = await loadAutopilotPolicy(root);
    const authorization = validateAutopilotDecision(input.policyAuthorization);
    invariant(policy && authorization.policyHash === policy.hash, 'ERR_AUTOPILOT_POLICY_BINDING', 'Autopilot approval belongs to a different policy');
    invariant(authorization.action === 'ADVANCE_RELEASE' && authorization.allowed === true && ['AUTO', 'NOTIFY'].includes(authorization.decision), 'ERR_AUTOPILOT_ADVANCE', 'Autopilot policy did not authorize the next release');
  }
  return { approverType, approverId };
}

/**
 * The PROGRAM layer carries no authority: a hash derived from the program projection can
 * never be used to approve anything.
 * @param {string} root @param {string} suppliedHash
 */
async function assertNotProgramHash(root, suppliedHash) {
  const active = await findActiveScopeProposal(root);
  const program = active?.projectedProposal?.shippingPlan?.program ?? null;
  if (!program) return;
  invariant(suppliedHash !== hashObject(program), 'ERR_PLAN_PROGRAM_NOT_APPROVABLE', 'The PROGRAM plan layer has no approval authority; approve the MILESTONE or PATCH proposal instead', {
    stageCount: program.stages?.length ?? 0,
  });
}

/** @param {string} root @param {Record<string, any>} input @param {string} approverType @param {string} approverId */
async function validateApprovableProposal(root, input, approverType, approverId) {
  await assertNotProgramHash(root, input.proposalHash);
  const existingPaths = runtimePaths(root);
  if (await exists(existingPaths.state)) {
    const existingState = await readState(root);
    invariant(['DRAFT', 'CLOSED'].includes(existingState.state), 'ERR_APPROVAL_STATE', `Scope can be approved only from DRAFT or CLOSED, current state is ${existingState.state}`);
  }
  const activeIndex = await readActiveProposalIndex(root);
  invariant(activeIndex?.proposalId === input.proposalId, 'ERR_PROPOSAL_ACTIVE', 'Only the active proposal may be approved');
  invariant(activeIndex?.proposalHash === input.proposalHash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match the active revision');
  const { proposal, projectedProposal, proposalPath, summary } = await loadScopeProposal(root, input.proposalId);
  invariant(input.proposalHash === proposal.hash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match');
  invariant(summary.state === 'READY_FOR_APPROVAL', 'ERR_DECISION_NEEDS_INPUT', `Proposal has unresolved mandatory risks or questions, a dirty baseline, weak acceptance, or another non-ready condition: ${summary.state}`);
  invariant(projectedProposal.intentGate?.status === 'CONFIRMED' && intentAllowsImplementation(projectedProposal.intentGate), 'ERR_INTENT_NOT_IMPLEMENTABLE', 'Scope approval requires an explicitly confirmed IMPLEMENT or AUTOPILOT intent');
  invariant(projectedProposal.goalDiscovery?.status === 'READY' && projectedProposal.goalDiscovery?.direction, 'ERR_DIRECTION_NOT_READY', 'A bounded accepted direction is required before scope approval');
  if (approverType === 'human') invariant(approverId !== proposal.decision?.proposer?.id, 'ERR_MODEL_SELF_APPROVAL', 'The proposer cannot approve its own decision package');
  invariant(Date.parse(proposal.expiresAt) > Date.now(), 'ERR_PROPOSAL_EXPIRED', 'Proposal has expired; create a new proposal');
  invariant(currentGitSha(root) === proposal.gitSha, 'ERR_PROPOSAL_STALE', 'Repository HEAD changed after proposal creation');
  const baseline = currentBaseline(root);
  const sourceChanges = baseline.blockingPaths;
  invariant(sourceChanges.length === 0, 'ERR_PROPOSAL_DIRTY', 'Review and preserve blocking baseline changes before approval', { sourceChanges, baseline });
  return { proposal, projectedProposal, proposalPath };
}

/** @param {string} root @param {Record<string, any>} proposal */
async function lockApprovedContract(root, proposal) {
  const paths = runtimePaths(root);
  await assertContainedPath(root, paths.directory);
  await assertContainedPath(root, paths.contract);
  let state = (await exists(paths.state)) ? await readState(root) : null;
  if (!state) {
    await initializeState(root);
    state = await readState(root);
  } else if (state.state === 'CLOSED') {
    await prepareNextRelease(root, { release: proposal.release, goal: proposal.goal });
    state = await readState(root);
  }
  invariant(state.state === 'DRAFT', 'ERR_APPROVAL_STATE', `Scope can be approved only from DRAFT, current state is ${state.state}`);
  await writeAtomic(paths.contract, stableStringify(validateContract(proposal.contract)));
  invariant(currentGitSha(root) === proposal.gitSha && currentBaseline(root).blockingPaths.length === 0, 'ERR_PROPOSAL_STALE', 'Repository changed during proposal approval');
  const sha = currentGitSha(root);
  return lockContract(root, sha);
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any>} projectedProposal @param {Record<string, any>} lock @param {string} approverType @param {string} approverId */
async function persistApprovalArtifacts(root, proposal, projectedProposal, lock, approverType, approverId) {
  const approvedAt = new Date().toISOString();
  const acceptedGoalCharter = acceptGoalCharter(projectedProposal.goalCharter, {
    proposalHash: proposal.hash,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    releaseTrainHash: projectedProposal.releaseTrain.hash,
    approverType,
    approverId,
    acceptedAt: approvedAt,
  });
  const persistedTrain = await persistApprovedReleaseTrain(root, projectedProposal.releaseTrain, {
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    goalCharterHash: acceptedGoalCharter.hash,
    approvedAt,
  });
  const persistedCharter = await persistAcceptedGoalCharter(root, acceptedGoalCharter);
  return { approvedAt, acceptedGoalCharter, persistedTrain, persistedCharter };
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any>} projectedProposal @param {Record<string, any>} contract @param {Record<string, any>} lock @param {Record<string, any>} artifacts @param {string} approverType @param {string} approverId */
async function recordApprovalState(root, proposal, projectedProposal, contract, lock, artifacts, approverType, approverId) {
  const { approvedAt, acceptedGoalCharter, persistedTrain, persistedCharter } = artifacts;
  const locked = await transitionState(root, 'LOCKED', {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    approvedProposalId: proposal.id,
    approvedProposalHash: proposal.hash,
    releaseTrainHash: projectedProposal.releaseTrain.hash,
    releaseTrainPath: path.relative(root, persistedTrain.path).replaceAll('\\', '/'),
    goalCharterHash: acceptedGoalCharter.hash,
    goalCharterPath: path.relative(root, persistedCharter.path).replaceAll('\\', '/'),
  }, approverType === 'autopilot-policy' ? 'scope proposal approved by pre-authorized autopilot policy' : 'scope proposal explicitly approved');
  /** @type {Record<string, any>} */
  const approved = {
    ...proposal,
    releaseTrain: projectedProposal.releaseTrain,
    releaseTrainSummary: projectedProposal.releaseTrainSummary,
    goalCharter: acceptedGoalCharter,
    approval: {
      confirmed: true,
      approvedAt,
      approverType,
      approverId,
      contractHash: lock.contractHash,
      baselineSha: lock.baselineSha,
    },
  };
  return { locked, approved };
}

/** @param {string} root @param {Record<string, any>} proposal @param {Record<string, any>} projectedProposal @param {Record<string, any>} approved @param {Record<string, any>} contract @param {Record<string, any>} lock @param {string} approverType @param {string} approverId @param {Record<string, any>} input */
async function recordApprovalLedger(root, proposal, projectedProposal, approved, contract, lock, approverType, approverId, input) {
  await appendDecisionLedgerEvent(root, {
    type: 'direction.accepted',
    proposalId: proposal.id,
    proposalRevision: proposal.revision ?? 1,
    proposalHash: proposal.hash,
    gitSha: proposal.gitSha,
    discoveryHash: projectedProposal.goalDiscovery.hash,
    directionHash: projectedProposal.goalDiscovery.direction.hash,
    provenance: approverType === 'autopilot-policy' ? 'policy-authorized-continuation' : 'explicit-human-approval',
    evidenceRefs: ['proposal.goalDiscovery.direction', 'proposal.goalCharter', 'proposal.approval'],
    details: { approverType, approverId, contractHash: lock.contractHash, goalCharterHash: approved.goalCharter.hash },
  });
  await recordLedger(root, {
    type: 'proposal.approved',
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    releaseTrainHash: projectedProposal.releaseTrain.hash,
    goalCharterHash: approved.goalCharter.hash,
    approverType,
    policyAuthorizationHash: input.policyAuthorization?.hash ?? null,
  });
}

/**
 * Approve a proposal and atomically move the release into LOCKED state.
 * @param {string} root
 * @param {{proposalId: string, proposalHash: string, confirm: boolean, approverType?: string, approverId?: string, policyAuthorization?: Record<string,any>|null}} input
 */
export async function approveScopeProposal(root, input) {
  const { approverType, approverId } = await authorizeApproval(root, input);
  const { proposal, projectedProposal, proposalPath } = await validateApprovableProposal(root, input, approverType, approverId);
  const { contract, lock } = await lockApprovedContract(root, proposal);
  const artifacts = await persistApprovalArtifacts(root, proposal, projectedProposal, lock, approverType, approverId);
  const { locked, approved } = await recordApprovalState(root, proposal, projectedProposal, contract, lock, artifacts, approverType, approverId);
  await writeJsonAtomic(proposalPath, approved);
  await writeActiveProposalIndex(root, approved);
  await recordApprovalLedger(root, proposal, projectedProposal, approved, contract, lock, approverType, approverId, input);
  return { proposal: approved, contract, lock, state: locked, releaseTrain: artifacts.persistedTrain.envelope, goalCharter: artifacts.acceptedGoalCharter };
}