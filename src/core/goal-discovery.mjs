import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';

export const GOAL_DISCOVERY = Object.freeze({
  schema: 'shipping-harness/goal-discovery-v1',
  maxQuestions: 3,
  maxRounds: 2,
  maxCandidates: 3,
  modelAuthority: false,
});

const GENERIC_GOAL = /^(?:이\s*)?(?:프로젝트|서비스|앱|프로그램)?(?:를|을)?\s*(?:완성|개선|고도화|개발|정리|마무리)(?:해|해줘|해주세요)?[.!]?$/iu;
const BROAD_DIRECTION = /\b(?:finish|complete|improve|make\s+.*(?:ready|usable|operable)|product|project)\b|완성|실사용|운영\s*가능|사용\s*가능|쓸\s*수|고도화|프로젝트|제품/iu;
const SPECIFIC_DELIVERY = /\b(?:bug|fix|endpoint|api|cli|function|method|button|screen|login|auth|test|package|script|command|field|schema|migration|release|flow|workflow|runtime)\b|버그|오류|엔드포인트|기능|함수|버튼|화면|로그인|인증|테스트|패키지|스크립트|명령|필드|스키마|마이그레이션|릴리스|흐름|워크플로|런타임/iu;
const AUDIENCE = /\b(?:user|users|operator|operators|admin|team|employee|customer|customers|developer|developers|internal staff|personal)\b|사용자|운영자|관리자|팀|직원|고객|개발자|개인|내부/iu;
const BOUNDARY = /\b(?:local|personal|internal|company|private|public|production|customer-facing|saas|external)\b|로컬|개인|회사\s*내부|내부용|공개|운영\s*환경|프로덕션|고객용|외부/iu;
const CONFLICT = /\b(?:either|choose between)\b|\b[^.]{1,80}\s+or\s+[^.]{1,80}\b|또는|중\s*하나|둘\s*중/iu;
const TECHNICAL_QUESTION = /\b(?:framework|library|database table|file path|command|shell|package manager|programming language)\b|프레임워크|라이브러리|DB\s*테이블|데이터베이스\s*테이블|파일\s*경로|명령어|셸|패키지\s*매니저|프로그래밍\s*언어/iu;

function text(value, max = 2000) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(normalized.length > 0 && normalized.length <= max, 'ERR_GOAL_DISCOVERY', `Text must be between 1 and ${max} characters`);
  return normalized;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolutionMap(resolutions = []) {
  return new Map(resolutions
    .filter((entry) => entry && typeof entry.questionId === 'string' && typeof entry.choice === 'string')
    .map((entry) => [entry.questionId, entry]));
}

function explicitValue(resolutions, id, fallback) {
  const resolution = resolutions.get(id);
  return resolution?.choice?.trim() || fallback;
}

function recommendedOutcome(evidence) {
  const recommendation = evidence.intelligence?.goalRecommendation?.text;
  if (typeof recommendation === 'string' && recommendation.trim()) return recommendation.trim().slice(0, 1000);
  const workspace = evidence.analysis?.workspace?.root ?? '.';
  return `Preserve current behavior and deliver the smallest verified core workflow in ${workspace}.`;
}

function question(id, category, prompt, recommendedChoice, evidenceRefs) {
  invariant(!TECHNICAL_QUESTION.test(prompt), 'ERR_TECHNICAL_INTERVIEW', `Technical implementation question is forbidden: ${prompt}`);
  return {
    id,
    category,
    prompt,
    recommendedChoice,
    riskIds: [],
    evidenceRefs: unique(evidenceRefs).slice(0, 8),
    authority: 'mechanical-question',
  };
}

function hasMaterialProductDiscovery(goal) {
  const trimmed = goal.trim();
  if (GENERIC_GOAL.test(trimmed)) return true;
  if (CONFLICT.test(trimmed)) return true;
  return trimmed.length < 45 && BROAD_DIRECTION.test(trimmed) && !SPECIFIC_DELIVERY.test(trimmed);
}

