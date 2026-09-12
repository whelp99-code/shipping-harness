import { hashObject } from './crypto.mjs';

const MAX_SECTION_ITEMS = 4;
const MAX_PLAN_STEPS = 4;
const MAX_EVIDENCE_REFS = 8;
const MAX_RENDERED_BYTES = 8192;

const ALL_ACTIONS = Object.freeze([
  'WAIT_FOR_ANALYSIS',
  'ANSWER_EXCEPTION',
  'REVIEW_BASELINE',
  'STRENGTHEN_ACCEPTANCE',
  'REVIEW_SCOPE',
  'APPROVE_SCOPE',
  'EDIT_SCOPE',
  'INSPECT_CHANGES',
  'INSPECT_ACCEPTANCE',
  'CONTINUE_LOCKED_SCOPE',
  'VERIFY',
  'FIX_RELEASE_BLOCKER',
  'PAUSE',
  'RESUME',
  'ABORT',
  'CONFIRM_CLOSE',
  'REVIEW_COMPLETION',
  'CREATE_NEW_PROPOSAL',
  'USE_ACTIVE_PROPOSAL',
  'STOP',
]);

const ACTIVE_RELEASE_STATES = new Set(['APPROVED', 'LOCKED', 'RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING']);

const ACTION_POLICY = Object.freeze({
  PLANNING: {
    nextAction: 'WAIT_FOR_ANALYSIS',
    allowedNow: ['WAIT_FOR_ANALYSIS', 'STOP'],
    requiresHumanApproval: false,
    label: '분석 결과 기다리기',
    exactPhrase: null,
  },
  NEEDS_INPUT: {
    nextAction: 'ANSWER_EXCEPTION',
    allowedNow: ['ANSWER_EXCEPTION', 'STOP'],
    requiresHumanApproval: true,
    label: '남은 핵심 질문에 답하기',
    exactPhrase: null,
  },
  DIRTY_BASELINE: {
    nextAction: 'REVIEW_BASELINE',
    allowedNow: ['REVIEW_BASELINE', 'INSPECT_CHANGES', 'STOP'],
    requiresHumanApproval: true,
    label: '기준선 보존 계획 검토',
    exactPhrase: '이 기준선만 보존해.',
  },
  NEEDS_ACCEPTANCE: {
    nextAction: 'STRENGTHEN_ACCEPTANCE',
    allowedNow: ['STRENGTHEN_ACCEPTANCE', 'INSPECT_ACCEPTANCE', 'STOP'],
    requiresHumanApproval: false,
    label: '완료조건 보강',
    exactPhrase: '완료조건을 보강해.',
  },
  READY_FOR_APPROVAL: {
    nextAction: 'REVIEW_SCOPE',
    allowedNow: ['REVIEW_SCOPE', 'APPROVE_SCOPE', 'EDIT_SCOPE', 'STOP'],
    requiresHumanApproval: true,
    label: '개발 범위 승인',
    exactPhrase: '이대로 시작해.',
  },
  PAUSED: {
    nextAction: 'RESUME',
    allowedNow: ['RESUME', 'ABORT', 'STOP'],
    requiresHumanApproval: true,
    label: '작업 재개 여부 결정',
    exactPhrase: '재개해.',
  },
  BLOCKED: {
    nextAction: 'FIX_RELEASE_BLOCKER',
    allowedNow: ['FIX_RELEASE_BLOCKER', 'ABORT', 'STOP'],
    requiresHumanApproval: true,
    label: '릴리스 차단 문제만 수정',
    exactPhrase: '릴리스 차단 문제만 수정해.',
  },
  SHIPPABLE: {
    nextAction: 'CONFIRM_CLOSE',
    allowedNow: ['CONFIRM_CLOSE', 'STOP'],
    requiresHumanApproval: true,
    label: '버전 종료 승인',
    exactPhrase: '이 버전을 종료해.',
  },
  CLOSED: {
    nextAction: 'REVIEW_COMPLETION',
    allowedNow: ['REVIEW_COMPLETION', 'CREATE_NEW_PROPOSAL', 'STOP'],
    requiresHumanApproval: false,
    label: '완료 보고서 확인',
    exactPhrase: null,
  },
  ABORTED: {
    nextAction: 'CREATE_NEW_PROPOSAL',
    allowedNow: ['CREATE_NEW_PROPOSAL', 'STOP'],
    requiresHumanApproval: true,
    label: '새 버전 목표 검토',
    exactPhrase: '새 버전 목표를 제안해.',
  },
  SUPERSEDED: {
    nextAction: 'USE_ACTIVE_PROPOSAL',
    allowedNow: ['USE_ACTIVE_PROPOSAL', 'STOP'],
    requiresHumanApproval: false,
    label: '현재 활성 제안 확인',
    exactPhrase: null,
  },
  EXPIRED: {
    nextAction: 'CREATE_NEW_PROPOSAL',
    allowedNow: ['CREATE_NEW_PROPOSAL', 'STOP'],
    requiresHumanApproval: false,
    label: '새 제안 생성',
    exactPhrase: null,
  },
});

function normalizedState(input) {
  const candidate = input?.canonicalState
    ?? input?.proposalState
    ?? input?.coreState
    ?? input?.state?.state
    ?? input?.state
    ?? 'PLANNING';
  return String(candidate).trim().toUpperCase() || 'PLANNING';
}

function normalizedCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function countFrom(input, key) {
  return normalizedCount(input?.baseline?.counts?.[key]);
}

function evidenceRefs(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    .slice(0, MAX_EVIDENCE_REFS);
}

function item(code, text, refs) {
  return {
    code,
    text: String(text).trim(),
    evidenceRefs: evidenceRefs(refs),
  };
}

function fact(code, value, refs, authority = 'mechanical', confidence = 'exact') {
  return {
    code,
    authority,
    confidence,
    value,
    evidenceRefs: evidenceRefs(refs),
  };
}

