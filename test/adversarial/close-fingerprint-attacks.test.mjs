// v1.13.20: close must not attest HEAD using evidence from a discarded working tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { ShippingError } from '../../src/core/errors.mjs';

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
