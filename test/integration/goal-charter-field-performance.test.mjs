import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createScopeProposal } from '../../src/core/proposals.mjs';
import { compileGoalCharterPreview } from '../../src/core/goal-charter.mjs';
import { compilePlainBrief } from '../../src/core/plain-brief.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

test('Goal Charter and beginner field projections remain deterministic, bounded, and below local p95 budgets', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const created = await createScopeProposal(fixture.root, {
      goal: 'Complete one useful internal workflow with repository-owned tests and no external deployment.',
      release: '0.1.0',
    });
    const proposal = created.proposal;
    const charterHashes = new Set();
    const briefHashes = new Set();
    const charterSamples = [];
    const briefSamples = [];
    for (let index = 0; index < 500; index += 1) {
      let started = performance.now();
      const charter = compileGoalCharterPreview(proposal);
      charterSamples.push(performance.now() - started);
      charterHashes.add(charter.hash);
      started = performance.now();
      const brief = compilePlainBrief({ ...proposal, goalCharter: charter });
      briefSamples.push(performance.now() - started);
      briefHashes.add(brief.hash);
      assert.ok(Buffer.byteLength(JSON.stringify(brief)) <= 8192);
    }
    assert.equal(charterHashes.size, 1);
    assert.equal(briefHashes.size, 1);
    assert.ok(percentile(charterSamples, 0.95) < 10, `Goal Charter p95 exceeded 10ms: ${percentile(charterSamples, 0.95)}`);
    assert.ok(percentile(briefSamples, 0.95) < 10, `Plain brief p95 exceeded 10ms: ${percentile(briefSamples, 0.95)}`);
  } finally {
    await fixture.cleanup();
  }
});
