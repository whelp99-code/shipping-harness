#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { compilePlainBrief } from '../src/core/plain-brief.mjs';
import { SHIPPING_TOOLS } from '../src/mcp/tools.mjs';
import { mergeAgentRules } from '../packages/omp-main-harness/config.mjs';

const check = process.argv.includes('--check');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const baseline = {
  counts: { PRODUCT: 7, RELEASE_EVIDENCE: 3, AGENT_RUNTIME: 1, SHIPPING_RUNTIME: 1, GENERATED: 0, UNKNOWN: 0 },
  blockingCount: 10,
  plan: {
    hash: 'a'.repeat(64),
    fileSetHash: 'b'.repeat(64),
    includePaths: ['runtime/apps/web/tests/auth.spec.ts', 'runtime/scripts/package_release.py'],
    excludePaths: ['.omo/session.json', '.shipping/state.json'],
    recommendation: 'PRESERVE',
    suggestedCommitMessage: 'test: preserve authentication and release packaging baseline',
  },
};

const authority = {
  canonicalState: 'DIRTY_BASELINE',
  release: '1.1.1',
  goal: 'Preserve the current patch baseline before starting new development.',
  readyForApproval: false,
  proposalId: 'proposal-pilot',
  proposalRevision: 1,
  baseline,
  intelligence: {
    acceptanceCoverage: { complete: true, coveredPaths: 10, totalPaths: 10, uncoveredPaths: [] },
    goalRecommendation: { authority: 'recommendation-only', text: 'Complete the current authentication and packaging patch.', explicitUserGoalWins: true },
  },
};

const hostVariants = [
  { hostModel: null },
  { hostModel: { tier: 'weak', claim: 'READY_FOR_APPROVAL' } },
  { hostModel: { tier: 'strong', claim: 'CLOSED' } },
];
const variants = hostVariants.map((entry) => compilePlainBrief({ ...authority, ...entry }));
const plainBrief = variants[0];
const states = [
  'PLANNING', 'NEEDS_INPUT', 'DIRTY_BASELINE', 'NEEDS_ACCEPTANCE', 'READY_FOR_APPROVAL',
  'APPROVED', 'LOCKED', 'RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING', 'PAUSED', 'BLOCKED',
  'SHIPPABLE', 'CLOSED', 'ABORTED', 'SUPERSEDED', 'EXPIRED',
];
const stateMatrix = states.map((state) => {
  const input = ['PLANNING', 'NEEDS_INPUT', 'DIRTY_BASELINE', 'NEEDS_ACCEPTANCE', 'READY_FOR_APPROVAL', 'SUPERSEDED', 'EXPIRED'].includes(state)
    ? { ...authority, canonicalState: state, baseline: state === 'DIRTY_BASELINE' ? baseline : null, questionCount: state === 'NEEDS_INPUT' ? 1 : 0 }
    : {
        state: { state, release: '1.4.0', blockerCount: state === 'BLOCKED' ? 1 : 0, unknownCount: 0, humanStop: ['PAUSED', 'ABORTED'].includes(state) },
        contract: { release: '1.4.0', scope: {}, acceptance: [{ id: 'verify', command: 'npm run release:verify', cwd: '.' }], budgets: { maxFixCycles: 2 } },
        issues: { counts: { BLOCKER: state === 'BLOCKED' ? 1 : 0, UNKNOWN: 0, NEXT: 0 }, items: [] },
        evidenceFresh: ['SHIPPABLE', 'CLOSED'].includes(state),
      };
  const brief = compilePlainBrief(input);
  return { state, healthy: brief.quality.healthy, nextAction: brief.actionEnvelope.nextAction, sections: [brief.problems.length, brief.improvements.length, brief.nextPlan.length, brief.summary.text.length > 0] };
});

const skill = await readFile(new URL('../packages/shipping-plugin/skill/SKILL.md', import.meta.url), 'utf8');
const compilerSource = await readFile(new URL('../src/core/plain-brief.mjs', import.meta.url), 'utf8');
const managedAgents = mergeAgentRules('# Existing OMP rules\n');
const schema = JSON.parse(await readFile(new URL('../schemas/v1/plain-brief.schema.json', import.meta.url), 'utf8'));
const example = JSON.parse(await readFile(new URL('../schemas/v1/examples/plain-brief.example.json', import.meta.url), 'utf8'));

