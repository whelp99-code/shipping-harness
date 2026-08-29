import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { createDefaultContract, loadContract, lockContract, validateContract } from './contract.mjs';
import { hashObject, stableStringify } from './crypto.mjs';
import { assertContainedPath, ensureDir, exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { currentGitSha, gitStatus } from './git.mjs';
import { analyzeBaseline, verifyBaselinePreservation } from './baseline.mjs';
import { buildOneScreenApproval } from './project-intelligence.mjs';
import { compilePlainBriefSafe } from './plain-brief.mjs';
import { invariant } from './errors.mjs';
import { runtimePaths } from './paths.mjs';
import { buildShortPlan } from './project-analysis.mjs';
import { buildDecisionEvidence } from './decision-evidence.mjs';
import { compileDecisionContract, composeDefaultDecision, validateDecisionPackage } from './decision-package.mjs';
import { applyDecisionPolicy, buildApprovalBrief } from './decision-policy.mjs';
import {
  classifyAcceptanceStrength,
  deriveProposalState,
  isTerminalProposalState,
  proposalAuthorityStatus,
  proposalNextAction,
  proposalFingerprint,
  proposalSummary,
} from './proposal-state.mjs';
import { prepareNextRelease } from './release-transition.mjs';
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
  const state = deriveProposalState(proposal);
  proposal.canonicalState = state;
  proposal.readyForApproval = state === 'READY_FOR_APPROVAL';
  if (proposal.decision && typeof proposal.decision === 'object') {
    proposal.decision.approvalStatus = proposalAuthorityStatus(state);
    proposal.decision.hash = decisionHash(proposal.decision);
    proposal.approvalBrief = buildApprovalBrief(proposal.decision);
  }
  proposal.oneScreenApproval = buildOneScreenApproval(proposal);
  const compiled = compilePlainBriefSafe(proposal);
  proposal.briefFactGraph = compiled.plainBrief?.factGraph ?? null;
  proposal.actionEnvelope = compiled.plainBrief?.actionEnvelope ?? null;
  proposal.plainBrief = compiled.plainBrief ?? null;
  proposal.plainBriefText = compiled.plainBrief?.renderedText ?? null;
  proposal.plainBriefError = compiled.error ?? null;
  return proposal;
}

/** @param {Record<string, any>} input */
function authorityFingerprint(input) {
  const proposal = projectProposalAuthority(input);
  const evidence = structuredClone(proposal.evidence ?? null);
  if (evidence && typeof evidence === 'object') {
    delete evidence.createdAt;
    delete evidence.hash;
  }
  const decision = structuredClone(proposal.decision ?? null);
  if (decision && typeof decision === 'object') {
    delete decision.hash;
    delete decision.evidenceHash;
    delete decision.gitSha;
    decision.resolutions = decision.resolutions ?? [];
    for (const resolution of decision.resolutions) delete resolution.resolvedAt;
  }
  return hashObject({
    gitSha: proposal.gitSha,
    release: proposal.release,
    releaseSelection: proposal.releaseSelection,
    goal: proposal.goal,
    mode: proposal.mode,
    modeAuthorization: proposal.modeAuthorization ?? null,
    sourceChanges: proposal.sourceChanges ?? [],
    baseline: proposal.baseline ?? null,
    baselinePreservation: proposal.baselinePreservation ?? null,
    intelligence: proposal.intelligence ?? proposal.analysis?.intelligence ?? null,
    acceptanceStrength: proposal.acceptanceStrength,
    workspace: proposal.workspace,
    workspaceCandidates: proposal.workspaceCandidates,
    versionEvidence: proposal.versionEvidence,
    analysis: proposal.analysis,
    evidence,
    decision,
    contract: proposal.contract,
    plan: proposal.plan,
    diagnostics: proposal.diagnostics,
    canonicalState: proposal.canonicalState,
  });
}

/** @param {unknown} value @param {string} fallback */
function safeProjectName(value, fallback) {
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
  return projected;
}

/**
 * Create a reviewable, Git-bound release proposal without locking a release.
 * @param {string} root
 * @param {{goal: string, release?: string | null, projectName?: string | null, mode?: string | null, proposerId?: string | null}} input
 */