function buildQuestions(evidence, resolutions) {
  const goal = evidence.goal;
  const broad = hasMaterialProductDiscovery(goal);
  const questions = [];
  if (CONFLICT.test(goal) && !resolutions.has('Q-GOAL-001')) {
    questions.push(question(
      'Q-GOAL-001',
      'core-direction',
      '서로 다른 방향이 함께 보입니다. 이번 프로젝트에서 가장 먼저 완성해야 할 한 가지 결과는 무엇입니까?',
      recommendedOutcome(evidence),
      ['EVID-001', 'EVID-010'],
    ));
  } else if (broad && !resolutions.has('Q-GOAL-001') && (GENERIC_GOAL.test(goal.trim()) || goal.trim().length < 45)) {
    questions.push(question(
      'Q-GOAL-001',
      'primary-outcome',
      '이 프로젝트가 완성됐을 때 사용자가 가장 먼저 할 수 있어야 하는 한 가지는 무엇입니까?',
      recommendedOutcome(evidence),
      ['EVID-001', 'EVID-010'],
    ));
  }
  if (broad && !AUDIENCE.test(goal) && !resolutions.has('Q-GOAL-002')) {
    questions.push(question(
      'Q-GOAL-002',
      'primary-user',
      '누가 이 결과를 가장 먼저 사용합니까?',
      '현재 저장소의 기존 사용자와 회사 내부 운영자를 우선합니다.',
      ['EVID-001', 'EVID-003', 'EVID-010'],
    ));
  }
  if (broad && !BOUNDARY.test(goal) && !resolutions.has('Q-GOAL-003')) {
    questions.push(question(
      'Q-GOAL-003',
      'operating-boundary',
      '이번 완성 범위는 어디까지입니까?',
      '로컬·회사 내부에서 되돌릴 수 있는 운영까지 완료하고 외부 배포는 별도 승인으로 분리합니다.',
      ['EVID-001', 'EVID-006'],
    ));
  }
  return questions.slice(0, GOAL_DISCOVERY.maxQuestions);
}

function primaryUser(goal, resolutions) {
  if (resolutions.has('Q-GOAL-002')) return explicitValue(resolutions, 'Q-GOAL-002', '현재 사용자');
  if (/customer|고객/iu.test(goal)) return '고객 사용자';
  if (/developer|개발자/iu.test(goal)) return '개발자';
  if (/operator|admin|운영자|관리자/iu.test(goal)) return '내부 운영자';
  if (/team|employee|직원|팀/iu.test(goal)) return '회사 내부 팀';
  return '현재 저장소의 기존 사용자와 내부 운영자';
}

function operatingBoundary(goal, resolutions) {
  if (resolutions.has('Q-GOAL-003')) return explicitValue(resolutions, 'Q-GOAL-003', 'LOCAL_INTERNAL');
  if (/public|saas|공개|고객용/iu.test(goal)) return 'EXTERNAL_REQUIRES_SEPARATE_APPROVAL';
  if (/production|프로덕션|운영\s*환경/iu.test(goal)) return 'PRODUCTION_REQUIRES_SEPARATE_APPROVAL';
  if (/internal|company|private|회사\s*내부|내부용/iu.test(goal)) return 'COMPANY_INTERNAL';
  if (/local|personal|로컬|개인/iu.test(goal)) return 'LOCAL_PERSONAL';
  return 'LOCAL_COMPANY_INTERNAL';
}

function directionOutcome(evidence, resolutions) {
  return explicitValue(resolutions, 'Q-GOAL-001', evidence.goal);
}

function candidate(id, type, body) {
  const value = {
    id,
    type,
    outcome: text(body.outcome, 2000),
    primaryUser: text(body.primaryUser, 1000),
    operatingBoundary: text(body.operatingBoundary, 1000),
    value: text(body.value, 1600),
    include: unique(body.include).slice(0, 8),
    nonGoals: unique(body.nonGoals).slice(0, 8),
    successCriteria: unique(body.successCriteria).slice(0, 8),
    risks: unique(body.risks).slice(0, 8),
    rollback: text(body.rollback, 1000),
    replanTriggers: unique(body.replanTriggers).slice(0, 8),
    evidenceRefs: unique(body.evidenceRefs).slice(0, 12),
    confidence: body.confidence,
    reversibility: body.reversibility,
    authority: 'advisory-until-direction-ready',
    commandAuthority: false,
    modelAuthority: false,
  };
  return { ...value, hash: hashObject(value) };
}