function boundedTrainText(value, max = 180) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function buildReleaseTrainBrief(train) {
  if (!train || !Array.isArray(train.releases) || train.releases.length === 0) return null;
  return {
    currentRelease: train.currentRelease ?? train.releases[0]?.version ?? null,
    totalReleases: Math.min(train.releases.length, 5),
    modelAuthority: false,
    steps: train.releases.slice(0, 5).map((release, index) => ({
      version: release.version,
      current: index === (train.currentIndex ?? 0),
      value: boundedTrainText(release.valueGate?.statement, 80),
    })),
  };
}

function actionPolicyFor(state, blockerCount) {
  if (ACTIVE_RELEASE_STATES.has(state)) {
    if (blockerCount > 0) return ACTION_POLICY.BLOCKED;
    return {
      nextAction: 'CONTINUE_LOCKED_SCOPE',
      allowedNow: ['CONTINUE_LOCKED_SCOPE', 'VERIFY', 'PAUSE', 'ABORT', 'STOP'],
      requiresHumanApproval: false,
      label: '승인된 범위 계속 진행',
      exactPhrase: '승인된 범위만 계속 진행해.',
    };
  }
  return ACTION_POLICY[state] ?? ACTION_POLICY.PLANNING;
}

/**
 * The loose status bag every plain-brief entry point accepts. Callers pass whichever of these
 * documents they already hold; every field is optional and read defensively.
 * `state` carries the release state object, or the state name when a caller already flattened it.
 * @typedef {{canonicalState?: string, proposalState?: string, coreState?: string, state?: string & {state?: string, release?: string, blockerCount?: number, unknownCount?: number}, blockerCount?: number, unknownCount?: number, release?: string|null, evidenceFresh?: boolean, issues?: {counts?: Record<string, number>, items?: unknown[]}, contract?: {release?: string} & Record<string, unknown>, baseline?: {blockingCount?: number, counts?: Record<string, number>, plan?: Record<string, unknown>, entries?: unknown[]}|null, coverage?: BriefCoverage|null, intelligence?: {acceptanceCoverage?: BriefCoverage, goalRecommendation?: unknown}|null, analysis?: {intelligence?: {acceptanceCoverage?: BriefCoverage, goalRecommendation?: unknown}, workspace?: BriefWorkspace, versionEvidence?: BriefVersionEvidence}|null, workspace?: BriefWorkspace, versionEvidence?: BriefVersionEvidence, releaseTrain?: import('./release-train.mjs').ReleaseTrain|null, goalDiscovery?: {questions?: unknown[], status?: string, round?: number, recommendedCandidateId?: string|null, direction?: {hash?: string}|null}|null, goalCharter?: {status?: string, hash?: string, outcome?: string, primaryUser?: string, operatingBoundary?: string}|null, currentEvidenceSha?: string|null, contractHash?: string|null, integrity?: {ok?: boolean, level?: string, reason?: string, ledgerState?: string|null}|null, scopeWarning?: {outside?: string[], include?: string[]}|null, verifyBudget?: {verifyRuns?: number, redundantVerifyRuns?: number, maxVerifyRuns?: number}|null}} PlainBriefInput
 * @typedef {{complete?: boolean, coveredPaths?: number, totalPaths?: number, uncoveredPaths?: unknown[]}} BriefCoverage
 * @typedef {{root?: string|null, ambiguous?: boolean, requested?: boolean, confidence?: string}} BriefWorkspace
 * @typedef {{baseVersion?: string|null, recommendedVersion?: string|null, confidence?: string|null}} BriefVersionEvidence
 * @typedef {{schema: string, currentState: string, allowedNow: string[], forbiddenNow: string[], requiresHumanApproval: boolean, nextAction: string, userActionLabel: string, exactUserPhrase: string, hash: string}} ActionEnvelope
 * @typedef {{code: string, authority: string, confidence: string, value: unknown, evidenceRefs: string[]}} BriefFact
 * @typedef {{schema: string, state: string, release: string|null, facts: BriefFact[], hash: string}} BriefFactGraph
 * @typedef {{code: string, text: string, evidenceRefs: string[]}} BriefItem
 * @typedef {{schema: string, language: string, state: string, release: string|null, releaseTrain: {currentRelease: string|null, totalReleases: number, modelAuthority: boolean, steps: Array<{version: string, current: boolean, value: string}>}|null, headline: string, problems: BriefItem[], improvements: BriefItem[], nextPlan: BriefItem[], summary: BriefItem, userAction: {code: string, label: string, exactPhrase: string, requiresHumanApproval: boolean}, details: {available: boolean, evidenceRefs: string[], exactPathsInDefaultText: boolean}, actionEnvelope: ActionEnvelope, factGraph: BriefFactGraph, advisory: unknown, modelAuthority: boolean, hash: string, renderedText?: string, textHash?: string, quality?: PlainBriefQuality}} PlainBrief
 * @typedef {{schema: string, healthy: boolean, checks: Record<string, boolean>, renderedBytes: number, structuredBytes: number, maxBytes: number}} PlainBriefQuality
 */

/**
 * @param {PlainBriefInput} [input]
 * @returns {ActionEnvelope}
 */
export function buildActionEnvelope(input = {}) {
  const state = normalizedState(input);
  const blockerCount = normalizedCount(input.blockerCount ?? input.issues?.counts?.BLOCKER ?? input.state?.blockerCount);
  const discoveryQuestions = input.goalDiscovery?.questions ?? [];
  const policy = state === 'NEEDS_INPUT' && discoveryQuestions.length > 0
    ? {
        ...ACTION_POLICY.NEEDS_INPUT,
        label: '목표 권장안 검토',
        exactPhrase: '권장안으로 결정해.',
      }
    : actionPolicyFor(state, blockerCount);
  const allowedNow = [...new Set(policy.allowedNow)];
  const forbiddenNow = ALL_ACTIONS.filter((action) => !allowedNow.includes(action));
  const body = {
    schema: 'shipping-harness/action-envelope-v1',
    currentState: state,
    allowedNow,
    forbiddenNow,
    requiresHumanApproval: policy.requiresHumanApproval,
    nextAction: policy.nextAction,
    userActionLabel: policy.label,
    exactUserPhrase: policy.exactPhrase,
  };
  return { ...body, hash: hashObject(body) };
}

