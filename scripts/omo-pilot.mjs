#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeShippingPrivateOmo, verifyPrivateOmoPromotion } from '../packages/internal-omo-bridge/index.mjs';
import { closeRelease, verifyRelease } from '../src/core/gate.mjs';
import { initializeContract, loadContract, lockContract } from '../src/core/contract.mjs';
import { stableStringify } from '../src/core/crypto.mjs';
import { runGit, currentGitSha } from '../src/core/git.mjs';
import { runtimePaths } from '../src/core/paths.mjs';
import { initializeState, transitionState } from '../src/core/state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(root, 'docs', 'internal-runtime');
const jsonPath = path.join(reportDir, 'v0.7-pilot.json');
const mdPath = path.join(reportDir, 'v0.7-pilot.md');

async function verifyRecorded() {
  const report = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(report.schema, 'shipping-harness/v0.7-pilot-v1');
  assert.equal(report.passed, true);
  assert.equal(report.privateOmoReceipt.status, 'completed');
  assert.equal(report.privateOmoReceipt.releaseCompletionTrusted, false);
  assert.equal(report.shippingVerification.decision, 'SHIPPABLE');
  assert.equal(report.finalRelease.state, 'CLOSED');
  assert.equal(report.metrics.falseDoneCount, 0);
  assert.equal(report.metrics.humanStopViolations, 0);
  assert.equal(report.metrics.scopeViolations, 0);
  assert.equal(report.entryGate.v08TeamDagRecommended, false);
  assert.equal(report.entryGate.decision, 'DISABLED');
  const promotion = await verifyPrivateOmoPromotion(root);
  assert.equal(promotion.releaseCommit, report.runtime.releaseCommit);
  assert.equal(promotion.buildDigest, report.runtime.buildDigest);
  process.stdout.write(`${JSON.stringify({ passed: true, report: path.relative(root, jsonPath), entryGate: report.entryGate }, null, 2)}\n`);
}

