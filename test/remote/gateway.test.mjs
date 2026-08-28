import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { NotificationStore } from '../../packages/internal-remote/index.mjs';
import { fixture, request, gateway } from './helpers.mjs';

test('replay protection is durable and permissioned actions route only to fixed Shipping tools', async () => {
  const f = await fixture();
  try {
    const { gateway: internal, adapter } = gateway(f);
    const signed = request({ action: 'shipping/status', nonce: 'same' });
    const first = await internal.handle(signed);
    assert.equal(first.ok, true);
    await assert.rejects(() => internal.handle(signed), /nonce|already/i);
    assert.equal(adapter.calls[0].action, 'shipping/status');
  } finally {
    await f.cleanup();
  }
});

test('proposal-bound approval receipt is required and cannot be reused for another proposal', async () => {
  const f = await fixture();
  try {
    const { gateway: internal, adapter } = gateway(f);
    const issue = await internal.handle(request({
      action: 'approval/issue',
      params: { proposalId: 'P1', proposalHash: 'a'.repeat(64), release: '0.9.0', confirm: true },
      nonce: 'issue',
    }));
    const receipt = issue.result;
    await internal.handle(request({
      action: 'shipping/approve',
      params: { proposalId: 'P1', proposalHash: 'a'.repeat(64), release: '0.9.0' },
      approvalReceipt: receipt,
      nonce: 'approve',
    }));
    assert.equal(adapter.calls.at(-1).action, 'shipping/approve');
    await assert.rejects(
      () => internal.handle(request({
        action: 'shipping/approve',
        params: { proposalId: 'P2', proposalHash: 'a'.repeat(64), release: '0.9.0' },
        approvalReceipt: receipt,
        nonce: 'bad',
      })),
      /binding/i,
    );
  } finally {
    await f.cleanup();
  }
});

test('equivalent blocker or closed outcomes are deduplicated', async () => {
  const f = await fixture();
  try {
    const { gateway: internal } = gateway(f);
    const first = await internal.handle(request({ action: 'shipping/close', nonce: 'close-one' }));
    const second = await internal.handle(request({ action: 'shipping/close', nonce: 'close-two' }));
    assert.equal(first.notification.delivered, true);
    assert.equal(second.notification.delivered, true);
    assert.equal(second.notification.id, first.notification.id);
    const list = await internal.handle(request({ action: 'notifications/list', params: { limit: 10 }, nonce: 'list' }));
    assert.equal(list.result.length, 1);
    assert.equal(list.result[0].type, 'CLOSED');
    assert.equal(list.result[0].projectId, 'p1');
    assert.equal(typeof list.result[0].dedupeKey, 'string');
  } finally {
    await f.cleanup();
  }
});

test('notification storage retains only the configured maximum', async () => {
  const f = await fixture();
  try {
    const store = new NotificationStore(path.join(f.root, 'bounded-notifications.jsonl'), {
      maxEntries: 2,
      dedupeWindowMs: 1000,
    });
    for (const [index, type] of ['FIRST', 'SECOND', 'THIRD'].entries()) {
      await store.append({ projectId: 'p1', actorId: 'owner', type }, { now: 1000 + index * 2000 });
    }
    const items = await store.list({ projectId: 'p1', limit: 10 });
    assert.deepEqual(items.map((item) => item.type), ['SECOND', 'THIRD']);
  } finally {
    await f.cleanup();
  }
});