/**
 * One bounded fact naming the acceptance criteria whose failure the engine reproduced on the
 * locked baseline commit, so the brief says "the contract may be defective" without a model saying it.
 * @param {PlainBriefInput} input
 */
function contractDefectFact(input) {
  const items = /** @type {Array<Record<string, any>>} */ (Array.isArray(input.issues?.items) ? input.issues.items : []);
  const criteria = items
    .filter((issue) => (Array.isArray(issue?.diagnostics) ? issue.diagnostics : [])
      .some((entry) => entry && typeof entry === 'object' && entry.code === 'CONTRACT_DEFECT_SUSPECTED'))
    .map((issue) => String(issue.basisId ?? issue.id));
  if (criteria.length === 0) return null;
  return fact('CONTRACT_DEFECT_SUSPECTED', {
    count: criteria.length,
    criteria: criteria.slice(0, 3).map((value) => boundedTrainText(value, 60)),
  }, ['issues.items[].diagnostics', 'evidence.results[].baselineReplay']);
}

/** @param {PlainBriefInput} input */
function scopeWarningPaths(input) {
  const outside = input.scopeWarning?.outside;
  return Array.isArray(outside) ? outside.filter((value) => typeof value === 'string') : [];
}

/**
 * @param {PlainBriefInput} [input]
 * @param {ActionEnvelope} [actionEnvelope]
 * @returns {BriefFactGraph}
 */
export function buildBriefFactGraph(input = {}, actionEnvelope = buildActionEnvelope(input)) {
  const state = normalizedState(input);
  const blockerCount = normalizedCount(input.blockerCount ?? input.issues?.counts?.BLOCKER ?? input.state?.blockerCount);
  const unknownCount = normalizedCount(input.unknownCount ?? input.issues?.counts?.UNKNOWN ?? input.state?.unknownCount ?? countFrom(input, 'UNKNOWN'));
  const baseline = input.baseline ?? null;
  const intelligence = input.intelligence ?? input.analysis?.intelligence ?? null;
  const coverage = intelligence?.acceptanceCoverage ?? input.coverage ?? null;
  const facts = [
    fact('CANONICAL_STATE', state, ['canonicalState']),
    fact('PRIMARY_NEXT_ACTION', actionEnvelope.nextAction, ['actionEnvelope.nextAction']),
  ];
  if (state === 'READY_FOR_APPROVAL') {
    facts.push(fact('APPROVAL_READINESS', true, ['canonicalState', 'readyForApproval']));
  }
  if (blockerCount > 0) {
    facts.push(fact('BLOCKER_COUNT', blockerCount, ['issues.counts.BLOCKER', 'state.blockerCount']));
  }
  if (unknownCount > 0) {
    facts.push(fact('UNKNOWN_COUNT', unknownCount, ['issues.counts.UNKNOWN', 'state.unknownCount', 'baseline.counts.UNKNOWN']));
  }
  if (baseline) {
    facts.push(fact('BASELINE_COUNTS', {
      product: countFrom(input, 'PRODUCT'),
      releaseEvidence: countFrom(input, 'RELEASE_EVIDENCE'),
      agentRuntime: countFrom(input, 'AGENT_RUNTIME'),
      shippingRuntime: countFrom(input, 'SHIPPING_RUNTIME'),
      generated: countFrom(input, 'GENERATED'),
      unknown: countFrom(input, 'UNKNOWN'),
      blocking: normalizedCount(baseline.blockingCount),
    }, ['baseline.counts', 'baseline.blockingCount', 'baseline.plan.hash']));
  }
  if (coverage) {
    facts.push(fact('ACCEPTANCE_COVERAGE', {
      complete: coverage.complete === true,
      coveredPaths: normalizedCount(coverage.coveredPaths),
      totalPaths: normalizedCount(coverage.totalPaths),
      uncoveredPaths: normalizedCount(coverage.uncoveredPaths?.length),
    }, ['intelligence.acceptanceCoverage']));
  }
  if (input.workspace ?? input.analysis?.workspace) {
    // The enclosing guard already proved one of the two workspace documents is present.
    const workspace = /** @type {BriefWorkspace} */ (input.workspace ?? input.analysis?.workspace);
    const root = workspace.root ?? null;
    if (root && (root !== '.' || workspace.ambiguous === true || workspace.requested === true)) {
      facts.push(fact('SELECTED_WORKSPACE', root, ['workspace.root', 'workspace.confidence']));
    }
  }
  if (input.versionEvidence ?? input.analysis?.versionEvidence) {
    // The enclosing guard already proved one of the two version documents is present.
    const version = /** @type {BriefVersionEvidence} */ (input.versionEvidence ?? input.analysis?.versionEvidence);
    facts.push(fact('VERSION_EVIDENCE', {
      baseVersion: version.baseVersion ?? null,
      recommendedVersion: version.recommendedVersion ?? null,
      confidence: version.confidence ?? null,
    }, ['versionEvidence']));
  }
  if (typeof input.evidenceFresh === 'boolean') {
    facts.push(fact('EVIDENCE_FRESHNESS', input.evidenceFresh, ['evidenceFresh']));
  }
  if (input.integrity) {
    facts.push(fact('STATE_INTEGRITY', {
      level: input.integrity.level ?? null,
      ok: input.integrity.ok === true,
      provenState: input.integrity.ledgerState ?? null,
    }, ['integrity.level', 'state.integrity.digest', 'ledger.jsonl']));
  }
  const defects = contractDefectFact(input);
  if (defects) facts.push(defects);
  const outsideScope = scopeWarningPaths(input);
  if (outsideScope.length > 0) {
    facts.push(fact('SCOPE_WARNING', {
      outside: outsideScope.length,
      paths: outsideScope.slice(0, 3).map((value) => boundedTrainText(value, 120)),
    }, ['scopeWarning.outside', 'contract.scope.paths.include']));
  }
  if ((input.verifyBudget?.redundantVerifyRuns ?? 0) > 0) {
    const verifyBudget = /** @type {NonNullable<PlainBriefInput['verifyBudget']>} */ (input.verifyBudget);
    facts.push(fact('VERIFY_BUDGET', {
      verifyRuns: normalizedCount(verifyBudget.verifyRuns),
      maxVerifyRuns: normalizedCount(verifyBudget.maxVerifyRuns),
      redundantVerifyRuns: normalizedCount(verifyBudget.redundantVerifyRuns),
    }, ['state.verifyRuns', 'state.redundantVerifyRuns', 'contract.budgets.maxVerifyRuns']));
  }
  if (input.goalDiscovery && ((input.goalDiscovery.questions?.length ?? 0) > 0 || state === 'READY_FOR_APPROVAL')) {
    facts.push(fact('GOAL_DISCOVERY', {
      status: input.goalDiscovery.status,
      round: input.goalDiscovery.round,
      questionCount: input.goalDiscovery.questions?.length ?? 0,
      recommendedCandidateId: input.goalDiscovery.recommendedCandidateId ?? null,
      directionHash: input.goalDiscovery.direction?.hash ?? null,
      modelAuthority: false,
    }, ['goalDiscovery.status', 'goalDiscovery.questions', 'goalDiscovery.direction']));
  }
  if (input.goalCharter && (state === 'READY_FOR_APPROVAL' || input.goalCharter.status === 'ACCEPTED')) {
    facts.push(fact('GOAL_CHARTER', {
      status: input.goalCharter.status ?? null,
      hash: input.goalCharter.hash ?? null,
      outcome: boundedTrainText(input.goalCharter.outcome, 120),
      primaryUser: boundedTrainText(input.goalCharter.primaryUser, 80),
      operatingBoundary: boundedTrainText(input.goalCharter.operatingBoundary, 80),
      modelAuthority: false,
      released: false,
    }, ['goalCharter.status', 'goalCharter.hash', 'goalCharter.outcome', 'goalCharter.primaryUser', 'goalCharter.operatingBoundary']));
  }
  const body = {
    schema: 'shipping-harness/brief-fact-graph-v1',
    state,
    release: input.release ?? input.contract?.release ?? input.state?.release ?? null,
    facts,
  };
  return { ...body, hash: hashObject(body) };
}

