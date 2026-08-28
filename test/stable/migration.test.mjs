import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STABLE_SCHEMAS,
  assertSupportedUpgrade,
  deprecationNotice,
  migrateArtifact,
  migrationReceipt,
} from '../../packages/stable-control/index.mjs';

test('supported v0.6 through v0.9 upgrades are explicit', () => {
  for (const version of ['0.6.0', '0.7.0', '0.8.0', '0.9.0']) assert.equal(assertSupportedUpgrade(version).supported, true);
  assert.throws(() => assertSupportedUpgrade('0.5.0'), /Unsupported source release/u);
});

test('legacy Goal/Task identifier migrates without changing authority bindings', () => {
  const legacy = {
    schema: 'shipping-harness/goal-task-v1',
    project: 'p',
    release: '0.9.0',
    contractHash: 'a'.repeat(64),
    goals: [{ id: 'GOAL-001' }],
    tasks: [{ id: 'TASK-001' }],
  };
  const result = migrateArtifact(legacy);
  assert.equal(result.toSchema, STABLE_SCHEMAS.goalGraph);
  assert.equal(result.artifact.contractHash, legacy.contractHash);
  assert.deepEqual(result.artifact.goals, legacy.goals);
  assert.equal(deprecationNotice(legacy.schema).deprecated, true);
});

test('migration receipt preserves CLOSED state and reports changed artifacts', () => {
  const receipt = migrationReceipt({
    fromRelease: '0.9.0',
    sourceState: 'CLOSED',
    targetState: 'CLOSED',
    artifacts: [{ kind: 'state', changed: false }],
  });
  assert.equal(receipt.schema, STABLE_SCHEMAS.migrationReceipt);
  assert.equal(receipt.changed, false);
  assert.throws(() => migrationReceipt({ fromRelease: '0.9.0', sourceState: 'CLOSED', targetState: 'PAUSED', artifacts: [{ kind: 'state', changed: true }] }), /CLOSED/u);
});

test('unknown major schema fails closed', () => {
  assert.throws(() => migrateArtifact({ schema: 'shipping-harness/contract-v99' }), /Unsupported stable schema/u);
});
