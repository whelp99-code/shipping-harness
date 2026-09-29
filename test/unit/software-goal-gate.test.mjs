import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';

test('verify refuses a software goal whose acceptance is only git diff --check', async () => {
  const fixture = await createFixtureRepo({
    contract: (contract) => ({
      ...contract,
      goal: 'Ship a runnable MVP for the app',
      blockerPolicy: [...contract.blockerPolicy, 'software-goal-unproven'],
      acceptance: [{
        id: 'AC-001',
        description: 'Whitespace check.',
        type: 'command',
        command: 'git diff --check',
        cwd: '.',
        required: true,
        timeoutSeconds: 60,
      }],
    }),
  });
  try {
    await fixture.lock();
    const result = runCli(fixture.root, ['verify', '--json']);
    assert.equal(result.exitCode, 2);
    const body = parseCliJson(result);
    assert.notEqual(body.decision, 'SHIPPABLE');
    assert.ok(body.issues.issues.some((issue) => issue.id === 'ISSUE-SOFTWARE-GOAL' && issue.basisId === 'AC-001'));
  } finally {
    await fixture.cleanup();
  }
});

test('verify ships a software goal that asserts a named user outcome', async () => {
  const fixture = await createFixtureRepo({
    contract: (contract) => ({
      ...contract,
      goal: 'Ship a runnable MVP for the app',
      blockerPolicy: [...contract.blockerPolicy, 'software-goal-unproven'],
      acceptance: [{
        id: 'AC-001',
        description: 'User outcome: the fixture prints fixture-pass.',
        type: 'command',
        command: 'npm test',
        cwd: '.',
        required: true,
        timeoutSeconds: 60,
      }],
    }),
  });
  try {
    await fixture.lock();
    const result = runCli(fixture.root, ['verify', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(parseCliJson(result).decision, 'SHIPPABLE');
  } finally {
    await fixture.cleanup();
  }
});
