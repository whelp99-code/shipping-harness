import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLockedContract } from '../../src/core/contract.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { compileGoalGraph } from '../../src/core/goals/index.mjs';
import { readState } from '../../src/core/state.mjs';
import { invariant } from '../../src/core/errors.mjs';
import { signObject } from './canonical.mjs';

const PROTECTED = ['.git/**', '.shipping/**', '.ssh/**', '.aws/**', '.gnupg/**'];
const SAFE = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[A-Za-z0-9._*?{}[\]/!+-]+$/u;

function safePaths(values, { protectedPaths = false } = {}) {
  const normalized = (values ?? [])
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => SAFE.test(entry));
  const result = protectedPaths ? [...normalized, ...PROTECTED] : normalized.filter((entry) => !PROTECTED.some((item) => entry.startsWith(item.replace('/**', '/'))));
  return [...new Set(result)].sort();
}

/**
 * @param {string} root
 * @param {{hmacKey: string, prompt?: string, mode?: 'probe'|'native', requestedAgent?: 'builder'|'tester'|'reviewer', requestedModel?: string|null, credentialMode?: 'isolated'|'explicit-copy', goalIds?: string[], taskIds?: string[], requirementIds?: string[], acceptanceIds?: string[], sessionId?: string, ttlSeconds?: number}} options
 */
export async function createPrivateOmoWorkOrder(root, options) {
  const { contract, lock } = await assertLockedContract(root);
  const state = await readState(root);
  invariant(!['PAUSED', 'ABORTED', 'BLOCKED', 'SHIPPABLE', 'CLOSED'].includes(state.state), 'ERR_OMO_BRIDGE_STATE', `Shipping state denies private OMO execution: ${state.state}`);
  const graph = compileGoalGraph(contract, { contractHash: lock.contractHash });
  const goalIds = options.goalIds ?? graph.goals.map((entry) => entry.id);
  const taskIds = options.taskIds ?? graph.tasks.map((entry) => entry.id);
  const requirementIds = options.requirementIds ?? (Array.isArray(contract.requirements) && contract.requirements.length > 0
    ? contract.requirements.map((entry) => typeof entry === 'string' ? entry : entry.id).filter(Boolean)
    : ['REQ-OMO-003']);
  const acceptanceIds = options.acceptanceIds ?? contract.acceptance.map((entry) => entry.id);
  invariant(goalIds.length > 0 && taskIds.length > 0 && requirementIds.length > 0 && acceptanceIds.length > 0, 'ERR_OMO_BRIDGE_BINDING', 'Private OMO work order authority bindings cannot be empty');
  const issued = new Date();
  const expires = new Date(issued.getTime() + Math.min(options.ttlSeconds ?? 900, 86400) * 1000);
  const profile = contract.internalRuntime;
  invariant(profile?.profile === 'private-omo-v0.7', 'ERR_OMO_BRIDGE_PROFILE', 'The locked contract does not approve the v0.7 private OMO profile');
  const body = {
    schema: 'shipping-omo/v1',
    work_order_id: `WO-${randomUUID()}`,
    release_id: `${contract.project}@${contract.release}`,
    contract_hash: `sha256:${lock.contractHash}`,
    git_sha: currentGitSha(root),
    shipping_session_id: options.sessionId ?? `SESSION-${randomUUID()}`,
    project_root: path.resolve(root),
    shipping_state: state.state,
    goal_ids: [...new Set(goalIds)].sort(),
    task_ids: [...new Set(taskIds)].sort(),
    requirement_ids: [...new Set(requirementIds)].sort(),
    acceptance_ids: [...new Set(acceptanceIds)].sort(),
    allowed_paths: safePaths(contract.scope.paths.include),
    forbidden_paths: safePaths(contract.scope.paths.exclude, { protectedPaths: true }),
    budgets: {
      parallel_workers: Math.min(profile.maxParallelWorkers, 2),
      agent_depth: Math.min(profile.maxAgentDepth, 1),
      continuations: Math.min(profile.maxContinuations, 3),
      fix_cycles: Math.min(profile.maxFixCycles, contract.budgets.maxFixCycles, 2),
      wall_clock_seconds: Math.min(contract.budgets.maxCommandSeconds, 3600),
      tool_calls: 200,
      turns: 50,
    },
    execution: {
      mode: options.mode ?? 'probe',
      prompt: (options.prompt ?? `Execute only the locked ${contract.project} ${contract.release} tasks and return a bounded receipt. Shipping remains the sole Finisher.`).trim(),
      requested_agent: options.requestedAgent ?? 'builder',
      requested_model: options.requestedModel ?? null,
      credential_mode: options.credentialMode ?? 'isolated',
    },
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    nonce: `NONCE-${randomUUID()}`,
    key_id: 'shipping-local-v1',
  };
  invariant(body.allowed_paths.length > 0, 'ERR_OMO_BRIDGE_SCOPE', 'The locked contract has no safe allowed paths for private OMO');
  return Object.freeze({ ...body, signature: signObject(body, options.hmacKey) });
}
