import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { executeCoreHost, probeCoreHost } from '../../src/core/host.mjs';
import { verifyRelease } from '../../src/core/gate.mjs';

test('generic host execution produces evidence and requires verification', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { contract } = await fixture.lock();
    const probe = probeCoreHost('generic', contract);
    assert.equal(probe.capabilities.execute, true);
    const run = await executeCoreHost(fixture.root, {
      host: 'generic',
      command: `node -e "console.log('agent-finished')"`,
    });
    assert.equal(run.result.exitCode, 0);
    assert.equal(typeof run.commandDigest, 'string');
    assert.equal(run.commandDigest.length, 64);
    assert.equal('command' in run, false);
    const verification = await verifyRelease(fixture.root);
    assert.equal(verification.decision, 'SHIPPABLE');
  } finally {
    await fixture.cleanup();
  }
});