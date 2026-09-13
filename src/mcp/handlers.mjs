// Per-tool handlers for the nine shipping_* MCP tools. SHIPPING_TOOLS (the
// name/schema/annotation definitions) stays in tools.mjs; this module holds
// only the behavior. Each exported handler is looked up by tool name from
// TOOL_HANDLERS in tools.mjs after common argument-shape checks run there.
import { executeShippingPrivateOmo } from '../../packages/internal-omo-bridge/index.mjs';
import { executeAdapter } from '../adapters/runner.mjs';
import { configuredCommand } from '../adapters/sdk.mjs';
import { assertLockedContract } from '../core/contract.mjs';
import { invariant } from '../core/errors.mjs';
import { exists } from '../core/fs.mjs';
import { beginFixCycle, closeRelease, releaseStatus, verifyRelease } from '../core/gate.mjs';
import { runGit } from '../core/git.mjs';
import { runtimePaths } from '../core/paths.mjs';
import { proposalNextAction } from '../core/proposal-state.mjs';
import { loadApprovedReleaseTrain, releaseTrainSummary } from '../core/release-train.mjs';
import { decisionLedgerSummary } from '../core/decision-ledger.mjs';
import { goalCharterSummary, loadGoalCharter } from '../core/goal-charter.mjs';
import { AUTOPILOT_PROFILES, autopilotPolicySummary } from '../core/autopilot-policy.mjs';
import {
  activateAutopilot,
  autopilotStatus,
  completeAutopilotClosure,
  completeManualAutopilotClosure,
  deriveAutopilotClosureFacts,
  evaluateAutopilotAction,
  loadAutopilotPolicy,
  loadAutopilotState,
  rotateAutopilotPolicy,
  setAutopilotHumanControl,
} from '../core/autopilot.mjs';
import { approveScopeProposal, createScopeProposal, findActiveScopeProposal, refineScopeProposal } from '../core/proposals.mjs';
import { abort, pause, readTrustedState, resume } from '../core/state.mjs';
import { buildBlockerView, buildUserStatusView } from './user-view.mjs';
import { abortGoalRuntime, pauseGoalRuntime, resumeGoalRuntime } from '../core/goals/authority.mjs';
import { ADAPTERS } from './constants.mjs';
import { complete, rejectUnknownKeys, requiredString } from './validation.mjs';

/** @param {Record<string, any>} contract */
function workOrder(contract) {
  return {
    mode: 'host-agent',
    project: contract.project,
    release: contract.release,
    goal: contract.goal,
    scope: contract.scope,
    acceptance: contract.acceptance,
    instructions: [
      'Implement only the locked goal and approved paths.',
      'Do not edit .shipping/contract.yaml or .shipping/contract.lock.',
      'Do not add optional features; record them for the next release.',
      'After editing the repository, call shipping_verify.',
    ],
  };
}

/** @param {Record<string, any>} contract @param {string | undefined} requested */
function chooseConfiguredAdapter(contract, requested) {
  if (requested) {
    const command = configuredCommand(contract.adapters?.[requested]);
    invariant(command, 'ERR_ADAPTER_COMMAND_REQUIRED', `No approved command is configured for ${requested}`);
    return requested;
  }
  return ADAPTERS.find((name) => configuredCommand(contract.adapters?.[name])) ?? null;
}

function adapterCommandEffects(command) {
  const text = String(command ?? '').trim().toLowerCase();
  if (!text) return ['LOCAL_REVERSIBLE'];
  if (/\b(?:deploy|publish|npm publish|release-to|terraform apply|kubectl apply|helm upgrade|aws |gcloud |az |ssh |scp |curl |wget )\b/u.test(text)) return ['EXTERNAL_NETWORK_WRITE', 'PRODUCTION'];
  if (/\b(?:migrate|migration|alembic upgrade|prisma migrate|drop table|truncate)\b/u.test(text)) return ['DATA_STATE'];
  if (/\b(?:chmod|chown|security policy|permission|role binding|auth policy)\b/u.test(text)) return ['SECURITY_POLICY'];
  if (/^(?:node|npm|pnpm|yarn|bun|python|python3|pytest|make|cargo|go|swift|gradle|mvn|\.\/)[\s\S]*/u.test(text)) return ['LOCAL_REVERSIBLE'];
  return ['UNKNOWN'];
}

async function safeAutopilotStatus(root) {
  try {
    return { autopilot: await autopilotStatus(root), autopilotError: null };
  } catch (error) {
    return {
      autopilot: null,
      autopilotError: {
        code: error?.code ?? 'ERR_AUTOPILOT_STATUS',
        message: String(error?.message ?? 'Autopilot status failed').slice(0, 500),
      },
    };
  }
}

function closureReceiptTracked(root, release) {
  const target = `.shipping/releases/${release}.json`;
  return runGit(root, ['ls-files', '--error-unmatch', target], { allowFailure: true }).exitCode === 0;
}

