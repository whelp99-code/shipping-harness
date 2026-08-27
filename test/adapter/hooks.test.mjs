import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { loadContract, lockContract } from '../../src/core/contract.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { addManualIssue } from '../../src/core/issues.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { pause, patchState, transitionState } from '../../src/core/state.mjs';
import { decideStop, ingestLifecycleEvent, sanitizeHookPayload } from '../../src/core/hooks.mjs';
import { verifyRelease } from '../../src/core/gate.mjs';

async function lockFixture(root) {
  const sha = currentGitSha(root);
  const { contract, lock } = await lockContract(root, sha);
  await transitionState(root, 'LOCKED', {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: sha,
  }, 'test lock');
}

test('Stop decision requires verification, then allows stop only when SHIPPABLE', async () => {
  const fixture = await createFixtureRepo();
  try {
    await lockFixture(fixture.root);
    const before = await decideStop(fixture.root, { adapter: 'omo', event: 'Stop', record: false });
    assert.equal(before.action, 'CONTINUE');
    assert.equal(before.reasonCode, 'VERIFICATION_OR_CLOSURE_REQUIRED');

    const verification = await verifyRelease(fixture.root);
    assert.equal(verification.decision, 'SHIPPABLE');
    const after = await decideStop(fixture.root, { adapter: 'omo', event: 'Stop', record: false });
    assert.equal(after.action, 'ALLOW_STOP');
    assert.equal(after.allowStop, true);
  } finally {
    await fixture.cleanup();
  }
});

test('human pause overrides release blockers and continuation pressure', async () => {
  const fixture = await createFixtureRepo();
  try {
    await lockFixture(fixture.root);
    await addManualIssue(fixture.root, {
      title: 'Fixture blocker',
      classification: 'BLOCKER',
      basisId: 'AC-001',
      evidenceRef: 'fixture:evidence',
    });
    await pause(fixture.root, 'operator stop');
    const decision = await decideStop(fixture.root, { adapter: 'omo', event: 'Stop', record: false });
    assert.equal(decision.action, 'DENY_CONTINUATION');
    assert.equal(decision.reasonCode, 'HUMAN_STOP_WINS');
    assert.equal(decision.continue, false);
  } finally {
    await fixture.cleanup();
  }
});

test('exhausted fix budget denies continuation with blockers remaining', async () => {
  const fixture = await createFixtureRepo();
  try {
    await lockFixture(fixture.root);
    await addManualIssue(fixture.root, {
      title: 'Persistent fixture blocker',
      classification: 'BLOCKER',
      basisId: 'AC-001',
      evidenceRef: 'fixture:evidence',
    });
    const contract = await loadContract(runtimePaths(fixture.root).contract);
    await patchState(fixture.root, { fixCycles: contract.budgets.maxFixCycles }, 'exhaust test budget');
    const decision = await decideStop(fixture.root, { adapter: 'omo', event: 'SubagentStop', record: false });
    assert.equal(decision.action, 'DENY_CONTINUATION');
    assert.equal(decision.reasonCode, 'EXECUTION_BUDGET_EXHAUSTED');
  } finally {
    await fixture.cleanup();
  }
});

test('hook ingestion redacts sensitive values before writing the audit stream', async () => {
  const fixture = await createFixtureRepo();
  try {
    await lockFixture(fixture.root);
    const payload = {
      token: 'super-secret-token-value',
      nested: { message: 'api_key=abcdefghijklmnopqrstuvwxyz' },
      ordinary: 'safe',
    };
    const sanitized = sanitizeHookPayload(payload);
    assert.equal(sanitized.token, '[REDACTED]');
    assert.equal(sanitized.ordinary, 'safe');
    await ingestLifecycleEvent(fixture.root, {
      adapter: 'omo',
      event: 'PreToolUse',
      runId: 'fixture-run',
      payload,
    });
    const stream = await readFile(runtimePaths(fixture.root).hooks, 'utf8');
    assert.equal(stream.includes('super-secret-token-value'), false);
    assert.equal(stream.includes('abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(stream.includes('[REDACTED]'), true);
  } finally {
    await fixture.cleanup();
  }
});