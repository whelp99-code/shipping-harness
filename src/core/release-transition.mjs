import path from 'node:path';
import { rm } from 'node:fs/promises';
import { loadContract, validateContract } from './contract.mjs';
import { stableStringify } from './crypto.mjs';
import { changedPathsSince } from './git.mjs';
import { exists, readText, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { invariant } from './errors.mjs';
import { readTrustedState, writeSignedState } from './state.mjs';

/** @param {string} value */
function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(value);
  invariant(match, 'ERR_RELEASE_VERSION', `Invalid semantic version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** @param {string} left @param {string} right */
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

/**
 * Archive the closed contract and create a clean DRAFT for the next release.
 * @param {string} root
 * @param {{release: string, goal?: string | null}} input
 */
export async function prepareNextRelease(root, input) {
  const paths = runtimePaths(root);
  const state = await readTrustedState(root);
  invariant(state.state === 'CLOSED', 'ERR_RELEASE_PREPARE_STATE', `Next release can be prepared only from CLOSED, current state is ${state.state}`);
  const current = await loadContract(paths.contract);
  invariant(compareSemver(input.release, current.release) > 0, 'ERR_RELEASE_VERSION', 'Next release must be greater than the closed release', {
    current: current.release,
    requested: input.release,
  });
  const changed = changedPathsSince(root, state.closedGitSha ?? state.baselineSha)
    .filter((candidate) => !candidate.startsWith('.shipping/'));
  invariant(changed.length === 0, 'ERR_RELEASE_DRIFT', 'Commit or discard source changes before preparing the next release', { changed });

  const archivedContract = path.join(paths.releases, `${current.release}-contract.yaml`);
  const archivedLock = path.join(paths.releases, `${current.release}-contract.lock.json`);
  invariant(!(await exists(archivedContract)), 'ERR_RELEASE_ARCHIVE_EXISTS', `Archived contract already exists for ${current.release}`);
  await writeAtomic(archivedContract, await readText(paths.contract));
  if (await exists(paths.lock)) await writeAtomic(archivedLock, await readText(paths.lock));

  const next = {
    ...current,
    release: input.release,
    goal: input.goal?.trim() || `Define the ${input.release} release outcome before locking this draft.`,
  };
  validateContract(next);
  await writeAtomic(paths.contract, stableStringify(next));
  await rm(paths.lock, { force: true });
  const now = new Date().toISOString();
  const draft = {
    schema: 'shipping-harness/state-v1',
    state: 'DRAFT',
    release: input.release,
    previousRelease: current.release,
    contractHash: null,
    baselineSha: null,
    currentEvidenceSha: null,
    lastRunId: null,
    agentRuns: 0,
    fixCycles: 0,
    blockerCount: 0,
    nextCount: 0,
    ignoreCount: 0,
    unknownCount: 0,
    verifyRuns: 0,
    redundantVerifyRuns: 0,
    humanStop: false,
    resumeState: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonAtomic(paths.issues, {
    schema: 'shipping-harness/issues-v1',
    issues: [],
    counts: { BLOCKER: 0, NEXT: 0, IGNORE: 0, UNKNOWN: 0 },
    updatedAt: now,
  });
  await writeSignedState(root, draft, {
    type: 'release.prepared',
    to: 'DRAFT',
    fromRelease: current.release,
    release: input.release,
    archivedContract: path.relative(root, archivedContract).replaceAll('\\', '/'),
    archivedLock: (await exists(archivedLock)) ? path.relative(root, archivedLock).replaceAll('\\', '/') : null,
  });
  return {
    fromRelease: current.release,
    release: input.release,
    state: 'DRAFT',
    contract: paths.contract,
    archivedContract,
    archivedLock: (await exists(archivedLock)) ? archivedLock : null,
  };
}