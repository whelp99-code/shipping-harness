import test from 'node:test';
import assert from 'node:assert/strict';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import { assertGoalCharterBinding, loadGoalCharter, persistAcceptedGoalCharter } from '../../src/core/goal-charter.mjs';
import { loadApprovedReleaseTrain } from '../../src/core/release-train.mjs';
import { readDecisionLedger } from '../../src/core/decision-ledger.mjs';
import { readState } from '../../src/core/state.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const goal = 'Complete the existing internal validation workflow and prove it with npm test without external deployment.';

test('scope approval persists one accepted Goal Charter bound across contract, state, train, ledger, proposal, and MCP status', async () => {
  const fixture = await createFixtureRepo();
  try {
    const created = await createScopeProposal(fixture.root, { goal, release: '0.1.0', proposerId: 'charter-proposer' });
    const preview = created.proposal.goalCharter;
    assert.equal(preview.status, 'PROPOSED');

    const approved = await approveScopeProposal(fixture.root, {
      proposalId: created.proposal.id,
      proposalHash: created.proposal.hash,
      confirm: true,
      approverType: 'human',
      approverId: 'charter-approver',
    });
    const charter = await loadGoalCharter(fixture.root);
    const train = await loadApprovedReleaseTrain(fixture.root);
    const state = await readState(fixture.root);
    const ledger = await readDecisionLedger(fixture.root);
    const acceptedEvent = ledger.find((entry) => entry.type === 'direction.accepted');

    assert.ok(charter);
    assert.equal(charter.status, 'ACCEPTED');
    assert.equal(charter.binding.previewHash, preview.hash);
    assert.equal(charter.proposalHash, created.proposal.hash);
    assert.equal(charter.gitSha, created.proposal.gitSha);
    assert.equal(charter.binding.contractHash, approved.lock.contractHash);
    assert.equal(charter.binding.baselineSha, approved.lock.baselineSha);
    assert.equal(charter.binding.releaseTrainHash, approved.proposal.releaseTrain.hash);
    assert.equal(charter.binding.approverType, 'human');
    assert.equal(charter.binding.approverId, 'charter-approver');
    assert.equal(approved.goalCharter.hash, charter.hash);
    assert.equal(approved.proposal.goalCharter.hash, charter.hash);
    assert.equal(train.binding.goalCharterHash, charter.hash);
    assert.equal(train.train.source.goalCharterHash, preview.hash);
    assert.equal(state.goalCharterHash, charter.hash);
    assert.equal(state.releaseTrainHash, train.train.hash);
    assert.equal(acceptedEvent.details.goalCharterHash, charter.hash);
    assert.ok(acceptedEvent.evidenceRefs.includes('proposal.goalCharter'));

    assertGoalCharterBinding(charter, {
      proposalId: created.proposal.id,
      proposalHash: created.proposal.hash,
      gitSha: created.proposal.gitSha,
      release: '0.1.0',
      contractHash: approved.lock.contractHash,
      baselineSha: approved.lock.baselineSha,
      releaseTrainHash: approved.proposal.releaseTrain.hash,
    });

    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.goalCharter.hash, charter.hash);
    assert.equal(status.structuredContent.goalCharterSummary.hash, charter.hash);
    assert.equal(status.structuredContent.userView.goalCharter.hash, charter.hash);
    assert.equal(status.structuredContent.userView.goalCharterSummary.hash, charter.hash);
  } finally {
    await fixture.cleanup();
  }
});

test('persisted accepted charter is idempotent for the same hash and rejects divergent in-place mutation', async () => {
  const fixture = await createFixtureRepo();
  try {
    const created = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
    const approved = await approveScopeProposal(fixture.root, {
      proposalId: created.proposal.id,
      proposalHash: created.proposal.hash,
      confirm: true,
      approverType: 'human',
      approverId: 'first-user',
    });
    const same = await persistAcceptedGoalCharter(fixture.root, approved.goalCharter);
    assert.equal(same.duplicate, true);

    const divergent = structuredClone(approved.goalCharter);
    divergent.binding.approverId = 'other-user';
    const { hash: _oldHash, ...body } = divergent;
    const { hashObject } = await import('../../src/core/crypto.mjs');
    divergent.hash = hashObject(body);
    await assert.rejects(
      persistAcceptedGoalCharter(fixture.root, divergent),
      (error) => error.code === 'ERR_GOAL_CHARTER_MUTATION',
    );
  } finally {
    await fixture.cleanup();
  }
});
