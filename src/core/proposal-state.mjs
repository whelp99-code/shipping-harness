import { hashObject } from './crypto.mjs';

export const PROPOSAL_STATES = Object.freeze([
  'PLANNING',
  'NEEDS_INPUT',
  'DIRTY_BASELINE',
  'NEEDS_ACCEPTANCE',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'SUPERSEDED',
  'EXPIRED',
]);

const TERMINAL = new Set(['APPROVED', 'SUPERSEDED', 'EXPIRED']);
const FALLBACK_COMMANDS = new Set(['git diff --check']);

/**
 * Map the sole authority-bearing proposal state to a compatibility label.
 * This label is a projection only; approval gates must use proposal state.
 * @param {string} state
 */
export function proposalAuthorityStatus(state) {
  if (state === 'READY_FOR_APPROVAL') return 'APPROVABLE';
  if (state === 'NEEDS_INPUT') return 'NEEDS_INPUT';
  if (state === 'APPROVED') return 'APPROVED';
  if (state === 'SUPERSEDED') return 'SUPERSEDED';
  if (state === 'EXPIRED') return 'EXPIRED';
  return 'NOT_READY';
}

/** @param {unknown} value */
function normalizedText(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
    : '';
}

/** @param {Record<string, any>} analysis */
export function classifyAcceptanceStrength(analysis = {}) {
  const candidates = Array.isArray(analysis.candidateCommands) ? analysis.candidateCommands : [];
  const strong = candidates.filter((entry) => {
    const command = typeof entry?.command === 'string' ? entry.command.trim() : '';
    return command
      && !FALLBACK_COMMANDS.has(command)
      && entry?.source !== 'shipping-harness-fallback';
  });
  if (strong.length > 0) {
    return {
      level: 'STRONG',
      sufficient: true,
      commands: strong.map((entry) => entry.command),
      reason: 'Repository-owned build, test, verify, check, package, or equivalent command was detected.',
    };
  }

  const types = Array.isArray(analysis.types) ? analysis.types : [];
  const roots = Array.isArray(analysis.sourceRoots) ? analysis.sourceRoots : [];
  const softwareRoots = roots.filter((entry) => !['doc', 'docs', 'documentation'].includes(String(entry).toLowerCase()));
  const documentationOnly = types.length === 0 && softwareRoots.length === 0 && Boolean(analysis.readme || roots.includes('docs'));
  if (documentationOnly) {
    return {
      level: 'DOCUMENTATION',
      sufficient: true,
      commands: candidates.map((entry) => entry.command).filter(Boolean),
      reason: 'The repository is mechanically classified as documentation-only.',
    };
  }

  return {
    level: 'WEAK',
    sufficient: false,
    commands: candidates.map((entry) => entry.command).filter(Boolean),
    reason: 'No repository-owned build, test, verify, check, package, or equivalent acceptance command was detected.',
  };
}

/** @param {Record<string, any>} proposal @param {number} [now] */
export function deriveProposalState(proposal, now = Date.now()) {
  if (proposal?.approval?.confirmed === true || proposal?.lifecycle?.state === 'APPROVED') return 'APPROVED';
  if (proposal?.lifecycle?.state === 'SUPERSEDED') return 'SUPERSEDED';
  if (Number.isFinite(Date.parse(proposal?.expiresAt)) && Date.parse(proposal.expiresAt) <= now) return 'EXPIRED';
  if (Array.isArray(proposal?.sourceChanges) && proposal.sourceChanges.length > 0) return 'DIRTY_BASELINE';
  if ((proposal?.decision?.questions?.length ?? 0) > 0 || proposal?.decision?.approvalStatus === 'NEEDS_INPUT') return 'NEEDS_INPUT';
  const strength = proposal?.acceptanceStrength ?? classifyAcceptanceStrength(proposal?.analysis);
  if (strength.sufficient !== true) return 'NEEDS_ACCEPTANCE';
  if (proposal?.decision?.approvalStatus === 'BLOCKED') return 'NEEDS_INPUT';
  if (proposal?.decision?.approvalStatus === 'APPROVABLE') return 'READY_FOR_APPROVAL';
  return 'PLANNING';
}

/** @param {string} state */
export function isTerminalProposalState(state) {
  return TERMINAL.has(state);
}

/** @param {{projectRoot:string,gitSha:string,goal:string,release:string,mode:string,projectName?:string|null}} input */
export function proposalFingerprint(input) {
  return hashObject({
    projectRoot: input.projectRoot,
    gitSha: input.gitSha,
    goal: normalizedText(input.goal),
    release: normalizedText(input.release),
    mode: normalizedText(input.mode),
    projectName: normalizedText(input.projectName),
  });
}

/** @param {Record<string, any>} proposal */
export function proposalSummary(proposal) {
  const state = deriveProposalState(proposal);
  return {
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    revision: proposal.revision ?? 1,
    release: proposal.release,
    goal: proposal.goal,
    mode: proposal.mode,
    state,
    readyForApproval: state === 'READY_FOR_APPROVAL',
    questionCount: proposal.decision?.questions?.length ?? 0,
    dirtyPathCount: proposal.sourceChanges?.length ?? 0,
    acceptanceStrength: proposal.acceptanceStrength ?? classifyAcceptanceStrength(proposal.analysis),
    workspace: proposal.workspace ?? proposal.analysis?.workspace ?? null,
    workspaceCandidates: proposal.workspaceCandidates ?? proposal.analysis?.workspaceCandidates ?? [],
    versionEvidence: proposal.versionEvidence ?? proposal.analysis?.versionEvidence ?? null,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
  };
}