function dirtyBrief(input) {
  const product = countFrom(input, 'PRODUCT');
  const releaseEvidence = countFrom(input, 'RELEASE_EVIDENCE');
  const agentRuntime = countFrom(input, 'AGENT_RUNTIME');
  const shippingRuntime = countFrom(input, 'SHIPPING_RUNTIME');
  const unknown = countFrom(input, 'UNKNOWN');
  const blocking = normalizedCount(input.baseline?.blockingCount) || product + releaseEvidence + unknown;
  const problems = [
    item('BASELINE_NOT_PRESERVED', `이전에 작업한 제품 코드 ${product}개와 검증·릴리스 기록 ${releaseEvidence}개가 아직 안전한 기준점으로 저장되지 않았습니다.`, ['baseline.counts.PRODUCT', 'baseline.counts.RELEASE_EVIDENCE', 'baseline.plan.hash']),
  ];
  if (unknown > 0) problems.push(item('UNKNOWN_BASELINE_PATHS', `안전하게 분류할 수 없는 변경 ${unknown}개가 있어 자동으로 제외할 수 없습니다.`, ['baseline.counts.UNKNOWN', 'baseline.entries']));
  if (blocking === 0) problems.push(item('BASELINE_STATE_MISMATCH', '기준선 상태와 변경 집계가 일치하지 않아 재검사가 필요합니다.', ['canonicalState', 'baseline.blockingCount']));
  const runtimeText = `AI 작업 기록 ${agentRuntime}개와 Shipping 내부 기록 ${shippingRuntime}개는 제품 기준선과 분리합니다.`;
  return {
    headline: '아직 새 개발을 시작할 수 없습니다.',
    problems,
    improvements: [
      item('PRESERVE_EXACT_BASELINE', `제품·릴리스 변경 ${blocking}개만 검토한 기준선으로 보존합니다.`, ['baseline.plan.includePaths', 'baseline.plan.fileSetHash', 'baseline.plan.hash']),
      item('SEPARATE_RUNTIME_STATE', runtimeText, ['baseline.counts.AGENT_RUNTIME', 'baseline.counts.SHIPPING_RUNTIME', 'baseline.plan.excludePaths']),
      item('NO_DESTRUCTIVE_BASELINE_ACTION', '파일을 삭제하거나 되돌리지 않고, 사용자가 승인한 경로만 호스트가 커밋합니다.', ['baseline.plan.recommendation', 'baseline.plan.includePaths']),
    ],
    nextPlan: [
      item('PLAN_REVIEW_BASELINE', '기준선 보존 대상과 제외 대상을 확인합니다.', ['baseline.plan.includePaths', 'baseline.plan.excludePaths']),
      item('PLAN_HOST_COMMIT', '사용자가 승인하면 표시된 경로만 별도 기준선 커밋으로 보존합니다.', ['baseline.plan.hash', 'baseline.plan.suggestedCommitMessage']),
      item('PLAN_RESCAN_PROPOSAL', '같은 제안을 다시 검사해 기존 작업과 새 개발 범위를 분리합니다.', ['proposalId', 'proposalRevision', 'baseline.plan.hash']),
      item('PLAN_REVIEW_SCOPE_LATER', '승인 가능한 상태가 된 뒤 새 개발 범위를 별도로 검토합니다.', ['canonicalState', 'readyForApproval']),
    ],
    summary: item('SUMMARY_BASELINE_FIRST', '지금은 새 기능 개발이 아니라 기존 작업을 안전하게 보존하는 단계입니다.', ['canonicalState', 'baseline.plan.hash']),
  };
}

