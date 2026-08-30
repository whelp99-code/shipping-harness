import path from 'node:path';
import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { assertContainedPath, exists, readJson, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';

const CHARTER_SCHEMA = 'shipping-harness/goal-charter-v1';
const MAX_TEXT = 4000;
const MAX_LIST_ITEMS = 24;
const MAX_SERIALIZED_BYTES = 64 * 1024;
const AUTHORITY_FIELDS = Object.freeze([
  'commandAuthority',
  'approvalAuthority',
  'closureAuthority',
  'deploymentAuthority',
  'modelAuthority',
]);

function boundedText(value, label, max = MAX_TEXT) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(normalized.length > 0 && normalized.length <= max, 'ERR_GOAL_CHARTER_TEXT', `${label} must be between 1 and ${max} characters`);
  return normalized;
}

function nullableText(value, max = MAX_TEXT) {
  if (value === undefined || value === null || value === '') return null;
  return boundedText(value, 'optional charter text', max);
}

function boundedStrings(values, label, { min = 0, max = MAX_LIST_ITEMS } = {}) {
  const result = [...new Set((values ?? [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().replace(/\s+/gu, ' ')))]
    .slice(0, max);
  invariant(result.length >= min, 'ERR_GOAL_CHARTER_LIST', `${label} requires at least ${min} item(s)`);
  invariant(result.every((entry) => entry.length <= MAX_TEXT), 'ERR_GOAL_CHARTER_LIST', `${label} contains an oversized item`);
  return result;
}

function exactHash(value, label) {
  invariant(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value), 'ERR_GOAL_CHARTER_HASH', `${label} must be a lowercase SHA-256 value`);
  return value;
}

function exactGitSha(value) {
  invariant(typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value), 'ERR_GOAL_CHARTER_GIT', 'Goal Charter Git SHA must be a full lowercase Git SHA');
  return value;
}

function directionAssumptions(proposal) {
  return boundedStrings((proposal.decision?.resolutions ?? []).map((resolution) => {
    const category = typeof resolution.category === 'string' && resolution.category.trim()
      ? `${resolution.category.trim()}: `
      : '';
    const choice = typeof resolution.choice === 'string' ? resolution.choice.trim() : '';
    return choice ? `${category}${choice}` : null;
  }), 'Goal Charter assumptions', { max: 12 });
}

function authorityBoundary() {
  return {
    commandAuthority: false,
    approvalAuthority: false,
    closureAuthority: false,
    deploymentAuthority: false,
    modelAuthority: false,
    released: false,
  };
}

