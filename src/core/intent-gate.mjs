import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';

export const INTENT_GATE = Object.freeze({
  schema: 'https://shipping-harness.local/schemas/v1/intent-gate.schema.json',
  questionId: 'Q-INTENT-001',
  defaultMode: 'ANALYZE_ONLY',
  modes: Object.freeze(['ANALYZE_ONLY', 'PLAN_ONLY', 'IMPLEMENT', 'AUTOPILOT']),
  statuses: Object.freeze(['CONFIRMATION_REQUIRED', 'CONFIRMED']),
  modelAuthority: false,
});

const AUTOPILOT = /\b(?:autopilot|closed|finish\s+everything|complete\s+end[- ]to[- ]end)\b|오토파일럿|끝까지|완성(?:해|해줘|해주세요|까지)|개발\s*완료|구현\s*완료|종료까지|닫을\s*때까지|자동으로\s*(?:진행|완성)/iu;
const PLAN_ONLY = /\b(?:plan|planning|roadmap|design|proposal)\b|기획|계획|로드맵|설계|제안(?:해|해줘|해주세요)?/iu;
const IMPLEMENT = /\b(?:implement|develop|build|fix|patch|package|code|add|remove|refactor|ship|deliver|finish|complete|preserve|verify|harden|deploy|publish|write|migrate|prepare|make|run|execute)\b|개발(?:해|해줘|해주세요)?|구현(?:해|해줘|해주세요)?|수정(?:해|해줘|해주세요)?|완료(?:한다|해|해줘|해주세요)?|완성한다|검증(?:해|해줘|해주세요)?|배포(?:해|해줘|해주세요)?|고쳐|만들어|추가(?:해|해줘)|제거(?:해|해줘)|리팩터/iu;
const ANALYZE = /\b(?:analy[sz]e|inspect|review|explain|check|understand)\b|분석|확인|검토|설명|파악|진단/iu;
const ANALYZE_ONLY = /\b(?:analysis\s+only|read[- ]only|do\s+not\s+(?:change|edit|implement|develop))\b|분석(?:만|\s*결과만)|확인만|검토만|설명만|읽기\s*전용|코드\s*(?:수정|변경)하지\s*마|개발하지\s*마|구현하지\s*마|아직\s*(?:개발|구현)(?:은|을)?\s*(?:시작하지|하지)\s*마/iu;
const PLAN_BOUNDARY = /\b(?:plan\s+only|do\s+not\s+implement|before\s+implementation)\b|계획(?:까지만|만)|기획(?:까지만|만)|아직\s*(?:개발|구현)(?:은|을)?\s*(?:시작하지|하지)\s*마/iu;

function normalizedText(value, max = 4000) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(result.length > 0 && result.length <= max, 'ERR_INTENT_GATE_TEXT', `Intent text must be between 1 and ${max} characters`);
  return result;
}

function inferRequestMode(requestText) {
  const request = normalizedText(requestText);
  if (AUTOPILOT.test(request)) return { mode: 'AUTOPILOT', explicit: true, reason: 'explicit-autopilot-delivery' };
  if (PLAN_ONLY.test(request) && PLAN_BOUNDARY.test(request)) return { mode: 'PLAN_ONLY', explicit: true, reason: 'explicit-plan-boundary' };
  if (ANALYZE_ONLY.test(request)) return { mode: 'ANALYZE_ONLY', explicit: true, reason: 'explicit-analysis-boundary' };
  if (IMPLEMENT.test(request) && !PLAN_ONLY.test(request)) return { mode: 'IMPLEMENT', explicit: true, reason: 'explicit-implementation' };
  if (PLAN_ONLY.test(request)) return { mode: 'PLAN_ONLY', explicit: true, reason: 'explicit-planning' };
  if (ANALYZE.test(request)) return { mode: 'ANALYZE_ONLY', explicit: false, reason: 'analysis-request-needs-workflow-boundary' };
  return { mode: INTENT_GATE.defaultMode, explicit: false, reason: 'ambiguous-request-default-analysis' };
}

