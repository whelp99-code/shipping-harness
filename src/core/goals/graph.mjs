import { invariant } from '../errors.mjs';
import { hashObject } from '../crypto.mjs';
import { validateGoalRecord, validateTaskRecord } from './schema.mjs';

/** @param {Record<string, any>} graph */
export function goalGraphIdentity(graph) {
  return {
    schema: graph.schema,
    project: graph.project,
    release: graph.release,
    contractHash: graph.contractHash,
    goals: [...graph.goals].map((goal) => ({
      id: goal.id,
      title: goal.title,
      state: 'PENDING',
      taskIds: [...goal.taskIds],
      acceptanceIds: [...goal.acceptanceIds],
      evidenceRefs: [],
      blockerRefs: [],
    })).sort((left, right) => left.id.localeCompare(right.id)),
    tasks: [...graph.tasks].map((task) => ({
      id: task.id,
      goalId: task.goalId,
      title: task.title,
      state: 'PENDING',
      consumer: { ...task.consumer },
      dependsOn: [...task.dependsOn].sort(),
      maxAttempts: task.maxAttempts,
      attempts: 0,
      currentAttemptId: null,
      evidenceRefs: [],
      blockerRefs: [],
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/** @param {Record<string, any>} graph */
export function computeGoalGraphHash(graph) {
  return hashObject(goalGraphIdentity(graph));
}

/** @param {Record<string, any>[]} tasks */
function assertAcyclic(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();

  /** @param {string} taskId @param {string[]} trail */
  function visit(taskId, trail) {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      const start = trail.indexOf(taskId);
      const cycle = [...trail.slice(start), taskId];
      invariant(false, 'ERR_GOAL_CYCLE', `Task graph contains a cycle: ${cycle.join(' -> ')}`, { cycle });
    }
    visiting.add(taskId);
    const task = byId.get(taskId);
    for (const dependency of task?.dependsOn ?? []) visit(dependency, [...trail, taskId]);
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) visit(task.id, []);
}

/**
 * @param {Record<string, any>} graph
 * @param {{acceptanceIds?: string[], requirementIds?: string[]}} [allowed]
 */
export function validateGoalGraph(graph, allowed = {}) {
  invariant(graph && typeof graph === 'object' && !Array.isArray(graph), 'ERR_GOAL_GRAPH', 'Goal graph must be an object');
  invariant(graph.schema === 'shipping-harness/goals-v1', 'ERR_GOAL_GRAPH', 'Unsupported Goal graph schema');
  invariant(typeof graph.project === 'string' && graph.project.length > 0, 'ERR_GOAL_GRAPH', 'Goal graph project is required');
  invariant(typeof graph.release === 'string' && graph.release.length > 0, 'ERR_GOAL_GRAPH', 'Goal graph release is required');
  invariant(typeof graph.contractHash === 'string' && /^[a-f0-9]{64}$/u.test(graph.contractHash), 'ERR_GOAL_GRAPH', 'Goal graph contractHash must be SHA-256');
  invariant(Array.isArray(graph.goals) && graph.goals.length > 0, 'ERR_GOAL_GRAPH', 'Goal graph requires at least one Goal');
  invariant(Array.isArray(graph.tasks) && graph.tasks.length > 0, 'ERR_GOAL_GRAPH', 'Goal graph requires at least one Task');

  for (const goal of graph.goals) validateGoalRecord(goal);
  for (const task of graph.tasks) validateTaskRecord(task);

  const goalIds = graph.goals.map((goal) => goal.id);
  const taskIds = graph.tasks.map((task) => task.id);
  invariant(new Set(goalIds).size === goalIds.length, 'ERR_GOAL_DUPLICATE', 'Goal graph contains duplicate Goal IDs');
  invariant(new Set(taskIds).size === taskIds.length, 'ERR_GOAL_DUPLICATE', 'Goal graph contains duplicate Task IDs');
  const goals = new Map(graph.goals.map((goal) => [goal.id, goal]));
  const tasks = new Map(graph.tasks.map((task) => [task.id, task]));
  const acceptanceIds = new Set(allowed.acceptanceIds ?? []);
  const requirementIds = new Set(allowed.requirementIds ?? []);

  for (const task of graph.tasks) {
    invariant(goals.has(task.goalId), 'ERR_GOAL_ORPHAN', `Task ${task.id} references missing Goal ${task.goalId}`);
    invariant(!task.dependsOn.includes(task.id), 'ERR_GOAL_CYCLE', `Task ${task.id} cannot depend on itself`);
    for (const dependency of task.dependsOn) {
      invariant(tasks.has(dependency), 'ERR_GOAL_DEPENDENCY', `Task ${task.id} references missing dependency ${dependency}`);
    }
    if (task.consumer.type === 'acceptance' && acceptanceIds.size > 0) {
      invariant(acceptanceIds.has(task.consumer.id), 'ERR_GOAL_CONSUMER', `Task ${task.id} references unknown acceptance ${task.consumer.id}`);
    }
    if (task.consumer.type === 'requirement' && requirementIds.size > 0) {
      invariant(requirementIds.has(task.consumer.id), 'ERR_GOAL_CONSUMER', `Task ${task.id} references unknown requirement ${task.consumer.id}`);
    }
  }

  for (const goal of graph.goals) {
    for (const taskId of goal.taskIds) {
      const task = tasks.get(taskId);
      invariant(task, 'ERR_GOAL_ORPHAN', `Goal ${goal.id} references missing Task ${taskId}`);
      invariant(task.goalId === goal.id, 'ERR_GOAL_ORPHAN', `Goal ${goal.id} does not own Task ${taskId}`);
    }
    const owned = graph.tasks.filter((task) => task.goalId === goal.id).map((task) => task.id).sort();
    invariant(JSON.stringify([...goal.taskIds].sort()) === JSON.stringify(owned), 'ERR_GOAL_ORPHAN', `Goal ${goal.id} taskIds do not match owned Tasks`);
  }

  assertAcyclic(graph.tasks);
  if (graph.graphHash !== undefined) {
    invariant(graph.graphHash === computeGoalGraphHash(graph), 'ERR_GOAL_GRAPH_TAMPERED', 'Goal graph immutable structure hash does not match');
  }
  return graph;
}

/** @param {Record<string, any>} graph */
export function readyTaskIds(graph) {
  validateGoalGraph(graph);
  const state = new Map(graph.tasks.map((task) => [task.id, task.state]));
  return graph.tasks
    .filter((task) => task.state === 'PENDING' && task.dependsOn.every((dependency) => state.get(dependency) === 'DONE'))
    .map((task) => task.id)
    .sort();
}
