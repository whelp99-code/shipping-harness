import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDiscoveryLock } from '../../src/core/discovery-lock.mjs';
import { compileDecisionContract } from '../../src/core/decision-package.mjs';
import { createDefaultContract } from '../../src/core/contract.mjs';

const direction = {
  outcome: 'A visitor can see the signed-in name',
  successCriteria: ['the signed-in name is on the home screen'],
  modelAuthority: false,
  commandAuthority: false,
  approvalAuthority: false,
  closureAuthority: false,
  released: false,
};

test('discovery answers compile into the locked goal and a named acceptance outcome', () => {
  const compiled = compileDiscoveryLock(direction, [{
    id: 'AC-001',
    description: 'Existing package script test passes.',
    type: 'command',
    command: 'npm test',
    cwd: '.',
    required: true,
  }]);
  assert.equal(compiled.goal, direction.outcome);
  assert.match(compiled.acceptance[0].description, /User outcome: the signed-in name is on the home screen/u);
  const contract = compileDecisionContract(createDefaultContract('fixture'), {
    projectName: 'fixture',
    release: '1.0.0',
    outcome: 'raw prompt that is not the direction',
    scope: createDefaultContract('fixture').scope,
    acceptance: compiled.acceptance,
    discoveryDirection: direction,
  });
  assert.equal(contract.goal, direction.outcome);
  assert.match(contract.acceptance[0].description, /User outcome:/u);
});