function choiceMode(value) {
  const raw = normalizedText(value, 1000);
  invariant(!/승인\s*없이|무승인|권한\s*우회|자동\s*배포|production[_\s-]*release/iu.test(raw), 'ERR_INTENT_GATE_CHOICE', `Unsupported workflow intent choice: ${raw}`);
  const upper = raw.toUpperCase().replace(/[\s-]+/gu, '_');
  if (['ANALYZE_ONLY', 'ANALYSIS_ONLY', '1', '1번'].includes(upper) || /^1(?:번)?[.)\s]/u.test(raw) || /분석(?:만|\s*결과만)/u.test(raw)) return 'ANALYZE_ONLY';
  if (['PLAN_ONLY', 'PLANNING_ONLY', '2', '2번'].includes(upper) || /^2(?:번)?[.)\s]/u.test(raw) || /(?:계획|기획)(?:까지만|만)/u.test(raw)) return 'PLAN_ONLY';
  if (['IMPLEMENT', 'IMPLEMENTATION', '3', '3번'].includes(upper) || /^3(?:번)?[.)\s]/u.test(raw) || /(?:구현|개발)(?:까지|해|진행)/u.test(raw)) return 'IMPLEMENT';
  if (['AUTOPILOT', 'AUTO_PILOT', '4', '4번'].includes(upper) || /^4(?:번)?[.)\s]/u.test(raw) || /(?:완성|종료|CLOSED).*까지|끝까지|오토파일럿/u.test(raw)) return 'AUTOPILOT';
  invariant(false, 'ERR_INTENT_GATE_CHOICE', `Unsupported workflow intent choice: ${raw}`);
}

function resolutionFor(resolutions = []) {
  return resolutions.find((entry) => entry?.questionId === INTENT_GATE.questionId && typeof entry.choice === 'string') ?? null;
}

function workflowQuestion() {
  return {
    id: INTENT_GATE.questionId,
    category: 'workflow-boundary',
    prompt: '읽기 전용 프로젝트 분석은 완료했습니다. 어디까지 진행할까요? 1. 분석 결과만 2. 다음 버전 계획까지 3. 승인 후 구현까지 4. 정책 범위 안에서 검증·CLOSED까지',
    recommendedChoice: INTENT_GATE.defaultMode,
    choices: [
      { mode: 'ANALYZE_ONLY', label: '1. 분석 결과만 보여줘' },
      { mode: 'PLAN_ONLY', label: '2. 다음 운영 가능한 버전 계획까지 만들어줘' },
      { mode: 'IMPLEMENT', label: '3. 목표를 확인한 뒤 승인된 범위를 구현해' },
      { mode: 'AUTOPILOT', label: '4. 목표를 확인한 뒤 정책 범위 안에서 검증·CLOSED까지 진행해' },
    ],
    riskIds: [],
    evidenceRefs: ['user.goal', 'analysis'],
    authority: 'mechanical-question',
  };
}

