import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool, SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';
import { auditGoalCharterHistory, loadArchivedGoalCharter, loadGoalCharter } from '../../src/core/goal-charter.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const FIRST_GOAL = 'Complete one useful local validation workflow with repository-owned tests and no external deployment.';
const NEXT_GOAL = 'Make the proven local workflow operable and recoverable without changing external systems.';

test('sequential releases archive the predecessor Goal Charter only after CLOSED and preserve immutable history', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await writeFile(path.join(fixture.root, 'Makefile'), `smoke:\n\t@node -e "process.stdout.write('smoke-pass')"\n\ne2e:\n\t@node -e "process.stdout.write('e2e-pass')"\n`, 'utf8');
    await fixture.commit('fixture: add value-bearing user-flow acceptance');
    const first = await callShippingTool(fixture.root, 'shipping_start', { goal: FIRST_GOAL, release: '0.1.0' });
    assert.equal(first.structuredContent.proposalState, 'READY_FOR_APPROVAL');
    await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: first.structuredContent.proposalId,
      proposalHash: first.structuredContent.proposalHash,
      confirm: true,
      autopilotProfile: 'LOCAL_REVERSIBLE',
      confirmAutopilot: true,
    });
    const firstCharter = await loadGoalCharter(fixture.root);
    const execution = await callShippingTool(fixture.root, 'shipping_execute', {});
    assert.equal(execution.structuredContent.autopilot.decision, 'AUTO');
    const verified = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(verified.structuredContent.decision, 'SHIPPABLE');
    assert.equal(verified.structuredContent.autoClosure?.closed, true);
    assert.equal(verified.structuredContent.autoClosure?.state, 'CLOSED');
    await fixture.commit('chore: preserve first closed release');

    const next = await callShippingTool(fixture.root, 'shipping_start', { goal: NEXT_GOAL, release: '0.2.0' });
    assert.equal(next.structuredContent.proposalState, 'READY_FOR_APPROVAL');
    await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: next.structuredContent.proposalId,
      proposalHash: next.structuredContent.proposalHash,
      confirm: false,
      autopilotContinuation: true,
    });

    const active = await loadGoalCharter(fixture.root);
    const archived = await loadArchivedGoalCharter(fixture.root, '0.1.0');
    const history = await auditGoalCharterHistory(fixture.root);
    assert.equal(active.release, '0.2.0');
    assert.equal(archived.hash, firstCharter.hash);
    assert.equal(history.status, 'PASS');
    assert.deepEqual(history.entries.map((entry) => entry.release), ['0.1.0']);
    assert.equal(history.entries[0].hash, firstCharter.hash);
    assert.equal(history.modelAuthority, false);
    assert.equal(history.released, false);
  } finally {
    await fixture.cleanup();
  }
});

test('vague goal, delegated defaults, and host-model labels keep one bounded authority result', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const goal = 'Make this project useful for internal work.';
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.3.0', proposerId: 'none-model' });
    assert.equal(started.structuredContent.proposalState, 'NEEDS_INPUT');
    assert.ok(started.structuredContent.goalDiscovery.questions.length >= 1);
    assert.ok(started.structuredContent.goalDiscovery.questions.length <= 3);
    const answers = started.structuredContent.goalDiscovery.questions.map((question) => ({ questionId: question.id, choice: 'recommended' }));
    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      answers,
    });
    assert.equal(refined.structuredContent.proposalState, 'READY_FOR_APPROVAL');
    const authority = refined.structuredContent;
    const expected = JSON.stringify({
      discovery: authority.goalDiscovery.hash,
      direction: authority.goalDiscovery.direction.hash,
      charter: authority.goalCharter.hash,
      train: authority.releaseTrain.hash,
      action: authority.actionEnvelope.hash,
      state: authority.proposalState,
    });
    for (const proposerId of ['weak-model', 'strong-model', 'hostile-model']) {
      const repeated = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.3.0', proposerId });
      const observed = JSON.stringify({
        discovery: repeated.structuredContent.goalDiscovery.hash,
        direction: repeated.structuredContent.goalDiscovery.direction.hash,
        charter: repeated.structuredContent.goalCharter.hash,
        train: repeated.structuredContent.releaseTrain.hash,
        action: repeated.structuredContent.actionEnvelope.hash,
        state: repeated.structuredContent.proposalState,
      });
      assert.equal(observed, expected);
    }
    assert.equal(SHIPPING_TOOLS.length, 9);
  } finally {
    await fixture.cleanup();
  }
});
