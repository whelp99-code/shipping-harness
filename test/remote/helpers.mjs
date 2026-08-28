import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import {
  signRemoteRequest,
  validateRemoteConfig,
  ReplayStore,
  NotificationStore,
  InternalRemoteGateway,
} from '../../packages/internal-remote/index.mjs';

export const actorSecret = 'actor-test-credential-0123456789abcdef';
export const serverSecret = 'server-test-credential-0123456789abcdef0123456789';
export const fixtureGitSha = 'a'.repeat(40);

export async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-remote-test-'));
  const project = path.join(root, 'project');
  await mkdir(path.join(project, '.shipping', 'releases'), { recursive: true });
  await writeFile(path.join(project, '.shipping', 'state.json'), `${JSON.stringify({ state: 'CLOSED', release: '0.9.0' })}\n`);
  await writeFile(path.join(project, '.shipping', 'contract.yaml'), `${JSON.stringify({ release: '0.9.0' })}\n`);
  await writeFile(path.join(project, '.shipping', 'ledger.jsonl'), '');

  const config = validateRemoteConfig({
    schema: 'shipping-remote/config-v1',
    allowedRoots: [root],
    serverCredential: serverSecret,
    actors: [{
      id: 'owner',
      credential: actorSecret,
      permissions: ['read', 'write', 'approve', 'control', 'close', 'admin'],
      projects: ['p1'],
    }],
    projects: [{ id: 'p1', root: project }],
    ratePerMinute: 100,
  }, { allowInlineCredentials: true });

  const replay = new ReplayStore(path.join(root, 'remote', 'replay.json'));
  const notices = new NotificationStore(path.join(root, 'remote', 'notifications.jsonl'));
  return {
    root,
    project,
    config,
    replay,
    notices,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function request({
  action,
  params = {},
  nonce = `n-${Math.random()}`,
  projectId = 'p1',
  actorId = 'owner',
  timestamp = new Date().toISOString(),
  approvalReceipt,
}) {
  const unsigned = {
    schema: 'shipping-remote/request-v1',
    requestId: `r-${Math.random()}`,
    actorId,
    projectId,
    action,
    params,
    timestamp,
    nonce,
    ...(approvalReceipt ? { approvalReceipt } : {}),
  };
  return signRemoteRequest(unsigned, actorSecret);
}

export class FakeAdapter {
  constructor() {
    this.calls = [];
    this.state = 'LOCKED';
  }

  async call(projectId, action, params) {
    this.calls.push({ projectId, action, params });
    if (action === 'shipping/status') {
      return {
        state: { state: this.state, release: '0.9.0' },
        contract: { release: '0.9.0' },
        git: { sha: fixtureGitSha },
        issues: { counts: { BLOCKER: 0 } },
        evidenceFresh: true,
      };
    }
    if (action === 'shipping/approve') {
      return { state: { state: 'LOCKED', release: '0.9.0' }, proposalId: params.proposalId };
    }
    if (action === 'shipping/pause') {
      this.state = 'PAUSED';
      return { state: { state: 'PAUSED', release: '0.9.0' } };
    }
    if (action === 'shipping/resume') {
      this.state = 'LOCKED';
      return { state: { state: 'LOCKED', release: '0.9.0' } };
    }
    if (action === 'shipping/close') {
      this.state = 'CLOSED';
      return { state: { state: 'CLOSED', release: '0.9.0' }, contract: { release: '0.9.0' } };
    }
    return { state: { state: this.state, release: '0.9.0' }, result: 'ok' };
  }
}

export function gateway(fixtureState, adapter = new FakeAdapter()) {
  return {
    adapter,
    gateway: new InternalRemoteGateway({
      config: fixtureState.config,
      replayStore: fixtureState.replay,
      adapter,
      notifications: fixtureState.notices,
      backupRoot: path.join(fixtureState.root, 'backups'),
    }),
  };
}
