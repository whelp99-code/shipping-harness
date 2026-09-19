// v1.13.10: `release prepare` built the next contract as `{...current, release, goal}`,
// so every draft was born carrying the previous release's scope statements and path
// allowlist. This repository carried v1.8.2's scope as far as v1.13.8, where work done
// after the lock finally made it visible as seven scope blockers and an amendment. The
// symptom is invisible whenever implementation precedes the lock, which is exactly how
// this repository works, so it sat there for many releases.
//
// Emptying the allowlist is not enough on its own: analyzeScope reads an empty include
// list as "no restriction", so a silently stale scope would have become a silently
// absent one. The lock refuses an unstated scope, which is what makes the reset safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScope } from '../../src/core/glob.mjs';
import { loadContract } from '../../src/core/contract.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { prepareNextRelease } from '../../src/core/release-transition.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function closedFixture() {
  const fixture = await createFixtureRepo();
  await fixture.lock();
  await verifyRelease(fixture.root);
  await closeRelease(fixture.root);
  await fixture.commit('chore: commit the closed release receipts');
  return fixture;
}

test('an empty include list means no restriction, which is why the reset needs the lock check', () => {
  const unrestricted = analyzeScope(['anything/at/all.mjs'], { include: [], exclude: [] });
  assert.deepEqual(unrestricted.violations, [], 'an empty allowlist permits everything; this is the trap');
  const restricted = analyzeScope(['anything/at/all.mjs'], { include: ['src/**'], exclude: [] });
  assert.equal(restricted.violations[0].reason, 'outside-include');
});

test('a prepared release does not inherit the previous release scope', async () => {
  const fixture = await closedFixture();
  try {
    const before = await loadContract(runtimePaths(fixture.root).contract);
    assert.ok(before.scope.paths.include.length > 0, 'the fixture starts with a real allowlist');
    await prepareNextRelease(fixture.root, { release: '9.9.9', goal: 'Prove the next draft starts with its own scope.' });
    const after = await loadContract(runtimePaths(fixture.root).contract);
    assert.deepEqual(after.scope.include, []);
    assert.deepEqual(after.scope.exclude, []);
    assert.deepEqual(after.scope.paths.include, []);
    assert.deepEqual(after.scope.paths.exclude, before.scope.paths.exclude, 'the structural denial list is not release-specific and stays');
    assert.equal(after.release, '9.9.9');
  } finally {
    await fixture.cleanup();
  }
});

test('a draft that never states its scope cannot be locked', async () => {
  const fixture = await closedFixture();
  try {
    await prepareNextRelease(fixture.root, { release: '9.9.9', goal: 'Prove an unstated scope refuses.' });
    await assert.rejects(async () => fixture.lock(), (error) => {
      assert.equal(error.code, 'ERR_SCOPE_UNSTATED');
      assert.match(error.message, /not a narrow scope, it is no restriction at all/u);
      return true;
    });
  } finally {
    await fixture.cleanup();
  }
});

test('stating the scope makes the prepared release lockable again', async () => {
  const fixture = await closedFixture();
  try {
    await prepareNextRelease(fixture.root, { release: '9.9.9', goal: 'Prove a stated scope locks.' });
    const paths = runtimePaths(fixture.root);
    const contract = await loadContract(paths.contract);
    contract.scope.include = ['Prove that a release which states its own scope can be locked.'];
    contract.scope.paths.include = ['src/**', 'test/**'];
    const { stableStringify } = await import('../../src/core/crypto.mjs');
    const { writeAtomic } = await import('../../src/core/fs.mjs');
    await writeAtomic(paths.contract, stableStringify(contract));
    await fixture.commit('docs: state the 9.9.9 scope');
    const locked = await fixture.lock();
    assert.equal(locked.lock.release, '9.9.9');
  } finally {
    await fixture.cleanup();
  }
});
