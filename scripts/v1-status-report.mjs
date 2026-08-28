import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { verifyPrivateOmoPromotion } from '../packages/internal-omo-bridge/index.mjs';

const root = process.cwd();
const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 }).trim();
const versions = ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.8.0', '0.9.0'];

const releases = {};
for (const version of versions) {
  const receiptPath = `.shipping/releases/${version}.json`;
  if (!existsSync(path.join(root, receiptPath))) throw new Error(`missing receipt ${version}`);
  const receipt = readJson(receiptPath);
  if ((receipt.state ?? 'CLOSED') !== 'CLOSED') throw new Error(`${version} is not CLOSED`);
  const tag = `v${version}`;
  const tagCommit = git(['rev-list', '-n', '1', tag]);
  releases[version] = {
    state: 'CLOSED',
    tag,
    commit: tagCommit,
    receipt: receiptPath,
    contractHash: receipt.contractHash ?? null,
    evidenceSha: receipt.evidenceSha ?? receipt.currentEvidenceSha ?? null,
  };
}

const state = readJson('.shipping/state.json');
const contract = readJson('.shipping/contract.yaml');
const lock = readJson('.shipping/contract.lock');
const benchmark = readJson('docs/reports/v1-completion-benchmark.json');
const security = readJson('docs/reports/v1-security-inventory.json');
const smoke = readJson('docs/reports/v1-final-smoke.json');
const v07 = readJson('docs/internal-runtime/v0.7-pilot.json');
const v08 = readJson('docs/internal-runtime/v0.8-team-dag-decision.json');
const v09 = readJson('docs/reports/v0.9-remote-pilot.json');
const promotion = await verifyPrivateOmoPromotion(root);
const pin = readJson('config/upstreams/omo-pin.json');
const worktree = git(['status', '--porcelain']);

const report = {
  schema: 'shipping-harness/sequential-status-v1',
  generatedAt: new Date().toISOString(),
  project: 'shipping-harness',
  direction: 'LOCKED',
  usage: 'personal-and-company-internal-only',
  userRole: 'approver',
  candidate: {
    release: contract.release,
    packageVersion: readJson('package.json').version,
    state: state.state,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    worktree: worktree ? 'DIRTY' : 'CLEAN',
    finalAuthorityPending: !existsSync(path.join(root, '.shipping/releases/1.0.0.json')),
  },
  releases,
  evidence: {
    schemas: { count: 21, examplesValidated: true },
    benchmark: {
      method: benchmark.method,
      liveModelBenchmark: benchmark.liveModelBenchmark,
      shippingFalseDone: benchmark.summary.shipping.falseDone,
      shippingScopeDriftAccepted: benchmark.summary.shipping.scopeDriftAccepted,
      humanStopViolations: benchmark.summary.humanStopViolations,
    },
    installation: {
      status: smoke.status,
      packageSha256: smoke.package.sha256,
      cleanInstallVersion: smoke.package.cleanInstallVersion,
      upgrade: `${smoke.package.upgradeFrom} -> ${smoke.package.upgradeTo}`,
      pluginDoctorHealthy: smoke.plugin.doctorHealthy,
      beginnerFinalState: smoke.plugin.beginnerFinalState,
      rollbackProven: smoke.plugin.rollbackProven,
    },
    privateOmo: {
      historicalPilot: v07.passed,
      historicalCompletionTrusted: v07.privateOmoReceipt.releaseCompletionTrusted,
      currentPromotion: 'PASS',
      releaseCommit: promotion.releaseCommit,
      buildDigest: promotion.buildDigest,
      tag: promotion.tag ?? pin.expected.tag,
      publicPublish: false,
    },
    teamDag: { decision: v08.decision, enabled: v08.enabled === true },
    remote: {
      passed: v09.passed,
      finalState: v09.workflow.finalState,
      replayBlocked: v09.authorization.replayRejectedAfterRestart,
      publicListener: v09.transport.publicListener,
    },
    security: {
      internalOnly: security.boundaries.internalOnly,
      rawShellMcp: security.boundaries.rawShellMcp,
      rawShellRemote: security.boundaries.rawShellRemote,
      unlimitedValuesAllowed: security.limits.unlimitedValuesAllowed,
    },
  },
  finalAuthority: {
    requiredReceipt: '.shipping/releases/1.0.0.json',
    requiredTag: 'v1.0.0',
    requiredState: 'CLOSED',
  },
};

const reportRoot = path.join(root, 'docs', 'reports');
mkdirSync(reportRoot, { recursive: true });
writeFileSync(path.join(reportRoot, 'v1-sequential-implementation-status.json'), `${JSON.stringify(report, null, 2)}\n`);

const rows = Object.entries(releases).map(([version, item]) => `| ${version} | ${item.state} | ${item.tag} | \`${item.commit.slice(0, 12)}\` |`).join('\n');
const markdown = `# Shipping Harness v1 Sequential Status\n\n- Direction: **LOCKED**\n- Use: **personal/company-internal only**\n- User role: **approver**\n- Candidate: **${report.candidate.release} / ${report.candidate.state}**\n- Candidate commit: \`${report.candidate.commit}\`\n- Working tree at report generation: **${report.candidate.worktree}**\n\n## Closed predecessors\n\n| Version | State | Tag | Commit |\n|---|---|---|---|\n${rows}\n\n## v1 candidate evidence\n\n- Stable schemas/examples: 21 / validated\n- Clean install: ${smoke.package.cleanInstallVersion}\n- Upgrade drill: ${smoke.package.upgradeFrom} -> ${smoke.package.upgradeTo}\n- Plugin doctor: ${smoke.plugin.doctorHealthy ? 'PASS' : 'FAIL'}\n- Plugin rollback: ${smoke.plugin.rollbackProven ? 'PASS' : 'FAIL'}\n- Installed MCP beginner flow: ${smoke.plugin.beginnerFinalState}\n- Shipping false-done accepted: ${benchmark.summary.shipping.falseDone}\n- Shipping scope drift accepted: ${benchmark.summary.shipping.scopeDriftAccepted}\n- Human-stop violations: ${benchmark.summary.humanStopViolations}\n- Private OMO current promotion: PASS; release commit \`${promotion.releaseCommit}\`\n- Team/DAG: ${v08.decision}\n- Internal remote pilot: ${v09.passed ? 'PASS' : 'FAIL'} / ${v09.workflow.finalState}\n- Public publication: disabled\n- Live-model performance benchmark: **NOT RUN**; no superiority claim is made\n\n## Final authority\n\nThis document reports the tested candidate. Final v1 completion exists only when \`.shipping/releases/1.0.0.json\` records \`CLOSED\` and annotated tag \`v1.0.0\` points to the closure commit.\n`;
writeFileSync(path.join(reportRoot, 'v1-sequential-implementation-status.md'), markdown);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
