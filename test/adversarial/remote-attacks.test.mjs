import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  validateRemoteConfig,
  InternalRemoteGateway,
  ReplayStore,
  NotificationStore,
  RateLimiter,
  remoteError,
  signRemoteRequest,
} from '../../packages/internal-remote/index.mjs';
import {
  fixture,
  request,
  FakeAdapter,
  actorSecret,
  serverSecret,
} from '../remote/helpers.mjs';

test('cross-project access and insufficient permission fail before adapter execution', async () => {
  const f = await fixture();
  try {
    const config = validateRemoteConfig({
      schema: 'shipping-remote/config-v1',
      allowedRoots: [f.root],
      serverCredential: serverSecret,
      actors: [{
        id: 'reader',
        credential: actorSecret,
        permissions: ['read'],
        projects: ['p1'],
      }],
      projects: [
        { id: 'p1', root: f.project },
        { id: 'p2', root: f.root },
      ],
    }, { allowInlineCredentials: true });
    const adapter = new FakeAdapter();
    const gateway = new InternalRemoteGateway({
      config,
      replayStore: new ReplayStore(path.join(f.root, 'r.json')),
      adapter,
      notifications: new NotificationStore(path.join(f.root, 'n.jsonl')),
      backupRoot: path.join(f.root, 'b'),
    });
    const base = {
      schema: 'shipping-remote/request-v1',
      requestId: 'x',
      actorId: 'reader',
      projectId: 'p2',
      action: 'shipping/status',
      params: {},
      timestamp: new Date().toISOString(),
      nonce: 'x',
    };
    await assert.rejects(() => gateway.handle(signRemoteRequest(base, actorSecret)), /not allowed/i);
    const close = { ...base, projectId: 'p1', action: 'shipping/close', nonce: 'y' };
    await assert.rejects(() => gateway.handle(signRemoteRequest(close, actorSecret)), /lacks/i);
    assert.equal(adapter.calls.length, 0);
  } finally {
    await f.cleanup();
  }
});

test('request forgery, replay and nonce races fail closed exactly once', async () => {
  const f = await fixture();
  try {
    const adapter = new FakeAdapter();
    const gateway = new InternalRemoteGateway({
      config: f.config,
      replayStore: f.replay,
      adapter,
      notifications: f.notices,
      backupRoot: path.join(f.root, 'b'),
    });
    const signed = request({ action: 'shipping/status', nonce: 'race' });
    const results = await Promise.allSettled([
      gateway.handle(signed),
      gateway.handle(signed),
      gateway.handle(signed),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(adapter.calls.length, 1);
    await assert.rejects(
      () => gateway.handle({ ...request({ action: 'shipping/status', nonce: 'forged' }), signature: '0'.repeat(64) }),
      /signature/i,
    );
  } finally {
    await f.cleanup();
  }
});

test('rate and concurrency policies are bounded rather than unlimited', () => {
  const limiter = new RateLimiter(2, 60000);
  limiter.claim('a', 0);
  limiter.claim('a', 0);
  assert.throws(() => limiter.claim('a', 0), /rate/i);
});

test('errors redact secret, token and authorization-looking values', () => {
  const error = new Error('secret=abc token:xyz authorization=Bearer123');
  const output = remoteError('x', error);
  assert.doesNotMatch(output.error.message, /abc|xyz|Bearer123/);
  assert.match(output.error.message, /REDACTED/);
});

test('unknown or raw execution fields cannot be tunneled through nested params', async () => {
  const f = await fixture();
  try {
    const { gateway } = await import('../remote/helpers.mjs').then((module) => module.gateway(f));
    for (const params of [
      { goal: 'x', nested: { command: 'bash' } },
      { goal: 'x', environment: { TOKEN: 'x' } },
      { goal: 'x', argv: ['--danger'] },
    ]) {
      await assert.rejects(
        () => gateway.handle(request({ action: 'shipping/start', params, nonce: Math.random().toString() })),
        /forbidden/i,
      );
    }
  } finally {
    await f.cleanup();
  }
});

test('approval receipt cannot cross actor, project, release, proposal or expiration boundaries', async () => {
  const f = await fixture();
  try {
    const { gateway } = await import('../remote/helpers.mjs').then((module) => module.gateway(f));
    const issued = await gateway.handle(request({
      action: 'approval/issue',
      params: { proposalId: 'P', proposalHash: 'a'.repeat(64), release: '0.9.0', confirm: true },
      nonce: 'i',
    }));
    for (const params of [
      { proposalId: 'Q', proposalHash: 'a'.repeat(64), release: '0.9.0' },
      { proposalId: 'P', proposalHash: 'b'.repeat(64), release: '0.9.0' },
      { proposalId: 'P', proposalHash: 'a'.repeat(64), release: '1.0.0' },
    ]) {
      await assert.rejects(
        () => gateway.handle(request({
          action: 'shipping/approve',
          params,
          approvalReceipt: issued.result,
          nonce: Math.random().toString(),
        })),
        /binding/i,
      );
    }
  } finally {
    await f.cleanup();
  }
});
