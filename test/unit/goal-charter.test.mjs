import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptGoalCharter, compileGoalCharterPreview, GOAL_CHARTER, validateGoalCharter } from '../../src/core/goal-charter.mjs';
import { createScopeProposal } from '../../src/core/proposals.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const specificGoal = 'Complete the existing validation workflow for internal operators and prove it with npm test.';

function binding(overrides = {}) {
  return {
    proposalHash: 'a'.repeat(64),
    contractHash: 'b'.repeat(64),
    baselineSha: 'c'.repeat(40),
    releaseTrainHash: 'd'.repeat(64),
    approverType: 'human',
    approverId: 'unit-test-user',
    acceptedAt: '2026-08-30T01:00:00.000Z',
    ...overrides,
  };
}

test('specific ready direction compiles one deterministic bounded proposed Goal Charter', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: specificGoal, release: '0.1.0' });
    const preview = proposal.goalCharter;
    assert.ok(preview);
    assert.equal(preview.schema, GOAL_CHARTER.schema);
    assert.equal(preview.status, 'PROPOSED');
    assert.equal(preview.proposalId, proposal.id);
    assert.equal(preview.proposalRevision, 1);
    assert.equal(preview.proposalHash, null);
    assert.equal(preview.binding, null);
    assert.equal(preview.outcome, proposal.goalDiscovery.direction.outcome);
    assert.deepEqual(preview.nonGoals, proposal.goalDiscovery.direction.nonGoals);
    assert.deepEqual(preview.successCriteria, proposal.goalDiscovery.direction.successCriteria);
    assert.equal(preview.rollback, proposal.goalDiscovery.direction.rollback);
    assert.equal(preview.commandAuthority, false);
    assert.equal(preview.approvalAuthority, false);
    assert.equal(preview.closureAuthority, false);
    assert.equal(preview.deploymentAuthority, false);
    assert.equal(preview.modelAuthority, false);
    assert.equal(preview.released, false);
    assert.ok(Buffer.byteLength(JSON.stringify(preview)) <= GOAL_CHARTER.maxSerializedBytes);
    assert.equal(compileGoalCharterPreview(proposal).hash, preview.hash);
    assert.equal(validateGoalCharter(preview), preview);
  } finally {
    await fixture.cleanup();
  }
});

test('unresolved product questions cannot compile a Goal Charter', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: '이 프로젝트를 완성해', release: '0.1.0' });
    assert.equal(proposal.canonicalState, 'NEEDS_INPUT');
    assert.equal(proposal.goalCharter, null);
    assert.throws(
      () => compileGoalCharterPreview(proposal),
      (error) => error.code === 'ERR_GOAL_CHARTER_DIRECTION',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('accepting a preview binds proposal, contract, Git baseline, train, approver, and time without granting authority', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: specificGoal, release: '0.1.0' });
    const accepted = acceptGoalCharter(proposal.goalCharter, binding({ proposalHash: proposal.hash, baselineSha: proposal.gitSha }));
    assert.equal(accepted.status, 'ACCEPTED');
    assert.equal(accepted.proposalHash, proposal.hash);
    assert.equal(accepted.binding.previewHash, proposal.goalCharter.hash);
    assert.equal(accepted.binding.contractHash, 'b'.repeat(64));
    assert.equal(accepted.binding.baselineSha, proposal.gitSha);
    assert.equal(accepted.binding.releaseTrainHash, 'd'.repeat(64));
    assert.equal(accepted.binding.approverType, 'human');
    assert.equal(accepted.binding.approverId, 'unit-test-user');
    assert.equal(accepted.commandAuthority, false);
    assert.equal(accepted.approvalAuthority, false);
    assert.equal(accepted.closureAuthority, false);
    assert.equal(accepted.deploymentAuthority, false);
    assert.equal(accepted.modelAuthority, false);
    assert.equal(accepted.released, false);
    validateGoalCharter(accepted);
  } finally {
    await fixture.cleanup();
  }
});
