import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createDefaultContract, loadContract, lockContract, validateContract } from './contract.mjs';
import { hashObject, stableStringify } from './crypto.mjs';
import { assertContainedPath, exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { currentGitSha, gitStatus } from './git.mjs';
import { invariant } from './errors.mjs';
import { runtimePaths } from './paths.mjs';
import { buildShortPlan } from './project-analysis.mjs';
import { buildDecisionEvidence } from './decision-evidence.mjs';
import { compileDecisionContract, composeDefaultDecision } from './decision-package.mjs';
import { prepareNextRelease } from './release-transition.mjs';
import { initializeState, readState, recordLedger, transitionState } from './state.mjs';

const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

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

/**
 * Create a reviewable, Git-bound release proposal without locking a release.
 * @param {string} root
 * @param {{goal: string, release?: string | null, projectName?: string | null, mode?: string | null, proposerId?: string | null}} input
 */
export async function createScopeProposal(root, input) {
  invariant(typeof input.goal === 'string' && input.goal.trim().length >= 5, 'ERR_PROPOSAL_GOAL', 'A concrete goal of at least 5 characters is required');
  invariant(input.goal.length <= 4000, 'ERR_PROPOSAL_GOAL', 'Goal exceeds 4000 characters');
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
  const base = context.contract ? structuredClone(context.contract) : createDefaultContract(projectName);
  const inheritedCommands = Object.entries(base.adapters ?? {})
    .filter(([, config]) => typeof config?.command === 'string' && config.command.trim())
    .map(([name]) => name);
  const decision = composeDefaultDecision(evidence, {
    release,
    projectName,
    proposerId: typeof input.proposerId === 'string' && input.proposerId.trim() ? input.proposerId.trim().slice(0, 160) : undefined,
  });
  const contract = compileDecisionContract(base, decision);
  const acceptance = contract.acceptance;
  const now = new Date();
  const gitSha = currentGitSha(root);
  const sourceChanges = nonRuntimeChanges(root);
  const proposal = {
    schema: 'shipping-harness/proposal-v1',
    id: `proposal-${now.toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`,
    projectRoot: path.resolve(root),
    gitSha,
    release,
    goal,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    mode: decision.mode,
    readyForApproval: sourceChanges.length === 0 && decision.questions.length === 0,
    sourceChanges,
    analysis,
    evidence,
    decision,
    contract,
    plan: buildShortPlan(analysis, acceptance),
    diagnostics: [
      ...analysis.diagnostics,
      ...(sourceChanges.length > 0 ? ['Commit or discard non-.shipping changes before approval.'] : []),
      ...(inheritedCommands.length > 0 ? [`Existing adapter commands were removed from the generated proposal: ${inheritedCommands.join(', ')}.`] : []),
    ],
  };
  proposal.hash = proposalHash(proposal);
  const proposalPath = path.join(runtimePaths(root).proposals, `${proposal.id}.json`);
  await assertContainedPath(root, proposalPath);
  await writeJsonAtomic(proposalPath, proposal);
  return { proposal, proposalPath };
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
  return { proposal, proposalPath };
}

/**
 * Approve a proposal and atomically move the release into LOCKED state.
 * @param {string} root
 * @param {{proposalId: string, proposalHash: string, confirm: boolean}} input
 */
export async function approveScopeProposal(root, input) {
  invariant(input.confirm === true, 'ERR_APPROVAL_REQUIRED', 'Explicit confirm=true is required to approve scope');
  const { proposal, proposalPath } = await loadScopeProposal(root, input.proposalId);
  invariant(input.proposalHash === proposal.hash, 'ERR_PROPOSAL_HASH', 'The supplied proposal hash does not match');
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
      contractHash: lock.contractHash,
      baselineSha: lock.baselineSha,
    },
  };
  await writeJsonAtomic(proposalPath, approved);
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