async function maybeAutopilotClose(root, verification) {
  const status = await autopilotStatus(root);
  if (!status?.enabled) return null;
  const binding = await loadApprovedReleaseTrain(root);
  const policy = await loadAutopilotPolicy(root);
  invariant(binding?.train && policy, 'ERR_AUTOPILOT_INACTIVE', 'Autopilot close requires an approved train and policy');
  const facts = deriveAutopilotClosureFacts({ policy, train: binding.train, verification });
  const evaluated = await evaluateAutopilotAction(root, facts);
  if (!evaluated.decision.allowed) {
    return { decision: evaluated.decision, facts, closed: false, released: false };
  }
  const closeResult = await closeRelease(root);
  const completed = await completeAutopilotClosure(root, closeResult, evaluated.decision);
  return {
    decision: evaluated.decision,
    facts,
    closed: true,
    released: false,
    release: closeResult.receipt.release,
    state: closeResult.state.state,
    receiptPath: closeResult.receiptPath,
    reportPath: closeResult.reportPath,
    backlogCount: closeResult.backlog.items.length,
    autopilotState: completed.state,
  };
}

/** @param {string} root */
async function statusOrUninitialized(root) {
  const active = await findActiveScopeProposal(root);
  const pendingProposal = active && !['APPROVED', 'SUPERSEDED', 'EXPIRED'].includes(active.summary.state)
    ? active.summary
    : null;
  const autopilotProjection = await safeAutopilotStatus(root);
  const acceptedGoalCharter = await loadGoalCharter(root);
  if (!(await exists(runtimePaths(root).state))) {
    return {
      initialized: false,
      state: pendingProposal ? 'PROPOSAL' : 'UNINITIALIZED',
      pendingProposal,
      goalCharter: acceptedGoalCharter,
      goalCharterSummary: goalCharterSummary(acceptedGoalCharter),
      nextAction: pendingProposal
        ? 'Resolve the active proposal state before approval.'
        : 'Call shipping_start with the desired release outcome.',
      ...autopilotProjection,
    };
  }
  const status = await releaseStatus(root);
  const releaseTrainBinding = await loadApprovedReleaseTrain(root);
  return {
    initialized: true,
    ...status,
    pendingProposal,
    goalCharter: acceptedGoalCharter,
    goalCharterSummary: goalCharterSummary(acceptedGoalCharter),
    releaseTrain: releaseTrainBinding?.train ?? null,
    releaseTrainSummary: releaseTrainBinding?.train ? releaseTrainSummary(releaseTrainBinding.train) : null,
    releaseTrainBinding: releaseTrainBinding?.binding ?? null,
    ...autopilotProjection,
  };
}

/** @param {Record<string, any>} args */
function validateStartArgs(args) {
  rejectUnknownKeys(args, ['goal', 'release', 'projectName', 'mode', 'proposerId']);
  const goal = requiredString(args.goal, 'goal', 5, 4000);
  if (args.release !== undefined) requiredString(args.release, 'release', 5, 80);
  if (args.projectName !== undefined) requiredString(args.projectName, 'projectName', 1, 120);
  if (args.mode !== undefined) invariant(args.mode === 'AUTO', 'ERR_PROPOSAL_MODE_AUTHORIZATION', 'Unsupported decision mode for shipping_start: only AUTO is allowed; a host agent cannot silently switch decision mode');
  if (args.proposerId !== undefined) requiredString(args.proposerId, 'proposerId', 1, 160);
  return goal;
}

/**
 * The user-facing action list for one shipping_start proposal state.
 * @param {Record<string, any>} proposal
 * @returns {string[]}
 */
function startUserActions(proposal) {
  if (proposal.readyForApproval) return ['approve', 'edit-scope', 'stop'];
  const actions = {
    INTENT_CONFIRMATION_REQUIRED: ['confirm-intent', 'review-analysis', 'stop'],
    ANALYSIS_COMPLETE: ['review-analysis', 'confirm-intent', 'stop'],
    PLAN_COMPLETE: ['review-plan', 'confirm-intent', 'stop'],
    DIRTY_BASELINE: ['preserve-baseline', 'inspect-changes', 'stop'],
    NEEDS_ACCEPTANCE: ['inspect-acceptance', 'stop'],
  };
  return actions[proposal.canonicalState] ?? ['answer-questions', 'stop'];
}

/**
 * The one-sentence next step printed with a shipping_start result.
 * @param {Record<string, any>} proposal
 * @returns {string}
 */
function startNextStep(proposal) {
  if (proposal.readyForApproval) return 'Review the one-screen approval brief, then call shipping_approve_scope with the exact proposal ID and hash.';
  const steps = {
    INTENT_CONFIRMATION_REQUIRED: 'Read-only analysis is complete. Confirm ANALYZE_ONLY, PLAN_ONLY, IMPLEMENT, or AUTOPILOT before continuing.',
    ANALYSIS_COMPLETE: 'Read-only analysis is complete; no planning, mutation, verification execution, or closure was requested.',
    PLAN_COMPLETE: 'The version plan is complete; implementation requires a separately confirmed IMPLEMENT or AUTOPILOT intent.',
    DIRTY_BASELINE: 'Review the exact baseline preservation plan before approval.',
    NEEDS_ACCEPTANCE: 'A repository-owned build, test, verify, check, package, or equivalent acceptance command must be detected before approval.',
  };
  return steps[proposal.canonicalState] ?? 'Resolve the grouped exception questions before approval.';
}

