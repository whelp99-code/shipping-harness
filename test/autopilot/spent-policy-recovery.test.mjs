// v1.13.8: the end-to-end replay of the deadlock reported from a live 1.0.2 -> 1.0.3
// release. The existing coverage in autopilot-flow.test.mjs only exercises the
// continuation path, where the next release stays inside the same train. The reported
// case is the other one: a fresh proposal with a different goal forms a NEW train, so
// continuation does not apply, and approving it the ordinary way used to lock the scope
// first and only then discover that the policy bound to the closed 1.0.2 was still
// "active". The caller was left LOCKED with a stale binding, and every exit was refused:
// approve said ERR_APPROVAL_STATE, verify said STALE_POLICY_BINDING.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { isSpentAutopilotBinding, loadAutopilotState, readAutopilotLedger } from '../../src/core/autopilot.mjs';
import { readTrustedState } from '../../src/core/state.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function closedFirstRelease(release = '1.0.2') {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  await writeFile(path.join(fixture.root, 'Makefile'), `e2e:\n\t@node -e "process.stdout.write('e2e-pass')"\n\nsmoke:\n\t@node -e "process.stdout.write('smoke-pass')"\n`, 'utf8');
  await fixture.commit('fixture: add acceptance targets');
  const started = await callShippingTool(fixture.root, 'shipping_start', {
    goal: 'Deliver one useful local workflow, then make it operable with rollback and prove it in a bounded pilot.',
    release,
  });
  await callShippingTool(fixture.root, 'shipping_approve_scope', {
    proposalId: started.structuredContent.proposalId,
    proposalHash: started.structuredContent.proposalHash,
    confirm: true,
    autopilotProfile: 'LOCAL_REVERSIBLE',
    confirmAutopilot: true,
  });
  await callShippingTool(fixture.root, 'shipping_verify', {});
  const state = await readTrustedState(fixture.root);
  if (state.state !== 'CLOSED') await callShippingTool(fixture.root, 'shipping_close', {});
  await fixture.commit('chore: commit the closed release receipts');
  return { fixture, started };
}

test('a new train after a closed autopilot release approves, verifies and closes without a deadlock', async () => {
  const { fixture } = await closedFirstRelease('1.0.2');
  try {
    const spent = await loadAutopilotState(fixture.root);
    assert.equal(spent.phase, 'RELEASE_CLOSED', 'the reported case starts from a non-terminal phase, not TRAIN_COMPLETE');
    assert.equal(spent.currentRelease, '1.0.2');
    // "Spent" is a statement about a *newer* release: while 1.0.2 is still the current
    // release the binding is simply current, and it becomes spent the moment 1.0.3 is the
    // release being approved -- which is exactly when the old code raised
    // ERR_AUTOPILOT_ACTIVE, after the lock.
    assert.equal(await isSpentAutopilotBinding(fixture.root, '1.0.2', '1.0.2'), false);
    assert.equal(await isSpentAutopilotBinding(fixture.root, '1.0.2', '1.0.3'), true);
    assert.equal(await isSpentAutopilotBinding(fixture.root, '9.9.9', '1.0.3'), false, 'a binding with no closure receipt is not lifecycle and still fails closed');

    // A different goal forms a new train, so autopilotContinuation does not apply and the
    // caller can only approve the ordinary way -- the exact path that used to deadlock.
    const next = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Replace the truncation in the top-level report with a bounded, complete rendering.',
      release: '1.0.3',
    });
    assert.equal(next.structuredContent.proposalState, 'READY_FOR_APPROVAL');

    const approved = await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: next.structuredContent.proposalId,
      proposalHash: next.structuredContent.proposalHash,
      confirm: true,
      autopilotProfile: 'MANUAL',
      confirmAutopilot: true,
    });
    assert.equal(approved.structuredContent.state, 'LOCKED');
    assert.equal(approved.structuredContent.release, '1.0.3');

    const verified = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(verified.structuredContent.decision, 'SHIPPABLE', 'verify must not be stopped by STALE_POLICY_BINDING');
    const closed = await callShippingTool(fixture.root, 'shipping_close', {});
    assert.equal(closed.structuredContent.state, 'CLOSED');
    assert.equal(closed.structuredContent.released, false, 'closing is never releasing');
  } finally {
    await fixture.cleanup();
  }
});

test('the recovery is repeatable: a second new train after a second close also gets through', async () => {
  const { fixture } = await closedFirstRelease('1.0.2');
  try {
    for (const [previous, release, goal] of [
      ['1.0.2', '1.0.3', 'Replace the truncation in the top-level report with a bounded, complete rendering.'],
      ['1.0.3', '1.0.4', 'Record every skipped acceptance command in the receipt so a green run cannot hide one.'],
    ]) {
      assert.equal(await isSpentAutopilotBinding(fixture.root, previous, release), true, `${previous} must be spent once ${release} is the release under approval`);
      const next = await callShippingTool(fixture.root, 'shipping_start', { goal, release });
      assert.equal(next.structuredContent.proposalState, 'READY_FOR_APPROVAL');
      const before = await readTrustedState(fixture.root);
      assert.equal(before.state, 'CLOSED', 'a proposal alone never moves the release state');

      const approved = await callShippingTool(fixture.root, 'shipping_approve_scope', {
        proposalId: next.structuredContent.proposalId,
        proposalHash: next.structuredContent.proposalHash,
        confirm: true,
        autopilotProfile: 'MANUAL',
        confirmAutopilot: true,
      });
      const after = await readTrustedState(fixture.root);
      assert.equal(approved.structuredContent.state, 'LOCKED');
      assert.equal(after.state, 'LOCKED', 'what approve reports and what the state says must agree');
      assert.equal(after.release, release);

      assert.equal((await callShippingTool(fixture.root, 'shipping_verify', {})).structuredContent.decision, 'SHIPPABLE');
      assert.equal((await callShippingTool(fixture.root, 'shipping_close', {})).structuredContent.state, 'CLOSED');
      await fixture.commit(`chore: commit the closed ${release} receipts`);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('re-activating on a new train continues the one ledger chain instead of restarting it', async () => {
  const { fixture } = await closedFirstRelease('1.0.2');
  try {
    const beforeActivation = await readAutopilotLedger(fixture.root);
    assert.equal(beforeActivation.at(-1).sequence, beforeActivation.length);
    assert.equal(beforeActivation.at(-1).release, '1.0.2');

    const next = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Replace the truncation in the top-level report with a bounded, complete rendering.',
      release: '1.0.3',
    });
    await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: next.structuredContent.proposalId,
      proposalHash: next.structuredContent.proposalHash,
      confirm: true,
      autopilotProfile: 'MANUAL',
      confirmAutopilot: true,
    });

    // readAutopilotLedger revalidates the whole chain, so it throws if activation reset
    // the sequence. Assert the shape too, so a silent change of chaining is caught.
    const events = await readAutopilotLedger(fixture.root);
    assert.equal(events.length, beforeActivation.length + 1);
    const activation = events.at(-1);
    assert.equal(activation.type, 'autopilot.activated');
    assert.equal(activation.release, '1.0.3');
    assert.equal(activation.sequence, beforeActivation.at(-1).sequence + 1, 'activation must not restart the ledger at 1');
    assert.equal(activation.previousHash, beforeActivation.at(-1).hash, 'activation must chain to the last event, not to null');
    for (const [index, event] of events.entries()) {
      assert.equal(event.sequence, index + 1);
      assert.equal(event.previousHash, index === 0 ? null : events[index - 1].hash);
    }
  } finally {
    await fixture.cleanup();
  }
});