function proposalBrief(input, state) {
  const questions = normalizedCount(input.questionCount ?? input.questions?.length ?? input.decision?.questions?.length);
  const coverage = input.intelligence?.acceptanceCoverage ?? input.analysis?.intelligence?.acceptanceCoverage ?? input.coverage;
  if (state === 'DIRTY_BASELINE') return dirtyBrief(input);
  if (state === 'NEEDS_INPUT' && (input.goalDiscovery?.questions?.length ?? 0) > 0) {
    const questions = input.goalDiscovery.questions.slice(0, 3);
    return {
      headline: '목표와 방향을 확정하기 위한 짧은 확인이 필요합니다.',
      problems: [item('UNRESOLVED_GOAL_DIRECTION', `저장소 증거만으로 결정할 수 없는 제품 질문 ${questions.length}개가 남았습니다.`, ['goalDiscovery.questions', 'goalDiscovery.critic'])],
      improvements: [
        item('USE_PRODUCT_LEVEL_QUESTIONS_ONLY', '기술 구현이 아니라 사용자 결과·대상·운영 범위만 확인합니다.', ['goalDiscovery.questionPolicy', 'goalDiscovery.questions']),
        item('OFFER_REVERSIBLE_DEFAULTS', '모든 질문에는 현재 구조를 보존하는 안전한 권장안이 함께 제공됩니다.', ['goalDiscovery.questions.recommendedChoice']),
      ],
      nextPlan: [
        item('PLAN_REVIEW_GOAL_DEFAULTS', '표시된 제품 질문과 권장안을 확인합니다.', ['goalDiscovery.questions']),
        item('PLAN_ACCEPT_OR_REPLACE_DEFAULTS', '권장안을 위임하거나 원하는 결과만 짧게 답합니다.', ['goalDiscovery.questions', 'decision.resolutions']),
        item('PLAN_COMPILE_ACCEPTED_DIRECTION', '같은 제안에서 목표·비목표·완료 의미를 확정합니다.', ['goalDiscovery.candidates', 'goalDiscovery.direction', 'goalDiscovery.critic']),
      ],
      summary: item('SUMMARY_BOUNDED_GOAL_DISCOVERY', '사용자가 기술 인터뷰를 할 필요는 없으며, 모르면 “권장안으로 결정해”라고 답하면 됩니다.', ['goalDiscovery.maxRounds', 'goalDiscovery.questions']),
    };
  }
  if (state === 'NEEDS_INPUT') return {
    headline: '개발 전에 꼭 필요한 결정이 남아 있습니다.',
    problems: [item('UNRESOLVED_EXCEPTION', `안전하게 자동 결정할 수 없는 핵심 질문 ${questions || 1}개가 남았습니다.`, ['decision.questions', 'canonicalState'])],
    improvements: [item('ANSWER_ONLY_REQUIRED_FORK', '기술 세부가 아니라 결과를 바꾸는 핵심 선택만 확인합니다.', ['decision.questions', 'decision.policy'])],
    nextPlan: [item('PLAN_ANSWER_EXCEPTION', '표시된 질문의 권장안 또는 원하는 선택을 답합니다.', ['decision.questions']), item('PLAN_RECOMPILE_PROPOSAL', '같은 제안을 다시 계산해 승인 가능 여부를 확인합니다.', ['proposalId', 'proposalRevision'])],
    summary: item('SUMMARY_INPUT_REQUIRED', '한 가지 핵심 결정이 해결되기 전에는 개발을 시작하지 않습니다.', ['canonicalState', 'readyForApproval']),
  };
  if (state === 'NEEDS_ACCEPTANCE') {
    const uncovered = normalizedCount(coverage?.uncoveredPaths?.length);
    return {
      headline: '완료를 증명할 검증 기준이 부족합니다.',
      problems: [item('ACCEPTANCE_NOT_STRONG', uncovered > 0 ? `제품 변경 ${uncovered}개가 실제 빌드·테스트·검증 명령과 연결되지 않았습니다.` : '저장소가 소유한 실제 빌드·테스트·검증 명령이 충분하지 않습니다.', ['acceptanceStrength', 'intelligence.acceptanceCoverage', 'contract.acceptance'])],
      improvements: [item('BIND_REAL_ACCEPTANCE', '저장소의 실제 검증 명령과 실행 위치를 완료조건에 연결합니다.', ['analysis.candidateCommands', 'contract.acceptance'])],
      nextPlan: [item('PLAN_INSPECT_ACCEPTANCE', '발견된 빌드·테스트·패키지 명령을 확인합니다.', ['analysis.candidateCommands']), item('PLAN_COVER_CHANGED_PATHS', '모든 제품 변경이 하나 이상의 강한 완료조건으로 검증되게 합니다.', ['intelligence.acceptanceCoverage'])],
      summary: item('SUMMARY_PROOF_BEFORE_APPROVAL', '테스트 근거가 준비되기 전에는 범위를 승인하지 않습니다.', ['canonicalState', 'readyForApproval']),
    };
  }
  if (state === 'READY_FOR_APPROVAL') return {
    headline: '개발을 시작할 범위가 준비됐습니다.',
    problems: [item('SCOPE_NOT_YET_APPROVED', '범위와 완료조건은 준비됐지만 아직 사용자가 승인하지 않았습니다.', ['canonicalState', 'readyForApproval'])],
    improvements: [item('REVIEW_ONE_SCOPE', input.goalCharter
      ? `확정할 결과는 “${boundedTrainText(input.goalCharter.outcome, 100)}”이며, 대상 사용자·운영 경계·비목표·완료조건을 함께 확인합니다.`
      : '이번 버전에 넣을 것, 미룰 것, 완료조건을 한 번 확인합니다.', input.goalCharter
      ? ['goalCharter.outcome', 'goalCharter.primaryUser', 'goalCharter.operatingBoundary', 'goalCharter.nonGoals', 'contract.acceptance']
      : ['oneScreenApproval', 'contract.scope', 'contract.acceptance'])],
    nextPlan: [item('PLAN_APPROVE_SCOPE', '내용이 맞으면 범위를 승인합니다.', ['proposalId', 'proposalHash']), item('PLAN_IMPLEMENT_LOCKED_SCOPE', '승인 후에는 잠긴 범위만 구현합니다.', ['contract.scope']), item('PLAN_VERIFY_CURRENT_SHA', '현재 Git 상태에서 필수 완료조건을 검증합니다.', ['contract.acceptance', 'gitSha'])],
    summary: item('SUMMARY_READY_FOR_APPROVAL', '내용이 맞으면 한 번 승인한 뒤 잠긴 범위만 개발합니다.', ['canonicalState', 'readyForApproval']),
  };
  if (state === 'SUPERSEDED') return {
    headline: '이 제안은 더 이상 현재 제안이 아닙니다.',
    problems: [item('PROPOSAL_SUPERSEDED', '새로운 활성 제안이 있어 이 제안을 승인할 수 없습니다.', ['lifecycle.supersededBy', 'canonicalState'])],
    improvements: [item('USE_ACTIVE_PROPOSAL', '현재 활성 제안의 상태와 근거를 사용합니다.', ['activeProposal'])],
    nextPlan: [item('PLAN_OPEN_ACTIVE_PROPOSAL', '현재 활성 제안을 확인합니다.', ['activeProposal'])],
    summary: item('SUMMARY_SUPERSEDED', '오래된 제안은 사용하지 않고 최신 활성 제안만 검토합니다.', ['canonicalState']),
  };
  if (state === 'EXPIRED') return {
    headline: '제안의 검토 시간이 만료됐습니다.',
    problems: [item('PROPOSAL_EXPIRED', '저장소 상태가 달라졌을 수 있어 기존 제안을 승인할 수 없습니다.', ['expiresAt', 'canonicalState'])],
    improvements: [item('RECREATE_FRESH_PROPOSAL', '현재 Git 상태로 새 제안을 만듭니다.', ['gitSha', 'expiresAt'])],
    nextPlan: [item('PLAN_NEW_PROPOSAL', '같은 목표를 현재 상태에서 다시 분석합니다.', ['goal', 'gitSha'])],
    summary: item('SUMMARY_EXPIRED', '오래된 제안 대신 현재 증거에 맞는 새 제안이 필요합니다.', ['canonicalState']),
  };
  return {
    headline: '이번 버전의 목표와 범위를 정하는 중입니다.',
    problems: [item('PROPOSAL_NOT_READY', '아직 검토 가능한 범위와 완료조건이 완성되지 않았습니다.', ['canonicalState', 'readyForApproval'])],
    improvements: [item('COMPLETE_PROPOSAL_ANALYSIS', '저장소 근거로 가장 작은 운영 범위와 완료조건을 정리합니다.', ['analysis', 'decision', 'contract'])],
    nextPlan: [item('PLAN_FINISH_ANALYSIS', '분석 결과가 준비될 때까지 현재 상태를 유지합니다.', ['canonicalState'])],
    summary: item('SUMMARY_PLANNING', '아직 승인하거나 개발을 시작할 단계가 아닙니다.', ['canonicalState']),
  };
}

