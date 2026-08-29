import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { hashObject } from '../../src/core/crypto.mjs';
import {
  approveScopeProposal,
  createScopeProposal,
  loadScopeProposal,
  refineScopeProposal,
} from '../../src/core/proposals.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';

const goal = 'Ship one bounded and mechanically verified fixture release';

function topLevelProposalHash(proposal) {
  const { hash: _hash, approval: _approval, ...body } = proposal;
  return hashObject(body);
}

async function proposalFiles(root) {
  return (await readdir(path.join(root, '.shipping', 'proposals')))
    .filter((name) => /^proposal-.*\.json$/u.test(name))
    .sort();
}

test('non-ready serialized proposals contain no contradictory approval-ready projection and briefs bind cwd', async () => {
  const dirty = await createFixtureRepo();
  try {
    await writeFile(path.join(dirty.root, 'README.md'), '# unfinished source work\n', 'utf8');
    const { proposal } = await createScopeProposal(dirty.root, { goal, release: '0.1.0' });
    assert.equal(proposal.canonicalState, 'DIRTY_BASELINE');
    assert.equal(proposal.readyForApproval, false);
    assert.equal(proposal.decision.approvalStatus, 'NOT_READY');
    assert.equal(proposal.approvalBrief.status, 'NOT_READY');
    assert.doesNotMatch(JSON.stringify(proposal), /"APPROVABLE"/u);
    assert.ok(proposal.approvalBrief.acceptance.every((entry) => typeof entry.cwd === 'string' && entry.cwd.length > 0));
  } finally {
    await dirty.cleanup();
  }

  const unresolved = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(unresolved.root, {
      goal: 'Deploy this fixture to production and publish it publicly',
      release: '0.1.0',
    });
    assert.equal(proposal.canonicalState, 'NEEDS_INPUT');
    assert.equal(proposal.decision.approvalStatus, 'NEEDS_INPUT');
    assert.equal(proposal.approvalBrief.status, 'NEEDS_INPUT');
    assert.doesNotMatch(JSON.stringify(proposal), /"APPROVABLE"/u);
  } finally {
    await unresolved.cleanup();
  }

  const weak = await createFixtureRepo({ testScript: 'echo "Error: no test specified" && exit 1' });
  try {
    const { proposal } = await createScopeProposal(weak.root, { goal, release: '0.1.0' });
    assert.equal(proposal.canonicalState, 'NEEDS_ACCEPTANCE');
    assert.equal(proposal.decision.approvalStatus, 'NOT_READY');
    assert.equal(proposal.approvalBrief.status, 'NOT_READY');
    assert.doesNotMatch(JSON.stringify(proposal), /"APPROVABLE"/u);
  } finally {
    await weak.cleanup();
  }
});

test('legacy contradictory proposal projects safely without rewriting stored bytes or breaking its hash', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeFile(path.join(fixture.root, 'README.md'), '# dirty legacy proposal\n', 'utf8');
    const { proposal, proposalPath } = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    const legacy = structuredClone(proposal);
    legacy.decision.approvalStatus = 'APPROVABLE';
    legacy.approvalBrief.status = 'APPROVABLE';
    legacy.approvalBrief.text = legacy.approvalBrief.text.replace('Status: NOT_READY', 'Status: APPROVABLE');
    legacy.readyForApproval = true;
    legacy.hash = topLevelProposalHash(legacy);
    await writeFile(proposalPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
    const activePath = path.join(fixture.root, '.shipping', 'proposals', '_active.json');
    const active = JSON.parse(await readFile(activePath, 'utf8'));
    active.proposalHash = legacy.hash;
    await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, 'utf8');
    const before = await readFile(proposalPath);

    const loaded = await loadScopeProposal(fixture.root, legacy.id);
    assert.equal(loaded.proposal.decision.approvalStatus, 'APPROVABLE');
    assert.equal(loaded.projectedProposal.canonicalState, 'DIRTY_BASELINE');
    assert.equal(loaded.projectedProposal.readyForApproval, false);
    assert.equal(loaded.projectedProposal.decision.approvalStatus, 'NOT_READY');
    assert.equal(loaded.projectedProposal.approvalBrief.status, 'NOT_READY');

    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.pendingProposal.state, 'DIRTY_BASELINE');
    assert.equal(status.structuredContent.userView.userState, 'DIRTY_BASELINE');
    const after = await readFile(proposalPath);
    assert.deepEqual(after, before);

    await assert.rejects(
      approveScopeProposal(fixture.root, { proposalId: legacy.id, proposalHash: legacy.hash, confirm: true }),
      (error) => error.code === 'ERR_DECISION_NEEDS_INPUT' && error.message.includes('DIRTY_BASELINE'),
    );
  } finally {
    await fixture.cleanup();
  }
});

test('no-op rescan reuses the exact proposal revision and creates no archive', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    const beforeFiles = await proposalFiles(fixture.root);
    const result = await refineScopeProposal(fixture.root, {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      rescan: true,
    });
    assert.equal(result.changed, false);
    assert.equal(result.archivedRevisionPath, null);
    assert.equal(result.proposal.id, proposal.id);
    assert.equal(result.proposal.revision, proposal.revision);
    assert.equal(result.proposal.hash, proposal.hash);
    assert.deepEqual(await proposalFiles(fixture.root), beforeFiles);

    const throughMcp = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      rescan: true,
    });
    assert.equal(throughMcp.structuredContent.changed, false);
    assert.equal(throughMcp.structuredContent.revision, 1);
    assert.equal(throughMcp.structuredContent.archivedRevisionPath, null);
  } finally {
    await fixture.cleanup();
  }
});
