import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileAutopilotPolicy, decideAutopilot } from '../../src/core/autopilot-policy.mjs';
import { AUTOPILOT, autopilotStatus, evaluateAutopilotAction, readAutopilotLedger } from '../../src/core/autopilot.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function policy() {
  return compileAutopilotPolicy({
    profile: 'LOCAL_REVERSIBLE', proposalId: 'proposal-performance', proposalHash: 'a'.repeat(64),
    contractHash: 'b'.repeat(64), baselineSha: 'c'.repeat(40), releaseTrainHash: 'd'.repeat(64),
    approvedAt: '2026-08-30T00:00:00.000Z',
  });
}

async function activatedFixture() {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  await writeFile(path.join(fixture.root, 'Makefile'), 'e2e:\n\t@node -e "process.exit(0)"\n', 'utf8');
  await fixture.commit('fixture: add performance acceptance');
  const started = await callShippingTool(fixture.root, 'shipping_start', {
    goal: 'Deliver one useful local workflow with bounded performance and recovery.', release: '0.8.0',
  });
  await callShippingTool(fixture.root, 'shipping_approve_scope', {
    proposalId: started.structuredContent.proposalId, proposalHash: started.structuredContent.proposalHash,
    confirm: true, autopilotProfile: 'LOCAL_REVERSIBLE', confirmAutopilot: true,
  });
  return fixture;
}

test('policy compilation and decisions remain local, deterministic, and within a bounded latency budget', () => {
  const start = performance.now();
  let last;
  for (let index = 0; index < 2500; index += 1) {
    const compiled = policy();
    last = decideAutopilot(compiled, {
      action: index % 2 === 0 ? 'ANALYZE' : 'IMPLEMENT',
      effects: index % 2 === 0 ? ['LOCAL_READ'] : ['LOCAL_REVERSIBLE'],
      rollbackAvailable: true, exactScope: true, localOnly: true,
    });
  }
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs < 2500, `policy/decision loop took ${elapsedMs.toFixed(1)}ms`);
  assert.equal(last.released, false);
  assert.ok(JSON.stringify(policy()).length < 16384);
  assert.ok(JSON.stringify(last).length < 8192);
});

test('durable status remains bounded with a representative event history', async () => {
  const fixture = await activatedFixture();
  try {
    const startedAt = performance.now();
    for (let index = 0; index < 64; index += 1) {
      const verify = index % 2 === 1;
      await evaluateAutopilotAction(fixture.root, {
        action: verify ? 'VERIFY' : 'IMPLEMENT',
        effects: verify ? ['LOCAL_READ'] : ['LOCAL_REVERSIBLE'],
        rollbackAvailable: true, exactScope: true, localOnly: true,
        statePatch: { phase: verify ? 'VERIFYING' : 'IMPLEMENTING', details: { fieldSequence: index } },
      });
    }
    const writeElapsedMs = performance.now() - startedAt;
    const statusStart = performance.now();
    const status = await autopilotStatus(fixture.root);
    const statusElapsedMs = performance.now() - statusStart;
    assert.ok(writeElapsedMs < 10000, `64 durable transitions took ${writeElapsedMs.toFixed(1)}ms`);
    assert.ok(statusElapsedMs < 1000, `status took ${statusElapsedMs.toFixed(1)}ms`);
    assert.ok(status.eventCount >= 65 && status.eventCount <= AUTOPILOT.maxLedgerEvents);
    assert.equal(status.released, false);
  } finally {
    await fixture.cleanup();
  }
});

test('ledger count and byte retention limits fail closed before parsing unbounded input', async () => {
  const fixture = await activatedFixture();
  try {
    const ledgerPath = fixture.paths.autopilotLedger;
    const original = await readFile(ledgerPath, 'utf8');
    await writeFile(ledgerPath, '{}\n'.repeat(AUTOPILOT.maxLedgerEvents + 1), 'utf8');
    await assert.rejects(() => readAutopilotLedger(fixture.root), (error) => error?.code === 'ERR_AUTOPILOT_RETENTION');
    await writeFile(ledgerPath, 'x'.repeat(AUTOPILOT.maxLedgerBytes + 1), 'utf8');
    await assert.rejects(() => readAutopilotLedger(fixture.root), (error) => error?.code === 'ERR_AUTOPILOT_RETENTION');
    await writeFile(ledgerPath, original, 'utf8');
    assert.ok((await readAutopilotLedger(fixture.root)).length >= 1);
    assert.equal(AUTOPILOT.maxActiveMutationReceipts, 1);
  } finally {
    await fixture.cleanup();
  }
});