export async function createScopeProposal(root, input) {
  invariant(typeof input.goal === 'string' && input.goal.trim().length >= 5, 'ERR_PROPOSAL_GOAL', 'A concrete goal of at least 5 characters is required');
  invariant(input.goal.length <= 4000, 'ERR_PROPOSAL_GOAL', 'Goal exceeds 4000 characters');
  return withProposalLock(root, async () => {
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
        : context.contract
          ? nextMinor(context.contract.release)
          : (analysis.versionEvidence?.recommendedVersion ?? '0.1.0'));
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
    const active = await findActiveScopeProposal(root);
    if (active && !isTerminalProposalState(active.summary.state)) {
      invariant(active.proposal.mode === evidence.mode, 'ERR_PROPOSAL_MODE_CHANGE', `Active proposal mode is ${active.proposal.mode}; create or refine it without silently switching mode`);
      if (active.proposal.fingerprint === fingerprint) {
        return {
          proposal: active.projectedProposal,
          proposalPath: path.join(runtimePaths(root).proposals, `${active.proposal.id}.json`),
          reused: true,
          supersededProposalId: null,
        };
      }
    }

    const base = context.contract ? structuredClone(context.contract) : createDefaultContract(projectName);
    const inheritedCommands = Object.entries(base.adapters ?? {})
      .filter(([, config]) => typeof config?.command === 'string' && config.command.trim())
      .map(([name]) => name);
    let decision = composeDefaultDecision(evidence, {
      release,
      projectName,
      proposerId: typeof input.proposerId === 'string' && input.proposerId.trim() ? input.proposerId.trim().slice(0, 160) : undefined,
    });
    decision = applyDecisionPolicy(evidence, decision, { budgets: base.budgets });
    const approvalBrief = buildApprovalBrief(decision);
    const contract = compileDecisionContract(base, decision);
    const acceptance = contract.acceptance;
    const now = new Date();
    const baseline = evidence.baseline;
    const sourceChanges = baseline.blockingPaths;
    const acceptanceStrength = classifyAcceptanceStrength(analysis);
    const id = `proposal-${now.toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
    const proposal = {
      schema: 'shipping-harness/proposal-v1',
      id,
      revision: 1,
      fingerprint,
      projectRoot: path.resolve(root),
      gitSha: evidence.gitSha,
      release,
      releaseSelection: {
        explicit: typeof input.release === 'string' && input.release.trim().length > 0,
        recommended: analysis.versionEvidence?.recommendedVersion ?? null,
        evidence: analysis.versionEvidence ?? null,
      },
      goal,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
      mode: decision.mode,
      lifecycle: { state: 'PLANNING', supersedes: active?.proposal?.id ?? null },
      sourceChanges,
      baseline,
      intelligence: evidence.intelligence,
      acceptanceStrength,
      workspace: analysis.workspace,
      workspaceCandidates: analysis.workspaceCandidates,
      versionEvidence: analysis.versionEvidence,
      analysis,
      evidence,
      decision,
      approvalBrief,
      contract,
      plan: buildShortPlan(analysis, acceptance),
      diagnostics: [
        ...analysis.diagnostics,
        ...(sourceChanges.length > 0 ? ['Review and preserve the exact baseline plan before approval.'] : []),
        ...(decision.questions.length > 0 ? ['Mandatory risks or interview questions must be resolved before approval.'] : []),
        ...(acceptanceStrength.sufficient ? [] : [acceptanceStrength.level === 'UNCOVERED' ? `Acceptance does not cover: ${(acceptanceStrength.uncoveredPaths ?? []).join(', ')}` : 'A repository-owned build, test, verify, check, package, or equivalent acceptance command is required before approval.']),
        ...(inheritedCommands.length > 0 ? [`Existing adapter commands were removed from the generated proposal: ${inheritedCommands.join(', ')}.`] : []),
      ],
    };
    const projectedProposal = projectProposalAuthority(proposal);
    projectedProposal.hash = proposalHash(projectedProposal);
    const proposalPath = path.join(runtimePaths(root).proposals, `${projectedProposal.id}.json`);
    await assertContainedPath(root, proposalPath);
    if (active && !isTerminalProposalState(active.summary.state)) await supersedeProposal(root, active.proposal, proposal.id);
    await writeJsonAtomic(proposalPath, projectedProposal);
    await writeActiveProposalIndex(root, projectedProposal);
    return {
      proposal: projectedProposal,
      proposalPath,
      reused: false,
      supersededProposalId: active && !isTerminalProposalState(active.summary.state) ? active.proposal.id : null,
    };
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

/** @param {Array<Record<string, any>>} questions @param {Array<Record<string, any>>} answers */
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

/**
 * Refine one active proposal identity using bounded structured user decisions.
 * @param {string} root
 * @param {{proposalId:string, proposalHash:string, answers?:Array<{questionId:string,choice:string}>, workspaceCandidateId?:string|null, mode?:string|null, modeAuthorizedByUser?:boolean, rescan?:boolean, baselinePlanHash?:string, baselineCommit?:string, baselineAuthorizedByUser?:boolean}} input
 */
export async function refineScopeProposal(root, input) {
  return withProposalLock(root, async () => {
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
    const answers = input.answers ?? [];
    invariant(Array.isArray(answers) && answers.length <= 3, 'ERR_PROPOSAL_REFINE', 'Refinement accepts at most three grouped answers');
    invariant(answers.length > 0 || input.workspaceCandidateId || requestedMode !== proposal.mode || input.rescan === true, 'ERR_PROPOSAL_REFINE', 'Refinement must include an answer, workspace selection, authorized mode change, or rescan');
    if (input.baselinePlanHash !== undefined) invariant(/^[a-f0-9]{64}$/u.test(input.baselinePlanHash), 'ERR_BASELINE_PLAN', 'baselinePlanHash must be a SHA-256 hex digest');
    if (input.baselineCommit !== undefined) invariant(/^[a-f0-9]{40}$/u.test(input.baselineCommit), 'ERR_BASELINE_COMMIT', 'baselineCommit must be a full Git SHA');
    invariant(input.baselineAuthorizedByUser !== true || (input.baselinePlanHash && input.baselineCommit), 'ERR_BASELINE_APPROVAL', 'Baseline authorization requires the reviewed plan hash and commit SHA');

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
    let decision = composeDefaultDecision(evidence, {
      release,
      projectName,
      proposerId: proposal.decision?.proposer?.id ?? 'mcp-host-agent',
    });
    decision = applyDecisionPolicy(evidence, decision, { budgets: base.budgets });
    const availableQuestions = new Map([
      ...(proposal.decision?.questions ?? []).map((question) => [question.id, question]),
      ...(decision.questions ?? []).map((question) => [question.id, question]),
    ]);
    const priorResolutions = proposal.decision?.resolutions ?? [];
    const previouslyResolvedIds = new Set(priorResolutions.map((entry) => entry.questionId));
    decision.questions = decision.questions.filter((question) => !previouslyResolvedIds.has(question.id));
    const resolved = resolveDecisionQuestions([...availableQuestions.values()], answers);
    const answeredIds = new Set(resolved.resolutions.map((entry) => entry.questionId));
    decision.questions = decision.questions.filter((question) => !answeredIds.has(question.id));
    decision.resolutions = [
      ...(proposal.decision?.resolutions ?? []),
      ...resolved.resolutions,
    ].slice(-20);
    decision.approvalStatus = decision.questions.length > 0 ? 'NEEDS_INPUT' : 'APPROVABLE';
    decision.hash = hashObject(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'hash')));
    decision = validateDecisionPackage(evidence, decision);
    const approvalBrief = buildApprovalBrief(decision);
    const contract = compileDecisionContract(base, decision);
    const baseline = evidence.baseline;
    const sourceChanges = baseline.blockingPaths;
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
    const acceptanceStrength = classifyAcceptanceStrength(proposalAnalysis);
    const now = new Date();
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
      acceptanceStrength,
      workspace: proposalAnalysis.workspace,
      workspaceCandidates: proposalAnalysis.workspaceCandidates,
      versionEvidence: proposalAnalysis.versionEvidence,
      analysis: proposalAnalysis,
      evidence,
      decision,
      approvalBrief,
      contract,
      plan: buildShortPlan(proposalAnalysis, contract.acceptance),
      diagnostics: [
        ...proposalAnalysis.diagnostics,
        ...(sourceChanges.length > 0 ? ['Review and preserve the exact baseline plan before approval.'] : []),
        ...(decision.questions.length > 0 ? ['Mandatory risks or interview questions must be resolved before approval.'] : []),
        ...(acceptanceStrength.sufficient ? [] : [acceptanceStrength.level === 'UNCOVERED' ? `Acceptance does not cover: ${(acceptanceStrength.uncoveredPaths ?? []).join(', ')}` : 'A repository-owned build, test, verify, check, package, or equivalent acceptance command is required before approval.']),
      ],
    };
    delete candidate.approval;
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
    return {
      proposal: updated,
      proposalPath,
      archivedRevisionPath: path.relative(root, archivePath).replaceAll('\\', '/'),
      resolutions: resolved.resolutions,
      changed: true,
    };
  });
}

/**
 * Approve a proposal and atomically move the release into LOCKED state.
 * @param {string} root
 * @param {{proposalId: string, proposalHash: string, confirm: boolean, approverType?: string, approverId?: string}} input
 */
export async function approveScopeProposal(root, input) {
  invariant(input.confirm === true, 'ERR_APPROVAL_REQUIRED', 'Explicit confirm=true is required to approve scope');
  const approverType = input.approverType ?? 'human';
  const approverId = typeof input.approverId === 'string' && input.approverId.trim() ? input.approverId.trim().slice(0, 160) : 'local-user';
  invariant(approverType === 'human', 'ERR_MODEL_SELF_APPROVAL', 'Only a human approver may lock a decision proposal');
  const existingPaths = runtimePaths(root);
  if (await exists(existingPaths.state)) {
    const existingState = await readState(root);
    invariant(['DRAFT', 'CLOSED'].includes(existingState.state), 'ERR_APPROVAL_STATE', `Scope can be approved only from DRAFT or CLOSED, current state is ${existingState.state}`);
  }
  const activeIndex = await readActiveProposalIndex(root);
  invariant(activeIndex?.proposalId === input.proposalId, 'ERR_PROPOSAL_ACTIVE', 'Only the active proposal may be approved');
  invariant(activeIndex?.proposalHash === input.proposalHash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match the active revision');
  const { proposal, proposalPath, summary } = await loadScopeProposal(root, input.proposalId);
  invariant(input.proposalHash === proposal.hash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match');
  invariant(summary.state === 'READY_FOR_APPROVAL', 'ERR_DECISION_NEEDS_INPUT', `Proposal has unresolved mandatory risks or questions, a dirty baseline, weak acceptance, or another non-ready condition: ${summary.state}`);
  invariant(approverId !== proposal.decision?.proposer?.id, 'ERR_MODEL_SELF_APPROVAL', 'The proposer cannot approve its own decision package');
  invariant(Date.parse(proposal.expiresAt) > Date.now(), 'ERR_PROPOSAL_EXPIRED', 'Proposal has expired; create a new proposal');
  invariant(currentGitSha(root) === proposal.gitSha, 'ERR_PROPOSAL_STALE', 'Repository HEAD changed after proposal creation');
  const baseline = currentBaseline(root);
  const sourceChanges = baseline.blockingPaths;
  invariant(sourceChanges.length === 0, 'ERR_PROPOSAL_DIRTY', 'Review and preserve blocking baseline changes before approval', { sourceChanges, baseline });

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
  const { contract, lock } = await lockContract(root, sha);
  const locked = await transitionState(root, 'LOCKED', {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    approvedProposalId: proposal.id,
    approvedProposalHash: proposal.hash,
  }, 'scope proposal explicitly approved');
  const approved = {
    ...proposal,
    approval: {
      confirmed: true,
      approvedAt: new Date().toISOString(),
      approverType,
      approverId,
      contractHash: lock.contractHash,
      baselineSha: lock.baselineSha,
    },
  };
  await writeJsonAtomic(proposalPath, approved);
  await writeActiveProposalIndex(root, approved);
  await recordLedger(root, {
    type: 'proposal.approved',
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
  });
  return { proposal: approved, contract, lock, state: locked };
}