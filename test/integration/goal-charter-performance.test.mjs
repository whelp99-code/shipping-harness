import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { compileGoalCharterPreview, GOAL_CHARTER } from '../../src/core/goal-charter.mjs';
import { createScopeProposal } from '../../src/core/proposals.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0;
}

test('Goal Charter preview is deterministic, bounded, and fast without model or network calls', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, {
      goal: 'Complete the existing internal validation workflow and prove it with npm test.',
      release: '0.1.0',
    });
    const hashes = [];
    const timings = [];
    let maxBytes = 0;
    for (let index = 0; index < 1000; index += 1) {
      const started = performance.now();
      const preview = compileGoalCharterPreview({ ...proposal, modelText: `ignored-host-model-${index}` });
      timings.push(performance.now() - started);
      hashes.push(preview.hash);
      maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(preview)));
    }
    assert.equal(new Set(hashes).size, 1);
    assert.ok(percentile(timings, 0.95) < 25, `p95=${percentile(timings, 0.95).toFixed(3)}ms`);
    assert.ok(Math.max(...timings) < 200, `max=${Math.max(...timings).toFixed(3)}ms`);
    assert.ok(maxBytes <= GOAL_CHARTER.maxSerializedBytes, `bytes=${maxBytes}`);
  } finally {
    await fixture.cleanup();
  }
});
