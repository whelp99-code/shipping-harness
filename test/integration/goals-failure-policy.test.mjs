import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { applyTaskFailurePolicy, createFailureFingerprint } from '../../src/core/goals/failure-fingerprint.mjs';
import { createTaskEvidenceReceipt } from '../../src/core/goals/freshness.mjs';
import {
  initializeGoalRuntime,
  readGoalRuntime,
  recordTaskAttempt,
  transitionStoredGoal,
  transitionStoredTask,
} from '../../src/core/goals/store.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function oneTaskGraph(contractHash = 'e'.repeat(64)) {
  return compileGoalGraph({
    project: 'failure-fixture',
    release: '0.5.0',
    goal: 'Stop repeated no-progress failures.',
    acceptance: [{ id: 'AC-001', description: 'One task completes.' }],
  }, {
    contractHash,
    taskSpecs: [{
      id: 'TASK-WORK',
      title: 'Perform bounded work',
      consumer: { type: 'acceptance', id: 'AC-001' },
      maxAttempts: 3,
    }],
  });
}

async function beginFailedAttempt(root, taskId, attemptId, gitSha, error) {
  const current = await readGoalRuntime(root);
  const task = current.tasks.find((candidate) => candidate.id === taskId);
  if (task.state === 'PENDING') await transitionStoredTask(root, taskId, 'READY');
  const refreshed = await readGoalRuntime(root);
  if (refreshed.tasks.find((candidate) => candidate.id === taskId).state === 'READY' || refreshed.tasks.find((candidate) => candidate.id === taskId).state === 'RETRY_READY') {
    await transitionStoredTask(root, taskId, 'RUNNING');
  }
  await recordTaskAttempt(root, {
    taskId,
    attemptId,
    command: 'npm test',
    gitSha,
    status: 'failed',
    error,
  });
  await transitionStoredTask(root, taskId, 'FAILED', { reason: error });
}


test('identical failures on unchanged source stop at the bounded no-progress limit', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = oneTaskGraph();
  const taskId = graph.tasks[0].id;
  const sha = currentGitSha(fixture.root);
  await initializeGoalRuntime(fixture.root, graph);

  await beginFailedAttempt(fixture.root, taskId, 'attempt-001', sha, 'Timeout at 2026-08-28T06:00:00.000Z after 500ms');
  const first = await applyTaskFailurePolicy(fixture.root, {
    taskId,
    command: 'npm test',
    gitSha: sha,
    error: 'Timeout at 2026-08-28T06:00:00.000Z after 500ms',
    maxIdenticalFailures: 2,
  });
  assert.equal(first.allowRetry, true);
  assert.equal(first.nextState, 'RETRY_READY');

  await beginFailedAttempt(fixture.root, taskId, 'attempt-002', sha, 'Timeout at 2026-08-28T06:02:00.000Z after 900ms');
  const second = await applyTaskFailurePolicy(fixture.root, {
    taskId,
    command: 'npm test',
    gitSha: sha,
    error: 'Timeout at 2026-08-28T06:02:00.000Z after 900ms',
    maxIdenticalFailures: 2,
  });
  assert.equal(second.identicalCount, 2);
  assert.equal(second.allowRetry, false);
  assert.equal(second.nextState, 'BLOCKED');
  await assert.rejects(() => transitionStoredTask(fixture.root, taskId, 'RUNNING'), /Invalid Task transition/u);
});


test('changed source creates a new bounded failure cohort without erasing prior receipts', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = oneTaskGraph('f'.repeat(64));
  const taskId = graph.tasks[0].id;
  const firstSha = currentGitSha(fixture.root);
  await initializeGoalRuntime(fixture.root, graph);

  await beginFailedAttempt(fixture.root, taskId, 'attempt-before-change', firstSha, 'Build failed in /tmp/work at 500ms');
  const first = await applyTaskFailurePolicy(fixture.root, {
    taskId,
    command: 'npm test',
    gitSha: firstSha,
    error: 'Build failed in /tmp/work at 500ms',
    maxIdenticalFailures: 2,
  });
  assert.equal(first.nextState, 'RETRY_READY');

  await writeFile(path.join(fixture.root, 'source-change.txt'), 'changed\n', 'utf8');
  await fixture.commit('change source');
  const secondSha = currentGitSha(fixture.root);
  assert.notEqual(secondSha, firstSha);
  await beginFailedAttempt(fixture.root, taskId, 'attempt-after-change', secondSha, 'Build failed in /tmp/work at 800ms');
  const second = await applyTaskFailurePolicy(fixture.root, {
    taskId,
    command: 'npm test',
    gitSha: secondSha,
    error: 'Build failed in /tmp/work at 800ms',
    maxIdenticalFailures: 2,
  });
  assert.equal(second.identicalCount, 1);
  assert.equal(second.allowRetry, true);
  assert.equal(second.nextState, 'RETRY_READY');
  assert.notEqual(first.fingerprint, second.fingerprint);

  const normalizedA = createFailureFingerprint({ taskId, command: 'npm test', gitSha: firstSha, error: 'Timeout 2026-08-28T06:00:00.000Z 500ms' });
  const normalizedB = createFailureFingerprint({ taskId, command: 'npm test', gitSha: firstSha, error: 'Timeout 2026-08-28T07:00:00.000Z 900ms' });
  assert.equal(normalizedA.fingerprint, normalizedB.fingerprint);
});


test('Task and Goal DONE require current evidence and cannot be reopened by optional debt', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = oneTaskGraph('1'.repeat(64));
  const taskId = graph.tasks[0].id;
  const goalId = graph.goals[0].id;
  const sha = currentGitSha(fixture.root);
  await initializeGoalRuntime(fixture.root, graph);
  await transitionStoredGoal(fixture.root, goalId, 'ACTIVE');
  await transitionStoredTask(fixture.root, taskId, 'READY');
  await transitionStoredTask(fixture.root, taskId, 'RUNNING');
  await transitionStoredTask(fixture.root, taskId, 'VERIFYING');
  await assert.rejects(() => transitionStoredTask(fixture.root, taskId, 'DONE'), /requires the current Git SHA/u);

  const current = await readGoalRuntime(fixture.root);
  const task = current.tasks.find((candidate) => candidate.id === taskId);
  const stale = createTaskEvidenceReceipt({ graph: current, task, gitSha: '0'.repeat(40), evidenceRef: 'evidence://stale' });
  await assert.rejects(() => transitionStoredTask(fixture.root, taskId, 'DONE', { currentGitSha: sha, evidence: stale }), /does not match current/u);
  await assert.rejects(() => transitionStoredGoal(fixture.root, goalId, 'VERIFYING').then(() => transitionStoredGoal(fixture.root, goalId, 'DONE')), /until every owned Task is DONE/u);

  const afterGoalVerify = await readGoalRuntime(fixture.root);
  const freshTask = afterGoalVerify.tasks.find((candidate) => candidate.id === taskId);
  const fresh = createTaskEvidenceReceipt({ graph: afterGoalVerify, task: freshTask, gitSha: sha, evidenceRef: 'evidence://AC-001/current' });
  await transitionStoredTask(fixture.root, taskId, 'DONE', { currentGitSha: sha, evidence: fresh });
  await transitionStoredGoal(fixture.root, goalId, 'DONE');
  const done = await readGoalRuntime(fixture.root);
  assert.equal(done.goals[0].state, 'DONE');
  assert.deepEqual(done.tasks[0].evidenceRefs, ['evidence://AC-001/current']);
  await assert.rejects(() => transitionStoredTask(fixture.root, taskId, 'FAILED', { reason: 'optional NEXT finding' }), /Invalid Task transition/u);
});
