import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeShippingPrivateOmo, privateOmoFallbackDecision } from '../../packages/internal-omo-bridge/index.mjs';
import { loadContract } from '../../src/core/contract.mjs';
import { pause, readState } from '../../src/core/state.mjs';
import { createOmoFixture, privateOmoRuntimeAvailability } from './helpers.mjs';

const runtime = privateOmoRuntimeAvailability();
const skip = runtime.available ? {} : { skip: 'private OMO runtime is not installed at the pinned path' };

test('runtime completion is only an execution claim until Shipping verification runs', skip, async () => {
  const fixture = await createOmoFixture();
  try {
    const result = await executeShippingPrivateOmo(fixture.root, { mode: 'probe', verifyAfter: false });
    assert.equal(result.mode, 'private-omo');
    assert.equal(result.execution.receipt.status, 'completed');
    assert.equal(result.execution.receipt.releaseCompletionTrusted, false);
    assert.equal(result.verification, null);
    const state = await readState(fixture.root);
    assert.equal(state.state, 'VERIFYING');
    assert.equal(state.blockerCount, 0);
    assert.ok(state.lastPrivateOmoReceiptHash);
  } finally {
    await fixture.cleanup();
  }
});

test('human pause denies private OMO execution before a child can start', async () => {
  const fixture = await createOmoFixture();
  try {
    await pause(fixture.root, 'operator stop');
    await assert.rejects(() => executeShippingPrivateOmo(fixture.root, { mode: 'probe' }), /pause|human stop|denies/iu);
    assert.equal((await readState(fixture.root)).state, 'PAUSED');
  } finally {
    await fixture.cleanup();
  }
});

test('unavailable private OMO uses an explicitly configured fallback', async () => {
  const fixture = await createOmoFixture({ configureFallback: true, breakRuntime: true });
  try {
    const contract = await loadContract(fixture.paths.contract);
    assert.deepEqual(privateOmoFallbackDecision(contract), { mode: 'approved-fallback', adapter: 'generic' });
    const result = await executeShippingPrivateOmo(fixture.root, { verifyAfter: false });
    assert.equal(result.mode, 'approved-fallback');
    assert.equal(result.fallback, 'generic');
    assert.equal(result.adapterRun.result.exitCode, 0);
    assert.equal(result.adapterRun.result.timedOut, false);
    assert.equal(result.adapterRun.result.outputLimitExceeded, false);
    assert.equal((await readState(fixture.root)).state, 'VERIFYING');
  } finally {
    await fixture.cleanup();
  }
});

test('unavailable private OMO without an approved fallback becomes durable BLOCKED', async () => {
  const fixture = await createOmoFixture({ breakRuntime: true });
  try {
    const result = await executeShippingPrivateOmo(fixture.root, { verifyAfter: false });
    assert.equal(result.mode, 'blocked');
    assert.equal(result.state.state, 'BLOCKED');
    const state = await readState(fixture.root);
    assert.equal(state.state, 'BLOCKED');
    const issues = JSON.parse(await readFile(fixture.paths.issues, 'utf8'));
    assert.equal(issues.counts.BLOCKER, 1);
    assert.match(issues.issues[0].title, /unavailable/iu);
  } finally {
    await fixture.cleanup();
  }
});
