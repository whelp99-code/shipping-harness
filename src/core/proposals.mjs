import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { createDefaultContract, loadContract, lockContract, validateContract } from './contract.mjs';
import { hashObject, stableStringify } from './crypto.mjs';
import { assertContainedPath, ensureDir, exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { currentGitSha, gitStatus } from './git.mjs';
import { invariant } from './errors.mjs';
import { runtimePaths } from './paths.mjs';
import { buildShortPlan } from './project-analysis.mjs';
import { buildDecisionEvidence } from './decision-evidence.mjs';
import { compileDecisionContract, composeDefaultDecision } from './decision-package.mjs';
import { applyDecisionPolicy, buildApprovalBrief } from './decision-policy.mjs';
import {
  classifyAcceptanceStrength,
  deriveProposalState,
  isTerminalProposalState,
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
function nonRuntimeChanges(root) {
  return gitStatus(root).porcelain.filter((line) => {
    const raw = line.slice(3).trim();
    const paths = raw.split(' -> ').map((entry) => entry.replace(/^"|"$/gu, ''));
    return paths.some((entry) => entry !== '.shipping' && !entry.startsWith('.shipping/'));
  });
}

/** @param {Record<string, any>} proposal */
function proposalHash(proposal) {
  const { hash: _hash, approval: _approval, ...body } = proposal;
  return hashObject(body);
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
  return { proposal, index, summary: proposalSummary(proposal) };
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
  updated.canonicalState = deriveProposalState(updated);
  updated.readyForApproval = false;
  updated.hash = proposalHash(updated);
  const target = path.join(runtimePaths(root).proposals, `${updated.id}.json`);
  await writeJsonAtomic(target, updated);
  return updated;
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
    const evidence = await buildDecisionEvidence(root, { goal: input.goal.trim(), mode: input.mode ?? undefined });
    const analysis = evidence.analysis;
    const release = input.release?.trim()
      || (context.state?.state === 'DRAFT'
        ? (context.state.release || context.contract?.release || '0.1.0')
        : context.contract
          ? nextMinor(context.contract.release)
          : '0.1.0');
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
          proposal: active.proposal,
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
    const sourceChanges = nonRuntimeChanges(root);
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
      goal,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
      mode: decision.mode,
      lifecycle: { state: 'PLANNING', supersedes: active?.proposal?.id ?? null },
      sourceChanges,
      acceptanceStrength,
      analysis,
      evidence,
      decision,
      approvalBrief,
      contract,
      plan: buildShortPlan(analysis, acceptance),
      diagnostics: [
        ...analysis.diagnostics,
        ...(sourceChanges.length > 0 ? ['Commit or discard non-.shipping changes before approval.'] : []),
        ...(decision.questions.length > 0 ? ['Mandatory risks or interview questions must be resolved before approval.'] : []),
        ...(acceptanceStrength.sufficient ? [] : ['A repository-owned build, test, verify, check, package, or equivalent acceptance command is required before approval.']),
        ...(inheritedCommands.length > 0 ? [`Existing adapter commands were removed from the generated proposal: ${inheritedCommands.join(', ')}.`] : []),
      ],
    };
    proposal.canonicalState = deriveProposalState(proposal);
    proposal.readyForApproval = proposal.canonicalState === 'READY_FOR_APPROVAL';
    proposal.hash = proposalHash(proposal);
    const proposalPath = path.join(runtimePaths(root).proposals, `${proposal.id}.json`);
    await assertContainedPath(root, proposalPath);
    if (active && !isTerminalProposalState(active.summary.state)) await supersedeProposal(root, active.proposal, proposal.id);
    await writeJsonAtomic(proposalPath, proposal);
    await writeActiveProposalIndex(root, proposal);
    return {
      proposal,
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
  invariant(proposal.projectRoot === path.resolve(root), 'ERR_PROPOSAL_ROOT', 'Proposal belongs to a different repository');
  invariant(proposal.hash === proposalHash(proposal), 'ERR_PROPOSAL_TAMPERED', 'Proposal hash does not match its content');
  return { proposal, proposalPath, summary: proposalSummary(proposal) };
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
  const { proposal, proposalPath, summary } = await loadScopeProposal(root, input.proposalId);
  invariant(input.proposalHash === proposal.hash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match');
  invariant(summary.state === 'READY_FOR_APPROVAL', 'ERR_DECISION_NEEDS_INPUT', `Proposal has unresolved mandatory risks or questions, a dirty baseline, weak acceptance, or another non-ready condition: ${summary.state}`);
  invariant(approverId !== proposal.decision?.proposer?.id, 'ERR_MODEL_SELF_APPROVAL', 'The proposer cannot approve its own decision package');
  invariant(Date.parse(proposal.expiresAt) > Date.now(), 'ERR_PROPOSAL_EXPIRED', 'Proposal has expired; create a new proposal');
  invariant(currentGitSha(root) === proposal.gitSha, 'ERR_PROPOSAL_STALE', 'Repository HEAD changed after proposal creation');
  const sourceChanges = nonRuntimeChanges(root);
  invariant(sourceChanges.length === 0, 'ERR_PROPOSAL_DIRTY', 'Commit or discard non-.shipping changes before approval', { sourceChanges });

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
  invariant(currentGitSha(root) === proposal.gitSha && nonRuntimeChanges(root).length === 0, 'ERR_PROPOSAL_STALE', 'Repository changed during proposal approval');
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