#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { buildDecisionEvidence } from '../src/core/decision-evidence.mjs';
import { hashObject } from '../src/core/crypto.mjs';
import { compilePlainBrief } from '../src/core/plain-brief.mjs';
import { runGit } from '../src/core/git.mjs';

const target = path.resolve(process.env.EVOHARVEST_ROOT ?? '/home/jm/orca/projects/EvoHarvest');
const check = process.argv.includes('--check');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(args, maxBuffer = 64 * 1024 * 1024) {
  const result = runGit(target, args, { allowFailure: true, maxBuffer });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.slice(-1000)}`);
  return result.stdout;
}

function fingerprint() {
  return hashObject({
    head: git(['rev-parse', 'HEAD']).trim(),
    status: git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], 8 * 1024 * 1024),
    unstaged: sha256(git(['diff', '--binary', '--no-ext-diff'])),
    staged: sha256(git(['diff', '--cached', '--binary', '--no-ext-diff'])),
  });
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

await stat(path.join(target, '.git'));
const before = fingerprint();
const goal = 'Define the smallest operable EvoHarvest patch release without starting development, changing the existing baseline, or claiming unverified production readiness.';
const evidence = await buildDecisionEvidence(target, { goal, mode: 'AUTO' });
const after = fingerprint();
const intelligence = evidence.intelligence;
const commands = intelligence.acceptanceCommands;
const stacks = new Set([
  intelligence.componentGraph.primaryStack,
  ...intelligence.componentGraph.supportingStacks,
].filter(Boolean));
const themeText = intelligence.workThemes.map((entry) => entry.title).join(' ').toLowerCase();
const verify = commands.find((entry) => entry.command === 'make verify');
const pack = commands.find((entry) => entry.command === 'make package');
const plainInput = {
  canonicalState: 'DIRTY_BASELINE',
  release: evidence.analysis.versionEvidence?.recommendedVersion ?? null,
  goal,
  readyForApproval: false,
  proposalId: 'evoharvest-read-only-pilot',
  proposalRevision: 1,
  baseline: evidence.baseline,
  workspace: evidence.analysis.workspace,
  versionEvidence: evidence.analysis.versionEvidence,
  intelligence,
};
const plainVariants = [null, 'weak', 'strong'].map((hostModel) => compilePlainBrief({ ...plainInput, hostModel }));
const plainBrief = plainVariants[0];

requireCondition(before === after, 'EvoHarvest Git/source fingerprint changed during the read-only pilot');
requireCondition(evidence.analysis.workspace?.root === 'evoharvest-runtime-v1.1.0', `Unexpected workspace: ${evidence.analysis.workspace?.root}`);
for (const stack of ['python', 'node', 'playwright', 'alembic', 'shell']) requireCondition(stacks.has(stack), `Missing mixed-stack evidence: ${stack}`);
requireCondition(intelligence.workThemes.length > 0 && intelligence.workThemes.length <= 3, 'Work themes are missing or unbounded');
requireCondition(/authentication/u.test(themeText), 'Authentication work theme was not detected');
requireCondition(/packaging|release/u.test(themeText), 'Release packaging work theme was not detected');
requireCondition(intelligence.goalRecommendation?.authority === 'recommendation-only', 'Goal recommendation authority is unsafe');
requireCondition(intelligence.goalRecommendation?.explicitUserGoalWins === true, 'Explicit user goal does not win');
requireCondition(evidence.goal === goal, 'Pilot user goal changed');
requireCondition(evidence.baseline.blockingCount > 0, 'The known EvoHarvest dirty baseline was not detected');
requireCondition(intelligence.acceptanceCoverage.complete === true, `Uncovered EvoHarvest paths: ${intelligence.acceptanceCoverage.uncoveredPaths.join(', ')}`);
requireCondition(verify?.cwd === 'evoharvest-runtime-v1.1.0', 'make verify cwd is not bound to the runtime workspace');
requireCondition(pack?.cwd === 'evoharvest-runtime-v1.1.0', 'make package cwd is not bound to the runtime workspace');
requireCondition(pack?.sideEffect === 'generated-artifacts' && pack?.isolationRequired === true && pack?.deterministicOutputRequired === true, 'make package isolation policy is incomplete');
requireCondition(evidence.sourceChanges.every((entry) => !entry.startsWith('.shipping/')), 'Shipping runtime leaked into product dirty paths');
requireCondition(plainBrief.quality?.healthy === true, 'EvoHarvest plain brief failed the deterministic quality gate');
requireCondition(plainBrief.state === 'DIRTY_BASELINE', `Unexpected plain brief state: ${plainBrief.state}`);
requireCondition(plainBrief.actionEnvelope?.nextAction === 'REVIEW_BASELINE', 'EvoHarvest plain brief has an unsafe next action');
requireCondition(plainBrief.userAction?.exactPhrase === '이 기준선만 보존해.', 'EvoHarvest exact user phrase is missing');
for (const heading of ['문제점', '개선안', '다음 진행 플랜', '요약']) requireCondition(plainBrief.renderedText.includes(`## ${heading}`), `EvoHarvest plain brief missing heading: ${heading}`);
requireCondition(!plainBrief.renderedText.includes('evoharvest-runtime-v1.1.0/apps/web/playwright.config.ts'), 'Exact target paths leaked into the default beginner brief');
requireCondition(new Set(plainVariants.map((entry) => entry.hash)).size === 1, 'Host model label changed the EvoHarvest plain brief hash');
requireCondition(new Set(plainVariants.map((entry) => entry.textHash)).size === 1, 'Host model label changed the EvoHarvest plain text hash');

