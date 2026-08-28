import { exists, readJson } from '../fs.mjs';
import { readyTaskIds } from './graph.mjs';
import { goalRuntimePaths } from './paths.mjs';
import { readGoalRuntime } from './store.mjs';

/** @param {Array<Record<string, any>>} records */
function countStates(records) {
  return Object.fromEntries([...records.reduce((counts, record) => {
    counts.set(record.state, (counts.get(record.state) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

/** @param {string} root */
export async function goalRuntimeExists(root) {
  const paths = goalRuntimePaths(root);
  const [goals, tasks] = await Promise.all([exists(paths.goals), exists(paths.tasks)]);
  return goals && tasks;
}

/** @param {string} root */
export async function goalStatusView(root) {
  if (!(await goalRuntimeExists(root))) return null;
  const graph = await readGoalRuntime(root);
  const paths = goalRuntimePaths(root);
  const planning = (await exists(paths.planningCounters))
    ? await readJson(paths.planningCounters)
    : { records: [] };
  const planningByTask = new Map();
  for (const record of planning.records ?? []) {
    const current = planningByTask.get(record.taskId) ?? { cycles: 0, exhausted: false, reason: null };
    current.cycles += 1;
    if (record.exhausted) {
      current.exhausted = true;
      current.reason = record.reason;
    }
    planningByTask.set(record.taskId, current);
  }
  const goals = graph.goals.slice(0, 100).map((goal) => ({
    id: goal.id,
    title: goal.title,
    state: goal.state,
    taskCount: goal.taskIds.length,
    acceptanceCount: goal.acceptanceIds.length,
    evidenceCount: goal.evidenceRefs.length,
    blockerCount: goal.blockerRefs.length,
  }));
  const tasks = graph.tasks.slice(0, 200).map((task) => ({
    id: task.id,
    goalId: task.goalId,
    title: task.title,
    state: task.state,
    consumer: task.consumer,
    dependsOn: task.dependsOn,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    evidenceCount: task.evidenceRefs.length,
    blockerCount: task.blockerRefs.length,
    resumeState: task.resumeState ?? null,
    planning: planningByTask.get(task.id) ?? { cycles: 0, exhausted: false, reason: null },
  }));
  return {
    schema: 'shipping-harness/goal-status-v1',
    project: graph.project,
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    goalCounts: countStates(graph.goals),
    taskCounts: countStates(graph.tasks),
    readyTaskIds: readyTaskIds(graph),
    terminal: graph.goals.every((goal) => ['DONE', 'BLOCKED', 'SUPERSEDED'].includes(goal.state)) &&
      graph.tasks.every((task) => ['DONE', 'BLOCKED', 'PLANNING_STUCK'].includes(task.state)),
    goals,
    tasks,
    truncated: graph.goals.length > goals.length || graph.tasks.length > tasks.length,
  };
}
