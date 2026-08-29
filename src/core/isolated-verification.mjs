import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashObject } from './crypto.mjs';
import { assertContainedPath } from './fs.mjs';
import { runGit } from './git.mjs';
import { invariant } from './errors.mjs';
import { runBoundedCommand } from './process.mjs';

const MAX_FILES = 20000;
const MAX_HASH_BYTES = 256 * 1024 * 1024;
const SKIP_NAMES = new Set(['.git']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function inventory(root) {
  const rows = [];
  let bytes = 0;
  async function visit(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      invariant(rows.length < MAX_FILES, 'ERR_ISOLATION_BOUNDS', `Isolated inventory exceeds ${MAX_FILES} files`);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      if (info.isDirectory()) {
        await visit(target, rel);
      } else if (info.isSymbolicLink()) {
        rows.push({ path: rel, type: 'symlink', target: await readlink(target) });
      } else if (info.isFile()) {
        bytes += info.size;
        invariant(bytes <= MAX_HASH_BYTES, 'ERR_ISOLATION_BOUNDS', `Isolated inventory exceeds ${MAX_HASH_BYTES} bytes`);
        rows.push({ path: rel, type: 'file', size: info.size, sha256: sha256(await readFile(target)) });
      }
    }
  }
  await visit(root);
  return { rows, hash: hashObject(rows), bytes };
}

function inventoryDelta(before, after) {
  const left = new Map(before.rows.map((entry) => [entry.path, entry]));
  const right = new Map(after.rows.map((entry) => [entry.path, entry]));
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes = [];
  for (const name of names) {
    const a = left.get(name) ?? null;
    const b = right.get(name) ?? null;
    if (hashObject(a) !== hashObject(b)) changes.push({ path: name, before: a, after: b });
  }
  return { changes, hash: hashObject(changes) };
}

async function untrackedDigest(root) {
  const result = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], { allowFailure: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.exitCode !== 0) return null;
  const rows = [];
  let bytes = 0;
  for (const relative of result.stdout.split('\0').filter(Boolean).sort().slice(0, MAX_FILES)) {
    const target = path.join(root, relative);
    await assertContainedPath(root, target);
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile()) { rows.push({ path: relative, type: info?.isSymbolicLink() ? 'symlink' : 'other' }); continue; }
    bytes += info.size;
    invariant(bytes <= MAX_HASH_BYTES, 'ERR_ISOLATION_BOUNDS', 'Source untracked inventory exceeds the isolation hash budget');
    rows.push({ path: relative, size: info.size, sha256: sha256(await readFile(target)) });
  }
  return hashObject(rows);
}

async function sourceFingerprint(root) {
  const [untracked] = await Promise.all([untrackedDigest(root)]);
  const status = runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { maxBuffer: 8 * 1024 * 1024 }).stdout;
  const unstaged = runGit(root, ['diff', '--binary', '--no-ext-diff'], { maxBuffer: 64 * 1024 * 1024 }).stdout;
  const staged = runGit(root, ['diff', '--cached', '--binary', '--no-ext-diff'], { maxBuffer: 64 * 1024 * 1024 }).stdout;
  return hashObject({
    head: runGit(root, ['rev-parse', 'HEAD']).stdout.trim(),
    status,
    unstaged: sha256(unstaged),
    staged: sha256(staged),
    untracked,
  });
}

async function removeWorktree(root, directory) {
  runGit(root, ['worktree', 'remove', '--force', directory], { allowFailure: true, maxBuffer: 1024 * 1024 });
  await rm(directory, { recursive: true, force: true });
  runGit(root, ['worktree', 'prune'], { allowFailure: true, maxBuffer: 1024 * 1024 });
}

async function oneRun(root, gitSha, criterion, input, sequence) {
  const parent = await mkdtemp(path.join(os.tmpdir(), `shipping-isolated-${sequence}-`));
  const worktree = path.join(parent, 'worktree');
  try {
    const added = runGit(root, ['worktree', 'add', '--detach', worktree, gitSha], { allowFailure: true, maxBuffer: 4 * 1024 * 1024 });
    invariant(added.exitCode === 0, 'ERR_ISOLATION_WORKTREE', 'Failed to create isolated Git worktree', { stderr: added.stderr.slice(-2000) });
    const relativeCwd = criterion.cwd ?? '.';
    const cwd = path.resolve(worktree, relativeCwd);
    await assertContainedPath(worktree, cwd);
    const before = await inventory(worktree);
    const result = await runBoundedCommand({
      command: criterion.command,
      cwd,
      timeoutSeconds: input.timeoutSeconds,
      maxOutputBytes: input.maxOutputBytes,
      env: {
        ...input.env,
        SHIPPING_HARNESS_ISOLATED: '1',
        SHIPPING_HARNESS_ISOLATION_SEQUENCE: String(sequence),
      },
    });
    const after = await inventory(worktree);
    const artifacts = inventoryDelta(before, after);
    return {
      result,
      artifactDigest: artifacts.hash,
      artifactChanges: artifacts.changes.map((entry) => entry.path).slice(0, 500),
      inventoryBytes: after.bytes,
    };
  } finally {
    await removeWorktree(root, worktree).catch(() => {});
    await rm(parent, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Execute a side-effecting acceptance command in detached worktrees. The source
 * worktree is fingerprinted before and after; deterministic criteria run twice.
 */
export async function runIsolatedAcceptance(root, gitSha, criterion, input) {
  invariant(criterion.isolationRequired === true, 'ERR_ISOLATION_POLICY', 'runIsolatedAcceptance requires isolationRequired=true');
  invariant(criterion.automaticallyRunnable !== false, 'ERR_ISOLATION_MANUAL', 'This side-effecting command is not authorized for automatic execution');
  const sourceBefore = await sourceFingerprint(root);
  const first = await oneRun(root, gitSha, criterion, input, 1);
  const second = criterion.deterministicOutputRequired === true
    ? await oneRun(root, gitSha, criterion, input, 2)
    : null;
  const sourceAfter = await sourceFingerprint(root);
  const sourceUnchanged = sourceBefore === sourceAfter;
  const deterministic = second === null || first.artifactDigest === second.artifactDigest;
  const exitCode = first.result.exitCode === 0 && (second?.result.exitCode ?? 0) === 0 && deterministic && sourceUnchanged
    ? 0
    : first.result.exitCode === 0 ? 1 : first.result.exitCode;
  return {
    ...first.result,
    exitCode,
    deterministicMismatch: !deterministic,
    sourceMutationDetected: !sourceUnchanged,
    isolation: {
      mode: 'detached-git-worktree',
      sourceUnchanged,
      deterministicRequired: criterion.deterministicOutputRequired === true,
      deterministic,
      firstArtifactDigest: first.artifactDigest,
      secondArtifactDigest: second?.artifactDigest ?? null,
      artifactChanges: first.artifactChanges,
      repeatArtifactChanges: second?.artifactChanges ?? [],
    },
  };
}
