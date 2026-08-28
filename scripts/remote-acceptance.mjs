#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const criterion = process.argv[2] ?? '--all';
const acceptanceIds = Array.from({ length: 12 }, (_, index) => `AC-${String(901 + index).padStart(4, '0')}`);

async function text(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function json(relative) {
  return JSON.parse(await text(relative));
}

async function exists(relative) {
  try { await access(path.join(root, relative)); return true; } catch { return false; }
}

function assertAncestor(commit) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, 'Pilot implementation commit must remain an ancestor of current HEAD');
}

function requestKeySection(source) {
  const start = source.indexOf('const REQUEST_KEYS');
  const end = source.indexOf('const FORBIDDEN_KEYS');
  assert.ok(start >= 0 && end > start, 'Remote request key policy is missing');
  return source.slice(start, end);
}

function gatewayActionSection(source) {
  const start = source.indexOf('const ACTION_PARAMS');
  const end = source.indexOf('export class RateLimiter');
  assert.ok(start >= 0 && end > start, 'Gateway action parameter policy is missing');
  return source.slice(start, end);
}

const [
  pilot,
  packageDocument,
  contract,
  lock,
  exampleConfig,
  requestSource,
  gatewaySource,
  identitySource,
  approvalSource,
  replaySource,
  notificationSource,
  backupSource,
  policySource,
  remoteTests,
  adversarialTests,
  runbook,
  backupRunbook,
  incidentRunbook,
  internalRemoteDoc,
] = await Promise.all([
  json('docs/reports/v0.9-remote-pilot.json'),
  json('package.json'),
  json('.shipping/contract.yaml'),
  json('.shipping/contract.lock'),
  json('config/internal-remote.example.json'),
  text('packages/internal-remote/request.mjs'),
  text('packages/internal-remote/gateway.mjs'),
  text('packages/internal-remote/identity.mjs'),
  text('packages/internal-remote/approval.mjs'),
  text('packages/internal-remote/replay-store.mjs'),
  text('packages/internal-remote/notifications.mjs'),
  text('packages/internal-remote/backup.mjs'),
  text('packages/internal-remote/policy.mjs'),
  Promise.all([
    text('test/remote/security.test.mjs'),
    text('test/remote/gateway.test.mjs'),
    text('test/remote/backup.test.mjs'),
    text('test/remote/https.test.mjs'),
  ]).then((items) => items.join('\n')),
  text('test/adversarial/remote-attacks.test.mjs'),
  text('docs/operations/INTERNAL-REMOTE-RUNBOOK.md'),
  text('docs/operations/BACKUP-RESTORE.md'),
  text('docs/operations/INTERNAL-REMOTE-INCIDENT.md'),
  text('docs/internal-remote/README.md'),
]);

function common() {
  assert.equal(contract.release, '0.9.0');
  assert.equal(lock.release, '0.9.0');
  assert.equal(pilot.schema, 'shipping-harness/v0.9-remote-pilot-v1');
  assert.equal(pilot.passed, true);
  assert.equal(pilot.shippingHarness.packageVersion, '0.9.0');
  assert.equal(pilot.shippingHarness.contractHash, lock.contractHash);
  assertAncestor(pilot.shippingHarness.implementationGitSha);
  assert.equal(packageDocument.version, '0.9.0');
  assert.equal(packageDocument.bin['shipping-harness-remote'], './bin/shipping-harness-remote.mjs');
  assert.equal(packageDocument.scripts['test:remote'], 'node --test --test-reporter=spec test/remote/*.test.mjs test/adversarial/remote-attacks.test.mjs');
  assert.equal(packageDocument.scripts['smoke:remote'], 'node scripts/remote-gateway-smoke.mjs --check');
  assert.equal(exampleConfig.schema, 'shipping-remote/config-v1');
  assert.ok(Array.isArray(exampleConfig.allowedRoots) && exampleConfig.allowedRoots.length > 0);
  assert.equal(typeof exampleConfig.serverCredentialEnv, 'string');
  assert.equal(Object.hasOwn(exampleConfig, 'serverCredential'), false);
  assert.ok(exampleConfig.actors.every((actor) => actor.credentialEnv && !Object.hasOwn(actor, 'credential')));
}

