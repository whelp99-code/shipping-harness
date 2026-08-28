import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { readyTaskIds, validateGoalGraph } from '../../src/core/goals/graph.mjs';
import { assertGoalTransition, assertTaskTransition, transitionTaskRecord } from '../../src/core/goals/states.mjs';

const contract = Object.freeze({
  project: 'goal-fixture',
  release: '0.5.0',
  goal: 'Ship a durable Goal and Task runtime.',
  acceptance: [
    { id: 'AC-001', description: 'Compile the graph.' },
    { id: 'AC-002', description: 'Recover the graph.' },
  ],
});
const contractHash = 'a'.repeat(64);


test('locked contract compiles deterministically into stable Goals and acceptance-linked Tasks', () => {
  const first = compileGoalGraph(contract, { contractHash });
  const second = compileGoalGraph(contract, { contractHash });
  assert.deepEqual(first, second);
  assert.equal(first.goals.length, 1);
  assert.equal(first.goals[0].id, 'GOAL-AAAAAAAAAAAA');
  assert.deepEqual(first.goals[0].taskIds, ['TASK-AC-001', 'TASK-AC-002']);
  assert.deepEqual(first.tasks.map((task) => task.consumer), [
    { type: 'acceptance', id: 'AC-001' },
    { type: 'acceptance', id: 'AC-002' },
  ]);
  assert.deepEqual(readyTaskIds(first), ['TASK-AC-001', 'TASK-AC-002']);
  assert.equal(first.graphHash.length, 64);
});


test('orphan, duplicate, missing consumer, and cyclic task graphs are rejected', () => {
  const base = compileGoalGraph(contract, { contractHash });

  const orphan = structuredClone(base);
  orphan.tasks[0].goalId = 'GOAL-MISSING';
  assert.throws(() => validateGoalGraph(orphan, { acceptanceIds: ['AC-001', 'AC-002'] }), /missing Goal/u);

  const duplicate = structuredClone(base);
  duplicate.tasks.push(structuredClone(duplicate.tasks[0]));
  assert.throws(() => validateGoalGraph(duplicate, { acceptanceIds: ['AC-001', 'AC-002'] }), /duplicate Task IDs/u);

  assert.throws(() => compileGoalGraph(contract, {
    contractHash,
    taskSpecs: [{
      id: 'TASK-UNKNOWN',
      title: 'Unknown consumer',
      consumer: { type: 'acceptance', id: 'AC-999' },
    }],
  }), /unknown acceptance/u);

  assert.throws(() => compileGoalGraph(contract, {
    contractHash,
    taskSpecs: [
      { id: 'TASK-A', title: 'A', consumer: { type: 'acceptance', id: 'AC-001' }, dependsOn: ['TASK-B'] },
      { id: 'TASK-B', title: 'B', consumer: { type: 'acceptance', id: 'AC-002' }, dependsOn: ['TASK-A'] },
    ],
  }), /contains a cycle/u);
});


test('Goal and Task state transitions are explicit and terminal work cannot reopen', () => {
  assert.equal(assertGoalTransition('PENDING', 'ACTIVE'), true);
  assert.equal(assertTaskTransition('PENDING', 'READY'), true);
  const task = compileGoalGraph(contract, { contractHash }).tasks[0];
  const ready = transitionTaskRecord(task, 'READY');
  const running = transitionTaskRecord(ready, 'RUNNING');
  assert.equal(running.state, 'RUNNING');
  assert.throws(() => assertTaskTransition('DONE', 'RUNNING'), /Invalid Task transition/u);
  assert.throws(() => assertGoalTransition('DONE', 'ACTIVE'), /Invalid Goal transition/u);
});
