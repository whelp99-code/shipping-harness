import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import {
  buildActionEnvelope,
  compilePlainBrief,
  renderPlainBrief,
} from '../../src/core/plain-brief.mjs';

function baseline() {
  return {
    counts: {
      PRODUCT: 7,
      RELEASE_EVIDENCE: 3,
      AGENT_RUNTIME: 1,
      SHIPPING_RUNTIME: 1,
      GENERATED: 0,
      UNKNOWN: 0,
    },
    blockingCount: 10,
    blockingPaths: [
      'runtime/apps/web/tests/auth.spec.ts',
      'runtime/scripts/package_release.py',
      'runtime/RELEASE_MANIFEST.json',
    ],
    nonBlockingPaths: ['.omo/session.json', '.shipping/state.json'],
    plan: {
      hash: 'a'.repeat(64),
      fileSetHash: 'b'.repeat(64),
      includePaths: ['runtime/apps/web/tests/auth.spec.ts', 'runtime/scripts/package_release.py', 'runtime/RELEASE_MANIFEST.json'],
      excludePaths: ['.omo/session.json', '.shipping/state.json'],
      recommendation: 'PRESERVE',
      suggestedCommitMessage: 'test: preserve authentication and release packaging baseline',
    },
  };
}

function proposal(state, extra = {}) {
  return {
    canonicalState: state,
    release: '1.1.1',
    goal: 'Complete the smallest operable patch without adding product features',
    readyForApproval: state === 'READY_FOR_APPROVAL',
    proposalId: 'proposal-fixture',
    proposalHash: 'c'.repeat(64),
    proposalRevision: 1,
    baseline: state === 'DIRTY_BASELINE' ? baseline() : null,
    contract: {
      scope: { include: ['Existing authentication verification'], exclude: ['New features'] },
      acceptance: [
        { id: 'verify', command: 'make verify', cwd: 'runtime-v1.1.0' },
        { id: 'package', command: 'make package', cwd: 'runtime-v1.1.0', isolationRequired: true },
      ],
    },
    intelligence: {
      goalRecommendation: {
        authority: 'recommendation-only',
        text: 'Finish authentication verification and packaging reproducibility.',
        explicitUserGoalWins: true,
      },
      acceptanceCoverage: { complete: true, coveredPaths: 10, totalPaths: 10, uncoveredPaths: [] },
    },
    ...extra,
  };
}

function release(state, extra = {}) {
  return {
    state: {
      state,
      release: '1.4.0',
      blockerCount: state === 'BLOCKED' ? 2 : 0,
      unknownCount: 0,
      humanStop: ['PAUSED', 'ABORTED'].includes(state),
    },
    contract: {
      release: '1.4.0',
      scope: { include: ['Evidence-first beginner report'], exclude: ['New MCP tools'] },
      acceptance: [{ id: 'verify', command: 'npm run release:verify', cwd: '.' }],
      budgets: { maxFixCycles: 2 },
    },
    issues: { counts: { BLOCKER: state === 'BLOCKED' ? 2 : 0, UNKNOWN: 0, NEXT: 0 }, items: [] },
    evidenceFresh: state === 'SHIPPABLE' || state === 'CLOSED',
    ...extra,
  };
}

const proposalStates = ['PLANNING', 'NEEDS_INPUT', 'DIRTY_BASELINE', 'NEEDS_ACCEPTANCE', 'READY_FOR_APPROVAL', 'SUPERSEDED', 'EXPIRED'];
const releaseStates = ['APPROVED', 'LOCKED', 'RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING', 'PAUSED', 'BLOCKED', 'SHIPPABLE', 'CLOSED', 'ABORTED'];