export function validateIntentGate(input) {
  invariant(input?.schema === INTENT_GATE.schema, 'ERR_INTENT_GATE_SCHEMA', 'Unsupported intent-gate schema');
  invariant(INTENT_GATE.statuses.includes(input.status), 'ERR_INTENT_GATE_STATUS', `Unsupported intent-gate status: ${String(input?.status)}`);
  invariant(INTENT_GATE.modes.includes(input.inferredMode), 'ERR_INTENT_GATE_MODE', 'Intent gate has an invalid inferred mode');
  invariant(INTENT_GATE.modes.includes(input.effectiveMode), 'ERR_INTENT_GATE_MODE', 'Intent gate has an invalid effective mode');
  invariant(input.selectedMode === null || INTENT_GATE.modes.includes(input.selectedMode), 'ERR_INTENT_GATE_MODE', 'Intent gate has an invalid selected mode');
  invariant(input.defaultMode === INTENT_GATE.defaultMode, 'ERR_INTENT_GATE_DEFAULT', 'Intent gate default must remain ANALYZE_ONLY');
  invariant(input.analysisComplete === true, 'ERR_INTENT_GATE_ANALYSIS', 'Intent gate requires completed read-only analysis');
  invariant(input.modelAuthority === false && input.commandAuthority === false && input.approvalAuthority === false && input.closureAuthority === false, 'ERR_INTENT_GATE_AUTHORITY', 'Intent classification cannot grant model, command, approval, or closure authority');
  invariant(input.status === 'CONFIRMATION_REQUIRED' ? input.question?.id === INTENT_GATE.questionId && input.selectedMode === null : input.question === null && input.selectedMode !== null, 'ERR_INTENT_GATE_QUESTION', 'Intent question and confirmation status are inconsistent');
  invariant(input.planningAllowed === (input.status === 'CONFIRMED' && input.effectiveMode !== 'ANALYZE_ONLY'), 'ERR_INTENT_GATE_PERMISSION', 'Planning permission is inconsistent');
  invariant(input.implementationAllowed === (input.status === 'CONFIRMED' && ['IMPLEMENT', 'AUTOPILOT'].includes(input.effectiveMode)), 'ERR_INTENT_GATE_PERMISSION', 'Implementation permission is inconsistent');
  invariant(input.autopilotAllowed === (input.status === 'CONFIRMED' && input.effectiveMode === 'AUTOPILOT'), 'ERR_INTENT_GATE_PERMISSION', 'Autopilot permission is inconsistent');
  const { hash: _hash, ...body } = input;
  invariant(input.hash === hashObject(body), 'ERR_INTENT_GATE_HASH', 'Intent-gate hash does not match its content');
  invariant(Buffer.byteLength(stableStringify(input)) <= 16 * 1024, 'ERR_INTENT_GATE_SIZE', 'Intent gate exceeds the bounded size');
  return input;
}

export function compileIntentGate(requestText, options = {}) {
  const request = normalizedText(requestText);
  const inferred = inferRequestMode(request);
  const resolution = resolutionFor(options.resolutions ?? []);
  const selectedMode = resolution ? choiceMode(resolution.choice) : inferred.explicit ? inferred.mode : null;
  const status = selectedMode ? 'CONFIRMED' : 'CONFIRMATION_REQUIRED';
  const effectiveMode = selectedMode ?? INTENT_GATE.defaultMode;
  const body = {
    schema: INTENT_GATE.schema,
    requestText: request,
    status,
    defaultMode: INTENT_GATE.defaultMode,
    inferredMode: inferred.mode,
    selectedMode,
    effectiveMode,
    inferenceReason: inferred.reason,
    confirmationSource: resolution ? 'explicit-user-refinement' : inferred.explicit ? 'explicit-request-language' : null,
    question: status === 'CONFIRMATION_REQUIRED' ? workflowQuestion() : null,
    analysisComplete: true,
    planningAllowed: status === 'CONFIRMED' && effectiveMode !== 'ANALYZE_ONLY',
    implementationAllowed: status === 'CONFIRMED' && ['IMPLEMENT', 'AUTOPILOT'].includes(effectiveMode),
    autopilotAllowed: status === 'CONFIRMED' && effectiveMode === 'AUTOPILOT',
    modelAuthority: false,
    commandAuthority: false,
    approvalAuthority: false,
    closureAuthority: false,
  };
  return validateIntentGate({ ...body, hash: hashObject(body) });
}

export function intentGateSummary(gate) {
  validateIntentGate(gate);
  return {
    status: gate.status,
    defaultMode: gate.defaultMode,
    inferredMode: gate.inferredMode,
    selectedMode: gate.selectedMode,
    effectiveMode: gate.effectiveMode,
    analysisComplete: gate.analysisComplete,
    planningAllowed: gate.planningAllowed,
    implementationAllowed: gate.implementationAllowed,
    autopilotAllowed: gate.autopilotAllowed,
    question: gate.question,
    modelAuthority: false,
    hash: gate.hash,
  };
}

export function intentAllowsPlanning(gate) {
  return validateIntentGate(gate).planningAllowed === true;
}

export function intentAllowsImplementation(gate) {
  return validateIntentGate(gate).implementationAllowed === true;
}