function candidatesFor(evidence, resolutions) {
  const goal = directionOutcome(evidence, resolutions);
  const user = primaryUser(evidence.goal, resolutions);
  const boundary = operatingBoundary(evidence.goal, resolutions);
  const hasDirty = (evidence.baseline?.blockingCount ?? 0) > 0;
  const hasOperations = evidence.operationalSurface?.detectedPaths?.length > 0 || /operat|deploy|health|recover|운영|배포|복구/iu.test(evidence.goal);
  const acceptance = evidence.analysis?.candidateCommands ?? [];
  const common = {
    primaryUser: user,
    operatingBoundary: boundary,
    nonGoals: [
      '핵심 가치와 무관한 기능 확장',
      '자동 외부 배포',
      '데이터·인증·보안·비용 영향의 무승인 실행',
      '현재 버전을 끝없이 진화시키는 반복',
      'Paperthin 전체 런타임 또는 스킬 카탈로그 의존',
    ],
    successCriteria: [
      acceptance.length > 0 ? '저장소가 소유한 필수 검증 명령이 통과한다.' : '검증 가능한 완료조건을 먼저 추가한다.',
      'BLOCKER와 UNKNOWN이 0이다.',
      '현재 Git SHA와 완료 증거가 일치한다.',
    ],
    risks: [hasDirty ? '기존 작업과 새 작업이 섞일 수 있다.' : '범위가 핵심 가치보다 커질 수 있다.'],
    rollback: '현재 Git 기준선과 Shipping 영수증으로 되돌릴 수 있어야 한다.',
    replanTriggers: ['핵심 사용자 가치 변경', '완료조건 약화 필요', '외부·데이터·인증·보안·비용 영향 발견', '저장소 구조와 계획의 중대한 불일치'],
    evidenceRefs: ['EVID-001', 'EVID-002', 'EVID-004', 'EVID-006', 'EVID-010'],
  };
  const output = [];
  if (hasDirty) {
    output.push(candidate('DIR-001', 'PRESERVE_AND_STABILIZE', {
      ...common,
      outcome: goal,
      value: '기존 작업을 잃지 않고 검증 가능한 기준선으로 분리해 다음 개발이 안전하게 시작되게 한다.',
      include: ['기존 제품 변경 기준선 보존', '검증·릴리스 증거 정리', '동일 제안 재검사'],
      confidence: 'high',
      reversibility: 'reversible',
    }));
  }
  output.push(candidate(`DIR-${String(output.length + 1).padStart(3, '0')}`, 'DELIVER_CORE_WORKFLOW', {
    ...common,
    outcome: goal,
    value: '가장 중요한 사용자 흐름 하나를 현재 스택과 실제 완료조건으로 끝까지 제공한다.',
    include: ['핵심 사용자 흐름', '오류 처리', '현재 저장소 검증', '관련 운영 설명'],
    confidence: evidence.intelligence?.acceptanceCoverage?.complete === true ? 'high' : 'medium',
    reversibility: 'reversible',
  }));
  if (hasOperations || hasMaterialProductDiscovery(evidence.goal)) {
    output.push(candidate(`DIR-${String(output.length + 1).padStart(3, '0')}`, 'OPERATE_AND_RECOVER', {
      ...common,
      outcome: goal,
      value: '핵심 흐름뿐 아니라 설치·상태 확인·복구 경계까지 내부 운영 가능한 형태로 완성한다.',
      include: ['핵심 사용자 흐름', '설치·실행', '상태 확인', 'Rollback·복구'],
      confidence: hasOperations ? 'medium' : 'low',
      reversibility: 'conditionally-reversible',
    }));
  }
  return output.slice(0, GOAL_DISCOVERY.maxCandidates);
}

