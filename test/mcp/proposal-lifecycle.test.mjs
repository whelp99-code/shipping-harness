import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import {
  approveScopeProposal,
  createScopeProposal,
  loadScopeProposal,
} from '../../src/core/proposals.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';

const goal = 'Ship one bounded and mechanically verified fixture release';

test('identical and concurrent starts reuse one canonical active proposal', async () => {
  const fixture = await createFixtureRepo();
  try {
    const [first, second] = await Promise.all([
      createScopeProposal(fixture.root, { goal, release: '0.1.0' }),
      createScopeProposal(fixture.root, { goal: `  ${goal.toUpperCase()}  `, release: '0.1.0' }),
    ]);
    assert.equal(first.proposal.id, second.proposal.id);
    assert.equal([first.reused, second.reused].filter(Boolean).length, 1);
    const names = (await readdir(path.join(fixture.root, '.shipping', 'proposals')))
      .filter((name) => name.startsWith('proposal-') && name.endsWith('.json'));
    assert.equal(names.length, 1);
    const active = JSON.parse(await readFile(path.join(fixture.root, '.shipping', 'proposals', '_active.json'), 'utf8'));
    assert.equal(active.proposalId, first.proposal.id);
    assert.equal(active.state, 'READY_FOR_APPROVAL');
  } finally {
    await fixture.cleanup();
  }
});

test('a materially changed request supersedes the old proposal and keeps one active identity', async () => {
  const fixture = await createFixtureRepo();
  try {
    const first = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    const second = await createScopeProposal(fixture.root, { goal: 'Ship a different but still bounded verified fixture release', release: '0.1.0' });
    assert.notEqual(first.proposal.id, second.proposal.id);
    assert.equal(second.supersededProposalId, first.proposal.id);
    const old = await loadScopeProposal(fixture.root, first.proposal.id);
    assert.equal(old.summary.state, 'SUPERSEDED');
    assert.equal(old.proposal.lifecycle.supersededBy, second.proposal.id);
    const active = JSON.parse(await readFile(path.join(fixture.root, '.shipping', 'proposals', '_active.json'), 'utf8'));
    assert.equal(active.proposalId, second.proposal.id);
  } finally {
    await fixture.cleanup();
  }
});

test('MCP start is AUTO-only and cannot silently switch to SAFE or INTERVIEW', async () => {
  const fixture = await createFixtureRepo();
  try {
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_start', { goal, mode: 'SAFE' }),
      (error) => error.code === 'ERR_PROPOSAL_MODE_AUTHORIZATION',
    );
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_start', { goal, mode: 'INTERVIEW' }),
      (error) => error.code === 'ERR_PROPOSAL_MODE_AUTHORIZATION',
    );
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal });
    assert.equal(started.structuredContent.mode, 'AUTO');
    assert.equal(started.structuredContent.proposalState, 'READY_FOR_APPROVAL');
  } finally {
    await fixture.cleanup();
  }
});

test('fallback-only acceptance is NEEDS_ACCEPTANCE and cannot be approved', async () => {
  const fixture = await createFixtureRepo({ testScript: 'echo "Error: no test specified" && exit 1' });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    assert.equal(proposal.acceptanceStrength.level, 'WEAK');
    assert.equal(proposal.canonicalState, 'NEEDS_ACCEPTANCE');
    assert.equal(proposal.readyForApproval, false);
    await assert.rejects(
      approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true }),
      (error) => error.code === 'ERR_DECISION_NEEDS_INPUT' && error.message.includes('NEEDS_ACCEPTANCE'),
    );
    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.pendingProposal.state, 'NEEDS_ACCEPTANCE');
    assert.equal(status.structuredContent.userView.userState, 'NEEDS_ACCEPTANCE');
    assert.doesNotMatch(status.content[0].text, /아직 Shipping Harness가 시작되지 않았습니다/u);
  } finally {
    await fixture.cleanup();
  }
});

test('dirty and unresolved proposals expose one truthful canonical state', async () => {
  const dirty = await createFixtureRepo();
  try {
    await writeFile(path.join(dirty.root, 'README.md'), '# Existing unfinished work\n', 'utf8');
    const { proposal } = await createScopeProposal(dirty.root, { goal, release: '0.1.0' });
    assert.equal(proposal.canonicalState, 'DIRTY_BASELINE');
    assert.equal(proposal.readyForApproval, false);
    const status = await callShippingTool(dirty.root, 'shipping_status', {});
    assert.equal(status.structuredContent.userView.userState, 'DIRTY_BASELINE');
  } finally {
    await dirty.cleanup();
  }

  const questions = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(questions.root, {
      goal: 'Deploy this fixture to production and publish it publicly',
      release: '0.1.0',
    });
    assert.equal(proposal.canonicalState, 'NEEDS_INPUT');
    assert.ok(proposal.decision.questions.length > 0);
    assert.equal(proposal.readyForApproval, false);
  } finally {
    await questions.cleanup();
  }
});
