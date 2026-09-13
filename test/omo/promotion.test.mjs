import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPrivateOmoPromotion, privateOmoDoctor } from '../../packages/internal-omo-bridge/index.mjs';
import { privateOmoRuntimeAvailability } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = privateOmoRuntimeAvailability();
const skip = runtime.available ? {} : { skip: 'private OMO runtime is not installed at the pinned path' };

test('promoted private OMO runtime is pinned, internal-only, installed, canaried, and rollback-proven', skip, async () => {
  const report = await verifyPrivateOmoPromotion(root);
  assert.equal(report.healthy, true);
  assert.equal(report.internalOnly, true);
  assert.equal(report.publicPublish, false);
  assert.equal(report.runtimeVersion, '0.7.0');
  assert.match(report.upstreamCommit, /^[0-9a-f]{40}$/u);
  assert.match(report.releaseCommit, /^[0-9a-f]{40}$/u);
  assert.match(report.buildDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(report.boundedDefaults.parallelWorkers, 2);
  assert.equal(report.boundedDefaults.agentDepth, 1);
  assert.equal(report.boundedDefaults.teamMode, false);
  assert.equal(report.boundedDefaults.dagMode, false);
  assert.equal(report.canary.passed, true);
  assert.equal(report.rollback.passed, true);
  assert.ok(report.selectedTests.every((entry) => entry.status === 0));
});

test('real private OMO doctor preserves the Shipping authority boundary', skip, async () => {
  const health = await privateOmoDoctor(root);
  assert.equal(health.doctor.healthy, true);
  assert.equal(health.doctor.internalOnly, true);
  assert.equal(health.doctor.publicPublish, false);
  assert.equal(health.doctor.teamMode, false);
  assert.equal(health.doctor.dagMode, false);
  assert.equal(health.doctor.budgets.parallel_workers, 2);
  assert.equal(health.doctor.budgets.agent_depth, 1);
});
