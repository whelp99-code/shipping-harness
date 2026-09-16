// v1.12.1 Phase A: a plan stage that already carries evidence is immutable. Evidence is
// a CLOSED release receipt (the stage is DONE) or the current contract lock (the stage is
// ACTIVE). These tests write the evidence directly so each violation kind is isolated
// from the proposal, lock, and close flows that produce it in practice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import {
  DEFAULT_PLAN_PATH,
  PLAN_SCHEMA,
  assertPlanHistory,
  auditPlanHistory,
  computePlanProgress,
  loadShippingPlan,
  planHash,
  planStageSnapshot,
} from '../../src/core/shipping-plan.mjs';

/** @param {Array<Record<string, any>>} [stages] */
function plan(stages) {
  return {
    schema: PLAN_SCHEMA,
    project: 'fixture',
    program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
    stages: stages ?? [
      {
        id: 'S-01',
        title: 'Deliver the core flow',
        outcome: 'Complete the core fixture flow so it runs end to end.',
        dependsOn: [],
        acceptanceRefs: ['node-test'],
        scopeInclude: ['Core flow implementation.'],
        scopeExclude: ['Polish.'],
        size: 'MILESTONE',
      },
      {
        id: 'S-02',
        title: 'Operate and recover',
        outcome: 'Complete the install, health check, and rollback paths.',
        dependsOn: ['S-01'],
        acceptanceRefs: ['node-test'],
        scopeInclude: ['Operational paths.'],
        scopeExclude: [],
        size: 'MILESTONE',
      },
    ],
  };
}

/** Normalize through the validator so snapshots match what the harness would have written. */
async function planFixture(document = plan()) {
  const fixture = await createFixtureRepo({ files: { [DEFAULT_PLAN_PATH]: `${JSON.stringify(document, null, 2)}\n` } });
  const loaded = await loadShippingPlan(fixture.root);
  return { fixture, loaded };
}

