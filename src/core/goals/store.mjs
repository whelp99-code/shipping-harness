import { hashObject } from '../crypto.mjs';
import { invariant } from '../errors.mjs';
import { ensureDir, exists, readJson, writeJsonAtomic } from '../fs.mjs';
import { validateGoalGraph } from './graph.mjs';
import { assertFreshTaskEvidence } from './freshness.mjs';
import { appendExecutionEvent, readExecutionLedger } from './ledger.mjs';
import { attemptPath, checkpointPath, goalRuntimePaths } from './paths.mjs';
import { transitionGoalRecord, transitionTaskRecord } from './states.mjs';

/** @param {Record<string, any>} graph @param {string} updatedAt */
function snapshotDocuments(graph, updatedAt) {
  const identity = {
    project: graph.project,
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    stateHash: hashObject({ goals: graph.goals, tasks: graph.tasks }),
    updatedAt,
  };
  return {
    goals: { schema: 'shipping-harness/goal-snapshot-v1', ...identity, goals: graph.goals },
    tasks: { schema: 'shipping-harness/task-snapshot-v1', ...identity, tasks: graph.tasks },
  };
}

/** @param {string} root @param {Record<string, any>} graph @param {string} [updatedAt] */
export async function writeGoalSnapshots(root, graph, updatedAt = new Date().toISOString()) {
  validateGoalGraph(graph);
  const paths = goalRuntimePaths(root);
  const documents = snapshotDocuments(graph, updatedAt);
  await writeJsonAtomic(paths.goals, documents.goals);
  await writeJsonAtomic(paths.tasks, documents.tasks);
  return documents;
}

/** @param {string} root */
export async function readGoalRuntime(root) {
  const paths = goalRuntimePaths(root);
  const [goalsDocument, tasksDocument] = await Promise.all([readJson(paths.goals), readJson(paths.tasks)]);
  invariant(goalsDocument.schema === 'shipping-harness/goal-snapshot-v1', 'ERR_GOAL_SNAPSHOT', 'Unsupported Goal snapshot schema');
  invariant(tasksDocument.schema === 'shipping-harness/task-snapshot-v1', 'ERR_GOAL_SNAPSHOT', 'Unsupported Task snapshot schema');
  for (const key of ['project', 'release', 'contractHash', 'graphHash', 'stateHash']) {
    invariant(goalsDocument[key] === tasksDocument[key], 'ERR_GOAL_SNAPSHOT', `Goal and Task snapshot ${key} mismatch`);
  }
  const graph = {
    schema: 'shipping-harness/goals-v1',
    project: goalsDocument.project,
    release: goalsDocument.release,
    contractHash: goalsDocument.contractHash,
    graphHash: goalsDocument.graphHash,
    goals: goalsDocument.goals,
    tasks: tasksDocument.tasks,
  };
  validateGoalGraph(graph);
  invariant(goalsDocument.stateHash === hashObject({ goals: graph.goals, tasks: graph.tasks }), 'ERR_GOAL_SNAPSHOT', 'Goal/Task snapshot state hash mismatch');
  return graph;
}

/** @param {string} root @param {Record<string, any>} graph @param {{at?: string, eventId?: string}} [options] */
export async function initializeGoalRuntime(root, graph, options = {}) {
  validateGoalGraph(graph);
  const paths = goalRuntimePaths(root);
  await ensureDir(paths.checkpoints);
  await ensureDir(paths.attempts);
  const { events } = await readExecutionLedger(root);
  invariant(events.length === 0 && !(await exists(paths.goals)) && !(await exists(paths.tasks)), 'ERR_GOAL_ALREADY_INITIALIZED', 'Goal runtime is already initialized');
  const event = await appendExecutionEvent(root, {
    type: 'GRAPH_COMPILED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    payload: { graph },
    at: options.at,
    eventId: options.eventId,
  });
  await writeGoalSnapshots(root, graph, event.at);
  return { graph, event };
}

/** @param {string} root @param {string} goalId @param {string} nextState @param {{reason?: string, at?: string, eventId?: string}} [options] */
export async function transitionStoredGoal(root, goalId, nextState, options = {}) {
  const graph = await readGoalRuntime(root);
  const index = graph.goals.findIndex((goal) => goal.id === goalId);
  invariant(index >= 0, 'ERR_GOAL_NOT_FOUND', `Goal not found: ${goalId}`);
  const previous = graph.goals[index];
  if (nextState === 'DONE') {
    const ownedTasks = graph.tasks.filter((task) => task.goalId === goalId);
    invariant(ownedTasks.length > 0 && ownedTasks.every((task) => task.state === 'DONE' && task.evidenceRefs.length > 0), 'ERR_GOAL_EVIDENCE_REQUIRED', `Goal ${goalId} cannot become DONE until every owned Task is DONE with evidence`);
  }
  graph.goals[index] = transitionGoalRecord(previous, nextState);
  const event = await appendExecutionEvent(root, {
    type: 'GOAL_TRANSITION',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    entityType: 'goal',
    entityId: goalId,
    payload: { from: previous.state, to: nextState, reason: options.reason ?? null },
    at: options.at,
    eventId: options.eventId,
  });
  await writeGoalSnapshots(root, graph, event.at);
  return { graph, event };
}

