import test from 'node:test';
import assert from 'node:assert/strict';
import { listAdapters, probeAllAdapters, resolveAdapter } from '../../src/adapters/registry.mjs';

test('registry exposes the five v0.2 adapters and resolves documented aliases', () => {
  assert.deepEqual(listAdapters().map((adapter) => adapter.name), [
    'generic',
    'codex',
    'gajae',
    'ouroboros',
    'omo',
  ]);
  assert.equal(resolveAdapter('gjc').name, 'gajae');
  assert.equal(resolveAdapter('ooo').name, 'ouroboros');
  assert.equal(resolveAdapter('omo-native').name, 'omo');
  assert.throws(() => resolveAdapter('imaginary'), { code: 'ERR_ADAPTER_UNKNOWN' });
});

test('all adapter reports use the strict capability schema without missing boolean keys', () => {
  const reports = probeAllAdapters({ contract: { adapters: {} }, root: process.cwd() });
  assert.equal(reports.length, 5);
  for (const report of reports) {
    assert.equal(report.schema, 'shipping-harness/adapter-capabilities-v1');
    assert.ok(['live', 'configured', 'fixture', 'unavailable'].includes(report.verificationLevel));
    assert.equal(Object.values(report.capabilities).every((value) => typeof value === 'boolean'), true);
  }
});