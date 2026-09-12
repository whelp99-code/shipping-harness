// v1.10.0 Phase B.1: a failed REQUIRED acceptance criterion is replayed once against the
// locked baseline commit. Failing identically there, while the working tree does hold
// in-scope changes, means the contract (not the implementation) is the defect. The gate
// verdict never softens: the issue stays a BLOCKER and only carries a diagnostic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runGit } from '../../src/core/git.mjs';
import { releaseStatus, verifyRelease } from '../../src/core/gate.mjs';
import { renderStatus } from '../../src/cli/output.mjs';
import { buildUserStatusView } from '../../src/mcp/user-view.mjs';

/** @param {Record<string, any>} issues */
function defectDiagnostic(issues) {
  for (const issue of issues) {
    const found = (issue.diagnostics ?? []).find((entry) => entry?.code === 'CONTRACT_DEFECT_SUSPECTED');
    if (found) return { issue, diagnostic: found };
  }
  return null;
}

/** @param {string} root */
async function noLeftoverWorktree(root) {
  const entries = await readdir(path.join(root, '.shipping', 'tmp')).catch(() => []);
  assert.deepEqual(entries.filter((name) => name.startsWith('baseline-replay-')), [], 'baseline replay worktree was not removed');
  const list = runGit(root, ['worktree', 'list', '--porcelain']).stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '));
  assert.equal(list.length, 1, `expected exactly one worktree, saw ${list.join(' | ')}`);
}

test('a criterion that also fails on the baseline is flagged CONTRACT_DEFECT_SUSPECTED and stays BLOCKER', async () => {
  // The test script points at a runner that does not exist, so the command fails
  // identically before and after any implementation: an unsatisfiable contract.
  const fixture = await createFixtureRepo({ testScript: 'node ./definitely-missing-runner.mjs' });
  try {
    await fixture.lock();
    await mkdir(path.join(fixture.root, 'src'), { recursive: true });
    await writeFile(path.join(fixture.root, 'src', 'feature.mjs'), 'export const feature = true;\n', 'utf8');
    await fixture.commit('implement in scope');

    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    const found = defectDiagnostic(result.issues.issues);
    assert.ok(found, 'expected a CONTRACT_DEFECT_SUSPECTED diagnostic');
    assert.equal(found.issue.classification, 'BLOCKER', 'classification must stay BLOCKER');
    assert.equal(found.issue.basisId, 'AC-001');
    assert.match(found.diagnostic.detail, /also fails on the baseline commit/u);
    assert.equal(found.diagnostic.baselineExitCode, 1);

    // The replay is recorded in the evidence manifest and in the verify result.
    assert.equal(result.baselineReplay.replays.length, 1);
    assert.equal(result.baselineReplay.replays[0].id, 'AC-001');
    assert.equal(result.baselineReplay.replays[0].suspected, true);
    const manifestPath = path.join(fixture.root, '.shipping', 'evidence', result.manifest.runId, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.results[0].baselineReplay.id, 'AC-001');
    assert.equal(typeof manifest.results[0].baselineReplay.durationMs, 'number');

    // The diagnostic reaches `status` text, the MCP status view, and the plain brief.
    const status = await releaseStatus(fixture.root);
    assert.match(renderStatus(status), /CONTRACT_DEFECT_SUSPECTED: acceptance AC-001 also fails on the baseline commit/u);
    const brief = buildUserStatusView({ ...status, initialized: true })
      .briefFactGraph.facts.find((entry) => entry.code === 'CONTRACT_DEFECT_SUSPECTED');
    assert.deepEqual(brief.value, { count: 1, criteria: ['AC-001'] });

    await noLeftoverWorktree(fixture.root);
  } finally {
    await fixture.cleanup();
  }
});

