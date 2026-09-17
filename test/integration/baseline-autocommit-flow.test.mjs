// v1.13.0 Phase A end to end: the defect this release removes is that a dirty tree made
// the user choose when to commit — commit before approval and the proposal was discarded
// with ERR_PROPOSAL_STALE, commit after lock and the work was absorbed into the release.
// Starting from a dirty tree must now reach approval in one pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approveScopeProposal } from '../../src/core/proposals.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { runGit } from '../../src/core/git.mjs';
import { readState } from '../../src/core/state.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const goal = 'Ship one bounded and mechanically verified fixture release';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return runGit(root, args).stdout.trim();
}

test('a dirty tree reaches approval in one pass, with baselineSha equal to the auto-commit', async () => {
  const fixture = await createFixtureRepo();
  try {
    const beforeHead = git(fixture.root, ['rev-parse', 'HEAD']);
    await fixture.write('README.md', '# unfinished work the user had lying around\n');
    await fixture.write('src/helper.mjs', 'export const helper = () => 1;\n');

    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0' });
    const data = started.structuredContent;

    // The commit happened before analysis, so the proposal is bound to it.
    assert.ok(data.baselineCommit, 'no baseline commit receipt was returned');
    assert.match(data.baselineCommit.sha, /^[a-f0-9]{40}$/u);
    assert.notEqual(data.baselineCommit.sha, beforeHead);
    assert.equal(data.baselineCommit.filesCommitted, 2);
    assert.equal(data.baselineCommit.untrackedIncluded, 1);
    assert.equal(data.baselineCommit.undo, 'git reset --soft HEAD~1');
    assert.equal(data.baselineCommit.sha, git(fixture.root, ['rev-parse', 'HEAD']));
    assert.equal(data.detected.gitSha ?? data.baselineCommit.sha, data.baselineCommit.sha);

    // The user is told, on the first line, before anything else.
    assert.match(started.content[0].text.split('\n')[0], /^Committed your working tree as the release baseline: [a-f0-9]{12} \(2 file\(s\), 1 new\)\. Undo with: git reset --soft HEAD~1$/u);

    // The dirty-baseline review state is gone; approval is reachable without a rescan.
    assert.notEqual(data.proposalState, 'DIRTY_BASELINE');
    assert.equal(data.readyForApproval, true);
    assert.equal(git(fixture.root, ['status', '--porcelain=v1', '--', 'README.md', 'src']), '');

    const approved = await approveScopeProposal(fixture.root, {
      proposalId: data.proposalId,
      proposalHash: data.proposalHash,
      confirm: true,
      approverId: 'human-operator',
    });
    assert.equal(approved.lock.baselineSha, data.baselineCommit.sha);
    assert.equal((await readState(fixture.root)).baselineSha, data.baselineCommit.sha);
  } finally {
    await fixture.cleanup();
  }
});

test('the auto-commit is recorded in the ledger without a state transition', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('README.md', '# dirty\n');
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0' });
    const ledger = (await fixture.read('.shipping/ledger.jsonl'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const recorded = ledger.filter((entry) => entry.type === 'baseline.autocommitted');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].sha, started.structuredContent.baselineCommit.sha);
    assert.equal(recorded[0].filesCommitted, 1);
    assert.equal(recorded[0].undo, 'git reset --soft HEAD~1');
    assert.equal(recorded[0].stateWrite, undefined, 'the auto-commit is not a state transition');
    assert.equal((await readState(fixture.root)).state, 'DRAFT');
  } finally {
    await fixture.cleanup();
  }
});

test('commitBaseline: false keeps the pre-v1.13.0 behavior exactly', async () => {
  const fixture = await createFixtureRepo();
  try {
    const beforeHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const beforeStatus = git(fixture.root, ['status', '--porcelain=v1', '--', 'README.md']);
    await fixture.write('README.md', '# still dirty on purpose\n');
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0', commitBaseline: false });
    const data = started.structuredContent;
    assert.equal(data.baselineCommit, null);
    assert.equal(data.proposalState, 'DIRTY_BASELINE');
    assert.equal(data.nextAction, 'REVIEW_BASELINE');
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), beforeHead);
    assert.notEqual(git(fixture.root, ['status', '--porcelain=v1', '--', 'README.md']), beforeStatus);
    // No baseline line is prepended when nothing was committed.
    assert.equal(started.content[0].text, data.plainBriefText);
  } finally {
    await fixture.cleanup();
  }
});

test('a clean tree produces no commit and no baseline receipt', async () => {
  const fixture = await createFixtureRepo();
  try {
    const beforeHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0' });
    assert.equal(started.structuredContent.baselineCommit, null);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), beforeHead);
  } finally {
    await fixture.cleanup();
  }
});

test('an auto-commit that already satisfies every required criterion warns BASELINE_ALREADY_PASSING', async () => {
  const fixture = await createFixtureRepo();
  try {
    // The fixture's `npm test` passes unconditionally, so committing the tree makes every
    // required criterion already true — the release would prove nothing.
    await fixture.write('README.md', '# work that already satisfies the gate\n');
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0' });
    const data = started.structuredContent;
    assert.ok(data.baselineCommit, 'the warning is only meaningful after an auto-commit');
    const warning = data.diagnostics.find((entry) => entry.startsWith('BASELINE_ALREADY_PASSING:'));
    assert.ok(warning, `no BASELINE_ALREADY_PASSING diagnostic in ${JSON.stringify(data.diagnostics)}`);
    assert.match(warning, /already passes on the committed baseline/u);
    assert.match(warning, /git reset --soft HEAD~1/u);
    // It is a warning, not a gate.
    assert.equal(data.readyForApproval, true);
  } finally {
    await fixture.cleanup();
  }
});

test('a credential file in the tree refuses the start outright and commits nothing', async () => {
  const fixture = await createFixtureRepo();
  try {
    const beforeHead = git(fixture.root, ['rev-parse', 'HEAD']);
    await fixture.write('README.md', '# real work\n');
    await fixture.write('.env', 'TOKEN=leak\n');
    await assert.rejects(
      async () => callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0' }),
      (error) => {
        assert.equal(error.code, 'ERR_BASELINE_UNSAFE_UNTRACKED');
        assert.equal(error.details.path, '.env');
        assert.match(error.message, /Nothing was staged or committed/u);
        return true;
      },
    );
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(fixture.root, ['diff', '--cached']), '');
  } finally {
    await fixture.cleanup();
  }
});