function selectCandidate(candidates, evidence) {
  if ((evidence.baseline?.blockingCount ?? 0) > 0) return candidates.find((entry) => entry.type === 'PRESERVE_AND_STABILIZE') ?? candidates[0];
  return candidates.find((entry) => entry.type === 'DELIVER_CORE_WORKFLOW') ?? candidates[0];
}

function criticFor(evidence, questions, candidates, selected, round) {
  const findings = [];
  if (questions.length > 0) findings.push({ code: 'UNRESOLVED_MATERIAL_QUESTIONS', severity: 'high', blocking: true, evidenceRefs: ['goalDiscovery.questions'] });
  if (!selected || selected.evidenceRefs.length === 0) findings.push({ code: 'MISSING_DIRECTION_EVIDENCE', severity: 'critical', blocking: true, evidenceRefs: ['goalDiscovery.candidates'] });
  if ((evidence.analysis?.candidateCommands ?? []).length === 0) findings.push({ code: 'ACCEPTANCE_REQUIRES_STRENGTHENING', severity: 'medium', blocking: false, evidenceRefs: ['EVID-004'] });
  if (/public|production|customer|공개|프로덕션|고객/iu.test(selected?.operatingBoundary ?? '') || /public|production|customer|공개|프로덕션|고객/iu.test(evidence.goal)) {
    findings.push({ code: 'EXTERNAL_CONSEQUENCE_REQUIRES_SEPARATE_APPROVAL', severity: 'high', blocking: false, evidenceRefs: ['EVID-001', 'goalDiscovery.direction.operatingBoundary'] });
  }
  const blockers = findings.filter((entry) => entry.blocking).length;
  const status = blockers === 0 ? 'PASS' : round >= GOAL_DISCOVERY.maxRounds ? 'STOP' : 'NEEDS_INPUT';
  const body = {
    schema: 'shipping-harness/direction-critic-v1',
    status,
    findings,
    blockerCount: blockers,
    modelAuthority: false,
  };
  return { ...body, hash: hashObject(body) };
}

function directionFor(evidence, selected, critic, questions) {
  if (!selected || critic.status !== 'PASS' || questions.length > 0) return null;
  const body = {
    schema: 'shipping-harness/accepted-direction-v1',
    id: `DIRECTION-${selected.hash.slice(0, 12)}`,
    selectedCandidateId: selected.id,
    explicitGoal: evidence.goal,
    outcome: selected.outcome,
    primaryUser: selected.primaryUser,
    operatingBoundary: selected.operatingBoundary,
    value: selected.value,
    include: selected.include,
    nonGoals: selected.nonGoals,
    successCriteria: selected.successCriteria,
    rollback: selected.rollback,
    replanTriggers: selected.replanTriggers,
    evidenceRefs: selected.evidenceRefs,
    candidateHash: selected.hash,
    criticHash: critic.hash,
    commandAuthority: false,
    approvalAuthority: false,
    closureAuthority: false,
    released: false,
    modelAuthority: false,
  };
  return { ...body, hash: hashObject(body) };
}

/**
 * @typedef {{id: string, category: string, prompt: string, recommendedChoice: string}} DiscoveryQuestion
 * @typedef {{id: string, type: string, value: string, confidence: string, modelAuthority: boolean, commandAuthority: boolean}} DirectionCandidate
 * @typedef {{status: string, blockerCount: number, findings: unknown[], modelAuthority: boolean}} DirectionCritic
 * @typedef {{id: string, outcome: string, primaryUser: string, operatingBoundary: string, nonGoals: string[], successCriteria: string[], replanTriggers: string[], hash: string, modelAuthority: boolean, commandAuthority: boolean, approvalAuthority: boolean, closureAuthority: boolean, released: boolean}} AcceptedDirection
 * @typedef {{questionId: string, category: string|null, choice: string, recommendedChoice: string|null, usedRecommendedChoice: boolean, authority: string}} DiscoveryResolution
 * @typedef {{schema: string, evidenceHash: string, gitSha: string, explicitGoal: string, round: number, maxRounds: number, status: string, questions: DiscoveryQuestion[], resolutions: DiscoveryResolution[], candidates: DirectionCandidate[], recommendedCandidateId: string|null, critic: DirectionCritic, direction: AcceptedDirection|null, nextAction: string, questionPolicy: string, modelAuthority: boolean, hash: string}} GoalDiscovery
 */

