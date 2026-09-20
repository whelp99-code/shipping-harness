// v1.13.14: a STDIO MCP server loads its modules once and keeps serving them. Replacing
// the installed package leaves every attached session on the old code, and nothing in any
// response said so: `initialize` carries the server version, but a session that connected
// days earlier has no reason to look at it again. Six servers were running against this
// repository, three started days before, and a reported fix appeared not to work because
// the session asking was talking to a build that predated it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { MCP_SERVER_INFO } from '../../src/mcp/protocol.mjs';
import { VERSION } from '../../src/version.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

test('status reports the build that is answering, so a stale server is detectable', async () => {
  const fixture = await createFixtureRepo();
  try {
    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.harnessVersion, VERSION);
    assert.match(status.structuredContent.harnessVersion, /^\d+\.\d+\.\d+$/u);
    // Whatever `initialize` announced once must be the same thing every later call says.
    assert.equal(status.structuredContent.harnessVersion, MCP_SERVER_INFO.version);
  } finally {
    await fixture.cleanup();
  }
});

test('an uninitialized repository still reports the running build', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.initialized, false);
    assert.equal(status.structuredContent.harnessVersion, VERSION, 'the question "which build is this" does not depend on repository state');
  } finally {
    await fixture.cleanup();
  }
});
