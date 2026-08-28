import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';
import { renderShippingCard } from '../../packages/shipping-plugin/renderers/index.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'beginner-usability', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': { resources: true },
};

function call(id, name, args = {}) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } };
}

test('a non-developer starts with one sentence, approves once, pauses, resumes, verifies, and closes without editing configuration', async (t) => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  t.after(() => fixture.cleanup());
  const protocol = createMcpProtocol(fixture.root);

  const started = await protocol.handle(call(1, 'shipping_start', {
    goal: '설치 후 바로 실행되고 기본 테스트를 통과하는 가장 작은 버전을 완성한다.',
    proposerId: 'beginner-host-agent',
  }));
  assert.equal(started.result.isError, false);
  const proposal = started.result.structuredContent;
  assert.equal(proposal.readyForApproval, true);
  assert.equal(proposal.userView.userState, 'AWAITING_APPROVAL');
  const approvalCard = renderShippingCard({ proposal, userState: 'AWAITING_APPROVAL' });
  assert.match(approvalCard.fallbackText, /이대로 시작/u);
  assert.equal(approvalCard.accessibility.keyboardActions.length, 3);

  const approved = await protocol.handle(call(2, 'shipping_approve_scope', {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    confirm: true,
  }));
  assert.equal(approved.result.structuredContent.state, 'LOCKED');

  await protocol.handle(call(3, 'shipping_pause', { action: 'pause', reason: '사용자 확인' }));
  const paused = await protocol.handle(call(4, 'shipping_status'));
  assert.equal(paused.result.structuredContent.userView.userState, 'PAUSED');
  assert.match(paused.result.content[0].text, /일시정지/u);

  await protocol.handle(call(5, 'shipping_pause', { action: 'resume', reason: '계속 진행' }));
  const verified = await protocol.handle(call(6, 'shipping_verify'));
  assert.equal(verified.result.structuredContent.decision, 'SHIPPABLE');
  const closed = await protocol.handle(call(7, 'shipping_close'));
  assert.equal(closed.result.structuredContent.state, 'CLOSED');

  const status = await protocol.handle(call(8, 'shipping_status'));
  const card = renderShippingCard(status.result.structuredContent.userView);
  assert.equal(card.kind, 'completion');
  assert.equal(card.state, 'CLOSED');
  assert.ok(card.fallbackText.length < 4000);
});

test('ordinary beginner flow exposes no raw command, shell, environment, or automatic approval input', async (t) => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  t.after(() => fixture.cleanup());
  const protocol = createMcpProtocol(fixture.root);
  const listed = await protocol.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } });
  for (const tool of listed.result.tools) {
    const input = JSON.stringify(tool.inputSchema);
    for (const forbidden of ['"command"', '"shell"', '"argv"', '"environment"']) assert.equal(input.includes(forbidden), false, `${tool.name} exposes ${forbidden}`);
  }
  const approval = listed.result.tools.find((tool) => tool.name === 'shipping_approve_scope');
  assert.equal(approval.annotations?.destructiveHint, true);
  assert.equal(approval.inputSchema.required.includes('confirm'), true);
});

test('authoritative rendering never hides a blocker or converts it into completion', () => {
  const malicious = renderShippingCard({
    userState: 'BLOCKED',
    blockerCount: 1,
    blockers: [{ id: 'B-1', title: '필수 테스트 실패', basisId: 'AC-001' }],
    release: '9.9.9',
    requiredPassed: 99,
    requiredTotal: 99,
    kind: 'completion',
  });
  assert.equal(malicious.kind, 'blocker');
  assert.equal(malicious.state, 'BLOCKED');
  assert.match(malicious.fallbackText, /필수 테스트 실패/u);
  assert.equal(malicious.accessibility.liveRegion, 'assertive');
});
