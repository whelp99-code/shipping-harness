import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeBaseline } from '../../src/core/baseline.mjs';
import { createScopeProposal, refineScopeProposal } from '../../src/core/proposals.mjs';
import { SHIPPING_TOOLS, callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const goal = 'Ship one bounded and mechanically verified fixture release';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('dirty classifier separates product, release evidence, agent runtime, shipping runtime, generated, and unknown safely', async () => {
  const fixture = await createFixtureRepo();
  try {
    const baseline = analyzeBaseline(fixture.root, [
      ' M README.md',
      ' M RELEASE_MANIFEST.json',
      '?? .omo/session.json',
      ' M .omo/project-policy.json',
      '?? .shipping/proposals/current.json',
      '?? .DS_Store',
      ' M dist/checked-in.js',
      '?? ../escape',
    ]);
    const byPath = new Map(baseline.entries.map((entry) => [entry.path, entry]));
    assert.deepEqual([byPath.get('README.md').category, byPath.get('README.md').blocking], ['PRODUCT', true]);
    assert.deepEqual([byPath.get('RELEASE_MANIFEST.json').category, byPath.get('RELEASE_MANIFEST.json').blocking], ['RELEASE_EVIDENCE', true]);
    assert.deepEqual([byPath.get('.omo/session.json').category, byPath.get('.omo/session.json').blocking], ['AGENT_RUNTIME', false]);
    assert.deepEqual([byPath.get('.omo/project-policy.json').category, byPath.get('.omo/project-policy.json').blocking], ['AGENT_RUNTIME', true]);
    assert.deepEqual([byPath.get('.shipping/proposals/current.json').category, byPath.get('.shipping/proposals/current.json').blocking], ['SHIPPING_RUNTIME', false]);
    assert.deepEqual([byPath.get('.DS_Store').category, byPath.get('.DS_Store').blocking], ['GENERATED', false]);
    assert.deepEqual([byPath.get('dist/checked-in.js').category, byPath.get('dist/checked-in.js').blocking], ['GENERATED', true]);
    assert.deepEqual([byPath.get('../escape').category, byPath.get('../escape').blocking], ['UNKNOWN', true]);
    assert.ok(baseline.blockingPaths.includes('../escape'));
    assert.ok(!baseline.blockingPaths.includes('.omo/session.json'));
  } finally {
    await fixture.cleanup();
  }
});

test('dirty proposal exposes one bounded preservation plan and one non-destructive next action', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeFile(path.join(fixture.root, 'README.md'), '# existing product work\n', 'utf8');
    await mkdir(path.join(fixture.root, '.omo'), { recursive: true });
    await writeFile(path.join(fixture.root, '.omo', 'session.json'), '{}\n', 'utf8');
    // v1.13.0 Phase A: the reviewed baseline-preservation flow is what commitBaseline:false
    // preserves, so this steward test opts out of the auto-commit deliberately.
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0', commitBaseline: false });
    const proposal = started.structuredContent;
    assert.equal(proposal.proposalState, 'DIRTY_BASELINE');
    assert.equal(proposal.nextAction, 'REVIEW_BASELINE');
    assert.deepEqual(proposal.baseline.blockingPaths, ['README.md']);
    assert.deepEqual(proposal.baseline.plan.includePaths, ['README.md']);
    assert.ok(proposal.baseline.plan.excludePaths.some((entry) => entry === '.omo/' || entry === '.omo/session.json'));
    assert.match(proposal.baseline.plan.hash, /^[a-f0-9]{64}$/u);
    assert.equal(proposal.userView.actions.includes('preserve-baseline'), true);
    assert.equal(proposal.userView.actions.some((entry) => /discard|reset|stash/u.test(entry)), false);
    assert.doesNotMatch(started.content[0].text, /discard|폐기/u);
    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.pendingProposal.nextAction, 'REVIEW_BASELINE');
    assert.equal(status.structuredContent.userView.nextActionCode, 'REVIEW_BASELINE');
    assert.equal(status.structuredContent.userView.baseline.plan.hash, proposal.baseline.plan.hash);
  } finally {
    await fixture.cleanup();
  }
});

