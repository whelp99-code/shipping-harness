// v1.10.0 fix pass: evidence used to be attributed to HEAD alone. A model that implements
// a feature without committing runs the acceptance commands against a tree HEAD does not
// contain, and the manifest still named the baseline commit — and stayed "fresh" while the
// tree kept changing. `treeFingerprint()` identifies the tree that actually ran: HEAD plus
// every working-tree deviation from it, with `.shipping/` runtime output excluded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runGit, treeFingerprint } from '../../src/core/git.mjs';
import { assertFreshEvidence, loadEvidence } from '../../src/core/evidence.mjs';
import { readState } from '../../src/core/state.mjs';
import { verifyRelease, releaseStatus } from '../../src/core/gate.mjs';
import { renderStatus } from '../../src/cli/output.mjs';

/** @param {string} root @param {string} relative @param {string} content */
async function write(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('an untracked file changes the fingerprint and is listed as a dirty path', async () => {
  const fixture = await createFixtureRepo();
  try {
    const clean = treeFingerprint(fixture.root);
    assert.deepEqual(clean.dirtyPaths, []);
    assert.match(clean.fingerprint, /^[a-f0-9]{64}$/u);

    await write(fixture.root, 'src/feature.mjs', 'export const feature = true;\n');
    const dirty = treeFingerprint(fixture.root);
    assert.deepEqual(dirty.dirtyPaths, ['src/feature.mjs']);
    assert.notEqual(dirty.fingerprint, clean.fingerprint);
    assert.equal(dirty.headSha, clean.headSha, 'HEAD did not move');

    await rm(path.join(fixture.root, 'src', 'feature.mjs'));
    assert.equal(treeFingerprint(fixture.root).fingerprint, clean.fingerprint, 'removing it restores the clean fingerprint');
  } finally {
    await fixture.cleanup();
  }
});

test('editing a tracked file changes the fingerprint; staging the same content does not', async () => {
  const fixture = await createFixtureRepo();
  try {
    const clean = treeFingerprint(fixture.root);
    await write(fixture.root, 'README.md', '# Fixture edited\n');
    const edited = treeFingerprint(fixture.root);
    assert.deepEqual(edited.dirtyPaths, ['README.md']);
    assert.notEqual(edited.fingerprint, clean.fingerprint);

    // Whether the change is staged is irrelevant: the working copy is what ran.
    runGit(fixture.root, ['add', 'README.md']);
    const staged = treeFingerprint(fixture.root);
    assert.equal(staged.fingerprint, edited.fingerprint);
    assert.deepEqual(staged.dirtyPaths, ['README.md']);

    // A second distinct edit changes it again.
    await write(fixture.root, 'README.md', '# Fixture edited twice\n');
    assert.notEqual(treeFingerprint(fixture.root).fingerprint, edited.fingerprint);
  } finally {
    await fixture.cleanup();
  }
});

test('.shipping/ runtime writes never change the fingerprint', async () => {
  const fixture = await createFixtureRepo();
  try {
    const clean = treeFingerprint(fixture.root);
    await write(fixture.root, '.shipping/notes.json', '{"runtime":true}\n');
    await write(fixture.root, '.shipping/evidence/run-x/manifest.json', '{}\n');
    const after = treeFingerprint(fixture.root);
    assert.equal(after.fingerprint, clean.fingerprint);
    assert.deepEqual(after.dirtyPaths, []);
  } finally {
    await fixture.cleanup();
  }
});

test('in-scope dirty paths are reported separately from the full dirty list', async () => {
  const fixture = await createFixtureRepo();
  try {
    await write(fixture.root, 'src/feature.mjs', 'export const feature = true;\n');
    await write(fixture.root, 'vendor/outside.mjs', 'export const nope = true;\n');
    const measured = treeFingerprint(fixture.root, { include: ['src/**'], exclude: [] });
    assert.deepEqual(measured.dirtyPaths, ['src/feature.mjs', 'vendor/outside.mjs']);
    assert.deepEqual(measured.inScopeDirtyPaths, ['src/feature.mjs']);
  } finally {
    await fixture.cleanup();
  }
});

test('evidence records the tree it ran against and goes stale on a working-tree edit without a commit', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await write(fixture.root, 'src/impl.mjs', 'export const shipped = true;\n');

    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'SHIPPABLE');
    const manifest = await loadEvidence(fixture.root, result.manifest.runId);
    assert.deepEqual(manifest.dirtyPaths, ['src/impl.mjs'], 'the manifest names the uncommitted work it tested');
    assert.equal(manifest.treeFingerprint, treeFingerprint(fixture.root).fingerprint);

    const state = await readState(fixture.root);
    assert.equal(state.currentEvidenceFingerprint, manifest.treeFingerprint);
    assert.equal((await releaseStatus(fixture.root)).evidenceFresh, true);

    // Editing the implementation without committing invalidates the evidence at the same SHA.
    await write(fixture.root, 'src/impl.mjs', 'export const shipped = false;\n');
    const now = treeFingerprint(fixture.root);
    assert.equal(now.headSha, manifest.gitSha, 'HEAD is unchanged');
    assert.throws(
      () => assertFreshEvidence(manifest, {
        contractHash: manifest.contractHash,
        gitSha: manifest.gitSha,
        treeFingerprint: now.fingerprint,
      }),
      (error) => error.code === 'ERR_EVIDENCE_STALE',
    );

    const status = await releaseStatus(fixture.root);
    assert.equal(status.evidenceFresh, false, 'status stops calling the evidence fresh');
    assert.equal(status.evidenceDirty.dirtyPaths.length, 1);
    assert.match(renderStatus(status), /evidence: dirty \(1 uncommitted paths\)/u);
  } finally {
    await fixture.cleanup();
  }
});
