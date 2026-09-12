// v1.10.0 Phase C.1: `budgets.maxVerifyRuns` bounds verify iterations that reproduce the
// previous run's Git SHA and per-criterion exit codes with no new evidence. Default is 10
// when the contract omits it; reaching the budget transitions to BLOCKED with a
// `budget-exhausted` policy issue. A changed Git SHA (real new evidence) resets the count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createDefaultContract, validateContract } from '../../src/core/contract.mjs';
import { readState } from '../../src/core/state.mjs';
import { verifyRelease } from '../../src/core/gate.mjs';

test('budgets.maxVerifyRuns defaults to 10 when absent from the contract', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node -e "process.exit(1)"' });
  try {
    await fixture.lock();
    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(result.verifyBudget.maxVerifyRuns, 10);
    assert.equal(result.verifyBudget.verifyRuns, 1);
    assert.equal(result.verifyBudget.redundantVerifyRuns, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('the third redundant verify run (maxVerifyRuns=2) transitions to BLOCKED with budget-exhausted', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "process.exit(1)"',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxVerifyRuns: 2 } }),
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

    const issue = r3.issues.issues.find((entry) => entry.basisId === 'budget-exhausted');
    assert.ok(issue, 'expected a budget-exhausted issue');
    assert.equal(issue.classification, 'BLOCKER');
    assert.match(issue.description, /maxVerifyRuns \(2\)/u);
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
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxVerifyRuns: 2 } }),
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

test('an invalid budgets.maxVerifyRuns fails contract validation', () => {
  const base = createDefaultContract('example');
  for (const invalid of [0, 101, 1.5, '10', -1]) {
    assert.throws(
      () => validateContract({ ...base, budgets: { ...base.budgets, maxVerifyRuns: invalid } }),
      (error) => error.code === 'ERR_CONTRACT_INVALID',
      `expected ${JSON.stringify(invalid)} to be rejected`,
    );
  }
});
