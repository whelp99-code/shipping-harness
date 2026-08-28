import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { abortGoalRuntime, pauseGoalRuntime, resumeGoalRuntime } from '../../src/core/goals/authority.mjs';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { recordPlanningCycle } from '../../src/core/goals/planning.mjs';
import { recoverGoalRuntime } from '../../src/core/goals/recovery.mjs';
import { goalStatusView } from '../../src/core/goals/status-view.mjs';
import { goalRuntimePaths } from '../../src/core/goals/paths.mjs';
import {
  initializeGoalRuntime,
  readGoalRuntime,
  transitionStoredGoal,
  transitionStoredTask,
} from '../../src/core/goals/store.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function graphFor(name, hash) {
  return compileGoalGraph({
    project: name,
    release: '0.5.0',
    goal: 'Preserve human authority and terminate planning loops.',
    acceptance: [{ id: 'AC-001', description: 'Controlled work terminates.' }],
  }, {
    contractHash: hash,
    taskSpecs: [{
      id: 'TASK-CONTROL',
      title: 'Run controlled work',
      consumer: { type: 'acceptance', id: 'AC-001' },
      maxAttempts: 2,
    }],
  });
}


test('human pause survives recovery, resume returns to the prior state, and abort never revives work', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = graphFor('authority-fixture', '2'.repeat(64));
  const goalId = graph.goals[0].id;
  const taskId = graph.tasks[0].id;
  await initializeGoalRuntime(fixture.root, graph);
  await transitionStoredGoal(fixture.root, goalId, 'ACTIVE');
  await transitionStoredTask(fixture.root, taskId, 'READY');
  await transitionStoredTask(fixture.root, taskId, 'RUNNING');

  const paused = await pauseGoalRuntime(fixture.root, 'human inspection');
  assert.equal(paused.transitions.length, 1);
  assert.equal(paused.graph.tasks[0].state, 'PAUSED');
  assert.equal(paused.graph.tasks[0].resumeState, 'RUNNING');

  const paths = goalRuntimePaths(fixture.root);
  await writeFile(paths.goals, '{broken', 'utf8');
  await writeFile(paths.tasks, '{broken', 'utf8');
  const recoveredPause = await recoverGoalRuntime(fixture.root);
  assert.equal(recoveredPause.graph.tasks[0].state, 'PAUSED');
  assert.equal(recoveredPause.graph.tasks[0].resumeState, 'RUNNING');

  const resumed = await resumeGoalRuntime(fixture.root, 'inspection complete');
  assert.equal(resumed.graph.tasks[0].state, 'RUNNING');
  assert.equal(resumed.graph.tasks[0].resumeState, undefined);

  const aborted = await abortGoalRuntime(fixture.root, 'user cancelled release');
  assert.equal(aborted.graph.tasks[0].state, 'BLOCKED');
  assert.equal(aborted.graph.goals[0].state, 'BLOCKED');
  await writeFile(paths.goals, '{broken-again', 'utf8');
  await writeFile(paths.tasks, '{broken-again', 'utf8');
  const recoveredAbort = await recoverGoalRuntime(fixture.root);
  assert.equal(recoveredAbort.graph.tasks[0].state, 'BLOCKED');
  assert.equal(recoveredAbort.graph.goals[0].state, 'BLOCKED');
});


test('planner/reviewer ping-pong ends in PLANNING_STUCK and status remains concise and durable', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = graphFor('planning-fixture', '3'.repeat(64));
  const taskId = graph.tasks[0].id;
  await initializeGoalRuntime(fixture.root, graph);

  const inputs = [
    ['planner', 'Plan A: use the existing local architecture.'],
    ['reviewer', 'Review B: replace the plan with a different architecture.'],
    ['planner', 'Plan A: use the existing local architecture.'],
    ['reviewer', 'Review B: replace the plan with a different architecture.'],
  ];
  let result;
  for (const [role, signature] of inputs) {
    result = await recordPlanningCycle(fixture.root, {
      taskId,
      role,
      signature,
      maxCycles: 4,
      maxRepeatedSignature: 3,
    });
  }
  assert.equal(result.oscillation, true);
  assert.equal(result.nextState, 'PLANNING_STUCK');

  const status = await goalStatusView(fixture.root);
  assert.equal(status.taskCounts.PLANNING_STUCK, 1);
  assert.equal(status.tasks[0].planning.exhausted, true);
  assert.equal(status.tasks[0].planning.reason, 'planning-role-ping-pong');
  assert.equal(status.terminal, false, 'Goal remains independently controlled by Shipping Finisher');

  const paths = goalRuntimePaths(fixture.root);
  await writeFile(paths.goals, '{broken', 'utf8');
  await writeFile(paths.tasks, '{broken', 'utf8');
  const recovered = await recoverGoalRuntime(fixture.root);
  assert.equal(recovered.graph.tasks[0].state, 'PLANNING_STUCK');
  await assert.rejects(
    () => recordPlanningCycle(fixture.root, { taskId, role: 'planner', signature: 'try again' }),
    /cannot accept planning cycles/u,
  );
});
