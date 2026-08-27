import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { exists } from '../../src/core/fs.mjs';
import { loadContract, lockContract } from '../../src/core/contract.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { compareSemver, prepareNextRelease } from '../../src/core/release-transition.mjs';
import { readState, transitionState } from '../../src/core/state.mjs';

async function closeFixture(root) {
  const sha = currentGitSha(root);
  const { contract, lock } = await lockContract(root, sha);
  await transitionState(root, 'LOCKED', {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: sha,
  }, 'test lock');
  const verification = await verifyRelease(root);
  assert.equal(verification.decision, 'SHIPPABLE');
  await closeRelease(root);
}

test('semantic version comparison orders stable and prerelease versions', () => {
  assert.equal(compareSemver('0.2.0', '0.1.9'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('1.0.0-beta.2', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
});

test('closed release can archive its contract and prepare a greater DRAFT version', async () => {
  const fixture = await createFixtureRepo();
  try {
    await closeFixture(fixture.root);
    const result = await prepareNextRelease(fixture.root, {
      release: '0.2.0',
      goal: 'Exercise the official next-release transition.',
    });
    assert.equal(result.fromRelease, '0.1.0');
    assert.equal(result.state, 'DRAFT');
    const contract = await loadContract(runtimePaths(fixture.root).contract);
    const state = await readState(fixture.root);
    assert.equal(contract.release, '0.2.0');
    assert.equal(contract.goal, 'Exercise the official next-release transition.');
    assert.equal(state.state, 'DRAFT');
    assert.equal(state.previousRelease, '0.1.0');
    assert.equal(await exists(runtimePaths(fixture.root).lock), false);
    assert.equal(await exists(result.archivedContract), true);
    assert.equal(await exists(result.archivedLock), true);
  } finally {
    await fixture.cleanup();
  }
});

test('next release preparation rejects a non-increasing version', async () => {
  const fixture = await createFixtureRepo();
  try {
    await closeFixture(fixture.root);
    await assert.rejects(
      () => prepareNextRelease(fixture.root, { release: '0.1.0' }),
      { code: 'ERR_RELEASE_VERSION' },
    );
  } finally {
    await fixture.cleanup();
  }
});