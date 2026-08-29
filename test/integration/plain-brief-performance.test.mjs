import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { compilePlainBrief } from '../../src/core/plain-brief.mjs';

function fixture() {
  return {
    canonicalState: 'DIRTY_BASELINE',
    release: '1.1.1',
    readyForApproval: false,
    proposalId: 'proposal-performance',
    proposalRevision: 1,
    baseline: {
      counts: { PRODUCT: 7, RELEASE_EVIDENCE: 3, AGENT_RUNTIME: 1, SHIPPING_RUNTIME: 1, GENERATED: 0, UNKNOWN: 0 },
      blockingCount: 10,
      plan: {
        hash: 'a'.repeat(64),
        fileSetHash: 'b'.repeat(64),
        includePaths: Array.from({ length: 10 }, (_, index) => `runtime/file-${index}.txt`),
        excludePaths: ['.omo/session.json', '.shipping/state.json'],
        suggestedCommitMessage: 'test: preserve authentication and release packaging baseline',
        recommendation: 'PRESERVE',
      },
    },
    intelligence: {
      acceptanceCoverage: { complete: true, coveredPaths: 10, totalPaths: 10, uncoveredPaths: [] },
      goalRecommendation: { authority: 'recommendation-only', text: 'Complete the current patch.', explicitUserGoalWins: true },
    },
  };
}

test('plain brief compilation is local, dependency-light, deterministic, and within latency budget', async () => {
  const source = await readFile(new URL('../../src/core/plain-brief.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    "node:child_process",
    "node:http",
    "node:https",
    "node:net",
    "node:dns",
    "fetch(",
    "runGit(",
    "openai",
    "anthropic",
    "gemini",
  ]) {
    assert.equal(source.includes(forbidden), false, `plain compiler must not depend on ${forbidden}`);
  }

  const input = fixture();
  const hashes = new Set();
  const started = performance.now();
  const iterations = 2000;
  for (let index = 0; index < iterations; index += 1) {
    const result = compilePlainBrief({ ...input, hostModel: { label: index % 2 ? 'weak' : 'strong' } });
    assert.equal(result.quality.healthy, true);
    hashes.add(result.hash);
  }
  const elapsed = performance.now() - started;
  const averageMs = elapsed / iterations;
  assert.equal(hashes.size, 1);
  assert.ok(averageMs < 5, `average compile latency ${averageMs.toFixed(3)}ms exceeded 5ms`);
});

test('plain brief compilation does not mutate the authority input', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const result = compilePlainBrief(input);
  assert.equal(result.quality.healthy, true);
  assert.equal(JSON.stringify(input), before);
});
