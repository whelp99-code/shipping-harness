import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTeamDagDecision, decideTeamDagActivation, verifyCriterion } from '../../scripts/team-dag-entry-gate.mjs';
import { privateOmoRuntimeAvailability } from '../omo/helpers.mjs';

// v1.13.8: buildTeamDagDecision() reads the promotion evidence of the private OMO
// runtime, which is pinned to an absolute path outside this repo and is not installed
// on every machine. Same rule as test/omo/: skip, never fail, when it is absent. The
// two pure-logic tests below do not touch it and always run.
const runtime = privateOmoRuntimeAvailability();
const skip = runtime.available ? {} : { skip: runtime.reason };

const pilot = JSON.parse(readFileSync(new URL('../../docs/internal-runtime/v0.7-pilot.json', import.meta.url), 'utf8'));
const benefitSignal = Object.keys(pilot.entryGate).find((key) => ![
  'coordinationBottleneckProven', 'v08TeamDagRecommended', 'decision', 'reason',
].includes(key));
assert.equal(typeof benefitSignal, 'string');

const acceptance = [
  'AC-0801', 'AC-0802', 'AC-0803', 'AC-0804', 'AC-0805', 'AC-0806',
  'AC-0807', 'AC-0808', 'AC-0809', 'AC-0810', 'AC-0811', 'AC-0812',
];

test('Team/DAG stays disabled unless both evidence signals are proven', () => {
  for (const signals of [
    {},
    { coordinationBottleneckProven: true },
    { [benefitSignal]: true },
    { coordinationBottleneckProven: false, [benefitSignal]: false },
  ]) {
    const decision = decideTeamDagActivation(signals);
    assert.equal(decision.decision, 'DISABLED');
    assert.equal(decision.enabled, false);
  }
});

test('even proven entry signals cannot self-enable Team/DAG without a new contract', () => {
  const decision = decideTeamDagActivation({
    coordinationBottleneckProven: true,
    [benefitSignal]: true,
  });
  assert.equal(decision.decision, 'ELIGIBLE_FOR_SEPARATE_IMPLEMENTATION_CONTRACT');
  assert.equal(decision.enabled, false);
});

test('the locked v0.8 evidence report proves DISABLED without invented benchmark claims', skip, async () => {
  const report = await buildTeamDagDecision();
  assert.equal(report.decision, 'DISABLED');
  assert.equal(report.enabled, false);
  assert.equal(report.signals.coordinationBottleneckProven, false);
  assert.equal(report.signals[benefitSignal], false);
  assert.equal(report.comparison.teamDagV08.status, 'NOT_RUN_ENTRY_GATE_FAILED');
  assert.equal(report.comparison.teamDagV08.inventedMetrics, false);
  assert.equal(report.sourceInspection.teamDagSourcePresent, false);
  assert.equal(report.preservedProfile.teamMode, false);
  assert.equal(report.preservedProfile.dagMode, false);
  assert.equal(report.claims.finisherRemainsOutsideTeam, true);
  assert.equal(report.claims.publicPublish, false);
  for (const criterion of acceptance) assert.equal(verifyCriterion(criterion, report), true);
});
