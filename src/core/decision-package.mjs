import { createDefaultContract, validateContract } from './contract.mjs';
import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { buildAcceptanceCriteria, buildMinimalScope } from './project-analysis.mjs';
import { decisionModePolicy, normalizeDecisionMode } from './decision-modes.mjs';

const MAX_DECISION_BYTES = 256 * 1024;
const MAX_DECISIONS = 40;
const MAX_ASSUMPTIONS = 30;
const MAX_RISKS = 30;
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const REVERSIBILITY = new Set(['reversible', 'conditionally-reversible', 'irreversible']);
const RISK_SEVERITY = new Set(['low', 'medium', 'high', 'critical']);
const OPTIONAL_FEATURE_TERMS = ['web', 'mobile', 'cloud', 'multi-user', 'multitenant', 'deploy', 'deployment', 'saas', 'billing'];

/** @param {unknown} value @param {string} label */
function object(value, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_DECISION_INVALID', `${label} must be an object`);
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} label @param {number} [max] */
function string(value, label, max = 4000) {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'ERR_DECISION_INVALID', `${label} must be a non-empty string no longer than ${max}`);
  return value.trim();
}

/** @param {unknown} value @param {string} label @param {number} max */
function array(value, label, max) {
  invariant(Array.isArray(value) && value.length <= max, 'ERR_DECISION_INVALID', `${label} must be an array with at most ${max} entries`);
  return value;
}

/** @param {string} value @param {RegExp} pattern @param {Set<string>} ids @param {string} label */
function stableId(value, pattern, ids, label) {
  invariant(pattern.test(value), 'ERR_DECISION_INVALID', `${label} has an invalid stable ID: ${value}`);
  invariant(!ids.has(value), 'ERR_DECISION_INVALID', `Duplicate stable ID: ${value}`);
  ids.add(value);
}

/** @param {Record<string, any>} evidence */
function evidenceIds(evidence) {
  return new Set((evidence.facts ?? []).map((entry) => entry.id));
}

/** @param {unknown} refs @param {string} label @param {Set<string>} valid */
function validateEvidenceRefs(refs, label, valid) {
  invariant(Array.isArray(refs), 'ERR_DECISION_INVALID', `${label} must be an array`);
  for (const ref of refs) {
    invariant(typeof ref === 'string' && valid.has(ref), 'ERR_DECISION_EVIDENCE', `${label} contains an unknown evidence reference: ${String(ref)}`);
  }
}

/** @param {Record<string, any>} evidence @param {Record<string, any>} scope */
function validateScope(evidence, scope) {
  object(scope, 'scope');
  array(scope.include, 'scope.include', 30).forEach((entry, index) => string(entry, `scope.include[${index}]`, 1000));
  array(scope.exclude, 'scope.exclude', 30).forEach((entry, index) => string(entry, `scope.exclude[${index}]`, 1000));
  const paths = object(scope.paths, 'scope.paths');
  const includePaths = array(paths.include, 'scope.paths.include', 80).map((entry, index) => string(entry, `scope.paths.include[${index}]`, 300));
  array(paths.exclude, 'scope.paths.exclude', 80).forEach((entry, index) => string(entry, `scope.paths.exclude[${index}]`, 300));
  const allowed = new Set(buildMinimalScope(evidence.analysis, evidence.goal).paths.include);
  for (const entry of includePaths) {
    invariant(allowed.has(entry), 'ERR_DECISION_SCOPE', `Scope path is not supported by repository evidence: ${entry}`);
  }
  const goal = evidence.goal.toLowerCase();
  const includedText = scope.include.join(' ').toLowerCase();
  for (const term of OPTIONAL_FEATURE_TERMS) {
    invariant(!includedText.includes(term) || goal.includes(term), 'ERR_DECISION_SCOPE', `Unrequested optional feature detected in scope: ${term}`);
  }
}

/** @param {Record<string, any>} evidence @param {Array<Record<string, any>>} acceptance */
function validateAcceptance(evidence, acceptance) {
  invariant(acceptance.length > 0 && acceptance.length <= 12, 'ERR_DECISION_ACCEPTANCE', 'Acceptance must contain 1 to 12 criteria');
  const allowedCommands = new Map(evidence.analysis.candidateCommands.map((entry) => [`${entry.cwd ?? '.'}\0${entry.command}`, entry]));
  const ids = new Set();
  for (const criterion of acceptance) {
    object(criterion, 'acceptance criterion');
    const id = string(criterion.id, 'acceptance.id', 80);
    stableId(id, /^AC-[0-9A-Z_-]+$/u, ids, 'acceptance');
    string(criterion.description, `${id}.description`, 1000);
    invariant(criterion.type === 'command', 'ERR_DECISION_ACCEPTANCE', `${id}.type must be command`);
    const command = string(criterion.command, `${id}.command`, 500);
    const cwd = string(criterion.cwd ?? '.', `${id}.cwd`, 300);
    const supported = allowedCommands.get(`${cwd}\0${command}`);
    invariant(supported, 'ERR_DECISION_COMMAND', `Acceptance command and cwd are not supported by repository evidence: ${cwd} :: ${command}`);
    for (const key of ['sideEffect', 'isolationRequired', 'deterministicOutputRequired', 'automaticallyRunnable']) {
      invariant(criterion[key] === supported[key], 'ERR_DECISION_ISOLATION', `${id}.${key} does not match mechanical command policy`);
    }
    invariant(criterion.required === true, 'ERR_DECISION_ACCEPTANCE', `${id} must be required in an automatically proposed release`);
  }
}

