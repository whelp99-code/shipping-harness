#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadPrivateOmoConfig, privateOmoDoctor, verifyPrivateOmoPromotion } from '../packages/internal-omo-bridge/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const criterion = process.argv[2];
const bridgeCriteria = new Set(['AC-0703', 'AC-0704', 'AC-0706', 'AC-0707', 'AC-0708', 'AC-0709', 'AC-0710']);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${String(result.stderr || result.stdout).trim()}`);
  return String(result.stdout).trim();
}

async function main() {
  assert.match(criterion ?? '', /^AC-07(?:0[1-9]|1[0-4])$/u);
  const config = await loadPrivateOmoConfig(root);
  const promotion = await verifyPrivateOmoPromotion(root, config);
  let evidence;
  if (bridgeCriteria.has(criterion)) {
    const output = run('npm', ['run', 'test:omo-bridge', '--silent']);
    evidence = { bridgeSuite: 'PASS', outputDigestSourceBytes: Buffer.byteLength(output) };
  } else if (criterion === 'AC-0701') {
    assert.equal(promotion.healthy, true);
    assert.equal((await stat(promotion.artifactPath)).isFile(), true);
    evidence = { runtimeVersion: promotion.runtimeVersion, releaseCommit: promotion.releaseCommit, buildDigest: promotion.buildDigest, artifactSha256: promotion.artifactSha256 };
  } else if (criterion === 'AC-0702') {
    const [license, modifications, notice] = await Promise.all([readFile(config.evidence.license, 'utf8'), readFile(config.evidence.modifications, 'utf8'), readFile(config.evidence.notice, 'utf8')]);
    assert.match(license, /Sustainable Use License/u);
    assert.match(license, /internal business purposes/u);
    assert.match(modifications, /Shipping Harness/u);
    assert.match(notice, /internal/u);
    evidence = { license: 'PRESENT', modifications: 'PRESENT', notice: 'PRESENT' };
  } else if (criterion === 'AC-0705') {
    const d = promotion.boundedDefaults;
    assert.ok(d.parallelWorkers <= 2 && d.agentDepth <= 1 && d.continuations <= 3 && d.fixCycles <= 2);
    assert.equal(d.teamMode, false);
    assert.equal(d.dagMode, false);
    assert.equal(d.unlimitedValuesAllowed, false);
    evidence = d;
  } else if (criterion === 'AC-0711') {
    const doctor = await privateOmoDoctor(root);
    assert.ok(promotion.selectedTests.every((entry) => entry.status === 0));
    assert.equal(promotion.canary.passed, true);
    assert.equal(doctor.doctor.healthy, true);
    evidence = { selectedTests: promotion.selectedTests.length, canary: 'PASS', doctor: 'PASS' };
  } else if (criterion === 'AC-0712') {
    assert.equal(promotion.rollback.passed, true);
    assert.equal(promotion.rollback.contractAmended, false);
    evidence = promotion.rollback;
  } else if (criterion === 'AC-0713') {
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.publishConfig, undefined);
    assert.equal(config.publicPublish, false);
    assert.equal(promotion.publicPublish, false);
    assert.equal(JSON.stringify(packageJson.files ?? []).includes('shipping-harness-omo-runtime'), false);
    evidence = { mainPrivate: true, runtimeInternalOnly: true, publicPublish: false, vendoredOmoSource: false };
  } else if (criterion === 'AC-0714') {
    run(process.execPath, ['scripts/omo-pilot.mjs', '--verify-only']);
    const pilot = JSON.parse(await readFile(path.join(root, 'docs', 'internal-runtime', 'v0.7-pilot.json'), 'utf8'));
    assert.equal(pilot.passed, true);
    assert.equal(pilot.finalRelease.state, 'CLOSED');
    assert.equal(pilot.metrics.falseDoneCount, 0);
    assert.equal(pilot.metrics.scopeViolations, 0);
    evidence = { finalState: pilot.finalRelease.state, falseDone: pilot.metrics.falseDoneCount, v08Decision: pilot.entryGate.decision };
  } else {
    throw new Error(`Unsupported criterion: ${criterion}`);
  }
  process.stdout.write(`${JSON.stringify({ criterion, status: 'PASS', evidence }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${criterion ?? 'AC-UNKNOWN'} FAIL: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
