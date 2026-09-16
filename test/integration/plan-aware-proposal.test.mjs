import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { approveScopeProposal, createScopeProposal, refineScopeProposal } from '../../src/core/proposals.mjs';
import { assertLockedContract, loadContract } from '../../src/core/contract.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { prepareNextRelease } from '../../src/core/release-transition.mjs';
import { PLAN_SCHEMA } from '../../src/core/shipping-plan.mjs';

const THREE_STAGE_PLAN = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: {
    title: 'Fixture program',
    outcome: 'Deliver the fixture product end to end so an operator can run it and recover from failure.',
  },
  sources: [{ path: 'README.md', note: 'planning source the host model read' }],
  stages: [
    {
      id: 'S-01',
      title: 'Deliver the core flow',
      outcome: 'Complete the core fixture flow so it runs end to end on the current revision.',
      dependsOn: [],
      acceptanceRefs: ['node-test'],
      scopeInclude: ['Core flow implementation and its acceptance evidence.'],
      scopeExclude: ['Optional polish and future extensibility work.'],
      size: 'MILESTONE',
    },
    {
      id: 'S-02',
      title: 'Operate and recover',
      outcome: 'Complete the install, health check, and rollback paths with reproducible evidence.',
      dependsOn: ['S-01'],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
    {
      id: 'S-03',
      title: 'Field harden',
      outcome: 'Complete the field hardening pass and remove every release blocker found in the pilot.',
      dependsOn: ['S-02'],
      acceptanceRefs: ['node-test'],
      size: 'PATCH',
    },
  ],
};

/** @param {Record<string, any>} [plan] */
function planFixture(plan = THREE_STAGE_PLAN) {
  return createFixtureRepo({ files: { 'docs/shipping-plan.json': `${JSON.stringify(plan, null, 2)}\n` } });
}

test('a plan file turns shipping_start into a PROGRAM projection plus an approvable MILESTONE', async () => {
  const fixture = await planFixture();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.tier, 'MILESTONE');
    const projection = proposal.shippingPlan;
    assert.equal(projection.path, 'docs/shipping-plan.json');
    assert.match(projection.planHash, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      [projection.progress.total, projection.progress.done, projection.progress.nextStageId],
      [3, 0, 'S-01'],
    );
    assert.equal(projection.program.authority, 'none');
    assert.equal(projection.program.proposalHash, undefined);
    assert.equal(projection.program.stages.length, 3);
    assert.deepEqual(projection.program.releaseTrain.releases.map((entry) => entry.stageId), ['S-01', 'S-02', 'S-03']);
    assert.equal(projection.program.releaseTrain.truncated, 0);
    assert.equal(projection.milestone.stageId, 'S-01');
    assert.equal(projection.patch, null);

    // The MILESTONE stage, not the user sentence, is what the contract would lock.
    assert.equal(proposal.contract.goal, THREE_STAGE_PLAN.stages[0].outcome);
    assert.deepEqual(proposal.contract.scope.include, THREE_STAGE_PLAN.stages[0].scopeInclude);
    assert.deepEqual(proposal.contract.acceptance.map((entry) => entry.command), ['npm test']);
    assert.deepEqual(proposal.contract.plan, {
      path: 'docs/shipping-plan.json',
      planHash: projection.planHash,
      stageId: 'S-01',
      tier: 'MILESTONE',
    });
    assert.ok(Buffer.byteLength(JSON.stringify(projection), 'utf8') < 16 * 1024);
  } finally {
    await fixture.cleanup();
  }
});

test('closing a plan-bound release advances progress and moves the milestone to the next stage', async () => {
  const fixture = await planFixture();
  try {
    const first = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    await approveScopeProposal(fixture.root, {
      proposalId: first.proposal.id,
      proposalHash: first.proposal.hash,
      confirm: true,
    });
    const { contract } = await assertLockedContract(fixture.root);
    assert.equal(contract.plan.stageId, 'S-01');

    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    const closed = await closeRelease(fixture.root);
    assert.equal(closed.state.state, 'CLOSED');
    assert.equal(closed.receipt.planStageId, 'S-01');
    assert.equal(closed.receipt.planHash, contract.plan.planHash);
    assert.equal(closed.receipt.tier, 'MILESTONE');

    const second = await createScopeProposal(fixture.root, { goal: 'Complete the next fixture release' });
    const projection = second.proposal.shippingPlan;
    assert.deepEqual([projection.progress.done, projection.progress.total, projection.progress.percent], [1, 3, 33]);
    assert.equal(projection.progress.nextStageId, 'S-02');
    assert.equal(projection.milestone.stageId, 'S-02');
    assert.equal(projection.program.stages[0].state, 'DONE');
    assert.deepEqual(projection.program.releaseTrain.releases.map((entry) => entry.stageId), ['S-02', 'S-03']);
    assert.equal(second.proposal.contract.plan.stageId, 'S-02');
  } finally {
    await fixture.cleanup();
  }
});

