import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';

function latestMeta(version = MCP_PROTOCOL_VERSION) {
  return {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

test('latest MCP discovery and tool listing expose a bounded beginner surface', async () => {
  const fixture = await createFixtureRepo();
  try {
    const protocol = createMcpProtocol(fixture.root);
    const discover = await protocol.handle({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: latestMeta() } });
    assert.equal(discover.result.resultType, 'complete');
    assert.ok(discover.result.supportedVersions.includes('2026-07-28'));
    assert.deepEqual(discover.result.capabilities, { tools: { listChanged: false }, resources: { listChanged: false } });

    const listed = await protocol.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: latestMeta() } });
    assert.equal(listed.result.resultType, 'complete');
    assert.equal(listed.result.tools.length, 9);
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      'shipping_start', 'shipping_refine', 'shipping_approve_scope', 'shipping_execute', 'shipping_status',
      'shipping_verify', 'shipping_fix_blockers', 'shipping_pause', 'shipping_close',
    ]);
    for (const tool of listed.result.tools) {
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const forbidden of ['command', 'shell', 'args', 'argv', 'env', 'environment']) assert.ok(!properties.includes(forbidden));
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('legacy initialize remains compatible while unsupported latest versions fail clearly', async () => {
  const fixture = await createFixtureRepo();
  try {
    const protocol = createMcpProtocol(fixture.root);
    const initialized = await protocol.handle({
      jsonrpc: '2.0', id: 'init', method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
    });
    assert.equal(initialized.result.protocolVersion, '2025-11-25');
    const listed = await protocol.handle({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: {} });
    assert.ok(Array.isArray(listed.result.tools));
    assert.equal(listed.result.resultType, undefined);

    const unsupported = await createMcpProtocol(fixture.root).handle({
      jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: latestMeta('1900-01-01') },
    });
    assert.equal(unsupported.error.code, -32022);
    assert.ok(unsupported.error.data.supported.includes('2026-07-28'));
  } finally {
    await fixture.cleanup();
  }
});
test('initialize accepts the Claude Code revision while unknown revisions still fail closed', async () => {
  const fixture = await createFixtureRepo();
  try {
    const claude = createMcpProtocol(fixture.root);
    const accepted = await claude.handle({
      jsonrpc: '2.0', id: 'init', method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.272' } },
    });
    assert.equal(accepted.result.protocolVersion, '2025-06-18');
    const status = await claude.handle({ jsonrpc: '2.0', id: 'status', method: 'tools/call', params: { name: 'shipping_status', arguments: {} } });
    assert.equal(status.error, undefined);
    assert.ok(Array.isArray(status.result.content));

    const future = createMcpProtocol(fixture.root);
    const negotiated = await future.handle({
      jsonrpc: '2.0', id: 'init', method: 'initialize',
      params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'future', version: '1' } },
    });
    assert.equal(negotiated.error.code, -32022);
    assert.deepEqual(negotiated.error.data.supported, ['2025-11-25', '2025-06-18', '2025-03-26']);
  } finally {
    await fixture.cleanup();
  }
});

test('negotiated revision survives requests whose _meta carries only a progressToken', async () => {
  const fixture = await createFixtureRepo();
  try {
    const claude = createMcpProtocol(fixture.root);
    await claude.handle({
      jsonrpc: '2.0', id: 'init', method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.272' } },
    });
    const status = await claude.handle({
      jsonrpc: '2.0', id: 'status', method: 'tools/call',
      params: { name: 'shipping_status', arguments: {}, _meta: { progressToken: 1 } },
    });
    assert.equal(status.error, undefined);
    assert.ok(Array.isArray(status.result.content));

    const stale = await claude.handle({
      jsonrpc: '2.0', id: 'stale', method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } },
    });
    assert.equal(stale.error.code, -32022);
  } finally {
    await fixture.cleanup();
  }
});
