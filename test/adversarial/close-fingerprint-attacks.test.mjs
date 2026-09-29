// v1.13.20: close must not attest HEAD using evidence from a discarded working tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { ShippingError } from '../../src/core/errors.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';

/** @param {unknown} error */
const isStale = (error) => error instanceof ShippingError && error.code === 'ERR_EVIDENCE_STALE';

/** @param {string} root @param {string} relative @param {string} content */
async function write(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('close refuses evidence taken against in-scope dirty bytes that were later restored', async () => {
  const fixture = await createFixtureRepo({
    testScript: 'node -e "const fs=require(\'fs\'); const t=fs.readFileSync(\'src/flag.txt\',\'utf8\'); if(!t.includes(\'pass\')) process.exit(1)"',
    files: { 'src/flag.txt': 'fail\n' },
  });
  try {
    await fixture.lock();
    await write(fixture.root, 'src/flag.txt', 'pass\n');
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    await write(fixture.root, 'src/flag.txt', 'fail\n');
    await assert.rejects(
      () => closeRelease(fixture.root),
      (error) => error instanceof ShippingError && error.code === 'ERR_EVIDENCE_STALE',
    );
    const refused = runCli(fixture.root, ['close', '--json']);
    assert.equal(refused.exitCode, 1);
    assert.equal(parseCliJson(refused).error.code, 'ERR_EVIDENCE_STALE');
  } finally {
    await fixture.cleanup();
  }
});

// Issue #1: a source change made after verify leaves HEAD unchanged, so close accepted the
// old evidence. Every surface (core, CLI with the override, MCP) must refuse it as stale.
test('close refuses evidence once the tested source changes after verify, on every surface', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    await write(fixture.root, 'package.json', `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(1)"' } }, null, 2)}\n`);
    await assert.rejects(() => closeRelease(fixture.root), isStale);
    await assert.rejects(() => closeRelease(fixture.root, { allowUncommitted: true }), isStale);
    const refused = runCli(fixture.root, ['close', '--allow-uncommitted', '--json']);
    assert.equal(refused.exitCode, 1);
    assert.equal(parseCliJson(refused).error.code, 'ERR_EVIDENCE_STALE');
    await assert.rejects(() => callShippingTool(fixture.root, 'shipping_close', {}), isStale);
    assert.equal(JSON.parse(await fixture.read('.shipping/state.json')).state, 'SHIPPABLE');
  } finally {
    await fixture.cleanup();
  }
});

test('close refuses evidence after a new file, a deletion, or a rewrite of already-dirty bytes', async () => {
  /** @type {Array<[string, (root: string) => Promise<unknown>]>} */
  const changes = [
    ['new in-scope file', (root) => write(root, 'src/added.mjs', 'export const added = true;\n')],
    ['deleted tracked file', (root) => rm(path.join(root, 'README.md'))],
    ['rewritten dirty file', (root) => write(root, 'src/impl.mjs', 'export const shipped = false;\n')],
  ];
  for (const [label, change] of changes) {
    const fixture = await createFixtureRepo();
    try {
      await fixture.lock();
      await write(fixture.root, 'src/impl.mjs', 'export const shipped = true;\n');
      assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE', label);
      await change(fixture.root);
      await assert.rejects(() => closeRelease(fixture.root, { allowUncommitted: true }), isStale, label);
    } finally {
      await fixture.cleanup();
    }
  }
});

// Unchanged dirty bytes still match the evidence; harness runtime files and out-of-scope
// paths that appear after verify (close-uncommitted-attacks) are not a source change.
test('close reuses evidence while the verified dirty tree is unchanged', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await write(fixture.root, 'src/impl.mjs', 'export const shipped = true;\n');
    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    await write(fixture.root, '.shipping/scratch.json', '{}\n');
    await write(fixture.root, 'vendor/outside.mjs', 'export const outside = true;\n');
    const closed = await closeRelease(fixture.root, { allowUncommitted: true });
    assert.equal(closed.state.state, 'CLOSED');
    assert.deepEqual(closed.receipt.uncommittedPaths, ['src/impl.mjs']);
  } finally {
    await fixture.cleanup();
  }
});
