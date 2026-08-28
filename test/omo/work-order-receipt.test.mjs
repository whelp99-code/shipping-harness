import test from 'node:test';
import assert from 'node:assert/strict';
import { executePrivateOmoRuntime, loadOrCreateBridgeKey, validatePrivateOmoReceipt } from '../../packages/internal-omo-bridge/index.mjs';
import { createPrivateOmoWorkOrder } from '../../packages/internal-omo-bridge/work-order.mjs';
import { createOmoFixture } from './helpers.mjs';

test('signed work order and real OMO receipt bind contract, SHA, session, Goals, Tasks, acceptance, scope, and budgets', async () => {
  const fixture = await createOmoFixture();
  try {
    const key = await loadOrCreateBridgeKey(fixture.root, fixture.config);
    const order = await createPrivateOmoWorkOrder(fixture.root, { hmacKey: key.key, mode: 'probe' });
    assert.equal(order.schema, 'shipping-omo/v1');
    assert.equal(order.git_sha, fixture.locked.executionSha);
    assert.equal(order.shipping_state, 'LOCKED');
    assert.equal(order.budgets.parallel_workers, 2);
    assert.equal(order.budgets.agent_depth, 1);
    assert.equal(order.budgets.continuations, 3);
    assert.equal(order.budgets.fix_cycles, 2);
    assert.ok(order.goal_ids.length > 0);
    assert.ok(order.task_ids.length > 0);
    assert.deepEqual(order.acceptance_ids, ['AC-0708']);
    assert.ok(order.forbidden_paths.includes('.shipping/**'));
    const execution = await executePrivateOmoRuntime(fixture.root, { mode: 'probe' });
    assert.equal(execution.receipt.status, 'completed');
    assert.equal(execution.receipt.requires_shipping_verification, true);
    assert.equal(execution.receipt.shipping_finisher_authority, true);
    assert.equal(execution.receipt.terminal_replay_allowed, false);
    assert.equal(execution.receipt.releaseCompletionTrusted, false);
    assert.deepEqual(execution.receipt.changed_paths, []);
  } finally {
    await fixture.cleanup();
  }
});

test('tampered, stale, foreign-session, wrong-task, and over-budget receipts fail closed', async () => {
  const fixture = await createOmoFixture();
  try {
    const key = await loadOrCreateBridgeKey(fixture.root, fixture.config);
    const execution = await executePrivateOmoRuntime(fixture.root, { mode: 'probe' });
    const receipt = execution.receipt;
    for (const mutate of [
      (value) => ({ ...value, signature: '0'.repeat(64) }),
      (value) => ({ ...value, shipping_session_id: 'SESSION-FOREIGN' }),
      (value) => ({ ...value, shipping_task_ids: ['TASK-WRONG'] }),
      (value) => ({ ...value, source_git_sha: '0'.repeat(40) }),
      (value) => ({ ...value, usage: { ...value.usage, tool_calls: execution.order.budgets.tool_calls + 1 } }),
    ]) {
      assert.throws(
        () => validatePrivateOmoReceipt(fixture.root, mutate(receipt), { order: execution.order, hmacKey: key.key }),
        /receipt|signature|hash|binding|budget|session|task|Git SHA/iu,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});