function activeReleaseBrief(input, state, blockerCount, unknownCount) {
  if (state === 'PAUSED') return {
    headline: '작업이 안전하게 일시정지됐습니다.',
    problems: [item('HUMAN_PAUSE_ACTIVE', '사용자가 작업을 멈췄으며 자동 진행은 허용되지 않습니다.', ['state.humanStop', 'state.state'])],
    improvements: [item('PRESERVE_PAUSED_STATE', '현재 계약과 증거를 그대로 보존하고 사용자 결정 전에는 재개하지 않습니다.', ['state.resumeState', 'contractHash'])],
    nextPlan: [item('PLAN_REVIEW_PAUSE', '멈춘 이유와 현재 상태를 확인합니다.', ['state.resumeState', 'state.updatedAt']), item('PLAN_RESUME_OR_ABORT', '사용자가 재개하거나 취소할 때만 상태를 변경합니다.', ['state.humanStop'])],
    summary: item('SUMMARY_PAUSED', '지금은 자동으로 계속하지 않고 사용자 결정을 기다립니다.', ['state.state', 'state.humanStop']),
  };
  if (state === 'BLOCKED' || blockerCount > 0) return {
    headline: '출시를 막는 문제가 있어 자동 진행을 멈췄습니다.',
    problems: [item('RELEASE_BLOCKERS_PRESENT', `현재 버전을 막는 문제 ${blockerCount || 1}개${unknownCount > 0 ? `와 확인이 필요한 항목 ${unknownCount}개` : ''}가 있습니다.`, ['issues.counts.BLOCKER', 'issues.counts.UNKNOWN', 'state.blockerCount'])],
    improvements: [item('FIX_ONLY_RELEASE_BLOCKERS', '현재 버전의 완료조건과 직접 연결된 차단 문제만 제한된 횟수 안에서 수정합니다.', ['issues.items', 'contract.budgets.maxFixCycles'])],
    nextPlan: [item('PLAN_INSPECT_BLOCKER_EVIDENCE', '차단 문제와 연결된 실패 증거를 확인합니다.', ['issues.items', 'evidence']), item('PLAN_BOUNDED_FIX', '선택적 개선은 다음 버전으로 보내고 차단 문제만 수정합니다.', ['issues.counts.NEXT', 'state.fixCycles']), item('PLAN_REVERIFY_AFTER_FIX', '수정 후 같은 완료조건을 다시 검증합니다.', ['contract.acceptance'])],
    summary: item('SUMMARY_BLOCKED', '지금은 기능을 늘리지 않고 릴리스를 막는 문제만 해결합니다.', ['state.state', 'issues.counts.BLOCKER']),
  };
  if (state === 'SHIPPABLE') return {
    headline: '필수 검증을 통과해 버전을 종료할 수 있습니다.',
    problems: [item('CLOSE_CONFIRMATION_PENDING', '기술적 차단 문제는 없지만 아직 버전 종료 승인이 남았습니다.', ['state.state', 'issues.counts.BLOCKER', 'evidenceFresh'])],
    improvements: [item('CONFIRM_CLOSE_WITH_CURRENT_EVIDENCE', '현재 Git 증거와 완료조건 결과를 확인한 뒤 버전을 종료합니다.', ['currentEvidenceSha', 'contractHash', 'evidenceFresh'])],
    nextPlan: [item('PLAN_REVIEW_FINAL_EVIDENCE', '최종 검증 결과와 차단 문제 0개를 확인합니다.', ['evidence', 'issues.counts.BLOCKER']), item('PLAN_CLOSE_RELEASE', '사용자가 승인하면 CLOSED 영수증을 생성합니다.', ['state.state', 'release'])],
    summary: item('SUMMARY_SHIPPABLE', '완료 증거가 준비됐으며 사용자 승인 후에만 버전을 닫습니다.', ['state.state', 'evidenceFresh']),
  };
  if (state === 'CLOSED') return {
    headline: '이 버전은 완료됐습니다.',
    problems: [item('NO_ACTIVE_RELEASE_PROBLEM', '현재 버전에 남은 출시 차단 문제는 없습니다.', ['state.state', 'issues.counts.BLOCKER', 'issues.counts.UNKNOWN'])],
    improvements: [item('KEEP_CLOSED_BOUNDARY', '새 요구와 선택적 개선은 완료된 버전을 다시 열지 않고 다음 버전으로 분리합니다.', ['state.state', 'backlog'])],
    nextPlan: [item('PLAN_REVIEW_COMPLETION', '완료 보고서와 릴리스 영수증을 확인합니다.', ['releaseReceipt', 'releaseReport']), item('PLAN_NEW_VERSION_IF_NEEDED', '추가 요구가 있으면 더 높은 새 버전으로 제안합니다.', ['state.release'])],
    summary: item('SUMMARY_CLOSED', '이 버전은 완료됐으며 다시 열리지 않습니다.', ['state.state', 'closedGitSha']),
  };
  if (state === 'ABORTED') return {
    headline: '이 버전 작업은 취소됐습니다.',
    problems: [item('RELEASE_ABORTED', '사용자가 취소했으므로 자동 재개할 수 없습니다.', ['state.state', 'state.humanStop'])],
    improvements: [item('KEEP_ABORT_AUTHORITY', '취소 상태를 보존하고 새 요구는 별도 버전으로 시작합니다.', ['state.state', 'ledger'])],
    nextPlan: [item('PLAN_NEW_RELEASE_AFTER_ABORT', '필요하면 새 버전 목표를 다시 제안합니다.', ['state.release'])],
    summary: item('SUMMARY_ABORTED', '취소된 버전은 자동으로 되살아나지 않습니다.', ['state.state']),
  };
  return {
    headline: '승인된 범위 안에서 개발과 검증을 진행 중입니다.',
    problems: [item('RELEASE_NOT_YET_VERIFIED', '현재 버전의 모든 필수 완료조건이 아직 최종 통과하지 않았습니다.', ['state.state', 'currentEvidenceSha', 'contract.acceptance'])],
    improvements: [item('CONTINUE_ONLY_LOCKED_SCOPE', '잠긴 범위만 구현하고 현재 Git 상태에서 필수 검증을 갱신합니다.', ['contract.scope', 'contract.acceptance', 'baselineSha'])],
    nextPlan: [item('PLAN_IMPLEMENT_LOCKED_WORK', '승인된 범위의 남은 작업만 진행합니다.', ['contract.scope']), item('PLAN_RUN_REQUIRED_CHECKS', '필수 완료조건을 실행하고 Shipping 검증을 갱신합니다.', ['contract.acceptance']), item('PLAN_FIX_BLOCKERS_ONLY', '실패하면 릴리스 차단 문제만 수정하고 선택적 개선은 미룹니다.', ['issues.items', 'contract.budgets.maxFixCycles'])],
    summary: item('SUMMARY_RUNNING', '새 기능을 추가하지 않고 현재 버전을 닫는 데 필요한 작업만 진행합니다.', ['state.state', 'contract.scope']),
  };
}

