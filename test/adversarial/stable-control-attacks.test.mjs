import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STABLE_SCHEMAS,
  migrateArtifact,
  stableHealth,
  validateStableArtifact,
} from '../../packages/stable-control/index.mjs';

test('migration cannot turn a runtime claim into Shipping release authority', () => {
  const receipt = {
    schema: STABLE_SCHEMAS.omoReceipt,
    work_order_id: 'w',
    shipping_session_id: 's',
    release_id: 'r',
    contract_hash: `sha256:${'a'.repeat(64)}`,
    source_git_sha: 'b'.repeat(40),
    status: 'completed',
    requires_shipping_verification: true,
    shipping_finisher_authority: true,
    terminal_replay_allowed: false,
    usage: {},
    path_analysis: { violations: [] },
    receipt_hash: 'c'.repeat(64),
    signature: 'd'.repeat(64),
  };
  const migrated = migrateArtifact(receipt).artifact;
  assert.equal(migrated.requires_shipping_verification, true);
  assert.notEqual(migrated.schema, STABLE_SCHEMAS.release);
});

test('false CLOSED artifacts missing contract binding are rejected', () => {
  assert.throws(
    () => validateStableArtifact(STABLE_SCHEMAS.release, { schema: STABLE_SCHEMAS.release, release: '1.0.0', state: 'CLOSED' }),
    /contractHash/u,
  );
});

test('unknown schemas and arrays do not downgrade validation', () => {
  for (const value of [[], null, { schema: 'shipping-harness/release-v2' }]) assert.throws(() => migrateArtifact(value), /./u);
});

test('blocked Shipping state cannot render healthy', () => {
  const health = stableHealth({ shippingStatus: { state: { state: 'BLOCKED' } }, pluginDoctor: { healthy: true }, omoProbe: { status: 'live' }, remoteHealth: { status: 'healthy' } });
  assert.equal(health.status, 'DEGRADED');
});
