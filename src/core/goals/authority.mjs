import { invariant } from '../errors.mjs';
import { appendExecutionEvent } from './ledger.mjs';
import { goalRuntimeExists } from './status-view.mjs';
import { readGoalRuntime, writeGoalSnapshots } from './store.mjs';
import { transitionGoalRecord, transitionTaskRecord } from './states.mjs';

const TASK_TERMINAL = new Set(['DONE', 'BLOCKED', 'PLANNING_STUCK']);
const GOAL_TERMINAL = new Set(['DONE', 'BLOCKED', 'SUPERSEDED']);

/** @param {string} root @param {string} reason */
export async function pauseGoalRuntime(root, reason = 'operator pause') {
  if (!(await goalRuntimeExists(root))) return null;
  const graph = await readGoalRuntime(root);
  const transitions = [];
  graph.tasks = graph.tasks.map((task) => {
    if (TASK_TERMINAL.has(task.state) || task.state === 'PAUSED') return task;
    const next = transitionTaskRecord(task, 'PAUSED');
    transitions.push({ taskId: task.id, from: task.state, to: 'PAUSED', resumeState: task.state });
    return { ...next, resumeState: task.state };
  });
  if (transitions.length === 0) return { graph, event: null, transitions: [] };
  const at = new Date().toISOString();
  const event = await appendExecutionEvent(root, {
    type: 'RUNTIME_PAUSED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    payload: { reason, transitions },
    at,
  });
  await writeGoalSnapshots(root, graph, at);
  return { graph, event, transitions };
}

/** @param {string} root @param {string} reason */
export async function resumeGoalRuntime(root, reason = 'operator resume') {
  if (!(await goalRuntimeExists(root))) return null;
  const graph = await readGoalRuntime(root);
  const transitions = [];
  graph.tasks = graph.tasks.map((task) => {
    if (task.state !== 'PAUSED') return task;
    invariant(typeof task.resumeState === 'string', 'ERR_GOAL_RESUME', `Paused Task ${task.id} is missing resumeState`);
    const next = transitionTaskRecord(task, task.resumeState);
    transitions.push({ taskId: task.id, from: 'PAUSED', to: task.resumeState });
    const { resumeState: _removed, ...withoutResume } = next;
    return withoutResume;
  });
  if (transitions.length === 0) return { graph, event: null, transitions: [] };
  const at = new Date().toISOString();
  const event = await appendExecutionEvent(root, {
    type: 'RUNTIME_RESUMED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    payload: { reason, transitions },
    at,
  });
  await writeGoalSnapshots(root, graph, at);
  return { graph, event, transitions };
}

/** @param {string} root @param {string} reason */
export async function abortGoalRuntime(root, reason = 'operator abort') {
  if (!(await goalRuntimeExists(root))) return null;
  const graph = await readGoalRuntime(root);
  const taskTransitions = [];
  const goalTransitions = [];
  graph.tasks = graph.tasks.map((task) => {
    if (TASK_TERMINAL.has(task.state)) return task;
    const next = transitionTaskRecord(task, 'BLOCKED');
    taskTransitions.push({ taskId: task.id, from: task.state, to: 'BLOCKED' });
    const { resumeState: _removed, ...withoutResume } = next;
    return withoutResume;
  });
  graph.goals = graph.goals.map((goal) => {
    if (GOAL_TERMINAL.has(goal.state)) return goal;
    const next = transitionGoalRecord(goal, 'BLOCKED');
    goalTransitions.push({ goalId: goal.id, from: goal.state, to: 'BLOCKED' });
    return next;
  });
  if (taskTransitions.length === 0 && goalTransitions.length === 0) {
    return { graph, event: null, taskTransitions, goalTransitions };
  }
  const at = new Date().toISOString();
  const event = await appendExecutionEvent(root, {
    type: 'RUNTIME_ABORTED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    payload: { reason, taskTransitions, goalTransitions },
    at,
  });
  await writeGoalSnapshots(root, graph, at);
  return { graph, event, taskTransitions, goalTransitions };
}