test('all proposal and release states compile the fixed Korean beginner sections and one action', () => {
  for (const state of proposalStates) {
    const brief = compilePlainBrief(proposal(state, state === 'NEEDS_INPUT' ? { questionCount: 1 } : {}));
    assert.equal(brief.state, state);
    assert.equal(brief.quality.healthy, true, `${state}: ${JSON.stringify(brief.quality.checks)}`);
    assert.ok(brief.problems.length > 0);
    assert.ok(brief.improvements.length > 0);
    assert.ok(brief.nextPlan.length > 0);
    assert.ok(brief.summary.text.length > 0);
    assert.equal(brief.userAction.code, brief.actionEnvelope.nextAction);
    assert.equal(new Set(brief.actionEnvelope.allowedNow).size, brief.actionEnvelope.allowedNow.length);
    for (const heading of ['현재 상태', '문제점', '개선안', '다음 진행 플랜', '요약', '지금 할 일']) {
      assert.match(brief.renderedText, new RegExp(`## ${heading}`, 'u'));
    }
  }

  for (const state of releaseStates) {
    const brief = compilePlainBrief(release(state));
    assert.equal(brief.state, state);
    assert.equal(brief.quality.healthy, true, `${state}: ${JSON.stringify(brief.quality.checks)}`);
    assert.ok(brief.problems.length > 0);
    assert.ok(brief.improvements.length > 0);
    assert.ok(brief.nextPlan.length > 0);
    assert.equal(brief.userAction.code, brief.actionEnvelope.nextAction);
  }
});

test('dirty baseline output summarizes counts, separates runtime state, and exposes one safe phrase', () => {
  const input = proposal('DIRTY_BASELINE');
  const brief = compilePlainBrief(input);
  assert.equal(brief.actionEnvelope.nextAction, 'REVIEW_BASELINE');
  assert.equal(brief.actionEnvelope.requiresHumanApproval, true);
  assert.equal(brief.userAction.exactPhrase, '이 기준선만 보존해.');
  assert.ok(brief.actionEnvelope.allowedNow.includes('INSPECT_CHANGES'));
  for (const forbidden of ['APPROVE_SCOPE', 'CONTINUE_LOCKED_SCOPE', 'CONFIRM_CLOSE']) {
    assert.ok(brief.actionEnvelope.forbiddenNow.includes(forbidden));
  }
  assert.match(brief.renderedText, /제품 코드 7개/u);
  assert.match(brief.renderedText, /검증·릴리스 기록 3개/u);
  assert.match(brief.renderedText, /AI 작업 기록 1개/u);
  assert.match(brief.renderedText, /Shipping 내부 기록 1개/u);
  assert.doesNotMatch(brief.renderedText, /runtime\/apps\/web\/tests\/auth\.spec\.ts/u);
  assert.equal(brief.details.exactPathsInDefaultText, false);
  assert.equal(brief.quality.structuredBytes < 8192, true);
  assert.equal(brief.quality.renderedBytes < 8192, true);
});

test('identical Shipping authority data produces identical brief hashes across host model labels', () => {
  const base = proposal('DIRTY_BASELINE');
  const hosts = [
    { hostModel: null },
    { hostModel: { tier: 'weak', text: 'Maybe delete everything and continue.' } },
    { hostModel: { tier: 'strong', text: 'I believe this is ready for approval.' } },
  ];
  const briefs = hosts.map((host) => compilePlainBrief({ ...base, ...host }));
  assert.equal(new Set(briefs.map((brief) => brief.hash)).size, 1);
  assert.equal(new Set(briefs.map((brief) => brief.textHash)).size, 1);
  assert.equal(new Set(briefs.map((brief) => brief.actionEnvelope.hash)).size, 1);
  assert.equal(new Set(briefs.map((brief) => brief.factGraph.hash)).size, 1);
});

