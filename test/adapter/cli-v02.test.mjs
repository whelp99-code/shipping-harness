import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { parseCliJson, runCli } from '../helpers/cli.mjs';

test('v0.2 CLI lists/probes adapters and returns a continuation protocol code', async () => {
  const fixture = await createFixtureRepo();
  try {
    const list = runCli(fixture.root, ['adapter', 'list', '--json']);
    assert.equal(list.exitCode, 0, list.stderr);
    assert.deepEqual(parseCliJson(list).map((adapter) => adapter.name), [
      'generic', 'codex', 'gajae', 'ouroboros', 'omo',
    ]);

    const probes = runCli(fixture.root, ['adapter', 'probe', '--all', '--json']);
    assert.equal(probes.exitCode, 0, probes.stderr);
    assert.equal(parseCliJson(probes).length, 5);

    const lock = runCli(fixture.root, ['lock', '--json']);
    assert.equal(lock.exitCode, 0, lock.stderr);
    const decision = runCli(fixture.root, ['hook', 'decision', '--adapter', 'omo', '--event', 'Stop', '--json']);
    assert.equal(decision.exitCode, 3, decision.stderr);
    assert.equal(parseCliJson(decision).reasonCode, 'VERIFICATION_OR_CLOSURE_REQUIRED');

    const pause = runCli(fixture.root, ['pause', '--reason', 'operator', '--json']);
    assert.equal(pause.exitCode, 0, pause.stderr);
    const stopped = runCli(fixture.root, ['hook', 'decision', '--adapter', 'omo', '--event', 'Stop', '--json']);
    assert.equal(stopped.exitCode, 0, stopped.stderr);
    assert.equal(parseCliJson(stopped).reasonCode, 'HUMAN_STOP_WINS');
  } finally {
    await fixture.cleanup();
  }
});