const result = {
  schema: 'shipping-harness/evoharvest-intelligence-pilot-v1',
  status: 'PASS',
  checkedAt: new Date().toISOString(),
  target,
  targetMutation: false,
  targetApproval: false,
  targetExecution: false,
  fingerprint: before,
  gitSha: evidence.gitSha,
  dirtyBaseline: {
    blockingCount: evidence.baseline.blockingCount,
    counts: evidence.baseline.counts,
    recommendation: evidence.baseline.plan.recommendation,
    planHash: evidence.baseline.plan.hash,
  },
  workspace: evidence.analysis.workspace,
  versionEvidence: evidence.analysis.versionEvidence,
  componentGraph: intelligence.componentGraph,
  workThemes: intelligence.workThemes,
  goal: {
    explicit: evidence.goal,
    recommendation: intelligence.goalRecommendation,
  },
  coverage: {
    complete: intelligence.acceptanceCoverage.complete,
    coveredPaths: intelligence.acceptanceCoverage.coveredPaths,
    totalPaths: intelligence.acceptanceCoverage.totalPaths,
    uncoveredPaths: intelligence.acceptanceCoverage.uncoveredPaths,
  },
  acceptance: commands.map((entry) => ({
    id: entry.id,
    command: entry.command,
    cwd: entry.cwd,
    sideEffect: entry.sideEffect,
    isolationRequired: entry.isolationRequired,
    deterministicOutputRequired: entry.deterministicOutputRequired,
  })),
  plainBrief: {
    schema: plainBrief.schema,
    state: plainBrief.state,
    headline: plainBrief.headline,
    requiredSections: {
      problems: plainBrief.problems.length,
      improvements: plainBrief.improvements.length,
      nextPlan: plainBrief.nextPlan.length,
      summary: Boolean(plainBrief.summary?.text),
    },
    nextAction: plainBrief.actionEnvelope.nextAction,
    exactUserPhrase: plainBrief.userAction.exactPhrase,
    hash: plainBrief.hash,
    textHash: plainBrief.textHash,
    modelIndependent: new Set(plainVariants.map((entry) => entry.hash)).size === 1,
    quality: plainBrief.quality,
    renderedText: plainBrief.renderedText,
  },
  publicPublish: false,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (check && result.status !== 'PASS') process.exitCode = 1;