test('action envelope is deterministic and never grants an early close', () => {
  const dirty = buildActionEnvelope({ canonicalState: 'DIRTY_BASELINE' });
  assert.deepEqual(dirty.allowedNow, ['REVIEW_BASELINE', 'INSPECT_CHANGES', 'STOP']);
  assert.ok(dirty.forbiddenNow.includes('CONFIRM_CLOSE'));

  const ready = buildActionEnvelope({ canonicalState: 'READY_FOR_APPROVAL' });
  assert.equal(ready.exactUserPhrase, '이대로 시작해.');
  assert.ok(ready.allowedNow.includes('APPROVE_SCOPE'));
  assert.ok(ready.forbiddenNow.includes('CONFIRM_CLOSE'));

  const shippable = buildActionEnvelope({ state: { state: 'SHIPPABLE' } });
  assert.deepEqual(shippable.allowedNow, ['CONFIRM_CLOSE', 'STOP']);
  assert.equal(shippable.exactUserPhrase, '이 버전을 종료해.');
});

test('plain brief items are mechanically coded and evidence-bound', () => {
  const brief = compilePlainBrief(proposal('DIRTY_BASELINE'));
  const items = [...brief.problems, ...brief.improvements, ...brief.nextPlan, brief.summary];
  for (const entry of items) {
    assert.match(entry.code, /^[A-Z0-9_]+$/u);
    assert.ok(entry.evidenceRefs.length > 0);
  }
  assert.equal(brief.modelAuthority, false);
  assert.equal(brief.advisory.authority, 'recommendation-only');
  assert.equal(brief.factGraph.facts.every((entry) => entry.authority === 'mechanical'), true);
  assert.equal(renderPlainBrief(brief), brief.renderedText);
});