test('an explicit stageId selects that stage and a blocked stage is refused', async () => {
  const fixture = await planFixture();
  try {
    const selected = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release', stageId: 'S-01' });
    assert.equal(selected.proposal.shippingPlan.milestone.stageId, 'S-01');

    await assert.rejects(
      () => createScopeProposal(fixture.root, { goal: 'Complete the blocked stage', stageId: 'S-03' }),
      (error) => error.code === 'ERR_PLAN_STAGE_NOT_READY' && /S-02/u.test(error.message),
    );
    await assert.rejects(
      () => createScopeProposal(fixture.root, { goal: 'Complete an unknown stage', stageId: 'S-99' }),
      (error) => error.code === 'ERR_PLAN_STAGE_UNKNOWN',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('a PATCH-sized stage lowers the tier and the fix and agent budgets', async () => {
  const fixture = await planFixture({
    ...THREE_STAGE_PLAN,
    stages: [{ ...THREE_STAGE_PLAN.stages[0], size: 'PATCH' }],
  });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.tier, 'PATCH');
    assert.equal(proposal.contract.plan.tier, 'PATCH');
    assert.deepEqual(
      [proposal.contract.budgets.maxFixCycles, proposal.contract.budgets.maxAgentRuns],
      [1, 1],
    );
    assert.equal(proposal.shippingPlan.patch.stageId, 'S-01');
  } finally {
    await fixture.cleanup();
  }
});

test('an unresolved acceptance reference blocks the stage and is reported, not hidden', async () => {
  const fixture = await planFixture({
    ...THREE_STAGE_PLAN,
    stages: [{ ...THREE_STAGE_PLAN.stages[0], acceptanceRefs: ['make-release'] }],
  });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.tier, 'PATCH');
    assert.equal(proposal.contract.plan, undefined);
    assert.equal(proposal.shippingPlan.program.stages[0].state, 'BLOCKED_BY_UNRESOLVED');
    assert.ok(proposal.diagnostics.some((entry) => entry.startsWith('UNRESOLVED_ACCEPTANCE:') && entry.includes('make-release')));
    assert.ok(proposal.diagnostics.some((entry) => entry.startsWith('PLAN_NO_READY_STAGE:')));
  } finally {
    await fixture.cleanup();
  }
});

test('a completed plan reports PLAN_COMPLETE and keeps proposing only a patch', async () => {
  const fixture = await planFixture({ ...THREE_STAGE_PLAN, stages: [THREE_STAGE_PLAN.stages[0]] });
  try {
    const first = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    await approveScopeProposal(fixture.root, { proposalId: first.proposal.id, proposalHash: first.proposal.hash, confirm: true });
    await verifyRelease(fixture.root);
    await closeRelease(fixture.root);

    const second = await createScopeProposal(fixture.root, { goal: 'Complete a small follow-up fix' });
    assert.equal(second.proposal.tier, 'PATCH');
    assert.equal(second.proposal.shippingPlan.progress.percent, 100);
    assert.equal(second.proposal.shippingPlan.milestone, null);
    assert.ok(second.proposal.diagnostics.some((entry) => entry.startsWith('PLAN_COMPLETE:')));
  } finally {
    await fixture.cleanup();
  }
});

test('preparing the next release clears the plan binding from the new DRAFT contract', async () => {
  const fixture = await planFixture();
  try {
    const first = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    await approveScopeProposal(fixture.root, { proposalId: first.proposal.id, proposalHash: first.proposal.hash, confirm: true });
    await verifyRelease(fixture.root);
    await closeRelease(fixture.root);
    await fixture.commit('close the first plan stage');

    await prepareNextRelease(fixture.root, { release: '0.2.0', goal: 'Complete the next fixture release' });
    const next = await loadContract(fixture.paths.contract);
    assert.equal(next.plan, undefined);
    assert.equal(next.release, '0.2.0');
  } finally {
    await fixture.cleanup();
  }
});

test('refine can re-target the active proposal at another READY stage', async () => {
  const fixture = await planFixture({
    ...THREE_STAGE_PLAN,
    stages: [
      { ...THREE_STAGE_PLAN.stages[0] },
      { ...THREE_STAGE_PLAN.stages[1], dependsOn: [] },
    ],
  });
  try {
    const first = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(first.proposal.shippingPlan.milestone.stageId, 'S-01');
    const refined = await refineScopeProposal(fixture.root, {
      proposalId: first.proposal.id,
      proposalHash: first.proposal.hash,
      stageId: 'S-02',
    });
    assert.equal(refined.changed, true);
    assert.equal(refined.proposal.shippingPlan.milestone.stageId, 'S-02');
    assert.equal(refined.proposal.contract.plan.stageId, 'S-02');
    assert.equal(refined.proposal.contract.goal, THREE_STAGE_PLAN.stages[1].outcome);
  } finally {
    await fixture.cleanup();
  }
});
