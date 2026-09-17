import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ShippingError, invariant } from './errors.mjs';
import { analyzeScope } from './glob.mjs';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{allowFailure?: boolean, timeoutMs?: number, maxBuffer?: number}} [options]
 */
export function runGit(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 15000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    throw new ShippingError('ERR_GIT_EXEC', `Unable to execute git ${args.join(' ')}`, {
      cwd,
      args,
      cause: result.error.message,
    });
  }
  const exitCode = result.status ?? 1;
  if (exitCode !== 0 && !options.allowFailure) {
    throw new ShippingError('ERR_GIT_COMMAND', `git ${args.join(' ')} failed`, {
      cwd,
      args,
      exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return {
    exitCode,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** @param {string} start */
export function findGitRoot(start) {
  const result = runGit(start, ['rev-parse', '--show-toplevel']);
  return path.resolve(result.stdout.trim());
}

/** @param {string} root */
export function currentGitSha(root) {
  const result = runGit(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  invariant(result.exitCode === 0 && result.stdout.trim(), 'ERR_GIT_HEAD_REQUIRED', 'A committed Git HEAD is required before this operation', {
    root,
    stderr: result.stderr.trim(),
  });
  return result.stdout.trim();
}

/** @param {string} root */
export function currentBranch(root) {
  const result = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/** @param {string} root */
export function isGitClean(root) {
  return runGit(root, ['status', '--porcelain=v1']).stdout.trim().length === 0;
}

/**
 * Return committed, staged, unstaged, and untracked paths relative to root.
 * @param {string} root
 * @param {string} baselineSha
 */
export function changedPathsSince(root, baselineSha) {
  const tracked = runGit(root, ['diff', '--name-only', '-z', baselineSha, '--']).stdout;
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout;
  return [...new Set([...splitNul(tracked), ...splitNul(untracked)].map(normalizeGitPath))].sort();
}

/**
 * Return staged, unstaged, and untracked paths relative to HEAD. These are the paths a
 * commit would still have to capture, so a release receipt bound to HEAD cannot attest to them.
 * @param {string} root
 */
export function uncommittedPaths(root) {
  const tracked = runGit(root, ['diff', '--name-only', '-z', 'HEAD', '--']).stdout;
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout;
  return [...new Set([...splitNul(tracked), ...splitNul(untracked)].map(normalizeGitPath))].sort();
}

/** Runtime state is not part of the source tree under test. @param {string} value */
function isShippingRuntimePath(value) {
  return value === '.shipping' || value.startsWith('.shipping/');
}

/**
 * Blob SHA of each path's *working copy* (not the index), computed by `git hash-object`
 * so file bytes never pass through this process. A path that no longer exists (deleted
 * relative to HEAD) hashes as the literal `absent`.
 * @param {string} root
 * @param {string[]} paths
 * @returns {Map<string, string>}
 */
function workingCopyBlobShas(root, paths) {
  const shas = new Map();
  for (let index = 0; index < paths.length; index += 100) {
    const chunk = paths.slice(index, index + 100);
    const batch = runGit(root, ['hash-object', '--', ...chunk], { allowFailure: true });
    const lines = batch.stdout.split(/\r?\n/u).filter(Boolean);
    if (batch.exitCode === 0 && lines.length === chunk.length) {
      chunk.forEach((filePath, offset) => shas.set(filePath, lines[offset]));
      continue;
    }
    // One unreadable path (a deletion) fails the whole batch; fall back to one call each.
    for (const filePath of chunk) {
      const single = runGit(root, ['hash-object', '--', filePath], { allowFailure: true });
      shas.set(filePath, single.exitCode === 0 ? single.stdout.trim() : 'absent');
    }
  }
  return shas;
}

/**
 * Identity of the tree the commands actually ran against: HEAD plus every working-tree
 * deviation from it. A Git SHA alone attributes evidence to a commit that may not contain
 * what was tested, so evidence binds to this instead and goes stale the moment a file changes.
 * `.shipping/` runtime output is excluded, so recording evidence never invalidates it.
 * @param {string} root
 * @param {{include: string[], exclude: string[]} | null} [scopePaths] when given, `inScopeDirtyPaths` is filled
 * @returns {{fingerprint: string, headSha: string, dirtyPaths: string[], inScopeDirtyPaths: string[]}}
 */
export function treeFingerprint(root, scopePaths = null) {
  const headSha = currentGitSha(root);
  const dirtyPaths = uncommittedPaths(root).filter((filePath) => !isShippingRuntimePath(filePath));
  const shas = workingCopyBlobShas(root, dirtyPaths);
  const digest = createHash('sha256');
  digest.update(headSha);
  for (const filePath of dirtyPaths) digest.update(`\n${filePath}\0${shas.get(filePath) ?? 'absent'}`);
  return {
    fingerprint: digest.digest('hex'),
    headSha,
    dirtyPaths,
    inScopeDirtyPaths: scopePaths ? analyzeScope(dirtyPaths, scopePaths).allowed : [],
  };
}

/** @param {string} root */
export function gitStatus(root) {
  return {
    root,
    branch: currentBranch(root),
    sha: currentGitSha(root),
    clean: isGitClean(root),
    porcelain: runGit(root, ['status', '--porcelain=v1']).stdout
      .split(/\r?\n/u)
      .filter(Boolean),
  };
}

/** @param {string} value */
function splitNul(value) {
  return value.split('\0').filter(Boolean);
}

/** @param {string} value */
function normalizeGitPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

/**
 * Commits on the current branch after `baselineSha`, up to and including `headSha`.
 * Bounded by construction: at most `maxCommits` rows, `maxPaths` paths per row, and a
 * `maxSubject`-character subject, with `truncated` counting what did not fit.
 *
 * v1.13.0 Phase B: this is evidence, never a gate. Whether a commit made after the scope
 * was locked belongs to the approved goal is not decidable mechanically, so the harness
 * records it in the release receipt and lets a human look.
 * @param {string} root
 * @param {string} baselineSha
 * @param {string} headSha
 * @param {{maxCommits?: number, maxPaths?: number, maxSubject?: number}} [limits]
 * @returns {{commits: Array<{sha: string, subject: string, paths: string[], pathsTruncated?: number}>, truncated: number}}
 */
export function commitsBetween(root, baselineSha, headSha, limits = {}) {
  const maxCommits = limits.maxCommits ?? 50;
  const maxPaths = limits.maxPaths ?? 20;
  const maxSubject = limits.maxSubject ?? 120;
  const listed = runGit(root, ['rev-list', `${baselineSha}..${headSha}`], { allowFailure: true });
  if (listed.exitCode !== 0) return { commits: [], truncated: 0 };
  const shas = listed.stdout.split(/\r?\n/u).filter(Boolean);
  const commits = shas.slice(0, maxCommits).map((sha) => {
    const subject = runGit(root, ['log', '-1', '--format=%s', sha], { allowFailure: true }).stdout.trim();
    const changed = runGit(root, ['show', '--name-only', '--format=', '-z', '--no-renames', sha], { allowFailure: true });
    // `.shipping/` is the harness's own runtime state, never goal work, and it is already
    // ignored everywhere else scope is analyzed; listing it here would bury the real paths.
    const paths = [...new Set(splitNul(changed.stdout).map(normalizeGitPath))]
      .filter((filePath) => !isShippingRuntimePath(filePath))
      .sort();
    return {
      sha,
      subject: subject.slice(0, maxSubject),
      paths: paths.slice(0, maxPaths),
      ...(paths.length > maxPaths ? { pathsTruncated: paths.length - maxPaths } : {}),
    };
  });
  return { commits, truncated: Math.max(0, shas.length - commits.length) };
}
