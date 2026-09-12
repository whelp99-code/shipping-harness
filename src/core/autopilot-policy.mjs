import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';

export const AUTOPILOT_PROFILES = Object.freeze(['MANUAL', 'LOCAL_REVERSIBLE']);
export const AUTOPILOT_DECISIONS = Object.freeze(['AUTO', 'NOTIFY', 'ASK', 'STOP']);
export const AUTOPILOT_ACTIONS = Object.freeze([
  'ANALYZE',
  'PRESERVE_BASELINE',
  'LOCAL_COMMIT',
  'IMPLEMENT',
  'VERIFY',
  'FIX_BLOCKERS',
  'CLOSE',
  'ADVANCE_RELEASE',
  'RELEASE',
]);

const EFFECT_ORDER = Object.freeze([
  'LOCAL_READ',
  'LOCAL_REVERSIBLE',
  'FILESYSTEM_MUTATION',
  'GIT_COMMIT',
  'DATA_STATE',
  'DATA_DESTRUCTIVE',
  'AUTH',
  'SECURITY_POLICY',
  'SECRET',
  'LICENSE',
  'COST',
  'EXTERNAL_NETWORK_WRITE',
  'CUSTOMER_COMMUNICATION',
  'PRODUCTION',
  'PUBLIC',
  'CORE_VALUE_REDUCTION',
  'ACCEPTANCE_WEAKENING',
  'UNKNOWN',
]);

const HARD_STOP_EFFECTS = new Set([
  'DATA_DESTRUCTIVE',
  'SECRET',
  'CORE_VALUE_REDUCTION',
  'ACCEPTANCE_WEAKENING',
  'UNKNOWN',
]);
const HUMAN_EFFECTS = new Set([
  'DATA_STATE',
  'AUTH',
  'SECURITY_POLICY',
  'LICENSE',
  'COST',
  'EXTERNAL_NETWORK_WRITE',
  'CUSTOMER_COMMUNICATION',
  'PRODUCTION',
  'PUBLIC',
]);
const MUTATING_ACTIONS = new Set(['PRESERVE_BASELINE', 'LOCAL_COMMIT', 'IMPLEMENT', 'FIX_BLOCKERS', 'CLOSE', 'ADVANCE_RELEASE', 'RELEASE']);

function boundedString(value, label, max = 500) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(text.length > 0 && text.length <= max, 'ERR_AUTOPILOT_POLICY', `${label} must be between 1 and ${max} characters`);
  return text;
}

function exactHash(value, label, length) {
  const text = boundedString(value, label, length);
  invariant(new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(text), 'ERR_AUTOPILOT_POLICY', `${label} must be a lowercase hexadecimal value`);
  return text;
}

