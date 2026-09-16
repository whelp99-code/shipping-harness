// v1.12.0 Phase A: a project without a plan file must behave exactly as v1.11.3 did.
// The only permitted difference in shipping_start's structuredContent is the two added
// keys `tier` (always 'PATCH' without a plan) and `shippingPlan` (null without a plan).
// The pre-existing `plan` key keeps its old meaning: the four-step short plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';
import { SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';
import { PLAN_SCHEMA } from '../../src/core/shipping-plan.mjs';

// Measured from the v1.11.3 (c51252c) shipping_start response, before Phase A.
const V1_11_3_START_KEYS = [
  'acceptance', 'acceptanceStrength', 'actionEnvelope', 'approvalBrief', 'approvalRequired',
  'approvalStatus', 'baseline', 'briefFactGraph', 'decisionLedger', 'decisionStatus', 'detected',
  'diagnostics', 'goal', 'goalCharter', 'goalDiscovery', 'intelligence', 'intentGate', 'mode',
  'nextAction', 'oneScreenApproval', 'plainBrief', 'plainBriefError', 'plainBriefText', 'plan',
  'proposalHash', 'proposalId', 'proposalPath', 'proposalState', 'proposer', 'questions',
  'readyForApproval', 'release', 'releaseTrain', 'releaseTrainSummary', 'reused', 'scope',
  'supersededProposalId', 'userView', 'versionEvidence', 'workspace', 'workspaceCandidates',
];

const ADDED_KEYS = ['shippingPlan', 'tier'];

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'plan-tiers-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function call(id, name, args) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } };
}

const PLAN = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
  stages: [{
    id: 'S-01',
    title: 'Deliver the core flow',
    outcome: 'Complete the core fixture flow so it runs end to end.',
    acceptanceRefs: ['node-test'],
    size: 'MILESTONE',
  }],
};

/** @param {Record<string, any>} fixtureOptions */
async function startedContent(fixtureOptions, args = {}) {
  const fixture = await createFixtureRepo(fixtureOptions);
  try {
    const protocol = createMcpProtocol(fixture.root);
    const started = await protocol.handle(call(1, 'shipping_start', { goal: 'Complete the fixture release', ...args }));
    assert.equal(started.result.isError, false);
    return started.result.structuredContent;
  } finally {
    await fixture.cleanup();
  }
}

test('without a plan file shipping_start adds exactly two keys and changes nothing else', async () => {
  const data = await startedContent({});
  assert.equal(data.tier, 'PATCH');
  assert.equal(data.shippingPlan, null);
  assert.deepEqual(Object.keys(data).sort(), [...V1_11_3_START_KEYS, ...ADDED_KEYS].sort());

  const { tier: _tier, shippingPlan: _shippingPlan, ...withoutPlanKeys } = data;
  assert.deepEqual(Object.keys(withoutPlanKeys).sort(), [...V1_11_3_START_KEYS].sort());
  // The pre-existing `plan` key still carries the four-step short plan, not the new projection.
  assert.deepEqual(withoutPlanKeys.plan.map((entry) => entry.id), ['PLAN-001', 'PLAN-002', 'PLAN-003', 'PLAN-004']);
  assert.equal(withoutPlanKeys.scope.include.length > 0, true);
});

test('with a plan file the response shape is identical and only the added keys are populated', async () => {
  const data = await startedContent({ files: { 'docs/shipping-plan.json': `${JSON.stringify(PLAN, null, 2)}\n` } });
  assert.deepEqual(Object.keys(data).sort(), [...V1_11_3_START_KEYS, ...ADDED_KEYS].sort());
  assert.equal(data.tier, 'MILESTONE');
  assert.equal(data.shippingPlan.milestone.stageId, 'S-01');
  assert.equal(data.shippingPlan.program.authority, 'none');
  assert.deepEqual(data.plan.map((entry) => entry.id), ['PLAN-001', 'PLAN-002', 'PLAN-003', 'PLAN-004']);
  assert.ok(Buffer.byteLength(JSON.stringify(data.shippingPlan), 'utf8') < 16 * 1024);
});

test('an unreachable plan path is a visible tool error, not a silent fallback', async () => {
  const fixture = await createFixtureRepo();
  try {
    const protocol = createMcpProtocol(fixture.root);
    const started = await protocol.handle(call(1, 'shipping_start', { goal: 'Complete the fixture release', planPath: '../escape.json' }));
    assert.equal(started.result.isError, true);
    assert.equal(started.result.structuredContent.error.code, 'ERR_PLAN_PATH');
  } finally {
    await fixture.cleanup();
  }
});

test('the plan inputs stay optional, bounded, and free of any command surface', () => {
  assert.equal(SHIPPING_TOOLS.length, 9);
  const start = SHIPPING_TOOLS.find((tool) => tool.name === 'shipping_start');
  const refine = SHIPPING_TOOLS.find((tool) => tool.name === 'shipping_refine');
  assert.deepEqual(start.inputSchema.required, ['goal']);
  assert.equal(start.inputSchema.additionalProperties, false);
  assert.equal(refine.inputSchema.additionalProperties, false);
  assert.equal(start.inputSchema.properties.planPath.maxLength, 300);
  assert.equal(start.inputSchema.properties.stageId.pattern, '^S-[A-Za-z0-9_-]{1,32}$');
  assert.equal(refine.inputSchema.properties.stageId.pattern, '^S-[A-Za-z0-9_-]{1,32}$');
  const forbidden = new Set(['command', 'shell', 'args', 'argv', 'env', 'environment']);
  for (const tool of SHIPPING_TOOLS) {
    for (const property of Object.keys(tool.inputSchema.properties ?? {})) {
      assert.equal(forbidden.has(property), false, `${tool.name}.${property} is a forbidden input`);
    }
  }
});

test('unknown start and refine arguments are still rejected', async () => {
  const fixture = await createFixtureRepo();
  try {
    const protocol = createMcpProtocol(fixture.root);
    const rejected = await protocol.handle(call(1, 'shipping_start', { goal: 'Complete the fixture release', planCommand: 'sh' }));
    assert.equal(rejected.error.code, -32602);
    const badStage = await protocol.handle(call(2, 'shipping_start', { goal: 'Complete the fixture release', stageId: 'DROP TABLE' }));
    assert.equal(badStage.error.code, -32602);
  } finally {
    await fixture.cleanup();
  }
});
