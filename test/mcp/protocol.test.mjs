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
    assert.deepEqual(discover.result.capabilities, { tools: { listChanged: false } });

    const listed = await protocol.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: latestMeta() } });
    assert.equal(listed.result.resultType, 'complete');
    assert.equal(listed.result.tools.length, 8);
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      'shipping_start', 'shipping_approve_scope', 'shipping_execute', 'shipping_status',
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