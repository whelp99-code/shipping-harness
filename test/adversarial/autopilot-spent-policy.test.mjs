// v1.13.8: reported from a live release that could not escape. A policy approved for
// 1.0.2 stayed "active" after that release closed, so approving 1.0.3 failed with
// ERR_AUTOPILOT_ACTIVE *after* the scope was already locked, and verify on 1.0.3 was then
// stopped by STALE_POLICY_BINDING. approve refused because the state was LOCKED and verify
// refused because of the spent policy: there was no way out.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { assertAutopilotActivatable, isSpentAutopilotBinding } from '../../src/core/autopilot.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

/** Write the closure receipt that proves a release actually closed. */
async function writeReceipt(root, release) {
  const releases = runtimePaths(root).releases;
  await mkdir(releases, { recursive: true });
  await writeFile(path.join(releases, `${release}.json`), `${JSON.stringify({ release, state: 'CLOSED' }, null, 2)}\n`, 'utf8');
}

test('a policy bound to a release that has closed is spent', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeReceipt(fixture.root, '1.0.2');
    assert.equal(await isSpentAutopilotBinding(fixture.root, '1.0.2', '1.0.3'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('a binding that names the current release is never treated as spent', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeReceipt(fixture.root, '1.0.2');
    assert.equal(await isSpentAutopilotBinding(fixture.root, '1.0.2', '1.0.2'), false, 'same release is not a lifecycle move');
  } finally {
    await fixture.cleanup();
  }
});

test('a binding to a release with no closure receipt still fails closed', async () => {
  const fixture = await createFixtureRepo();
  try {
    // No receipt: the release never closed, so this is staleness or tampering, not lifecycle.
    assert.equal(await isSpentAutopilotBinding(fixture.root, '1.0.2', '1.0.3'), false);
  } finally {
    await fixture.cleanup();
  }
});

test('an activation that cannot succeed is refused before anything is locked', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { writeJsonAtomic, readJson } = await import('../../src/core/fs.mjs');
    const { hashObject } = await import('../../src/core/crypto.mjs');
    // A real, schema-valid state left behind by an earlier release, hashed the way the
    // loader verifies it so this exercises the production validation path.
    const example = await readJson(path.join(process.cwd(), 'schemas/v1/examples/autopilot-state.example.json'));
    const { hash: _ignored, ...body } = { ...example, currentRelease: '1.0.2', phase: 'TRAIN_READY' };
    await writeJsonAtomic(runtimePaths(fixture.root).autopilotState, { ...body, hash: hashObject(body) });
    await assert.rejects(
      () => assertAutopilotActivatable(fixture.root, '1.0.3'),
      (error) => {
        assert.equal(error.code, 'ERR_AUTOPILOT_ACTIVE');
        assert.match(error.message, /nothing was approved or locked/u, 'the caller must learn the state is untouched');
        assert.equal(error.details.activeRelease, '1.0.2');
        return true;
      },
    );

    // Once that release closes, the policy is spent and the next approval may proceed.
    await writeReceipt(fixture.root, '1.0.2');
    await assertAutopilotActivatable(fixture.root, '1.0.3');
  } finally {
    await fixture.cleanup();
  }
});
