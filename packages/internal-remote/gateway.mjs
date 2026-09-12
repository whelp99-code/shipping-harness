import path from 'node:path';
import { issueApprovalReceipt, validateApprovalReceipt } from './approval.mjs';
import { createBackup, restoreBackup } from './backup.mjs';
import { validateRemoteRequest } from './request.mjs';
import { boundedInteger, invariant, pathWithin } from './policy.mjs';
import { currentGitSha } from '../../src/core/git.mjs';

const ACTION_PARAMS = Object.freeze({
  'shipping/status': [],
  'shipping/start': ['goal', 'release', 'projectName', 'mode'],
  'shipping/execute': [],
  'shipping/pause': ['reason'],
  'shipping/resume': ['reason'],
  'shipping/abort': ['reason'],
  'shipping/fix-blockers': [],
  'shipping/verify': [],
  'shipping/close': [],
  'evidence/summary': [],
});

export class RateLimiter {
  constructor(limit = 30, windowMs = 60000) {
    this.limit = boundedInteger(limit, 'rate limit', { min: 1, max: 10000 });
    this.windowMs = boundedInteger(windowMs, 'rate window', { min: 1000, max: 24 * 60 * 60 * 1000 });
    this.entries = new Map();
  }

  claim(actorId, now = Date.now()) {
    const current = this.entries.get(actorId);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.entries.set(actorId, { startedAt: now, count: 1 });
      return true;
    }
    invariant(current.count < this.limit, 'ERR_REMOTE_RATE', 'Remote rate limit exceeded');
    current.count += 1;
    return true;
  }
}

function boundedParams(params, allowed) {
  invariant(params === undefined || (params && typeof params === 'object' && !Array.isArray(params)), 'ERR_REMOTE_ARGUMENT', 'Action params must be an object');
  const value = params ?? {};
  for (const key of Object.keys(value)) {
    invariant(allowed.includes(key), 'ERR_REMOTE_ARGUMENT', `Unknown action parameter: ${key}`);
  }
  return value;
}

function extractRelease(status) {
  return status?.contract?.release ?? status?.state?.release ?? status?.release ?? null;
}

function extractGitSha(status) {
  return status?.git?.sha ?? status?.gitSha ?? status?.sourceGitSha ?? null;
}

function extractState(status) {
  return status?.state?.state ?? status?.state ?? null;
}

function notificationFor(result) {
  const state = extractState(result);
  const blockers = result?.issues?.counts?.BLOCKER ?? result?.blockers ?? null;
  if (state === 'BLOCKED' || (Number.isInteger(blockers) && blockers > 0)) {
    return { type: 'BLOCKED', state, blockers };
  }
  if (state === 'PAUSED') return { type: 'PAUSED', state };
  if (state === 'CLOSED') return { type: 'CLOSED', state, release: extractRelease(result) };
  return null;
}

export class InternalRemoteGateway {
  /**
   * @param {{config: Record<string, any>, replayStore: any, adapter: any, notifications: any, backupRoot: string, rateLimiter?: any}} options
   */
  constructor({ config, replayStore, adapter, notifications, backupRoot, rateLimiter }) {
    invariant(config && replayStore && adapter && notifications, 'ERR_REMOTE_CONFIG', 'Gateway dependencies are required');
    this.config = config;
    this.replayStore = replayStore;
    this.adapter = adapter;
    this.notifications = notifications;
    this.backupRoot = path.resolve(backupRoot);
    this.rateLimiter = rateLimiter ?? new RateLimiter(config.ratePerMinute);
  }

