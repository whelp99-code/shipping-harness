import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { appendDecisionLedgerEvent, decisionLedgerSummary, readDecisionLedger } from '../../src/core/decision-ledger.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function eventInput(fixture, overrides = {}) {
  return {
    proposalId: 'proposal-ledger-test',
    proposalRevision: 1,
    proposalHash: 'a'.repeat(64),
    gitSha: currentGitSha(fixture.root),
    type: 'discovery.created',
    questionId: null,
    directionHash: null,
    discoveryHash: 'b'.repeat(64),
    choice: null,
    provenance: 'mechanical',
    evidenceRefs: ['EVID-001'],
    details: {},
    occurredAt: new Date('2026-08-30T00:00:00.000Z'),
    ...overrides,
  };
}

test('decision ledger is append-only, hash chained, independently readable, and idempotent on replay', async () => {
  const fixture = await createFixtureRepo();
  try {
    const created = await appendDecisionLedgerEvent(fixture.root, eventInput(fixture));
    assert.equal(created.duplicate, false);
    assert.equal(created.event.sequence, 1);
    assert.equal(created.event.previousHash, null);

    const resolvedInput = eventInput(fixture, {
      type: 'question.resolved',
      questionId: 'Q-GOAL-001',
      choice: '권장된 핵심 흐름을 완성',
      provenance: 'delegated-recommended-default',
      evidenceRefs: ['EVID-001', 'goalDiscovery.questions'],
      occurredAt: new Date('2026-08-30T00:00:01.000Z'),
    });
    const resolved = await appendDecisionLedgerEvent(fixture.root, resolvedInput);
    assert.equal(resolved.event.sequence, 2);
    assert.equal(resolved.event.previousHash, created.event.hash);

    const duplicate = await appendDecisionLedgerEvent(fixture.root, resolvedInput);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.event.hash, resolved.event.hash);

    const ready = await appendDecisionLedgerEvent(fixture.root, eventInput(fixture, {
      type: 'direction.ready',
      directionHash: 'c'.repeat(64),
      discoveryHash: 'd'.repeat(64),
      provenance: 'mechanical-direction-critic',
      evidenceRefs: ['goalDiscovery.critic', 'goalDiscovery.direction'],
      occurredAt: new Date('2026-08-30T00:00:02.000Z'),
    }));
    const accepted = await appendDecisionLedgerEvent(fixture.root, eventInput(fixture, {
      type: 'direction.accepted',
      directionHash: 'c'.repeat(64),
      discoveryHash: 'd'.repeat(64),
      provenance: 'explicit-user-or-policy-boundary',
      evidenceRefs: ['goalDiscovery.direction'],
      occurredAt: new Date('2026-08-30T00:00:03.000Z'),
    }));
    assert.equal(ready.event.previousHash, resolved.event.hash);
    assert.equal(accepted.event.previousHash, ready.event.hash);

    const events = await readDecisionLedger(fixture.root);
    assert.equal(events.length, 4);
    assert.deepEqual(events.map((entry) => entry.sequence), [1, 2, 3, 4]);
    assert.equal(events.every((entry) => entry.modelAuthority === false && entry.released === false), true);
    const summary = await decisionLedgerSummary(fixture.root, 'proposal-ledger-test');
    assert.equal(summary.eventCount, 4);
    assert.equal(summary.lastType, 'direction.accepted');
    assert.equal(summary.acceptedDirectionHash, 'c'.repeat(64));
  } finally {
    await fixture.cleanup();
  }
});

test('concurrent ledger appends serialize to one contiguous chain', async () => {
  const fixture = await createFixtureRepo();
  try {
    await appendDecisionLedgerEvent(fixture.root, eventInput(fixture));
    await Promise.all(Array.from({ length: 12 }, (_, index) => appendDecisionLedgerEvent(fixture.root, eventInput(fixture, {
      type: 'question.resolved',
      questionId: `Q-CONCURRENT-${String(index).padStart(3, '0')}`,
      choice: `choice-${index}`,
      provenance: 'explicit-user-refinement',
      occurredAt: new Date(`2026-08-30T00:01:${String(index).padStart(2, '0')}.000Z`),
    }))));
    const events = await readDecisionLedger(fixture.root);
    assert.equal(events.length, 13);
    assert.deepEqual(events.map((entry) => entry.sequence), Array.from({ length: 13 }, (_, index) => index + 1));
    for (let index = 1; index < events.length; index += 1) {
      assert.equal(events[index].previousHash, events[index - 1].hash);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('decision ledger fails closed on tamper, sequence gaps, and replayed event keys', async () => {
  const fixture = await createFixtureRepo();
  try {
    await appendDecisionLedgerEvent(fixture.root, eventInput(fixture));
    await appendDecisionLedgerEvent(fixture.root, eventInput(fixture, {
      type: 'question.resolved',
      questionId: 'Q-TAMPER-001',
      choice: 'original',
      provenance: 'explicit-user-refinement',
      occurredAt: new Date('2026-08-30T00:02:00.000Z'),
    }));
    const raw = await readFile(fixture.paths.decisionLedger, 'utf8');
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line));

    const tampered = structuredClone(rows);
    tampered[1].choice = 'tampered';
    await writeFile(fixture.paths.decisionLedger, `${tampered.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    await assert.rejects(readDecisionLedger(fixture.root), (error) => error.code === 'ERR_DECISION_LEDGER_HASH');

    const gap = structuredClone(rows);
    gap[1].sequence = 3;
    await writeFile(fixture.paths.decisionLedger, `${gap.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    await assert.rejects(readDecisionLedger(fixture.root), (error) => ['ERR_DECISION_LEDGER_HASH', 'ERR_DECISION_LEDGER_SEQUENCE'].includes(error.code));

    const replay = [...rows, rows[1]];
    await writeFile(fixture.paths.decisionLedger, `${replay.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    await assert.rejects(readDecisionLedger(fixture.root), (error) => ['ERR_DECISION_LEDGER_SEQUENCE', 'ERR_DECISION_LEDGER_REPLAY', 'ERR_DECISION_LEDGER_CHAIN'].includes(error.code));
  } finally {
    await fixture.cleanup();
  }
});