function buildBriefSections(input, state, blockerCount, unknownCount) {
  if (['PLANNING', 'NEEDS_INPUT', 'DIRTY_BASELINE', 'NEEDS_ACCEPTANCE', 'READY_FOR_APPROVAL', 'SUPERSEDED', 'EXPIRED'].includes(state)) {
    return proposalBrief(input, state);
  }
  return activeReleaseBrief(input, state, blockerCount, unknownCount);
}

function sectionItems(value, limit = MAX_SECTION_ITEMS) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : [];
}

function uniqueTexts(items) {
  const texts = items.map((entry) => entry?.text).filter(Boolean);
  return new Set(texts).size === texts.length;
}

/**
 * @param {PlainBrief} brief
 * @returns {PlainBriefQuality}
 */
export function auditPlainBrief(brief) {
  const sections = [brief.problems, brief.improvements, brief.nextPlan];
  const allItems = [...sections.flat(), brief.summary].filter(Boolean);
  const rendered = typeof brief.renderedText === 'string' ? brief.renderedText : renderPlainBrief(brief);
  const checks = {
    requiredSections: sections.every((section) => Array.isArray(section) && section.length > 0)
      && typeof brief.summary?.text === 'string' && brief.summary.text.length > 0,
    oneNextAction: typeof brief.actionEnvelope?.nextAction === 'string'
      && brief.actionEnvelope.nextAction.length > 0
      && typeof brief.userAction?.code === 'string'
      && brief.userAction.code === brief.actionEnvelope.nextAction,
    stateConsistent: brief.state === brief.actionEnvelope?.currentState,
    evidenceBound: allItems.every((entry) => typeof entry?.code === 'string'
      && entry.code.length > 0
      && Array.isArray(entry.evidenceRefs)
      && entry.evidenceRefs.length > 0),
    uniqueItems: uniqueTexts(allItems),
    mechanicalAuthority: (brief.factGraph?.facts ?? []).filter((entry) => entry.authority !== 'model-advisory')
      .every((entry) => entry.authority === 'mechanical' && entry.evidenceRefs?.length > 0),
    boundedOutput: Buffer.byteLength(JSON.stringify(brief)) <= MAX_RENDERED_BYTES
      && Buffer.byteLength(rendered) <= MAX_RENDERED_BYTES,
    noDestructiveDefault: !['reset', 'stash', 'discard', 'delete', '폐기', '삭제', '되돌리'].some((word) => rendered.toLowerCase().includes(word))
      || brief.state === 'DIRTY_BASELINE' && rendered.includes('삭제하거나 되돌리지 않고'),
    verificationIndependent: !(brief.factGraph?.facts ?? []).some((entry) => entry.authority === 'model-advisory' && /acceptance|verify|closed|approval/u.test(entry.code.toLowerCase())),
    releaseTrainSafe: !brief.releaseTrain || (brief.releaseTrain.modelAuthority === false
      && brief.releaseTrain.currentRelease === brief.release
      && brief.releaseTrain.steps.filter((entry) => entry.current).length === 1),
  };
  return {
    schema: 'shipping-harness/plain-brief-quality-v1',
    healthy: Object.values(checks).every(Boolean),
    checks,
    renderedBytes: Buffer.byteLength(rendered),
    structuredBytes: Buffer.byteLength(JSON.stringify(brief)),
    maxBytes: MAX_RENDERED_BYTES,
  };
}

