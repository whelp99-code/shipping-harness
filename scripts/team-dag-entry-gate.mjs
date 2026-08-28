#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../src/core/git.mjs';
import { hashFile } from '../src/core/crypto.mjs';
import { loadPrivateOmoConfig, verifyPrivateOmoPromotion } from '../packages/internal-omo-bridge/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pilotPath = path.join(root, 'docs', 'internal-runtime', 'v0.7-pilot.json');
const releasePath = path.join(root, '.shipping', 'releases', '0.7.0.json');
const reportPath = path.join(root, 'docs', 'internal-runtime', 'v0.8-team-dag-decision.json');
const markdownPath = path.join(root, 'docs', 'internal-runtime', 'v0.8-team-dag-decision.md');
const forbiddenDirectories = ['packages/team-dag', 'packages/internal-team', 'packages/internal-dag'];

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function collectFiles(directory) {
  if (!(await exists(directory))) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.shipping'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectFiles(absolute));
    else if (entry.isFile() && /\.(?:mjs|js|cjs|ts|json)$/u.test(entry.name)) output.push(absolute);
  }
  return output;
}

export function decideTeamDagActivation(signals) {
  const coordination = signals.coordinationBottleneckProven === true;
  const benefit = signals.completionBenefitFromTeamDagProven === true;
  return coordination && benefit
    ? { decision: 'ELIGIBLE_FOR_SEPARATE_IMPLEMENTATION_CONTRACT', enabled: false, reason: 'Both entry signals are proven, but implementation still requires a new locked contract.' }
    : { decision: 'DISABLED', enabled: false, reason: 'The required coordination bottleneck and completion-benefit signals were not both proven.' };
}

async function inspectSource() {
  const presentForbiddenDirectories = [];
  for (const relative of forbiddenDirectories) if (await exists(path.join(root, relative))) presentForbiddenDirectories.push(relative);
  const files = [...await collectFiles(path.join(root, 'src')), ...await collectFiles(path.join(root, 'packages')), ...await collectFiles(path.join(root, 'config'))];
  const enabledMarkers = [];
  for (const absolute of files) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    const text = await readFile(absolute, 'utf8');
    const patterns = [
      /teamMode\s*[:=]\s*true/gu,
      /dagMode\s*[:=]\s*true/gu,
      /"teamMode"\s*:\s*true/gu,
      /"dagMode"\s*:\s*true/gu,
      /unlimitedValuesAllowed\s*[:=]\s*true/gu,
      /"unlimitedValuesAllowed"\s*:\s*true/gu,
    ];
    if (patterns.some((pattern) => pattern.test(text))) enabledMarkers.push(relative);
  }
  return {
    forbiddenDirectories,
    presentForbiddenDirectories,
    enabledMarkers: [...new Set(enabledMarkers)].sort(),
    scannedFiles: files.length,
    teamDagSourcePresent: presentForbiddenDirectories.length > 0,
    teamDagEnabledMarkerPresent: enabledMarkers.length > 0,
  };
}

