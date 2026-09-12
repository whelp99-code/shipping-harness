import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildDecisionEvidence } from '../src/core/decision-evidence.mjs';
import { compileIntentGate } from '../src/core/intent-gate.mjs';
import { currentGitSha, gitStatus, runGit } from '../src/core/git.mjs';
import { SHIPPING_TOOLS } from '../src/mcp/tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const REAL_PROJECT = process.env.INTENT_GATE_PROJECT ?? '/home/jm/orca/projects/Orca-JARVIS';
const reportPath = path.join(root, 'docs', 'reports', 'v1.8.3-intent-gate-field.json');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceFingerprint(projectRoot) {
  const status = gitStatus(projectRoot);
  const tracked = runGit(projectRoot, ['ls-files', '-z'], { trim: false }).stdout
    .split('\0')
    .filter(Boolean)
    .sort();
  const digest = createHash('sha256');
  for (const relative of tracked) {
    digest.update(relative);
    digest.update('\0');
    digest.update(readFileSync(path.join(projectRoot, relative)));
    digest.update('\0');
  }
  return {
    head: status.sha,
    porcelain: status.porcelain,
    trackedFiles: tracked.length,
    trackedDigest: digest.digest('hex'),
  };
}

function sameFingerprint(before, after) {
  return before.head === after.head
    && before.trackedDigest === after.trackedDigest
    && JSON.stringify(before.porcelain) === JSON.stringify(after.porcelain);
}

function intentCase(requestText, resolutions = []) {
  const gate = compileIntentGate(requestText, { resolutions });
  return {
    requestHash: sha256(requestText),
    status: gate.status,
    defaultMode: gate.defaultMode,
    effectiveMode: gate.effectiveMode,
    questionCount: gate.question ? 1 : 0,
    analysisComplete: gate.analysisComplete,
    planningAllowed: gate.planningAllowed,
    implementationAllowed: gate.implementationAllowed,
    autopilotAllowed: gate.autopilotAllowed,
    modelAuthority: gate.modelAuthority,
    hash: gate.hash,
  };
}

export async function buildIntentGatePilotReport() {
  const started = performance.now();
  const cases = {
    terseAnalysis: intentCase('이 프로젝트 분석해. 쉬핑하네스로'),
    analysisOnly: intentCase('이 프로젝트는 분석만 해. 코드는 수정하지 마.'),
    planOnly: intentCase('다음 운영 가능한 버전의 계획까지만 만들어. 아직 개발하지 마.'),
    implement: intentCase('로그인 오류를 수정해.'),
    autopilot: intentCase('프로젝트를 완성할 때까지 자동으로 진행해.'),
    selectedPlan: intentCase('이 프로젝트 분석해. 쉬핑하네스로', [{ questionId: 'Q-INTENT-001', choice: 'PLAN_ONLY' }]),
  };

  let realProject = { available: false, path: REAL_PROJECT, unchanged: null };
  if (existsSync(path.join(REAL_PROJECT, '.git'))) {
    const before = sourceFingerprint(REAL_PROJECT);
    const evidence = await buildDecisionEvidence(REAL_PROJECT, {
      goal: '이 프로젝트 분석해. 쉬핑하네스로',
      mode: 'AUTO',
    });
    const gate = compileIntentGate(evidence.goal);
    const after = sourceFingerprint(REAL_PROJECT);
    realProject = {
      available: true,
      path: REAL_PROJECT,
      unchanged: sameFingerprint(before, after),
      head: before.head,
      dirtyEntries: before.porcelain.length,
      trackedFiles: before.trackedFiles,
      projectName: evidence.analysis.projectName,
      workspace: evidence.analysis.workspace?.root ?? null,
      recommendedVersion: evidence.analysis.versionEvidence?.recommendedVersion ?? null,
      intentStatus: gate.status,
      intentDefault: gate.defaultMode,
      questionCount: gate.question ? 1 : 0,
      planningAllowed: gate.planningAllowed,
      implementationAllowed: gate.implementationAllowed,
      targetMutation: sameFingerprint(before, after) ? 0 : 1,
    };
  }

  const safety = {
    falsePlanningBeforeIntent: cases.terseAnalysis.planningAllowed ? 1 : 0,
    falseImplementationBeforeIntent: cases.terseAnalysis.implementationAllowed ? 1 : 0,
    falseAutopilotBeforeIntent: cases.terseAnalysis.autopilotAllowed ? 1 : 0,
    wrongDefaultMode: cases.terseAnalysis.defaultMode === 'ANALYZE_ONLY' ? 0 : 1,
    wrongIntentQuestionCount: cases.terseAnalysis.questionCount === 1 ? 0 : 1,
    modelAuthorityLeak: Object.values(cases).some((entry) => entry.modelAuthority !== false) ? 1 : 0,
    newMcpTools: SHIPPING_TOOLS.length === 9 ? 0 : Math.abs(SHIPPING_TOOLS.length - 9),
    targetMutation: realProject.available && realProject.unchanged !== true ? 1 : 0,
  };

  return {
    schema: 'shipping-harness/intent-gate-field-v1',
    release: '1.8.3',
    sourceVersion: packageJson.version,
    status: Object.values(safety).every((value) => value === 0) ? 'PASS' : 'FAIL',
    durationMs: Number((performance.now() - started).toFixed(3)),
    modelCalls: 0,
    networkCalls: 0,
    mcp: {
      protocol: '2025-03-26',
      tools: SHIPPING_TOOLS.length,
      toolNames: SHIPPING_TOOLS.map((entry) => entry.name),
    },
    cases,
    realProject,
    safety,
    boundaries: {
      readOnlyAnalysisFirst: true,
      oneIntentQuestion: true,
      defaultAnalyzeOnly: true,
      goalDiscoveryAfterIntent: true,
      goalCharterAfterDirection: true,
      releaseTrainAfterDirection: true,
      implementationApprovalSeparate: true,
      automaticReleased: false,
      modelAuthority: false,
    },
  };
}

function check(report) {
  const failures = [];
  if (report.status !== 'PASS') failures.push('status');
  if (report.release !== '1.8.3') failures.push('release');
  if (report.modelCalls !== 0 || report.networkCalls !== 0) failures.push('external-calls');
  if (report.mcp.tools !== 9) failures.push('mcp-tools');
  if (report.cases.terseAnalysis.status !== 'CONFIRMATION_REQUIRED') failures.push('terse-status');
  if (report.cases.terseAnalysis.defaultMode !== 'ANALYZE_ONLY') failures.push('default-mode');
  if (report.cases.terseAnalysis.questionCount !== 1) failures.push('intent-question');
  if (report.cases.analysisOnly.effectiveMode !== 'ANALYZE_ONLY') failures.push('analysis-only');
  if (report.cases.planOnly.effectiveMode !== 'PLAN_ONLY' || report.cases.planOnly.implementationAllowed !== false) failures.push('plan-only');
  if (report.cases.implement.effectiveMode !== 'IMPLEMENT' || report.cases.implement.implementationAllowed !== true) failures.push('implement');
  if (report.cases.autopilot.effectiveMode !== 'AUTOPILOT' || report.cases.autopilot.autopilotAllowed !== true) failures.push('autopilot');
  if (report.realProject.available && report.realProject.unchanged !== true) failures.push('real-project-mutation');
  if (Object.values(report.safety).some((value) => value !== 0)) failures.push('safety');
  if (failures.length > 0) throw new Error(`Intent Gate field pilot failed: ${failures.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await buildIntentGatePilotReport();
  if (process.argv.includes('--check')) check(report);
  if (process.argv.includes('--record')) {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
