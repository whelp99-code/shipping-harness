// v1.10.0 Phase B.2: `lock` runs every acceptance command once against the
// pre-implementation tree. A criterion that already passes proves nothing about the coming
// work; one that times out is probably unrunnable here. Neither ever blocks the lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';
import { readJsonLines } from '../../src/core/fs.mjs';
import { preflightWarnings, runAcceptancePreflight } from '../../src/core/contract-defect.mjs';
import { loadContract } from '../../src/core/contract.mjs';

test('an acceptance command that already passes on the baseline is ALREADY_PASSING', async () => {
  const fixture = await createFixtureRepo();
  try {
    const result = runCli(fixture.root, ['lock', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseCliJson(result);
    assert.equal(output.state, 'LOCKED');
    assert.deepEqual(output.acceptancePreflight, [
      { id: 'AC-001', required: true, exitCode: 0, durationMs: output.acceptancePreflight[0].durationMs, verdict: 'ALREADY_PASSING' },
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test('an acceptance command that fails on the baseline is FAILING_AS_EXPECTED and the lock still succeeds', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node ./src/not-implemented-yet.mjs' });
  try {
    const result = runCli(fixture.root, ['lock', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseCliJson(result);
    assert.equal(output.state, 'LOCKED');
    assert.equal(output.acceptancePreflight[0].verdict, 'FAILING_AS_EXPECTED');
    assert.notEqual(output.acceptancePreflight[0].exitCode, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('the preflight verdicts are recorded in the lock ledger event', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal(runCli(fixture.root, ['lock']).exitCode, 0);
    const events = await readJsonLines(fixture.paths.ledger);
    const recorded = events.filter((event) => event.type === 'lock.preflight');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].acceptancePreflight[0].verdict, 'ALREADY_PASSING');
  } finally {
    await fixture.cleanup();
  }
});

test('--skip-preflight locks without running any acceptance command', async () => {
  const fixture = await createFixtureRepo();
  try {
    const result = runCli(fixture.root, ['lock', '--skip-preflight', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseCliJson(result);
    assert.equal(output.state, 'LOCKED');
    assert.equal(output.acceptancePreflight, null);
    const events = await readJsonLines(fixture.paths.ledger);
    assert.equal(events.find((event) => event.type === 'lock.preflight').acceptancePreflight, null);
  } finally {
    await fixture.cleanup();
  }
});

test('a criterion over its time budget is TIMEOUT', async () => {
  const fixture = await createFixtureRepo({
    contract: (contract) => ({
      ...contract,
      acceptance: [{ ...contract.acceptance[0], command: 'node -e "setTimeout(() => {}, 10000)"', timeoutSeconds: 1 }],
    }),
  });
  try {
    const preflight = await runAcceptancePreflight(fixture.root, await loadContract(fixture.paths.contract));
    assert.equal(preflight[0].verdict, 'TIMEOUT');
  } finally {
    await fixture.cleanup();
  }
});

// v1.13.17: the ALREADY_PASSING warning asserted that the criterion was stale, which is
// only true when the work is still ahead of the lock. This repository implements and then
// locks, so it saw the warning on every criterion of every release while nothing was
// wrong, and a reporting session doing the same reported the ambiguity. A warning that is
// routinely correct and never actionable teaches a reader to skip warnings, including the
// one about an unrunnable command. Which workflow is in use cannot be told from the tree,
// so the warning states the fact once and names both readings.
test('the already-passing warning names both readings instead of asserting a defect', () => {
  const [warning] = preflightWarnings([{ id: 'AC-001', verdict: 'ALREADY_PASSING' }]);
  assert.match(warning, /^AC-001 already passes on the baseline tree/u, 'the measured fact leads');
  assert.match(warning, /proves nothing about work done after this lock/u);
  assert.match(warning, /Expected when the implementation is already committed/u, 'implement-then-lock is normal');
  assert.match(warning, /stale criterion when the work is still ahead/u, 'lock-then-implement is the defect');
});

test('the timeout warning says what it costs at verify', () => {
  const [warning] = preflightWarnings([{ id: 'AC-002', verdict: 'TIMEOUT' }]);
  assert.match(warning, /may be unrunnable in this environment/u);
  assert.match(warning, /fail for the environment rather than the work/u, 'the consequence, not only the symptom');
});

test('a criterion that fails as expected produces no warning', () => {
  assert.deepEqual(preflightWarnings([{ id: 'AC-003', verdict: 'FAILING_AS_EXPECTED' }]), []);
  assert.deepEqual(preflightWarnings([]), []);
});
