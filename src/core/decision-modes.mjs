import { invariant } from './errors.mjs';

export const DECISION_MODES = Object.freeze(['AUTO', 'SAFE', 'INTERVIEW']);

const POLICIES = Object.freeze({
  AUTO: Object.freeze({
    mode: 'AUTO',
    questionBudget: 3,
    ordinaryChoices: 'safe-default',
    escalateMediumRisk: false,
    groupedQuestions: true,
  }),
  SAFE: Object.freeze({
    mode: 'SAFE',
    questionBudget: 3,
    ordinaryChoices: 'safe-default',
    escalateMediumRisk: true,
    groupedQuestions: true,
  }),
  INTERVIEW: Object.freeze({
    mode: 'INTERVIEW',
    questionBudget: 3,
    ordinaryChoices: 'ask-when-material',
    escalateMediumRisk: true,
    groupedQuestions: true,
  }),
});

/** @param {unknown} value */
export function normalizeDecisionMode(value) {
  if (value === undefined || value === null || value === '') return 'AUTO';
  invariant(typeof value === 'string', 'ERR_DECISION_MODE', 'Decision mode must be a string');
  const mode = value.trim().toUpperCase();
  invariant(DECISION_MODES.includes(mode), 'ERR_DECISION_MODE', `Unsupported decision mode: ${value}`);
  return mode;
}

/** @param {unknown} value */
export function decisionModePolicy(value) {
  const mode = normalizeDecisionMode(value);
  return POLICIES[mode];
}
