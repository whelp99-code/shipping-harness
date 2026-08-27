import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { parseCliJson, runCli } from '../helpers/cli.mjs';

test('CLI locks, verifies, closes, and reports status', async () => {
  const fixture = await createFixtureRepo();
  try {
    const locked = runCli(fixture.root, ['lock', '--json']);
    assert.equal(locked.exitCode, 0, locked.stderr);
    assert.equal(parseCliJson(locked).state, 'LOCKED');

    const verified = runCli(fixture.root, ['verify', '--json']);
    assert.equal(verified.exitCode, 0, verified.stderr);
    assert.equal(parseCliJson(verified).decision, 'SHIPPABLE');

    const closed = runCli(fixture.root, ['close', '--json']);
    assert.equal(closed.exitCode, 0, closed.stderr);
    assert.equal(parseCliJson(closed).state, 'CLOSED');

    const status = runCli(fixture.root, ['status', '--json']);
    assert.equal(status.exitCode, 0, status.stderr);
    const statusDocument = parseCliJson(status);
    assert.equal(statusDocument.state.state, 'CLOSED');
    assert.equal(statusDocument.evidenceFresh, true);
  } finally {
    await fixture.cleanup();
  }
});