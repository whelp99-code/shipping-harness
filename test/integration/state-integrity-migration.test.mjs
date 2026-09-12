// v1.9 → v1.10 promotion. A project closed with a pre-1.10 harness has no `integrity` field
// and an unsigned ledger. It must keep working: reading it is UNVERIFIED_LEGACY, migration
// signs it when the ledger proves the recorded state, and the next release still prepares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';
import { assessStateIntegrity } from '../../src/core/state-integrity.mjs';
import { migrateStateIntegrity } from '../../packages/stable-control/migration.mjs';

/**
 * Strip every v1.10 signature so the fixture looks like it was written by v1.9.
 * @param {{state: string, ledger: string}} paths
 */
async function downgradeToLegacy(paths) {
  const { integrity: _integrity, ...state } = JSON.parse(await readFile(paths.state, 'utf8'));
  await writeFile(paths.state, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const events = (await readFile(paths.ledger, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map(({ prev: _prev, digest: _digest, stateWrite: _stateWrite, ...rest }) => rest);
  await writeFile(paths.ledger, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
}

test('a release closed before v1.10 reads as UNVERIFIED_LEGACY and migrates to VERIFIED', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal(runCli(fixture.root, ['lock', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['close', '--json']).exitCode, 0);
    await downgradeToLegacy(fixture.paths);

    const legacy = await assessStateIntegrity(fixture.root);
    assert.equal(legacy.level, 'UNVERIFIED_LEGACY');
    assert.equal(legacy.ok, true);
    const status = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(status.integrity.level, 'UNVERIFIED_LEGACY');
    assert.equal(status.state.state, 'CLOSED');
    assert.equal(status.issues.items.some((item) => item.basisId === 'false-user-state'), false);

    const migrated = await migrateStateIntegrity(fixture.root);
    assert.equal(migrated.changed, true);
    assert.equal(migrated.level, 'VERIFIED');
    assert.equal(migrated.from, '1.9');
    assert.equal(migrated.to, '1.10');
    assert.equal((await assessStateIntegrity(fixture.root)).level, 'VERIFIED');
    // Migration appends, never rewrites: the original close transition is still the second
    // to last ledger entry and history is intact.
    const events = (await readFile(fixture.paths.ledger, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'state.migrated');
    assert.equal(events.at(-1).to, 'CLOSED');
    assert.ok(events.some((event) => event.type === 'release.closed'));

    // A second run is a no-op, and migration never reopens CLOSED work.
    const again = await migrateStateIntegrity(fixture.root);
    assert.equal(again.changed, false);
    assert.equal(JSON.parse(await readFile(fixture.paths.state, 'utf8')).state, 'CLOSED');
  } finally {
    await fixture.cleanup();
  }
});

test('a legacy state the ledger cannot prove stays UNVERIFIED_LEGACY and is not signed', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await downgradeToLegacy(fixture.paths);
    // The ledger proves LOCKED but the state file claims BLOCKED: unprovable, so unsigned.
    const state = JSON.parse(await readFile(fixture.paths.state, 'utf8'));
    await writeFile(fixture.paths.state, `${JSON.stringify({ ...state, state: 'BLOCKED' }, null, 2)}\n`, 'utf8');
    const events = (await readFile(fixture.paths.ledger, 'utf8')).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line))
      .map(({ to: _to, ...rest }) => rest);
    await writeFile(fixture.paths.ledger, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');

    assert.equal((await assessStateIntegrity(fixture.root)).level, 'UNVERIFIED_LEGACY');
    const migrated = await migrateStateIntegrity(fixture.root);
    assert.equal(migrated.changed, false);
    assert.equal(migrated.level, 'UNVERIFIED_LEGACY');
    assert.equal(JSON.parse(await readFile(fixture.paths.state, 'utf8')).integrity, undefined);
  } finally {
    await fixture.cleanup();
  }
});

test('release prepare succeeds on an UNVERIFIED_LEGACY closed release', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal(runCli(fixture.root, ['lock', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['close', '--json']).exitCode, 0);
    await downgradeToLegacy(fixture.paths);
    assert.equal((await assessStateIntegrity(fixture.root)).level, 'UNVERIFIED_LEGACY');

    const prepared = runCli(fixture.root, ['release', 'prepare', '--version', '0.2.0', '--goal', 'the next release outcome']);
    assert.equal(prepared.exitCode, 0, prepared.stderr);
    const status = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(status.state.state, 'DRAFT');
    assert.equal(status.state.release, '0.2.0');
    // The prepared DRAFT is written by v1.10 and is signed from here on.
    assert.equal(status.integrity.level, 'VERIFIED');
  } finally {
    await fixture.cleanup();
  }
});
