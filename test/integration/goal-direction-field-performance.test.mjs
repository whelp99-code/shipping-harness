import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { buildGoalDirectionFieldReport, fieldAuthorityFingerprint } from '../../scripts/goal-direction-field-pilot.mjs';

function fixture() {
  const realProjects = [{ path: '/tmp/field-project', available: true, unchanged: true, head: 'a'.repeat(40) }];
  return {
    discovery: { status: 'PASS', release: '1.7.0', disposable: { directionHash: '1'.repeat(64) }, safety: {}, realProjects },
    charter: { status: 'PASS', release: '1.8.0', disposable: { previewHash: '2'.repeat(64), acceptedHash: '3'.repeat(64), trainHash: '4'.repeat(64) }, safety: {}, realProjects },
    autopilot: { status: 'PASS', release: '1.6.1', released: false, policyHash: '5'.repeat(64), safety: {}, realProjects },
  };
}

test('authority fingerprint and integrated report remain bounded and deterministic', () => {
  const input = fixture();
  const expected = fieldAuthorityFingerprint(input);
  const samples = [];
  for (let index = 0; index < 2000; index += 1) {
    const started = performance.now();
    assert.equal(fieldAuthorityFingerprint(input), expected);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  assert.ok(p95 < 5, `fingerprint p95 ${p95}ms exceeds 5ms`);
  const report = buildGoalDirectionFieldReport(input);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 256 * 1024);
  assert.equal(report.modelCalls, 0);
  assert.equal(report.networkCalls, 0);
});
