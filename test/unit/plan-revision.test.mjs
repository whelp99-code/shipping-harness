// v1.12.1 Phase B: `.shipping/plan-history.jsonl` records every distinct plan hash the
// harness has seen, chain-verified the same way `.shipping/ledger.jsonl` is. `revision`
// is optional but, once present, must never go backwards or be reused against a
// different plan hash; a plan with no revision records `revision: null` and is warned
// elsewhere (PLAN_LEGACY_FORMAT), never blocked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { diffPlanStages, planHistorySummary, readPlanHistory, recordPlanHistory } from '../../src/core/plan-history.mjs';
import { PLAN_SCHEMA, planHash } from '../../src/core/shipping-plan.mjs';

/** @param {Array<Record<string, any>>} [stages] @param {number} [revision] */
function plan(stages, revision) {
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
        size: 'MILESTONE',
      },
    ],
    ...(revision === undefined ? {} : { revision }),
  };
}

test('a plan with no revision records revision: null and is otherwise unconstrained', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const first = plan();
    const recorded = await recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) });
    assert.equal(recorded.recorded, true);
    assert.equal(recorded.entry.revision, null);
    assert.equal(recorded.entry.previousPlanHash, null);

    // A second legacy plan (still no revision) with a different hash is accepted too.
    const second = plan([{ ...first.stages[0], title: 'Deliver the core flow, renamed' }]);
    const recordedAgain = await recordPlanHistory(fixture.root, { plan: second, planHash: planHash(second) });
    assert.equal(recordedAgain.recorded, true);
    assert.equal(recordedAgain.entry.revision, null);
    assert.equal(recordedAgain.entry.previousPlanHash, recorded.entry.planHash);
  } finally {
    await fixture.cleanup();
  }
});

test('the same plan hash seen again is a no-op', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const document = plan(undefined, 1);
    const hash = planHash(document);
    const first = await recordPlanHistory(fixture.root, { plan: document, planHash: hash });
    assert.equal(first.recorded, true);
    const second = await recordPlanHistory(fixture.root, { plan: document, planHash: hash });
    assert.equal(second.recorded, false);
    assert.equal(second.entry.id, first.entry.id);
    assert.equal((await readPlanHistory(fixture.root)).length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('a revision smaller than the last recorded one is ERR_PLAN_REVISION_REGRESSED', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const first = plan(undefined, 3);
    await recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) });
    const regressed = plan([{ ...first.stages[0], title: 'A materially different plan' }], 2);
    await assert.rejects(
      () => recordPlanHistory(fixture.root, { plan: regressed, planHash: planHash(regressed) }),
      (error) => error.code === 'ERR_PLAN_REVISION_REGRESSED' && error.details.revision === 2 && error.details.lastRevision === 3,
    );
    // The rejected attempt left no entry behind.
    assert.equal((await readPlanHistory(fixture.root)).length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('the same revision naming a different plan hash is ERR_PLAN_REVISION_REUSED', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const first = plan(undefined, 1);
    await recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) });
    const reused = plan([{ ...first.stages[0], title: 'A different plan under the same revision number' }], 1);
    await assert.rejects(
      () => recordPlanHistory(fixture.root, { plan: reused, planHash: planHash(reused) }),
      (error) => error.code === 'ERR_PLAN_REVISION_REUSED' && error.details.revision === 1,
    );
    assert.equal((await readPlanHistory(fixture.root)).length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('an equal or increasing revision against a new plan hash is accepted', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const first = plan(undefined, 1);
    await recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) });
    const bumped = plan([{ ...first.stages[0], title: 'Deliver the core flow, updated' }], 2);
    const recorded = await recordPlanHistory(fixture.root, { plan: bumped, planHash: planHash(bumped) });
    assert.equal(recorded.recorded, true);
    assert.equal(recorded.entry.revision, 2);
    const summary = await planHistorySummary(fixture.root);
    assert.deepEqual(summary, { entries: 2, lastRevision: 2, lastPlanHash: planHash(bumped) });
  } finally {
    await fixture.cleanup();
  }
});

