import path from 'node:path';
import { assertLockedContract } from './contract.mjs';
import { commitsBetween, currentGitSha, changedPathsSince, gitStatus, runGit, treeFingerprint } from './git.mjs';
import { analyzeScope } from './glob.mjs';
import { runAcceptance, loadEvidence, assertFreshEvidence, recordBaselineReplays } from './evidence.mjs';
import {
  attachContractDefectDiagnostics,
  replayFailedAcceptanceOnBaseline,
  skippedBaselineReplay,
} from './contract-defect.mjs';
import {
  backlogFromIssues,
  countIssues,
  issuesFromEvidence,
  issuesFromScope,
  issuesFromVerifyBudget,
  loadIssues,
  replaceGeneratedIssues,
} from './issues.mjs';
import { exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { invariant, ShippingError } from './errors.mjs';
import { readState, readTrustedState, recordLedger, transitionState } from './state.mjs';
import { goalStatusView } from './goals/status-view.mjs';
import { assessStateIntegritySafe, stateIntegrityIssue } from './state-integrity.mjs';
import { loadShippingPlan, planStageSnapshot } from './shipping-plan.mjs';

/**
 * Per-criterion exit codes, sorted by criterion id, used to detect a verify run that
 * reproduced the previous one with no new evidence.
 * @param {Record<string, any>} manifest
 */
function acceptanceSignature(manifest) {
  return manifest.results
    .map((result) => `${result.criterionId}:${String(result.exitCode)}`)
    .sort()
    .join('|');
}

/**
 * v1.10.0 Phase C: bound verify-run iteration. Two budgets apply.
 *
 * `budgets.maxRedundantVerifyRuns` (default 5) counts consecutive runs that reproduced the
 * previous run's *tree fingerprint* and per-criterion exit codes, i.e. produced no new
 * evidence. Comparing the fingerprint rather than the Git SHA is what makes the counter
 * work on an uncommitted tree: toggling a file between runs used to reset it every time.
 *
 * `budgets.maxVerifyRuns` (default 25) is a hard cap on the TOTAL verify runs of a release,
 * so alternating results cannot buy unlimited iterations.
 *
 * Either exhaustion decides BLOCKED, and the state machine then refuses the next `verify`
 * call outright (BLOCKED is excluded at the top of `verifyRelease`).
 * @param {string} root
 * @param {Record<string, any>} contract
 * @param {Record<string, any>} state
 * @param {{fingerprint: string}} tree
 * @param {Record<string, any>} manifest
 */
async function verifyBudgetOutcome(root, contract, state, tree, manifest) {
  const maxVerifyRuns = contract.budgets.maxVerifyRuns ?? 25;
  const maxRedundantVerifyRuns = contract.budgets.maxRedundantVerifyRuns ?? 5;
  let redundant = false;
  if (state.lastRunId && state.currentEvidenceFingerprint === tree.fingerprint) {
    try {
      const previousManifest = await loadEvidence(root, state.lastRunId);
      redundant = acceptanceSignature(previousManifest) === acceptanceSignature(manifest);
    } catch {
      redundant = false;
    }
  }
  const redundantVerifyRuns = redundant ? (state.redundantVerifyRuns ?? 0) + 1 : 0;
  const verifyRuns = (state.verifyRuns ?? 0) + 1;
  const redundantExhausted = redundantVerifyRuns >= maxRedundantVerifyRuns;
  const totalExhausted = verifyRuns >= maxVerifyRuns;
  return {
    maxVerifyRuns,
    maxRedundantVerifyRuns,
    redundantVerifyRuns,
    verifyRuns,
    exhausted: redundantExhausted || totalExhausted,
    exhaustedBudget: redundantExhausted ? 'maxRedundantVerifyRuns' : totalExhausted ? 'maxVerifyRuns' : null,
  };
}

/**
 * @param {string} root
 * @param {{baselineReplay?: boolean}} [options] `baselineReplay: false` skips the contract-defect replay.
 */
export async function verifyRelease(root, options = {}) {
  const { contract, lock } = await assertLockedContract(root);
  let state = await readTrustedState(root);
  invariant(!state.humanStop, 'ERR_HUMAN_STOP', 'Verification is denied while human stop is active', { state: state.state });
  invariant(!['DRAFT', 'PAUSED', 'CLOSED', 'ABORTED', 'BLOCKED'].includes(state.state), 'ERR_STATE_VERIFY', `Cannot verify from ${state.state}`);
  if (state.state !== 'VERIFYING') {
    state = await transitionState(root, 'VERIFYING', {}, 'verification started');
  }

  const gitSha = currentGitSha(root);
  // Measured before the commands run, so acceptance side effects never change the identity
  // of the tree the evidence is attributed to.
  const tree = treeFingerprint(root, contract.scope.paths);
  const { manifest: rawManifest } = await runAcceptance(root, contract, lock, gitSha, tree);
  assertFreshEvidence(rawManifest, { contractHash: lock.contractHash, gitSha, treeFingerprint: tree.fingerprint });

  const changedPaths = changedPathsSince(root, lock.baselineSha);
  const scopeReport = analyzeScope(changedPaths, contract.scope.paths);
  const baselineReplay = options.baselineReplay === false
    ? skippedBaselineReplay()
    : await replayFailedAcceptanceOnBaseline(root, { contract, lock, manifest: rawManifest, changedPaths, gitSha, tree });
  const manifest = await recordBaselineReplays(root, rawManifest, baselineReplay.replays);
  const budget = await verifyBudgetOutcome(root, contract, state, tree, manifest);
  const generatedIssues = attachContractDefectDiagnostics([
    ...issuesFromEvidence(manifest),
    ...issuesFromScope(scopeReport, manifest.runId),
    ...(budget.exhausted ? issuesFromVerifyBudget(budget, manifest.runId) : []),
  ], baselineReplay);
  const issueDocument = await replaceGeneratedIssues(root, generatedIssues);
  const counts = countIssues(issueDocument.issues);
  const statePatch = {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    currentEvidenceSha: gitSha,
    currentEvidenceFingerprint: tree.fingerprint,
    lastRunId: manifest.runId,
    blockerCount: counts.BLOCKER,
    nextCount: counts.NEXT,
    ignoreCount: counts.IGNORE,
    unknownCount: counts.UNKNOWN,
    verifyRuns: budget.verifyRuns,
    redundantVerifyRuns: budget.redundantVerifyRuns,
    lastVerifiedAt: new Date().toISOString(),
  };

  let decision;
  if (counts.BLOCKER === 0) {
    decision = 'SHIPPABLE';
  } else if (budget.exhausted) {
    decision = 'BLOCKED';
  } else if (state.fixCycles >= contract.budgets.maxFixCycles) {
    decision = 'BLOCKED';
  } else {
    decision = 'TRIAGE';
  }
  const updated = await transitionState(root, decision, statePatch, `release gate decided ${decision}`);
  await recordLedger(root, {
    type: 'gate.decision',
    decision,
    runId: manifest.runId,
    gitSha,
    contractHash: lock.contractHash,
    counts,
    scope: scopeReport,
    baselineReplay,
    verifyBudget: budget,
  });
  return {
    decision,
    state: updated,
    manifest,
    issues: issueDocument,
    scope: scopeReport,
    baselineReplay,
    verifyBudget: budget,
  };
}

/** @param {string} root */
export async function beginFixCycle(root) {
  const { contract } = await assertLockedContract(root);
  const state = await readTrustedState(root);
  // BLOCKED is reachable both from an exhausted fix-cycle budget and from an exhausted
  // verify-run budget (v1.10.0 Phase C); TRANSITIONS already allows BLOCKED -> FIXING as
  // the recovery path once the operator has actually changed something.
  invariant(['TRIAGE', 'BLOCKED'].includes(state.state), 'ERR_FIX_STATE', 'A fix cycle can begin only from TRIAGE or BLOCKED');
  if (state.fixCycles >= contract.budgets.maxFixCycles) {
    return transitionState(root, 'BLOCKED', {}, 'fix budget exhausted');
  }
  return transitionState(root, 'FIXING', { fixCycles: state.fixCycles + 1 }, 'operator began bounded fix cycle');
}

/** @param {string} root @param {string} adapter */
export async function beginAgentRun(root, adapter) {
  const { contract } = await assertLockedContract(root);
  const state = await readTrustedState(root);
  invariant(['LOCKED', 'FIXING'].includes(state.state), 'ERR_RUN_STATE', `Cannot start an agent run from ${state.state}`);
  invariant(!state.humanStop, 'ERR_HUMAN_STOP', 'Agent run denied by human stop');
  if (state.agentRuns >= contract.budgets.maxAgentRuns) {
    return transitionState(root, 'BLOCKED', { blockerCount: Math.max(1, state.blockerCount) }, 'agent run budget exhausted');
  }
  return transitionState(root, 'RUNNING', {
    agentRuns: state.agentRuns + 1,
    activeAdapter: adapter,
    lastAgentStartedAt: new Date().toISOString(),
  }, `agent run started via ${adapter}`);
}

/**
 * v1.10.0 Phase C: `telemetry` is the adapter run's cost receipt (durationMs, exitCode,
 * outputBytes, toolCalls, verifyRunsAtStart/End); it is stored on the transition (so the
 * ledger event carries it) and aggregated into `state.telemetry.totalAgentDurationMs`.
 * @param {string} root
 * @param {Record<string, any>} runResult
 * @param {Record<string, any> | null} [telemetry]
 */
export async function finishAgentRun(root, runResult, telemetry = null) {
  const state = await readTrustedState(root);
  invariant(state.state === 'RUNNING', 'ERR_RUN_STATE', 'No running agent execution to finish');
  const totalAgentDurationMs = (state.telemetry?.totalAgentDurationMs ?? 0) + (telemetry?.durationMs ?? 0);
  return transitionState(root, 'VERIFYING', {
    lastAgentResult: runResult,
    lastAgentFinishedAt: new Date().toISOString(),
    ...(telemetry ? { lastAgentTelemetry: telemetry } : {}),
    telemetry: { totalAgentDurationMs },
  }, 'agent run finished; verification required');
}

/**
 * The closure receipt for one release. A plan-bound contract propagates its stage
 * identity here so plan progress is computable from closed receipts alone.
 * @param {{contract: Record<string, any>, lock: Record<string, any>, state: Record<string, any>, gitSha: string, manifest: Record<string, any>, counts: Record<string, number>, backlog: Record<string, any>, integrations: unknown, uncommitted: string[], closedAt: string, planStage: Record<string, any> | null, postLockCommits: {commits: Array<Record<string, any>>, truncated: number}}} input
 * @returns {Record<string, any> & {release: string, closedGitSha: string}}
 */
function composeReleaseReceipt(input) {
  const { contract, lock, state, backlog } = input;
  return {
    schema: 'shipping-harness/release-v1',
    project: contract.project,
    worker: contract.worker,
    release: contract.release,
    goal: contract.goal,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    closedGitSha: input.gitSha,
    evidenceRunId: state.lastRunId,
    acceptance: input.manifest.summary,
    issueCounts: input.counts,
    backlogCount: backlog.items.length,
    fixCycles: state.fixCycles,
    agentRuns: state.agentRuns,
    verifyRuns: state.verifyRuns ?? 0,
    telemetry: { totalAgentDurationMs: state.telemetry?.totalAgentDurationMs ?? 0 },
    integrations: input.integrations,
    closedAt: input.closedAt,
    ...(contract.plan ? { planStageId: contract.plan.stageId, planHash: contract.plan.planHash, tier: contract.plan.tier } : {}),
    ...(input.planStage ? { planStage: input.planStage } : {}),
    // v1.13.0 Phase B: every commit made between the lock baseline and the closed
    // revision, recorded so a human can see work that entered the release after approval.
    postLockCommits: input.postLockCommits.commits,
    ...(input.postLockCommits.truncated > 0 ? { postLockCommitsTruncated: input.postLockCommits.truncated } : {}),
    ...(input.uncommitted.length > 0 ? { uncommittedPaths: input.uncommitted } : {}),
  };
}

/**
 * The stage definition a plan-bound release closes against. A stage cannot close without
 * it: the receipt snapshot is the permanent record of what the stage said, so a missing or
 * unreadable plan file at close time refuses the close rather than closing with nothing.
 * @param {string} root
 * @param {Record<string, any>} contract
 * @returns {Promise<Record<string, any>>}
 */
async function closePlanStageSnapshot(root, contract) {
  /** @type {Record<string, any> | null} */
  let binding;
  try {
    binding = await loadShippingPlan(root, contract.plan.path, { auditHistory: true });
  } catch (error) {
    if (error?.code === 'ERR_PLAN_HISTORY_LOST' || error?.code === 'ERR_PLAN_SUPERSEDES_UNKNOWN') throw error;
    throw new ShippingError('ERR_PLAN_UNAVAILABLE_AT_CLOSE', `The plan stage definition is unavailable at close: ${error?.message ?? 'the plan file could not be read'}`, {
      path: contract.plan.path,
      stageId: contract.plan.stageId,
      cause: typeof error?.code === 'string' ? error.code : 'ERR_UNEXPECTED',
    });
  }
  const stage = binding?.plan.stages.find((entry) => entry.id === contract.plan.stageId) ?? null;
  invariant(stage, 'ERR_PLAN_UNAVAILABLE_AT_CLOSE', `The plan file no longer defines stage ${contract.plan.stageId}; a stage cannot close without its definition`, {
    path: contract.plan.path,
    stageId: contract.plan.stageId,
  });
  return planStageSnapshot(stage);
}

/**
 * @param {string} root
 * @param {{allowUncommitted?: boolean}} [options] `allowUncommitted: true` records the override in the receipt.
 */
export async function closeRelease(root, options = {}) {
  const paths = runtimePaths(root);
  const { contract, lock } = await assertLockedContract(root);
  const state = await readTrustedState(root);
  invariant(state.state === 'SHIPPABLE', 'ERR_NOT_SHIPPABLE', `Release cannot close from ${state.state}`);
  invariant(!state.humanStop, 'ERR_HUMAN_STOP', 'Release closure denied by human stop');
  const gitSha = currentGitSha(root);
  invariant(state.currentEvidenceSha === gitSha, 'ERR_EVIDENCE_STALE', 'Current source revision has no accepted evidence', {
    evidenceSha: state.currentEvidenceSha,
    gitSha,
  });
  invariant(typeof state.lastRunId === 'string' && state.lastRunId, 'ERR_EVIDENCE_MISSING', 'No accepted evidence run is recorded');
  // Close deliberately does NOT compare the tree fingerprint: an out-of-scope dirty path
  // must not refuse a close (fixed by test/adversarial/close-uncommitted-attacks), and the
  // in-scope half is already refused below by ERR_CLOSE_UNCOMMITTED, with any commit of it
  // moving HEAD and failing the evidence-SHA check above.
  const tree = treeFingerprint(root, contract.scope.paths);
  const manifest = assertFreshEvidence(await loadEvidence(root, state.lastRunId), {
    contractHash: lock.contractHash,
    gitSha,
  });
  invariant(manifest.summary.requiredFailed === 0, 'ERR_ACCEPTANCE_FAILED', 'Required acceptance criteria still fail');
  const issues = await loadIssues(root);
  const counts = countIssues(issues.issues);
  invariant(counts.BLOCKER === 0, 'ERR_BLOCKERS_REMAIN', 'Release blockers remain', { counts });
  // In-scope paths HEAD does not contain yet: the receipt binds `closedGitSha` to HEAD, so
  // closing over these would attest to a tree that does not hold the implementation.
  const uncommitted = tree.inScopeDirtyPaths;
  if (uncommitted.length > 0 && options.allowUncommitted !== true) {
    throw new ShippingError('ERR_CLOSE_UNCOMMITTED', `In-scope work is not committed, so the release receipt cannot attest to HEAD: ${uncommitted.slice(0, 20).join(', ')}`, {
      paths: uncommitted,
      closedGitSha: gitSha,
    });
  }

  const integrations = (await exists(paths.integrations)) ? await readJson(paths.integrations) : null;
  const backlog = {
    schema: 'shipping-harness/backlog-v1',
    release: contract.release,
    generatedAt: new Date().toISOString(),
    items: backlogFromIssues(issues.issues),
  };
  await writeJsonAtomic(paths.backlog, backlog);

  const closedAt = new Date().toISOString();
  const planStage = contract.plan ? await closePlanStageSnapshot(root, contract) : null;
  const postLockCommits = commitsBetween(root, lock.baselineSha, gitSha);
  const receipt = composeReleaseReceipt({ contract, lock, state, gitSha, manifest, counts, backlog, integrations, uncommitted, closedAt, planStage, postLockCommits });
  const receiptPath = path.join(paths.releases, `${contract.release}.json`);
  const reportPath = path.join(paths.releases, `${contract.release}.md`);
  await writeJsonAtomic(receiptPath, receipt);
  await writeAtomic(reportPath, renderReleaseReport(receipt, manifest, issues.issues, backlog.items));
  const updated = await transitionState(root, 'CLOSED', {
    closedAt,
    closedGitSha: gitSha,
    releaseReceipt: path.relative(root, receiptPath).replaceAll('\\', '/'),
  }, `release ${contract.release} closed`);
  await recordLedger(root, { type: 'release.closed', receipt });
  return { state: updated, receipt, receiptPath, reportPath, backlog };
}

/**
 * Advisory list of working-tree changes that fall outside `scope.paths.include`, so the
 * operator can revert them before verification decides. Status never judges; verify does.
 * @param {string} root
 * @param {Record<string, any> | null} contract
 * @param {string | null} baselineSha
 */
function scopeWarningFor(root, contract, baselineSha) {
  if (!contract || !baselineSha) return null;
  const analyzed = analyzeScope(changedPathsSince(root, baselineSha), contract.scope.paths);
  return {
    outside: analyzed.violations.map((violation) => violation.path),
    include: contract.scope.paths.include,
  };
}

/**
 * v1.13.0 Phase B: how many commits the branch has taken since the scope was locked.
 * Reported, never judged: `null` before LOCKED, because there is no baseline to count from.
 * @param {string} root
 * @param {Record<string, any>} state
 * @param {string | null} baselineSha
 * @param {string} headSha
 * @returns {number | null}
 */
function commitsSinceLockFor(root, state, baselineSha, headSha) {
  if (!baselineSha || ['DRAFT', 'ABORTED'].includes(state.state)) return null;
  const counted = runGit(root, ['rev-list', '--count', `${baselineSha}..${headSha}`], { allowFailure: true });
  if (counted.exitCode !== 0) return null;
  const value = Number.parseInt(counted.stdout.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * v1.10.0 Phase C: only surfaced once a redundant run has been recorded or the total cap
 * has been reached, so a healthy release never carries a noise line about a budget it is
 * nowhere near.
 * @param {Record<string, any>} state
 * @param {Record<string, any> | null} contract
 */
function verifyBudgetFor(state, contract) {
  const redundantVerifyRuns = state.redundantVerifyRuns ?? 0;
  const verifyRuns = state.verifyRuns ?? 0;
  const maxVerifyRuns = contract?.budgets?.maxVerifyRuns ?? 25;
  if (redundantVerifyRuns <= 0 && verifyRuns < maxVerifyRuns) return null;
  return {
    verifyRuns,
    redundantVerifyRuns,
    maxVerifyRuns,
    maxRedundantVerifyRuns: contract?.budgets?.maxRedundantVerifyRuns ?? 5,
  };
}

/** @param {string} root */
export async function releaseStatus(root) {
  const paths = runtimePaths(root);
  const stored = await readState(root);
  const integrity = await assessStateIntegritySafe(root);
  // A tampered state file is never reported as authority: the last state the ledger proves is.
  /** @type {Record<string, any>} */
  const state = integrity.level === 'TAMPERED' && integrity.ledgerState
    ? { ...stored, state: integrity.ledgerState }
    : stored;
  const git = gitStatus(root);
  const issues = await loadIssues(root);
  const reportedIssues = integrity.level === 'TAMPERED'
    ? [stateIntegrityIssue(integrity), ...issues.issues]
    : issues.issues;
  let contract = null;
  let lock = null;
  let contractValid = false;
  let contractError = null;
  try {
    const locked = await assertLockedContract(root);
    contract = locked.contract;
    lock = locked.lock;
    contractValid = true;
  } catch (error) {
    contractError = error instanceof Error ? error.message : String(error);
  }
  let closedDrift = null;
  if (state.state === 'CLOSED' && state.closedGitSha) {
    const changed = changedPathsSince(root, state.closedGitSha);
    const analyzed = analyzeScope(changed, contract?.scope?.paths ?? { include: ['**'], exclude: [] });
    closedDrift = {
      ...analyzed,
      violations: [
        ...analyzed.violations,
        ...analyzed.allowed.map((filePath) => ({ path: filePath, reason: 'closed-version-change' })),
      ],
      allowed: [],
      requiresNewContract: analyzed.violations.length + analyzed.allowed.length > 0,
    };
  }
  const goals = await goalStatusView(root);
  const tree = treeFingerprint(root, contract?.scope?.paths ?? null);
  const commitsSinceLock = commitsSinceLockFor(root, state, lock?.baselineSha ?? state.baselineSha ?? null, git.sha);
  return {
    state,
    git,
    contract: contract ? { project: contract.project, release: contract.release, hash: lock.contractHash } : null,
    contractValid,
    contractError,
    issues: { counts: countIssues(reportedIssues), items: reportedIssues },
    integrity,
    scopeWarning: scopeWarningFor(root, contract, lock?.baselineSha ?? state.baselineSha ?? null),
    commitsSinceLock,
    verifyBudget: verifyBudgetFor(state, contract),
    // Evidence recorded against a dirty tree is only fresh while that tree is unchanged.
    evidenceFresh: Boolean(state.currentEvidenceSha && state.currentEvidenceSha === git.sha && contractValid
      && (!state.currentEvidenceFingerprint || state.currentEvidenceFingerprint === tree.fingerprint)),
    evidenceDirty: tree.dirtyPaths.length > 0
      ? { dirtyPaths: tree.dirtyPaths, inScope: tree.inScopeDirtyPaths, fingerprint: tree.fingerprint }
      : null,
    closedDrift,
    goals,
    paths,
  };
}

/**
 * @param {Record<string, any>} receipt
 * @param {Record<string, any>} manifest
 * @param {Array<Record<string, any>>} issues
 * @param {Array<Record<string, any>>} backlog
 */
function renderReleaseReport(receipt, manifest, issues, backlog) {
  const resultRows = manifest.results
    .map((result) => `| ${result.criterionId} | ${result.required ? 'required' : 'optional'} | ${result.status} | ${String(result.exitCode)} | ${result.durationMs} ms |`)
    .join('\n');
  const issueRows = issues.length
    ? issues.map((issue) => `| ${issue.id} | ${issue.classification} | ${issue.basisId ?? '-'} | ${issue.title.replaceAll('|', '\\|')} |`).join('\n')
    : '| - | - | - | No findings |';
  const backlogRows = backlog.length
    ? backlog.map((item) => `- ${item.id}: ${item.title}`).join('\n')
    : '- None';
  const postLockRows = receipt.postLockCommits.length
    ? receipt.postLockCommits.map((entry) => `| \`${entry.sha.slice(0, 12)}\` | ${entry.subject.replaceAll('|', '\\|')} | ${entry.paths.join(', ') || '-'} |`).join('\n')
    : '| - | No commit was made after the scope was locked | - |';
  return `# Release ${receipt.release}\n\n` +
    `- Project: ${receipt.project}\n` +
    `- Worker: ${receipt.worker}\n` +
    `- Closed: ${receipt.closedAt}\n` +
    `- Contract hash: \`${receipt.contractHash}\`\n` +
    `- Baseline Git SHA: \`${receipt.baselineSha}\`\n` +
    `- Closed source Git SHA: \`${receipt.closedGitSha}\`\n` +
    `- Evidence run: \`${receipt.evidenceRunId}\`\n` +
    `- Fix cycles: ${receipt.fixCycles}\n` +
    `- Agent runs: ${receipt.agentRuns}\n` +
    `- Verify runs: ${receipt.verifyRuns}\n` +
    `- Commits after lock: ${receipt.postLockCommits.length}${receipt.postLockCommitsTruncated ? ` (+${receipt.postLockCommitsTruncated} not listed)` : ''}\n` +
    `- Total agent duration: ${receipt.telemetry.totalAgentDurationMs} ms\n\n` +
    `## Goal\n\n${receipt.goal}\n\n` +
    `## Acceptance evidence\n\n| Criterion | Requirement | Result | Exit | Duration |\n|---|---|---|---:|---:|\n${resultRows}\n\n` +
    `## Findings\n\n| ID | Class | Basis | Title |\n|---|---|---|---|\n${issueRows}\n\n` +
    `## Commits after lock\n\n| Commit | Subject | Paths |\n|---|---|---|\n${postLockRows}\n\n` +
    `## Migrated backlog\n\n${backlogRows}\n`;
}