import { hashObject } from '../crypto.mjs';
import { invariant } from '../errors.mjs';
import { validateGoalGraph } from './graph.mjs';

/** @param {string} value */
function idSegment(value) {
  return value.toUpperCase().replace(/[^A-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
}

/** @param {Record<string, any>} contract */
function contractRequirements(contract) {
  if (!Array.isArray(contract.requirements)) return [];
  return contract.requirements.map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(Boolean);
}

/**
 * Compile one locked release contract into deterministic Goal and Task records.
 * @param {Record<string, any>} contract
 * @param {{contractHash?: string, taskSpecs?: Array<{id?: string, title: string, consumer: {type: 'acceptance'|'requirement', id: string}, dependsOn?: string[], maxAttempts?: number}>}} [options]
 */
export function compileGoalGraph(contract, options = {}) {
  invariant(contract && typeof contract === 'object' && !Array.isArray(contract), 'ERR_GOAL_COMPILE', 'A Shipping contract is required');
  invariant(typeof contract.project === 'string' && contract.project.length > 0, 'ERR_GOAL_COMPILE', 'Contract project is required');
  invariant(typeof contract.release === 'string' && contract.release.length > 0, 'ERR_GOAL_COMPILE', 'Contract release is required');
  invariant(typeof contract.goal === 'string' && contract.goal.trim().length > 0, 'ERR_GOAL_COMPILE', 'Contract goal is required');
  invariant(Array.isArray(contract.acceptance) && contract.acceptance.length > 0, 'ERR_GOAL_COMPILE', 'Contract acceptance criteria are required');

  const contractHash = options.contractHash ?? hashObject(contract);
  invariant(/^[a-f0-9]{64}$/u.test(contractHash), 'ERR_GOAL_COMPILE', 'contractHash must be SHA-256');
  const goalId = `GOAL-${contractHash.slice(0, 12).toUpperCase()}`;
  const acceptanceIds = contract.acceptance.map((criterion) => criterion.id);
  const requirementIds = contractRequirements(contract);
  const taskSpecs = options.taskSpecs ?? contract.acceptance.map((criterion) => ({
    id: `TASK-${idSegment(criterion.id)}`,
    title: criterion.description,
    consumer: { type: 'acceptance', id: criterion.id },
    dependsOn: [],
    maxAttempts: 2,
  }));

  const tasks = taskSpecs.map((spec) => ({
    id: spec.id ?? `TASK-${idSegment(spec.consumer.id)}`,
    goalId,
    title: spec.title,
    state: 'PENDING',
    consumer: { type: spec.consumer.type, id: spec.consumer.id },
    dependsOn: [...(spec.dependsOn ?? [])].sort(),
    maxAttempts: spec.maxAttempts ?? 2,
    attempts: 0,
    currentAttemptId: null,
    evidenceRefs: [],
    blockerRefs: [],
  })).sort((left, right) => left.id.localeCompare(right.id));

  const graph = {
    schema: 'shipping-harness/goals-v1',
    project: contract.project,
    release: contract.release,
    contractHash,
    goals: [{
      id: goalId,
      title: contract.goal.trim(),
      state: 'PENDING',
      taskIds: tasks.map((task) => task.id),
      acceptanceIds: [...acceptanceIds].sort(),
      evidenceRefs: [],
      blockerRefs: [],
    }],
    tasks,
  };
  validateGoalGraph(graph, { acceptanceIds, requirementIds });
  return { ...graph, graphHash: hashObject(graph) };
}