test('changedStages diffs added, modified, and removed stage IDs against the previous entry', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const first = plan([
      { id: 'S-01', title: 'First', outcome: 'Complete the first stage.', dependsOn: [], acceptanceRefs: ['node-test'], size: 'MILESTONE' },
      { id: 'S-02', title: 'Second', outcome: 'Complete the second stage.', dependsOn: ['S-01'], acceptanceRefs: ['node-test'], size: 'MILESTONE' },
    ], 1);
    await recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) });

    const second = plan([
      { id: 'S-01', title: 'First', outcome: 'Complete the first stage.', dependsOn: [], acceptanceRefs: ['node-test'], size: 'MILESTONE' },
      { id: 'S-02', title: 'Second, renamed', outcome: 'Complete the second stage differently.', dependsOn: ['S-01'], acceptanceRefs: ['node-test'], size: 'MILESTONE' },
      { id: 'S-03', title: 'Third', outcome: 'Complete the third stage.', dependsOn: ['S-02'], acceptanceRefs: ['node-test'], size: 'PATCH' },
    ], 2);
    const recorded = await recordPlanHistory(fixture.root, { plan: second, planHash: planHash(second) });
    assert.deepEqual(recorded.entry.changedStages, { added: ['S-03'], modified: ['S-02'], removed: [] });

    const third = plan([
      { id: 'S-01', title: 'First', outcome: 'Complete the first stage.', dependsOn: [], acceptanceRefs: ['node-test'], size: 'MILESTONE' },
    ], 3);
    const droppedRecorded = await recordPlanHistory(fixture.root, { plan: third, planHash: planHash(third) });
    assert.deepEqual(droppedRecorded.entry.changedStages, { added: [], modified: [], removed: ['S-02', 'S-03'] });
  } finally {
    await fixture.cleanup();
  }
});

test('diffPlanStages is a pure function of two stage-snapshot lists', () => {
  const previous = [{ id: 'S-01', snapshot: { title: 'A' } }, { id: 'S-02', snapshot: { title: 'B' } }];
  const current = [{ id: 'S-01', snapshot: { title: 'A changed' } }, { id: 'S-03', snapshot: { title: 'C' } }];
  assert.deepEqual(diffPlanStages(previous, current), { added: ['S-03'], modified: ['S-01'], removed: ['S-02'] });
  assert.deepEqual(diffPlanStages([], []), { added: [], modified: [], removed: [] });
});

test('sourceDrift paths are recorded on the entry', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const document = plan(undefined, 1);
    const recorded = await recordPlanHistory(fixture.root, {
      plan: document,
      planHash: planHash(document),
      sourceDrift: [{ path: 'docs/planning/ROADMAP.md', expected: 'a'.repeat(64), observed: 'b'.repeat(64) }],
    });
    assert.deepEqual(recorded.entry.sourceDrift, ['docs/planning/ROADMAP.md']);
  } finally {
    await fixture.cleanup();
  }
});

test('the hash chain is verified on read, and a hand-edited line is ERR_PLAN_HISTORY_TAMPERED', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const first = plan(undefined, 1);
    await recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) });
    const second = plan([{ ...first.stages[0], title: 'Renamed' }], 2);
    await recordPlanHistory(fixture.root, { plan: second, planHash: planHash(second) });

    const entries = await readPlanHistory(fixture.root);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].prev, entries[0].digest);

    // Hand-editing a field the digest covers breaks the chain.
    const historyPath = path.join(fixture.root, '.shipping', 'plan-history.jsonl');
    const lines = (await readFile(historyPath, 'utf8')).trim().split('\n');
    const tampered = JSON.parse(lines[0]);
    tampered.revision = 99;
    lines[0] = JSON.stringify(tampered);
    await writeFile(historyPath, `${lines.join('\n')}\n`, 'utf8');

    await assert.rejects(
      () => readPlanHistory(fixture.root),
      (error) => error.code === 'ERR_PLAN_HISTORY_TAMPERED',
    );
    await assert.rejects(
      () => recordPlanHistory(fixture.root, { plan: first, planHash: planHash(first) }),
      (error) => error.code === 'ERR_PLAN_HISTORY_TAMPERED',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('a missing history file reads as an empty, valid history', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    assert.deepEqual(await readPlanHistory(fixture.root), []);
    assert.deepEqual(await planHistorySummary(fixture.root), { entries: 0, lastRevision: null, lastPlanHash: null });
  } finally {
    await fixture.cleanup();
  }
});