function charterBodyFromProposal(proposal) {
  const discovery = proposal.goalDiscovery;
  const direction = discovery?.direction;
  const critic = discovery?.critic;
  invariant(discovery?.status === 'READY' && direction, 'ERR_GOAL_CHARTER_DIRECTION', 'A ready bounded direction is required to compile a Goal Charter');
  invariant((discovery.questions?.length ?? 0) === 0 && critic?.blockerCount === 0, 'ERR_GOAL_CHARTER_CRITIC', 'Unresolved questions or critic blockers prevent Goal Charter compilation');
  invariant(direction.commandAuthority === false
    && direction.approvalAuthority === false
    && direction.closureAuthority === false
    && direction.modelAuthority === false
    && direction.released === false,
  'ERR_GOAL_CHARTER_AUTHORITY', 'Direction authority is unsafe');

  const project = proposal.contract?.project ?? proposal.analysis?.projectName ?? 'project';
  const include = boundedStrings(direction.include, 'Goal Charter include', { min: 1 });
  const nonGoals = boundedStrings(direction.nonGoals, 'Goal Charter non-goals', { min: 1 });
  const successCriteria = boundedStrings(direction.successCriteria, 'Goal Charter success criteria', { min: 1 });
  const replanTriggers = boundedStrings(direction.replanTriggers, 'Goal Charter replan triggers', { min: 1 });
  const evidenceRefs = boundedStrings([
    ...(direction.evidenceRefs ?? []),
    'proposal.goalDiscovery.direction',
    'proposal.goalDiscovery.critic',
    'proposal.decision.resolutions',
    'proposal.contract.scope',
    'proposal.contract.acceptance',
  ], 'Goal Charter evidence', { min: 1 });

  return {
    schema: CHARTER_SCHEMA,
    id: `CHARTER-${direction.hash.slice(0, 12)}`,
    status: 'PROPOSED',
    project: boundedText(project, 'Goal Charter project', 160),
    release: boundedText(proposal.release, 'Goal Charter release', 80),
    proposalId: boundedText(proposal.id, 'Goal Charter proposal ID', 160),
    proposalRevision: Number.isInteger(proposal.revision) && proposal.revision > 0 ? proposal.revision : 1,
    proposalHash: null,
    gitSha: exactGitSha(proposal.gitSha),
    discoveryHash: exactHash(discovery.hash, 'discovery hash'),
    directionHash: exactHash(direction.hash, 'direction hash'),
    candidateHash: exactHash(direction.candidateHash, 'candidate hash'),
    criticHash: exactHash(direction.criticHash, 'critic hash'),
    outcome: boundedText(direction.outcome, 'Goal Charter outcome'),
    primaryUser: boundedText(direction.primaryUser, 'Goal Charter primary user', 1200),
    operatingBoundary: boundedText(direction.operatingBoundary, 'Goal Charter operating boundary', 1200),
    value: boundedText(direction.value, 'Goal Charter value', 2000),
    include,
    nonGoals,
    successCriteria,
    assumptions: directionAssumptions(proposal),
    rollback: boundedText(direction.rollback, 'Goal Charter rollback', 1600),
    replanTriggers,
    evidenceRefs,
    binding: null,
    ...authorityBoundary(),
  };
}

export function validateGoalCharter(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'ERR_GOAL_CHARTER', 'Goal Charter must be an object');
  invariant(input.schema === CHARTER_SCHEMA, 'ERR_GOAL_CHARTER_SCHEMA', 'Unsupported Goal Charter schema');
  invariant(['PROPOSED', 'ACCEPTED'].includes(input.status), 'ERR_GOAL_CHARTER_STATUS', `Unsupported Goal Charter status: ${String(input.status)}`);
  boundedText(input.id, 'Goal Charter ID', 100);
  boundedText(input.project, 'Goal Charter project', 160);
  boundedText(input.release, 'Goal Charter release', 80);
  boundedText(input.proposalId, 'Goal Charter proposal ID', 160);
  invariant(Number.isInteger(input.proposalRevision) && input.proposalRevision > 0, 'ERR_GOAL_CHARTER_PROPOSAL', 'Goal Charter proposal revision is invalid');
  exactGitSha(input.gitSha);
  exactHash(input.discoveryHash, 'discovery hash');
  exactHash(input.directionHash, 'direction hash');
  exactHash(input.candidateHash, 'candidate hash');
  exactHash(input.criticHash, 'critic hash');
  boundedText(input.outcome, 'Goal Charter outcome');
  boundedText(input.primaryUser, 'Goal Charter primary user', 1200);
  boundedText(input.operatingBoundary, 'Goal Charter operating boundary', 1200);
  boundedText(input.value, 'Goal Charter value', 2000);
  boundedStrings(input.include, 'Goal Charter include', { min: 1 });
  boundedStrings(input.nonGoals, 'Goal Charter non-goals', { min: 1 });
  boundedStrings(input.successCriteria, 'Goal Charter success criteria', { min: 1 });
  boundedStrings(input.assumptions, 'Goal Charter assumptions', { max: 12 });
  boundedText(input.rollback, 'Goal Charter rollback', 1600);
  boundedStrings(input.replanTriggers, 'Goal Charter replan triggers', { min: 1 });
  boundedStrings(input.evidenceRefs, 'Goal Charter evidence', { min: 1 });
  for (const key of AUTHORITY_FIELDS) invariant(input[key] === false, 'ERR_GOAL_CHARTER_AUTHORITY', `${key} must remain false`);
  invariant(input.released === false, 'ERR_GOAL_CHARTER_RELEASED', 'Goal Charter never marks RELEASED');

  if (input.status === 'PROPOSED') {
    invariant(input.proposalHash === null && input.binding === null, 'ERR_GOAL_CHARTER_BINDING', 'Proposed Goal Charter cannot carry approval binding');
  } else {
    exactHash(input.proposalHash, 'proposal hash');
    const binding = input.binding;
    invariant(binding && typeof binding === 'object' && !Array.isArray(binding), 'ERR_GOAL_CHARTER_BINDING', 'Accepted Goal Charter requires a binding');
    exactHash(binding.previewHash, 'Goal Charter preview hash');
    exactHash(binding.contractHash, 'contract hash');
    exactGitSha(binding.baselineSha);
    exactHash(binding.releaseTrainHash, 'Release Train hash');
    invariant(['human', 'autopilot-policy'].includes(binding.approverType), 'ERR_GOAL_CHARTER_APPROVER', 'Unsupported Goal Charter approver type');
    boundedText(binding.approverId, 'Goal Charter approver ID', 160);
    invariant(Number.isFinite(Date.parse(binding.acceptedAt)), 'ERR_GOAL_CHARTER_TIME', 'Goal Charter acceptance time must be ISO date-time');
  }

  const { hash, ...body } = input;
  invariant(hash === hashObject(body), 'ERR_GOAL_CHARTER_HASH', 'Goal Charter hash does not match its authority content');
  invariant(Buffer.byteLength(stableStringify(input)) <= MAX_SERIALIZED_BYTES, 'ERR_GOAL_CHARTER_SIZE', 'Goal Charter exceeds its bounded serialized size');
  return input;
}