function normalizedEffects(values = []) {
  const unique = [...new Set(values.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  for (const effect of unique) invariant(EFFECT_ORDER.includes(effect), 'ERR_AUTOPILOT_EFFECT', `Unsupported autopilot consequence: ${effect}`);
  return unique.sort((left, right) => EFFECT_ORDER.indexOf(left) - EFFECT_ORDER.indexOf(right));
}

function profilePermissions(profile) {
  if (profile === 'MANUAL') {
    return {
      ANALYZE: 'AUTO',
      PRESERVE_BASELINE: 'ASK',
      LOCAL_COMMIT: 'ASK',
      IMPLEMENT: 'ASK',
      VERIFY: 'AUTO',
      FIX_BLOCKERS: 'ASK',
      CLOSE: 'ASK',
      ADVANCE_RELEASE: 'ASK',
      RELEASE: 'ASK',
    };
  }
  return {
    ANALYZE: 'AUTO',
    PRESERVE_BASELINE: 'NOTIFY',
    LOCAL_COMMIT: 'NOTIFY',
    IMPLEMENT: 'AUTO',
    VERIFY: 'AUTO',
    FIX_BLOCKERS: 'AUTO',
    CLOSE: 'NOTIFY',
    ADVANCE_RELEASE: 'NOTIFY',
    RELEASE: 'ASK',
  };
}

function defaultLimits(input = {}) {
  return {
    maxFixCycles: Number.isInteger(input.maxFixCycles) ? Math.max(0, Math.min(input.maxFixCycles, 5)) : 2,
    maxAgentRuns: Number.isInteger(input.maxAgentRuns) ? Math.max(0, Math.min(input.maxAgentRuns, 8)) : 4,
    maxReleases: Number.isInteger(input.maxReleases) ? Math.max(1, Math.min(input.maxReleases, 5)) : 5,
    maxCommandSeconds: Number.isInteger(input.maxCommandSeconds) ? Math.max(1, Math.min(input.maxCommandSeconds, 1800)) : 900,
  };
}

/**
 * Compile one explicit, default-deny autopilot policy. Host-model prose is not an input.
 * @param {{profile:string,proposalId:string,proposalHash:string,contractHash:string,baselineSha:string,releaseTrainHash:string,approvedAt:string,limits?:Record<string,number>}} input
 */
export function compileAutopilotPolicy(input) {
  const profile = boundedString(input.profile, 'autopilot profile', 80).toUpperCase();
  invariant(AUTOPILOT_PROFILES.includes(profile), 'ERR_AUTOPILOT_PROFILE', `Unsupported autopilot profile: ${profile}`);
  const approvedAt = boundedString(input.approvedAt, 'policy approval time', 80);
  invariant(Number.isFinite(Date.parse(approvedAt)), 'ERR_AUTOPILOT_POLICY', 'Autopilot policy approval time must be ISO date-time');
  const body = {
    schema: 'shipping-harness/autopilot-policy-v1',
    id: `POLICY-${hashObject({
      profile,
      proposalHash: input.proposalHash,
      contractHash: input.contractHash,
      releaseTrainHash: input.releaseTrainHash,
      baselineSha: input.baselineSha,
    }).slice(0, 12)}`,
    profile,
    enabled: profile !== 'MANUAL',
    modelAuthority: false,
    defaultDecision: 'STOP',
    permissions: profilePermissions(profile),
    consequencePolicy: {
      hardStop: [...HARD_STOP_EFFECTS],
      humanDecision: [...HUMAN_EFFECTS],
      automaticReleased: false,
      productionAutomatic: false,
      publicAutomatic: false,
      externalWriteAutomatic: false,
      costAutomatic: false,
      licenseChangeAutomatic: false,
      destructiveDataAutomatic: false,
      authSecurityAutomatic: false,
    },
    closureRequirements: {
      policyBindingCurrent: true,
      valueGateProven: true,
      acceptancePassed: true,
      evidenceFresh: true,
      rollbackAvailable: true,
      blockerCount: 0,
      unknownCount: 0,
      scopeDrift: 0,
      released: false,
    },
    limits: defaultLimits(input.limits),
    binding: {
      proposalId: boundedString(input.proposalId, 'proposal ID', 160),
      proposalHash: exactHash(input.proposalHash, 'proposal hash', 64),
      contractHash: exactHash(input.contractHash, 'contract hash', 64),
      baselineSha: exactHash(input.baselineSha, 'baseline SHA', 40),
      releaseTrainHash: exactHash(input.releaseTrainHash, 'release train hash', 64),
      approvedAt,
    },
  };
  const policy = { ...body, hash: hashObject(body) };
  return validateAutopilotPolicy(policy);
}

/** @param {Record<string,any>} policy */
export function validateAutopilotPolicy(policy) {
  invariant(policy && typeof policy === 'object' && !Array.isArray(policy), 'ERR_AUTOPILOT_POLICY', 'Autopilot policy must be an object');
  invariant(policy.schema === 'shipping-harness/autopilot-policy-v1', 'ERR_AUTOPILOT_POLICY_SCHEMA', 'Unsupported autopilot policy schema');
  invariant(AUTOPILOT_PROFILES.includes(policy.profile), 'ERR_AUTOPILOT_PROFILE', `Unsupported autopilot profile: ${String(policy.profile)}`);
  invariant(policy.modelAuthority === false && policy.defaultDecision === 'STOP', 'ERR_AUTOPILOT_POLICY_AUTHORITY', 'Autopilot policy must be model-independent and default-deny');
  invariant(policy.enabled === (policy.profile !== 'MANUAL'), 'ERR_AUTOPILOT_POLICY', 'Policy enabled state does not match profile');
  for (const action of AUTOPILOT_ACTIONS) {
    invariant(AUTOPILOT_DECISIONS.includes(policy.permissions?.[action]), 'ERR_AUTOPILOT_POLICY', `Autopilot action ${action} has no bounded policy decision`);
  }
  invariant(policy.consequencePolicy?.automaticReleased === false, 'ERR_AUTOPILOT_RELEASED', 'Autopilot can never mark a release RELEASED');
  for (const key of ['productionAutomatic', 'publicAutomatic', 'externalWriteAutomatic', 'costAutomatic', 'licenseChangeAutomatic', 'destructiveDataAutomatic', 'authSecurityAutomatic']) {
    invariant(policy.consequencePolicy?.[key] === false, 'ERR_AUTOPILOT_POLICY_AUTHORITY', `${key} must remain false`);
  }
  exactHash(policy.binding?.proposalHash, 'proposal hash', 64);
  exactHash(policy.binding?.contractHash, 'contract hash', 64);
  exactHash(policy.binding?.baselineSha, 'baseline SHA', 40);
  exactHash(policy.binding?.releaseTrainHash, 'release train hash', 64);
  invariant(Number.isFinite(Date.parse(policy.binding?.approvedAt)), 'ERR_AUTOPILOT_POLICY', 'Policy approval time is invalid');
  invariant(policy.limits?.maxFixCycles >= 0 && policy.limits.maxFixCycles <= 5, 'ERR_AUTOPILOT_LIMIT', 'Fix-cycle limit is invalid');
  invariant(policy.limits?.maxReleases >= 1 && policy.limits.maxReleases <= 5, 'ERR_AUTOPILOT_LIMIT', 'Release limit is invalid');
  const { hash, ...body } = policy;
  invariant(hash === hashObject(body), 'ERR_AUTOPILOT_POLICY_HASH', 'Autopilot policy hash does not match its content');
  return policy;
}

function gateFailure(request) {
  if (request.humanStop === true) return ['HUMAN_STOP'];
  if (request.policyBindingCurrent === false) return ['STALE_POLICY_BINDING'];
  if (request.replanRequired === true) return ['REPLAN_REQUIRED'];
  if (request.action === 'FIX_BLOCKERS' && request.fixCycles >= request.maxFixCycles) return ['FIX_BUDGET_EXHAUSTED'];
  if (request.action === 'CLOSE') {
    const reasons = [];
    if (request.valueGateProven !== true) reasons.push('VALUE_GATE_UNPROVEN');
    if (request.acceptancePassed !== true) reasons.push('ACCEPTANCE_NOT_PASSED');
    if (request.evidenceFresh !== true) reasons.push('EVIDENCE_NOT_FRESH');
    if (request.rollbackAvailable !== true) reasons.push('ROLLBACK_UNPROVEN');
    if ((request.blockerCount ?? 0) !== 0) reasons.push('BLOCKERS_REMAIN');
    if ((request.unknownCount ?? 0) !== 0) reasons.push('UNKNOWNS_REMAIN');
    if ((request.scopeDrift ?? 0) !== 0) reasons.push('SCOPE_DRIFT');
    if (request.releaseState !== 'SHIPPABLE') reasons.push('NOT_SHIPPABLE');
    return reasons;
  }
  if (request.action === 'ADVANCE_RELEASE') {
    const reasons = [];
    if (request.predecessorClosed !== true) reasons.push('PREDECESSOR_NOT_CLOSED');
    if (request.cleanCommittedClosure !== true) reasons.push('CLOSURE_NOT_COMMITTED');
    if (request.replanReady !== true) reasons.push('REPLAN_NOT_READY');
    return reasons;
  }
  return [];
}

function decisionText(decision, action, reasons) {
  if (decision === 'AUTO') return `${action}은 승인된 로컬 정책 안에서 자동 진행할 수 있습니다.`;
  if (decision === 'NOTIFY') return `${action}은 승인된 정책 안에서 진행하고 결과를 사용자에게 알립니다.`;
  if (decision === 'ASK') return `${action}은 사용자가 결과와 영향을 이해한 뒤 결정해야 합니다.`;
  return reasons.includes('HUMAN_STOP')
    ? '사용자가 작업을 중단했으므로 자동 진행을 멈춥니다.'
    : `${action}은 현재 증거 또는 정책으로 안전하게 진행할 수 없습니다.`;
}

/**
 * Decide one bounded action from mechanical facts. The caller cannot supply free-form permission.
 * @param {Record<string,any>} policyInput
 * @param {{action:string,effects?:string[],humanStop?:boolean,policyBindingCurrent?:boolean,replanRequired?:boolean,rollbackAvailable?:boolean,valueGateProven?:boolean,acceptancePassed?:boolean,evidenceFresh?:boolean,blockerCount?:number,unknownCount?:number,scopeDrift?:number,releaseState?:string,fixCycles?:number,maxFixCycles?:number,predecessorClosed?:boolean,cleanCommittedClosure?:boolean,replanReady?:boolean,localOnly?:boolean,exactScope?:boolean}} requestInput
 */
export function decideAutopilot(policyInput, requestInput) {
  const policy = validateAutopilotPolicy(policyInput);
  const action = boundedString(requestInput.action, 'autopilot action', 80).toUpperCase();
  invariant(AUTOPILOT_ACTIONS.includes(action), 'ERR_AUTOPILOT_ACTION', `Unsupported autopilot action: ${action}`);
  const effects = normalizedEffects(requestInput.effects ?? (['ANALYZE', 'VERIFY'].includes(action) ? ['LOCAL_READ'] : ['LOCAL_REVERSIBLE']));
  const request = {
    action,
    effects,
    humanStop: requestInput.humanStop === true,
    policyBindingCurrent: requestInput.policyBindingCurrent !== false,
    replanRequired: requestInput.replanRequired === true,
    rollbackAvailable: requestInput.rollbackAvailable === true,
    valueGateProven: requestInput.valueGateProven === true,
    acceptancePassed: requestInput.acceptancePassed === true,
    evidenceFresh: requestInput.evidenceFresh === true,
    blockerCount: Number.isInteger(requestInput.blockerCount) ? requestInput.blockerCount : 0,
    unknownCount: Number.isInteger(requestInput.unknownCount) ? requestInput.unknownCount : 0,
    scopeDrift: Number.isInteger(requestInput.scopeDrift) ? requestInput.scopeDrift : 0,
    releaseState: requestInput.releaseState ?? null,
    fixCycles: Number.isInteger(requestInput.fixCycles) ? requestInput.fixCycles : 0,
    maxFixCycles: Number.isInteger(requestInput.maxFixCycles) ? requestInput.maxFixCycles : policy.limits.maxFixCycles,
    predecessorClosed: requestInput.predecessorClosed === true,
    cleanCommittedClosure: requestInput.cleanCommittedClosure === true,
    replanReady: requestInput.replanReady === true,
    localOnly: requestInput.localOnly !== false,
    exactScope: requestInput.exactScope !== false,
  };
  let decision = policy.permissions[action] ?? policy.defaultDecision;
  const reasons = gateFailure(request);
  const manualNeedsAsk = policy.profile === 'MANUAL' && !['ANALYZE', 'VERIFY'].includes(action);
  if (MUTATING_ACTIONS.has(action) && request.localOnly !== true) effects.push('EXTERNAL_NETWORK_WRITE');
  if (MUTATING_ACTIONS.has(action) && request.exactScope !== true) reasons.push('SCOPE_NOT_EXACT');
  if (MUTATING_ACTIONS.has(action) && action !== 'RELEASE' && request.rollbackAvailable !== true) reasons.push('ROLLBACK_UNPROVEN');
  const hard = effects.filter((effect) => HARD_STOP_EFFECTS.has(effect));
  const human = effects.filter((effect) => HUMAN_EFFECTS.has(effect));
  if (hard.length > 0) reasons.push(...hard.map((effect) => `FORBIDDEN_${effect}`));
  if (reasons.length > 0) decision = 'STOP';
  else if (human.length > 0 || action === 'RELEASE' || manualNeedsAsk) decision = 'ASK';
  else if (policy.enabled !== true && !['ANALYZE', 'VERIFY'].includes(action)) decision = 'ASK';
  if (action === 'RELEASE') decision = 'ASK';
  const uniqueReasons = [...new Set(reasons)];
  const body = {
    schema: 'shipping-harness/autopilot-decision-v1',
    policyId: policy.id,
    policyHash: policy.hash,
    action,
    decision,
    code: uniqueReasons[0] ?? `${decision}_${action}`,
    allowed: decision === 'AUTO' || decision === 'NOTIFY',
    requiresHuman: decision === 'ASK',
    stopsAutomation: decision === 'STOP',
    effects: normalizedEffects(effects),
    reasons: uniqueReasons,
    nextState: decision === 'STOP' ? (uniqueReasons.includes('REPLAN_REQUIRED') ? 'REPLAN_REQUIRED' : 'STOPPED') : decision === 'ASK' ? 'ASKING' : action === 'CLOSE' ? 'CLOSING' : action === 'VERIFY' ? 'VERIFYING' : action === 'FIX_BLOCKERS' ? 'FIXING_BLOCKERS' : action === 'IMPLEMENT' ? 'IMPLEMENTING' : action === 'ADVANCE_RELEASE' ? 'REPLAN_CHECK' : 'POLICY_READY',
    released: false,
    message: decisionText(decision, action, uniqueReasons),
    inputFingerprint: hashObject(request),
  };
  return { ...body, hash: hashObject(body) };
}

/** @param {Record<string,any>} decision */
/** @param {Record<string, any> | null | undefined} decision */
export function validateAutopilotDecision(decision) {
  invariant(decision?.schema === 'shipping-harness/autopilot-decision-v1', 'ERR_AUTOPILOT_DECISION_SCHEMA', 'Unsupported autopilot decision schema');
  invariant(AUTOPILOT_DECISIONS.includes(decision.decision), 'ERR_AUTOPILOT_DECISION', `Unsupported decision: ${String(decision.decision)}`);
  invariant(AUTOPILOT_ACTIONS.includes(decision.action), 'ERR_AUTOPILOT_ACTION', `Unsupported action: ${String(decision.action)}`);
  invariant(decision.released === false, 'ERR_AUTOPILOT_RELEASED', 'Autopilot decisions cannot mark a release RELEASED');
  invariant(decision.allowed === ['AUTO', 'NOTIFY'].includes(decision.decision), 'ERR_AUTOPILOT_DECISION', 'Allowed flag contradicts decision');
  invariant(decision.requiresHuman === (decision.decision === 'ASK'), 'ERR_AUTOPILOT_DECISION', 'Human-decision flag contradicts decision');
  invariant(decision.stopsAutomation === (decision.decision === 'STOP'), 'ERR_AUTOPILOT_DECISION', 'Stop flag contradicts decision');
  const { hash, ...body } = decision;
  invariant(hash === hashObject(body), 'ERR_AUTOPILOT_DECISION_HASH', 'Autopilot decision hash does not match its content');
  return decision;
}

/**
 * @param {*} policy
 * @returns {*}
 */
export function autopilotPolicySummary(policy) {
  if (!policy) return null;
  validateAutopilotPolicy(policy);
  return {
    schema: 'shipping-harness/autopilot-policy-summary-v1',
    id: policy.id,
    hash: policy.hash,
    profile: policy.profile,
    enabled: policy.enabled,
    modelAuthority: false,
    automaticReleased: false,
    allowsLocalImplementation: policy.permissions.IMPLEMENT === 'AUTO',
    allowsAutomaticClose: ['AUTO', 'NOTIFY'].includes(policy.permissions.CLOSE),
    externalEffectsRequireHuman: true,
  };
}

/**
 * @param {*} left
 * @param {*} right
 * @returns {*}
 */
export function policiesEquivalent(left, right) {
  validateAutopilotPolicy(left);
  validateAutopilotPolicy(right);
  return stableStringify(left) === stableStringify(right);
}
