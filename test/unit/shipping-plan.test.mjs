import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import {
  DEFAULT_PLAN_PATH,
  PLAN_LIMITS,
  PLAN_SCHEMA,
  candidateCommandRef,
  loadShippingPlan,
  planHash,
  resolveAcceptanceRefs,
  validateShippingPlan,
} from '../../src/core/shipping-plan.mjs';

/** @param {Record<string, any>} [overrides] */
function samplePlan(overrides = {}) {
  return {
    schema: PLAN_SCHEMA,
    project: 'fixture',
    program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
    sources: [{ path: 'docs/ROADMAP.md', note: 'read-only source' }],
    stages: [
      { id: 'S-01', title: 'Core flow', outcome: 'The core flow works.', dependsOn: [], acceptanceRefs: ['node-test'], scopeInclude: ['core'], scopeExclude: ['polish'], size: 'MILESTONE' },
      { id: 'S-02', title: 'Operate', outcome: 'It can be operated and rolled back.', dependsOn: ['S-01'], acceptanceRefs: ['node-test'], size: 'PATCH' },
    ],
    ...overrides,
  };
}

test('a well-formed plan validates, normalizes, and hashes deterministically', () => {
  const plan = validateShippingPlan(samplePlan());
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.stages.length, 2);
  assert.deepEqual(plan.stages[1].scopeInclude, []);
  assert.equal(plan.stages[1].dependsOn[0], 'S-01');
  assert.equal(planHash(plan), planHash(validateShippingPlan(samplePlan())));
  assert.notEqual(planHash(plan), planHash(validateShippingPlan(samplePlan({ project: 'other' }))));
  assert.match(planHash(plan), /^[a-f0-9]{64}$/u);
});

test('unknown keys, bad identifiers, and unknown dependencies fail validation', () => {
  assert.throws(() => validateShippingPlan(samplePlan({ extra: 1 })), /not an allowed plan field/u);
  assert.throws(
    () => validateShippingPlan(samplePlan({ stages: [{ id: 'STAGE-1', title: 'x', outcome: 'y', size: 'PATCH' }] })),
    /must look like S-01/u,
  );
  assert.throws(
    () => validateShippingPlan(samplePlan({ stages: [{ id: 'S-01', title: 'x', outcome: 'y', size: 'HUGE' }] })),
    /must be PATCH or MILESTONE/u,
  );
  assert.throws(
    () => validateShippingPlan(samplePlan({ stages: [{ id: 'S-01', title: 'x', outcome: 'y', dependsOn: ['S-09'], size: 'PATCH' }] })),
    /depends on unknown stage/u,
  );
  assert.throws(() => validateShippingPlan(samplePlan({ stages: [] })), /at least one stage/u);
});

test('dependency cycles are rejected', () => {
  const cyclic = samplePlan({
    stages: [
      { id: 'S-01', title: 'a', outcome: 'a', dependsOn: ['S-03'], size: 'MILESTONE' },
      { id: 'S-02', title: 'b', outcome: 'b', dependsOn: ['S-01'], size: 'MILESTONE' },
      { id: 'S-03', title: 'c', outcome: 'c', dependsOn: ['S-02'], size: 'MILESTONE' },
    ],
  });
  assert.throws(() => validateShippingPlan(cyclic), (error) => error.code === 'ERR_PLAN_CYCLE');
  const selfCycle = samplePlan({ stages: [{ id: 'S-01', title: 'a', outcome: 'a', dependsOn: ['S-01'], size: 'PATCH' }] });
  assert.throws(() => validateShippingPlan(selfCycle), (error) => error.code === 'ERR_PLAN_CYCLE');
});

test('stage limits are bounded', () => {
  const many = Array.from({ length: PLAN_LIMITS.maxStages + 1 }, (_, index) => ({
    id: `S-${String(index + 1).padStart(2, '0')}`,
    title: 'stage',
    outcome: 'outcome',
    size: 'PATCH',
  }));
  assert.throws(() => validateShippingPlan(samplePlan({ stages: many })), /at most 24 stages/u);
  const refs = Array.from({ length: PLAN_LIMITS.maxAcceptanceRefs + 1 }, (_, index) => `node-${index}`);
  assert.throws(
    () => validateShippingPlan(samplePlan({ stages: [{ id: 'S-01', title: 'a', outcome: 'a', acceptanceRefs: refs, size: 'PATCH' }] })),
    /at most 8 entries/u,
  );
});

test('acceptance references resolve against candidate IDs and deterministic CMD- references', () => {
  const analysis = {
    candidateCommands: [
      { id: 'node-test', description: 'tests pass', command: 'npm test', cwd: '.' },
      { id: 'node-lint', description: 'lint passes', command: 'npm run lint', cwd: '.' },
    ],
  };
  const ref = candidateCommandRef(analysis.candidateCommands[1]);
  assert.match(ref, /^CMD-[a-f0-9]{12}$/u);
  assert.equal(ref, candidateCommandRef({ command: 'npm run lint', cwd: '.' }));
  const plan = validateShippingPlan(samplePlan({
    stages: [
      { id: 'S-01', title: 'a', outcome: 'a', acceptanceRefs: ['node-test', ref], size: 'MILESTONE' },
      { id: 'S-02', title: 'b', outcome: 'b', dependsOn: ['S-01'], acceptanceRefs: ['make-nope'], size: 'PATCH' },
    ],
  }));
  const resolution = resolveAcceptanceRefs(plan, analysis);
  assert.deepEqual(resolution.get('S-01').resolved.map((entry) => entry.id), ['node-test', 'node-lint']);
  assert.deepEqual(resolution.get('S-01').unresolved, []);
  assert.deepEqual(resolution.get('S-02').unresolved, ['make-nope']);
});

test('loadShippingPlan reads the fixed path and refuses every other path', async () => {
  const fixture = await createFixtureRepo({ files: { [DEFAULT_PLAN_PATH]: `${JSON.stringify(samplePlan(), null, 2)}\n` } });
  try {
    const loaded = await loadShippingPlan(fixture.root);
    assert.equal(loaded.path, DEFAULT_PLAN_PATH);
    assert.equal(loaded.plan.stages.length, 2);
    assert.equal(loaded.planHash, planHash(loaded.plan));

    // v1.12.1: the plan path is fixed, so every other address is refused before it is resolved.
    for (const other of ['docs/absent-plan.json', '../outside.json', '.shipping/plan.json']) {
      await assert.rejects(() => loadShippingPlan(fixture.root, other), /ERR_PLAN_PATH_FIXED|path is fixed/u);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('a missing default plan file is not an error', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal(await loadShippingPlan(fixture.root), null);
  } finally {
    await fixture.cleanup();
  }
});
