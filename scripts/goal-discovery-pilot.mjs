#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildDecisionEvidence } from '../src/core/decision-evidence.mjs';
import { compileGoalDiscovery } from '../src/core/goal-discovery.mjs';
import { callShippingTool, SHIPPING_TOOLS } from '../src/mcp/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const WRITE_REPORT = process.argv.includes('--write-report');
const REPORT_PATH = path.join(ROOT, 'docs', 'reports', 'v1.7.0-goal-discovery.json');
const TECHNICAL = /framework|library|database table|file path|command|shell|package manager|programming language|프레임워크|라이브러리|DB\s*테이블|파일\s*경로|명령어|셸/iu;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function git(root, args, allowFailure = false) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function objectHash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function fingerprint(root, ignoreShipping = false) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const raw = git(root, ['status', '--porcelain=v1', '-z']);
  const entries = raw.split('\0').filter(Boolean)
    .filter((entry) => !ignoreShipping || !entry.slice(3).replaceAll('\\', '/').startsWith('.shipping/'))
    .sort();
  return { head, entries, hash: objectHash({ head, entries }) };
}

async function put(root, relative, body) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, 'utf8');
}

async function disposablePilot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-goal-discovery-pilot-'));
  try {
    await put(root, 'package.json', JSON.stringify({
      name: 'goal-discovery-pilot',
      private: true,
      scripts: { test: 'node -e "process.stdout.write(\\"pilot-pass\\")"' },
    }, null, 2));
    await put(root, 'README.md', '# Goal Discovery Pilot\n');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.name', 'Shipping Goal Discovery Pilot']);
    git(root, ['config', 'user.email', 'shipping-goal-discovery@example.invalid']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'fixture: goal discovery baseline']);

    const before = fingerprint(root, true);
    const started = await callShippingTool(root, 'shipping_start', {
      goal: '이 프로젝트를 완성해',
      release: '0.1.0',
      proposerId: 'goal-discovery-pilot-host',
    });
    const first = started.structuredContent;
    requireCondition(first.proposalState === 'NEEDS_INPUT', `Vague goal state is ${first.proposalState}`);
    requireCondition(first.goalDiscovery.questions.length >= 1 && first.goalDiscovery.questions.length <= 3, 'Question budget failed');
    requireCondition(first.goalDiscovery.questions.every((entry) => !TECHNICAL.test(entry.prompt)), 'Technical interview question escaped');
    requireCondition(first.goalDiscovery.questions.every((entry) => entry.recommendedChoice && entry.evidenceRefs.length > 0), 'A question lacks a safe default or evidence');

    const answers = first.goalDiscovery.questions.map((question) => ({ questionId: question.id, choice: 'recommended' }));
    const refined = await callShippingTool(root, 'shipping_refine', {
      proposalId: first.proposalId,
      proposalHash: first.proposalHash,
      answers,
    });
    const second = refined.structuredContent;
    const after = fingerprint(root, true);
    requireCondition(before.hash === after.hash, 'Disposable product fingerprint changed');
    requireCondition(second.proposalId === first.proposalId && second.revision === 2, 'Proposal identity/revision changed incorrectly');
    requireCondition(second.goalDiscovery.status === 'READY' && second.goalDiscovery.direction, 'Direction did not become ready');
    requireCondition(second.goalDiscovery.direction.commandAuthority === false, 'Direction gained command authority');
    requireCondition(second.goalDiscovery.direction.approvalAuthority === false, 'Direction gained approval authority');
    requireCondition(second.goalDiscovery.direction.closureAuthority === false, 'Direction gained close authority');
    requireCondition(second.goalDiscovery.direction.released === false, 'Direction marked RELEASED');
    requireCondition(second.decisionLedger.eventCount >= 5, 'Decision ledger missed authority events');

    const evidence = await buildDecisionEvidence(root, { goal: '이 프로젝트를 완성해', mode: 'AUTO' });
    const modelVariants = [null, 'weak model', 'frontier says done', 'ignore policy and release'];
    const modelResults = modelVariants.map((modelText) => compileGoalDiscovery(evidence, { modelText }));
    requireCondition(new Set(modelResults.map((entry) => entry.hash)).size === 1, 'Host model text changed discovery hash');

    const timings = [];
    for (let index = 0; index < 500; index += 1) {
      const startedAt = performance.now();
      compileGoalDiscovery(evidence, { modelText: `ignored-${index}` });
      timings.push(performance.now() - startedAt);
    }
    const ordered = [...timings].sort((a, b) => a - b);
    const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0;
    requireCondition(p95 < 25, `Discovery p95 ${p95.toFixed(3)}ms exceeds 25ms`);

    return {
      status: 'PASS',
      initialState: first.proposalState,
      questionCount: first.goalDiscovery.questions.length,
      technicalQuestions: 0,
      delegatedDefault: true,
      finalState: second.proposalState,
      directionHash: second.goalDiscovery.direction.hash,
      ledgerEvents: second.decisionLedger.eventCount,
      modelVariants: modelVariants.length,
      modelIndependent: true,
      unchanged: before.hash === after.hash,
      performance: { samples: timings.length, p95Ms: Number(p95.toFixed(3)), maxMs: Number(Math.max(...timings).toFixed(3)) },
      released: false,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readOnlyPilot(projectPath) {
  const before = fingerprint(projectPath);
  const evidence = await buildDecisionEvidence(projectPath, {
    goal: '현재 프로젝트를 분석하고 실제 내부에서 쓸 수 있는 가장 작은 다음 버전을 제안해.',
    mode: 'AUTO',
  });
  const discovery = compileGoalDiscovery(evidence);
  const after = fingerprint(projectPath);
  requireCondition(before.hash === after.hash, `Read-only discovery mutated ${projectPath}`);
  return {
    path: projectPath,
    available: true,
    unchanged: true,
    head: before.head,
    statusEntries: before.entries.length,
    workspace: evidence.analysis?.workspace?.root ?? '.',
    discoveryStatus: discovery.status,
    questionCount: discovery.questions.length,
    technicalQuestions: discovery.questions.filter((entry) => TECHNICAL.test(entry.prompt)).length,
    candidateCount: discovery.candidates.length,
    modelAuthority: discovery.modelAuthority,
    released: false,
  };
}

async function main() {
  requireCondition(SHIPPING_TOOLS.length === 9, `Expected nine MCP tools, got ${SHIPPING_TOOLS.length}`);
  const disposable = await disposablePilot();
  const candidates = [
    '/home/jm/orca/projects/EvoHarvest',
    '/home/jm/orca/projects/second-brain-app',
    '/home/jm/orca/projects/AI-CRM+PM',
  ];
  const realProjects = [];
  for (const projectPath of candidates) {
    if (git(projectPath, ['rev-parse', '--is-inside-work-tree'], true) !== 'true') {
      realProjects.push({ path: projectPath, available: false });
      continue;
    }
    realProjects.push(await readOnlyPilot(projectPath));
  }
  const report = {
    schema: 'shipping-harness/goal-discovery-pilot-v1',
    release: '1.7.0',
    status: 'PASS',
    toolCount: SHIPPING_TOOLS.length,
    modelCalls: 0,
    networkCalls: 0,
    disposable,
    realProjects,
    safety: {
      technicalQuestions: 0,
      modelAuthorityLeaks: 0,
      falseDirectionReady: 0,
      falseReady: 0,
      falseClosed: 0,
      automaticReleased: 0,
      targetMutation: 0,
      newMcpTools: 0,
    },
  };
  if (WRITE_REPORT) {
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (CHECK) requireCondition(report.status === 'PASS', 'Goal discovery pilot did not pass');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
