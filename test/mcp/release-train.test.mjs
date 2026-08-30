import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildReleaseTrain, loadApprovedReleaseTrain, releaseTrainSummary, validateReleaseTrain } from '../../src/core/release-train.mjs';
import { callShippingTool, SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function contract(release = '1.5.0') {
  return {
    project: 'release-train-fixture',
    release,
    goal: 'Deliver one useful internal workflow with verification and rollback.',
    scope: {
      include: ['Deliver the core workflow.', 'Keep required evidence current.'],
      exclude: ['Production deployment.', 'Unrequested features.'],
    },
    acceptance: [
      {
        id: 'AC-001',
        description: 'Repository tests pass.',
        type: 'command',
        command: 'npm test',
        cwd: '.',
        required: true,
        timeoutSeconds: 300,
      },
    ],
  };
}

function analysis(overrides = {}) {
  return {
    projectName: 'release-train-fixture',
    types: ['node'],
    sourceRoots: ['src'],
    manifests: ['package.json'],
    workspace: { root: '.', id: 'WS-000000000001' },
    candidateCommands: [{ id: 'npm-test', command: 'npm test', cwd: '.', description: 'Run tests.' }],
    intelligence: {
      componentGraph: {
        primaryStack: 'node',
        supportingStacks: ['playwright'],
        components: [{ root: '.', role: 'web-and-e2e', stacks: ['node', 'playwright'] }],
      },
    },
    ...overrides,
  };
}

function trainInput(overrides = {}) {
  const currentContract = contract();
  return {
    finalGoal: currentContract.goal,
    proposalRelease: currentContract.release,
    gitSha: 'a'.repeat(40),
    proposalId: 'proposal-release-train',
    projectName: currentContract.project,
    analysis: analysis(),
    baseline: { blockingCount: 0, plan: { hash: 'b'.repeat(64) } },
    acceptanceStrength: { level: 'STRONG', sufficient: true },
    contract: currentContract,
    ...overrides,
  };
}

test('release train compiles the current release, next minor, and field-hardening patch deterministically', () => {
  const first = buildReleaseTrain(trainInput());
  const second = buildReleaseTrain({
    ...trainInput(),
    analysis: {
      intelligence: analysis().intelligence,
      candidateCommands: analysis().candidateCommands,
      workspace: analysis().workspace,
      manifests: analysis().manifests,
      sourceRoots: analysis().sourceRoots,
      types: analysis().types,
      projectName: analysis().projectName,
      hostModelLabel: 'weak-host-that-must-not-be-authority',
    },
  });
  assert.deepEqual(first.releases.map((entry) => entry.version), ['1.5.0', '1.6.0', '1.6.1']);
  assert.deepEqual(first.releases.map((entry) => entry.stage), ['DELIVER_CORE_VALUE', 'OPERATE_AND_RECOVER', 'FIELD_HARDEN']);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first, second);
  assert.equal(first.modelAuthority, false);
  assert.equal(first.releases[0].detailLevel, 'CURRENT_FULL');
  assert.equal(first.releases[1].detailLevel, 'NEXT_BOUNDED');
  assert.equal(first.releases[2].detailLevel, 'FUTURE_GATES');
  assert.deepEqual(first.releases[0].acceptance.exactCommands, contract().acceptance.map((entry) => ({
    ...entry,
    sideEffect: 'none-or-test-output',
    isolationRequired: false,
    deterministicOutputRequired: false,
    automaticallyRunnable: true,
  })));
  for (const future of first.releases.slice(1)) {
    assert.equal(future.authority, 'ADVISORY_REPLAN_REQUIRED');
    assert.equal(future.canGrantCurrentAuthority, false);
    assert.equal(future.acceptance.exactCommands.length, 0);
    assert.equal(future.acceptance.futureCommandsAreAuthority, false);
  }
  validateReleaseTrain(first, { currentContract: contract() });
});