test('a bound shippingPlan projection adds one bounded PLAN_PROGRESS fact and three plan blocks; its absence changes nothing', () => {
  const withoutPlan = compilePlainBrief(proposal('READY_FOR_APPROVAL'));
  assert.equal(withoutPlan.factGraph.facts.some((entry) => entry.code === 'PLAN_PROGRESS'), false);
  assert.equal(withoutPlan.planBlocks, null);
  assert.doesNotMatch(withoutPlan.renderedText, /## 전체 목표/u);

  const shippingPlan = {
    tier: 'MILESTONE',
    progress: { total: 3, done: 1, nextStageId: 'S-02' },
    program: {
      title: 'Ship the whole thing',
      outcome: 'Deliver the product end to end so an operator can run it.',
      stages: [
        { id: 'S-01', title: 'First stage', state: 'DONE' },
        { id: 'S-02', title: 'Second stage', state: 'READY' },
        { id: 'S-03', title: 'Third stage', state: 'BLOCKED_BY_DEPENDENCY' },
      ],
    },
    milestone: { stageId: 'S-02', title: 'Second stage work', tier: 'MILESTONE' },
    patch: null,
  };
  const withPlan = compilePlainBrief(proposal('READY_FOR_APPROVAL', { shippingPlan }));
  assert.equal(withPlan.quality.healthy, true, JSON.stringify(withPlan.quality.checks));
  const planFact = withPlan.factGraph.facts.find((entry) => entry.code === 'PLAN_PROGRESS');
  assert.ok(planFact);
  assert.equal(planFact.value, '1/3 단계 완료, 다음: Second stage');
  assert.equal(planFact.authority, 'mechanical');
  assert.ok(planFact.evidenceRefs.length > 0);
  assert.ok(withPlan.quality.structuredBytes < 8192);
  assert.ok(withPlan.quality.renderedBytes < 8192);

  const text = withPlan.renderedText;
  const programIndex = text.indexOf('## 전체 목표');
  const milestoneIndex = text.indexOf('## 이번 릴리즈');
  const currentStateIndex = text.indexOf('## 현재 상태');
  assert.ok(programIndex >= 0 && milestoneIndex > programIndex && currentStateIndex > milestoneIndex, 'plan blocks precede the rest of the report, in fixed order');
  assert.match(text, /Ship the whole thing/u);
  assert.match(text, /1\/3 완료/u);
  assert.match(text, /Second stage work/u);
  assert.match(text, /PROGRAM\(전체 목표\)에는 실행·승인 권한이 없습니다/u);
  assert.doesNotMatch(text, /## 작은 수정/u);
});

test('v1.12.1 Phase B: PLAN_SOURCE_DRIFT diagnostics add one bounded plain-brief line, absent without drift', () => {
  const shippingPlan = {
    tier: 'MILESTONE',
    progress: { total: 2, done: 0, nextStageId: 'S-01' },
    program: {
      title: 'Ship the whole thing',
      outcome: 'Deliver the product end to end so an operator can run it.',
      stages: [
        { id: 'S-01', title: 'First stage', state: 'READY' },
        { id: 'S-02', title: 'Second stage', state: 'BLOCKED_BY_DEPENDENCY' },
      ],
    },
    milestone: { stageId: 'S-01', title: 'First stage work', tier: 'MILESTONE' },
    patch: null,
    diagnostics: [
      'PLAN_SOURCE_DRIFT: docs/planning/ROADMAP.md changed since the plan was written (plan aaaaaaaa, now bbbbbbbb)',
      'PLAN_SOURCE_DRIFT: docs/planning/NOTES.md changed since the plan was written (plan cccccccc, now dddddddd)',
    ],
  };
  const withDrift = compilePlainBrief(proposal('READY_FOR_APPROVAL', { shippingPlan }));
  const driftFact = withDrift.factGraph.facts.find((entry) => entry.code === 'PLAN_SOURCE_DRIFT');
  assert.ok(driftFact);
  assert.deepEqual(driftFact.value, { count: 2 });
  assert.equal(driftFact.authority, 'mechanical');
  assert.ok(driftFact.evidenceRefs.length > 0);
  assert.equal(
    withDrift.improvements.filter((entry) => entry.code === 'PLAN_SOURCE_DRIFT').length,
    1,
  );
  assert.match(withDrift.renderedText, /계획 원본 2개가 바뀌었습니다\. 계획 파일 갱신을 검토하세요\./u);
  assert.equal(withDrift.quality.healthy, true, JSON.stringify(withDrift.quality.checks));
  assert.ok(withDrift.quality.structuredBytes < 8192);
  assert.ok(withDrift.quality.renderedBytes < 8192);
  assert.ok(Buffer.byteLength(withDrift.renderedText) < 8192);

  const withoutDrift = compilePlainBrief(proposal('READY_FOR_APPROVAL', { shippingPlan: { ...shippingPlan, diagnostics: [] } }));
  assert.equal(withoutDrift.factGraph.facts.some((entry) => entry.code === 'PLAN_SOURCE_DRIFT'), false);
  assert.doesNotMatch(withoutDrift.renderedText, /계획 원본/u);
});

test('shipping_start and shipping_status expose the same Shipping-generated beginner report before technical details', async () => {
  const fixture = await createFixtureRepo();
  try {
    await writeFile(new URL('README.md', `file://${fixture.root}/`), '# existing unfinished work\n', 'utf8');
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Finish the smallest verified patch without adding unrelated product features',
      release: '0.1.0',
    });
    const startData = started.structuredContent;
    assert.equal(startData.proposalState, 'DIRTY_BASELINE');
    assert.equal(startData.plainBrief.state, 'DIRTY_BASELINE');
    assert.equal(startData.actionEnvelope.nextAction, 'REVIEW_BASELINE');
    assert.equal(startData.plainBrief.quality.healthy, true);
    assert.equal(started.content[0].text, startData.plainBriefText);
    for (const heading of ['문제점', '개선안', '다음 진행 플랜', '요약', '지금 할 일']) {
      assert.match(started.content[0].text, new RegExp(`## ${heading}`, 'u'));
    }

    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.userView.plainBrief.state, 'DIRTY_BASELINE');
    assert.equal(status.structuredContent.userView.actionEnvelope.nextAction, 'REVIEW_BASELINE');
    assert.equal(status.content[0].text, status.structuredContent.userView.plainBriefText);
    assert.equal(status.structuredContent.pendingProposal.proposalId, startData.proposalId);
  } finally {
    await fixture.cleanup();
  }
});