/** @param {Record<string, any>} proposal @param {string} root */
async function buildStartData(proposal, root) {
  return {
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    release: proposal.release,
    goal: proposal.goal,
    mode: proposal.mode,
    proposalState: proposal.canonicalState,
    readyForApproval: proposal.readyForApproval,
    approvalStatus: proposal.canonicalState,
    decisionStatus: proposal.decision.approvalStatus,
    approvalBrief: proposal.approvalBrief,
    questions: proposal.decision.questions,
    proposer: proposal.decision.proposer,
    workspace: proposal.workspace,
    workspaceCandidates: proposal.workspaceCandidates,
    versionEvidence: proposal.versionEvidence,
    baseline: proposal.baseline,
    intelligence: proposal.intelligence,
    intentGate: proposal.intentGate ?? null,
    oneScreenApproval: proposal.oneScreenApproval,
    briefFactGraph: proposal.briefFactGraph,
    actionEnvelope: proposal.actionEnvelope,
    plainBrief: proposal.plainBrief,
    plainBriefText: proposal.plainBriefText,
    plainBriefError: proposal.plainBriefError,
    releaseTrain: proposal.releaseTrain,
    releaseTrainSummary: proposal.releaseTrainSummary,
    goalDiscovery: proposal.goalDiscovery ?? null,
    goalCharter: proposal.goalCharter ?? null,
    decisionLedger: await decisionLedgerSummary(root, proposal.id),
    nextAction: proposalNextAction(proposal.canonicalState),
    acceptanceStrength: proposal.acceptanceStrength,
    scope: proposal.contract.scope,
    acceptance: proposal.contract.acceptance,
    plan: proposal.plan,
    detected: proposal.analysis,
    diagnostics: proposal.diagnostics,
    approvalRequired: proposal.intentGate?.implementationAllowed === true,
    userView: {
      schema: 'shipping-harness/approval-user-view-v1',
      userState: proposal.readyForApproval ? 'AWAITING_APPROVAL' : proposal.canonicalState,
      outcome: proposal.approvalBrief.outcome,
      included: proposal.approvalBrief.included,
      deferred: proposal.approvalBrief.deferred,
      acceptance: proposal.approvalBrief.acceptance,
      assumptions: proposal.approvalBrief.assumptions,
      risks: proposal.approvalBrief.risks,
      questions: proposal.approvalBrief.questions,
      limits: proposal.approvalBrief.limits,
      intentGate: proposal.intentGate ?? null,
      releaseTrain: proposal.releaseTrainSummary,
      actions: startUserActions(proposal),
    },
  };
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleStart(root, args) {
  const goal = validateStartArgs(args);
  const { proposal, proposalPath, reused, supersededProposalId } = await createScopeProposal(root, {
    goal,
    release: args.release,
    projectName: args.projectName,
    mode: args.mode,
    proposerId: args.proposerId ?? 'mcp-host-agent',
  });
  const data = { ...(await buildStartData(proposal, root)), reused, supersededProposalId, proposalPath };
  const next = startNextStep(proposal);
  return complete(data, proposal.plainBriefText ?? `${reused ? 'Reused' : 'Proposed'} ${proposal.release} in ${proposal.mode} mode. State: ${proposal.canonicalState}. ${next}`);
}

/** @param {Record<string, any>} args */
function validateRefineArgs(args) {
  rejectUnknownKeys(args, ['proposalId', 'proposalHash', 'answers', 'acceptRecommendedDiscoveryDefaults', 'workspaceCandidateId', 'mode', 'modeAuthorizedByUser', 'rescan', 'baselinePlanHash', 'baselineCommit', 'baselineAuthorizedByUser']);
  const proposalId = requiredString(args.proposalId, 'proposalId', 1, 160);
  const proposalHash = requiredString(args.proposalHash, 'proposalHash', 64, 64);
  invariant(/^[a-f0-9]{64}$/u.test(proposalHash), 'ERR_MCP_ARGUMENTS', 'proposalHash must be a lowercase SHA-256 value');
  if (args.workspaceCandidateId !== undefined) {
    requiredString(args.workspaceCandidateId, 'workspaceCandidateId', 15, 15);
    invariant(/^WS-[a-f0-9]{12}$/u.test(args.workspaceCandidateId), 'ERR_MCP_ARGUMENTS', 'workspaceCandidateId has an invalid format');
  }
  if (args.mode !== undefined) invariant(['AUTO', 'SAFE', 'INTERVIEW'].includes(args.mode), 'ERR_MCP_ARGUMENTS', `Unsupported decision mode: ${String(args.mode)}`);
  invariant(args.modeAuthorizedByUser === undefined || typeof args.modeAuthorizedByUser === 'boolean', 'ERR_MCP_ARGUMENTS', 'modeAuthorizedByUser must be boolean');
  invariant(args.acceptRecommendedDiscoveryDefaults === undefined || typeof args.acceptRecommendedDiscoveryDefaults === 'boolean', 'ERR_MCP_ARGUMENTS', 'acceptRecommendedDiscoveryDefaults must be boolean');
  invariant(args.rescan === undefined || typeof args.rescan === 'boolean', 'ERR_MCP_ARGUMENTS', 'rescan must be boolean');
  if (args.baselinePlanHash !== undefined) invariant(/^[a-f0-9]{64}$/u.test(args.baselinePlanHash), 'ERR_MCP_ARGUMENTS', 'baselinePlanHash must be a lowercase SHA-256 value');
  if (args.baselineCommit !== undefined) invariant(/^[a-f0-9]{40}$/u.test(args.baselineCommit), 'ERR_MCP_ARGUMENTS', 'baselineCommit must be a full lowercase Git SHA');
  invariant(args.baselineAuthorizedByUser === undefined || typeof args.baselineAuthorizedByUser === 'boolean', 'ERR_MCP_ARGUMENTS', 'baselineAuthorizedByUser must be boolean');
  if (args.answers !== undefined) {
    invariant(Array.isArray(args.answers) && args.answers.length <= 3, 'ERR_MCP_ARGUMENTS', 'answers must contain at most three entries');
    for (const answer of args.answers) {
      invariant(answer && typeof answer === 'object' && !Array.isArray(answer), 'ERR_MCP_ARGUMENTS', 'Each answer must be an object');
      rejectUnknownKeys(answer, ['questionId', 'choice']);
      requiredString(answer.questionId, 'questionId', 1, 80);
      requiredString(answer.choice, 'choice', 1, 1000);
    }
  }
  return { proposalId, proposalHash };
}

/** @param {Record<string, any>} proposal @param {Record<string, any>} result @param {string} root */
async function buildRefineData(proposal, result, root) {
  const decisionLedger = await decisionLedgerSummary(root, proposal.id);
  return {
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    revision: proposal.revision,
    changed: result.changed,
    previousHash: proposal.previousHash,
    release: proposal.release,
    mode: proposal.mode,
    proposalState: proposal.canonicalState,
    readyForApproval: proposal.readyForApproval,
    approvalStatus: proposal.canonicalState,
    workspace: proposal.workspace,
    workspaceCandidates: proposal.workspaceCandidates,
    versionEvidence: proposal.versionEvidence,
    baseline: proposal.baseline,
    intelligence: proposal.intelligence,
    intentGate: proposal.intentGate ?? null,
    oneScreenApproval: proposal.oneScreenApproval,
    briefFactGraph: proposal.briefFactGraph,
    actionEnvelope: proposal.actionEnvelope,
    plainBrief: proposal.plainBrief,
    plainBriefText: proposal.plainBriefText,
    plainBriefError: proposal.plainBriefError,
    releaseTrain: proposal.releaseTrain,
    releaseTrainSummary: proposal.releaseTrainSummary,
    goalDiscovery: proposal.goalDiscovery ?? null,
    goalCharter: proposal.goalCharter ?? null,
    decisionLedger,
    baselinePreservation: proposal.baselinePreservation ?? null,
    nextAction: proposalNextAction(proposal.canonicalState),
    acceptanceStrength: proposal.acceptanceStrength,
    acceptance: proposal.contract.acceptance,
    questions: proposal.decision.questions,
    resolutions: result.resolutions,
    approvalBrief: proposal.approvalBrief,
    proposalPath: result.proposalPath,
    archivedRevisionPath: result.archivedRevisionPath,
    userView: {
      schema: 'shipping-harness/user-view-v1',
      userState: proposal.readyForApproval ? 'AWAITING_APPROVAL' : proposal.canonicalState,
      outcome: proposal.approvalBrief.outcome,
      workspace: proposal.workspace,
      versionEvidence: proposal.versionEvidence,
      baseline: proposal.baseline,
      intelligence: proposal.intelligence,
      intentGate: proposal.intentGate ?? null,
      oneScreenApproval: proposal.oneScreenApproval,
      briefFactGraph: proposal.briefFactGraph,
      actionEnvelope: proposal.actionEnvelope,
      plainBrief: proposal.plainBrief,
      plainBriefText: proposal.plainBriefText,
      plainBriefError: proposal.plainBriefError,
      releaseTrain: proposal.releaseTrainSummary,
      goalDiscovery: proposal.goalDiscovery ?? null,
      decisionLedger,
      nextAction: proposalNextAction(proposal.canonicalState),
      included: proposal.approvalBrief.included,
      deferred: proposal.approvalBrief.deferred,
      acceptance: proposal.contract.acceptance,
      questions: proposal.decision.questions,
      limits: proposal.approvalBrief.limits,
      actions: proposal.readyForApproval ? ['approve', 'edit-scope', 'stop'] : ['refine', 'stop'],
    },
  };
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleRefine(root, args) {
  const { proposalId, proposalHash } = validateRefineArgs(args);
  const result = await refineScopeProposal(root, {
    proposalId,
    proposalHash,
    answers: args.answers,
    acceptRecommendedDiscoveryDefaults: args.acceptRecommendedDiscoveryDefaults === true,
    workspaceCandidateId: args.workspaceCandidateId,
    mode: args.mode,
    modeAuthorizedByUser: args.modeAuthorizedByUser === true,
    rescan: args.rescan === true,
    baselinePlanHash: args.baselinePlanHash,
    baselineCommit: args.baselineCommit,
    baselineAuthorizedByUser: args.baselineAuthorizedByUser === true,
  });
  const proposal = result.proposal;
  const data = await buildRefineData(proposal, result, root);
  const next = proposal.readyForApproval
    ? 'Review the revised one-screen brief, then explicitly approve the exact revision.'
    : `The revised proposal remains ${proposal.canonicalState}; resolve only that condition.`;
  return complete(data, proposal.plainBriefText ?? `${result.changed ? 'Refined' : 'Reused unchanged'} ${proposal.id} at revision ${proposal.revision}. State: ${proposal.canonicalState}. ${next}`);
}

/** @param {Record<string, any>} args */
function validateApproveArgs(args) {
  rejectUnknownKeys(args, ['proposalId', 'proposalHash', 'confirm', 'autopilotProfile', 'confirmAutopilot', 'autopilotContinuation']);
  const proposalId = requiredString(args.proposalId, 'proposalId', 1, 160);
  const proposalHash = requiredString(args.proposalHash, 'proposalHash', 64, 64);
  invariant(args.confirm === undefined || typeof args.confirm === 'boolean', 'ERR_MCP_ARGUMENTS', 'confirm must be boolean');
  invariant(args.confirmAutopilot === undefined || typeof args.confirmAutopilot === 'boolean', 'ERR_MCP_ARGUMENTS', 'confirmAutopilot must be boolean');
  invariant(args.autopilotContinuation === undefined || typeof args.autopilotContinuation === 'boolean', 'ERR_MCP_ARGUMENTS', 'autopilotContinuation must be boolean');
  return { proposalId, proposalHash };
}

/** @param {string} root @param {string} proposalId @param {string} proposalHash @param {Record<string, any>} args */
async function approveWithContinuation(root, proposalId, proposalHash, args) {
  invariant(args.confirm !== true, 'ERR_AUTOPILOT_ADVANCE', 'Autopilot continuation cannot masquerade as a new human approval');
  invariant(args.autopilotProfile === undefined, 'ERR_AUTOPILOT_ADVANCE', 'Autopilot continuation reuses the existing policy profile');
  const policy = await loadAutopilotPolicy(root);
  const autopilotState = await loadAutopilotState(root);
  const previousTrainEnvelope = await loadApprovedReleaseTrain(root);
  const shippingState = await readTrustedState(root);
  const active = await findActiveScopeProposal(root);
  invariant(policy && autopilotState && previousTrainEnvelope?.train && active, 'ERR_AUTOPILOT_INACTIVE', 'Autopilot continuation requires an active policy, prior train, and current proposal');
  invariant(active.summary.proposalId === proposalId && active.summary.proposalHash === proposalHash, 'ERR_PROPOSAL_STALE', 'Autopilot continuation proposal identity is stale');
  invariant(active.summary.state === 'READY_FOR_APPROVAL', 'ERR_PROPOSAL_NOT_APPROVABLE', `Autopilot continuation requires READY_FOR_APPROVAL, observed ${active.summary.state}`);
  const expectedNext = previousTrainEnvelope.train.releases[(autopilotState.currentIndex ?? 0) + 1] ?? null;
  invariant(expectedNext && expectedNext.version === active.projectedProposal.release, 'ERR_AUTOPILOT_ADVANCE', 'The replanned proposal is not the next release in the approved train');
  const continuationDecision = await evaluateAutopilotAction(root, {
    action: 'ADVANCE_RELEASE',
    effects: ['LOCAL_REVERSIBLE'],
    rollbackAvailable: true,
    localOnly: true,
    exactScope: true,
    predecessorClosed: shippingState.state === 'CLOSED' && shippingState.release === autopilotState.currentRelease,
    cleanCommittedClosure: closureReceiptTracked(root, autopilotState.currentRelease),
    replanReady: true,
    statePatch: {
      phase: 'REPLAN_CHECK',
      replanRequired: true,
      details: { nextRelease: active.projectedProposal.release, proposalId },
    },
  });
  if (!continuationDecision.decision.allowed) {
    return {
      stopped: complete({
        state: shippingState.state,
        proposalId,
        proposalHash,
        autopilot: continuationDecision.decision,
        released: false,
      }, continuationDecision.decision.message),
    };
  }
  const result = await approveScopeProposal(root, {
    proposalId,
    proposalHash,
    confirm: false,
    approverType: 'autopilot-policy',
    approverId: policy.id,
    policyAuthorization: continuationDecision.decision,
  });
  const activation = await rotateAutopilotPolicy(root, {
    authorization: continuationDecision.decision,
    previousTrain: previousTrainEnvelope.train,
    releaseTrain: result.proposal.releaseTrain,
    proposalId: result.proposal.id,
    proposalHash: result.proposal.hash,
    contractHash: result.lock.contractHash,
    baselineSha: result.lock.baselineSha,
    approvedAt: result.proposal.approval.approvedAt,
  });
  return { result, activation, continuationDecision };
}

/** @param {string} root @param {string} proposalId @param {string} proposalHash @param {Record<string, any>} args */
async function approveManually(root, proposalId, proposalHash, args) {
  const profile = args.autopilotProfile ?? 'MANUAL';
  invariant(AUTOPILOT_PROFILES.includes(profile), 'ERR_MCP_ARGUMENTS', `Unsupported autopilot profile: ${String(profile)}`);
  if (profile === 'LOCAL_REVERSIBLE') {
    invariant(args.confirmAutopilot === true, 'ERR_AUTOPILOT_CONFIRMATION', 'LOCAL_REVERSIBLE requires one explicit confirmAutopilot=true authorization');
  }
  const result = await approveScopeProposal(root, {
    proposalId,
    proposalHash,
    confirm: args.confirm === true,
    approverType: 'human',
    approverId: 'mcp-confirmed-user',
  });
  const activation = await activateAutopilot(root, {
    profile,
    proposalId: result.proposal.id,
    proposalHash: result.proposal.hash,
    contractHash: result.lock.contractHash,
    baselineSha: result.lock.baselineSha,
    releaseTrain: result.proposal.releaseTrain,
    approvedAt: result.proposal.approval.approvedAt,
    limits: result.contract.budgets,
  });
  return { result, activation };
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleApproveScope(root, args) {
  const { proposalId, proposalHash } = validateApproveArgs(args);
  const continuation = args.autopilotContinuation === true;

  const outcome = continuation
    ? await approveWithContinuation(root, proposalId, proposalHash, args)
    : await approveManually(root, proposalId, proposalHash, args);
  if (outcome.stopped) return outcome.stopped;
  const { result, activation, continuationDecision = null } = outcome;
  invariant(result, 'ERR_MCP_TOOL_UNKNOWN', 'Approval outcome is missing its result');

  const data = {
    project: result.contract.project,
    release: result.contract.release,
    state: result.state.state,
    contractHash: result.lock.contractHash,
    baselineSha: result.lock.baselineSha,
    proposalId: result.proposal.id,
    releaseTrainHash: result.releaseTrain?.train?.hash ?? result.proposal.releaseTrain?.hash ?? null,
    goalCharter: result.goalCharter ?? result.proposal.goalCharter ?? null,
    goalCharterHash: result.goalCharter?.hash ?? result.proposal.goalCharter?.hash ?? null,
    releaseTrainCount: result.proposal.releaseTrain?.releases?.length ?? 0,
    autopilot: activation ? autopilotPolicySummary(activation.policy) : null,
    autopilotState: activation?.state ?? null,
    continuation,
    continuationDecision: continuationDecision?.decision ?? null,
    released: false,
  };
  const mode = data.autopilot?.enabled ? 'Policy-authorized autopilot is active.' : 'Manual approval mode remains active.';
  return complete(data, `Approved and locked ${data.project} ${data.release} as release 1 of ${data.releaseTrainCount}. ${mode}`);
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleStatus(root, args) {
  rejectUnknownKeys(args, []);
  const status = await statusOrUninitialized(root);
  const userView = buildUserStatusView(status);
  const blockerView = status.initialized ? buildBlockerView(status) : { schema: 'shipping-harness/blocker-view-v1', blockers: [], remainingFixCycles: 0 };
  return complete({ ...status, userView, blockerView }, userView.plainBriefText ?? (userView.summary + ` Next: ${userView.nextAction}`));
}

/** @param {string} root @param {Record<string, any>} contract @param {string | null} adapter */
async function evaluateExecutePolicy(root, contract, adapter) {
  const auto = await autopilotStatus(root);
  if (!auto?.enabled) return null;
  const command = adapter ? configuredCommand(contract.adapters?.[adapter]) : null;
  const evaluated = await evaluateAutopilotAction(root, {
    action: 'IMPLEMENT',
    effects: adapterCommandEffects(command),
    rollbackAvailable: true,
    localOnly: !adapterCommandEffects(command).includes('EXTERNAL_NETWORK_WRITE'),
    exactScope: true,
    statePatch: { phase: 'IMPLEMENTING', details: { adapter: adapter ?? 'host-agent' } },
  });
  return evaluated;
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleExecute(root, args) {
  rejectUnknownKeys(args, ['adapter', 'verifyAfter']);
  if (args.adapter !== undefined) invariant(ADAPTERS.includes(args.adapter), 'ERR_MCP_ARGUMENTS', `Unsupported adapter: ${String(args.adapter)}`);
  const { contract } = await assertLockedContract(root);
  const adapter = chooseConfiguredAdapter(contract, args.adapter);
  const evaluated = await evaluateExecutePolicy(root, contract, adapter);
  if (evaluated && !evaluated.decision.allowed) {
    return complete({ autopilot: evaluated.decision, state: evaluated.recorded.state, released: false }, evaluated.decision.message);
  }
  const policyDecision = evaluated?.decision ?? null;

  if (args.adapter === undefined && contract.internalRuntime?.profile === 'private-omo-v0.7') {
    const result = await executeShippingPrivateOmo(root, { mode: 'native', verifyAfter: args.verifyAfter !== false });
    const decision = result.verification?.decision ?? (result.mode === 'blocked' ? 'BLOCKED' : 'VERIFYING');
    const autoClosure = result.verification?.decision === 'SHIPPABLE' ? await maybeAutopilotClose(root, result.verification) : null;
    return complete({ ...result, autopilot: policyDecision, autoClosure, released: false }, autoClosure?.closed
      ? `Approved private OMO execution finished and automatically closed ${autoClosure.release}; RELEASED remains false.`
      : `Approved private OMO execution finished in mode ${result.mode}; Shipping decision: ${decision}.`);
  }
  if (!adapter) {
    const data = { ...workOrder(contract), autopilot: policyDecision, released: false };
    return complete(data, policyDecision?.allowed
      ? `Policy authorized local implementation of ${contract.release}. Implement only the locked work order, then call shipping_verify.`
      : `No adapter command is stored in the locked contract. The MCP host agent should implement ${contract.release} directly, then call shipping_verify.`);
  }
  const agent = await executeAdapter(root, { adapter });
  const verification = args.verifyAfter === false ? null : await verifyRelease(root);
  const autoClosure = verification?.decision === 'SHIPPABLE' ? await maybeAutopilotClose(root, verification) : null;
  return complete({ mode: 'configured-adapter', adapter, agent, verification, autopilot: policyDecision, autoClosure, released: false }, autoClosure?.closed
    ? `Configured ${adapter} execution passed all policy gates and automatically closed ${autoClosure.release}; RELEASED remains false.`
    : `Configured ${adapter} execution finished${verification ? ` with decision ${verification.decision}` : '; verification is pending'}.`);
}

/** @param {string} root @param {Record<string, any>} result */
async function autoFixAfterVerify(root, result) {
  const auto = await autopilotStatus(root);
  if (!(auto?.enabled && result.issues.counts.BLOCKER > 0)) return null;
  const evaluated = await evaluateAutopilotAction(root, {
    action: 'FIX_BLOCKERS',
    effects: result.issues.counts.UNKNOWN > 0 ? ['UNKNOWN'] : ['LOCAL_REVERSIBLE'],
    rollbackAvailable: true,
    localOnly: true,
    exactScope: true,
    fixCycles: result.state.fixCycles,
    statePatch: { phase: 'FIXING_BLOCKERS', details: { blockers: result.issues.counts.BLOCKER } },
  });
  if (!evaluated.decision.allowed) {
    return { decision: evaluated.decision, state: /** @type {Record<string, any>} */ (evaluated.recorded.state), blockers: result.issues.issues.filter((item) => item.classification === 'BLOCKER') };
  }
  const fixState = await beginFixCycle(root);
  if (fixState.state === 'BLOCKED') return null;
  const { contract } = await assertLockedContract(root);
  return {
    decision: evaluated.decision,
    state: fixState,
    blockers: result.issues.issues.filter((item) => item.classification === 'BLOCKER'),
    workOrder: workOrder(contract),
  };
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleVerify(root, args) {
  rejectUnknownKeys(args, []);
  const auto = await autopilotStatus(root);
  let verifyDecision = null;
  if (auto?.enabled) {
    const evaluated = await evaluateAutopilotAction(root, {
      action: 'VERIFY',
      effects: ['LOCAL_READ'],
      rollbackAvailable: true,
      localOnly: true,
      exactScope: true,
      statePatch: { phase: 'VERIFYING' },
    });
    verifyDecision = evaluated.decision;
    invariant(verifyDecision.allowed, 'ERR_AUTOPILOT_VERIFY', `Autopilot policy stopped verification: ${verifyDecision.code}`);
  }
  const result = await verifyRelease(root);
  if (result.decision === 'SHIPPABLE') {
    const autoClosure = auto?.enabled ? await maybeAutopilotClose(root, result) : null;
    return complete({ ...result, autopilot: verifyDecision, autoClosure, released: false }, autoClosure?.closed
      ? `Verification passed and policy automatically closed ${autoClosure.release}. RELEASED remains false.`
      : autoClosure?.decision?.decision === 'STOP'
        ? `Verification is SHIPPABLE, but autopilot stopped closure: ${autoClosure.decision.code}.`
        : `Verification decision: ${result.decision}. Required checks passed: ${result.manifest.summary.passed}/${result.manifest.summary.total}. Blockers: ${result.issues.counts.BLOCKER}.`);
  }
  const autoFix = await autoFixAfterVerify(root, result);
  return complete({ ...result, autopilot: verifyDecision, autoFix, released: false }, autoFix?.decision?.allowed
    ? `Verification found ${result.issues.counts.BLOCKER} blocker(s). Policy opened bounded fix cycle ${autoFix.state.fixCycles}; fix only those blockers and verify again.`
    : `Verification decision: ${result.decision}. Required checks passed: ${result.manifest.summary.passed}/${result.manifest.summary.total}. Blockers: ${result.issues.counts.BLOCKER}.`);
}

/** @param {string} root @param {Record<string, any>} contract @param {string | null} requestedAdapter */
async function evaluateFixPolicy(root, contract, requestedAdapter) {
  const command = requestedAdapter ? configuredCommand(contract.adapters?.[requestedAdapter]) : null;
  const auto = await autopilotStatus(root);
  if (!auto?.enabled) return null;
  const status = await releaseStatus(root);
  return evaluateAutopilotAction(root, {
    action: 'FIX_BLOCKERS',
    effects: adapterCommandEffects(command),
    rollbackAvailable: true,
    localOnly: !adapterCommandEffects(command).includes('EXTERNAL_NETWORK_WRITE'),
    exactScope: true,
    fixCycles: status.state.fixCycles,
    statePatch: { phase: 'FIXING_BLOCKERS', details: { adapter: requestedAdapter ?? 'host-agent' } },
  });
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleFixBlockers(root, args) {
  rejectUnknownKeys(args, ['adapter', 'runConfiguredAdapter', 'verifyAfter']);
  if (args.adapter !== undefined) invariant(ADAPTERS.includes(args.adapter), 'ERR_MCP_ARGUMENTS', `Unsupported adapter: ${String(args.adapter)}`);
  const { contract } = await assertLockedContract(root);
  const requestedAdapter = (args.runConfiguredAdapter === true || args.adapter) ? chooseConfiguredAdapter(contract, args.adapter) : null;
  const evaluated = await evaluateFixPolicy(root, contract, requestedAdapter);
  if (evaluated && !evaluated.decision.allowed) {
    return complete({ autopilot: evaluated.decision, state: evaluated.recorded.state, released: false }, evaluated.decision.message);
  }
  const policyDecision = evaluated?.decision ?? null;
  const state = await beginFixCycle(root);
  if (state.state === 'BLOCKED') return complete({ state, autopilot: policyDecision, released: false }, 'Fix budget is exhausted. The release is BLOCKED and automation stopped.');
  if (args.runConfiguredAdapter === true || args.adapter) {
    if (args.adapter === undefined && contract.internalRuntime?.profile === 'private-omo-v0.7') {
      const result = await executeShippingPrivateOmo(root, { mode: 'native', verifyAfter: args.verifyAfter !== false });
      const autoClosure = result.verification?.decision === 'SHIPPABLE' ? await maybeAutopilotClose(root, result.verification) : null;
      return complete({ state, ...result, autopilot: policyDecision, autoClosure, released: false }, `Fix cycle ${state.fixCycles} executed through the approved private OMO runtime; Shipping decision ${result.verification?.decision ?? 'VERIFYING'}.`);
    }
    invariant(requestedAdapter, 'ERR_ADAPTER_COMMAND_REQUIRED', 'No approved adapter command is configured; the MCP host agent must fix blockers directly');
    const agent = await executeAdapter(root, { adapter: requestedAdapter });
    const verification = args.verifyAfter === false ? null : await verifyRelease(root);
    const autoClosure = verification?.decision === 'SHIPPABLE' ? await maybeAutopilotClose(root, verification) : null;
    return complete({ state, mode: 'configured-adapter', adapter: requestedAdapter, agent, verification, autopilot: policyDecision, autoClosure, released: false }, `Fix cycle ${state.fixCycles} executed through ${requestedAdapter}${verification ? `; decision ${verification.decision}` : ''}.`);
  }
  const status = await releaseStatus(root);
  return complete({ state, blockers: status.issues.items.filter((item) => item.classification === 'BLOCKER'), workOrder: workOrder(contract), autopilot: policyDecision, released: false }, `Fix cycle ${state.fixCycles} started. Fix only the listed release blockers, then call shipping_verify.`);
}

/** @param {string} root @param {Record<string, any>} args */
export async function handlePause(root, args) {
  rejectUnknownKeys(args, ['action', 'reason']);
  const action = args.action ?? 'pause';
  invariant(['pause', 'resume', 'abort'].includes(action), 'ERR_MCP_ARGUMENTS', `Unsupported control action: ${String(action)}`);
  const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim().slice(0, 500) : `MCP ${action}`;
  const state = action === 'pause' ? await pause(root, reason) : action === 'resume' ? await resume(root, reason) : await abort(root, reason);
  const goalRuntime = action === 'pause'
    ? await pauseGoalRuntime(root, reason)
    : action === 'resume'
      ? await resumeGoalRuntime(root, reason)
      : await abortGoalRuntime(root, reason);
  const autopilot = await setAutopilotHumanControl(root, action, reason);
  return complete({ action, state, autopilot: autopilot?.state ?? null, goalRuntime: goalRuntime ? { transitions: goalRuntime.transitions ?? goalRuntime.taskTransitions ?? [] } : null, released: false }, `Release ${action} completed. Current state: ${state.state}.`);
}

/** @param {string} root @param {Record<string, any>} args */
export async function handleClose(root, args) {
  rejectUnknownKeys(args, []);
  const result = await closeRelease(root);
  const autopilot = await completeManualAutopilotClosure(root, result);
  return complete({
    release: result.receipt.release,
    state: result.state.state,
    receiptPath: result.receiptPath,
    reportPath: result.reportPath,
    backlogCount: result.backlog.items.length,
    autopilot: autopilot?.state ?? null,
    released: false,
  }, `Closed ${result.receipt.release}. Release blockers: 0. Backlog items: ${result.backlog.items.length}. RELEASED remains false.`);
}

export const TOOL_HANDLERS = Object.freeze({
  shipping_start: handleStart,
  shipping_refine: handleRefine,
  shipping_approve_scope: handleApproveScope,
  shipping_execute: handleExecute,
  shipping_status: handleStatus,
  shipping_verify: handleVerify,
  shipping_fix_blockers: handleFixBlockers,
  shipping_pause: handlePause,
  shipping_close: handleClose,
});
