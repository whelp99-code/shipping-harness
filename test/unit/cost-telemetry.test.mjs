// v1.10.0 Phase C.2: adapter run receipts carry a `telemetry` cost record
// ({ durationMs, exitCode, outputBytes, toolCalls, verifyRunsAtStart, verifyRunsAtEnd }).
// `toolCalls` stays null unless the host reports it, and is validated as a non-negative
// integer when it is. `state.telemetry.totalAgentDurationMs` aggregates across runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { executeAdapter } from '../../src/adapters/runner.mjs';
import { beginFixCycle, verifyRelease } from '../../src/core/gate.mjs';
import { readState } from '../../src/core/state.mjs';

test('the run receipt carries telemetry with durationMs and exitCode; toolCalls is null unless provided', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const manifest = await executeAdapter(fixture.root, { adapter: 'generic', command: 'node -e "process.exit(0)"' });
    assert.equal(typeof manifest.telemetry.durationMs, 'number');
    assert.ok(manifest.telemetry.durationMs >= 0);
    assert.equal(manifest.telemetry.exitCode, 0);
    assert.equal(manifest.telemetry.outputBytes, manifest.result.capturedBytes);
    assert.equal(manifest.telemetry.toolCalls, null);
    assert.equal(manifest.telemetry.verifyRunsAtStart, 0);
    assert.equal(manifest.telemetry.verifyRunsAtEnd, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('a provided toolCalls integer is recorded on the receipt', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const manifest = await executeAdapter(fixture.root, {
      adapter: 'generic',
      command: 'node -e "process.exit(0)"',
      toolCalls: 7,
    });
    assert.equal(manifest.telemetry.toolCalls, 7);
  } finally {
    await fixture.cleanup();
  }
});

test('an invalid toolCalls value is rejected', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    for (const invalid of [-1, 1.5, 'seven', Number.NaN]) {
      await assert.rejects(
        () => executeAdapter(fixture.root, { adapter: 'generic', command: 'node -e "process.exit(0)"', toolCalls: invalid }),
        (error) => error.code === 'ERR_TOOL_CALLS_INVALID',
        `expected ${JSON.stringify(invalid)} to be rejected`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test('state.telemetry.totalAgentDurationMs aggregates across agent runs', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node -e "process.exit(1)"' });
  try {
    await fixture.lock();
    const first = await executeAdapter(fixture.root, { adapter: 'generic', command: 'node -e "process.exit(0)"' });
    const afterFirst = await readState(fixture.root);
    assert.equal(afterFirst.telemetry.totalAgentDurationMs, first.telemetry.durationMs);

    // Move VERIFYING -> TRIAGE -> FIXING so a second agent run is legal (beginAgentRun
    // only starts from LOCKED or FIXING).
    await verifyRelease(fixture.root);
    await beginFixCycle(fixture.root);

    const second = await executeAdapter(fixture.root, { adapter: 'generic', command: 'node -e "process.exit(0)"' });
    const afterSecond = await readState(fixture.root);
    assert.equal(afterSecond.telemetry.totalAgentDurationMs, first.telemetry.durationMs + second.telemetry.durationMs);
  } finally {
    await fixture.cleanup();
  }
});
