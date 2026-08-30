import test from 'node:test';
import assert from 'node:assert/strict';
import { callShippingTool, SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';
import { readDecisionLedger } from '../../src/core/decision-ledger.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const technicalPattern = /framework|library|database table|file path|command|shell|프레임워크|라이브러리|DB\s*테이블|파일\s*경로|명령어|셸/iu;

test('specific release goal bypasses discovery questions and exposes one evidence-bound direction', async () => {
  const fixture = await createFixtureRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Add validation to the fixture API and prove it with the existing npm test release gate.',
      release: '0.1.0',
    });
    const discovery = started.structuredContent.goalDiscovery;
    assert.equal(discovery.status, 'READY');
    assert.equal(discovery.questions.length, 0);
    assert.ok(discovery.direction);
    assert.equal(discovery.direction.modelAuthority, false);
    assert.equal(discovery.direction.commandAuthority, false);
    assert.equal(discovery.direction.approvalAuthority, false);
    assert.equal(discovery.direction.closureAuthority, false);
    assert.equal(discovery.direction.released, false);
    assert.ok(discovery.direction.evidenceRefs.length > 0);
  } finally {
    await fixture.cleanup();
  }
});

test('vague project goal asks at most three product questions and one delegated recommendation resolves them', async () => {
  const fixture = await createFixtureRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: '이 프로젝트를 완성해',
      release: '0.1.0',
    });
    const first = started.structuredContent;
    assert.equal(first.proposalState, 'NEEDS_INPUT');
    assert.ok(first.goalDiscovery.questions.length >= 1 && first.goalDiscovery.questions.length <= 3);
    assert.equal(first.goalDiscovery.round, 1);
    assert.equal(first.actionEnvelope.exactUserPhrase, '권장안으로 결정해.');
    assert.match(first.plainBriefText, /권장안으로 결정해/u);
    for (const question of first.goalDiscovery.questions) {
      assert.equal(technicalPattern.test(question.prompt), false, question.prompt);
      assert.ok(question.recommendedChoice.length > 0);
      assert.ok(question.evidenceRefs.length > 0);
    }

    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: first.proposalId,
      proposalHash: first.proposalHash,
      acceptRecommendedDiscoveryDefaults: true,
    });
    const second = refined.structuredContent;
    assert.equal(second.proposalId, first.proposalId);
    assert.equal(second.revision, 2);
    assert.equal(second.goalDiscovery.round, 2);
    assert.equal(second.goalDiscovery.questions.length, 0);
    assert.equal(second.goalDiscovery.status, 'READY');
    assert.ok(second.goalDiscovery.direction);
    assert.equal(second.proposalState, 'READY_FOR_APPROVAL');
    assert.equal(second.resolutions.every((entry) => entry.usedRecommendedChoice === true), true);
    assert.equal(second.decisionLedger.eventCount >= 5, true);
    const ledger = await readDecisionLedger(fixture.root);
    assert.equal(ledger.some((entry) => entry.type === 'question.resolved' && entry.provenance === 'delegated-recommended-default'), true);
    assert.equal(ledger.some((entry) => entry.type === 'direction.ready'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('explicit product answers remain on the same proposal and preserve provenance', async () => {
  const fixture = await createFixtureRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: '이 프로젝트를 완성해',
      release: '0.1.0',
    });
    const answers = started.structuredContent.goalDiscovery.questions.map((question) => ({
      questionId: question.id,
      choice: question.category === 'primary-user'
        ? '회사 내부 운영자'
        : question.category === 'operating-boundary'
          ? '회사 내부에서 설치·실행·복구까지'
          : '가장 중요한 사용자 흐름 하나를 끝까지 완료',
    }));
    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      answers,
    });
    assert.equal(refined.structuredContent.goalDiscovery.status, 'READY');
    assert.equal(refined.structuredContent.goalDiscovery.direction.primaryUser, '회사 내부 운영자');
    assert.equal(refined.structuredContent.resolutions.every((entry) => entry.authority === 'explicit-user-refinement'), true);
    const ledger = await readDecisionLedger(fixture.root);
    assert.equal(ledger.filter((entry) => entry.type === 'question.resolved').every((entry) => entry.provenance === 'explicit-user-refinement'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('goal discovery uses the existing bounded nine-tool MCP surface', () => {
  assert.equal(SHIPPING_TOOLS.length, 9);
  const refine = SHIPPING_TOOLS.find((entry) => entry.name === 'shipping_refine');
  assert.equal(refine.inputSchema.properties.acceptRecommendedDiscoveryDefaults.type, 'boolean');
  assert.equal(SHIPPING_TOOLS.some((entry) => /interview|discovery/u.test(entry.name)), false);
});
