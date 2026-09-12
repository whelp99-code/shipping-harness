import { invariant } from '../core/errors.mjs';
import { ADAPTERS, emptyObjectSchema } from './constants.mjs';
import { objectArguments } from './validation.mjs';
import { TOOL_HANDLERS } from './handlers.mjs';

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
        mode: { type: 'string', enum: ['AUTO'], default: 'AUTO', description: 'MCP start is AUTO-only. A later explicitly confirmed refinement may authorize another mode.' },
        proposerId: { type: 'string', minLength: 1, maxLength: 160, description: 'Optional stable identity of the host agent proposing the decision. It cannot approve the same proposal.' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'shipping_refine',
    title: 'Refine the active release proposal',
    description: 'Revise one active proposal identity using bounded structured user answers, an existing workspace candidate, a rescan, an explicitly user-authorized mode change, or a reviewed external baseline-commit receipt. It never executes Git mutation or accepts commands, free-form paths, credentials, push, or deploy fields.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', minLength: 1, maxLength: 160 },
        proposalHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        answers: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              questionId: { type: 'string', minLength: 1, maxLength: 80 },
              choice: { type: 'string', minLength: 1, maxLength: 1000 },
            },
            required: ['questionId', 'choice'],
            additionalProperties: false,
          },
        },
        acceptRecommendedDiscoveryDefaults: { type: 'boolean', default: false, description: 'Resolve every currently displayed goal-discovery question with its conservative recommended choice.' },
        workspaceCandidateId: { type: 'string', pattern: '^WS-[a-f0-9]{12}$' },
        mode: { type: 'string', enum: ['AUTO', 'SAFE', 'INTERVIEW'] },
        modeAuthorizedByUser: { type: 'boolean', default: false },
        rescan: { type: 'boolean', default: false },
        baselinePlanHash: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Exact reviewed baseline plan hash.' },
        baselineCommit: { type: 'string', pattern: '^[a-f0-9]{40}$', description: 'Current host-created Git commit that preserves exactly the reviewed paths.' },
        baselineAuthorizedByUser: { type: 'boolean', default: false, description: 'True only after the user separately approved the host-side baseline commit.' },
      },
      required: ['proposalId', 'proposalHash'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
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
        confirm: { type: 'boolean', description: 'Must be true only after the user reviewed the proposal. For an authorized train continuation this remains false.' },
        autopilotProfile: { type: 'string', enum: ['MANUAL', 'LOCAL_REVERSIBLE'], default: 'MANUAL', description: 'One-time operating policy. LOCAL_REVERSIBLE requires confirmAutopilot=true.' },
        confirmAutopilot: { type: 'boolean', default: false, description: 'Explicit one-time confirmation of LOCAL_REVERSIBLE policy consequences.' },
        autopilotContinuation: { type: 'boolean', default: false, description: 'Continue to the next replanned train release using the previously approved policy; no model self-approval.' },
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

/**
 * Invoke one high-level Shipping Harness tool against a fixed repository root.
 * @param {string} root
 * @param {string} name
 * @param {unknown} rawArguments
 */
export async function callShippingTool(root, name, rawArguments) {
  const args = objectArguments(rawArguments);
  const handler = TOOL_HANDLERS[name];
  invariant(handler, 'ERR_MCP_TOOL_UNKNOWN', `Unknown Shipping Harness tool: ${name}`);
  return handler(root, args);
}
