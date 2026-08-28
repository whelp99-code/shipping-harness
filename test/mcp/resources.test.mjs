import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'resources-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function request(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params: { _meta: meta, ...params } };
}

test('MCP resources expose bounded beginner status and locked contract summaries', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  await fixture.lock();
  const protocol = createMcpProtocol(fixture.root);
  const listed = await protocol.handle(request(1, 'resources/list'));
  assert.equal(listed.result.resources.some((entry) => entry.uri === 'shipping://current/status'), true);
  assert.equal(listed.result.resources.some((entry) => entry.uri === 'shipping://current/evidence'), true);

  const status = await protocol.handle(request(2, 'resources/read', { uri: 'shipping://current/status' }));
  const statusValue = JSON.parse(status.result.contents[0].text);
  assert.equal(statusValue.userState, 'RUNNING');
  assert.equal(statusValue.canPause, true);
  assert.ok(status.result.contents[0].text.length < 20000);

  const contract = await protocol.handle(request(3, 'resources/read', { uri: 'shipping://current/contract' }));
  const contractValue = JSON.parse(contract.result.contents[0].text);
  assert.equal(contractValue.release, '0.1.0');
  assert.equal(Array.isArray(contractValue.acceptance), true);

  const evidence = await protocol.handle(request(4, 'resources/read', { uri: 'shipping://current/evidence' }));
  assert.equal(JSON.parse(evidence.result.contents[0].text).available, false);
});

test('unknown resource URIs fail as bounded protocol errors', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const protocol = createMcpProtocol(fixture.root);
  const unknown = await protocol.handle(request(1, 'resources/read', { uri: 'file:///etc/passwd' }));
  assert.equal(unknown.error.code, -32602);
});

test('shipping_status includes a concise user view without hiding raw authority state', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  await fixture.lock();
  const protocol = createMcpProtocol(fixture.root);
  const response = await protocol.handle(request(1, 'tools/call', { name: 'shipping_status', arguments: {} }));
  const content = response.result.structuredContent;
  assert.equal(content.state.state, 'LOCKED');
  assert.equal(content.userView.userState, 'RUNNING');
  assert.equal(content.userView.nextAction.length > 0, true);
});