export function compileGoalCharterPreview(proposal) {
  const body = charterBodyFromProposal(proposal);
  return validateGoalCharter({ ...body, hash: hashObject(body) });
}

export function acceptGoalCharter(preview, binding) {
  validateGoalCharter(preview);
  invariant(preview.status === 'PROPOSED', 'ERR_GOAL_CHARTER_STATUS', 'Only a proposed Goal Charter can be accepted');
  const proposalHash = exactHash(binding?.proposalHash, 'proposal hash');
  const acceptedAt = boundedText(binding?.acceptedAt, 'Goal Charter acceptance time', 80);
  invariant(Number.isFinite(Date.parse(acceptedAt)), 'ERR_GOAL_CHARTER_TIME', 'Goal Charter acceptance time must be ISO date-time');
  const body = {
    ...structuredClone(preview),
    status: 'ACCEPTED',
    proposalHash,
    binding: {
      previewHash: preview.hash,
      contractHash: exactHash(binding?.contractHash, 'contract hash'),
      baselineSha: exactGitSha(binding?.baselineSha),
      releaseTrainHash: exactHash(binding?.releaseTrainHash, 'Release Train hash'),
      approverType: boundedText(binding?.approverType, 'Goal Charter approver type', 40),
      approverId: boundedText(binding?.approverId, 'Goal Charter approver ID', 160),
      acceptedAt,
    },
  };
  delete body.hash;
  return validateGoalCharter({ ...body, hash: hashObject(body) });
}

function archivedGoalCharterPath(root, release) {
  invariant(typeof release === 'string' && /^[0-9A-Za-z.-]+$/u.test(release), 'ERR_GOAL_CHARTER_RELEASE', 'Goal Charter release is unsafe for archival');
  return path.join(runtimePaths(root).releases, `${release}-goal-charter.json`);
}

async function archiveClosedGoalCharter(root, charter) {
  const paths = runtimePaths(root);
  const receiptPath = path.join(paths.releases, `${charter.release}.json`);
  const archivePath = archivedGoalCharterPath(root, charter.release);
  await assertContainedPath(root, receiptPath);
  await assertContainedPath(root, archivePath);
  invariant(await exists(receiptPath), 'ERR_GOAL_CHARTER_PREDECESSOR_OPEN', 'A prior Goal Charter can roll forward only after its release has a CLOSED receipt', { release: charter.release });
  const receipt = await readJson(receiptPath);
  invariant(receipt?.schema === 'shipping-harness/release-v1'
    && receipt.release === charter.release
    && receipt.acceptance?.requiredFailed === 0
    && Number.isFinite(Date.parse(receipt.closedAt)),
  'ERR_GOAL_CHARTER_PREDECESSOR_OPEN', 'The prior Goal Charter release is not proven CLOSED', { release: charter.release });
  if (await exists(archivePath)) {
    const archived = validateGoalCharter(await readJson(archivePath));
    invariant(archived.hash === charter.hash, 'ERR_GOAL_CHARTER_ARCHIVE_DRIFT', 'Archived Goal Charter differs from the active predecessor charter', {
      release: charter.release,
      activeHash: charter.hash,
      archivedHash: archived.hash,
    });
  } else {
    await writeJsonAtomic(archivePath, charter);
  }
  return archivePath;
}