test('dirty or weak evidence adds a stabilization release without weakening future authority', () => {
  const currentContract = contract('2.3.4');
  const train = buildReleaseTrain(trainInput({
    proposalRelease: '2.3.4',
    contract: currentContract,
    finalGoal: currentContract.goal,
    baseline: { blockingCount: 3, plan: { hash: 'c'.repeat(64) } },
    acceptanceStrength: { level: 'WEAK', sufficient: false },
  }));
  assert.deepEqual(train.releases.map((entry) => entry.version), ['2.3.4', '2.4.0', '2.5.0', '2.5.1']);
  assert.equal(train.releases[0].stage, 'STABILIZE_BASELINE');
  assert.equal(train.releases[0].valueGate.testsAloneSufficient, false);
  assert.ok(train.releases.every((entry) => entry.valueGate.criteria.length > 0));
  assert.ok(train.releases.every((entry) => entry.entryGate.length > 0 && entry.exitGate.length > 0));
  assert.ok(train.releases.every((entry) => entry.rollback.required && entry.replanTriggers.length > 0));
});

test('documentation-only work can use one complete value-bearing release', () => {
  const currentContract = contract('0.4.0');
  const train = buildReleaseTrain(trainInput({
    proposalRelease: '0.4.0',
    contract: currentContract,
    finalGoal: currentContract.goal,
    analysis: analysis({ types: [], sourceRoots: ['docs'], manifests: [], candidateCommands: [] }),
    acceptanceStrength: { level: 'DOCUMENTATION', sufficient: true },
  }));
  assert.equal(train.releases.length, 1);
  assert.equal(train.releases[0].version, '0.4.0');
  assert.deepEqual(train.source.projectProfiles, ['documentation']);
  assert.match(train.releases[0].valueGate.statement, /핵심 사용 흐름|Deliver/u);
});

test('shipping_start, status, approval, and persistence expose one exact release train through nine tools', async () => {
  const fixture = await createFixtureRepo({ packageScripts: { build: `node -e "process.exit(0)"` } });
  try {
    assert.equal(SHIPPING_TOOLS.length, 9);
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Deliver the smallest useful internal workflow, then make it operable and field-proven.',
      release: '0.2.0',
      proposerId: 'planner-agent',
    });
    const proposal = started.structuredContent;
    assert.equal(proposal.releaseTrain.currentRelease, '0.2.0');
    assert.equal(proposal.releaseTrain.releases[0].goal, proposal.goal);
    assert.equal(proposal.releaseTrain.releases[0].acceptance.exactCommands.length, proposal.acceptance.length);
    assert.equal(proposal.releaseTrainSummary.totalReleases, 3);
    assert.match(proposal.plainBriefText, /## 전체 개발계획/u);
    assert.match(proposal.plainBriefText, /v0\.2\.0/u);
    assert.equal(proposal.plainBrief.quality.healthy, true);

    const pending = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(pending.structuredContent.pendingProposal.releaseTrain.hash, proposal.releaseTrain.hash);
    assert.equal(pending.structuredContent.userView.releaseTrainSummary.hash, proposal.releaseTrain.hash);
    assert.equal(pending.structuredContent.userView.plainBriefText, proposal.plainBriefText);

    const approved = await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      confirm: true,
    });
    assert.equal(approved.structuredContent.state, 'LOCKED');
    assert.equal(approved.structuredContent.releaseTrainHash, proposal.releaseTrain.hash);
    assert.equal(approved.structuredContent.releaseTrainCount, 3);

    const stored = await loadApprovedReleaseTrain(fixture.root);
    assert.equal(stored.train.hash, proposal.releaseTrain.hash);
    assert.equal(stored.binding.proposalId, proposal.proposalId);
    assert.equal(stored.binding.proposalHash, proposal.proposalHash);
    assert.match(stored.binding.contractHash, /^[a-f0-9]{64}$/u);
    assert.match(stored.binding.baselineSha, /^[a-f0-9]{40}$/u);

    const active = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(active.structuredContent.releaseTrain.hash, proposal.releaseTrain.hash);
    assert.equal(active.structuredContent.releaseTrainBinding.proposalId, proposal.proposalId);
    assert.equal(active.structuredContent.userView.releaseTrainSummary.totalReleases, 3);
    const raw = JSON.parse(await readFile(fixture.paths.releaseTrain, 'utf8'));
    assert.equal(raw.hash, stored.hash);
  } finally {
    await fixture.cleanup();
  }
});

test('release train summary is bounded and carries no model authority', () => {
  const train = buildReleaseTrain(trainInput());
  const summary = releaseTrainSummary(train);
  assert.equal(summary.totalReleases, 3);
  assert.equal(summary.modelAuthority, false);
  assert.equal(summary.releases.filter((entry) => entry.current).length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 4096);
});
