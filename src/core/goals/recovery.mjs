import { invariant } from '../errors.mjs';
import { validateGoalGraph } from './graph.mjs';
import { readExecutionLedger } from './ledger.mjs';
import { transitionGoalRecord, transitionTaskRecord } from './states.mjs';
import { writeGoalSnapshots } from './store.mjs';

/** @param {Record<string, any>} graph @param {Record<string, any>} event */
function applyEvent(graph, event) {
  if (event.type === 'PLANNING_CYCLE_RECORDED' && event.payload?.stateTransition) {
    const transition = event.payload.stateTransition;
    const index = graph.tasks.findIndex((task) => task.id === transition.taskId);
    invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Planning event references missing Task ${transition.taskId}`);
    invariant(graph.tasks[index].state === transition.from, 'ERR_GOAL_RECOVERY', `Task ${transition.taskId} planning source state mismatch`);
    graph.tasks[index] = transitionTaskRecord(graph.tasks[index], transition.to);
    return;
  }
  if (event.type === 'RUNTIME_PAUSED') {
    for (const transition of event.payload.transitions ?? []) {
      const index = graph.tasks.findIndex((task) => task.id === transition.taskId);
      invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Pause event references missing Task ${transition.taskId}`);
      invariant(graph.tasks[index].state === transition.from, 'ERR_GOAL_RECOVERY', `Task ${transition.taskId} pause source state mismatch`);
      const next = transitionTaskRecord(graph.tasks[index], 'PAUSED');
      graph.tasks[index] = { ...next, resumeState: transition.resumeState };
    }
    return;
  }
  if (event.type === 'RUNTIME_RESUMED') {
    for (const transition of event.payload.transitions ?? []) {
      const index = graph.tasks.findIndex((task) => task.id === transition.taskId);
      invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Resume event references missing Task ${transition.taskId}`);
      invariant(graph.tasks[index].state === 'PAUSED', 'ERR_GOAL_RECOVERY', `Task ${transition.taskId} is not paused during recovery`);
      const next = transitionTaskRecord(graph.tasks[index], transition.to);
      const { resumeState: _removed, ...withoutResume } = next;
      graph.tasks[index] = withoutResume;
    }
    return;
  }
  if (event.type === 'RUNTIME_ABORTED') {
    for (const transition of event.payload.taskTransitions ?? []) {
      const index = graph.tasks.findIndex((task) => task.id === transition.taskId);
      invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Abort event references missing Task ${transition.taskId}`);
      invariant(graph.tasks[index].state === transition.from, 'ERR_GOAL_RECOVERY', `Task ${transition.taskId} abort source state mismatch`);
      const next = transitionTaskRecord(graph.tasks[index], 'BLOCKED');
      const { resumeState: _removed, ...withoutResume } = next;
      graph.tasks[index] = withoutResume;
    }
    for (const transition of event.payload.goalTransitions ?? []) {
      const index = graph.goals.findIndex((goal) => goal.id === transition.goalId);
      invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Abort event references missing Goal ${transition.goalId}`);
      invariant(graph.goals[index].state === transition.from, 'ERR_GOAL_RECOVERY', `Goal ${transition.goalId} abort source state mismatch`);
      graph.goals[index] = transitionGoalRecord(graph.goals[index], 'BLOCKED');
    }
    return;
  }
  if (event.type === 'GOAL_TRANSITION') {
    const index = graph.goals.findIndex((goal) => goal.id === event.entityId);
    invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Recovery event references missing Goal ${event.entityId}`);
    invariant(graph.goals[index].state === event.payload.from, 'ERR_GOAL_RECOVERY', `Goal ${event.entityId} recovery source state mismatch`);
    graph.goals[index] = transitionGoalRecord(graph.goals[index], event.payload.to);
    return;
  }
  if (event.type === 'TASK_TRANSITION') {
    const index = graph.tasks.findIndex((task) => task.id === event.entityId);
    invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Recovery event references missing Task ${event.entityId}`);
    invariant(graph.tasks[index].state === event.payload.from, 'ERR_GOAL_RECOVERY', `Task ${event.entityId} recovery source state mismatch`);
    const transitioned = transitionTaskRecord(graph.tasks[index], event.payload.to);
    graph.tasks[index] = event.payload.evidence
      ? { ...transitioned, evidenceRefs: [...new Set([...transitioned.evidenceRefs, event.payload.evidence.evidenceRef])] }
      : transitioned;
    return;
  }
  if (event.type === 'ATTEMPT_RECORDED') {
    const index = graph.tasks.findIndex((task) => task.id === event.entityId);
    invariant(index >= 0, 'ERR_GOAL_RECOVERY', `Attempt event references missing Task ${event.entityId}`);
    const record = event.payload.record;
    invariant(record.attemptNumber >= graph.tasks[index].attempts, 'ERR_GOAL_RECOVERY', `Task ${event.entityId} attempt number regressed`);
    graph.tasks[index] = {
      ...graph.tasks[index],
      attempts: record.attemptNumber,
      currentAttemptId: record.attemptId,
    };
  }
}

/** @param {Record<string, any>[]} events */
export function replayGoalRuntime(events) {
  invariant(Array.isArray(events) && events.length > 0, 'ERR_GOAL_RECOVERY', 'Goal recovery requires ledger events');
  const initial = events[0];
  invariant(initial.type === 'GRAPH_COMPILED' && initial.payload?.graph, 'ERR_GOAL_RECOVERY', 'First Goal ledger event must compile the graph');
  const graph = structuredClone(initial.payload.graph);
  validateGoalGraph(graph);
  for (const event of events) {
    invariant(event.release === graph.release, 'ERR_GOAL_RECOVERY', `Ledger release mismatch at event ${event.seq}`);
    invariant(event.contractHash === graph.contractHash, 'ERR_GOAL_RECOVERY', `Ledger contract mismatch at event ${event.seq}`);
    invariant(event.graphHash === graph.graphHash, 'ERR_GOAL_RECOVERY', `Ledger graph mismatch at event ${event.seq}`);
  }
  for (const event of events.slice(1)) applyEvent(graph, event);
  validateGoalGraph(graph);
  return graph;
}

/**
 * @param {string} root
 * @param {{repairSnapshots?: boolean, allowTruncatedTail?: boolean}} [options]
 */
export async function recoverGoalRuntime(root, options = {}) {
  const { events, diagnostics } = await readExecutionLedger(root, {
    allowTruncatedTail: options.allowTruncatedTail ?? true,
  });
  const graph = replayGoalRuntime(events);
  if (options.repairSnapshots !== false) {
    const latestAt = events.at(-1)?.at ?? new Date().toISOString();
    await writeGoalSnapshots(root, graph, latestAt);
  }
  return {
    graph,
    diagnostics,
    replayedEvents: events.length,
    terminalTasks: graph.tasks.filter((task) => ['DONE', 'BLOCKED', 'PLANNING_STUCK'].includes(task.state)).map((task) => task.id).sort(),
  };
}
