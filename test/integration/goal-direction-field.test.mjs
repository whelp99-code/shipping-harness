import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGoalDirectionFieldReport, validateGoalDirectionFieldReport } from '../../scripts/goal-direction-field-pilot.mjs';

function child(status = 'PASS') {
  return {
    status,
    release: '1.8.1',
    safety: {
      falseReady: 0,
      falseClosed: 0,
      automaticReleased: 0,
      targetMutation: 0,
    },
    realProjects: [
      { path: '/tmp/project-a', available: true, unchanged: true, head: 'a'.repeat(40) },
    ],
  };
}

test('integrated Goal Direction field report keeps one authority fingerprint across model variants', () => {
  const discovery = { ...child(), disposable: { directionHash: '1'.repeat(64) } };
  const charter = { ...child(), disposable: { previewHash: '2'.repeat(64), acceptedHash: '3'.repeat(64), trainHash: '4'.repeat(64) } };
  const autopilot = { ...child(), released: false, policyHash: '5'.repeat(64) };
  const report = buildGoalDirectionFieldReport({ discovery, charter, autopilot, durationMs: 12.5 });
  assert.equal(report.status, 'PASS');
  assert.equal(report.mcp.tools, 9);
  assert.equal(new Set(report.modelVariants.map((entry) => entry.authorityFingerprint)).size, 1);
  assert.equal(report.realProjects[0].unchanged, true);
  assert.equal(report.released, false);
  assert.equal(validateGoalDirectionFieldReport(report), report);
});

test('real project evidence is fail-closed when any available lane changes', () => {
  const discovery = { ...child(), disposable: { directionHash: '1'.repeat(64) } };
  const charter = {
    ...child(),
    disposable: { previewHash: '2'.repeat(64), acceptedHash: '3'.repeat(64), trainHash: '4'.repeat(64) },
    realProjects: [{ path: '/tmp/project-a', available: true, unchanged: false, head: 'a'.repeat(40) }],
  };
  const autopilot = { ...child(), released: false };
  assert.throws(() => buildGoalDirectionFieldReport({ discovery, charter, autopilot }), /target-mutation/u);
});
