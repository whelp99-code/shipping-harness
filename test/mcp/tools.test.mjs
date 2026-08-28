import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import { assertLockedContract } from '../../src/core/contract.mjs';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { initializeGoalRuntime, readGoalRuntime } from '../../src/core/goals/store.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'tools-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function call(id, name, args) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } };
}

test('MCP execution returns a host-agent work order and rejects command injection', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
    const protocol = createMcpProtocol(fixture.root);
    const workOrder = await protocol.handle(call(1, 'shipping_execute', {}));
    assert.equal(workOrder.result.isError, false);
    assert.equal(workOrder.result.structuredContent.mode, 'host-agent');

    const injected = await protocol.handle(call(2, 'shipping_execute', { command: 'rm -rf /' }));
    assert.equal(injected.error.code, -32602);

    const unavailable = await protocol.handle(call(3, 'shipping_execute', { adapter: 'codex' }));
    assert.equal(unavailable.result.isError, true);
    assert.equal(unavailable.result.structuredContent.error.code, 'ERR_ADAPTER_COMMAND_REQUIRED');
  } finally {
    await fixture.cleanup();
  }
});

test('unknown tools are protocol errors while operational failures are visible tool results', async () => {
  const fixture = await createFixtureRepo();
  try {
    const protocol = createMcpProtocol(fixture.root);
    const unknown = await protocol.handle(call(1, 'shell_exec', {}));
    assert.equal(unknown.error.code, -32602);
    const verify = await protocol.handle(call(2, 'shipping_verify', {}));
    assert.equal(verify.result.isError, true);
    assert.equal(verify.result.structuredContent.error.code, 'ERR_FILE_MISSING');
  } finally {
    await fixture.cleanup();
  }
});

test('MCP status exposes bounded Goal state and pause/resume propagates human authority', async () => {
  const fixture = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete one governed Goal runtime flow' });
    await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
    const { contract, lock } = await assertLockedContract(fixture.root);
    const graph = compileGoalGraph(contract, { contractHash: lock.contractHash });
    await initializeGoalRuntime(fixture.root, graph);
    const protocol = createMcpProtocol(fixture.root);

    const status = await protocol.handle(call(10, 'shipping_status', {}));
    assert.equal(status.result.isError, false);
    assert.equal(status.result.structuredContent.goals.taskCounts.PENDING, graph.tasks.length);
    assert.equal(status.result.structuredContent.goals.tasks.length, graph.tasks.length);

    const paused = await protocol.handle(call(11, 'shipping_pause', { action: 'pause', reason: 'human review' }));
    assert.equal(paused.result.isError, false);
    assert.equal(paused.result.structuredContent.state.state, 'PAUSED');
    assert.equal(paused.result.structuredContent.goalRuntime.transitions.length, graph.tasks.length);
    assert.equal((await readGoalRuntime(fixture.root)).tasks.every((task) => task.state === 'PAUSED'), true);

    const resumed = await protocol.handle(call(12, 'shipping_pause', { action: 'resume', reason: 'human review complete' }));
    assert.equal(resumed.result.isError, false);
    assert.equal(resumed.result.structuredContent.state.state, 'LOCKED');
    assert.equal((await readGoalRuntime(fixture.root)).tasks.every((task) => task.state === 'PENDING'), true);
  } finally {
    await fixture.cleanup();
  }
});