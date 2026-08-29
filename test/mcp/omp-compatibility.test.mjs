import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import {
  createMcpProtocol,
  MCP_OMP_VERSION,
  MCP_SUPPORTED_VERSIONS,
} from '../../src/mcp/protocol.mjs';

function request(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

for (const clientVersion of ['18.0.10', '15.10.12']) {
  test(`OMP ${clientVersion} negotiates MCP 2025-03-26 and discovers all nine Shipping tools`, async () => {
    const fixture = await createFixtureRepo({ initializeShipping: false });
    try {
      const protocol = createMcpProtocol(fixture.root);
      const initialized = await protocol.handle(request(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'omp-coding-agent', version: clientVersion },
      }));

      assert.equal(initialized.error, undefined);
      assert.equal(initialized.result.protocolVersion, MCP_OMP_VERSION);
      assert.equal(protocol.state.negotiatedVersion, MCP_OMP_VERSION);

      const notification = await protocol.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
      assert.equal(notification, null);

      const listed = await protocol.handle(request(2, 'tools/list'));
      assert.equal(listed.error, undefined);
      assert.equal(listed.result.tools.length, 9);
      assert.equal(Object.hasOwn(listed.result, 'resultType'), false);
      assert.ok(listed.result.tools.some((entry) => entry.name === 'shipping_refine'));

      const status = await protocol.handle(request(3, 'tools/call', {
        name: 'shipping_status',
        arguments: {},
      }));
      assert.equal(status.error, undefined);
      assert.equal(status.result.isError, false);
      assert.equal(status.result.structuredContent.state, 'UNINITIALIZED');
    } finally {
      await fixture.cleanup();
    }
  });
}

test('OMP compatibility is explicit and unknown initialize versions still fail closed', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    assert.equal(MCP_SUPPORTED_VERSIONS.includes(MCP_OMP_VERSION), true);
    const protocol = createMcpProtocol(fixture.root);
    const rejected = await protocol.handle(request(1, 'initialize', {
      protocolVersion: '2024-01-01',
      capabilities: {},
      clientInfo: { name: 'unknown-client', version: '1' },
    }));
    assert.equal(rejected.error.code, -32022);
    assert.deepEqual(rejected.error.data.supported, ['2025-11-25', '2025-03-26']);
  } finally {
    await fixture.cleanup();
  }
});
