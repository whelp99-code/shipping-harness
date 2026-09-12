import path from 'node:path';
import { hashObject } from './crypto.mjs';
import { currentGitSha, runGit } from './git.mjs';
import { invariant } from './errors.mjs';

export const BASELINE_CATEGORIES = Object.freeze([
  'PRODUCT',
  'RELEASE_EVIDENCE',
  'AGENT_RUNTIME',
  'SHIPPING_RUNTIME',
  'GENERATED',
  'UNKNOWN',
]);

const AGENT_ROOTS = new Set(['.omo', '.senpi', '.serena', '.orca', '.cursor', '.claude']);
const GENERATED_SEGMENTS = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'target', '.next', '.cache',
  '.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache',
]);

function normalizePath(value) {
  let result = String(value ?? '').trim();
  if (result.startsWith('"') && result.endsWith('"')) {
    // git quotes exotic paths as C-style JSON strings; if that decoding fails, strip the quotes as a best-effort fallback.
    try { result = JSON.parse(result); } catch { result = result.slice(1, -1); }
  }
  return result.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function porcelainPaths(raw) {
  const parts = raw.split(' -> ').map(normalizePath).filter(Boolean);
  return parts.length > 0 ? parts : [''];
}

/** @param {string} line */
export function parsePorcelainEntry(line) {
  const status = String(line).slice(0, 2);
  const paths = porcelainPaths(String(line).slice(3));
  return {
    status,
    path: paths.at(-1),
    originalPath: paths.length > 1 ? paths[0] : null,
    paths,
    tracked: status !== '??',
    untracked: status === '??',
  };
}

function firstSegment(file) {
  return normalizePath(file).split('/')[0] ?? '';
}

function isGenerated(file) {
  const normalized = normalizePath(file);
  const base = path.posix.basename(normalized);
  if (base === '.DS_Store' || base.endsWith('.pyc') || base.endsWith('.tmp') || base.endsWith('.log')) return true;
  return normalized.split('/').some((segment) => GENERATED_SEGMENTS.has(segment));
}

function isReleaseEvidence(file) {
  const normalized = normalizePath(file);
  const base = path.posix.basename(normalized).toUpperCase();
  return base === 'RELEASE_MANIFEST.JSON'
    || base === 'SHA256SUMS'
    || base === 'SHA256SUMS.TXT'
    || base === 'CHECKSUMS'
    || base.endsWith('.SHA256')
    || /^CHANGELOG(?:\.|$)/u.test(base)
    || /^RELEASE(?:_|-|\.|$)/u.test(base)
    || normalized.includes('/docs/verification/')
    || normalized.startsWith('docs/verification/');
}

function classify(entry) {
  const file = entry.path;
  const segment = firstSegment(file);
  if (!file || file.includes('\0') || path.posix.isAbsolute(file) || file.split('/').includes('..')) {
    return { category: 'UNKNOWN', blocking: true, reason: 'Path could not be classified safely.' };
  }
  if (segment === '.shipping') {
    return { category: 'SHIPPING_RUNTIME', blocking: false, reason: 'Shipping runtime state is not product source.' };
  }
  if (AGENT_ROOTS.has(segment)) {
    return {
      category: 'AGENT_RUNTIME',
      blocking: entry.tracked,
      reason: entry.tracked
        ? 'Tracked agent-runtime content may be project policy and requires review.'
        : 'Untracked agent-runtime state is visible but does not block product baseline approval.',
    };
  }
  if (isGenerated(file)) {
    return {
      category: 'GENERATED',
      blocking: entry.tracked,
      reason: entry.tracked
        ? 'Tracked generated-looking content cannot be ignored automatically.'
        : 'Untracked generated output is visible but non-blocking.',
    };
  }
  if (isReleaseEvidence(file)) {
    return { category: 'RELEASE_EVIDENCE', blocking: true, reason: 'Release metadata or verification evidence belongs to the reviewed baseline.' };
  }
  return { category: 'PRODUCT', blocking: true, reason: 'Product source, configuration, test, documentation, or repository-owned script.' };
}

function suggestedCommitMessage(paths) {
  const text = paths.join(' ').toLowerCase();
  const auth = /auth|login|playwright/u.test(text);
  const pack = /package|release|checksum|sha256|manifest/u.test(text);
  if (auth && pack) return 'test: preserve authentication and release packaging baseline';
  if (auth) return 'test: preserve authentication verification baseline';
  if (pack) return 'chore: preserve release packaging baseline';
  if (/docs?|readme/u.test(text) && !/src|app|test|script/u.test(text)) return 'docs: preserve existing documentation baseline';
  return 'chore: preserve existing project baseline';
}

/**
 * Classify a bounded porcelain status list without modifying Git.
 * @param {string} root
 * @param {string[]} porcelain
 * @param {{gitSha?:string}} [input]
 */
export function analyzeBaseline(root, porcelain, input = {}) {
  const entries = porcelain.slice(0, 500).map((line) => {
    const parsed = parsePorcelainEntry(line);
    const classification = classify(parsed);
    return { ...parsed, ...classification };
  });
  const blockingPaths = [...new Set(entries.filter((entry) => entry.blocking).flatMap((entry) => entry.paths))].sort();
  const nonBlockingPaths = [...new Set(entries.filter((entry) => !entry.blocking).flatMap((entry) => entry.paths))].sort();
  const counts = Object.fromEntries(BASELINE_CATEGORIES.map((category) => [category, entries.filter((entry) => entry.category === category).length]));
  const baseGitSha = input.gitSha ?? currentGitSha(root);
  const fileSetHash = hashObject(entries
    .filter((entry) => entry.blocking)
    .map((entry) => ({ status: entry.status, paths: entry.paths, category: entry.category, tracked: entry.tracked }))
    .sort((left, right) => left.paths.join('\0').localeCompare(right.paths.join('\0'))));
  const planBody = {
    schema: 'shipping-harness/baseline-plan-v1',
    baseGitSha,
    includePaths: blockingPaths,
    excludePaths: nonBlockingPaths,
    fileSetHash,
    recommendation: blockingPaths.length > 0 ? 'PRESERVE' : 'NONE',
    suggestedCommitMessage: suggestedCommitMessage(blockingPaths),
    rationale: blockingPaths.length > 0
      ? 'Review and preserve the exact blocking file set through an explicitly approved host-side commit.'
      : 'No product or unknown baseline changes require preservation.',
  };
  const plan = { ...planBody, hash: hashObject(planBody) };
  return {
    schema: 'shipping-harness/baseline-v1',
    entries,
    counts,
    blockingPaths,
    nonBlockingPaths,
    blockingCount: blockingPaths.length,
    cleanForApproval: blockingPaths.length === 0,
    plan,
  };
}

/** @param {string} value */
function splitNul(value) {
  return value.split('\0').filter(Boolean).map(normalizePath).sort();
}

/**
 * Verify a user-approved external baseline commit. This function never creates,
 * stages, resets, stashes, or discards anything.
 * @param {string} root
 * @param {Record<string, any>} baseline
 * @param {{baselinePlanHash?: string | null, baselineCommit?: string | null, baselineAuthorizedByUser?: boolean}} input
 */
export function verifyBaselinePreservation(root, baseline, input) {
  invariant(baseline?.plan?.hash, 'ERR_BASELINE_PLAN', 'The active proposal has no baseline plan');
  invariant(input.baselineAuthorizedByUser === true, 'ERR_BASELINE_APPROVAL', 'Baseline preservation requires explicit user authorization');
  invariant(input.baselinePlanHash === baseline.plan.hash, 'ERR_BASELINE_DRIFT', 'The reviewed baseline plan hash changed');
  invariant(/^[a-f0-9]{40}$/u.test(input.baselineCommit ?? ''), 'ERR_BASELINE_COMMIT', 'baselineCommit must be a full Git SHA');
  const current = currentGitSha(root);
  invariant(current === input.baselineCommit, 'ERR_BASELINE_COMMIT', 'baselineCommit is not the current Git HEAD');
  invariant(current !== baseline.plan.baseGitSha, 'ERR_BASELINE_COMMIT', 'No new baseline commit was created');
  const parent = runGit(root, ['rev-parse', `${current}^`], { allowFailure: true }).stdout.trim();
  invariant(parent === baseline.plan.baseGitSha, 'ERR_BASELINE_HISTORY', 'The baseline commit must directly follow the reviewed Git HEAD');
  const committed = splitNul(runGit(root, ['diff', '--name-only', '-z', baseline.plan.baseGitSha, current, '--']).stdout);
  const expected = [...baseline.plan.includePaths].sort();
  invariant(hashObject(committed) === hashObject(expected), 'ERR_BASELINE_DRIFT', 'Committed paths differ from the reviewed baseline plan', { expected, committed });
  return {
    schema: 'shipping-harness/baseline-preservation-v1',
    baselinePlanHash: baseline.plan.hash,
    baseGitSha: baseline.plan.baseGitSha,
    commit: current,
    paths: committed,
    userAuthorized: true,
    verifiedAt: new Date().toISOString(),
  };
}