test('an uncommitted in-scope implementation still replays against the baseline and is flagged', async () => {
  // The live replay this fix pass came from: the implementation stayed in the working tree,
  // so HEAD was still the baseline commit and the replay was skipped as `baseline-is-head` —
  // CONTRACT_DEFECT_SUSPECTED was never raised even though the criterion fails on the clean
  // baseline too. HEAD == baseline is only a true skip when no in-scope path is dirty.
  const fixture = await createFixtureRepo({ testScript: 'node ./definitely-missing-runner.mjs' });
  try {
    await fixture.lock();
    await mkdir(path.join(fixture.root, 'src'), { recursive: true });
    await writeFile(path.join(fixture.root, 'src', 'feature.mjs'), 'export const feature = true;\n', 'utf8');
    // Deliberately NOT committed.

    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(result.baselineReplay.skipped, null, 'the replay must run against the dirty tree');
    assert.equal(result.baselineReplay.baselineSha, result.manifest.gitSha, 'HEAD is still the baseline commit');
    assert.equal(result.baselineReplay.replays[0].suspected, true);

    const found = defectDiagnostic(result.issues.issues);
    assert.ok(found, 'expected a CONTRACT_DEFECT_SUSPECTED diagnostic');
    assert.equal(found.issue.classification, 'BLOCKER');
    assert.equal(found.issue.basisId, 'AC-001');

    // The evidence names the tree it actually ran against, not the baseline commit alone.
    assert.deepEqual(result.manifest.dirtyPaths, ['src/feature.mjs']);
    assert.match(result.manifest.treeFingerprint, /^[a-f0-9]{64}$/u);

    await noLeftoverWorktree(fixture.root);
  } finally {
    await fixture.cleanup();
  }
});

test('a criterion that fails only because the implementation is wrong carries no diagnostic', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node ./src/check.mjs' });
  try {
    // The check passes on the baseline tree and is broken only by the implementation.
    await mkdir(path.join(fixture.root, 'src'), { recursive: true });
    await writeFile(path.join(fixture.root, 'src', 'check.mjs'), 'process.exit(0);\n', 'utf8');
    await fixture.commit('add passing check');
    await fixture.lock();
    await writeFile(path.join(fixture.root, 'src', 'check.mjs'), 'process.exit(1);\n', 'utf8');
    await fixture.commit('break the implementation');

    const result = await verifyRelease(fixture.root);
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(defectDiagnostic(result.issues.issues), null);
    assert.equal(result.baselineReplay.replays.length, 1);
    assert.equal(result.baselineReplay.replays[0].suspected, false);
    await noLeftoverWorktree(fixture.root);
  } finally {
    await fixture.cleanup();
  }
});

test('baselineReplay: false skips the replay entirely', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node ./definitely-missing-runner.mjs' });
  try {
    await fixture.lock();
    await mkdir(path.join(fixture.root, 'src'), { recursive: true });
    await writeFile(path.join(fixture.root, 'src', 'feature.mjs'), 'export const feature = true;\n', 'utf8');
    await fixture.commit('implement in scope');

    const result = await verifyRelease(fixture.root, { baselineReplay: false });
    assert.equal(result.decision, 'TRIAGE');
    assert.equal(result.baselineReplay.skipped, 'disabled');
    assert.deepEqual(result.baselineReplay.replays, []);
    assert.equal(defectDiagnostic(result.issues.issues), null);
    const manifestPath = path.join(fixture.root, '.shipping', 'evidence', result.manifest.runId, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.results[0].baselineReplay, undefined);
    await noLeftoverWorktree(fixture.root);
  } finally {
    await fixture.cleanup();
  }
});

test('the replay is skipped when the verified tree is the clean baseline commit', async () => {
  const fixture = await createFixtureRepo({ testScript: 'node ./definitely-missing-runner.mjs' });
  try {
    await fixture.lock();
    const result = await verifyRelease(fixture.root);
    assert.equal(result.baselineReplay.skipped, 'clean-baseline');
    assert.deepEqual(result.baselineReplay.replays, []);
    assert.equal(defectDiagnostic(result.issues.issues), null);
    await noLeftoverWorktree(fixture.root);
  } finally {
    await fixture.cleanup();
  }
});
