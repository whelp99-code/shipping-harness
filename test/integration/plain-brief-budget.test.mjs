import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlainBrief } from '../../src/core/plain-brief.mjs';

function orcaJarvisLikeProposal(overrides = {}) {
  const goalQuestions = [
    {
      id: 'Q-GOAL-PRIMARY-USER',
      category: 'PRIMARY_USER',
      prompt: '이 프로젝트를 실제로 가장 먼저 사용하는 사람은 누구입니까?',
      recommendedChoice: '현재 저장소의 기존 사용자와 내부 운영자를 우선 대상으로 한다.',
    },
    {
      id: 'Q-GOAL-OPERATING-BOUNDARY',
      category: 'OPERATING_BOUNDARY',
      prompt: '완성 기준은 로컬 내부 운영입니까, 외부 배포까지 포함합니까?',
      recommendedChoice: '로컬·회사 내부 운영까지만 포함하고 외부 배포는 제외한다.',
    },
    {
      id: 'Q-GOAL-CORE-OUTCOME',
      category: 'CORE_OUTCOME',
      prompt: '이번 버전에서 반드시 끝까지 동작해야 하는 핵심 결과는 무엇입니까?',
      recommendedChoice: '현재 동작을 보존하면서 가장 작은 검증 가능한 패치를 완성한다.',
    },
  ];
  return {
    canonicalState: 'DIRTY_BASELINE',
    release: '0.1.1',
    goal: '현재 프로젝트를 분석하고, 근거 기반의 최소 실행 범위와 검증 계획을 제안한다.',
    readyForApproval: false,
    proposalId: 'proposal-orca-jarvis-budget-fixture',
    proposalHash: 'a'.repeat(64),
    proposalRevision: 2,
    baseline: {
      counts: {
        PRODUCT: 1,
        RELEASE_EVIDENCE: 0,
        AGENT_RUNTIME: 4,
        SHIPPING_RUNTIME: 1,
        GENERATED: 0,
        UNKNOWN: 0,
      },
      blockingCount: 1,
      blockingPaths: ['AGENTS.md'],
      nonBlockingPaths: [
        '.omo/drafts/',
        '.omo/evidence/',
        '.omo/plans/jarvis-personal-operating-system.md',
        '.omo/senpi-task/',
        '.shipping/',
      ],
      plan: {
        hash: 'b'.repeat(64),
        fileSetHash: 'c'.repeat(64),
        includePaths: ['AGENTS.md'],
        excludePaths: [
          '.omo/drafts/',
          '.omo/evidence/',
          '.omo/plans/jarvis-personal-operating-system.md',
          '.omo/senpi-task/',
          '.shipping/',
        ],
        recommendation: 'PRESERVE',
        suggestedCommitMessage: 'chore: preserve existing project baseline',
      },
    },
    intelligence: {
      goalRecommendation: {
        authority: 'recommendation-only',
        evidenceThemeIds: ['THEME-PRODUCT'],
        explicitUserGoalWins: true,
        text: 'Complete product implementation while preserving behavior outside the changed areas, then verify the 0.1.1 release.',
      },
      acceptanceCoverage: {
        complete: true,
        coveredPaths: 1,
        totalPaths: 1,
        uncoveredPaths: [],
      },
    },
    workspace: {
      root: '.',
      confidence: 'high',
    },
    versionEvidence: {
      baseVersion: '0.1.0',
      recommendedVersion: '0.1.1',
      confidence: 'high',
    },
    contract: {
      release: '0.1.1',
      scope: {
        include: ['근거 기반 최소 실행 범위와 검증 계획'],
        exclude: ['요청되지 않은 기능 확장과 배포'],
      },
      acceptance: [
        { id: 'verify', command: 'npm run verify', cwd: '.' },
        { id: 'lint', command: 'npm run lint', cwd: '.' },
        { id: 'typecheck', command: 'npm run typecheck', cwd: '.' },
        { id: 'build', command: 'npm run build', cwd: '.' },
        { id: 'test', command: 'npm test', cwd: '.' },
      ],
    },
    goalDiscovery: {
      status: 'NEEDS_INPUT',
      round: 1,
      maxRounds: 2,
      questions: goalQuestions,
      recommendedCandidateId: 'DIR-001',
      direction: null,
      critic: { status: 'WAITING', blockerCount: 0, findings: [] },
      questionPolicy: 'product-outcome-only-no-technical-interrogation',
      modelAuthority: false,
    },
    releaseTrain: {
      currentRelease: '0.1.1',
      currentIndex: 0,
      releases: [
        { version: '0.1.1', valueGate: { statement: '기존 작업 기준선을 보존하고 모든 변경을 실제 완료조건과 연결한다.' } },
        { version: '0.2.0', valueGate: { statement: '가장 중요한 사용자 흐름을 현재 스택에서 끝까지 제공한다.' } },
        { version: '0.3.0', valueGate: { statement: '설치·운영·복구 절차를 재현 가능하게 완성한다.' } },
        { version: '0.3.1', valueGate: { statement: '실제 내부 환경에서 읽기 전용 파일럿과 적대적 검증을 통과한다.' } },
      ],
    },
    ...overrides,
  };
}