function markdownList(items) {
  return items.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n');
}

function renderReleaseTrain(train) {
  if (!train) return [];
  return [
    '## 전체 개발계획',
    '',
    ...train.steps.map((release, index) => `${index + 1}. **v${release.version}${release.current ? ' — 현재 단계' : ''}**: ${release.value}`),
    '',
  ];
}

/**
 * @param {PlainBrief} brief
 * @returns {string}
 */
export function renderPlainBrief(brief) {
  const action = brief.userAction?.exactPhrase
    ? `> **${brief.userAction.exactPhrase}**`
    : brief.userAction?.label ?? '현재 상태를 확인하세요.';
  return [
    '## 현재 상태',
    '',
    `**${brief.headline}**`,
    '',
    ...renderReleaseTrain(brief.releaseTrain),
    '## 문제점',
    '',
    markdownList(brief.problems ?? []),
    '',
    '## 개선안',
    '',
    markdownList(brief.improvements ?? []),
    '',
    '## 다음 진행 플랜',
    '',
    markdownList(brief.nextPlan ?? []),
    '',
    '## 요약',
    '',
    brief.summary?.text ?? '현재 상태를 다시 확인하세요.',
    '',
    '## 지금 할 일',
    '',
    action,
  ].join('\n').trim();
}

/**
 * @param {PlainBriefInput} [input]
 * @returns {PlainBrief}
 */
export function compilePlainBrief(input = {}) {
  const state = normalizedState(input);
  const blockerCount = normalizedCount(input.blockerCount ?? input.issues?.counts?.BLOCKER ?? input.state?.blockerCount);
  const unknownCount = normalizedCount(input.unknownCount ?? input.issues?.counts?.UNKNOWN ?? input.state?.unknownCount ?? countFrom(input, 'UNKNOWN'));
  const actionEnvelope = buildActionEnvelope({ ...input, state, blockerCount });
  const factGraph = buildBriefFactGraph({ ...input, state, blockerCount, unknownCount }, actionEnvelope);
  const sections = buildBriefSections(input, state, blockerCount, unknownCount);
  const body = {
    schema: 'shipping-harness/plain-brief-v1',
    language: 'ko',
    state,
    release: input.release ?? input.contract?.release ?? input.state?.release ?? null,
    releaseTrain: buildReleaseTrainBrief(input.releaseTrain),
    headline: sections.headline,
    problems: sectionItems(sections.problems),
    improvements: sectionItems(sections.improvements),
    nextPlan: sectionItems(sections.nextPlan, MAX_PLAN_STEPS),
    summary: sections.summary,
    userAction: {
      code: actionEnvelope.nextAction,
      label: actionEnvelope.userActionLabel,
      exactPhrase: actionEnvelope.exactUserPhrase,
      requiresHumanApproval: actionEnvelope.requiresHumanApproval,
    },
    details: {
      available: true,
      evidenceRefs: evidenceRefs([
        'canonicalState',
        input.baseline ? 'baseline' : null,
        input.intelligence ?? input.analysis?.intelligence ? 'intelligence' : null,
        input.contract ? 'contract' : null,
        input.releaseTrain ? 'releaseTrain' : null,
        input.goalCharter && (state === 'READY_FOR_APPROVAL' || input.goalCharter.status === 'ACCEPTED') ? 'goalCharter' : null,
        input.issues ? 'issues' : null,
        typeof input.evidenceFresh === 'boolean' ? 'evidenceFresh' : null,
      ]),
      exactPathsInDefaultText: false,
    },
    actionEnvelope,
    factGraph,
    advisory: input.intelligence?.goalRecommendation ?? input.analysis?.intelligence?.goalRecommendation ?? null,
    modelAuthority: false,
  };
  const hash = hashObject(body);
  const provisional = { ...body, hash };
  const renderedText = renderPlainBrief(provisional);
  const textHash = hashObject({ renderedText });
  const withText = { ...provisional, renderedText, textHash };
  const quality = auditPlainBrief(withText);
  return { ...withText, quality };
}

/**
 * @param {PlainBriefInput} [input]
 * @param {(input: PlainBriefInput) => PlainBrief} [compiler]
 * @returns {{plainBrief: PlainBrief|null, error: {code: string, message: string, quality?: PlainBriefQuality|null}|null}}
 */
export function compilePlainBriefSafe(input = {}, compiler = compilePlainBrief) {
  try {
    const plainBrief = compiler(input);
    if (plainBrief.quality?.healthy !== true) {
      return {
        plainBrief: null,
        error: {
          code: 'PLAIN_BRIEF_QUALITY_FAILED',
          message: 'The deterministic beginner projection failed its quality gate; raw Shipping authority remains available.',
          quality: plainBrief.quality ?? null,
        },
      };
    }
    return { plainBrief, error: null };
  } catch (error) {
    return {
      plainBrief: null,
      error: {
        code: 'PLAIN_BRIEF_RENDER_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export const PLAIN_BRIEF_LIMITS = Object.freeze({
  maxSectionItems: MAX_SECTION_ITEMS,
  maxPlanSteps: MAX_PLAN_STEPS,
  maxEvidenceRefs: MAX_EVIDENCE_REFS,
  maxBytes: MAX_RENDERED_BYTES,
});
