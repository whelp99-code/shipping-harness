import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionEvidence } from '../../src/core/decision-evidence.mjs';
import { composeDefaultDecision } from '../../src/core/decision-package.mjs';
import { applyDecisionPolicy, buildApprovalBrief } from '../../src/core/decision-policy.mjs';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';


test('ordinary AUTO decisions use safe assumptions and produce one approval brief without questions', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const evidence = await buildDecisionEvidence(fixture.root, { goal: 'Ship one verified local CLI workflow.' });
  const base = composeDefaultDecision(evidence, { release: '0.4.0', projectName: 'fixture' });
  const decision = applyDecisionPolicy(evidence, base, { budgets: { maxFixCycles: 2, maxAgentRuns: 3, maxCommandSeconds: 900 } });
  const brief = buildApprovalBrief(decision);
  assert.equal(decision.approvalStatus, 'APPROVABLE');
  assert.equal(decision.questions.length, 0);
  assert.match(brief.text, /Included:/u);
  assert.match(brief.text, /Deferred:/u);
  assert.match(brief.text, /Limits: fix 2/u);
});


test('mandatory risks are grouped into no more than three exception questions', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const goal = 'Delete production customer data, deploy publicly, rotate root credentials, and add a paid subscription while dropping existing compatibility.';
  const evidence = await buildDecisionEvidence(fixture.root, { goal });
  const base = composeDefaultDecision(evidence, { release: '0.4.0', projectName: 'fixture' });
  const decision = applyDecisionPolicy(evidence, base);
  assert.equal(decision.approvalStatus, 'NEEDS_INPUT');
  assert.equal(decision.questions.length <= 3, true);
  assert.equal(decision.risks.filter((entry) => entry.mandatory).length >= 4, true);
  assert.equal(decision.questions.at(-1).recommendedChoice.length > 0, true);
});


test('SAFE escalates medium architecture changes while AUTO keeps them as inspectable risk', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const goal = 'Ship a local CLI by using a new dependency and major refactor.';
  const autoEvidence = await buildDecisionEvidence(fixture.root, { goal, mode: 'AUTO' });
  const auto = applyDecisionPolicy(autoEvidence, composeDefaultDecision(autoEvidence, { release: '0.4.0', projectName: 'fixture' }));
  assert.equal(auto.risks.some((entry) => entry.category === 'architecture-expansion'), true);
  assert.equal(auto.questions.length, 0);
  const safeEvidence = await buildDecisionEvidence(fixture.root, { goal, mode: 'SAFE' });
  const safe = applyDecisionPolicy(safeEvidence, composeDefaultDecision(safeEvidence, { release: '0.4.0', projectName: 'fixture' }));
  assert.equal(safe.questions.some((entry) => entry.category === 'architecture-expansion'), true);
});


test('agent or proposer self-approval cannot lock a proposal', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const { proposal } = await createScopeProposal(fixture.root, {
    goal: 'Ship one verified local CLI workflow.',
    release: '0.4.0',
    proposerId: 'agent-judge',
  });
  await assert.rejects(
    () => approveScopeProposal(fixture.root, {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      confirm: true,
      approverType: 'agent',
      approverId: 'agent-judge',
    }),
    /Only a human approver/u,
  );
  await assert.rejects(
    () => approveScopeProposal(fixture.root, {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      confirm: true,
      approverType: 'human',
      approverId: 'agent-judge',
    }),
    /cannot approve its own/u,
  );
});
