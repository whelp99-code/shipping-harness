// v1.13.0 Phase B: commits made after the scope was locked are absorbed into the release
// diff and were invisible in the receipt. They are now recorded. This is evidence, not a
// gate: nothing here may block a close.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeRelease, releaseStatus, verifyRelease } from '../../src/core/gate.mjs';
import { commitsBetween, currentGitSha } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

test('two commits after lock appear in the receipt with their subjects and paths', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { sha: baselineSha } = await fixture.lock();
    await fixture.write('src/first.mjs', 'export const first = 1;\n');
    await fixture.commit('feat: add the first in-scope module');
    await fixture.write('src/second.mjs', 'export const second = 2;\n');
    await fixture.write('docs/notes.md', '# notes\n');
    await fixture.commit('docs: add notes alongside the second module');

    assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
    const closed = await closeRelease(fixture.root);
    const recorded = closed.receipt.postLockCommits;
    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded.map((entry) => entry.subject), [
      'docs: add notes alongside the second module',
      'feat: add the first in-scope module',
    ]);
    for (const entry of recorded) assert.match(entry.sha, /^[a-f0-9]{40}$/u);
    assert.deepEqual(recorded[0].paths, ['docs/notes.md', 'src/second.mjs']);
    assert.deepEqual(recorded[1].paths, ['src/first.mjs']);
    assert.equal(closed.receipt.postLockCommitsTruncated, undefined);
    assert.equal(closed.receipt.baselineSha, baselineSha);
    assert.equal(closed.state.state, 'CLOSED', 'recording post-lock commits never blocks a close');

    const report = await fixture.read(`.shipping/releases/${closed.receipt.release}.md`);
    assert.match(report, /- Commits after lock: 2\n/u);
    assert.match(report, /## Commits after lock/u);
    assert.match(report, /feat: add the first in-scope module/u);
  } finally {
    await fixture.cleanup();
  }
});

test('a release with no commit after lock records an empty list, not a missing field', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    const closed = await closeRelease(fixture.root);
    assert.deepEqual(closed.receipt.postLockCommits, []);
    assert.equal(closed.receipt.postLockCommitsTruncated, undefined);
    const report = await fixture.read(`.shipping/releases/${closed.receipt.release}.md`);
    assert.match(report, /- Commits after lock: 0\n/u);
    assert.match(report, /No commit was made after the scope was locked/u);
  } finally {
    await fixture.cleanup();
  }
});

test('the record is bounded: 50 commits, 20 paths per commit, 120-character subjects', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { sha: baselineSha } = await fixture.lock();
    for (let index = 0; index < 4; index += 1) {
      await fixture.write(`src/module-${index}.mjs`, `export const value = ${index};\n`);
      await fixture.commit(`feat: ${'x'.repeat(200)} ${index}`);
    }
    for (let index = 0; index < 25; index += 1) {
      await fixture.write(`src/wide/file-${index}.mjs`, `export const wide = ${index};\n`);
    }
    await fixture.commit('feat: one commit touching twenty-five files');

    const bounded = commitsBetween(fixture.root, baselineSha, currentGitSha(fixture.root), {
      maxCommits: 2,
      maxPaths: 20,
      maxSubject: 120,
    });
    assert.equal(bounded.commits.length, 2);
    assert.equal(bounded.truncated, 3);
    assert.equal(bounded.commits[0].paths.length, 20);
    assert.equal(bounded.commits[0].pathsTruncated, 5);
    assert.equal(bounded.commits[1].subject.length, 120);

    // The production defaults keep all five commits and truncate only the wide path list.
    const defaults = commitsBetween(fixture.root, baselineSha, currentGitSha(fixture.root));
    assert.equal(defaults.commits.length, 5);
    assert.equal(defaults.truncated, 0);
    assert.equal(defaults.commits[0].pathsTruncated, 5);
  } finally {
    await fixture.cleanup();
  }
});

test('status reports commitsSinceLock and reports null before a lock exists', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal((await releaseStatus(fixture.root)).commitsSinceLock, null, 'DRAFT has no lock baseline to count from');
    await fixture.lock();
    assert.equal((await releaseStatus(fixture.root)).commitsSinceLock, 0);
    await fixture.write('src/after.mjs', 'export const after = true;\n');
    await fixture.commit('feat: work after the lock');
    assert.equal((await releaseStatus(fixture.root)).commitsSinceLock, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('an unresolvable baseline degrades to an empty record rather than throwing', async () => {
  const fixture = await createFixtureRepo();
  try {
    const result = commitsBetween(fixture.root, '0'.repeat(40), currentGitSha(fixture.root));
    assert.deepEqual(result, { commits: [], truncated: 0 });
  } finally {
    await fixture.cleanup();
  }
});
