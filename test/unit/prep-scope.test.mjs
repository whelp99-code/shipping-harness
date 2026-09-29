import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';

test('approved prep authors test and start, rescan sees them, and contract.yaml is not edited', async () => {
  const fixture = await createFixtureRepo();
  try {
    const before = await fixture.read('.shipping/contract.yaml');
    const approved = runCli(fixture.root, ['prep', 'approve', '--approver', 'operator', '--path', 'package.json,test/**', '--json']);
    assert.equal(approved.exitCode, 0, approved.stderr);
    assert.equal(parseCliJson(approved).modelAuthority, false);
    await fixture.write('seed.test.mjs', 'test("named", () => {});\n');
    const authored = runCli(fixture.root, [
      'prep', 'author', '--kind', 'test', '--script', 'node --test test/outcome.test.mjs',
      '--file', 'test/outcome.test.mjs', '--contents-file', path.join(fixture.root, 'seed.test.mjs'), '--json',
    ]);
    assert.equal(authored.exitCode, 0, authored.stderr);
    const started = runCli(fixture.root, ['prep', 'author', '--kind', 'start', '--script', 'node server.mjs', '--json']);
    assert.equal(started.exitCode, 0, started.stderr);
    const rescanned = runCli(fixture.root, ['prep', 'rescan', '--json']);
    assert.equal(rescanned.exitCode, 0, rescanned.stderr);
    const found = parseCliJson(rescanned);
    assert.equal(found.contractWritten, false);
    assert.equal(found.test, 'npm test');
    assert.equal(found.start.command, 'npm start');
    assert.equal(await fixture.read('.shipping/contract.yaml'), before);
    const refused = runCli(fixture.root, [
      'prep', 'author', '--kind', 'test', '--script', 'node sneak.mjs', '--file', 'src/sneak.mjs', '--json',
    ]);
    assert.notEqual(refused.exitCode, 0);
    assert.match(`${refused.stderr}${refused.stdout}`, /ERR_PREP_SCOPE/u);
  } finally {
    await fixture.cleanup();
  }
});