  async #status(projectId) {
    return this.adapter.call(projectId, 'shipping/status', {});
  }

  async #issueApproval(raw, params, now) {
    boundedParams(params, ['proposalId', 'proposalHash', 'release', 'confirm']);
    invariant(params.confirm === true, 'ERR_REMOTE_APPROVAL', 'Explicit approval confirmation is required');
    const status = await this.#status(raw.projectId);
    const release = extractRelease(status) ?? params.release;
    const gitSha = extractGitSha(status) ?? currentGitSha(this.config.projects[raw.projectId].root);
    invariant(release && params.release === release, 'ERR_REMOTE_APPROVAL', 'Approval release does not match the current project release');
    invariant(typeof gitSha === 'string' && /^[a-f0-9]{40}$/u.test(gitSha), 'ERR_REMOTE_APPROVAL', 'Current project Git SHA is unavailable');
    return issueApprovalReceipt({
      requestId: raw.requestId,
      actorId: raw.actorId,
      projectId: raw.projectId,
      release,
      proposalId: params.proposalId,
      proposalHash: params.proposalHash,
      gitSha,
      requestNonce: raw.nonce,
      serverCredential: this.config.serverCredential,
      now,
      ttlMs: this.config.approvalTtlMs,
    });
  }

  async #approve(raw, params, now) {
    boundedParams(params, ['proposalId', 'proposalHash', 'release']);
    const status = await this.#status(raw.projectId);
    const gitSha = extractGitSha(status) ?? currentGitSha(this.config.projects[raw.projectId].root);
    const release = extractRelease(status) ?? params.release;
    invariant(params.release === release, 'ERR_REMOTE_APPROVAL', 'Approval receipt release binding mismatch');
    const receipt = validateApprovalReceipt(raw.approvalReceipt, {
      actorId: raw.actorId,
      projectId: raw.projectId,
      release,
      proposalId: params.proposalId,
      proposalHash: params.proposalHash,
      gitSha,
      serverCredential: this.config.serverCredential,
      now,
    });
    const expiresAt = Date.parse(receipt.expiresAt);
    await this.replayStore.claimKey(`approval:${receipt.receiptId}`, {
      now,
      ttlMs: Math.max(1000, expiresAt - now),
      metadata: { type: 'approval', actorId: raw.actorId, projectId: raw.projectId },
    });
    return this.adapter.call(raw.projectId, raw.action, params);
  }

  async #backupCreate(raw, params) {
    boundedParams(params, []);
    const project = this.config.projects[raw.projectId];
    const projectBackupRoot = path.join(this.backupRoot, raw.projectId);
    const outputPath = path.join(projectBackupRoot, `backup-${Date.now()}.json`);
    const extraEvidenceFiles = [
      ...(project.omoRuntimeManifest ? [{ source: project.omoRuntimeManifest, logicalPath: 'omo/runtime-manifest.json' }] : []),
      ...project.runtimePinFiles.map((source, index) => ({ source, logicalPath: `runtime-pins/pin-${index + 1}.json` })),
    ];
    return createBackup({
      projectId: raw.projectId,
      projectRoot: project.root,
      serverSecret: this.config.serverCredential,
      outputPath,
      extraEvidenceFiles,
    });
  }

  async #backupRestore(raw, params) {
    boundedParams(params, ['bundlePath']);
    invariant(typeof params.bundlePath === 'string', 'ERR_BACKUP_PATH', 'Restore bundle path is required');
    const project = this.config.projects[raw.projectId];
    const projectBackupRoot = path.join(this.backupRoot, raw.projectId);
    const bundlePath = path.resolve(params.bundlePath);
    invariant(pathWithin(projectBackupRoot, bundlePath), 'ERR_BACKUP_PATH', 'Restore bundle is outside the project backup root');
    return restoreBackup({
      projectId: raw.projectId,
      projectRoot: project.root,
      serverSecret: this.config.serverCredential,
      bundlePath,
    });
  }

  async #fixedAction(raw, params) {
    const allowed = ACTION_PARAMS[raw.action];
    invariant(allowed, 'ERR_REMOTE_ACTION', 'Action is not exposed by the internal gateway');
    boundedParams(params, allowed);
    if (raw.action === 'shipping/resume' || raw.action === 'shipping/execute') {
      const status = await this.#status(raw.projectId);
      invariant(status?.state?.humanStop !== true, 'ERR_HUMAN_STOP', 'Local human stop denies remote resume or execution');
    }
    return this.adapter.call(raw.projectId, raw.action, params);
  }

  async #notify(raw, result) {
    const event = notificationFor(result);
    if (!event) return { attempted: false, delivered: false };
    try {
      const notice = await this.notifications.append({
        projectId: raw.projectId,
        actorId: raw.actorId,
        ...event,
      });
      return { attempted: true, delivered: true, id: notice.id };
    } catch (error) {
      return { attempted: true, delivered: false, errorCode: error?.code ?? 'ERR_NOTIFICATION_DELIVERY' };
    }
  }

  async handle(raw, { now = Date.now() } = {}) {
    const verified = validateRemoteRequest(raw, this.config, { now });
    this.rateLimiter.claim(verified.actor.id, now);
    await this.replayStore.claim(verified.actor.id, raw.nonce, now);
    const params = raw.params ?? {};

    let result;
    if (raw.action === 'projects/list') {
      boundedParams(params, []);
      result = verified.actor.projects.map((projectId) => ({
        id: projectId,
        root: this.config.projects[projectId].root,
      }));
    } else if (raw.action === 'approval/issue') {
      result = await this.#issueApproval(raw, params, now);
    } else if (raw.action === 'shipping/approve') {
      result = await this.#approve(raw, params, now);
    } else if (raw.action === 'notifications/list') {
      boundedParams(params, ['afterId', 'limit']);
      const limit = params.limit === undefined ? 50 : boundedInteger(params.limit, 'notification limit', { min: 1, max: 100 });
      result = await this.notifications.list({ projectId: raw.projectId, afterId: params.afterId, limit });
    } else if (raw.action === 'backup/create') {
      result = await this.#backupCreate(raw, params);
    } else if (raw.action === 'backup/restore') {
      result = await this.#backupRestore(raw, params);
    } else if (raw.action === 'health/read') {
      boundedParams(params, []);
      result = { status: 'healthy', internalOnly: true, tlsRequired: true, publicListener: false, arbitraryShell: false };
    } else {
      result = await this.#fixedAction(raw, params);
    }

    const notification = await this.#notify(raw, result);
    return {
      schema: 'shipping-remote/response-v1',
      requestId: raw.requestId,
      ok: true,
      result,
      notification,
    };
  }
}

export function remoteError(requestId, error) {
  return {
    schema: 'shipping-remote/response-v1',
    requestId: typeof requestId === 'string' ? requestId : 'unknown',
    ok: false,
    error: {
      code: error?.code ?? 'ERR_REMOTE_INTERNAL',
      message: String(error?.message ?? 'Internal remote error')
        .replace(/(secret|token|authorization|credential)\s*[:=]\s*\S+/giu, '$1=[REDACTED]'),
    },
  };
}
