import { invariant } from '../errors.mjs';
import { validateGoalGraph } from './graph.mjs';
import { readExecutionLedger } from './ledger.mjs';
import { transitionGoalRecord, transitionTaskRecord } from './states.mjs';
import { writeGoalSnapshots } from './store.mjs';

/** @param {Record<string, any>} graph @param {Record<string, any>} event */
function applyEvent(graph, event) {
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