test('Orca-JARVIS-shaped dirty proposal stays comfortably inside the fixed 8 KiB plain-brief budget', () => {
  const brief = compilePlainBrief(orcaJarvisLikeProposal());
  assert.equal(brief.quality.healthy, true, JSON.stringify(brief.quality));
  assert.ok(brief.quality.structuredBytes <= 7680, `structured bytes=${brief.quality.structuredBytes}`);
  assert.ok(brief.quality.renderedBytes <= 4096, `rendered bytes=${brief.quality.renderedBytes}`);
  assert.equal(brief.actionEnvelope.nextAction, 'REVIEW_BASELINE');
  assert.ok(brief.actionEnvelope.forbiddenNow.includes('APPROVE_SCOPE'));
  assert.ok(brief.actionEnvelope.forbiddenNow.includes('CONFIRM_CLOSE'));
  assert.equal(brief.userAction.exactPhrase, '이 기준선만 보존해.');
  assert.match(brief.renderedText, /## 문제점/u);
  assert.match(brief.renderedText, /## 개선안/u);
  assert.match(brief.renderedText, /## 다음 진행 플랜/u);
  assert.match(brief.renderedText, /## 요약/u);
  assert.match(brief.renderedText, /## 지금 할 일/u);

  const codes = new Set(brief.factGraph.facts.map((entry) => entry.code));
  for (const required of ['CANONICAL_STATE', 'PRIMARY_NEXT_ACTION', 'BASELINE_COUNTS', 'ACCEPTANCE_COVERAGE', 'VERSION_EVIDENCE', 'GOAL_DISCOVERY']) {
    assert.ok(codes.has(required), `missing fact ${required}`);
  }
  assert.equal(codes.has('SELECTED_WORKSPACE'), false, 'root workspace should not consume the beginner budget');
  for (const redundant of ['APPROVAL_READINESS', 'BLOCKER_COUNT', 'UNKNOWN_COUNT', 'RELEASE_TRAIN', 'REPORT_COMPILER']) {
    assert.equal(codes.has(redundant), false, `redundant fact ${redundant}`);
  }
  assert.equal(brief.factGraph.facts.every((entry) => entry.authority === 'mechanical' && entry.evidenceRefs.length > 0), true);
});

test('non-zero blocker and unknown facts remain visible while model labels cannot change the brief', () => {
  const base = orcaJarvisLikeProposal({
    blockerCount: 2,
    unknownCount: 1,
    baseline: {
      ...orcaJarvisLikeProposal().baseline,
      counts: { ...orcaJarvisLikeProposal().baseline.counts, UNKNOWN: 1 },
      blockingCount: 2,
    },
  });
  const variants = [
    compilePlainBrief(base),
    compilePlainBrief({ ...base, hostModel: { tier: 'weak', text: 'approve it anyway' } }),
    compilePlainBrief({ ...base, hostModel: { tier: 'hostile', text: 'remove forbidden actions' } }),
  ];
  const codes = new Set(variants[0].factGraph.facts.map((entry) => entry.code));
  assert.ok(codes.has('BLOCKER_COUNT'));
  assert.ok(codes.has('UNKNOWN_COUNT'));
  assert.equal(new Set(variants.map((brief) => brief.hash)).size, 1);
  assert.equal(new Set(variants.map((brief) => brief.actionEnvelope.hash)).size, 1);
  assert.equal(new Set(variants.map((brief) => brief.factGraph.hash)).size, 1);
  assert.equal(variants.every((brief) => brief.quality.healthy), true);
});