/** @param {{root: string}} fixture @param {Record<string, any>} plan @param {string} stageId @param {string} [release] */
async function writeClosedReceipt(fixture, planDocument, stageId, release = '0.1.0') {
  const stage = planDocument.stages.find((entry) => entry.id === stageId);
  const receipt = {
    schema: 'shipping-harness/release-v1',
    project: 'fixture',
    release,
    state: 'CLOSED',
    closedAt: '2026-09-16T00:00:00.000Z',
    planStageId: stageId,
    planHash: planHash(planDocument),
    tier: 'MILESTONE',
    planStage: planStageSnapshot(stage),
  };
  const target = path.join(fixture.root, '.shipping', 'releases', `${release}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

/** @param {{root: string}} fixture @param {Record<string, any>} plan @param {string} stageId */
async function writeLockSnapshot(fixture, planDocument, stageId) {
  const stage = planDocument.stages.find((entry) => entry.id === stageId);
  const lock = {
    schema: 'shipping-harness/lock-v1',
    contractHash: 'a'.repeat(64),
    baselineSha: 'b'.repeat(40),
    release: '0.1.0',
    scopeRevision: 1,
    lockedAt: '2026-09-16T00:00:00.000Z',
    planStage: planStageSnapshot(stage),
  };
  await writeFile(path.join(fixture.root, '.shipping', 'contract.lock'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}

/** @param {{root: string}} fixture @param {Record<string, any>} document */
async function rewritePlan(fixture, document) {
  await writeFile(path.join(fixture.root, DEFAULT_PLAN_PATH), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return loadShippingPlan(fixture.root);
}

test('a stage with no evidence stays fully editable and a new stage is always allowed', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    const edited = plan();
    edited.stages[1].title = 'Operate, recover, and observe';
    edited.stages[1].outcome = 'Complete install, health check, rollback, and metrics.';
    edited.stages[1].dependsOn = [];
    edited.stages.push({
      id: 'S-04',
      title: 'Field harden',
      outcome: 'Complete the field hardening pass.',
      dependsOn: ['S-02'],
      acceptanceRefs: ['node-test'],
      size: 'PATCH',
    });
    const reloaded = await rewritePlan(fixture, edited);
    const audit = await auditPlanHistory(fixture.root, reloaded.plan);
    assert.deepEqual([audit.ok, audit.violations, audit.protectedStageIds], [true, [], ['S-01']]);
  } finally {
    await fixture.cleanup();
  }
});

test('deleting or renaming the id of a DONE stage is MISSING', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    const rewritten = plan();
    rewritten.stages[0].id = 'S-ONE';
    rewritten.stages[1].dependsOn = ['S-ONE'];
    const reloaded = await rewritePlan(fixture, rewritten);
    const audit = await auditPlanHistory(fixture.root, reloaded.plan);
    assert.equal(audit.ok, false);
    assert.equal(audit.violations.length, 1);
    assert.deepEqual(
      [audit.violations[0].stageId, audit.violations[0].kind, audit.violations[0].evidence],
      ['S-01', 'MISSING', '.shipping/releases/0.1.0.json'],
    );
    await assert.rejects(
      () => assertPlanHistory(fixture.root, reloaded.plan),
      (error) => error.code === 'ERR_PLAN_HISTORY_LOST' && error.details.violations.length === 1,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('editing any snapshotted field of a DONE stage is CHANGED and cites the receipt', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    const rewritten = plan();
    rewritten.stages[0].title = 'Deliver the core flow, renamed';
    rewritten.stages[0].size = 'PATCH';
    const reloaded = await rewritePlan(fixture, rewritten);
    const audit = await auditPlanHistory(fixture.root, reloaded.plan);
    assert.deepEqual(audit.violations.map((entry) => `${entry.kind} ${entry.field}`), ['CHANGED title', 'CHANGED size']);
    assert.equal(audit.violations[0].expected, 'Deliver the core flow');
    assert.equal(audit.violations[0].observed, 'Deliver the core flow, renamed');
    assert.equal(audit.violations[0].evidence, '.shipping/releases/0.1.0.json');
    await assert.rejects(
      () => assertPlanHistory(fixture.root, reloaded.plan),
      (error) => error.message === 'Plan file rewrites stages that already carry evidence: S-01 CHANGED title (.shipping/releases/0.1.0.json); S-01 CHANGED size (.shipping/releases/0.1.0.json)',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('adding a new dependency to a DONE stage is DEPENDS_ON_REWRITTEN', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    const rewritten = plan();
    rewritten.stages.push({
      id: 'S-00',
      title: 'Invent a prerequisite',
      outcome: 'Complete a prerequisite the finished stage never had.',
      dependsOn: [],
      acceptanceRefs: ['node-test'],
      size: 'PATCH',
    });
    rewritten.stages[0].dependsOn = ['S-00'];
    const reloaded = await rewritePlan(fixture, rewritten);
    const audit = await auditPlanHistory(fixture.root, reloaded.plan);
    assert.equal(audit.ok, false);
    assert.deepEqual(
      [audit.violations[0].kind, audit.violations[0].field, audit.violations[0].expected, audit.violations[0].observed],
      ['DEPENDS_ON_REWRITTEN', 'dependsOn', [], ['S-00']],
    );
  } finally {
    await fixture.cleanup();
  }
});

test('the current lock protects the ACTIVE stage, and a CLOSED state hands that role to the receipt', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeLockSnapshot(fixture, loaded.plan, 'S-02');
    const rewritten = plan();
    rewritten.stages[1].outcome = 'Complete something else entirely while the stage is running.';
    const reloaded = await rewritePlan(fixture, rewritten);
    const audit = await auditPlanHistory(fixture.root, reloaded.plan);
    assert.deepEqual(
      [audit.ok, audit.violations[0].stageId, audit.violations[0].kind, audit.violations[0].evidence, audit.protectedStageIds],
      [false, 'S-02', 'CHANGED', '.shipping/contract.lock', ['S-02']],
    );

    // Once the release is CLOSED the stale lock is no longer evidence: the receipt is.
    const statePath = path.join(fixture.root, '.shipping', 'state.json');
    const state = JSON.parse(await fixture.read('.shipping/state.json'));
    await writeFile(statePath, `${JSON.stringify({ ...state, state: 'CLOSED' }, null, 2)}\n`, 'utf8');
    assert.equal((await auditPlanHistory(fixture.root, reloaded.plan)).ok, true);
  } finally {
    await fixture.cleanup();
  }
});

test('a v1.12.0 receipt without a stage snapshot still pins the stage id', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    const receipt = await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    delete receipt.planStage;
    await writeFile(path.join(fixture.root, '.shipping', 'releases', '0.1.0.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    const renamed = plan();
    renamed.stages[0].title = 'Renamed with no snapshot to contradict';
    assert.equal((await auditPlanHistory(fixture.root, (await rewritePlan(fixture, renamed)).plan)).ok, true);

    const dropped = plan([renamed.stages[1]]);
    dropped.stages[0].dependsOn = [];
    const audit = await auditPlanHistory(fixture.root, (await rewritePlan(fixture, dropped)).plan);
    assert.deepEqual([audit.ok, audit.violations[0].kind], [false, 'MISSING']);
  } finally {
    await fixture.cleanup();
  }
});

test('program.supersedes skips the audit, restarts progress at zero, and reports what it abandons', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    const replacement = plan([
      {
        id: 'S-A',
        title: 'Restart the program',
        outcome: 'Complete the first stage of a deliberately new plan.',
        dependsOn: [],
        acceptanceRefs: ['node-test'],
        size: 'MILESTONE',
      },
    ]);
    replacement.program.supersedes = loaded.planHash;
    const reloaded = await rewritePlan(fixture, replacement);
    // v1.12.1 Phase B: this fixture plan carries no `revision`, so it also reads as legacy.
    assert.deepEqual(reloaded.diagnostics, [
      `PLAN_SUPERSEDED: 1 completed stages from plan ${loaded.planHash.slice(0, 8)} are not inherited`,
      'PLAN_LEGACY_FORMAT: plan carries no revision; set revision on the next update',
    ]);
    assert.equal(reloaded.progressPlanHash, reloaded.planHash);

    // The audit is skipped even though S-01 vanished, and progress restarts from zero.
    const audited = await loadShippingPlan(fixture.root, DEFAULT_PLAN_PATH, { auditHistory: true });
    assert.equal(audited.planHash, reloaded.planHash);
    const progress = await computePlanProgress(fixture.root, reloaded.plan, { planHash: reloaded.progressPlanHash });
    assert.deepEqual([progress.done, progress.total, progress.nextStageId], [0, 1, 'S-A']);
  } finally {
    await fixture.cleanup();
  }
});

test('program.supersedes that matches no closed receipt is refused', async () => {
  const { fixture, loaded } = await planFixture();
  try {
    await writeClosedReceipt(fixture, loaded.plan, 'S-01');
    const replacement = plan();
    replacement.program.supersedes = 'f'.repeat(64);
    await writeFile(path.join(fixture.root, DEFAULT_PLAN_PATH), `${JSON.stringify(replacement, null, 2)}\n`, 'utf8');
    await assert.rejects(
      () => loadShippingPlan(fixture.root),
      (error) => error.code === 'ERR_PLAN_SUPERSEDES_UNKNOWN',
    );

    // With no receipts at all it is still unknown: a claim needs evidence to supersede.
    await rm(path.join(fixture.root, '.shipping', 'releases'), { recursive: true, force: true });
    await assert.rejects(
      () => loadShippingPlan(fixture.root),
      (error) => error.code === 'ERR_PLAN_SUPERSEDES_UNKNOWN',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('the plan path is fixed: every other address is refused before it is read', async () => {
  const { fixture } = await planFixture();
  try {
    for (const other of ['docs/other-plan.json', 'plans/shipping-plan.json', './docs/shipping-plan.json']) {
      await assert.rejects(
        () => loadShippingPlan(fixture.root, other),
        (error) => error.code === 'ERR_PLAN_PATH_FIXED',
        `path ${other} was accepted`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});
