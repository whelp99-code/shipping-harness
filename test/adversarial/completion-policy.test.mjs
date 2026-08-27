import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { beginAgentRun, beginFixCycle, closeRelease, releaseStatus, verifyRelease } from '../../src/core/gate.mjs';
import { abort, readState } from '../../src/core/state.mjs';

test('DONE text cannot override a failed required command', async () => {
  const fixture = await createFixtureRepo({
    testScript: `node -e "console.log('DONE'); process.exit(1)"`,
  });
  try {
    await fixture.lock();
    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(result.issues.counts.BLOCKER, 1);
    const log = await fixture.read(result.manifest.results[0].logPath);
    assert.match(log, /DONE/u);
  } finally {
    await fixture.cleanup();
  }
});

test('contract mutation after lock prevents command execution', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const document = JSON.parse(await readFile(fixture.paths.contract, 'utf8'));
    document.goal = 'Silently widened goal';
    await writeFile(fixture.paths.contract, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await assert.rejects(() => verifyRelease(fixture.root), (error) => error?.code === 'ERR_CONTRACT_TAMPERED');
  } finally {
    await fixture.cleanup();
  }
});

test('evidence from an older Git SHA cannot close a changed release', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    await writeFile(path.join(fixture.root, 'README.md'), '# Changed after evidence\n', 'utf8');
    await fixture.commit('change after evidence');
    await assert.rejects(() => closeRelease(fixture.root), (error) => error?.code === 'ERR_EVIDENCE_STALE');
  } finally {
    await fixture.cleanup();
  }
});

test('path outside the locked include set becomes a release blocker', async () => {
  const fixture = await createFixtureRepo({
    contract(contract) {
      contract.scope.paths.include = ['src/**'];
      contract.scope.paths.exclude = [];
      return contract;
    },
  });
  try {
    await fixture.lock();
    await writeFile(path.join(fixture.root, 'outside.txt'), 'scope creep\n', 'utf8');
    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(result.scope.violations[0].path, 'outside.txt');
    assert.equal(result.issues.counts.BLOCKER, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('bounded fix cycles terminate in BLOCKED', async () => {
  const fixture = await createFixtureRepo({
    testScript: `node -e "process.exit(1)"`,
    contract(contract) {
      contract.budgets.maxFixCycles = 2;
      return contract;
    },
  });
  try {
    await fixture.lock();
    assert.equal((await verifyRelease(fixture.root)).decision, 'TRIAGE');
    assert.equal((await beginFixCycle(fixture.root)).fixCycles, 1);
    assert.equal((await verifyRelease(fixture.root)).decision, 'TRIAGE');
    assert.equal((await beginFixCycle(fixture.root)).fixCycles, 2);
    assert.equal((await verifyRelease(fixture.root)).decision, 'BLOCKED');
    assert.equal((await readState(fixture.root)).state, 'BLOCKED');
  } finally {
    await fixture.cleanup();
  }
});

test('human abort denies subsequent agent continuation', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await abort(fixture.root, 'operator stop');
    await assert.rejects(() => beginAgentRun(fixture.root, 'generic'), /Cannot start an agent run/u);
  } finally {
    await fixture.cleanup();
  }
});

test('any source change after CLOSED requires a new contract', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    await closeRelease(fixture.root);
    await writeFile(path.join(fixture.root, 'README.md'), '# Post-close mutation\n', 'utf8');
    const status = await releaseStatus(fixture.root);
    assert.equal(status.closedDrift.requiresNewContract, true);
    assert.deepEqual(status.closedDrift.violations, [
      { path: 'README.md', reason: 'closed-version-change' },
    ]);
  } finally {
    await fixture.cleanup();
  }
});