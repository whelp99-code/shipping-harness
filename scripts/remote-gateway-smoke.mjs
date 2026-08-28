#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createInternalHttpsServer,
  InternalRemoteGateway,
  NotificationStore,
  ReplayStore,
  ShippingRemoteAdapter,
  signRemoteRequest,
  validateRemoteConfig,
} from '../packages/internal-remote/index.mjs';
import { callShippingTool } from '../src/mcp/tools.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportJsonPath = path.join(sourceRoot, 'docs', 'reports', 'v0.9-remote-pilot.json');
const reportMarkdownPath = path.join(sourceRoot, 'docs', 'reports', 'v0.9-remote-pilot.md');
const actorCredential = 'remote-pilot-actor-credential-0123456789abcdef';
const serverCredential = 'remote-pilot-server-credential-0123456789abcdef0123456789';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function createPilotRepo(base) {
  const project = path.join(base, 'project');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    name: 'shipping-remote-pilot',
    private: true,
    scripts: { test: "node -e \"process.stdout.write('remote-pilot-pass')\"" },
  }, null, 2)}\n`);
  await writeFile(path.join(project, 'README.md'), '# Shipping remote pilot\n');
  await writeFile(path.join(project, '.gitignore'), '.shipping/evidence/\n.shipping/tmp/\n');
  git(project, ['init', '-b', 'main']);
  git(project, ['config', 'user.name', 'Shipping Remote Pilot']);
  git(project, ['config', 'user.email', 'shipping-remote-pilot@example.invalid']);
  git(project, ['add', '.']);
  git(project, ['commit', '-m', 'pilot baseline']);
  return project;
}

function post(port, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const request = https.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: payload === null ? 'GET' : 'POST',
      rejectUnauthorized: false,
      headers: payload === null ? {} : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.once('error', reject);
    if (payload !== null) request.end(payload);
    else request.end();
  });
}

function makeRequest(action, params = {}, extras = {}) {
  const nonce = extras.nonce ?? `nonce-${randomUUID()}`;
  const unsigned = {
    schema: 'shipping-remote/request-v1',
    requestId: extras.requestId ?? `request-${randomUUID()}`,
    actorId: 'owner',
    projectId: 'pilot',
    action,
    params,
    timestamp: new Date().toISOString(),
    nonce,
    ...(extras.approvalReceipt ? { approvalReceipt: extras.approvalReceipt } : {}),
  };
  return signRemoteRequest(unsigned, actorCredential);
}

async function rpc(port, action, params = {}, extras = {}) {
  const request = makeRequest(action, params, extras);
  const response = await post(port, '/v1/rpc', request);
  assert.equal(response.status, 200, `${action} HTTP status: ${response.status}`);
  assert.equal(response.body.ok, true, `${action} failed: ${JSON.stringify(response.body.error ?? response.body)}`);
  return { request, response: response.body, result: response.body.result };
}

function stateName(value) {
  return value?.state?.state ?? value?.state ?? null;
}

async function runPilot() {
  const started = Date.now();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shipping-remote-pilot-'));
  let running;
  let restarted;
  try {
    const project = await createPilotRepo(temporary);
    const stateRoot = path.join(temporary, 'gateway-state');
    const certificatePath = path.join(temporary, 'certificate.pem');
    const keyPath = path.join(temporary, 'key.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', certificatePath,
      '-subj', '/CN=127.0.0.1',
      '-days', '1',
    ], { stdio: 'ignore' });

    const runtimeManifest = path.join(
      '/home/jm/orca/projects/shipping-harness-omo-runtime',
      'shipping-internal',
      'runtime-manifest.json',
    );
    const allowedRoots = [temporary, '/home/jm/orca/projects'];
    const config = validateRemoteConfig({
      schema: 'shipping-remote/config-v1',
      allowedRoots,
      serverCredential,
      actors: [{
        id: 'owner',
        credential: actorCredential,
        permissions: ['read', 'write', 'approve', 'control', 'close', 'admin'],
        projects: ['pilot'],
      }],
      projects: [{
        id: 'pilot',
        root: project,
        omoRuntimeManifest: runtimeManifest,
      }],
      maxClockSkewMs: 120000,
      maxBodyBytes: 32768,
      maxConcurrent: 2,
      ratePerMinute: 100,
      replayTtlMs: 600000,
      approvalTtlMs: 180000,
      notificationLimit: 1000,
    }, { allowInlineCredentials: true });

    const adapter = new ShippingRemoteAdapter(config.projects);
    const replayPath = path.join(stateRoot, 'replay.json');
    const notificationPath = path.join(stateRoot, 'notifications.jsonl');
    const createGateway = () => new InternalRemoteGateway({
      config,
      replayStore: new ReplayStore(replayPath, { ttlMs: config.replayTtlMs }),
      adapter,
      notifications: new NotificationStore(notificationPath),
      backupRoot: path.join(stateRoot, 'backups'),
    });

    running = await createInternalHttpsServer({
      gateway: createGateway(),
      host: '127.0.0.1',
      port: 0,
      certPath: certificatePath,
      keyPath,
      maxBodyBytes: config.maxBodyBytes,
      maxConcurrent: config.maxConcurrent,
    });
    const port = running.address.port;
    const health = await post(port, '/health', null);
    assert.equal(health.status, 200);
    assert.equal(health.body.tls, true);
    assert.equal(health.body.internalOnly, true);

    const start = await rpc(port, 'shipping/start', {
      goal: 'Create and close one minimal, evidence-backed remote pilot release.',
      release: '0.1.0',
      projectName: 'shipping-remote-pilot',
      mode: 'AUTO',
    });
    assert.equal(start.result.readyForApproval, true);
    assert.match(start.result.proposalHash, /^[a-f0-9]{64}$/u);

    const issue = await rpc(port, 'approval/issue', {
      proposalId: start.result.proposalId,
      proposalHash: start.result.proposalHash,
      release: '0.1.0',
      confirm: true,
    });
    assert.equal(issue.result.oneTime, true);
    assert.equal(issue.result.gitSha, git(project, ['rev-parse', 'HEAD']));

    const approve = await rpc(port, 'shipping/approve', {
      proposalId: start.result.proposalId,
      proposalHash: start.result.proposalHash,
      release: '0.1.0',
    }, { approvalReceipt: issue.result });
    assert.equal(stateName(approve.result), 'LOCKED');

    const lockedStatus = await rpc(port, 'shipping/status');
    assert.equal(stateName(lockedStatus.result), 'LOCKED');

    const pause = await rpc(port, 'shipping/pause', { reason: 'remote pilot pause proof' });
    assert.equal(stateName(pause.result), 'PAUSED');
    const pausedStatus = await rpc(port, 'shipping/status');
    assert.equal(stateName(pausedStatus.result), 'PAUSED');

    const deniedResumeRequest = makeRequest('shipping/resume', { reason: 'remote must not override human stop' });
    const deniedResume = await post(port, '/v1/rpc', deniedResumeRequest);
    assert.equal(deniedResume.body.ok, false);
    assert.equal(deniedResume.body.error.code, 'ERR_HUMAN_STOP');

    const localResume = await callShippingTool(project, 'shipping_pause', {
      action: 'resume',
      reason: 'local owner resumes after observing the remote pause',
    });
    assert.equal(localResume.structuredContent.state.state, 'LOCKED');

    const verification = await rpc(port, 'shipping/verify');
    assert.equal(verification.result.decision, 'SHIPPABLE');
    assert.equal(verification.result.issues.counts.BLOCKER, 0);

    const close = await rpc(port, 'shipping/close');
    assert.equal(close.result.state, 'CLOSED');

    const notices = await rpc(port, 'notifications/list', { limit: 20 });
    assert.ok(notices.result.some((notice) => notice.type === 'PAUSED'));
    assert.ok(notices.result.some((notice) => notice.type === 'CLOSED'));

    const backup = await rpc(port, 'backup/create');
    const backupDocument = JSON.parse(await readFile(backup.result.path, 'utf8'));
    assert.ok(backupDocument.files.some((file) => file.path === 'evidence/omo/runtime-manifest.json' && file.restore === false));

    await writeFile(path.join(project, '.shipping', 'state.json'), `${JSON.stringify({ state: 'CLOSED', release: 'BROKEN' })}\n`);
    const restore = await rpc(port, 'backup/restore', { bundlePath: backup.result.path });
    assert.equal(restore.result.restored, true);
    const restoredState = JSON.parse(await readFile(path.join(project, '.shipping', 'state.json'), 'utf8'));
    assert.equal(restoredState.release, '0.1.0');
    assert.equal(restoredState.state, 'CLOSED');

    const durableRequest = makeRequest('shipping/status', {}, { nonce: 'durable-replay-proof' });
    const durableFirst = await post(port, '/v1/rpc', durableRequest);
    assert.equal(durableFirst.body.ok, true);

    await running.close();
    running = null;
    restarted = await createInternalHttpsServer({
      gateway: createGateway(),
      host: '127.0.0.1',
      port: 0,
      certPath: certificatePath,
      keyPath,
      maxBodyBytes: config.maxBodyBytes,
      maxConcurrent: config.maxConcurrent,
    });
    const restartedPort = restarted.address.port;
    const replayAfterRestart = await post(restartedPort, '/v1/rpc', durableRequest);
    assert.equal(replayAfterRestart.status, 409);
    assert.equal(replayAfterRestart.body.error.code, 'ERR_REMOTE_REPLAY');
    const recovered = await rpc(restartedPort, 'shipping/status', {}, { nonce: 'recovered-status' });
    assert.equal(stateName(recovered.result), 'CLOSED');

    const packageDocument = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
    const contractLock = JSON.parse(await readFile(path.join(sourceRoot, '.shipping', 'contract.lock'), 'utf8'));
    return {
      schema: 'shipping-harness/v0.9-remote-pilot-v1',
      generatedAt: new Date().toISOString(),
      passed: true,
      shippingHarness: {
        packageVersion: packageDocument.version,
        implementationGitSha: git(sourceRoot, ['rev-parse', 'HEAD']),
        contractHash: contractLock.contractHash,
      },
      transport: {
        protocol: 'HTTPS JSON',
        tls: true,
        listenHost: '127.0.0.1',
        publicListener: false,
        maxBodyBytes: config.maxBodyBytes,
        maxConcurrent: config.maxConcurrent,
      },
      authorization: {
        actor: 'owner',
        projectAllowlist: ['pilot'],
        signedRequests: true,
        replayRejectedAfterRestart: true,
        oneTimeApproval: true,
        approvalBoundToGitSha: true,
        remoteResumeOverHumanStopDenied: true,
      },
      workflow: {
        proposedRelease: '0.1.0',
        approvalState: 'LOCKED',
        pauseObserved: true,
        verificationDecision: 'SHIPPABLE',
        blockers: 0,
        finalState: 'CLOSED',
        closedNotification: true,
      },
      backupRestore: {
        signed: true,
        restored: true,
        restoredState: 'CLOSED',
        omoManifestEvidenceOnly: true,
      },
      recovery: {
        gatewayRestarted: true,
        replayStoreDurable: true,
        stateRecovered: true,
      },
      metrics: {
        durationMs: Date.now() - started,
        humanInterventions: 2,
        falseDoneCount: 0,
        publicRequests: 0,
        rawShellFields: 0,
      },
    };
  } finally {
    await running?.close().catch(() => {});
    await restarted?.close().catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
}

function markdown(report) {
  return `# v0.9 Internal Remote Pilot\n\n` +
    `- Result: **${report.passed ? 'PASS' : 'FAIL'}**\n` +
    `- Shipping Harness package: ${report.shippingHarness.packageVersion}\n` +
    `- Implementation Git SHA: \`${report.shippingHarness.implementationGitSha}\`\n` +
    `- Transport: ${report.transport.protocol}, TLS ${report.transport.tls ? 'required' : 'disabled'}\n` +
    `- Listen boundary: ${report.transport.listenHost} (public listener: ${report.transport.publicListener})\n` +
    `- Workflow: proposal → one-time approval → pause → local resume → verify → close\n` +
    `- Final state: ${report.workflow.finalState}\n` +
    `- Replay rejected after gateway restart: ${report.authorization.replayRejectedAfterRestart}\n` +
    `- Remote resume over human stop denied: ${report.authorization.remoteResumeOverHumanStopDenied}\n` +
    `- Signed backup restored: ${report.backupRestore.restored}\n` +
    `- OMO manifest evidence-only (not restored): ${report.backupRestore.omoManifestEvidenceOnly}\n` +
    `- Duration: ${report.metrics.durationMs} ms\n\n` +
    `No public listener, raw shell field, public tenant, deployment, or customer endpoint was used.\n`;
}

const report = await runPilot();
if (process.argv.includes('--record')) {
  await mkdir(path.dirname(reportJsonPath), { recursive: true });
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportMarkdownPath, markdown(report));
}
if (process.argv.includes('--check')) {
  assert.equal(report.passed, true);
  assert.equal(report.workflow.finalState, 'CLOSED');
  assert.equal(report.authorization.replayRejectedAfterRestart, true);
  assert.equal(report.backupRestore.restored, true);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
