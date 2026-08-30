import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import {
  autopilotStatus,
  createAutopilotMutationReceipt,
  evaluateAutopilotAction,
  loadAutopilotPolicy,
  loadAutopilotState,
  readAutopilotLedger,
  setAutopilotHumanControl,
  verifyAutopilotMutationReceipt,
} from '../../src/core/autopilot.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function activatedFixture() {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  await writeFile(path.join(fixture.root, 'Makefile'), `e2e:\n\t@node -e "process.stdout.write('e2e-pass')"\n`, 'utf8');
  await fixture.commit('fixture: add e2e');
  const started = await callShippingTool(fixture.root, 'shipping_start', {
    goal: 'Deliver one useful local workflow with recovery evidence.',
    release: '0.6.0',
  });
  await callShippingTool(fixture.root, 'shipping_approve_scope', {
    proposalId: started.structuredContent.proposalId,
    proposalHash: started.structuredContent.proposalHash,
    confirm: true,
    autopilotProfile: 'LOCAL_REVERSIBLE',
    confirmAutopilot: true,
  });
  return { fixture, started };
}

test('duplicate policy decisions are idempotent and do not append duplicate mutation events', async () => {
  const { fixture } = await activatedFixture();
  try {
    const before = await readAutopilotLedger(fixture.root);
    const first = await evaluateAutopilotAction(fixture.root, {
      action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true,
      statePatch: { phase: 'IMPLEMENTING' },
    });
    const second = await evaluateAutopilotAction(fixture.root, {
      action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true,
      statePatch: { phase: 'IMPLEMENTING' },
    });
    const after = await readAutopilotLedger(fixture.root);
    assert.equal(first.recorded.duplicate, false);
    assert.equal(second.recorded.duplicate, true);
    assert.equal(after.length, before.length + 1);
    assert.equal(second.recorded.state.hash, first.recorded.state.hash);
  } finally {
    await fixture.cleanup();
  }
});

test('state and append-only ledger survive independent reads and fail closed on corruption or partial replay', async () => {
  const { fixture } = await activatedFixture();
  try {
    await evaluateAutopilotAction(fixture.root, {
      action: 'VERIFY', effects: ['LOCAL_READ'], rollbackAvailable: true, exactScope: true, localOnly: true,
      statePatch: { phase: 'VERIFYING' },
    });
    const first = await autopilotStatus(fixture.root);
    const second = await autopilotStatus(fixture.root);
    assert.deepEqual(first, second);
    assert.ok(first.eventCount >= 2);

    const statePath = fixture.paths.autopilotState;
    const originalState = await readFile(statePath, 'utf8');
    const tamperedState = JSON.parse(originalState);
    tamperedState.phase = 'TRAIN_COMPLETE';
    await writeFile(statePath, `${JSON.stringify(tamperedState, null, 2)}\n`, 'utf8');
    await assert.rejects(() => autopilotStatus(fixture.root), (error) => error?.code === 'ERR_AUTOPILOT_STATE_HASH');
    await writeFile(statePath, originalState, 'utf8');

    const ledgerPath = fixture.paths.autopilotLedger;
    const originalLedger = await readFile(ledgerPath, 'utf8');
    await appendFile(ledgerPath, `${JSON.stringify({ schema: 'shipping-harness/autopilot-event-v1', sequence: 999, hash: '0'.repeat(64) })}\n`);
    await assert.rejects(() => autopilotStatus(fixture.root));
    await writeFile(ledgerPath, originalLedger, 'utf8');
    assert.equal((await autopilotStatus(fixture.root)).bindingCurrent, true);
  } finally {
    await fixture.cleanup();
  }
});

test('human pause and abort outrank automatic continuation and remain durable', async () => {
  const { fixture } = await activatedFixture();
  try {
    const implementing = await evaluateAutopilotAction(fixture.root, {
      action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true,
      statePatch: { phase: 'IMPLEMENTING' },
    });
    assert.equal(implementing.recorded.state.phase, 'IMPLEMENTING');

    const paused = await setAutopilotHumanControl(fixture.root, 'pause', 'operator pause');
    assert.equal(paused.state.phase, 'PAUSED');
    assert.equal(paused.state.resumePhase, 'IMPLEMENTING');
    const blocked = await evaluateAutopilotAction(fixture.root, {
      action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true, humanStop: true,
    });
    assert.equal(blocked.decision.decision, 'STOP');
    assert.equal(blocked.decision.code, 'HUMAN_STOP');

    const resumed = await setAutopilotHumanControl(fixture.root, 'resume', 'operator resume');
    assert.equal(resumed.state.phase, 'IMPLEMENTING');
    const aborted = await setAutopilotHumanControl(fixture.root, 'abort', 'operator abort');
    assert.equal(aborted.state.phase, 'ABORTED');
    await assert.rejects(() => evaluateAutopilotAction(fixture.root, {
      action: 'VERIFY', effects: ['LOCAL_READ'], rollbackAvailable: true, exactScope: true, localOnly: true,
    }), (error) => error?.code === 'ERR_AUTOPILOT_TERMINAL');
  } finally {
    await fixture.cleanup();
  }
});

test('exact mutation receipt binds policy, Git SHA, paths, rollback, and expiry without mutating Git', async () => {
  const { fixture } = await activatedFixture();
  try {
    const policy = await loadAutopilotPolicy(fixture.root);
    const beforeStatus = await fixture.read('.gitignore');
    const receipt = await createAutopilotMutationReceipt(fixture.root, {
      action: 'LOCAL_COMMIT',
      paths: ['README.md'],
      purpose: 'Preserve the exact reviewed local baseline.',
      rollbackRef: 'Previous committed Git baseline.',
    });
    assert.equal(receipt.decision.decision, 'NOTIFY');
    assert.equal(receipt.receipt.released, false);
    assert.deepEqual(receipt.receipt.paths, ['README.md']);
    assert.equal(verifyAutopilotMutationReceipt(receipt.receipt, {
      paths: ['README.md'],
      baseGitSha: receipt.receipt.baseGitSha,
      policyHash: policy.hash,
    }).valid, true);
    assert.equal(await fixture.read('.gitignore'), beforeStatus);
    const state = await loadAutopilotState(fixture.root);
    assert.equal(state.released, false);
  } finally {
    await fixture.cleanup();
  }
});

test('autopilot status fails closed when the policy binding no longer matches the locked contract', async () => {
  const { fixture } = await activatedFixture();
  try {
    const policyPath = fixture.paths.autopilotPolicy;
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.binding.contractHash = 'f'.repeat(64);
    const { hash: _hash, ...body } = policy;
    const { hashObject } = await import('../../src/core/crypto.mjs');
    policy.hash = hashObject(body);
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
    const stale = await autopilotStatus(fixture.root);
    assert.equal(stale.bindingCurrent, false);
    assert.equal(stale.bindingReason, 'BINDING_MISMATCH');

    policy.hash = '0'.repeat(64);
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
    await assert.rejects(() => autopilotStatus(fixture.root), (error) => error?.code === 'ERR_AUTOPILOT_POLICY_HASH');
  } finally {
    await fixture.cleanup();
  }
});