export async function buildTeamDagDecision() {
  const [pilot, release, config, promotion, source] = await Promise.all([
    readFile(pilotPath, 'utf8').then(JSON.parse),
    readFile(releasePath, 'utf8').then(JSON.parse),
    loadPrivateOmoConfig(root),
    verifyPrivateOmoPromotion(root),
    inspectSource(),
  ]);
  const signals = {
    coordinationBottleneckProven: pilot.entryGate?.coordinationBottleneckProven === true,
    completionBenefitFromTeamDagProven: pilot.entryGate?.completionBenefitFromTeamDagProven === true,
    parallelizableTaskCount: pilot.metrics?.parallelizableTaskCount ?? null,
    coordinationWaitCount: pilot.metrics?.coordinationWaitCount ?? null,
    repeatedReviewCount: pilot.metrics?.repeatedReviewCount ?? null,
    falseDoneCount: pilot.metrics?.falseDoneCount ?? null,
    scopeViolations: pilot.metrics?.scopeViolations ?? null,
    v07Closed: pilot.finalRelease?.state === 'CLOSED' && release.release === '0.7.0',
  };
  const activation = decideTeamDagActivation(signals);
  const bounded = {
    parallelWorkers: config.policy.parallelWorkers,
    agentDepth: config.policy.agentDepth,
    continuations: config.policy.continuations,
    fixCycles: config.policy.fixCycles,
    teamMode: config.policy.teamMode,
    dagMode: config.policy.dagMode,
    unlimitedValuesAllowed: config.policy.unlimitedValuesAllowed,
    humanStopWins: config.policy.humanStopWins,
    shippingFinisherOnly: config.policy.shippingFinisherOnly,
  };
  const head = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  return {
    schema: 'shipping-harness/team-dag-decision-v1',
    release: '0.8.0',
    generatedAt: new Date().toISOString(),
    sourceGitSha: head,
    decision: activation.decision,
    enabled: false,
    reason: activation.reason,
    activationRule: {
      requiresAll: ['coordinationBottleneckProven', 'completionBenefitFromTeamDagProven'],
      result: false,
    },
    signals,
    evidence: {
      v07Pilot: { path: path.relative(root, pilotPath).replaceAll('\\', '/'), sha256: await hashFile(pilotPath), generatedAt: pilot.generatedAt },
      v07Release: { path: path.relative(root, releasePath).replaceAll('\\', '/'), sha256: await hashFile(releasePath), closedAt: release.closedAt },
      privateRuntime: { releaseCommit: promotion.releaseCommit, buildDigest: promotion.buildDigest, runtimeVersion: promotion.runtimeVersion },
    },
    sourceInspection: source,
    preservedProfile: { name: 'private-omo-v0.7', ...bounded },
    comparison: {
      directShipping: { status: 'AVAILABLE_FALLBACK_NOT_RUN_IN_V0.7_PILOT', measuredResult: null },
      privateOmoV07: {
        status: 'MEASURED_PASS',
        completionRate: pilot.metrics.completionRate,
        durationMs: pilot.metrics.durationMs,
        humanInterventions: pilot.metrics.humanInterventions,
        falseDoneCount: pilot.metrics.falseDoneCount,
        coordinationWaitCount: pilot.metrics.coordinationWaitCount,
      },
      teamDagV08: {
        status: 'NOT_RUN_ENTRY_GATE_FAILED',
        measuredResult: null,
        inventedMetrics: false,
      },
    },
    claims: {
      selectiveRetryImplemented: false,
      graphAmendmentImplemented: false,
      orchestrationStallDetectorImplemented: false,
      teamMemberRuntimeImplemented: false,
      finisherRemainsOutsideTeam: true,
      v07FallbackPreserved: true,
      publicPublish: false,
    },
  };
}

function verifyCommon(report) {
  assert.equal(report.decision, 'DISABLED');
  assert.equal(report.enabled, false);
  assert.equal(report.activationRule.result, false);
  assert.equal(report.signals.v07Closed, true);
  assert.equal(report.signals.falseDoneCount, 0);
  assert.equal(report.signals.scopeViolations, 0);
  assert.deepEqual(report.sourceInspection.presentForbiddenDirectories, []);
  assert.deepEqual(report.sourceInspection.enabledMarkers, []);
  assert.equal(report.preservedProfile.teamMode, false);
  assert.equal(report.preservedProfile.dagMode, false);
  assert.equal(report.preservedProfile.unlimitedValuesAllowed, false);
  assert.equal(report.preservedProfile.shippingFinisherOnly, true);
  assert.equal(report.preservedProfile.humanStopWins, true);
}