export async function persistAcceptedGoalCharter(root, charter) {
  validateGoalCharter(charter);
  invariant(charter.status === 'ACCEPTED', 'ERR_GOAL_CHARTER_STATUS', 'Only an accepted Goal Charter may be persisted');
  const target = runtimePaths(root).goalCharter;
  await assertContainedPath(root, target);
  let archivedPath = null;
  if (await exists(target)) {
    const existing = validateGoalCharter(await readJson(target));
    if (existing.hash === charter.hash) return { path: target, charter: existing, duplicate: true, archivedPath: null };
    invariant(existing.release !== charter.release, 'ERR_GOAL_CHARTER_MUTATION', 'An accepted Goal Charter cannot be changed in place for the same release', {
      release: charter.release,
      existingHash: existing.hash,
      requestedHash: charter.hash,
    });
    archivedPath = await archiveClosedGoalCharter(root, existing);
  }
  await writeJsonAtomic(target, charter);
  return { path: target, charter, duplicate: false, archivedPath };
}

export async function loadGoalCharter(root) {
  const target = runtimePaths(root).goalCharter;
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  return validateGoalCharter(await readJson(target));
}

export function assertGoalCharterBinding(charter, expected) {
  validateGoalCharter(charter);
  invariant(charter.status === 'ACCEPTED', 'ERR_GOAL_CHARTER_STATUS', 'Accepted Goal Charter is required');
  invariant(charter.proposalId === expected.proposalId, 'ERR_GOAL_CHARTER_PROPOSAL', 'Goal Charter belongs to another proposal');
  invariant(charter.proposalHash === expected.proposalHash, 'ERR_GOAL_CHARTER_PROPOSAL', 'Goal Charter proposal hash is stale');
  invariant(charter.gitSha === expected.gitSha, 'ERR_GOAL_CHARTER_GIT', 'Goal Charter belongs to another Git baseline');
  invariant(charter.release === expected.release, 'ERR_GOAL_CHARTER_RELEASE', 'Goal Charter belongs to another release');
  invariant(charter.binding.contractHash === expected.contractHash, 'ERR_GOAL_CHARTER_CONTRACT', 'Goal Charter contract hash does not match');
  invariant(charter.binding.baselineSha === expected.baselineSha, 'ERR_GOAL_CHARTER_GIT', 'Goal Charter baseline SHA does not match');
  invariant(charter.binding.releaseTrainHash === expected.releaseTrainHash, 'ERR_GOAL_CHARTER_TRAIN', 'Goal Charter Release Train hash does not match');
  return charter;
}

export function goalCharterSummary(charter) {
  if (!charter) return null;
  validateGoalCharter(charter);
  return {
    schema: 'shipping-harness/goal-charter-summary-v1',
    id: charter.id,
    status: charter.status,
    hash: charter.hash,
    project: charter.project,
    release: charter.release,
    outcome: charter.outcome,
    primaryUser: charter.primaryUser,
    operatingBoundary: charter.operatingBoundary,
    nonGoals: charter.nonGoals.slice(0, 6),
    successCriteria: charter.successCriteria.slice(0, 6),
    replanTriggers: charter.replanTriggers.slice(0, 6),
    modelAuthority: false,
    released: false,
  };
}

export const GOAL_CHARTER = Object.freeze({
  schema: CHARTER_SCHEMA,
  maxSerializedBytes: MAX_SERIALIZED_BYTES,
  maxListItems: MAX_LIST_ITEMS,
});
