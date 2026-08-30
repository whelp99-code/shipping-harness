import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { appendDecisionLedgerEvent, DECISION_LEDGER, readDecisionLedger } from '../../src/core/decision-ledger.mjs';
import { buildDecisionEvidence } from '../../src/core/decision-evidence.mjs';
import { compileGoalDiscovery, GOAL_DISCOVERY } from '../../src/core/goal-discovery.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0;
}

test('goal discovery remains deterministic, bounded, and fast without model or network calls', async () => {
  const fixture = await createFixtureRepo();
  try {
    const evidence = await buildDecisionEvidence(fixture.root, { goal: '이 프로젝트를 완성해', mode: 'AUTO' });
    const initial = compileGoalDiscovery(evidence);
    const resolutions = initial.questions.map((question) => ({
      questionId: question.id,
      category: question.category,
      choice: question.recommendedChoice,
      recommendedChoice: question.recommendedChoice,
      usedRecommendedChoice: true,
      authority: 'explicit-user-refinement',
    }));
    const hashes = [];
    const timings = [];
    for (let index = 0; index < 1000; index += 1) {
      const started = performance.now();
      const result = compileGoalDiscovery(evidence, { resolutions, round: 2, modelText: `ignored-${index}` });
      timings.push(performance.now() - started);
      hashes.push(result.hash);
      assert.ok(result.questions.length <= GOAL_DISCOVERY.maxQuestions);
      assert.ok(result.candidates.length <= GOAL_DISCOVERY.maxCandidates);
    }
    assert.equal(new Set(hashes).size, 1);
    assert.ok(percentile(timings, 0.95) < 25, `p95=${percentile(timings, 0.95).toFixed(3)}ms`);
    assert.ok(Math.max(...timings) < 200, `max=${Math.max(...timings).toFixed(3)}ms`);
  } finally {
    await fixture.cleanup();
  }
});

test('decision ledger enforces its event retention limit and remains independently readable', async () => {
  const fixture = await createFixtureRepo();
  try {
    const gitSha = currentGitSha(fixture.root);
    const common = {
      proposalId: 'proposal-retention',
      proposalRevision: 1,
      proposalHash: 'a'.repeat(64),
      gitSha,
      discoveryHash: 'b'.repeat(64),
      directionHash: null,
      provenance: 'mechanical',
      evidenceRefs: ['EVID-001'],
      details: {},
    };
    await appendDecisionLedgerEvent(fixture.root, {
      ...common,
      type: 'discovery.created',
      questionId: null,
      choice: null,
      occurredAt: new Date('2026-08-30T01:00:00.000Z'),
    });
    for (let index = 1; index < DECISION_LEDGER.maxEvents; index += 1) {
      await appendDecisionLedgerEvent(fixture.root, {
        ...common,
        type: 'question.resolved',
        questionId: `Q-RETENTION-${String(index).padStart(3, '0')}`,
        choice: `choice-${index}`,
        provenance: 'explicit-user-refinement',
        occurredAt: new Date(1788061200000 + index * 1000),
      });
    }
    const events = await readDecisionLedger(fixture.root);
    assert.equal(events.length, DECISION_LEDGER.maxEvents);
    await assert.rejects(
      appendDecisionLedgerEvent(fixture.root, {
        ...common,
        type: 'question.resolved',
        questionId: 'Q-RETENTION-OVERFLOW',
        choice: 'overflow',
        provenance: 'explicit-user-refinement',
      }),
      (error) => error.code === 'ERR_DECISION_LEDGER_RETENTION',
    );
  } finally {
    await fixture.cleanup();
  }
});
