import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { addManualIssue } from '../../src/core/issues.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { readState } from '../../src/core/state.mjs';

test('passing release closes while NEXT debt migrates to backlog', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await addManualIssue(fixture.root, {
      title: 'Optional documentation polish',
      description: 'Does not violate the release contract.',
      classification: 'NEXT',
      basisId: 'GOAL-006',
      evidenceRef: 'manual:operator',
    });
    const verification = await verifyRelease(fixture.root);
    assert.equal(verification.decision, 'SHIPPABLE');
    assert.equal(verification.issues.counts.BLOCKER, 0);
    assert.equal(verification.issues.counts.NEXT, 1);
    const closed = await closeRelease(fixture.root);
    assert.equal(closed.state.state, 'CLOSED');
    assert.equal(closed.backlog.items.length, 1);
    assert.equal(closed.receipt.acceptance.requiredFailed, 0);
    await access(closed.receiptPath);
    await access(closed.reportPath);
  } finally {
    await fixture.cleanup();
  }
});

test('state and ledger survive process-independent reads', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    const first = await readState(fixture.root);
    const second = await readState(fixture.root);
    assert.equal(first.state, 'SHIPPABLE');
    assert.deepEqual(second, first);
    assert.match(await fixture.read('.shipping/ledger.jsonl'), /gate\.decision/u);
  } finally {
    await fixture.cleanup();
  }
});