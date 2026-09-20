// Contract-defect signalling (v1.10.0 Phase B).
//
// A locked acceptance criterion can be impossible to satisfy from inside the approved
// scope: the command is broken, the environment is wrong, or the criterion never proved
// anything in the first place. The engine cannot reason about that, so it measures it:
//
//   - `replayFailedAcceptanceOnBaseline` re-runs each failed REQUIRED command once against
//     a detached checkout of the locked baseline commit. Failing identically there, while
//     the working tree does contain in-scope changes, means the failure is not caused by
//     the implementation. The verdict stays BLOCKER; only a diagnostic is attached.
//   - `runAcceptancePreflight` runs every acceptance command once against the pre-implementation
//     tree at lock time, so an already-passing (proves nothing) or environment-broken criterion
//     is visible before any work starts. It never blocks the lock.
//
// Both paths use the same command budgets as verification and never store command output.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { assertContainedPath, ensureDir } from './fs.mjs';
import { runGit, uncommittedPaths } from './git.mjs';
import { analyzeScope } from './glob.mjs';
import { runtimePaths } from './paths.mjs';
import { runBoundedCommand } from './process.mjs';
import { invariant } from './errors.mjs';

export const CONTRACT_DEFECT_CODE = 'CONTRACT_DEFECT_SUSPECTED';

/**
 * The command budget for one criterion, capped by the contract-wide budget.
 * @param {Record<string, any>} contract
 * @param {Record<string, any>} criterion
 */
function commandBudget(contract, criterion) {
  return {
    timeoutSeconds: Math.min(
      criterion.timeoutSeconds ?? contract.budgets.maxCommandSeconds,
      contract.budgets.maxCommandSeconds,
    ),
    maxOutputBytes: contract.budgets.maxOutputBytes,
  };
}

/**
 * Run `body` against a throwaway detached worktree of `sha` under `.shipping/tmp/`.
 * The worktree is always removed, including on failure.
 * @template T
 * @param {string} root
 * @param {string} sha
 * @param {(worktree: string) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function withDetachedWorktree(root, sha, body) {
  const paths = runtimePaths(root);
  await ensureDir(paths.tmp);
  const directory = path.join(paths.tmp, `baseline-replay-${randomUUID().slice(0, 8)}`);
  try {
    const added = runGit(root, ['worktree', 'add', '--detach', directory, sha], {
      allowFailure: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    invariant(added.exitCode === 0, 'ERR_BASELINE_WORKTREE', 'Failed to create the baseline replay worktree', {
      sha,
      stderr: added.stderr.slice(-2000),
    });
    return await body(directory);
  } finally {
    runGit(root, ['worktree', 'remove', '--force', directory], { allowFailure: true, maxBuffer: 1024 * 1024 });
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    runGit(root, ['worktree', 'prune'], { allowFailure: true, maxBuffer: 1024 * 1024 });
  }
}

/**
 * @param {string} worktree
 * @param {Record<string, any>} contract
 * @param {Record<string, any>} criterion
 * @param {Record<string, any>} failedResult
 * @param {boolean} inScopeDiff
 */
async function replayOne(worktree, contract, criterion, failedResult, inScopeDiff) {
  const cwd = path.resolve(worktree, criterion.cwd ?? '.');
  await assertContainedPath(worktree, cwd);
  const run = await runBoundedCommand({
    command: criterion.command,
    cwd,
    ...commandBudget(contract, criterion),
    env: {
      SHIPPING_HARNESS_BASELINE_REPLAY: '1',
      SHIPPING_HARNESS_CRITERION_ID: criterion.id,
    },
  });
  const sameFailure = run.exitCode !== null && run.exitCode !== 0 && run.exitCode === failedResult.exitCode;
  return {
    id: criterion.id,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    timedOut: run.timedOut,
    suspected: sameFailure && !run.timedOut && inScopeDiff,
  };
}

/**
 * Replay every failed REQUIRED acceptance command once on the locked baseline commit.
 * Skipped when nothing required failed, or when the tree under verification *is* the clean
 * baseline (HEAD is the baseline commit and no in-scope path is dirty) — replaying that
 * tree against itself proves nothing. HEAD being the baseline is not enough on its own:
 * uncommitted in-scope work makes the verified tree differ from the baseline, which is
 * exactly the case where a criterion failing on both trees indicates a contract defect.
 * The baseline worktree is clean by construction, so the replay is still meaningful.
 * @param {string} root
 * @param {{contract: Record<string, any>, lock: Record<string, any>, manifest: Record<string, any>, changedPaths: string[], gitSha: string, tree?: {inScopeDirtyPaths: string[]} | null}} input
 */
