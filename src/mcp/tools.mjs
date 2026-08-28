import { executeAdapter } from '../adapters/runner.mjs';
import { configuredCommand } from '../adapters/sdk.mjs';
import { assertLockedContract } from '../core/contract.mjs';
import { invariant } from '../core/errors.mjs';
import { exists } from '../core/fs.mjs';
import { beginFixCycle, closeRelease, releaseStatus, verifyRelease } from '../core/gate.mjs';
import { runtimePaths } from '../core/paths.mjs';
import { approveScopeProposal, createScopeProposal } from '../core/proposals.mjs';
import { abort, pause, readState, resume } from '../core/state.mjs';
import { buildBlockerView, buildUserStatusView } from './user-view.mjs';
import { abortGoalRuntime, pauseGoalRuntime, resumeGoalRuntime } from '../core/goals/authority.mjs';

const ADAPTERS = ['generic', 'codex', 'gajae', 'ouroboros', 'omo'];

const emptyObjectSchema = Object.freeze({ type: 'object', properties: {}, additionalProperties: false });

export const SHIPPING_TOOLS = Object.freeze([
  {
    name: 'shipping_start',
    title: 'Start a small shippable release',
    description: 'Analyze the current Git repository without executing project code, then propose the smallest release scope, acceptance checks, and short plan. This does not approve or lock the release.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', minLength: 5, maxLength: 4000, description: 'The user-visible outcome this release must deliver.' },
        release: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$', description: 'Optional semantic version. Defaults to 0.1.0 or the next minor release.' },
        projectName: { type: 'string', minLength: 1, maxLength: 120, description: 'Optional project display name.' },
        mode: { type: 'string', enum: ['AUTO', 'SAFE', 'INTERVIEW'], default: 'AUTO', description: 'AUTO decides ordinary reversible choices; SAFE escalates medium-risk changes; INTERVIEW groups bounded questions.' },
        proposerId: { type: 'string', minLength: 1, maxLength: 160, description: 'Optional stable identity of the host agent proposing the decision. It cannot approve the same proposal.' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_approve_scope',
    title: 'Approve and lock the proposed release',
    description: 'Approve exactly one Git-bound proposal. Requires the exact proposal hash and explicit confirm=true. Rejects stale repositories, changed proposals, and active releases.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', minLength: 1, maxLength: 160 },
        proposalHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        confirm: { type: 'boolean', description: 'Must be true only after the user reviewed the proposal.' },
      },
      required: ['proposalId', 'proposalHash', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_execute',
    title: 'Execute the approved release safely',
    description: 'Run only an adapter command already stored in the approved locked contract. With no configured adapter, returns a work order for the MCP host agent instead of exposing a shell command field.',
    inputSchema: {
      type: 'object',
      properties: {
        adapter: { type: 'string', enum: ADAPTERS, description: 'Optional configured adapter. No raw command can be supplied.' },
        verifyAfter: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_status',
    title: 'Read release status',
    description: 'Read the current Shipping Harness state, blockers, evidence freshness, Git state, and next action.',
    inputSchema: emptyObjectSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'shipping_verify',
    title: 'Verify the current release',
    description: 'Run the locked acceptance contract and classify findings as BLOCKER, NEXT, IGNORE, or UNKNOWN.',
    inputSchema: emptyObjectSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_fix_blockers',
    title: 'Begin one bounded blocker-fix cycle',
    description: 'Start one bounded fix cycle. By default the MCP host agent receives a blocker-only work order. A configured adapter may be invoked without accepting a raw command.',
    inputSchema: {
      type: 'object',
      properties: {
        adapter: { type: 'string', enum: ADAPTERS },
        runConfiguredAdapter: { type: 'boolean', default: false },
        verifyAfter: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_pause',
    title: 'Pause, resume, or abort the release',
    description: 'Exercise human authority over automation. Pause and abort outrank every agent continuation request.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'abort'], default: 'pause' },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_close',
    title: 'Close the verified release',
    description: 'Close only a SHIPPABLE release with fresh evidence and zero blockers, generating a release receipt, report, and backlog.',
    inputSchema: emptyObjectSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
]);

/** @param {unknown} value */
function objectArguments(value) {
  invariant(value === undefined || (value && typeof value === 'object' && !Array.isArray(value)), 'ERR_MCP_ARGUMENTS', 'Tool arguments must be an object');
  return /** @type {Record<string, any>} */ (value ?? {});
}

/** @param {Record<string, any>} args @param {string[]} allowed */
function rejectUnknownKeys(args, allowed) {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  invariant(unknown.length === 0, 'ERR_MCP_ARGUMENTS', `Unknown tool argument(s): ${unknown.join(', ')}`, { unknown });
}

/** @param {unknown} value @param {string} label @param {number} min @param {number} max */
function requiredString(value, label, min, max) {
  invariant(typeof value === 'string' && value.trim().length >= min && value.length <= max, 'ERR_MCP_ARGUMENTS', `${label} must be a string between ${min} and ${max} characters`);
  return value.trim();
}

/** @param {Record<string, any>} data @param {string} text */
function complete(data, text) {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text }],
    structuredContent: data,
    isError: false,
  };
}

/** @param {Record<string, any>} contract */
function workOrder(contract) {
  return {
    mode: 'host-agent',
    project: contract.project,
    release: contract.release,
    goal: contract.goal,
    scope: contract.scope,
    acceptance: contract.acceptance,
    instructions: [
      'Implement only the locked goal and approved paths.',
      'Do not edit .shipping/contract.yaml or .shipping/contract.lock.',
      'Do not add optional features; record them for the next release.',
      'After editing the repository, call shipping_verify.',
    ],
  };
}

/** @param {Record<string, any>} contract @param {string | undefined} requested */
function chooseConfiguredAdapter(contract, requested) {
  if (requested) {
    const command = configuredCommand(contract.adapters?.[requested]);
    invariant(command, 'ERR_ADAPTER_COMMAND_REQUIRED', `No approved command is configured for ${requested}`);
    return requested;
  }
  return ADAPTERS.find((name) => configuredCommand(contract.adapters?.[name])) ?? null;
}

/** @param {string} root */
async function statusOrUninitialized(root) {
  if (!(await exists(runtimePaths(root).state))) {
    return {
      initialized: false,
      state: 'UNINITIALIZED',
      nextAction: 'Call shipping_start with the desired release outcome.',
    };
  }
  const status = await releaseStatus(root);
  return { initialized: true, ...status };
}

/**
 * Invoke one high-level Shipping Harness tool against a fixed repository root.
 * @param {string} root
 * @param {string} name
 * @param {unknown} rawArguments
 */
export async function callShippingTool(root, name, rawArguments) {
  const args = objectArguments(rawArguments);
  if (name === 'shipping_start') {
    rejectUnknownKeys(args, ['goal', 'release', 'projectName', 'mode', 'proposerId']);
    const goal = requiredString(args.goal, 'goal', 5, 4000);
    if (args.release !== undefined) requiredString(args.release, 'release', 5, 80);
    if (args.projectName !== undefined) requiredString(args.projectName, 'projectName', 1, 120);
    if (args.mode !== undefined) invariant(['AUTO', 'SAFE', 'INTERVIEW'].includes(args.mode), 'ERR_MCP_ARGUMENTS', `Unsupported decision mode: ${String(args.mode)}`);
    if (args.proposerId !== undefined) requiredString(args.proposerId, 'proposerId', 1, 160);
    const { proposal, proposalPath } = await createScopeProposal(root, {
      goal,
      release: args.release,
      projectName: args.projectName,
      mode: args.mode,
      proposerId: args.proposerId ?? 'mcp-host-agent',
    });
    const data = {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      release: proposal.release,
      goal: proposal.goal,
      mode: proposal.mode,
      readyForApproval: proposal.readyForApproval,
      approvalStatus: proposal.decision.approvalStatus,
      approvalBrief: proposal.approvalBrief,
      questions: proposal.decision.questions,
      proposer: proposal.decision.proposer,
      scope: proposal.contract.scope,
      acceptance: proposal.contract.acceptance,
      plan: proposal.plan,
      detected: proposal.analysis,
      diagnostics: proposal.diagnostics,
      proposalPath,
      approvalRequired: true,
      userView: {
        schema: 'shipping-harness/approval-user-view-v1',
        userState: proposal.readyForApproval ? 'AWAITING_APPROVAL' : 'PLANNING',
        outcome: proposal.approvalBrief.outcome,
        included: proposal.approvalBrief.included,
        deferred: proposal.approvalBrief.deferred,
        acceptance: proposal.approvalBrief.acceptance,
        assumptions: proposal.approvalBrief.assumptions,
        risks: proposal.approvalBrief.risks,
        questions: proposal.approvalBrief.questions,
        limits: proposal.approvalBrief.limits,
        actions: proposal.readyForApproval ? ['approve', 'edit-scope', 'stop'] : ['answer-questions', 'stop'],
      },
    };
    const next = proposal.readyForApproval
      ? 'Review the one-screen approval brief, then call shipping_approve_scope with the exact proposal ID and hash.'
      : 'Resolve the grouped exception questions, then create a new proposal before approval.';
    return complete(data, `Proposed ${proposal.release} in ${proposal.mode} mode with ${proposal.contract.acceptance.length} required checks. ${next}`);
  }

  if (name === 'shipping_approve_scope') {
    rejectUnknownKeys(args, ['proposalId', 'proposalHash', 'confirm']);
    const result = await approveScopeProposal(root, {
      proposalId: requiredString(args.proposalId, 'proposalId', 1, 160),
      proposalHash: requiredString(args.proposalHash, 'proposalHash', 64, 64),
      confirm: args.confirm === true,
      approverType: 'human',
      approverId: 'mcp-confirmed-user',
    });
    const data = {
      project: result.contract.project,
      release: result.contract.release,
      state: result.state.state,
      contractHash: result.lock.contractHash,
      baselineSha: result.lock.baselineSha,
      proposalId: result.proposal.id,
    };
    return complete(data, `Approved and locked ${data.project} ${data.release}. The host agent may now implement the locked goal and call shipping_verify.`);
  }

  if (name === 'shipping_status') {
    rejectUnknownKeys(args, []);
    const status = await statusOrUninitialized(root);
    const userView = buildUserStatusView(status);
    const blockerView = status.initialized ? buildBlockerView(status) : { schema: 'shipping-harness/blocker-view-v1', blockers: [], remainingFixCycles: 0 };
    return complete({ ...status, userView, blockerView }, userView.summary + ` Next: ${userView.nextAction}`);
  }

  if (name === 'shipping_execute') {
    rejectUnknownKeys(args, ['adapter', 'verifyAfter']);
    if (args.adapter !== undefined) invariant(ADAPTERS.includes(args.adapter), 'ERR_MCP_ARGUMENTS', `Unsupported adapter: ${String(args.adapter)}`);
    const { contract } = await assertLockedContract(root);
    const adapter = chooseConfiguredAdapter(contract, args.adapter);
    if (!adapter) {
      const data = workOrder(contract);
      return complete(data, `No adapter command is stored in the locked contract. The MCP host agent should implement ${contract.release} directly, then call shipping_verify.`);
    }
    const agent = await executeAdapter(root, { adapter });
    const verification = args.verifyAfter === false ? null : await verifyRelease(root);
    return complete({ mode: 'configured-adapter', adapter, agent, verification }, `Configured ${adapter} execution finished${verification ? ` with decision ${verification.decision}` : '; verification is pending'}.`);
  }

  if (name === 'shipping_verify') {
    rejectUnknownKeys(args, []);
    const result = await verifyRelease(root);
    return complete(result, `Verification decision: ${result.decision}. Required checks passed: ${result.manifest.summary.passed}/${result.manifest.summary.total}. Blockers: ${result.issues.counts.BLOCKER}.`);
  }

  if (name === 'shipping_fix_blockers') {
    rejectUnknownKeys(args, ['adapter', 'runConfiguredAdapter', 'verifyAfter']);
    if (args.adapter !== undefined) invariant(ADAPTERS.includes(args.adapter), 'ERR_MCP_ARGUMENTS', `Unsupported adapter: ${String(args.adapter)}`);
    const state = await beginFixCycle(root);
    if (state.state === 'BLOCKED') return complete({ state }, 'Fix budget is exhausted. The release is BLOCKED and automation stopped.');
    if (args.runConfiguredAdapter === true || args.adapter) {
      const { contract } = await assertLockedContract(root);
      const adapter = chooseConfiguredAdapter(contract, args.adapter);
      invariant(adapter, 'ERR_ADAPTER_COMMAND_REQUIRED', 'No approved adapter command is configured; the MCP host agent must fix blockers directly');
      const agent = await executeAdapter(root, { adapter });
      const verification = args.verifyAfter === false ? null : await verifyRelease(root);
      return complete({ state, mode: 'configured-adapter', adapter, agent, verification }, `Fix cycle ${state.fixCycles} executed through ${adapter}${verification ? `; decision ${verification.decision}` : ''}.`);
    }
    const { contract } = await assertLockedContract(root);
    const status = await releaseStatus(root);
    return complete({ state, blockers: status.issues.items.filter((item) => item.classification === 'BLOCKER'), workOrder: workOrder(contract) }, `Fix cycle ${state.fixCycles} started. Fix only the listed release blockers, then call shipping_verify.`);
  }

  if (name === 'shipping_pause') {
    rejectUnknownKeys(args, ['action', 'reason']);
    const action = args.action ?? 'pause';
    invariant(['pause', 'resume', 'abort'].includes(action), 'ERR_MCP_ARGUMENTS', `Unsupported control action: ${String(action)}`);
    const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim().slice(0, 500) : `MCP ${action}`;
    const state = action === 'pause' ? await pause(root, reason) : action === 'resume' ? await resume(root, reason) : await abort(root, reason);
    const goalRuntime = action === 'pause'
      ? await pauseGoalRuntime(root, reason)
      : action === 'resume'
        ? await resumeGoalRuntime(root, reason)
        : await abortGoalRuntime(root, reason);
    return complete({ action, state, goalRuntime: goalRuntime ? { transitions: goalRuntime.transitions ?? goalRuntime.taskTransitions ?? [] } : null }, `Release ${action} completed. Current state: ${state.state}.`);
  }

  if (name === 'shipping_close') {
    rejectUnknownKeys(args, []);
    const result = await closeRelease(root);
    return complete({
      release: result.receipt.release,
      state: result.state.state,
      receiptPath: result.receiptPath,
      reportPath: result.reportPath,
      backlogCount: result.backlog.items.length,
    }, `Closed ${result.receipt.release}. Release blockers: 0. Backlog items: ${result.backlog.items.length}.`);
  }

  invariant(false, 'ERR_MCP_TOOL_UNKNOWN', `Unknown Shipping Harness tool: ${name}`);
}