import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'end-to-end-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function call(id, name, args = {}) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } };
}

test('an uninitialized repository can move from natural-language goal to CLOSED through MCP only', async () => {
  const fixture = await createFixtureRepo({
    initializeShipping: false,
    packageScripts: { build: `node -e "process.exit(0)"` },
  });
  try {
    const protocol = createMcpProtocol(fixture.root);
    const initial = await protocol.handle(call(1, 'shipping_status'));
    assert.equal(initial.result.structuredContent.state, 'UNINITIALIZED');

    const started = await protocol.handle(call(2, 'shipping_start', {
      goal: 'Ship the fixture as a verified command line project',
      release: '0.1.0',
    }));
    assert.equal(started.result.isError, false);
    const proposal = started.result.structuredContent;
    assert.equal(proposal.release, '0.1.0');
    assert.equal(proposal.readyForApproval, true);

    const wrong = await protocol.handle(call(3, 'shipping_approve_scope', {
      proposalId: proposal.proposalId,
      proposalHash: '0'.repeat(64),
      confirm: true,
    }));
    assert.equal(wrong.result.isError, true);
    assert.equal(wrong.result.structuredContent.error.code, 'ERR_PROPOSAL_HASH');

    const approved = await protocol.handle(call(4, 'shipping_approve_scope', {
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      confirm: true,
    }));
    assert.equal(approved.result.structuredContent.state, 'LOCKED');

    const execution = await protocol.handle(call(5, 'shipping_execute'));
    assert.equal(execution.result.structuredContent.mode, 'host-agent');

    const verified = await protocol.handle(call(6, 'shipping_verify'));
    assert.equal(verified.result.structuredContent.decision, 'SHIPPABLE');
    const closed = await protocol.handle(call(7, 'shipping_close'));
    assert.equal(closed.result.structuredContent.state, 'CLOSED');
    assert.equal(closed.result.structuredContent.release, '0.1.0');
  } finally {
    await fixture.cleanup();
  }
});

test('concurrent approval calls are serialized and only one can lock the proposal', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const protocol = createMcpProtocol(fixture.root);
    const started = await protocol.handle(call(1, 'shipping_start', { goal: 'Ship one safely locked fixture release' }));
    const proposal = started.result.structuredContent;
    const approval = {
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      confirm: true,
    };
    const [first, second] = await Promise.all([
      protocol.handle(call('approve-a', 'shipping_approve_scope', approval)),
      protocol.handle(call('approve-b', 'shipping_approve_scope', approval)),
    ]);
    const results = [first, second];
    assert.equal(results.filter((response) => response.result?.isError === false).length, 1);
    assert.equal(results.filter((response) => response.result?.isError === true).length, 1);
    assert.equal(results.find((response) => response.result?.isError === true).result.structuredContent.error.code, 'ERR_APPROVAL_STATE');
  } finally {
    await fixture.cleanup();
  }
});