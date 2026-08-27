import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { MCP_MAX_MESSAGE_BYTES } from '../../src/mcp/protocol.mjs';
import { startStdioServer } from '../../src/mcp/stdio.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'stdio-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

test('STDIO transport emits one JSON-RPC line per request and no log text on stdout', async () => {
  const fixture = await createFixtureRepo();
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  let stdout = '';
  let stderr = '';
  output.setEncoding('utf8');
  error.setEncoding('utf8');
  output.on('data', (chunk) => { stdout += chunk; });
  error.on('data', (chunk) => { stderr += chunk; });
  try {
    const server = startStdioServer({ root: fixture.root, input, output, error });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } })}\n`);
    input.end();
    await server.completed;
    const lines = stdout.split(/\r?\n/u).filter(Boolean);
    assert.equal(lines.length, 2);
    const responses = lines.map((line) => JSON.parse(line));
    assert.deepEqual(responses.map((response) => response.id).sort(), [1, 2]);
    assert.equal(stderr, '');
  } finally {
    await fixture.cleanup();
  }
});

test('STDIO transport bounds malformed, deeply nested, and oversized messages', async () => {
  const fixture = await createFixtureRepo();
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  let stdout = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => { stdout += chunk; });
  try {
    const server = startStdioServer({ root: fixture.root, input, output, error });
    input.write('{not-json}\n');
    let nested = {};
    let cursor = nested;
    for (let index = 0; index < 30; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'deep', method: 'tools/call', params: { _meta: meta, name: 'shipping_status', arguments: nested } })}\n`);
    input.write(`${'x'.repeat(MCP_MAX_MESSAGE_BYTES + 1)}\n`);
    input.end();
    await server.completed;
    const responses = stdout.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(responses.some((response) => response.error?.code === -32700));
    assert.ok(responses.some((response) => response.id === 'deep' && response.error?.code === -32602));
  } finally {
    await fixture.cleanup();
  }
});

test('STDIO transport rejects requests beyond the bounded queue', async () => {
  const fixture = await createFixtureRepo();
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  let stdout = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => { stdout += chunk; });
  try {
    const server = startStdioServer({ root: fixture.root, input, output, error, maxInFlight: 1, maxQueued: 0 });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'overload', method: 'server/discover', params: { _meta: meta } })}\n`);
    input.end();
    await server.completed;
    const response = JSON.parse(stdout.trim());
    assert.equal(response.id, 'overload');
    assert.equal(response.error.code, -32000);
  } finally {
    await fixture.cleanup();
  }
});