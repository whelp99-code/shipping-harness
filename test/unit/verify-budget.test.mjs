// v1.10.0 Phase C.1 (+ dirty-tree fix pass): two budgets bound verify iteration.
// `budgets.maxRedundantVerifyRuns` (default 5) counts consecutive runs that reproduced the
// previous run's working-tree fingerprint and per-criterion exit codes — comparing the
// fingerprint rather than the Git SHA is what makes the counter survive an uncommitted
// tree. `budgets.maxVerifyRuns` (default 25) hard-caps the total verify runs of a release,
// so alternating results cannot buy unlimited iterations. Either exhaustion transitions to
// BLOCKED with a `budget-exhausted` policy issue naming the budget that tripped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createDefaultContract, validateContract } from '../../src/core/contract.mjs';
import { readState } from '../../src/core/state.mjs';
import { verifyRelease } from '../../src/core/gate.mjs';

test('verify budgets default to 25 total and 5 redundant runs when absent from the contract', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node -e "process.exit(1)"' });
  try {
    await fixture.lock();
    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(result.verifyBudget.maxVerifyRuns, 25);
    assert.equal(result.verifyBudget.maxRedundantVerifyRuns, 5);
    assert.equal(result.verifyBudget.verifyRuns, 1);
    assert.equal(result.verifyBudget.redundantVerifyRuns, 0);
    assert.equal(result.verifyBudget.exhaustedBudget, null);
  } finally {
    await fixture.cleanup();
  }
});

test('the third redundant verify run (maxRedundantVerifyRuns=2) transitions to BLOCKED with budget-exhausted', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxRedundantVerifyRuns: 2 } }),
  });
  try {
    await fixture.lock();

    const r1 = await verifyRelease(fixture.root);
    assert.equal(r1.decision, 'TRIAGE');
    assert.equal(r1.verifyBudget.redundantVerifyRuns, 0);

    const r2 = await verifyRelease(fixture.root);
    assert.equal(r2.decision, 'TRIAGE');
    assert.equal(r2.verifyBudget.redundantVerifyRuns, 1);

    const r3 = await verifyRelease(fixture.root);
    assert.equal(r3.decision, 'BLOCKED');
    assert.equal(r3.verifyBudget.redundantVerifyRuns, 2);
    assert.equal(r3.verifyBudget.verifyRuns, 3);
    assert.equal(r3.verifyBudget.exhaustedBudget, 'maxRedundantVerifyRuns');

    const issue = r3.issues.issues.find((entry) => entry.basisId === 'budget-exhausted');
    assert.ok(issue, 'expected a budget-exhausted issue');
    assert.equal(issue.classification, 'BLOCKER');
    assert.match(issue.description, /maxRedundantVerifyRuns \(2\)/u);
    assert.match(issue.description, /2 verify run\(s\)/u);

    const state = await readState(fixture.root);
    assert.equal(state.state, 'BLOCKED');
    assert.equal(state.verifyRuns, 3);
    assert.equal(state.redundantVerifyRuns, 2);
  } finally {
    await fixture.cleanup();
  }
});

test('a changed Git SHA resets the redundant-run counter', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxRedundantVerifyRuns: 2 } }),
  });
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    const r2 = await verifyRelease(fixture.root);
    assert.equal(r2.verifyBudget.redundantVerifyRuns, 1);

    await mkdir(path.join(fixture.root, 'src'), { recursive: true });
    await writeFile(path.join(fixture.root, 'src', 'noop.mjs'), 'export const noop = true;\n', 'utf8');
    await fixture.commit('unrelated in-scope change');

    const r3 = await verifyRelease(fixture.root);
    assert.equal(r3.decision, 'TRIAGE');
    assert.equal(r3.verifyBudget.redundantVerifyRuns, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('budgets.maxVerifyRuns caps the total verify runs of a release', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxVerifyRuns: 2 } }),
  });
  try {
    await fixture.lock();
    const r1 = await verifyRelease(fixture.root);
    assert.equal(r1.decision, 'TRIAGE');

    const r2 = await verifyRelease(fixture.root);
    assert.equal(r2.decision, 'BLOCKED');
    assert.equal(r2.verifyBudget.verifyRuns, 2);
    assert.equal(r2.verifyBudget.exhaustedBudget, 'maxVerifyRuns');
    const issue = r2.issues.issues.find((entry) => entry.basisId === 'budget-exhausted');
    assert.ok(issue, 'expected a budget-exhausted issue');
  } finally {
    await fixture.cleanup();
  }
});

test('toggling an uncommitted file defeats redundancy detection but not the total cap', async () => {
  // The live replay this fix pass came from: a model kept an implementation uncommitted and
  // toggled an out-of-scope file between 13 verify runs. Every run has a different tree
  // fingerprint, so nothing is redundant — the total cap is what stops the loop.
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxVerifyRuns: 3 } }),
  });
  try {
    await fixture.lock();
    const toggled = path.join(fixture.root, 'src', 'toggle.mjs');
    await mkdir(path.join(fixture.root, 'src'), { recursive: true });

    await writeFile(toggled, 'export const value = 1;\n', 'utf8');
    const r1 = await verifyRelease(fixture.root);
    assert.equal(r1.decision, 'TRIAGE');
    assert.equal(r1.verifyBudget.redundantVerifyRuns, 0);

    await writeFile(toggled, 'export const value = 2;\n', 'utf8');
    const r2 = await verifyRelease(fixture.root);
    assert.equal(r2.decision, 'TRIAGE');
    assert.equal(r2.verifyBudget.redundantVerifyRuns, 0, 'a changed working tree is never redundant');
    assert.notEqual(r2.manifest.treeFingerprint, r1.manifest.treeFingerprint);
    assert.equal(r2.manifest.gitSha, r1.manifest.gitSha, 'HEAD never moved');

    await writeFile(toggled, 'export const value = 3;\n', 'utf8');
    const r3 = await verifyRelease(fixture.root);
    assert.equal(r3.decision, 'BLOCKED');
    assert.equal(r3.verifyBudget.redundantVerifyRuns, 0);
    assert.equal(r3.verifyBudget.verifyRuns, 3);
    assert.equal(r3.verifyBudget.exhaustedBudget, 'maxVerifyRuns');
    const issue = r3.issues.issues.find((entry) => entry.basisId === 'budget-exhausted');
    assert.ok(issue, 'expected a budget-exhausted issue');
    assert.match(issue.description, /maxVerifyRuns \(3\)/u);
  } finally {
    await fixture.cleanup();
  }
});

test('invalid verify budgets fail contract validation', () => {
  const base = createDefaultContract('example');
  for (const invalid of [0, 201, 1.5, '10', -1]) {
    assert.throws(
      () => validateContract({ ...base, budgets: { ...base.budgets, maxVerifyRuns: invalid } }),
      (error) => error.code === 'ERR_CONTRACT_INVALID',
      `expected maxVerifyRuns ${JSON.stringify(invalid)} to be rejected`,
    );
  }
  for (const invalid of [0, 101, 1.5, '5', -1]) {
    assert.throws(
      () => validateContract({ ...base, budgets: { ...base.budgets, maxRedundantVerifyRuns: invalid } }),
      (error) => error.code === 'ERR_CONTRACT_INVALID',
      `expected maxRedundantVerifyRuns ${JSON.stringify(invalid)} to be rejected`,
    );
  }
});