/**
 * @param {GoalDiscovery} input
 * @returns {GoalDiscovery}
 */
export function validateGoalDiscovery(input) {
  invariant(input?.schema === GOAL_DISCOVERY.schema, 'ERR_GOAL_DISCOVERY_SCHEMA', 'Unsupported goal discovery schema');
  invariant(['READY', 'NEEDS_INPUT', 'STOP'].includes(input.status), 'ERR_GOAL_DISCOVERY_STATUS', `Unsupported goal discovery status: ${String(input?.status)}`);
  invariant(Number.isInteger(input.round) && input.round >= 1 && input.round <= GOAL_DISCOVERY.maxRounds, 'ERR_GOAL_DISCOVERY_ROUND', 'Goal discovery round is outside the bounded range');
  invariant(Array.isArray(input.questions) && input.questions.length <= GOAL_DISCOVERY.maxQuestions, 'ERR_GOAL_DISCOVERY_QUESTIONS', 'Goal discovery has too many questions');
  invariant(Array.isArray(input.candidates) && input.candidates.length >= 1 && input.candidates.length <= GOAL_DISCOVERY.maxCandidates, 'ERR_GOAL_DISCOVERY_CANDIDATES', 'Goal discovery candidate count is invalid');
  invariant(input.modelAuthority === false, 'ERR_GOAL_DISCOVERY_AUTHORITY', 'Host model cannot be goal-discovery authority');
  invariant(input.critic?.modelAuthority === false, 'ERR_GOAL_DISCOVERY_AUTHORITY', 'Direction critic cannot grant model authority');
  invariant(input.candidates.every((entry) => entry.modelAuthority === false && entry.commandAuthority === false), 'ERR_GOAL_DISCOVERY_AUTHORITY', 'Direction candidates cannot grant model or command authority');
  invariant(input.direction === null || (input.direction.modelAuthority === false
    && input.direction.commandAuthority === false
    && input.direction.approvalAuthority === false
    && input.direction.closureAuthority === false
    && input.direction.released === false), 'ERR_GOAL_DISCOVERY_AUTHORITY', 'Accepted direction cannot grant execution, approval, closure, release, or model authority');
  for (const entry of input.questions) {
    invariant(!TECHNICAL_QUESTION.test(entry.prompt), 'ERR_TECHNICAL_INTERVIEW', `Technical implementation question is forbidden: ${entry.prompt}`);
    invariant(typeof entry.recommendedChoice === 'string' && entry.recommendedChoice.trim(), 'ERR_GOAL_DISCOVERY_DEFAULT', `${entry.id} is missing a recommended choice`);
  }
  const { hash: _hash, ...body } = input;
  invariant(input.hash === hashObject(body), 'ERR_GOAL_DISCOVERY_HASH', 'Goal discovery hash does not match its content');
  invariant(Buffer.byteLength(stableStringify(input)) <= 96 * 1024, 'ERR_GOAL_DISCOVERY_SIZE', 'Goal discovery exceeds the bounded size');
  return input;
}

/**
 * @param {Record<string, any>} evidence
 * @param {{resolutions?: Array<Record<string, any>>, round?: number}} [options]
 * @returns {GoalDiscovery}
 */
