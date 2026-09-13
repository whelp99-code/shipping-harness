// v1.10.0 Phase B.4: the release receipt binds `closedGitSha` to HEAD. Closing while the
// implementation is still only in the working tree would make the receipt attest to a tree
// that does not contain the work — the uncommitted-close weakness from round 6 of
// docs/reports/v1.9.0-model-independence.json. Close refuses; the override is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';

/** @param {string} root @param {string} relative @param {string} content */
async function write(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('close refuses while in-scope work is uncommitted, and succeeds once it is committed', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await write(fixture.root, 'src/impl.mjs', 'export const shipped = true;\n');
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');

    const refused = runCli(fixture.root, ['close', '--json']);
    assert.equal(refused.exitCode, 1);
    const error = parseCliJson(refused).error;
    assert.equal(error.code, 'ERR_CLOSE_UNCOMMITTED');
    assert.deepEqual(error.details.paths, ['src/impl.mjs']);
    assert.match(error.message, /src\/impl\.mjs/u);

    // Committing the work and re-verifying against the new HEAD lets the release close.
    await fixture.commit('commit the implementation');
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    const closed = runCli(fixture.root, ['close', '--json']);
    assert.equal(closed.exitCode, 0, closed.stderr);
    const receipt = JSON.parse(await readFile(path.join(fixture.root, parseCliJson(closed).receipt), 'utf8'));
    assert.equal(receipt.uncommittedPaths, undefined);
  } finally {
    await fixture.cleanup();
  }
});

test('--allow-uncommitted closes but records the override in the receipt', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await write(fixture.root, 'src/impl.mjs', 'export const shipped = true;\n');
    await write(fixture.root, 'docs/note.md', 'note\n');
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');

    const result = await closeRelease(fixture.root, { allowUncommitted: true });
    assert.equal(result.state.state, 'CLOSED');
    assert.deepEqual(result.receipt.uncommittedPaths, ['docs/note.md', 'src/impl.mjs']);
    const stored = JSON.parse(await readFile(result.receiptPath, 'utf8'));
    assert.deepEqual(stored.uncommittedPaths, ['docs/note.md', 'src/impl.mjs']);
  } finally {
    await fixture.cleanup();
  }
});

test('a dirty tree that only touches .shipping/ runtime files is not refused', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    // lock/verify leave .shipping/state.json, ledger.jsonl and issues.json dirty by design.
    await write(fixture.root, '.shipping/scratch.json', '{}\n');
    const closed = runCli(fixture.root, ['close', '--json']);
    assert.equal(closed.exitCode, 0, closed.stderr);
    assert.equal(parseCliJson(closed).state, 'CLOSED');
  } finally {
    await fixture.cleanup();
  }
});

test('out-of-scope uncommitted paths alone do not refuse the close', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    await write(fixture.root, 'vendor/outside.mjs', 'export const nope = true;\n');
    const result = await closeRelease(fixture.root);
    assert.equal(result.state.state, 'CLOSED');
    assert.equal(result.receipt.uncommittedPaths, undefined);
  } finally {
    await fixture.cleanup();
  }
});
