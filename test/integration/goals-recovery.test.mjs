import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { readExecutionLedger } from '../../src/core/goals/ledger.mjs';
import { recoverGoalRuntime } from '../../src/core/goals/recovery.mjs';
import {
  createGoalCheckpoint,
  initializeGoalRuntime,
  readGoalRuntime,
  recordTaskAttempt,
  transitionStoredGoal,
  transitionStoredTask,
} from '../../src/core/goals/store.mjs';
import { goalRuntimePaths } from '../../src/core/goals/paths.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const contract = {
  project: 'recovery-fixture',
  release: '0.5.0',
  goal: 'Recover durable work without replaying completed tasks.',
  acceptance: [
    { id: 'AC-001', description: 'First durable task passes.' },
    { id: 'AC-002', description: 'Second durable task passes.' },
  ],
};


test('append-only Goal ledger rebuilds corrupted snapshots without replaying completed work', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = compileGoalGraph(contract, { contractHash: 'b'.repeat(64) });
  const goalId = graph.goals[0].id;
  const [firstTask, secondTask] = graph.tasks.map((task) => task.id);
  let event = 0;
  const next = () => ({
    at: `2026-08-28T05:${String(event).padStart(2, '0')}:00.000Z`,
    eventId: `event-${String(++event).padStart(3, '0')}`,
  });

  await initializeGoalRuntime(fixture.root, graph, next());
  await transitionStoredGoal(fixture.root, goalId, 'ACTIVE', next());
  for (const taskId of [firstTask, secondTask]) {
    await transitionStoredTask(fixture.root, taskId, 'READY', next());
    await transitionStoredTask(fixture.root, taskId, 'RUNNING', next());
    if (taskId === firstTask) {
      await recordTaskAttempt(fixture.root, {
        taskId,
        attemptId: 'attempt-001',
        command: 'npm test',
        gitSha: '1'.repeat(40),
        status: 'passed',
        evidenceRefs: ['evidence://AC-001'],
        ...next(),
      });
    }
    await transitionStoredTask(fixture.root, taskId, 'VERIFYING', next());
    await transitionStoredTask(fixture.root, taskId, 'DONE', next());
  }
  await transitionStoredGoal(fixture.root, goalId, 'VERIFYING', next());
  await transitionStoredGoal(fixture.root, goalId, 'DONE', next());
  const checkpoint = await createGoalCheckpoint(fixture.root, {
    checkpointId: 'checkpoint-done',
    reason: 'all tasks complete',
    ...next(),
  });

  const before = await readGoalRuntime(fixture.root);
  assert.equal(before.goals[0].state, 'DONE');
  assert.equal(before.tasks.every((task) => task.state === 'DONE'), true);
  assert.equal(before.tasks.find((task) => task.id === firstTask).attempts, 1);
  assert.equal(JSON.parse(await readFile(checkpoint.path, 'utf8')).stateHash.length, 64);

  const paths = goalRuntimePaths(fixture.root);
  await writeFile(paths.goals, '{partial snapshot', 'utf8');
  await writeFile(paths.tasks, '{partial snapshot', 'utf8');
  const recovered = await recoverGoalRuntime(fixture.root);
  assert.equal(recovered.graph.goals[0].state, 'DONE');
  assert.deepEqual(recovered.terminalTasks, [firstTask, secondTask].sort());
  assert.equal(recovered.replayedEvents, 14);
  assert.equal((await readGoalRuntime(fixture.root)).tasks.every((task) => task.state === 'DONE'), true);

  await appendFile(paths.ledger, '{"truncated":', 'utf8');
  const tailRecovered = await recoverGoalRuntime(fixture.root, { allowTruncatedTail: true });
  assert.equal(tailRecovered.diagnostics[0].code, 'TRUNCATED_TAIL_IGNORED');
  assert.equal(tailRecovered.graph.tasks.every((task) => task.state === 'DONE'), true);
});


test('execution ledger sequence and hash chain are deterministic and non-tail corruption fails closed', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const graph = compileGoalGraph(contract, { contractHash: 'c'.repeat(64) });
  await initializeGoalRuntime(fixture.root, graph, {
    at: '2026-08-28T05:00:00.000Z',
    eventId: 'event-001',
  });
  await transitionStoredGoal(fixture.root, graph.goals[0].id, 'ACTIVE', {
    at: '2026-08-28T05:01:00.000Z',
    eventId: 'event-002',
  });
  const ledger = await readExecutionLedger(fixture.root);
  assert.deepEqual(ledger.events.map((event) => event.seq), [1, 2]);
  assert.equal(ledger.events[0].previousHash, null);
  assert.equal(ledger.events[1].previousHash, ledger.events[0].eventHash);

  await appendFile(goalRuntimePaths(fixture.root).ledger, 'not-json\n', 'utf8');
  await assert.rejects(() => recoverGoalRuntime(fixture.root), /Invalid Goal execution ledger JSON/u);
});
