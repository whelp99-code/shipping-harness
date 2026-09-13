// v1.10.0 Phase C.1: end-to-end verify-budget flow through the real CLI. A wrong
// implementation run through `verify` three times with `maxRedundantVerifyRuns: 2` exhausts the
// budget on the third (redundant) call; `hook decision` must deny continuation on the
// resulting BLOCKED state, not report CONTINUE. Fixing the implementation and re-entering
// through the legal BLOCKED -> FIXING -> VERIFYING path (per TRANSITIONS) reaches SHIPPABLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';

test('verify budget exhaustion blocks, fix cycle recovers, and hook decision denies continuation', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node ./src/check.mjs',
    contract: (contract) => ({ ...contract, budgets: { ...contract.budgets, maxRedundantVerifyRuns: 2 } }),
  });
  try {
    await mkdir(path.join(fixture.root, 'src'), { recursive: true });
    await writeFile(path.join(fixture.root, 'src', 'check.mjs'), 'process.exit(1);\n', 'utf8');
    await fixture.commit('wrong implementation');
    const lockResult = runCli(fixture.root, ['lock', '--json']);
    assert.equal(lockResult.exitCode, 0, lockResult.stderr);

    const v1 = parseCliJson(runCli(fixture.root, ['verify', '--json']));
    assert.equal(v1.decision, 'TRIAGE');

    const v2 = parseCliJson(runCli(fixture.root, ['verify', '--json']));
    assert.equal(v2.decision, 'TRIAGE');

    const v3result = runCli(fixture.root, ['verify', '--json']);
    const v3 = JSON.parse(v3result.stdout);
    assert.equal(v3.decision, 'BLOCKED');
    assert.equal(v3result.exitCode, 2);
    const budgetIssue = v3.issues.issues.find((entry) => entry.basisId === 'budget-exhausted');
    assert.ok(budgetIssue, 'expected a budget-exhausted issue on the third verify call');
    assert.equal(budgetIssue.classification, 'BLOCKER');

    // Further verify calls are refused outright (state is BLOCKED): no commands run again.
    const v4result = runCli(fixture.root, ['verify', '--json']);
    assert.notEqual(v4result.exitCode, 0);
    assert.match(v4result.stderr + v4result.stdout, /ERR_STATE_VERIFY/u);

    // The BLOCKED state must deny continuation, not report CONTINUE (exit code 3).
    const hookResult = runCli(fixture.root, ['hook', 'decision', '--adapter', 'generic', '--event', 'Stop', '--json']);
    const hookDecision = JSON.parse(hookResult.stdout);
    assert.equal(hookDecision.action, 'DENY_CONTINUATION');
    assert.equal(hookDecision.continue, false);
    assert.notEqual(hookResult.exitCode, 3);

    // BLOCKED -> FIXING is the legal recovery path (TRANSITIONS.BLOCKED includes FIXING).
    const fixResult = parseCliJson(runCli(fixture.root, ['fix', '--json']));
    assert.equal(fixResult.state, 'FIXING');

    await writeFile(path.join(fixture.root, 'src', 'check.mjs'), 'process.exit(0);\n', 'utf8');
    await fixture.commit('fix implementation');

    const finalResult = runCli(fixture.root, ['verify', '--json']);
    const final = JSON.parse(finalResult.stdout);
    assert.equal(final.decision, 'SHIPPABLE');
    assert.equal(finalResult.exitCode, 0);
    assert.equal(final.verifyBudget.redundantVerifyRuns, 0);
  } finally {
    await fixture.cleanup();
  }
});
