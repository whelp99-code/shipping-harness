import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ShippingError, invariant } from './errors.mjs';

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