// Baseline auto-commit (v1.13.0 Phase A).
//
// This module is the ONLY place in Shipping Harness that writes Git history, and it writes
// exactly one kind of thing: a single local commit of the user's own working tree, made
// before a proposal is built so the release baseline is one commit instead of a moving
// target. It never pushes, tags, amends, rebases, resets --hard, or switches branches, and
// the commit it makes is undone by one documented command (`git reset --soft HEAD~1`).
//
// Two rules make it safe to run without asking:
//
//   - Untracked files are enumerated with `git ls-files --others --exclude-standard`, never
//     with `git add -A` or `git add .`, so a file the repository's own ignore rules exclude
//     can never be staged. `.shipping/**` runtime state is removed on top of that.
//   - Every untracked candidate is screened against the same credential deny-list the
//     adapter artifact collector uses. One violation refuses the WHOLE commit
//     (`ERR_BASELINE_UNSAFE_UNTRACKED`) and leaves the working tree and index untouched;
//     the file is never silently skipped so the rest can be committed.
import path from 'node:path';
import { statSync } from 'node:fs';
import { runGit } from './git.mjs';
import { BLOCKED_BASENAMES, BLOCKED_SEGMENTS } from '../adapters/artifacts.mjs';
import { ShippingError, invariant } from './errors.mjs';
import { VERSION } from '../version.mjs';

/** Largest untracked file the auto-commit will absorb. */
export const MAX_UNTRACKED_BYTES = 8 * 1024 * 1024;

/** Largest number of untracked files the auto-commit will absorb. */
export const MAX_UNTRACKED_FILES = 200;

/** The single documented way to undo the commit this module makes. */
export const BASELINE_UNDO_COMMAND = 'git reset --soft HEAD~1';

/**
 * The fixed commit message. It carries no co-author or attribution line: the content being
 * committed is the user's own work, not the harness's.
 * @returns {string}
 */
export function baselineCommitMessage() {
  return [
    'chore: commit working tree before the shipping-harness proposal',
    '',
    `Recorded by shipping-harness ${VERSION} so the release baseline is one commit.`,
    `Undo: ${BASELINE_UNDO_COMMAND}`,
  ].join('\n');
}

