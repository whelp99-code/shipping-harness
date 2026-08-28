import { hashObject } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { decisionModePolicy } from './decision-modes.mjs';
import { validateDecisionPackage } from './decision-package.mjs';

const RISK_RULES = Object.freeze([
  {
    category: 'destructive-data',
    severity: 'critical',
    pattern: /\b(delete|drop|erase|destroy|wipe|reset)\b.{0,40}\b(data|database|table|records?|storage)\b|\birreversible\s+migration\b/iu,
    description: 'The requested outcome may delete data or perform an irreversible migration.',
    recommendedChoice: 'Do not perform destructive data changes in this release; use a reversible migration or backup-first plan.',
  },
  {
    category: 'paid-service',
    severity: 'high',
    pattern: /\b(paid|subscription|recurring cost|purchase|billing|chargeable)\b/iu,
    description: 'The requested outcome may introduce a paid or recurring-cost service.',
    recommendedChoice: 'Keep the release local or use an already-approved service with no new recurring cost.',
  },
  {
    category: 'external-impact',
    severity: 'high',
    pattern: /\b(deploy|publish|production|send (?:an )?(?:email|message)|contact customers?|customer-facing|release publicly)\b/iu,
    description: 'The requested outcome may create external, production, publication, messaging, or customer impact.',
    recommendedChoice: 'Prepare an artifact or dry run only; require a separate explicit approval before external action.',
  },
  {
    category: 'credentials-permissions',
    severity: 'critical',
    pattern: /\b(credentials?|api keys?|secrets?|root access|administrator|elevated permissions?|access policy|rbac)\b/iu,
    description: 'The requested outcome may require credentials, elevated permissions, or access-policy changes.',
    recommendedChoice: 'Use the minimum existing permission and keep credential changes outside this release.',
  },
  {
    category: 'privacy-legal-security',
    severity: 'critical',
    pattern: /\b(personal data|pii|privacy|legal|compliance|regulated|security trade-?off|disable security|bypass security)\b/iu,
    description: 'The requested outcome may create a privacy, legal, compliance, or critical-security trade-off.',
    recommendedChoice: 'Stop and obtain an explicit human decision with the safer compliant option selected.',
  },
  {
    category: 'core-outcome-conflict',
    severity: 'high',
    pattern: /\b(choose between|mutually exclusive|either\b.{0,80}\bor\b)\b/iu,
    description: 'The core product outcome contains mutually exclusive interpretations.',
    recommendedChoice: 'Choose the smallest interpretation that preserves existing behavior and defer the alternative.',
  },
  {
    category: 'compatibility-removal',
    severity: 'high',
    pattern: /\b(remove|drop|abandon)\b.{0,50}\b(existing|compatibility|support|critical feature|public api)\b|\bbreaking change\b/iu,
    description: 'The requested outcome may remove an existing critical feature or compatibility promise.',
    recommendedChoice: 'Preserve compatibility in this release and schedule removal behind a separately approved migration.',
  },
  {
    category: 'architecture-expansion',
    severity: 'medium',
    pattern: /\b(new dependency|replace framework|rewrite architecture|major refactor|new network service)\b/iu,
    description: 'The requested outcome may introduce a material architecture or dependency change.',
    recommendedChoice: 'Preserve the existing stack and use the minimum reversible implementation.',
  },
]);

const MANDATORY = new Set([
  'destructive-data', 'paid-service', 'external-impact', 'credentials-permissions',
  'privacy-legal-security', 'core-outcome-conflict', 'compatibility-removal',
]);

/** @param {Record<string, any>} decision */
function decisionText(decision) {
  return [
    decision.outcome,
    ...(decision.scope?.include ?? []),
    ...(decision.decisions ?? []).flatMap((entry) => [entry.choice, entry.rationale]),
  ].filter(Boolean).join('\n');
}

/** @param {Record<string, any>} decision */
function existingCategories(decision) {
  return new Set((decision.risks ?? []).map((entry) => entry.category));
}

/** @param {Array<Record<string, any>>} risks @param {number} budget */
function questionsForRisks(risks, budget) {
  const questions = risks.map((risk, index) => ({
    id: `Q-${String(index + 1).padStart(3, '0')}`,
    category: risk.category,
    prompt: `${risk.description} Approve this risk for the current release, or accept the recommended safer choice?`,
    recommendedChoice: risk.recommendedChoice ?? risk.mitigation,
    riskIds: [risk.id],
  }));
  if (questions.length <= budget) return questions;
  const kept = questions.slice(0, Math.max(0, budget - 1));
  const remaining = questions.slice(Math.max(0, budget - 1));
  kept.push({
    id: `Q-${String(budget).padStart(3, '0')}`,
    category: 'combined-mandatory-risks',
    prompt: `Resolve the remaining mandatory risks together: ${remaining.map((entry) => entry.category).join(', ')}.`,
    recommendedChoice: 'Apply every recommended safer choice and defer the risky actions to separately approved releases.',
    riskIds: remaining.flatMap((entry) => entry.riskIds),
  });
  return kept;
}

