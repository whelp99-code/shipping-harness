import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { hashObject } from '../../src/core/crypto.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { createTaskEvidenceReceipt } from '../../src/core/goals/freshness.mjs';
import { checkpointPath, goalRuntimePaths } from '../../src/core/goals/paths.mjs';
import { recoverGoalRuntime } from '../../src/core/goals/recovery.mjs';
import {
  initializeGoalRuntime,
  readGoalRuntime,
  transitionStoredTask,
} from '../../src/core/goals/store.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

function graphFor(hash = '4'.repeat(64)) {
  return compileGoalGraph({
    project: 'goal-attack-fixture',
    release: '0.5.0',
    goal: 'Reject fabricated work and duplicate completion.',
    acceptance: [{ id: 'AC-001', description: 'Original task passes.' }],
  }, {
    contractHash: hash,
    taskSpecs: [{
      id: 'TASK-ORIGINAL',
      title: 'Perform only locked work',
      consumer: { type: 'acceptance', id: 'AC-001' },
      maxAttempts: 2,
    }],
  });
}


test('recomputed snapshot hashes cannot hide injected tasks or changed consumers', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = graphFor();
  await initializeGoalRuntime(fixture.root, graph);
  const paths = goalRuntimePaths(fixture.root);
  const goalsDocument = JSON.parse(await readFile(paths.goals, 'utf8'));
  const tasksDocument = JSON.parse(await readFile(paths.tasks, 'utf8'));
  goalsDocument.goals[0].taskIds.push('TASK-EVIL');
  tasksDocument.tasks.push({
    ...structuredClone(tasksDocument.tasks[0]),
    id: 'TASK-EVIL',
    title: 'Deploy an unapproved public service',
    consumer: { type: 'acceptance', id: 'AC-999' },
  });
  const stateHash = hashObject({ goals: goalsDocument.goals, tasks: tasksDocument.tasks });
  goalsDocument.stateHash = stateHash;
  tasksDocument.stateHash = stateHash;
  await writeFile(paths.goals, `${JSON.stringify(goalsDocument)}\n`, 'utf8');
  await writeFile(paths.tasks, `${JSON.stringify(tasksDocument)}\n`, 'utf8');

  await assert.rejects(() => readGoalRuntime(fixture.root), /immutable structure hash does not match/u);
  const recovered = await recoverGoalRuntime(fixture.root);
  assert.deepEqual(recovered.graph.tasks.map((task) => task.id), ['TASK-ORIGINAL']);
  assert.equal((await readGoalRuntime(fixture.root)).tasks[0].consumer.id, 'AC-001');
});


test('fabricated checkpoints are not an authority source and ledger recovery ignores them', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = graphFor('5'.repeat(64));
  await initializeGoalRuntime(fixture.root, graph);
  const fakePath = checkpointPath(fixture.root, 'checkpoint-fabricated');
  await writeFile(fakePath, `${JSON.stringify({
    schema: 'shipping-harness/goal-checkpoint-v1',
    checkpointId: 'checkpoint-fabricated',
    graph: {
      ...graph,
      tasks: [{ ...graph.tasks[0], id: 'TASK-EVIL', title: 'Fabricated completion', state: 'DONE', evidenceRefs: ['fake'] }],
    },
  })}\n`, 'utf8');
  const recovered = await recoverGoalRuntime(fixture.root);
  assert.deepEqual(recovered.graph.tasks.map((task) => task.id), ['TASK-ORIGINAL']);
  assert.equal(recovered.graph.tasks[0].state, 'PENDING');
});


test('duplicate completion and optional review debt cannot reopen terminal task state', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = graphFor('6'.repeat(64));
  const taskId = graph.tasks[0].id;
  await initializeGoalRuntime(fixture.root, graph);
  await transitionStoredTask(fixture.root, taskId, 'READY');
  await transitionStoredTask(fixture.root, taskId, 'RUNNING');
  await transitionStoredTask(fixture.root, taskId, 'VERIFYING');
  const current = await readGoalRuntime(fixture.root);
  const sha = currentGitSha(fixture.root);
  const evidence = createTaskEvidenceReceipt({
    graph: current,
    task: current.tasks[0],
    gitSha: sha,
    evidenceRef: 'evidence://AC-001/original',
  });
  await transitionStoredTask(fixture.root, taskId, 'DONE', { currentGitSha: sha, evidence });
  await assert.rejects(
    () => transitionStoredTask(fixture.root, taskId, 'DONE', { currentGitSha: sha, evidence }),
    /Invalid Task transition/u,
  );
  await assert.rejects(
    () => transitionStoredTask(fixture.root, taskId, 'FAILED', { reason: 'reviewer prefers a refactor' }),
    /Invalid Task transition/u,
  );
});
