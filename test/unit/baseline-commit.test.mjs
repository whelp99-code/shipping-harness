// v1.13.0 Phase A: the happy paths of the baseline auto-commit. The refusals live in
// test/adversarial/baseline-commit-attacks.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  BASELINE_UNDO_COMMAND,
  baselineCommitMessage,
  baselineCommitSummary,
  collectBaselineChanges,
  commitBaseline,
} from '../../src/core/baseline-commit.mjs';
import { runGit } from '../../src/core/git.mjs';
import { VERSION } from '../../src/version.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return runGit(root, args).stdout.trim();
}

test('a clean tree is a no-op: nothing is committed and HEAD does not move', async () => {
  const fixture = await createFixtureRepo();
  try {
    const before = git(fixture.root, ['rev-parse', 'HEAD']);
    assert.equal(commitBaseline(fixture.root), null);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), before);
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), '');
  } finally {
    await fixture.cleanup();
  }
});

test('tracked modifications are committed and the new SHA is returned', async () => {
  const fixture = await createFixtureRepo();
  try {
    const before = git(fixture.root, ['rev-parse', 'HEAD']);
    await fixture.write('README.md', '# changed by the user\n');
    const result = commitBaseline(fixture.root);
    assert.ok(result);
    assert.match(result.sha, /^[a-f0-9]{40}$/u);
    assert.notEqual(result.sha, before);
    assert.equal(result.sha, git(fixture.root, ['rev-parse', 'HEAD']));
    assert.deepEqual(result.files, ['README.md']);
    assert.deepEqual(result.untrackedIncluded, []);
    assert.equal(result.undo, BASELINE_UNDO_COMMAND);
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), '');
    assert.equal(git(fixture.root, ['show', '-s', '--format=%B', 'HEAD']).trim(), baselineCommitMessage());
    assert.match(baselineCommitMessage(), new RegExp(`Recorded by shipping-harness ${VERSION.replaceAll('.', '\\.')} `, 'u'));
    // The user's own work carries no harness attribution line.
    assert.doesNotMatch(baselineCommitMessage(), /Co-Authored-By|Generated with/u);
  } finally {
    await fixture.cleanup();
  }
});

test('a deletion is captured as a deletion, not left behind as a dirty path', async () => {
  const fixture = await createFixtureRepo();
  try {
    await rm(path.join(fixture.root, 'README.md'));
    const result = commitBaseline(fixture.root);
    assert.deepEqual(result?.files, ['README.md']);
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), '');
    assert.equal(git(fixture.root, ['ls-files', 'README.md']), '');
  } finally {
    await fixture.cleanup();
  }
});

test('safe untracked files are included and reported separately', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('src/index.mjs', 'export function hello() { return "hi"; }\n');
    await fixture.write('README.md', '# both kinds of change\n');
    const result = commitBaseline(fixture.root);
    assert.deepEqual(result?.files, ['README.md', 'src/index.mjs']);
    assert.deepEqual(result?.untrackedIncluded, ['src/index.mjs']);
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), '');
    assert.deepEqual(baselineCommitSummary(result), {
      sha: result.sha,
      filesCommitted: 2,
      untrackedIncluded: 1,
      undo: BASELINE_UNDO_COMMAND,
    });
    assert.equal(baselineCommitSummary(null), null);
  } finally {
    await fixture.cleanup();
  }
});

test('ignored files and .shipping/ runtime state are never collected or committed', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('.gitignore', '.shipping/evidence/\n.shipping/tmp/\nbuild/\nsecret.log\n');
    await fixture.commit('add ignore rules');
    await fixture.write('build/output.js', 'generated\n');
    await fixture.write('secret.log', 'ignored\n');
    await fixture.write('.shipping/proposals/current.json', '{}\n');
    await mkdir(path.join(fixture.root, '.shipping', 'evidence'), { recursive: true });
    await writeFile(path.join(fixture.root, '.shipping', 'evidence', 'run.json'), '{}\n', 'utf8');
    await fixture.write('README.md', '# real work\n');

    const changes = collectBaselineChanges(fixture.root);
    assert.deepEqual(changes.trackedModified, ['README.md']);
    assert.deepEqual(changes.untracked, []);
    assert.ok(changes.shippingSkipped.includes('.shipping/proposals/current.json'));
    assert.ok(!changes.shippingSkipped.includes('.shipping/evidence/run.json'), 'ignored .shipping paths never reach git at all');

    const result = commitBaseline(fixture.root);
    assert.deepEqual(result?.files, ['README.md']);
    const committed = git(fixture.root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    assert.deepEqual(committed, ['README.md']);
    // Everything excluded is still exactly where the user left it.
    assert.equal(await fixture.read('build/output.js'), 'generated\n');
    assert.equal(await fixture.read('.shipping/proposals/current.json'), '{}\n');
  } finally {
    await fixture.cleanup();
  }
});

test('a file the user staged by hand is committed, and .shipping/ staged by hand is not', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('src/staged.mjs', 'export const staged = true;\n');
    await fixture.write('.shipping/state.json', `${JSON.stringify({ tampered: true })}\n`);
    runGit(fixture.root, ['add', '--', 'src/staged.mjs', '.shipping/state.json']);
    const result = commitBaseline(fixture.root);
    assert.deepEqual(result?.files, ['src/staged.mjs']);
    assert.deepEqual(result?.untrackedIncluded, ['src/staged.mjs']);
    const committed = git(fixture.root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    assert.deepEqual(committed, ['src/staged.mjs']);
    assert.equal(git(fixture.root, ['diff', '--cached', '--name-only']), '');
  } finally {
    await fixture.cleanup();
  }
});

test('the undo command restores exactly the pre-commit tree', async () => {
  const fixture = await createFixtureRepo();
  try {
    const before = git(fixture.root, ['rev-parse', 'HEAD']);
    await fixture.write('README.md', '# undo me\n');
    const beforeStatus = git(fixture.root, ['status', '--porcelain=v1']);
    assert.ok(commitBaseline(fixture.root));
    runGit(fixture.root, ['reset', '--soft', 'HEAD~1']);
    runGit(fixture.root, ['reset', '-q']);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), before);
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), beforeStatus);
  } finally {
    await fixture.cleanup();
  }
});
