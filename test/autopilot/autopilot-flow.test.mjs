import test from 'node:test';
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { loadAutopilotPolicy, loadAutopilotState } from '../../src/core/autopilot.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function createAutopilotFixture({ failingE2e = false, release = '0.2.0' } = {}) {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  const e2eBody = failingE2e
    ? `node -e "const fs=require('fs');process.exit(fs.readFileSync('README.md','utf8').includes('READY')?0:1)"`
    : `node -e "process.stdout.write('e2e-pass')"`;
  await writeFile(path.join(fixture.root, 'Makefile'), `smoke:\n\t@node -e "process.stdout.write('smoke-pass')"\n\ne2e:\n\t@${e2eBody}\n`, 'utf8');
  await fixture.commit('fixture: add smoke and e2e acceptance');
  const started = await callShippingTool(fixture.root, 'shipping_start', {
    goal: 'Deliver one useful local workflow, then make it operable with rollback and prove it in a bounded pilot.',
    release,
    proposerId: 'autopilot-flow-host',
  });
  assert.equal(started.structuredContent.proposalState, 'READY_FOR_APPROVAL');
  const approved = await callShippingTool(fixture.root, 'shipping_approve_scope', {
    proposalId: started.structuredContent.proposalId,
    proposalHash: started.structuredContent.proposalHash,
    confirm: true,
    autopilotProfile: 'LOCAL_REVERSIBLE',
    confirmAutopilot: true,
  });
  assert.equal(approved.structuredContent.state, 'LOCKED');
  assert.equal(approved.structuredContent.autopilot.profile, 'LOCAL_REVERSIBLE');
  assert.equal(approved.structuredContent.autopilot.enabled, true);
  return { fixture, started, approved };
}

test('LOCAL_REVERSIBLE policy implements, pauses, verifies, and automatically closes a proven local release without RELEASED', async () => {
  const { fixture, approved } = await createAutopilotFixture();
  try {
    const execute = await callShippingTool(fixture.root, 'shipping_execute', {});
    assert.equal(execute.structuredContent.mode, 'host-agent');
    assert.equal(execute.structuredContent.autopilot.decision, 'AUTO');
    assert.equal(execute.structuredContent.released, false);

    const paused = await callShippingTool(fixture.root, 'shipping_pause', { action: 'pause', reason: 'operator pause test' });
    assert.equal(paused.structuredContent.state.state, 'PAUSED');
    assert.equal(paused.structuredContent.autopilot.phase, 'PAUSED');
    const resumed = await callShippingTool(fixture.root, 'shipping_pause', { action: 'resume', reason: 'operator resume test' });
    assert.equal(resumed.structuredContent.state.state, 'LOCKED');
    assert.equal(resumed.structuredContent.autopilot.phase, 'IMPLEMENTING');

    const verified = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(verified.structuredContent.decision, 'SHIPPABLE');
    assert.equal(verified.structuredContent.autoClosure.closed, true);
    assert.equal(verified.structuredContent.autoClosure.state, 'CLOSED');
    assert.equal(verified.structuredContent.autoClosure.decision.decision, 'NOTIFY');
    assert.equal(verified.structuredContent.released, false);

    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.state.state, 'CLOSED');
    assert.equal(status.structuredContent.autopilot.state.phase, 'RELEASE_CLOSED');
    assert.equal(status.structuredContent.autopilot.released, false);
    assert.equal(status.structuredContent.userView.userState, 'CLOSED');
    await access(path.join(fixture.root, '.shipping', 'releases', `${approved.structuredContent.release}.json`));
  } finally {
    await fixture.cleanup();
  }
});