/** @param {string} root @param {string} taskId @param {string} nextState @param {{reason?: string, at?: string, eventId?: string, evidence?: unknown, currentGitSha?: string}} [options] */
export async function transitionStoredTask(root, taskId, nextState, options = {}) {
  const graph = await readGoalRuntime(root);
  const index = graph.tasks.findIndex((task) => task.id === taskId);
  invariant(index >= 0, 'ERR_TASK_NOT_FOUND', `Task not found: ${taskId}`);
  const previous = graph.tasks[index];
  let evidence = null;
  if (nextState === 'DONE') {
    invariant(typeof options.currentGitSha === 'string', 'ERR_TASK_EVIDENCE_REQUIRED', `Task ${taskId} completion requires the current Git SHA`);
    evidence = assertFreshTaskEvidence(graph, previous, options.evidence, options.currentGitSha);
  }
  const transitioned = transitionTaskRecord(previous, nextState);
  graph.tasks[index] = evidence
    ? { ...transitioned, evidenceRefs: [...new Set([...transitioned.evidenceRefs, evidence.evidenceRef])] }
    : transitioned;
  const event = await appendExecutionEvent(root, {
    type: 'TASK_TRANSITION',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    entityType: 'task',
    entityId: taskId,
    payload: { from: previous.state, to: nextState, reason: options.reason ?? null, evidence },
    at: options.at,
    eventId: options.eventId,
  });
  await writeGoalSnapshots(root, graph, event.at);
  return { graph, event };
}

/** @param {string} root @param {{checkpointId: string, reason?: string, at?: string, eventId?: string}} input */
export async function createGoalCheckpoint(root, input) {
  const graph = await readGoalRuntime(root);
  const target = checkpointPath(root, input.checkpointId);
  const checkpoint = {
    schema: 'shipping-harness/goal-checkpoint-v1',
    checkpointId: input.checkpointId,
    createdAt: input.at ?? new Date().toISOString(),
    reason: input.reason ?? null,
    project: graph.project,
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    stateHash: hashObject({ goals: graph.goals, tasks: graph.tasks }),
    graph,
  };
  await writeJsonAtomic(target, checkpoint);
  const event = await appendExecutionEvent(root, {
    type: 'CHECKPOINT_CREATED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    payload: { checkpointId: input.checkpointId, path: target, stateHash: checkpoint.stateHash },
    at: checkpoint.createdAt,
    eventId: input.eventId,
  });
  return { checkpoint, event, path: target };
}

/**
 * @param {string} root
 * @param {{taskId: string, attemptId: string, command?: string, gitSha?: string, status: string, evidenceRefs?: string[], error?: string|null, at?: string, eventId?: string}} input
 */
export async function recordTaskAttempt(root, input) {
  const graph = await readGoalRuntime(root);
  const index = graph.tasks.findIndex((task) => task.id === input.taskId);
  invariant(index >= 0, 'ERR_TASK_NOT_FOUND', `Task not found: ${input.taskId}`);
  const task = graph.tasks[index];
  invariant(task.attempts < task.maxAttempts, 'ERR_TASK_BUDGET', `Task ${task.id} exhausted its attempt budget`);
  const attemptNumber = task.attempts + 1;
  const record = {
    schema: 'shipping-harness/task-attempt-v1',
    attemptId: input.attemptId,
    taskId: task.id,
    attemptNumber,
    createdAt: input.at ?? new Date().toISOString(),
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    gitSha: input.gitSha ?? null,
    command: input.command ?? null,
    status: input.status,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    error: input.error ?? null,
  };
  const target = attemptPath(root, task.id, input.attemptId);
  await writeJsonAtomic(target, record);
  graph.tasks[index] = { ...task, attempts: attemptNumber, currentAttemptId: input.attemptId };
  const event = await appendExecutionEvent(root, {
    type: 'ATTEMPT_RECORDED',
    release: graph.release,
    contractHash: graph.contractHash,
    graphHash: graph.graphHash,
    entityType: 'task',
    entityId: task.id,
    payload: { record, path: target },
    at: record.createdAt,
    eventId: input.eventId,
  });
  await writeGoalSnapshots(root, graph, event.at);
  return { graph, record, event, path: target };
}
