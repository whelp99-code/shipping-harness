import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCore5Release, probeCore5DecisionEnv } from '../../src/core/core5-decision.mjs';

test('H06 decision stays NOT_SHIPPABLE without docker, image pin, review UI, or real accounts', () => {
  const decision = decideCore5Release({
    dockerPath: null,
    postgresImage: '',
    reviewUiOk: false,
    realAccountOk: false,
    revision: 'abc',
  });
  assert.equal(decision.state, 'NOT_SHIPPABLE');
  assert.equal(decision.releaseDecision, false);
  assert.deepEqual(decision.blockers.map((row) => row.id).sort(), ['H02', 'H02-image', 'H03', 'K04']);
  assert.equal(decision.deploy, 'not-started');
  assert.equal(decision.observation, 'not-started');
});

test('H06 decision still refuses SHIPPABLE if only docker is present', () => {
  const decision = decideCore5Release({
    dockerPath: '/usr/bin/docker',
    postgresImage: 'postgres@sha256:' + 'a'.repeat(64),
    reviewUiOk: false,
    realAccountOk: false,
  });
  assert.equal(decision.releaseDecision, false);
  assert.ok(decision.blockers.some((row) => row.id === 'H03'));
  assert.ok(decision.blockers.some((row) => row.id === 'K04'));
});

test('probe defaults never enable review UI or real accounts', () => {
  const probed = probeCore5DecisionEnv({});
  assert.equal(probed.reviewUiOk, false);
  assert.equal(probed.realAccountOk, false);
  assert.equal(probed.postgresImage, '');
});
