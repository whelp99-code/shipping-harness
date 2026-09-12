import { randomUUID } from 'node:crypto';
import { exists, readJson, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { invariant } from './errors.mjs';

export const ISSUE_CLASSES = Object.freeze(['BLOCKER', 'NEXT', 'IGNORE', 'UNKNOWN']);

/** @param {string} root */
export async function loadIssues(root) {
  const filePath = runtimePaths(root).issues;
  if (!(await exists(filePath))) {
    return { schema: 'shipping-harness/issues-v1', issues: [], updatedAt: null };
  }
  const document = await readJson(filePath);
  invariant(Array.isArray(document.issues), 'ERR_ISSUES_INVALID', 'issues.json must contain an issues array');
  return document;
}

/** @param {string} root @param {Array<Record<string, any>>} issues */
export async function writeIssues(root, issues) {
  const normalized = issues.map(normalizeIssue);
  const document = {
    schema: 'shipping-harness/issues-v1',
    issues: normalized,
    counts: countIssues(normalized),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(runtimePaths(root).issues, document);
  return document;
}

/** @param {Record<string, any>} input */
export function normalizeIssue(input) {
  const requestedClass = ISSUE_CLASSES.includes(input.classification) ? input.classification : 'UNKNOWN';
  const hasBlockerBasis = typeof input.basisId === 'string' && input.basisId.trim().length > 0;
  const hasEvidence = typeof input.evidenceRef === 'string' && input.evidenceRef.trim().length > 0;
  const classification = requestedClass === 'BLOCKER' && (!hasBlockerBasis || !hasEvidence) ? 'UNKNOWN' : requestedClass;
  return {
    id: typeof input.id === 'string' && input.id ? input.id : `ISSUE-${randomUUID().slice(0, 8).toUpperCase()}`,
    title: typeof input.title === 'string' && input.title ? input.title : 'Untitled finding',
    description: typeof input.description === 'string' ? input.description : '',
    classification,
    requestedClassification: requestedClass,
    basisId: hasBlockerBasis ? input.basisId : null,
    evidenceRef: hasEvidence ? input.evidenceRef : null,
    source: typeof input.source === 'string' ? input.source : 'manual',
    runId: typeof input.runId === 'string' ? input.runId : null,
    path: typeof input.path === 'string' ? input.path : null,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    diagnostics:
      requestedClass === 'BLOCKER' && classification === 'UNKNOWN'
        ? ['Blocker downgraded because basisId and evidenceRef are required.']
        : Array.isArray(input.diagnostics)
          ? input.diagnostics
          : [],
  };
}

/** @param {Array<Record<string, any>>} issues */
export function countIssues(issues) {
  const counts = { BLOCKER: 0, NEXT: 0, IGNORE: 0, UNKNOWN: 0 };
  for (const issue of issues) {
    const key = ISSUE_CLASSES.includes(issue.classification) ? issue.classification : 'UNKNOWN';
    counts[key] += 1;
  }
  return counts;
}

/**
 * Replace machine-generated issues while preserving operator-authored findings.
 * @param {string} root
 * @param {Array<Record<string, any>>} generated
 */
export async function replaceGeneratedIssues(root, generated) {
  const existing = await loadIssues(root);
  const manual = existing.issues.filter((issue) => issue.source === 'manual');
  return writeIssues(root, [...manual, ...generated]);
}

/** @param {string} root @param {Record<string, any>} issue */
export async function addManualIssue(root, issue) {
  const existing = await loadIssues(root);
  return writeIssues(root, [...existing.issues, { ...issue, source: 'manual' }]);
}

/** @param {Record<string, any>} manifest */
export function issuesFromEvidence(manifest) {
  return manifest.results
    .filter((result) => result.status !== 'PASS')
    .map((result) => ({
      id: `ISSUE-${result.criterionId}`,
      title: `${result.criterionId} failed`,
      description: result.timedOut
        ? 'Acceptance command exceeded its time budget.'
        : result.outputLimitExceeded
          ? 'Acceptance command exceeded its output budget.'
          : `Acceptance command exited with ${String(result.exitCode)}.`,
      classification: result.required ? 'BLOCKER' : 'NEXT',
      basisId: result.criterionId,
      evidenceRef: result.logPath,
      source: 'acceptance',
      runId: manifest.runId,
    }));
}

/** @param {{violations: Array<{path: string, reason: string}>}} scopeReport @param {string} runId */
export function issuesFromScope(scopeReport, runId) {
  return scopeReport.violations.map((violation, index) => ({
    id: `ISSUE-SCOPE-${String(index + 1).padStart(3, '0')}`,
    title: `Unapproved scope drift: ${violation.path}`,
    description: `Changed path violates scope policy (${violation.reason}).`,
    classification: 'BLOCKER',
    basisId: 'POLICY-SCOPE',
    evidenceRef: `git:${violation.path}`,
    source: 'scope',
    runId,
    path: violation.path,
  }));
}

/**
 * v1.10.0 Phase C: a verify-run budget is exhausted. Two can trip: the redundancy budget
 * (`budgets.maxRedundantVerifyRuns`, runs that reproduced the previous tree fingerprint and
 * acceptance results) and the total cap (`budgets.maxVerifyRuns`). The description names
 * which one. Always a BLOCKER: both basisId and evidenceRef are set, so `normalizeIssue`
 * never downgrades it.
 * @param {{maxVerifyRuns: number, maxRedundantVerifyRuns: number, redundantVerifyRuns: number, verifyRuns: number, exhaustedBudget: string | null}} budget
 * @param {string} runId
 */
export function issuesFromVerifyBudget(budget, runId) {
  const description = budget.exhaustedBudget === 'maxVerifyRuns'
    ? `budgets.maxVerifyRuns (${budget.maxVerifyRuns}) reached: ${budget.verifyRuns} verify run(s) have been recorded for this release.`
    : `budgets.maxRedundantVerifyRuns (${budget.maxRedundantVerifyRuns}) reached after ${budget.redundantVerifyRuns} verify run(s) that reproduced the previous run's working-tree fingerprint and acceptance results with no new evidence.`;
  return [{
    id: 'ISSUE-VERIFY-BUDGET',
    title: 'Verify run budget exhausted',
    description,
    classification: 'BLOCKER',
    basisId: 'budget-exhausted',
    evidenceRef: `runId:${runId}`,
    source: 'verify-budget',
    runId,
  }];
}

/** @param {Array<Record<string, any>>} issues */
export function backlogFromIssues(issues) {
  return issues
    .filter((issue) => issue.classification === 'NEXT' || issue.classification === 'UNKNOWN')
    .map((issue) => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      classification: issue.classification,
      basisId: issue.basisId,
      evidenceRef: issue.evidenceRef,
      source: issue.source,
    }));
}