// v1.13.20: budgets refuse before launch; pause must not launder TAMPERED state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { executeAdapter } from '../../src/adapters/runner.mjs';
import { beginFixCycle, verifyRelease } from '../../src/core/gate.mjs';
import { pause, resume } from '../../src/core/state.mjs';
import { assessStateIntegrity } from '../../src/core/state-integrity.mjs';
import { existsSync } from 'node:fs';

test('exhausted maxAgentRuns does not launch the adapter command', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxAgentRuns: 0, maxFixCycles: 2 } }),
  });
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    await beginFixCycle(fixture.root);
    const marker = path.join(fixture.root, 'agent-ran.txt');
    await assert.rejects(
      () => executeAdapter(fixture.root, {
        adapter: 'generic',
        command: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"`,
      }),
      (error) => error.code === 'ERR_RUN_STATE' || error.code === 'ERR_AGENT_BUDGET',
    );
    assert.equal(existsSync(marker), false);
  } finally {
    await fixture.cleanup();
  }
});

test('maxVerifyRuns 1 first successful verify is SHIPPABLE', async () => {
  const fixture = await createFixtureRepo({
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxVerifyRuns: 1 } }),
  });
  try {
    await fixture.lock();
    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'SHIPPABLE');
  } finally {
    await fixture.cleanup();
  }
});

test('pause and resume do not re-sign a tampered state', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxFixCycles: 1 } }),
  });
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    await beginFixCycle(fixture.root);
    const statePath = path.join(fixture.root, '.shipping/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.fixCycles = 0;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    assert.equal((await assessStateIntegrity(fixture.root)).level, 'TAMPERED');
    await assert.rejects(() => pause(fixture.root, 'launder'), (error) => error.code === 'ERR_STATE_TAMPERED');
    await assert.rejects(() => resume(fixture.root, 'launder'), (error) => error.code === 'ERR_STATE_TAMPERED' || error.code === 'ERR_NOT_PAUSED');
    assert.equal((await assessStateIntegrity(fixture.root)).level, 'TAMPERED');
  } finally {
    await fixture.cleanup();
  }
});