/** @param {string} value */
function normalize(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

/** @param {string} value */
function isShippingRuntimePath(value) {
  return value === '.shipping' || value.startsWith('.shipping/');
}

/** @param {string} value */
function splitNul(value) {
  return value.split('\0').filter(Boolean);
}

/**
 * Refuse early, with git's own words, when the repository cannot carry a commit at all
 * (no commits yet, or a broken/partial repository).
 * @param {string} root
 */
function assertCommittableRepository(root) {
  const head = runGit(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (head.exitCode !== 0 || !head.stdout.trim()) {
    throw new ShippingError('ERR_BASELINE_COMMIT_FAILED', 'The repository has no commit to build a baseline on; make the first commit yourself and start again', {
      root,
      stderr: head.stderr.trim().slice(-2000),
    });
  }
  return head.stdout.trim();
}

/**
 * Paths the combined index+working-tree diff against HEAD reports, split into those HEAD
 * already knows and those it does not. A file the user staged by hand is "new to HEAD"
 * even though `git ls-files --others` no longer lists it, and it has to face the same
 * screen as an untracked file.
 * @param {string} root
 * @returns {{modified: string[], added: string[]}}
 */
function trackedDiffAgainstHead(root) {
  const records = splitNul(runGit(root, ['diff', '--name-status', '--no-renames', '-z', 'HEAD', '--']).stdout);
  const modified = [];
  const added = [];
  for (let index = 0; index + 1 < records.length; index += 2) {
    const filePath = normalize(records[index + 1]);
    if (records[index].startsWith('A')) added.push(filePath);
    else modified.push(filePath);
  }
  return { modified, added };
}

/**
 * Everything one baseline commit would have to capture, split by how it was found.
 * `.shipping/**` is removed from every list and reported separately; files the repository
 * ignores never appear because `--exclude-standard` filters them at the source.
 * @param {string} root
 * @returns {{headSha: string, trackedModified: string[], stagedAdditions: string[], untracked: string[], shippingSkipped: string[]}}
 */
export function collectBaselineChanges(root) {
  const headSha = assertCommittableRepository(root);
  const diff = trackedDiffAgainstHead(root);
  const untracked = splitNul(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout).map(normalize);
  const keep = (entries) => [...new Set(entries.filter((entry) => !isShippingRuntimePath(entry)))].sort();
  return {
    headSha,
    trackedModified: keep(diff.modified),
    stagedAdditions: keep(diff.added),
    untracked: keep(untracked),
    shippingSkipped: [...new Set([...diff.modified, ...diff.added, ...untracked].filter(isShippingRuntimePath))].sort(),
  };
}

/** @param {string} root @param {string} filePath */
/** Human wording for each refusal reason. The code stays machine-readable in details. */
const REFUSAL_SENTENCE = Object.freeze({
  'protected-directory': 'sits in a protected directory',
  'credential-like-name': 'has a credential-like name',
  unreadable: 'cannot be read',
  'not-a-regular-file': 'is not a regular file',
  'over-size-budget': 'is larger than the baseline size budget',
  'over-file-count-budget': 'exceeds the untracked file-count budget',
});

function untrackedRefusal(root, filePath) {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) return 'protected-directory';
  if (BLOCKED_BASENAMES.has((segments.at(-1) ?? '').toLowerCase())) return 'credential-like-name';
  let information;
  try {
    information = statSync(path.resolve(root, filePath));
  } catch {
    // A path git listed that cannot be stat'ed is not something to commit blind.
    return 'unreadable';
  }
  if (!information.isFile()) return 'not-a-regular-file';
  if (information.size > MAX_UNTRACKED_BYTES) return 'over-size-budget';
  return null;
}

/**
 * Screen every untracked candidate. The first violation refuses the whole commit: a
 * credential file in the tree is a reason to stop, never a reason to commit everything
 * except it and say nothing.
 * @param {string} root
 * @param {string[]} paths
 * @returns {string[]} the same paths, when every one of them is safe to stage
 */
export function screenUntracked(root, paths) {
  invariant(paths.length <= MAX_UNTRACKED_FILES, 'ERR_BASELINE_UNSAFE_UNTRACKED', `The working tree holds ${paths.length} untracked files, over the ${MAX_UNTRACKED_FILES}-file baseline budget; commit or ignore them yourself and start again`, {
    reason: 'over-file-count-budget',
    count: paths.length,
    maxFiles: MAX_UNTRACKED_FILES,
  });
  for (const filePath of paths) {
    const reason = untrackedRefusal(root, filePath);
    if (reason) {
      throw new ShippingError('ERR_BASELINE_UNSAFE_UNTRACKED', `Refusing to commit the working tree: untracked file ${filePath} ${REFUSAL_SENTENCE[reason] ?? `was refused (${reason})`}. Nothing was staged or committed. Commit, ignore, or remove that file yourself, then start again.`, {
        reason,
        path: filePath,
      });
    }
  }
  return paths;
}

/**
 * Stage the enumerated paths, in chunks so the argument list stays bounded.
 * @param {string} root @param {string[]} paths
 */
function stagePaths(root, paths) {
  for (let index = 0; index < paths.length; index += 100) {
    runGit(root, ['add', '--', ...paths.slice(index, index + 100)]);
  }
}

/**
 * Commit the whole working tree as one local baseline commit, or do nothing when the tree
 * is already clean.
 *
 * Repository hooks are bypassed (`--no-verify`) because the proposal path promises to
 * analyze a repository without running its code, and a pre-commit hook is repository code.
 * Commit signing is NOT overridden: the signing policy is the user's, so a repository that
 * signs every commit keeps signing this one. A signing prompt cannot hang the server
 * because runGit bounds every invocation; a signing failure surfaces as
 * ERR_BASELINE_COMMIT_FAILED with git's own stderr, which the user can act on.
 * @param {string} root
 * @returns {{sha: string, files: string[], untrackedIncluded: string[], undo: string} | null}
 */
export function commitBaseline(root) {
  const changes = collectBaselineChanges(root);
  const candidates = [...new Set([...changes.stagedAdditions, ...changes.untracked])].sort();
  if (changes.trackedModified.length === 0 && candidates.length === 0) return null;
  const untrackedIncluded = screenUntracked(root, candidates);
  const files = [...new Set([...changes.trackedModified, ...untrackedIncluded])].sort();
  // Start from HEAD so only the enumerated paths can enter the commit, whatever the
  // index happened to hold. The working tree is never touched by a mixed reset.
  runGit(root, ['reset', '-q']);
  try {
    stagePaths(root, files);
    const committed = runGit(root, ['commit', '--no-verify', '-m', baselineCommitMessage()], { allowFailure: true });
    if (committed.exitCode !== 0) {
      throw new ShippingError('ERR_BASELINE_COMMIT_FAILED', 'git refused to commit the working-tree baseline', {
        exitCode: committed.exitCode,
        stderr: `${committed.stderr}${committed.stdout}`.trim().slice(-2000),
      });
    }
  } catch (error) {
    runGit(root, ['reset', '-q'], { allowFailure: true });
    if (error instanceof ShippingError && error.code === 'ERR_BASELINE_COMMIT_FAILED') throw error;
    throw new ShippingError('ERR_BASELINE_COMMIT_FAILED', 'The working-tree baseline could not be committed', {
      stderr: String(error instanceof Error ? error.message : error).slice(-2000),
    });
  }
  return {
    sha: runGit(root, ['rev-parse', '--verify', 'HEAD']).stdout.trim(),
    files,
    untrackedIncluded,
    undo: BASELINE_UNDO_COMMAND,
  };
}

/**
 * The bounded projection of one auto-commit for responses, ledger events and receipts.
 * @param {{sha: string, files: string[], untrackedIncluded: string[], undo: string} | null} result
 */
export function baselineCommitSummary(result) {
  if (!result) return null;
  return {
    sha: result.sha,
    filesCommitted: result.files.length,
    untrackedIncluded: result.untrackedIncluded.length,
    undo: result.undo,
  };
}
