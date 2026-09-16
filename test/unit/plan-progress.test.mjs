import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { loadContract } from '../../src/core/contract.mjs';
import { stableStringify } from '../../src/core/crypto.mjs';
import { writeJsonAtomic } from '../../src/core/fs.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { PLAN_SCHEMA, computePlanProgress, validateShippingPlan } from '../../src/core/shipping-plan.mjs';

const plan = validateShippingPlan({
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
  stages: [
    { id: 'S-01', title: 'First', outcome: 'First outcome.', size: 'MILESTONE' },
    { id: 'S-02', title: 'Second', outcome: 'Second outcome.', dependsOn: ['S-01'], size: 'MILESTONE' },
    { id: 'S-03', title: 'Third', outcome: 'Third outcome.', dependsOn: ['S-02'], size: 'PATCH' },
  ],
});

/** @param {string} root @param {string} release @param {Record<string, any>} fields */
async function writeReceipt(root, release, fields) {
  await writeJsonAtomic(path.join(runtimePaths(root).releases, `${release}.json`), {
    schema: 'shipping-harness/release-v1',
    release,
    closedAt: new Date().toISOString(),
    ...fields,
  });
}

/** @param {string} root @param {string | null} stageId */
async function bindContractStage(root, stageId) {
  const paths = runtimePaths(root);
  const contract = await loadContract(paths.contract);
  const next = { ...contract };
  if (stageId) next.plan = { path: 'docs/shipping-plan.json', planHash: 'a'.repeat(64), stageId, tier: 'MILESTONE' };
  else delete next.plan;
  await writeJsonAtomic(paths.contract, JSON.parse(stableStringify(next)));
}

test('with no receipts only the dependency-free stage is READY', async () => {
  const fixture = await createFixtureRepo();
  try {
    const progress = await computePlanProgress(fixture.root, plan);
    assert.deepEqual(progress.stages.map((entry) => entry.state), ['READY', 'BLOCKED_BY_DEPENDENCY', 'BLOCKED_BY_DEPENDENCY']);
    assert.equal(progress.nextStageId, 'S-01');
    assert.deepEqual([progress.total, progress.done, progress.ready, progress.percent], [3, 0, 1, 0]);
  } finally {
    await fixture.cleanup();
  }
});

test('a closed receipt carrying planStageId marks the stage DONE and unblocks its dependants', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeReceipt(fixture.root, '0.1.0', { planStageId: 'S-01', planHash: 'b'.repeat(64), tier: 'MILESTONE' });
    const progress = await computePlanProgress(fixture.root, plan);
    assert.deepEqual(progress.stages.map((entry) => entry.state), ['DONE', 'READY', 'BLOCKED_BY_DEPENDENCY']);
    assert.equal(progress.nextStageId, 'S-02');
    assert.deepEqual([progress.done, progress.percent], [1, 33]);
  } finally {
    await fixture.cleanup();
  }
});

test('the current contract stage is ACTIVE and never counted as done', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeReceipt(fixture.root, '0.1.0', { planStageId: 'S-01' });
    await bindContractStage(fixture.root, 'S-02');
    const progress = await computePlanProgress(fixture.root, plan);
    assert.deepEqual(progress.stages.map((entry) => entry.state), ['DONE', 'ACTIVE', 'BLOCKED_BY_DEPENDENCY']);
    assert.equal(progress.active, 1);
    assert.equal(progress.nextStageId, null);
  } finally {
    await fixture.cleanup();
  }
});

test('an unresolved acceptance reference blocks a stage that would otherwise be READY', async () => {
  const fixture = await createFixtureRepo();
  try {
    const progress = await computePlanProgress(fixture.root, plan, { unresolvedStageIds: ['S-01'] });
    assert.equal(progress.stages[0].state, 'BLOCKED_BY_UNRESOLVED');
    assert.equal(progress.nextStageId, null);
    assert.equal(progress.ready, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('receipts without a plan stage, and unparsable files, prove nothing about progress', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeReceipt(fixture.root, '0.1.0', {});
    await fixture.write('.shipping/releases/broken.json', '{not json');
    await writeJsonAtomic(path.join(runtimePaths(fixture.root).releases, 'other.json'), { schema: 'something/else', planStageId: 'S-01' });
    const progress = await computePlanProgress(fixture.root, plan);
    assert.equal(progress.done, 0);
    assert.equal(progress.nextStageId, 'S-01');
  } finally {
    await fixture.cleanup();
  }
});

test('every stage done reports 100 percent and no next stage', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeReceipt(fixture.root, '0.1.0', { planStageId: 'S-01' });
    await writeReceipt(fixture.root, '0.2.0', { planStageId: 'S-02' });
    await writeReceipt(fixture.root, '0.2.1', { planStageId: 'S-03' });
    const progress = await computePlanProgress(fixture.root, plan);
    assert.deepEqual([progress.done, progress.total, progress.percent, progress.nextStageId], [3, 3, 100, null]);
  } finally {
    await fixture.cleanup();
  }
});