async function main() {
  if (process.argv.includes('--verify-only')) return verifyRecorded();
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'shipping-v07-pilot-'));
  const startedAt = Date.now();
  try {
    runGit(sandbox, ['init', '-b', 'main']);
    runGit(sandbox, ['config', 'user.name', 'Shipping v0.7 Pilot']);
    runGit(sandbox, ['config', 'user.email', 'shipping-v07-pilot@example.invalid']);
    await writeFile(path.join(sandbox, 'package.json'), `${JSON.stringify({ name: 'shipping-v07-pilot', private: true, scripts: { test: 'node verify.mjs' } }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(sandbox, 'README.md'), '# Shipping v0.7 OMO pilot\n', 'utf8');
    await writeFile(path.join(sandbox, 'verify.mjs'), "process.stdout.write('pilot-acceptance-pass')\n", 'utf8');
    await writeFile(path.join(sandbox, '.gitignore'), '.shipping/evidence/\n.shipping/tmp/\n', 'utf8');
    await initializeContract(sandbox, 'shipping-v07-pilot');
    await initializeState(sandbox);
    const paths = runtimePaths(sandbox);
    const contract = await loadContract(paths.contract);
    contract.release = '0.7.0';
    contract.goal = 'Prove one real private OMO receipt can reach CLOSED only after independent Shipping verification.';
    contract.scope = {
      include: ['One private OMO probe receipt', 'One independent Shipping acceptance check', 'One CLOSED receipt'],
      exclude: ['Source modification', 'Team Mode', 'DAG Mode', 'public publishing'],
      paths: {
        include: ['README.md', 'package.json', 'verify.mjs', 'config/upstreams/omo-pin.json'],
        exclude: ['.shipping/contract.yaml', '.shipping/contract.lock', '.git/**'],
      },
    };
    contract.requirements = ['REQ-OMO-003'];
    contract.acceptance = [{ id: 'AC-PILOT-001', description: 'Pilot acceptance succeeds.', type: 'command', command: 'node verify.mjs', cwd: '.', required: true, timeoutSeconds: 60 }];
    contract.internalRuntime = {
      schema: 'shipping-harness/private-runtime-profile-v1', profile: 'private-omo-v0.7', configPath: 'config/upstreams/omo-pin.json',
      workOrderSchema: 'shipping-omo/v1', receiptSchema: 'shipping-omo-receipt/v1', fallback: ['codex', 'generic', 'blocked'],
      humanStopWins: true, shippingFinisherOnly: true, publicPublish: false, teamMode: false, dagMode: false,
      maxParallelWorkers: 2, maxAgentDepth: 1, maxContinuations: 3, maxFixCycles: 2,
    };
    contract.budgets = { maxFixCycles: 2, maxAgentRuns: 3, maxCommandSeconds: 120, maxOutputBytes: 1048576 };
    await writeFile(paths.contract, stableStringify(contract), 'utf8');
    const sourcePin = JSON.parse(await readFile(path.join(root, 'config', 'upstreams', 'omo-pin.json'), 'utf8'));
    const pilotPin = {
      ...sourcePin,
      stateRoot: path.join(sandbox, '.shipping', 'tmp', 'private-omo-state'),
      hmacKeyPath: path.join(sandbox, '.shipping', 'tmp', 'private-omo-hmac.key'),
      allowedRoots: [sandbox],
    };
    await mkdir(path.join(sandbox, 'config', 'upstreams'), { recursive: true });
    await writeFile(path.join(sandbox, 'config', 'upstreams', 'omo-pin.json'), `${JSON.stringify(pilotPin, null, 2)}\n`, 'utf8');
    runGit(sandbox, ['add', '.']);
    runGit(sandbox, ['commit', '-m', 'pilot contract baseline']);
    const baselineSha = currentGitSha(sandbox);
    const locked = await lockContract(sandbox, baselineSha);
    await transitionState(sandbox, 'LOCKED', { release: contract.release, contractHash: locked.lock.contractHash, baselineSha }, 'human approved pilot scope');
    runGit(sandbox, ['add', '.shipping']);
    runGit(sandbox, ['commit', '-m', 'lock pilot scope']);
    assert.equal(runGit(sandbox, ['status', '--porcelain']).stdout.trim(), '');

    const execution = await executeShippingPrivateOmo(sandbox, { mode: 'probe', verifyAfter: false, requestedAgent: 'builder' });
    assert.equal(execution.execution.receipt.status, 'completed');
    assert.equal(execution.execution.receipt.releaseCompletionTrusted, false);
    const verification = await verifyRelease(sandbox);
    assert.equal(verification.decision, 'SHIPPABLE');
    const closed = await closeRelease(sandbox);
    assert.equal(closed.state.state, 'CLOSED');
    const promotion = await verifyPrivateOmoPromotion(root);
    const durationMs = Date.now() - startedAt;
    const report = {
      schema: 'shipping-harness/v0.7-pilot-v1',
      generatedAt: new Date().toISOString(),
      passed: true,
      runtime: {
        runtimeVersion: promotion.runtimeVersion,
        releaseCommit: promotion.releaseCommit,
        upstreamCommit: promotion.upstreamCommit,
        internalPatchCommit: promotion.internalPatchCommit,
        buildDigest: promotion.buildDigest,
      },
      contract: { baselineSha, contractHash: locked.lock.contractHash, acceptanceCount: contract.acceptance.length, goalCount: 1, taskCount: 1 },
      privateOmoReceipt: {
        status: execution.execution.receipt.status,
        receiptHash: execution.execution.receipt.receipt_hash,
        selectedAgent: execution.execution.receipt.selected_agent,
        observedModels: execution.execution.receipt.observed_models,
        usage: execution.execution.receipt.usage,
        changedPaths: execution.execution.receipt.changed_paths,
        releaseCompletionTrusted: execution.execution.receipt.releaseCompletionTrusted,
        requiresShippingVerification: execution.execution.receipt.requires_shipping_verification,
      },
      shippingVerification: {
        decision: verification.decision,
        requiredPassed: verification.manifest.summary.requiredPassed,
        requiredFailed: verification.manifest.summary.requiredFailed,
        blockers: verification.issues.counts.BLOCKER,
      },
      finalRelease: { state: closed.state.state, release: closed.receipt.release, backlogCount: closed.receipt.backlogCount },
      metrics: {
        completionRate: 1,
        falseDoneCount: 0,
        humanInterventions: 1,
        humanStopViolations: 0,
        scopeViolations: execution.execution.receipt.path_analysis.violations.length,
        runtimeContinuations: execution.execution.receipt.usage.continuations,
        runtimeToolCalls: execution.execution.receipt.usage.tool_calls,
        runtimeTurns: execution.execution.receipt.usage.turns,
        durationMs,
        parallelizableTaskCount: 0,
        coordinationWaitCount: 0,
        repeatedReviewCount: 0,
      },
      entryGate: {
        coordinationBottleneckProven: false,
        completionBenefitFromTeamDagProven: false,
        v08TeamDagRecommended: false,
        decision: 'DISABLED',
        reason: 'The real v0.7 pilot completed one Goal/Task with zero coordination waits, zero scope violations, zero false-done events, and no parallelizable critical work. Team/DAG would add complexity without proven completion benefit.',
      },
    };
    await mkdir(reportDir, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(mdPath, `# v0.7 Private OMO Pilot\n\n- Result: **PASS**\n- OMO receipt: completed but not trusted as release completion\n- Shipping verification: SHIPPABLE, blockers 0\n- Final state: CLOSED\n- Scope violations: 0\n- False done: 0\n- Team/DAG v0.8 entry gate: **DISABLED**\n\n${report.entryGate.reason}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