/**
 * Apply deterministic escalation policy after a host or default composer created a decision package.
 * @param {Record<string, any>} evidence
 * @param {Record<string, any>} input
 * @param {{budgets?: Record<string, any>}} [options]
 */
export function applyDecisionPolicy(evidence, input, options = {}) {
  const decision = structuredClone(validateDecisionPackage(evidence, input));
  const policy = decisionModePolicy(decision.mode);
  const text = decisionText(decision);
  const categories = existingCategories(decision);
  let nextRisk = decision.risks.length + 1;
  for (const rule of RISK_RULES) {
    if (!rule.pattern.test(text) || categories.has(rule.category)) continue;
    decision.risks.push({
      id: `RISK-${String(nextRisk).padStart(3, '0')}`,
      category: rule.category,
      severity: rule.severity,
      description: rule.description,
      mitigation: rule.recommendedChoice,
      recommendedChoice: rule.recommendedChoice,
      evidenceRefs: ['EVID-001'],
      mandatory: MANDATORY.has(rule.category),
    });
    categories.add(rule.category);
    nextRisk += 1;
  }
  const escalated = decision.risks.filter((risk) => risk.mandatory === true || (policy.escalateMediumRisk && risk.severity === 'medium'));
  decision.questions = questionsForRisks(escalated, policy.questionBudget);
  if (decision.mode === 'INTERVIEW' && decision.questions.length === 0 && decision.assumptions.length > 0) {
    decision.questions = [{
      id: 'Q-001',
      category: 'material-assumptions',
      prompt: 'Review the grouped assumptions before execution. Accept the recommended defaults or provide replacements.',
      recommendedChoice: 'Accept the reversible defaults and continue with the smallest operable release.',
      riskIds: [],
    }];
  }
  decision.limits = {
    questionBudget: policy.questionBudget,
    maxFixCycles: options.budgets?.maxFixCycles ?? 2,
    maxAgentRuns: options.budgets?.maxAgentRuns ?? 3,
    maxCommandSeconds: options.budgets?.maxCommandSeconds ?? 900,
  };
  decision.approvalStatus = decision.questions.length > 0 ? 'NEEDS_INPUT' : 'APPROVABLE';
  decision.hash = hashObject(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'hash')));
  return validateDecisionPackage(evidence, decision);
}

/** @param {Record<string, any>} decision */
export function buildApprovalBrief(decision) {
  invariant(['APPROVABLE', 'NEEDS_INPUT', 'BLOCKED'].includes(decision.approvalStatus), 'ERR_DECISION_APPROVAL', 'Decision package has no valid approval status');
  const brief = {
    schema: 'shipping-harness/approval-brief-v1',
    mode: decision.mode,
    status: decision.approvalStatus,
    outcome: decision.outcome,
    included: decision.scope.include,
    deferred: decision.scope.exclude,
    acceptance: decision.acceptance.map((entry) => ({ id: entry.id, description: entry.description, command: entry.command })),
    assumptions: decision.assumptions.map((entry) => ({ id: entry.id, statement: entry.statement })),
    risks: decision.risks.map((entry) => ({ id: entry.id, category: entry.category, severity: entry.severity, description: entry.description })),
    questions: decision.questions,
    limits: decision.limits,
  };
  brief.text = [
    `${brief.outcome}`,
    `Mode: ${brief.mode} | Status: ${brief.status}`,
    `Included: ${brief.included.join(' | ')}`,
    `Deferred: ${brief.deferred.join(' | ')}`,
    `Acceptance: ${brief.acceptance.map((entry) => `${entry.id} ${entry.description}`).join(' | ')}`,
    `Assumptions: ${brief.assumptions.map((entry) => `${entry.id} ${entry.statement}`).join(' | ') || 'None'}`,
    `Risks: ${brief.risks.map((entry) => `${entry.id} ${entry.severity} ${entry.category}`).join(' | ') || 'None'}`,
    `Questions: ${brief.questions.map((entry) => `${entry.id} ${entry.prompt}`).join(' | ') || 'None'}`,
    `Limits: fix ${brief.limits.maxFixCycles}, agent runs ${brief.limits.maxAgentRuns}, command seconds ${brief.limits.maxCommandSeconds}`,
  ].join('\n');
  invariant(brief.text.length <= 12000, 'ERR_APPROVAL_BRIEF_SIZE', 'Approval brief exceeds the bounded display size');
  brief.hash = hashObject(brief);
  return brief;
}
