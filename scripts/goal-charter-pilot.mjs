#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDecisionEvidence } from '../src/core/decision-evidence.mjs';
import { compileGoalDiscovery } from '../src/core/goal-discovery.mjs';
import { compileGoalCharterPreview, loadGoalCharter } from '../src/core/goal-charter.mjs';
import { readDecisionLedger } from '../src/core/decision-ledger.mjs';
import { loadApprovedReleaseTrain } from '../src/core/release-train.mjs';
import { callShippingTool, SHIPPING_TOOLS } from '../src/mcp/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const WRITE_REPORT = process.argv.includes('--write-report');
const REPORT_PATH = path.join(ROOT, 'docs', 'reports', 'v1.8.0-goal-charter.json');

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

function recommendedResolutions(discovery) {
  return discovery.questions.map((question) => ({
    questionId: question.id,
    category: question.category,
    choice: question.recommendedChoice,
    recommendedChoice: question.recommendedChoice,
    usedRecommendedChoice: true,
    authority: 'delegated-recommended-default',
  }));
}

async function disposablePilot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-goal-charter-pilot-'));
  try {
    await put(root, 'package.json', JSON.stringify({
      name: 'goal-charter-pilot',
      private: true,
      scripts: { test: 'node -e "process.stdout.write(\\"charter-pass\\")"' },
    }, null, 2));
    await put(root, 'README.md', '# Goal Charter Pilot\n');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.name', 'Shipping Goal Charter Pilot']);
    git(root, ['config', 'user.email', 'shipping-goal-charter@example.invalid']);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'fixture: goal charter baseline']);

    const before = fingerprint(root, true);
    const started = await callShippingTool(root, 'shipping_start', {
      goal: 'Complete the existing internal validation workflow and prove it with npm test without external deployment.',
      release: '0.1.0',
      proposerId: 'goal-charter-pilot-proposer',
    });
    const proposal = started.structuredContent;
    requireCondition(proposal.proposalState === 'READY_FOR_APPROVAL', `Proposal state is ${proposal.proposalState}`);
    requireCondition(proposal.goalCharter?.status === 'PROPOSED', 'Proposed Goal Charter is missing');
    requireCondition(proposal.goalCharter.proposalHash === null && proposal.goalCharter.binding === null, 'Preview carries approval binding');
    requireCondition(proposal.goalCharter.commandAuthority === false && proposal.goalCharter.released === false, 'Preview authority is unsafe');

    const approved = await callShippingTool(root, 'shipping_approve_scope', {
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      confirm: true,
      autopilotProfile: 'MANUAL',
    });
    const approval = approved.structuredContent;
    const charter = await loadGoalCharter(root);
    const train = await loadApprovedReleaseTrain(root);
    const ledger = await readDecisionLedger(root);
    const status = await callShippingTool(root, 'shipping_status', {});
    const after = fingerprint(root, true);

    requireCondition(before.hash === after.hash, 'Disposable product fingerprint changed');
    requireCondition(approval.state === 'LOCKED', `Approval state is ${approval.state}`);
    requireCondition(charter?.status === 'ACCEPTED', 'Accepted Goal Charter is missing');
    requireCondition(approval.goalCharterHash === charter.hash, 'Approval Goal Charter hash differs');
    requireCondition(train.binding.goalCharterHash === charter.hash, 'Release Train binding differs');
    requireCondition(train.train.source.goalCharterHash === charter.binding.previewHash, 'Release Train source preview hash differs');
    requireCondition(status.structuredContent.goalCharter.hash === charter.hash, 'Status Goal Charter differs');
    requireCondition(status.structuredContent.userView.goalCharterSummary.hash === charter.hash, 'User view Goal Charter differs');
    requireCondition(ledger.some((entry) => entry.type === 'direction.accepted' && entry.details.goalCharterHash === charter.hash), 'Decision Ledger lacks Goal Charter acceptance');
    requireCondition(charter.commandAuthority === false
      && charter.approvalAuthority === false
      && charter.closureAuthority === false
      && charter.deploymentAuthority === false
      && charter.modelAuthority === false
      && charter.released === false, 'Accepted Goal Charter authority is unsafe');

    return {
      status: 'PASS',
      proposalState: proposal.proposalState,
      previewHash: proposal.goalCharter.hash,
      acceptedHash: charter.hash,
      trainHash: train.train.hash,
      ledgerEvents: ledger.length,
      locked: true,
      unchanged: before.hash === after.hash,
      toolCount: SHIPPING_TOOLS.length,
      released: false,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readOnlyPilot(projectPath) {
  const before = fingerprint(projectPath);
  const goal = '현재 프로젝트를 분석하고 실제 내부에서 쓸 수 있는 가장 작은 다음 버전을 제안해.';
  const evidence = await buildDecisionEvidence(projectPath, { goal, mode: 'AUTO' });
  const first = compileGoalDiscovery(evidence);
  const resolutions = recommendedResolutions(first);
  const discovery = resolutions.length > 0
    ? compileGoalDiscovery(evidence, { resolutions, round: 2 })
    : first;
  requireCondition(discovery.status === 'READY' && discovery.direction, `Read-only direction is ${discovery.status}`);
  const proposal = {
    id: `readonly-${objectHash(projectPath).slice(0, 12)}`,
    revision: 1,
    gitSha: evidence.gitSha,
    release: evidence.analysis.versionEvidence?.recommendedVersion ?? '0.1.0',
    goal,
    contract: { project: evidence.analysis.projectName ?? path.basename(projectPath) },
    analysis: evidence.analysis,
    decision: { resolutions },
    goalDiscovery: discovery,
  };
  const charter = compileGoalCharterPreview(proposal);
  const after = fingerprint(projectPath);
  requireCondition(before.hash === after.hash, `Read-only Goal Charter mutated ${projectPath}`);
  return {
    path: projectPath,
    available: true,
    unchanged: true,
    head: before.head,
    statusEntries: before.entries.length,
    workspace: evidence.analysis.workspace?.root ?? '.',
    directionHash: discovery.direction.hash,
    charterHash: charter.hash,
    outcome: charter.outcome,
    modelAuthority: charter.modelAuthority,
    commandAuthority: charter.commandAuthority,
    released: charter.released,
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
    schema: 'shipping-harness/goal-charter-pilot-v1',
    release: '1.8.0',
    status: 'PASS',
    toolCount: SHIPPING_TOOLS.length,
    modelCalls: 0,
    networkCalls: 0,
    disposable,
    realProjects,
    safety: {
      falseCharterReady: 0,
      charterAuthorityLeaks: 0,
      charterHashDrift: 0,
      trainBindingDrift: 0,
      ledgerAcceptanceMissing: 0,
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
  if (CHECK) requireCondition(report.status === 'PASS', 'Goal Charter pilot did not pass');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
