import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  STABLE_SCHEMAS,
  compatibilityReport,
  migrateArtifact,
  validateAllStableExamples,
} from '../packages/stable-control/index.mjs';

const root = process.cwd();
const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const required = (relative) => {
  assert.equal(existsSync(path.join(root, relative)), true, `missing required v1 artifact: ${relative}`);
  return relative;
};
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const reports = {
  smoke: 'docs/reports/v1-final-smoke.json',
  benchmark: 'docs/reports/v1-completion-benchmark.json',
  security: 'docs/reports/v1-security-inventory.json',
};

const checks = {
  async 'AC-1001'() {
    const examples = await validateAllStableExamples();
    assert.ok(examples.length >= 20);
    required('schemas/v1/README.md');
    for (const doc of ['docs/COMPATIBILITY.md', 'docs/MIGRATION.md', 'docs/HANDOVER.md']) required(doc);
  },

  'AC-1002'() {
    const closed = { schema: STABLE_SCHEMAS.release, release: '0.9.0', state: 'CLOSED', contractHash: 'a'.repeat(64) };
    assert.equal(migrateArtifact(closed).artifact.state, 'CLOSED');
    const paused = { schema: STABLE_SCHEMAS.state, state: 'PAUSED', release: '0.9.0', humanStop: true };
    assert.equal(migrateArtifact(paused).artifact.humanStop, true);
    assert.throws(() => migrateArtifact({ schema: 'shipping-harness/future-v2' }), /Unsupported stable schema/u);
    required('docs/MIGRATION.md');
    required('docs/operations/INSTALL-UPGRADE-ROLLBACK.md');
  },

  'AC-1003'() {
    const report = compatibilityReport();
    assert.equal(report.shippingVersion, '1.0.0');
    assert.equal(report.supported, true, report.diagnostics.join('; '));
    assert.equal(report.teamDag.default, 'DISABLED');
    assert.equal(report.omoRuntime.internalOnly, true);
  },

  'AC-1004'() {
    const smoke = readJson(required(reports.smoke));
    assert.equal(smoke.status, 'PASS');
    assert.match(smoke.package.cleanInstallVersion, /1\.0\.0/u);
    assert.match(smoke.package.upgradeFrom, /0\.6\.0/u);
    assert.match(smoke.package.upgradeTo, /1\.0\.0/u);
    assert.equal(smoke.plugin.rollbackProven, true);
    assert.equal(smoke.backupRestore.restored, true);
    required('docs/operations/INTERNAL-REMOTE-INCIDENT.md');
  },

  'AC-1005'() {
    const smoke = readJson(required(reports.smoke));
    assert.equal(smoke.plugin.doctorHealthy, true);
    assert.equal(smoke.plugin.beginnerFinalState, 'CLOSED');
    assert.equal(smoke.plugin.statePreserved, true);
    assert.equal(smoke.plugin.projectSpecificCliRequired, false);
  },

  'AC-1006'() {
    const benchmark = readJson(required(reports.benchmark));
    assert.equal(benchmark.summary.shipping.falseDone, 0);
    assert.equal(benchmark.summary.shipping.scopeDriftAccepted, 0);
    assert.equal(benchmark.summary.humanStopViolations, 0);
    assert.equal(benchmark.summary.runawayExecutions, 0);
    assert.equal(benchmark.liveModelBenchmark, false);
  },

  'AC-1007'() {
    const lock = readJson('.shipping/contract.lock');
    const current = head();
    assert.equal(process.env.SHIPPING_HARNESS_GIT_SHA ?? current, current);
    assert.equal(process.env.SHIPPING_HARNESS_CONTRACT_HASH ?? lock.contractHash, lock.contractHash);
    const benchmark = readJson(required(reports.benchmark));
    assert.ok(benchmark.summary.shipping.evidenceLinked >= 1);
  },

  'AC-1008'() {
    const pilot = readJson('docs/internal-runtime/v0.7-pilot.json');
    const gate = readJson('docs/internal-runtime/v0.8-team-dag-decision.json');
    assert.equal(pilot.passed, true);
    assert.equal(pilot.privateOmoReceipt.releaseCompletionTrusted, false);
    assert.equal(pilot.privateOmoReceipt.requiresShippingVerification, true);
    assert.equal(gate.decision, 'DISABLED');
    assert.equal(gate.preservedProfile.shippingFinisherOnly, true);
  },

  'AC-1009'() {
    const remote = readJson('docs/reports/v0.9-remote-pilot.json');
    assert.equal(remote.passed, true);
    assert.equal(remote.transport.tls, true);
    assert.equal(remote.transport.publicListener, false);
    assert.equal(remote.authorization.replayRejectedAfterRestart, true);
    assert.equal(remote.authorization.remoteResumeOverHumanStopDenied, true);
    assert.equal(remote.metrics.rawShellFields, 0);
  },

  'AC-1010'() {
    const pin = readJson('config/upstreams/omo-pin.json');
    assert.equal(pin.internalOnly, true);
    assert.equal(pin.publicPublish, false);
    assert.equal(pin.policy.shippingFinisherOnly, true);
    assert.equal(pin.policy.teamMode, false);
    assert.equal(pin.policy.dagMode, false);
    for (const value of Object.values(pin.evidence)) assert.equal(existsSync(value), true, `missing private OMO record: ${value}`);
    required('docs/internal-runtime/OMO-RUNTIME.md');
    required('THIRD_PARTY.md');
  },

  'AC-1011'() {
    const security = readJson(required(reports.security));
    assert.equal(security.boundaries.internalOnly, true);
    assert.equal(security.boundaries.publicSaas, false);
    assert.equal(security.boundaries.customerDistribution, false);
    assert.equal(security.boundaries.publicOmoBundle, false);
    assert.equal(security.thirdParty.omo.publicPublish, false);
  },

  'AC-1012'() {
    const security = readJson(required(reports.security));
    assert.equal(security.authority.humanStopFirst, true);
    assert.equal(security.authority.shippingFinisherOnly, true);
    for (const doc of ['docs/HANDOVER.md', 'docs/SECURITY-INVENTORY.md', 'docs/operations/RETENTION-SUPPORT.md']) required(doc);
  },

  'AC-1013'() {
    const issues = readJson('.shipping/issues.json');
    const blockerCount = issues.counts?.BLOCKER ?? issues.summary?.BLOCKER ?? 0;
    assert.equal(blockerCount, 0);
    const contract = readJson('.shipping/contract.yaml');
    assert.equal(contract.releasePolicy.generateReport, true);
    assert.equal(contract.stopPolicy.closeWhenRequiredGatesPass, true);
  },

  'AC-1014'() {
    const pkg = readJson('package.json');
    const contract = readJson('.shipping/contract.yaml');
    const state = readJson('.shipping/state.json');
    assert.equal(pkg.version, '1.0.0');
    assert.equal(contract.release, '1.0.0');
    assert.ok(['LOCKED', 'VERIFYING', 'SHIPPABLE', 'CLOSED'].includes(state.state));
    assert.equal(state.humanStop, false);
    required('docs/HANDOVER.md');
    const tag = execFileSync('git', ['tag', '-l', 'v1.0.0'], { cwd: root, encoding: 'utf8' }).trim();
    if (tag) assert.equal(execFileSync('git', ['rev-list', '-n', '1', tag], { cwd: root, encoding: 'utf8' }).trim(), head());
  },
};

async function run(id) {
  const check = checks[id];
  assert.equal(typeof check, 'function', `unknown v1 criterion: ${id}`);
  await check();
  return { criterion: id, status: 'PASS' };
}

const requested = process.argv.slice(2);
const ids = requested.includes('--all') ? Object.keys(checks) : requested;
assert.ok(ids.length > 0, 'Provide an AC-10xx criterion or --all');
const results = [];
for (const id of ids) results.push(await run(id));
process.stdout.write(`${JSON.stringify({ schema: 'shipping-harness/v1-acceptance-v1', release: '1.0.0', passed: true, results }, null, 2)}\n`);