test('explicit host-side baseline commit is hash-bound, keeps proposal identity, and rescans to approval readiness', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeFile(path.join(fixture.root, 'README.md'), '# reviewed baseline\n', 'utf8');
    const { proposal } = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    assert.equal(proposal.canonicalState, 'DIRTY_BASELINE');
    const plan = proposal.baseline.plan;
    git(fixture.root, ['add', '--', ...plan.includePaths]);
    git(fixture.root, ['commit', '-m', plan.suggestedCommitMessage]);
    const commit = git(fixture.root, ['rev-parse', 'HEAD']);

    await assert.rejects(
      refineScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, rescan: true }),
      (error) => error.code === 'ERR_BASELINE_APPROVAL',
    );
    await assert.rejects(
      refineScopeProposal(fixture.root, {
        proposalId: proposal.id,
        proposalHash: proposal.hash,
        rescan: true,
        baselinePlanHash: '0'.repeat(64),
        baselineCommit: commit,
        baselineAuthorizedByUser: true,
      }),
      (error) => error.code === 'ERR_BASELINE_DRIFT',
    );

    const refined = await refineScopeProposal(fixture.root, {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      rescan: true,
      baselinePlanHash: plan.hash,
      baselineCommit: commit,
      baselineAuthorizedByUser: true,
    });
    assert.equal(refined.changed, true);
    assert.equal(refined.proposal.id, proposal.id);
    assert.equal(refined.proposal.revision, 2);
    assert.equal(refined.proposal.previousHash, proposal.hash);
    assert.equal(refined.proposal.canonicalState, 'READY_FOR_APPROVAL');
    assert.equal(refined.proposal.baseline.blockingCount, 0);
    assert.equal(refined.proposal.baselinePreservation.commit, commit);
    assert.deepEqual(refined.proposal.baselinePreservation.paths, plan.includePaths);
  } finally {
    await fixture.cleanup();
  }
});

test('baseline preservation fails closed when committed paths differ from the reviewed set', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeFile(path.join(fixture.root, 'README.md'), '# changed\n', 'utf8');
    await writeFile(path.join(fixture.root, 'extra.js'), 'export const value = 1;\n', 'utf8');
    const { proposal } = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    assert.deepEqual(proposal.baseline.plan.includePaths, ['README.md', 'extra.js']);
    git(fixture.root, ['add', '--', 'README.md']);
    git(fixture.root, ['commit', '-m', 'chore: incomplete baseline']);
    const commit = git(fixture.root, ['rev-parse', 'HEAD']);
    await assert.rejects(
      refineScopeProposal(fixture.root, {
        proposalId: proposal.id,
        proposalHash: proposal.hash,
        rescan: true,
        baselinePlanHash: proposal.baseline.plan.hash,
        baselineCommit: commit,
        baselineAuthorizedByUser: true,
      }),
      (error) => error.code === 'ERR_BASELINE_DRIFT',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('nine-tool surface exposes no Git mutation command through the baseline handshake', () => {
  assert.equal(SHIPPING_TOOLS.length, 9);
  const refine = SHIPPING_TOOLS.find((tool) => tool.name === 'shipping_refine');
  assert.ok(refine);
  const keys = Object.keys(refine.inputSchema.properties);
  assert.ok(keys.includes('baselinePlanHash'));
  assert.ok(keys.includes('baselineCommit'));
  assert.ok(keys.includes('baselineAuthorizedByUser'));
  for (const forbidden of ['command', 'shell', 'argv', 'path', 'paths', 'commitMessage', 'stash', 'reset', 'discard']) {
    assert.equal(keys.includes(forbidden), false);
  }
});