const started = performance.now();
for (let index = 0; index < 2000; index += 1) compilePlainBrief(authority);
const averageCompileMs = (performance.now() - started) / 2000;

requireCondition(SHIPPING_TOOLS.length === 9, `Expected nine MCP tools, found ${SHIPPING_TOOLS.length}`);
requireCondition(SHIPPING_TOOLS.some((entry) => entry.name === 'shipping_refine'), 'shipping_refine is missing');
requireCondition(new Set(variants.map((entry) => entry.hash)).size === 1, 'Host model labels changed the brief hash');
requireCondition(new Set(variants.map((entry) => entry.textHash)).size === 1, 'Host model labels changed the rendered text hash');
requireCondition(plainBrief.quality.healthy === true, 'Dirty baseline plain brief failed quality checks');
requireCondition(plainBrief.state === 'DIRTY_BASELINE', 'Dirty baseline authority was reinterpreted');
requireCondition(plainBrief.actionEnvelope.nextAction === 'REVIEW_BASELINE', 'Dirty baseline next action is not REVIEW_BASELINE');
requireCondition(plainBrief.userAction.exactPhrase === '이 기준선만 보존해.', 'Exact beginner phrase is missing');
for (const heading of ['문제점', '개선안', '다음 진행 플랜', '요약']) requireCondition(plainBrief.renderedText.includes(`## ${heading}`), `Missing heading: ${heading}`);
requireCondition(!plainBrief.renderedText.includes('runtime/apps/web/tests/auth.spec.ts'), 'Exact paths leaked into default beginner text');
requireCondition(stateMatrix.every((entry) => entry.healthy && entry.sections.every(Boolean)), 'One or more states failed the fixed-section matrix');
requireCondition(averageCompileMs < 5, `Average compile latency ${averageCompileMs.toFixed(3)}ms exceeded 5ms`);
for (const forbidden of ['node:child_process', 'node:http', 'node:https', 'node:net', 'fetch(', 'runGit(', 'openai', 'anthropic', 'gemini']) {
  requireCondition(!compilerSource.includes(forbidden), `Plain compiler contains forbidden dependency: ${forbidden}`);
}
requireCondition(skill.includes('plainBriefText') && skill.includes('AI 참고 의견'), 'OMP Skill does not enforce the plain-brief presentation contract');
requireCondition(managedAgents.includes('plainBriefText') && managedAgents.includes('AI 참고 의견'), 'Managed AGENTS block does not enforce the plain-brief presentation contract');
requireCondition(schema.$id?.endsWith('/plain-brief.schema.json'), 'Plain brief schema ID is invalid');
requireCondition(example.schema === 'shipping-harness/plain-brief-v1' && example.quality?.healthy === true, 'Plain brief example is invalid');

const result = {
  schema: 'shipping-harness/plain-brief-pilot-v1',
  status: 'PASS',
  checkedAt: new Date().toISOString(),
  tools: SHIPPING_TOOLS.length,
  refinement: SHIPPING_TOOLS.some((entry) => entry.name === 'shipping_refine'),
  stateCount: stateMatrix.length,
  stateMatrix,
  modelVariants: hostVariants.length,
  briefHashStable: new Set(variants.map((entry) => entry.hash)).size === 1,
  textHashStable: new Set(variants.map((entry) => entry.textHash)).size === 1,
  averageCompileMs,
  maxCompileMs: 5,
  renderedBytes: plainBrief.quality.renderedBytes,
  structuredBytes: plainBrief.quality.structuredBytes,
  requiredHeadings: ['문제점', '개선안', '다음 진행 플랜', '요약'],
  oneNextAction: plainBrief.actionEnvelope.nextAction,
  exactUserPhrase: plainBrief.userAction.exactPhrase,
  noAdditionalModelCall: true,
  noAdditionalGitProcess: true,
  noNetwork: true,
  paperthinRuntimeDependency: false,
  ompPresentationContract: 'PASS',
  publicPublish: false,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (check && result.status !== 'PASS') process.exitCode = 1;