test('autopilot opens a bounded blocker-only fix cycle and closes after current-SHA re-verification', async () => {
  const { fixture } = await createAutopilotFixture({ failingE2e: true });
  try {
    const first = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(first.structuredContent.decision, 'TRIAGE');
    assert.ok(first.structuredContent.issues.counts.BLOCKER > 0);
    assert.equal(first.structuredContent.autoFix.decision.decision, 'AUTO');
    assert.equal(first.structuredContent.autoFix.state.state, 'FIXING');
    assert.equal(first.structuredContent.autoFix.workOrder.mode, 'host-agent');

    await writeFile(path.join(fixture.root, 'README.md'), '# Fixture\n\nREADY\n', 'utf8');
    const fixedSha = await fixture.commit('fix: satisfy bounded e2e blocker');
    assert.equal(currentGitSha(fixture.root), fixedSha);

    const second = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(second.structuredContent.decision, 'SHIPPABLE');
    assert.equal(second.structuredContent.autoClosure.closed, true);
    assert.equal(second.structuredContent.autoClosure.state, 'CLOSED');
    assert.equal(second.structuredContent.autoClosure.facts.blockerCount, 0);
    assert.equal(second.structuredContent.autoClosure.facts.unknownCount, 0);
    assert.equal(second.structuredContent.autoClosure.facts.evidenceFresh, true);
  } finally {
    await fixture.cleanup();
  }
});

test('MANUAL policy keeps close human-owned and synchronizes autopilot state after explicit close', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await writeFile(path.join(fixture.root, 'Makefile'), `e2e:\n\t@node -e "process.stdout.write('e2e-pass')"\n`, 'utf8');
    await fixture.commit('fixture: add e2e');
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Deliver one useful local workflow with current evidence.',
      release: '0.3.0',
    });
    await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      confirm: true,
    });
    const verified = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(verified.structuredContent.decision, 'SHIPPABLE');
    assert.equal(verified.structuredContent.autoClosure, null);
    const beforeClose = await loadAutopilotState(fixture.root);
    assert.equal(beforeClose.profile, 'MANUAL');
    const closed = await callShippingTool(fixture.root, 'shipping_close', {});
    assert.equal(closed.structuredContent.state, 'CLOSED');
    assert.equal(closed.structuredContent.released, false);
    assert.equal(closed.structuredContent.autopilot.phase, 'RELEASE_CLOSED');
  } finally {
    await fixture.cleanup();
  }
});

test('a committed predecessor CLOSED receipt and fresh proposal rotate the same policy into the exact next train release', async () => {
  const { fixture, started } = await createAutopilotFixture({ release: '0.4.0' });
  try {
    const firstTrain = started.structuredContent.releaseTrain;
    const nextVersion = firstTrain.releases[1].version;
    const verified = await callShippingTool(fixture.root, 'shipping_verify', {});
    assert.equal(verified.structuredContent.autoClosure.closed, true);
    const priorPolicy = await loadAutopilotPolicy(fixture.root);
    await fixture.commit('chore: commit closed release receipts');

    const next = await callShippingTool(fixture.root, 'shipping_start', {
      goal: firstTrain.releases[1].valueGate.statement,
      release: nextVersion,
      proposerId: 'autopilot-next-release-host',
    });
    assert.equal(next.structuredContent.proposalState, 'READY_FOR_APPROVAL');
    const continued = await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: next.structuredContent.proposalId,
      proposalHash: next.structuredContent.proposalHash,
      confirm: false,
      autopilotContinuation: true,
    });
    assert.equal(continued.structuredContent.continuation, true);
    assert.equal(continued.structuredContent.state, 'LOCKED');
    assert.equal(continued.structuredContent.release, nextVersion);
    assert.equal(continued.structuredContent.continuationDecision.decision, 'NOTIFY');
    assert.equal(continued.structuredContent.autopilot.profile, 'LOCAL_REVERSIBLE');
    assert.notEqual(continued.structuredContent.autopilot.hash, priorPolicy.hash);
    assert.equal(continued.structuredContent.autopilotState.currentRelease, nextVersion);
    assert.equal(continued.structuredContent.autopilotState.phase, 'TRAIN_READY');
    assert.equal(continued.structuredContent.released, false);
    await access(path.join(fixture.root, '.shipping', 'releases', '0.4.0-autopilot.json'));
  } finally {
    await fixture.cleanup();
  }
});
