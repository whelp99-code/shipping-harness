import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  commandClass,
  detectStartScript,
  isProvingCriterion,
  portListens,
  softwareGoalGap,
} from '../../src/core/acceptance-proof.mjs';

test('lint, diff-check, and docs commands are not proving', () => {
  assert.equal(commandClass('npm run lint'), 'lint');
  assert.equal(commandClass('git diff --check'), 'diff-check');
  assert.equal(commandClass('npm run verify:docs'), 'docs');
  assert.equal(isProvingCriterion({
    required: true,
    command: 'git diff --check',
    description: 'Whitespace check.',
  }), false);
});

test('a named user outcome on a repo-owned command proves a software goal', () => {
  const gap = softwareGoalGap({
    goal: 'Ship a runnable MVP',
    blockerPolicy: ['software-goal-unproven'],
    acceptance: [{
      id: 'AC-001',
      required: true,
      command: 'npm test',
      description: 'User outcome: the login screen shows the signed-in name.',
    }],
  });
  assert.deepEqual(gap, []);
});

test('a software goal cannot close on lint, diff-check, or docs alone', () => {
  const gap = softwareGoalGap({
    goal: 'Ship a runnable MVP for the app',
    blockerPolicy: ['software-goal-unproven'],
    acceptance: [
      { id: 'AC-001', required: true, command: 'npm run lint', description: 'Lint passes.' },
      { id: 'AC-002', required: true, command: 'git diff --check', description: 'Whitespace.' },
      { id: 'AC-003', required: true, command: 'npm run verify:docs', description: 'Docs audit.' },
    ],
  });
  assert.equal(gap.length, 1);
  assert.equal(gap[0].classification, 'BLOCKER');
  assert.equal(gap[0].basisId, 'AC-001');
  assert.equal(gap[0].id, 'ISSUE-SOFTWARE-GOAL');
});

test('start detection names npm start and ignores a package with no start script', () => {
  assert.equal(detectStartScript({ test: 'npm test' }), null);
  assert.deepEqual(detectStartScript({ start: 'node server.mjs' }, 'npm'), {
    detected: true,
    command: 'npm start',
    script: 'node server.mjs',
    source: 'package.json',
  });
});

test('port listen is a liveness predicate', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    assert.equal(await portListens(address.port), true);
    assert.equal(commandClass(`listen:${address.port}`), 'liveness');
    assert.equal(isProvingCriterion({ required: true, command: `listen:${address.port}`, description: 'port' }), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await portListens(address.port), false);
});
