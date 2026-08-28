import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';
import { hashFile } from '../../src/core/crypto.mjs';
import { doctorShippingPlugin } from '../../packages/shipping-plugin/doctor/doctor.mjs';
import { installShippingPlugin } from '../../packages/shipping-plugin/installer/install.mjs';
import { pluginPaths } from '../../packages/shipping-plugin/installer/paths.mjs';
import { repairShippingPlugin } from '../../packages/shipping-plugin/doctor/repair.mjs';
import { renderShippingCard } from '../../packages/shipping-plugin/renderers/index.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'plugin-attacker', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': { resources: true },
};

function call(id, name, args = {}) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } };
}

test('model self-approval and hidden command injection remain rejected through the beginner surface', async (t) => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  t.after(() => fixture.cleanup());
  const protocol = createMcpProtocol(fixture.root);
  const started = await protocol.handle(call(1, 'shipping_start', { goal: '검증된 최소 릴리스를 완료한다.', proposerId: 'same-agent' }));
  const proposal = started.result.structuredContent;
  const injected = await protocol.handle(call(2, 'shipping_execute', { command: 'rm -rf /' }));
  assert.equal(injected.error.code, -32602);
  const missingConfirmation = await protocol.handle(call(3, 'shipping_approve_scope', {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    confirm: false,
  }));
  assert.equal(missingConfirmation.result.isError, true);
  assert.equal(missingConfirmation.result.structuredContent.error.code, 'ERR_APPROVAL_REQUIRED');
});

test('unknown and path-like MCP resources cannot read arbitrary local files', async (t) => {
  const fixture = await createFixtureRepo();
  t.after(() => fixture.cleanup());
  const protocol = createMcpProtocol(fixture.root);
  for (const uri of ['file:///etc/passwd', 'shipping://../../.ssh/id_rsa', 'http://127.0.0.1/private']) {
    const result = await protocol.handle({ jsonrpc: '2.0', id: uri, method: 'resources/read', params: { _meta: meta, uri } });
    assert.equal(result.error.code, -32602);
  }
});

test('tampered plugin receipt is detected and repair never rewrites the project release state', async (t) => {
  const fixture = await createFixtureRepo();
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'shipping-plugin-attack-'));
  t.after(async () => { await fixture.cleanup(); await rm(installRoot, { recursive: true, force: true }); });
  const packageRoot = path.resolve('.');
  await installShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root, dryRun: false });
  const paths = pluginPaths(installRoot);
  const stateHash = await hashFile(fixture.paths.state);
  const receipt = JSON.parse(await readFile(paths.receipt, 'utf8'));
  receipt.packageVersion = '999.0.0';
  await writeFile(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  const doctor = await doctorShippingPlugin({ installRoot, projectRoot: fixture.root });
  assert.equal(doctor.healthy, false);
  assert.equal(doctor.checks.find((entry) => entry.id === 'receipt-integrity').ok, false);
  const repaired = await repairShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root, dryRun: false });
  assert.equal(repaired.after.healthy, true);
  assert.equal(await hashFile(fixture.paths.state), stateHash);
});

test('presentation hints cannot convert blocked authority state into a completed card', () => {
  const card = renderShippingCard({
    userState: 'BLOCKED',
    state: 'CLOSED',
    kind: 'completion',
    blockerCount: 1,
    blockers: [{ id: 'B-001', title: '현재 SHA의 증거가 없음', basisId: 'AC-001' }],
  });
  assert.equal(card.kind, 'blocker');
  assert.equal(card.state, 'BLOCKED');
  assert.match(card.fallbackText, /증거가 없음/u);
});