export function compileGoalDiscovery(evidence, options = {}) {
  invariant(evidence && typeof evidence === 'object' && /^[a-f0-9]{64}$/u.test(evidence.hash ?? '')
    && /^[a-f0-9]{40}$/u.test(evidence.gitSha ?? '') && typeof evidence.goal === 'string',
  'ERR_GOAL_DISCOVERY_EVIDENCE', 'Goal discovery requires current decision evidence');
  const resolutions = resolutionMap(options.resolutions ?? []);
  const round = Math.min(GOAL_DISCOVERY.maxRounds, Math.max(1, Number.isInteger(options.round) ? /** @type {number} */ (options.round) : 1));
  const questions = buildQuestions(evidence, resolutions);
  const candidates = candidatesFor(evidence, resolutions);
  const selected = selectCandidate(candidates, evidence);
  const critic = criticFor(evidence, questions, candidates, selected, round);
  const direction = directionFor(evidence, selected, critic, questions);
  const body = {
    schema: GOAL_DISCOVERY.schema,
    evidenceHash: evidence.hash,
    gitSha: evidence.gitSha,
    explicitGoal: evidence.goal,
    round,
    maxRounds: GOAL_DISCOVERY.maxRounds,
    status: critic.status === 'STOP' ? 'STOP' : questions.length > 0 ? 'NEEDS_INPUT' : 'READY',
    questions,
    resolutions: [...resolutions.values()].map((entry) => ({
      questionId: entry.questionId,
      category: entry.category ?? null,
      choice: entry.choice,
      recommendedChoice: entry.recommendedChoice ?? null,
      usedRecommendedChoice: entry.usedRecommendedChoice === true,
      authority: entry.authority ?? 'explicit-user-refinement',
    })).sort((a, b) => a.questionId.localeCompare(b.questionId)),
    candidates,
    recommendedCandidateId: selected?.id ?? null,
    critic,
    direction,
    nextAction: questions.length > 0 ? 'ANSWER_MATERIAL_QUESTION' : critic.status === 'STOP' ? 'STOP' : 'BUILD_RELEASE_TRAIN',
    questionPolicy: 'product-outcome-only-no-technical-interrogation',
    modelAuthority: false,
  };
  return validateGoalDiscovery({ ...body, hash: hashObject(body) });
}

/**
 * @param {{questions?: DiscoveryQuestion[]}} decision
 * @param {GoalDiscovery} discovery
 * @param {number} [limit]
 * @returns {DiscoveryQuestion[]}
 */
export function mergeGoalDiscoveryQuestions(decision, discovery, limit = GOAL_DISCOVERY.maxQuestions) {
  const existing = Array.isArray(decision.questions) ? decision.questions : [];
  const ids = new Set(existing.map((entry) => entry.id));
  const merged = [...existing];
  for (const entry of discovery.questions) {
    if (merged.length >= limit) break;
    if (!ids.has(entry.id)) merged.push(entry);
  }
  return merged;
}

/**
 * @param {GoalDiscovery} discovery
 * @returns {{status: string, round: number, questions: DiscoveryQuestion[], candidates: Array<{id: string, type: string, value: string, confidence: string}>, recommendedCandidateId: string|null, critic: {status: string, blockerCount: number, findings: unknown[]}, direction: {id: string, outcome: string, primaryUser: string, operatingBoundary: string, nonGoals: string[], successCriteria: string[], replanTriggers: string[], hash: string}|null, nextAction: string, modelAuthority: boolean, hash: string}}
 */
export function goalDiscoverySummary(discovery) {
  validateGoalDiscovery(discovery);
  return {
    status: discovery.status,
    round: discovery.round,
    questions: discovery.questions.map((entry) => ({ id: entry.id, category: entry.category, prompt: entry.prompt, recommendedChoice: entry.recommendedChoice })),
    candidates: discovery.candidates.map((entry) => ({ id: entry.id, type: entry.type, value: entry.value, confidence: entry.confidence })),
    recommendedCandidateId: discovery.recommendedCandidateId,
    critic: { status: discovery.critic.status, blockerCount: discovery.critic.blockerCount, findings: discovery.critic.findings },
    direction: discovery.direction ? {
      id: discovery.direction.id,
      outcome: discovery.direction.outcome,
      primaryUser: discovery.direction.primaryUser,
      operatingBoundary: discovery.direction.operatingBoundary,
      nonGoals: discovery.direction.nonGoals,
      successCriteria: discovery.direction.successCriteria,
      replanTriggers: discovery.direction.replanTriggers,
      hash: discovery.direction.hash,
    } : null,
    nextAction: discovery.nextAction,
    modelAuthority: false,
    hash: discovery.hash,
  };
}
