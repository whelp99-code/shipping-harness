import path from 'node:path';
import { assertLockedContract } from './contract.mjs';
import { currentGitSha, changedPathsSince, gitStatus, uncommittedPaths } from './git.mjs';
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
  loadIssues,
  replaceGeneratedIssues,
} from './issues.mjs';
import { exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { invariant, ShippingError } from './errors.mjs';
import { readState, readTrustedState, recordLedger, transitionState } from './state.mjs';
import { goalStatusView } from './goals/status-view.mjs';
import { assessStateIntegritySafe, stateIntegrityIssue } from './state-integrity.mjs';

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
  const { manifest: rawManifest } = await runAcceptance(root, contract, lock, gitSha);
  assertFreshEvidence(rawManifest, { contractHash: lock.contractHash, gitSha });

  const changedPaths = changedPathsSince(root, lock.baselineSha);
  const scopeReport = analyzeScope(changedPaths, contract.scope.paths);
  const baselineReplay = options.baselineReplay === false
    ? skippedBaselineReplay()
    : await replayFailedAcceptanceOnBaseline(root, { contract, lock, manifest: rawManifest, changedPaths, gitSha });
  const manifest = await recordBaselineReplays(root, rawManifest, baselineReplay.replays);
  const generatedIssues = attachContractDefectDiagnostics([
    ...issuesFromEvidence(manifest),
    ...issuesFromScope(scopeReport, manifest.runId),
  ], baselineReplay);
  const issueDocument = await replaceGeneratedIssues(root, generatedIssues);
  const counts = countIssues(issueDocument.issues);
  const statePatch = {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    currentEvidenceSha: gitSha,
    lastRunId: manifest.runId,
    blockerCount: counts.BLOCKER,
    nextCount: counts.NEXT,
    ignoreCount: counts.IGNORE,
    unknownCount: counts.UNKNOWN,
    lastVerifiedAt: new Date().toISOString(),
  };

  let decision;
  if (counts.BLOCKER === 0) {
    decision = 'SHIPPABLE';
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
  });
  return {
    decision,
    state: updated,
    manifest,
    issues: issueDocument,
    scope: scopeReport,
    baselineReplay,
  };
}

/** @param {string} root */
export async function beginFixCycle(root) {
  const { contract } = await assertLockedContract(root);
  const state = await readTrustedState(root);
  invariant(state.state === 'TRIAGE', 'ERR_FIX_STATE', 'A fix cycle can begin only from TRIAGE');
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

/** @param {string} root @param {Record<string, any>} runResult */
export async function finishAgentRun(root, runResult) {
  const state = await readTrustedState(root);
  invariant(state.state === 'RUNNING', 'ERR_RUN_STATE', 'No running agent execution to finish');
  return transitionState(root, 'VERIFYING', {
    lastAgentResult: runResult,
    lastAgentFinishedAt: new Date().toISOString(),
  }, 'agent run finished; verification required');
}

/**
 * In-scope paths that HEAD does not contain yet. The receipt binds `closedGitSha` to HEAD,
 * so closing over these would attest to a tree that does not hold the implementation.
 * `.shipping/` runtime files are excluded by `analyzeScope`.
 * @param {string} root
 * @param {Record<string, any>} contract
 */
function uncommittedInScopePaths(root, contract) {
  return analyzeScope(uncommittedPaths(root), contract.scope.paths).allowed;
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
  const manifest = assertFreshEvidence(await loadEvidence(root, state.lastRunId), {
    contractHash: lock.contractHash,
    gitSha,
  });
  invariant(manifest.summary.requiredFailed === 0, 'ERR_ACCEPTANCE_FAILED', 'Required acceptance criteria still fail');
  const issues = await loadIssues(root);
  const counts = countIssues(issues.issues);
  invariant(counts.BLOCKER === 0, 'ERR_BLOCKERS_REMAIN', 'Release blockers remain', { counts });
  const uncommitted = uncommittedInScopePaths(root, contract);
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
  const receipt = {
    schema: 'shipping-harness/release-v1',
    project: contract.project,
    worker: contract.worker,
    release: contract.release,
    goal: contract.goal,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    closedGitSha: gitSha,
    evidenceRunId: state.lastRunId,
    acceptance: manifest.summary,
    issueCounts: counts,
    backlogCount: backlog.items.length,
    fixCycles: state.fixCycles,
    agentRuns: state.agentRuns,
    integrations,
    closedAt,
    ...(uncommitted.length > 0 ? { uncommittedPaths: uncommitted } : {}),
  };
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
  return {
    state,
    git,
    contract: contract ? { project: contract.project, release: contract.release, hash: lock.contractHash } : null,
    contractValid,
    contractError,
    issues: { counts: countIssues(reportedIssues), items: reportedIssues },
    integrity,
    scopeWarning: scopeWarningFor(root, contract, lock?.baselineSha ?? state.baselineSha ?? null),
    evidenceFresh: Boolean(state.currentEvidenceSha && state.currentEvidenceSha === git.sha && contractValid),
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
  return `# Release ${receipt.release}\n\n` +
    `- Project: ${receipt.project}\n` +
    `- Worker: ${receipt.worker}\n` +
    `- Closed: ${receipt.closedAt}\n` +
    `- Contract hash: \`${receipt.contractHash}\`\n` +
    `- Baseline Git SHA: \`${receipt.baselineSha}\`\n` +
    `- Closed source Git SHA: \`${receipt.closedGitSha}\`\n` +
    `- Evidence run: \`${receipt.evidenceRunId}\`\n` +
    `- Fix cycles: ${receipt.fixCycles}\n` +
    `- Agent runs: ${receipt.agentRuns}\n\n` +
    `## Goal\n\n${receipt.goal}\n\n` +
    `## Acceptance evidence\n\n| Criterion | Requirement | Result | Exit | Duration |\n|---|---|---|---:|---:|\n${resultRows}\n\n` +
    `## Findings\n\n| ID | Class | Basis | Title |\n|---|---|---|---|\n${issueRows}\n\n` +
    `## Migrated backlog\n\n${backlogRows}\n`;
}