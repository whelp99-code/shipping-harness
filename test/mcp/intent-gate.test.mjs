import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function dirtyFixture() {
  const fixture = await createFixtureRepo({ packageScripts: { verify: `node -e "process.stdout.write('verified')"` } });
  await writeFile(path.join(fixture.root, 'README.md'), '# Existing work\n', 'utf8');
  return fixture;
}

test('terse analysis request finishes read-only analysis, asks one intent question, and does not create planning authority', async () => {
  const fixture = await dirtyFixture();
  try {
    const beforeHead = currentGitSha(fixture.root);
    const beforeReadme = await fixture.read('README.md');
    // v1.13.0 Phase A: this test asserts the tree is untouched, so it opts out of the
    // baseline auto-commit; the intent gate itself is unchanged by that choice.
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: '이 프로젝트 분석해. 쉬핑하네스로',
      commitBaseline: false,
    });
    const data = started.structuredContent;
    assert.equal(data.proposalState, 'INTENT_CONFIRMATION_REQUIRED');
    assert.equal(data.intentGate.status, 'CONFIRMATION_REQUIRED');
    assert.equal(data.intentGate.defaultMode, 'ANALYZE_ONLY');
    assert.equal(data.intentGate.analysisComplete, true);
    assert.equal(data.questions.length, 1);
    assert.equal(data.questions[0].id, 'Q-INTENT-001');
    assert.equal(data.actionEnvelope.nextAction, 'CONFIRM_INTENT');
    assert.equal(data.readyForApproval, false);
    assert.equal(data.approvalRequired, false);
    assert.equal(data.goalDiscovery, null);
    assert.equal(data.goalCharter, null);
    assert.equal(data.releaseTrain, null);
    assert.equal(data.plan.length, 0);
    assert.match(data.plainBriefText, /읽기 전용 프로젝트 분석은 완료했습니다/u);
    assert.match(data.plainBriefText, /기존 제품·릴리스 변경 1개/u);
    assert.match(data.plainBriefText, /자동으로 기준선 처리하지 않습니다/u);
    assert.match(data.plainBriefText, /1\. 분석 결과만/u);
    assert.equal(currentGitSha(fixture.root), beforeHead);
    assert.equal(await fixture.read('README.md'), beforeReadme);

    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.userView.intentGate.status, 'CONFIRMATION_REQUIRED');
    assert.equal(status.structuredContent.userView.releaseTrain, null);
    assert.equal(status.structuredContent.userView.goalCharter, null);
    assert.equal(status.content[0].text, data.plainBriefText);
  } finally {
    await fixture.cleanup();
  }
});

test('analysis-mode shipping_start with default commitBaseline does not move HEAD', async () => {
  const fixture = await dirtyFixture();
  try {
    const beforeHead = currentGitSha(fixture.root);
    const beforeReadme = await fixture.read('README.md');
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: '이 프로젝트 분석해. 쉬핑하네스로',
    });
    const data = started.structuredContent;
    assert.equal(data.intentGate.effectiveMode, 'ANALYZE_ONLY');
    assert.equal(data.baselineCommit, null);
    assert.equal(currentGitSha(fixture.root), beforeHead);
    assert.equal(await fixture.read('README.md'), beforeReadme);
  } finally {
    await fixture.cleanup();
  }
});

test('selecting ANALYZE_ONLY completes the same proposal without exposing approval or mutation', async () => {
  const fixture = await dirtyFixture();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: '이 프로젝트 분석해. 쉬핑하네스로' });
    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      answers: [{ questionId: 'Q-INTENT-001', choice: 'ANALYZE_ONLY' }],
    });
    const data = refined.structuredContent;
    assert.equal(data.proposalState, 'ANALYSIS_COMPLETE');
    assert.equal(data.intentGate.effectiveMode, 'ANALYZE_ONLY');
    assert.equal(data.readyForApproval, false);
    assert.equal(data.goalDiscovery, null);
    assert.equal(data.goalCharter, null);
    assert.equal(data.releaseTrain, null);
    assert.equal(data.actionEnvelope.nextAction, 'REVIEW_ANALYSIS');
    assert.match(data.plainBriefText, /읽기 전용 프로젝트 분석이 완료/u);
  } finally {
    await fixture.cleanup();
  }
});

test('PLAN_ONLY asks bounded product questions, then produces a non-executing Goal Charter and Release Train', async () => {
  const fixture = await createFixtureRepo({ packageScripts: { verify: `node -e "process.stdout.write('verified')"` } });
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: '다음 운영 가능한 버전의 계획까지만 만들어. 아직 개발하지 마.',
    });
    assert.equal(started.structuredContent.intentGate.effectiveMode, 'PLAN_ONLY');
    assert.equal(started.structuredContent.proposalState, 'NEEDS_INPUT');
    assert.equal(started.structuredContent.questions.length, 3);
    assert.equal(started.structuredContent.releaseTrain, null);

    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      answers: [
        { questionId: 'Q-GOAL-001', choice: '기존 핵심 흐름을 검증 가능한 다음 버전 계획으로 확정한다.' },
        { questionId: 'Q-GOAL-002', choice: '현재 사용자와 회사 내부 운영자' },
        { questionId: 'Q-GOAL-003', choice: '로컬·회사 내부의 되돌릴 수 있는 운영까지' },
      ],
    });
    const data = refined.structuredContent;
    assert.equal(data.proposalState, 'PLAN_COMPLETE');
    assert.equal(data.intentGate.effectiveMode, 'PLAN_ONLY');
    assert.equal(data.intentGate.implementationAllowed, false);
    assert.equal(data.goalDiscovery.status, 'READY');
    assert.equal(data.goalCharter.status, 'PROPOSED');
    assert.ok(data.releaseTrain.releases.length >= 1);
    assert.equal(data.readyForApproval, false);
    assert.equal(data.actionEnvelope.nextAction, 'REVIEW_PLAN');
    assert.match(data.plainBriefText, /개발계획이 준비/u);
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_approve_scope', {
        proposalId: data.proposalId,
        proposalHash: data.proposalHash,
        confirm: true,
      }),
      /PLAN_COMPLETE|IMPLEMENT or AUTOPILOT|non-ready condition/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('explicit implementation and autopilot requests retain the existing approval-gated release path', async () => {
  for (const [goal, expectedMode] of [
    ['로그인 오류를 수정해.', 'IMPLEMENT'],
    ['이 프로젝트를 완성할 때까지 자동으로 진행해.', 'AUTOPILOT'],
  ]) {
    const fixture = await createFixtureRepo({ packageScripts: { verify: `node -e "process.stdout.write('verified')"` } });
    try {
      const started = await callShippingTool(fixture.root, 'shipping_start', { goal });
      const data = started.structuredContent;
      assert.equal(data.intentGate.status, 'CONFIRMED');
      assert.equal(data.intentGate.effectiveMode, expectedMode);
      assert.equal(data.intentGate.implementationAllowed, true);
      assert.ok(['READY_FOR_APPROVAL', 'NEEDS_INPUT', 'NEEDS_ACCEPTANCE'].includes(data.proposalState));
      if (data.proposalState === 'READY_FOR_APPROVAL') assert.ok(data.releaseTrain?.releases?.length >= 1);
      else {
        assert.equal(data.goalDiscovery.status, 'NEEDS_INPUT');
        assert.equal(data.releaseTrain, null);
      }
      assert.notEqual(data.proposalState, 'ANALYSIS_COMPLETE');
      assert.notEqual(data.proposalState, 'PLAN_COMPLETE');
    } finally {
      await fixture.cleanup();
    }
  }
});