const checks = {
  'AC-0901': () => {
    assert.equal(pilot.transport.protocol, 'HTTPS JSON');
    assert.equal(pilot.transport.tls, true);
    assert.equal(pilot.transport.publicListener, false);
    assert.equal(pilot.authorization.signedRequests, true);
    assert.deepEqual(pilot.authorization.projectAllowlist, ['pilot']);
    assert.match(policySource, /Public listeners are forbidden/u);
    assert.match(identitySource, /allowedRoots/u);
  },
  'AC-0902': () => {
    assert.match(identitySource, /actor\.projects\.includes\(projectId\)/u);
    assert.match(identitySource, /actor\.permissions\.includes\(permission\)/u);
    assert.match(identitySource, /Multiple project IDs cannot alias/u);
    assert.match(adversarialTests, /cross-project access and insufficient permission fail/u);
  },
  'AC-0903': () => {
    const requestKeys = requestKeySection(requestSource);
    const actionParams = gatewayActionSection(gatewaySource);
    for (const forbidden of ['command', 'argv', 'environment', 'cwd', 'credential', 'secret', 'deploy', 'push', 'purchase']) {
      assert.equal(requestKeys.includes(`'${forbidden}'`), false, `Request schema exposes ${forbidden}`);
      assert.equal(actionParams.includes(`'${forbidden}'`), false, `Action params expose ${forbidden}`);
    }
    assert.match(requestSource, /forbidden remote field/iu);
    assert.equal(pilot.metrics.rawShellFields, 0);
  },
  'AC-0904': () => {
    for (const field of ['requestId', 'actorId', 'projectId', 'release', 'proposalId', 'proposalHash', 'gitSha', 'requestNonce', 'receiptId', 'expiresAt']) {
      assert.ok(approvalSource.includes(field), `Approval receipt is not visibly bound to ${field}`);
    }
    assert.equal(pilot.authorization.oneTimeApproval, true);
    assert.equal(pilot.authorization.approvalBoundToGitSha, true);
  },
  'AC-0905': () => {
    assert.match(approvalSource, /expired/u);
    assert.match(approvalSource, /binding mismatch/u);
    assert.match(gatewaySource, /approval:\$\{receipt\.receiptId\}/u);
    assert.match(replaySource, /ERR_REMOTE_REPLAY/u);
    assert.equal(pilot.authorization.replayRejectedAfterRestart, true);
    assert.match(adversarialTests, /cannot cross actor, project, release, proposal or expiration boundaries/u);
  },
  'AC-0906': () => {
    assert.equal(pilot.workflow.proposedRelease, '0.1.0');
    assert.equal(pilot.workflow.approvalState, 'LOCKED');
    assert.equal(pilot.workflow.pauseObserved, true);
    assert.equal(pilot.workflow.verificationDecision, 'SHIPPABLE');
    assert.equal(pilot.workflow.blockers, 0);
    assert.equal(pilot.workflow.finalState, 'CLOSED');
    assert.equal(pilot.workflow.closedNotification, true);
  },
  'AC-0907': () => {
    assert.equal(pilot.authorization.remoteResumeOverHumanStopDenied, true);
    assert.match(gatewaySource, /Local human stop denies remote resume or execution/u);
    assert.match(remoteTests, /human stop/iu);
  },
  'AC-0908': () => {
    assert.match(notificationSource, /dedupeKey/u);
    assert.match(notificationSource, /maxEntries/u);
    assert.match(gatewaySource, /delivered: false/u);
    assert.equal(pilot.workflow.closedNotification, true);
    assert.match(remoteTests, /notifications/u);
  },
  'AC-0909': () => {
    assert.equal(pilot.backupRestore.signed, true);
    assert.equal(pilot.backupRestore.restored, true);
    assert.equal(pilot.backupRestore.omoManifestEvidenceOnly, true);
    assert.match(backupSource, /ERR_BACKUP_SIGNATURE/u);
    assert.match(backupSource, /Credential-like paths are not allowed/u);
    assert.match(backupSource, /restore: false/u);
  },
  'AC-0910': () => {
    assert.match(backupSource, /pauseRestoredNonTerminal/u);
    assert.match(backupSource, /restored-from-signed-backup/u);
    assert.match(backupSource, /TERMINAL_STATES/u);
    assert.match(remoteTests, /restored non-terminal release is forced into PAUSED/u);
    assert.match(backupRunbook, /Terminal work is never replayed/u);
  },
  'AC-0911': () => {
    assert.equal(pilot.recovery.gatewayRestarted, true);
    assert.equal(pilot.recovery.replayStoreDurable, true);
    assert.equal(pilot.recovery.stateRecovered, true);
    assert.match(adversarialTests, /cross-project/u);
    assert.match(runbook, /Upgrade/u);
    assert.match(runbook, /Rollback/u);
    assert.match(incidentRunbook, /Immediate containment/u);
  },
  'AC-0912': async () => {
    assert.equal(pilot.passed, true);
    assert.equal(pilot.metrics.falseDoneCount, 0);
    assert.equal(pilot.metrics.publicRequests, 0);
    assert.equal(pilot.workflow.blockers, 0);
    assert.ok(await exists('docs/reports/v0.9-remote-pilot.md'));
    assert.ok(await exists('docs/internal-remote/README.md'));
    assert.ok(await exists('config/internal-remote.example.json'));
    assert.match(internalRemoteDoc, /company-internal/u);
  },
};

async function verify(id) {
  common();
  assert.ok(checks[id], `Unsupported acceptance criterion: ${id}`);
  await checks[id]();
  return { criterion: id, status: 'PASS' };
}

const selected = criterion === '--all' ? acceptanceIds : [criterion];
const results = [];
for (const id of selected) results.push(await verify(id));
process.stdout.write(`${JSON.stringify({
  schema: 'shipping-harness/v0.9-acceptance-v1',
  release: '0.9.0',
  passed: true,
  results,
}, null, 2)}\n`);