/**
 * Validate a model-generated decision package against mechanical repository evidence.
 * @param {Record<string, any>} evidence
 * @param {unknown} input
 */
export function validateDecisionPackage(evidence, input) {
  const decision = object(input, 'decision package');
  invariant(decision.schema === 'shipping-harness/decision-v1', 'ERR_DECISION_INVALID', 'Unsupported decision package schema');
  invariant(decision.evidenceHash === evidence.hash, 'ERR_DECISION_STALE', 'Decision package references a different evidence pack');
  invariant(decision.gitSha === evidence.gitSha, 'ERR_DECISION_STALE', 'Decision package references a stale Git SHA');
  decision.mode = normalizeDecisionMode(decision.mode);
  const policy = decisionModePolicy(decision.mode);
  const proposer = object(decision.proposer, 'proposer');
  invariant(proposer.type === 'agent' || proposer.type === 'system', 'ERR_DECISION_INVALID', 'proposer.type must be agent or system');
  string(proposer.id, 'proposer.id', 160);
  string(decision.outcome, 'outcome', 4000);
  validateScope(evidence, object(decision.scope, 'scope'));
  validateAcceptance(evidence, array(decision.acceptance, 'acceptance', 12));

  const validEvidence = evidenceIds(evidence);
  const ids = new Set();
  for (const entry of array(decision.decisions, 'decisions', MAX_DECISIONS)) {
    object(entry, 'decision');
    const id = string(entry.id, 'decision.id', 80);
    stableId(id, /^DEC-[0-9A-Z_-]+$/u, ids, 'decision');
    string(entry.title, `${id}.title`, 300);
    string(entry.choice, `${id}.choice`, 2000);
    string(entry.rationale, `${id}.rationale`, 3000);
    invariant(entry.basis === 'evidence' || entry.basis === 'assumption', 'ERR_DECISION_INVALID', `${id}.basis must be evidence or assumption`);
    validateEvidenceRefs(entry.evidenceRefs ?? [], `${id}.evidenceRefs`, validEvidence);
    invariant(entry.basis !== 'evidence' || entry.evidenceRefs.length > 0, 'ERR_DECISION_EVIDENCE', `${id} must cite evidence or be marked as an assumption`);
    invariant(CONFIDENCE.has(entry.confidence), 'ERR_DECISION_INVALID', `${id}.confidence must be qualitative`);
    invariant(REVERSIBILITY.has(entry.reversibility), 'ERR_DECISION_INVALID', `${id}.reversibility is invalid`);
  }

  for (const entry of array(decision.assumptions, 'assumptions', MAX_ASSUMPTIONS)) {
    object(entry, 'assumption');
    const id = string(entry.id, 'assumption.id', 80);
    stableId(id, /^ASM-[0-9A-Z_-]+$/u, ids, 'assumption');
    string(entry.statement, `${id}.statement`, 2000);
    validateEvidenceRefs(entry.evidenceRefs ?? [], `${id}.evidenceRefs`, validEvidence);
    invariant(CONFIDENCE.has(entry.confidence), 'ERR_DECISION_INVALID', `${id}.confidence must be qualitative`);
    invariant(REVERSIBILITY.has(entry.reversibility), 'ERR_DECISION_INVALID', `${id}.reversibility is invalid`);
  }

  for (const entry of array(decision.risks, 'risks', MAX_RISKS)) {
    object(entry, 'risk');
    const id = string(entry.id, 'risk.id', 80);
    stableId(id, /^RISK-[0-9A-Z_-]+$/u, ids, 'risk');
    string(entry.category, `${id}.category`, 120);
    string(entry.description, `${id}.description`, 2000);
    string(entry.mitigation, `${id}.mitigation`, 2000);
    invariant(RISK_SEVERITY.has(entry.severity), 'ERR_DECISION_INVALID', `${id}.severity is invalid`);
    validateEvidenceRefs(entry.evidenceRefs ?? [], `${id}.evidenceRefs`, validEvidence);
  }

  const questions = array(decision.questions, 'questions', policy.questionBudget);
  for (const entry of questions) {
    object(entry, 'question');
    const id = string(entry.id, 'question.id', 80);
    stableId(id, /^Q-[0-9A-Z_-]+$/u, ids, 'question');
    string(entry.category, `${id}.category`, 120);
    string(entry.prompt, `${id}.prompt`, 1500);
    string(entry.recommendedChoice, `${id}.recommendedChoice`, 1000);
  }
  invariant(Buffer.byteLength(stableStringify(decision)) <= MAX_DECISION_BYTES, 'ERR_DECISION_SIZE', 'Decision package exceeds the bounded size');
  return decision;
}