export function verifyCriterion(criterion, report) {
  verifyCommon(report);
  const checks = {
    'AC-0801': () => {
      assert.equal(report.signals.coordinationBottleneckProven, false);
      assert.equal(report.signals.completionBenefitFromTeamDagProven, false);
    },
    'AC-0802': () => {
      assert.equal(report.sourceInspection.teamDagSourcePresent, false);
      assert.equal(report.claims.teamMemberRuntimeImplemented, false);
    },
    'AC-0803': () => {
      assert.equal(report.preservedProfile.name, 'private-omo-v0.7');
      assert.match(report.evidence.privateRuntime.releaseCommit, /^[0-9a-f]{40}$/u);
    },
    'AC-0804': () => assert.equal(report.claims.finisherRemainsOutsideTeam, true),
    'AC-0805': () => {
      assert.ok(report.preservedProfile.parallelWorkers <= 2);
      assert.ok(report.preservedProfile.agentDepth <= 1);
      assert.ok(report.preservedProfile.continuations <= 3);
      assert.ok(report.preservedProfile.fixCycles <= 2);
    },
    'AC-0806': () => {
      assert.equal(report.claims.selectiveRetryImplemented, false);
      assert.equal(report.claims.graphAmendmentImplemented, false);
    },
    'AC-0807': () => assert.equal(report.claims.orchestrationStallDetectorImplemented, false),
    'AC-0808': () => {
      assert.equal(report.preservedProfile.humanStopWins, true);
      assert.equal(report.signals.falseDoneCount, 0);
    },
    'AC-0809': () => {
      assert.equal(report.evidence.privateRuntime.runtimeVersion, '0.7.0');
      assert.equal(report.claims.v07FallbackPreserved, true);
    },
    'AC-0810': () => {
      assert.equal(report.preservedProfile.teamMode, false);
      assert.equal(report.preservedProfile.dagMode, false);
      assert.equal(report.claims.v07FallbackPreserved, true);
    },
    'AC-0811': () => {
      assert.equal(report.comparison.privateOmoV07.status, 'MEASURED_PASS');
      assert.equal(report.comparison.teamDagV08.status, 'NOT_RUN_ENTRY_GATE_FAILED');
      assert.equal(report.comparison.teamDagV08.inventedMetrics, false);
      assert.equal(report.comparison.directShipping.measuredResult, null);
    },
    'AC-0812': () => {
      assert.equal(report.decision, 'DISABLED');
      assert.equal(report.claims.publicPublish, false);
    },
  };
  assert.ok(checks[criterion], `Unsupported criterion: ${criterion}`);
  checks[criterion]();
  return true;
}

async function writeDecision(report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `# v0.8 Team/DAG Entry-Gate Decision\n\n- Decision: **${report.decision}**\n- Team Mode: **OFF**\n- DAG Mode: **OFF**\n- v0.7 release: CLOSED\n- Coordination bottleneck proven: ${report.signals.coordinationBottleneckProven}\n- Completion benefit proven: ${report.signals.completionBenefitFromTeamDagProven}\n- Team/DAG source added: ${report.sourceInspection.teamDagSourcePresent}\n- Invented benchmark metrics: ${report.comparison.teamDagV08.inventedMetrics}\n\n${report.reason}\n\nThe v0.7 private OMO profile remains the default. A later Team/DAG implementation requires a new real pilot and a separate locked contract.\n`, 'utf8');
}

async function main() {
  const argument = process.argv[2] ?? '--generate';
  const report = await buildTeamDagDecision();
  if (argument === '--generate') {
    verifyCommon(report);
    await writeDecision(report);
    process.stdout.write(`${JSON.stringify({ decision: report.decision, report: path.relative(root, reportPath), markdown: path.relative(root, markdownPath) }, null, 2)}\n`);
    return;
  }
  if (argument === '--verify-only') {
    const recorded = JSON.parse(await readFile(reportPath, 'utf8'));
    verifyCommon(recorded);
    assert.equal(recorded.decision, report.decision);
    assert.deepEqual(recorded.signals, report.signals);
    assert.deepEqual(recorded.preservedProfile, report.preservedProfile);
    assert.deepEqual(recorded.sourceInspection, report.sourceInspection);
    process.stdout.write(`${JSON.stringify({ status: 'PASS', decision: recorded.decision }, null, 2)}\n`);
    return;
  }
  verifyCriterion(argument, report);
  process.stdout.write(`${JSON.stringify({ criterion: argument, status: 'PASS', decision: report.decision }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