export async function replayFailedAcceptanceOnBaseline(root, input) {
  const { contract, lock, manifest, changedPaths, gitSha, tree = null } = input;
  const baselineSha = typeof lock.baselineSha === 'string' ? lock.baselineSha : null;
  if (!baselineSha) return { skipped: 'no-baseline', baselineSha: null, inScopeChangedPaths: 0, replays: [] };
  const inScopeDirty = tree ? tree.inScopeDirtyPaths : analyzeScope(uncommittedPaths(root), contract.scope.paths).allowed;
  if (baselineSha === gitSha && inScopeDirty.length === 0) {
    return { skipped: 'clean-baseline', baselineSha, inScopeChangedPaths: 0, replays: [] };
  }
  const failed = manifest.results.filter((result) => result.required === true && result.status !== 'PASS');
  const inScope = analyzeScope(changedPaths, contract.scope.paths).allowed;
  if (failed.length === 0) {
    return { skipped: 'no-required-failure', baselineSha, inScopeChangedPaths: inScope.length, replays: [] };
  }
  const byId = new Map(contract.acceptance.map((criterion) => [criterion.id, criterion]));
  const replays = await withDetachedWorktree(root, baselineSha, async (worktree) => {
    const rows = [];
    for (const result of failed) {
      const criterion = byId.get(result.criterionId);
      if (!criterion) continue;
      rows.push(await replayOne(worktree, contract, criterion, result, inScope.length > 0));
    }
    return rows;
  });
  return { skipped: null, baselineSha, inScopeChangedPaths: inScope.length, replays };
}

/** @returns {{skipped: string, baselineSha: null, inScopeChangedPaths: number, replays: never[]}} */
export function skippedBaselineReplay() {
  return { skipped: 'disabled', baselineSha: null, inScopeChangedPaths: 0, replays: [] };
}

/**
 * Attach the contract-defect diagnostic to the acceptance issues whose criterion also
 * failed identically on the baseline. Classification is untouched: a BLOCKER stays a BLOCKER.
 * @param {Array<Record<string, any>>} issues
 * @param {{baselineSha: string | null, replays: Array<Record<string, any>>}} replay
 */
export function attachContractDefectDiagnostics(issues, replay) {
  const suspected = new Map((replay.replays ?? []).filter((row) => row.suspected).map((row) => [row.id, row]));
  if (suspected.size === 0) return issues;
  return issues.map((issue) => {
    const row = issue.basisId ? suspected.get(issue.basisId) : undefined;
    if (!row) return issue;
    return {
      ...issue,
      diagnostics: [
        ...(Array.isArray(issue.diagnostics) ? issue.diagnostics : []),
        {
          code: CONTRACT_DEFECT_CODE,
          detail: `acceptance ${row.id} also fails on the baseline commit ${replay.baselineSha}; the failure is independent of the in-scope implementation`,
          baselineExitCode: row.exitCode,
        },
      ],
    };
  });
}

/** @param {Array<Record<string, any>>} issues */
export function contractDefectCriteria(issues) {
  return issues
    .filter((issue) => (Array.isArray(issue?.diagnostics) ? issue.diagnostics : [])
      .some((entry) => entry && typeof entry === 'object' && entry.code === CONTRACT_DEFECT_CODE))
    .map((issue) => String(issue.basisId ?? issue.id));
}

/**
 * Run every acceptance command once against the current (pre-implementation) tree.
 * Advisory only: no output is stored and the caller never blocks on the verdicts.
 * @param {string} root
 * @param {Record<string, any>} contract
 */
export async function runAcceptancePreflight(root, contract) {
  const rows = [];
  for (const criterion of contract.acceptance) {
    const cwd = path.resolve(root, criterion.cwd ?? '.');
    await assertContainedPath(root, cwd);
    const run = await runBoundedCommand({
      command: criterion.command,
      cwd,
      ...commandBudget(contract, criterion),
      env: {
        SHIPPING_HARNESS_LOCK_PREFLIGHT: '1',
        SHIPPING_HARNESS_CRITERION_ID: criterion.id,
      },
    });
    rows.push({
      id: criterion.id,
      required: criterion.required === true,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      verdict: run.timedOut ? 'TIMEOUT' : run.exitCode === 0 ? 'ALREADY_PASSING' : 'FAILING_AS_EXPECTED',
    });
  }
  return rows;
}

/**
 * v1.13.17: the ALREADY_PASSING wording asserted one reading -- that the criterion is
 * stale -- and that is only true when the work is still ahead of the lock. A repository
 * that implements and then locks, which is how this one records its own releases and how
 * the reporting session records theirs, sees this on every criterion of every release
 * while nothing is wrong. A warning that is routinely correct and never actionable is how
 * a reader learns to skip warnings, including the one below it about an unrunnable
 * command. The fact is stated once and both readings named, because which workflow this
 * is cannot be told from the tree.
 * @param {Array<Record<string, any>>} preflight Preflight rows from runAcceptancePreflight.
 * @returns {string[]} One warning per criterion that did not fail as expected.
 */
export function preflightWarnings(preflight) {
  return preflight
    .filter((row) => row.verdict !== 'FAILING_AS_EXPECTED')
    .map((row) => row.verdict === 'ALREADY_PASSING'
      ? `${row.id} already passes on the baseline tree, so it proves nothing about work done after this lock. Expected when the implementation is already committed and this release records it; a stale criterion when the work is still ahead.`
      : `${row.id} timed out on the baseline tree, so it may be unrunnable in this environment and verify would then fail for the environment rather than the work. Check the command and its timeout before locking.`);
}