/** @param {Record<string, any>} evidence @param {{projectName?: string, release: string, proposerId?: string}} input */
export function composeDefaultDecision(evidence, input) {
  const acceptance = buildAcceptanceCriteria(evidence.analysis);
  const scope = buildMinimalScope(evidence.analysis, evidence.goal);
  const weakGate = evidence.analysis.diagnostics.some((entry) => /fallback gate is weak/u.test(entry));
  const decision = {
    schema: 'shipping-harness/decision-v1',
    proposer: { type: 'system', id: input.proposerId ?? 'shipping-default-composer' },
    mode: evidence.mode,
    evidenceHash: evidence.hash,
    gitSha: evidence.gitSha,
    release: input.release,
    projectName: input.projectName ?? evidence.analysis.projectName,
    outcome: evidence.goal,
    scope,
    acceptance,
    decisions: [
      {
        id: 'DEC-001',
        title: 'Preserve the repository stack',
        choice: `Keep the detected ${evidence.analysis.types.join(', ') || 'existing'} implementation stack and repository conventions.`,
        rationale: 'Changing technology is outside the stated outcome and increases completion risk.',
        basis: 'evidence',
        evidenceRefs: ['EVID-003'],
        confidence: 'high',
        reversibility: 'reversible',
      },
      {
        id: 'DEC-002',
        title: 'Use existing verification commands',
        choice: 'Use only commands already detected in repository manifests.',
        rationale: 'Existing commands are the strongest mechanically observable acceptance surface.',
        basis: 'evidence',
        evidenceRefs: ['EVID-004'],
        confidence: evidence.analysis.candidateCommands[0]?.confidence ?? 'low',
        reversibility: 'reversible',
      },
      {
        id: 'DEC-003',
        title: 'Choose the smallest operable release',
        choice: 'Implement only the stated outcome and defer optional product expansion.',
        rationale: 'The release goal is shipping, not speculative architecture or feature growth.',
        basis: 'evidence',
        evidenceRefs: ['EVID-001'],
        confidence: 'high',
        reversibility: 'reversible',
      },
      {
        id: 'DEC-004',
        title: 'Select the runnable workspace',
        choice: `Use ${evidence.analysis.workspace?.root ?? '.'} as the authority-bearing execution workspace.`,
        rationale: 'The selected workspace has the strongest bounded combination of manifests, source, tests, release metadata, and verification targets.',
        basis: 'evidence',
        evidenceRefs: ['EVID-007'],
        confidence: evidence.analysis.workspace?.confidence ?? 'low',
        reversibility: 'reversible',
      },
      {
        id: 'DEC-005',
        title: 'Recommend the next semantic version',
        choice: `Recommend ${input.release} from mechanical version evidence and the classified change kind.`,
        rationale: 'An explicit user version remains authoritative; otherwise Shipping uses the highest-confidence manifest or tag evidence.',
        basis: 'evidence',
        evidenceRefs: ['EVID-008'],
        confidence: evidence.analysis.versionEvidence?.confidence ?? 'low',
        reversibility: 'reversible',
      },
    ],
    assumptions: [
      {
        id: 'ASM-001',
        statement: 'No paid service, external deployment, credential change, destructive migration, or customer-facing action is required unless explicitly stated in the user outcome.',
        evidenceRefs: ['EVID-001'],
        confidence: 'medium',
        reversibility: 'reversible',
      },
    ],
    risks: [
      ...(weakGate ? [{
        id: 'RISK-001',
        category: 'weak-verification',
        severity: 'medium',
        description: 'No strong repository build or test command was detected.',
        mitigation: 'Require a repository-owned build, test, verify, check, package, or equivalent gate before approval.',
        evidenceRefs: ['EVID-004'],
      }] : []),
      ...(evidence.analysis.workspace?.ambiguous ? [{
        id: weakGate ? 'RISK-002' : 'RISK-001',
        category: 'workspace-selection',
        severity: 'high',
        description: 'Multiple materially different runnable workspaces have equal mechanical scores.',
        mitigation: `Use the recommended workspace ${evidence.analysis.workspace.root}, or explicitly select one candidate before approval.`,
        recommendedChoice: `Use ${evidence.analysis.workspace.root}, the deterministic first-ranked candidate.`,
        evidenceRefs: ['EVID-007'],
        mandatory: true,
      }] : []),
    ],
    questions: [],
  };
  decision.hash = hashObject(decision);
  return validateDecisionPackage(evidence, decision);
}

/** @param {Record<string, any>} base @param {Record<string, any>} decision */
export function compileDecisionContract(base, decision) {
  const starting = base ?? createDefaultContract(decision.projectName);
  const adapters = Object.fromEntries(Object.entries(starting.adapters ?? {}).map(([name, config]) => [name, { ...config, command: null }]));
  return validateContract({
    ...starting,
    project: decision.projectName,
    worker: 'shipping-harness',
    release: decision.release,
    goal: decision.outcome,
    scope: decision.scope,
    acceptance: decision.acceptance,
    adapters,
    releasePolicy: { ...starting.releasePolicy, autoCommit: false, autoTag: false, autoPush: false, generateReport: true },
  });
}
