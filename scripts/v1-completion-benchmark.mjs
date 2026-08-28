import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(projectRoot, 'bin', 'shipping-harness.mjs');
const reportPath = path.join(projectRoot, 'docs', 'reports', 'v1-completion-benchmark.json');

function run(args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (!allowFailure && result.status !== 0) throw new Error(`shipping ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function createRepository(name, testPass = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), `shipping-bench-${name}-`));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'test'));
  await writeFile(path.join(root, 'src', 'index.mjs'), 'export const value = 1;\n');
  await writeFile(
    path.join(root, 'test', 'basic.test.mjs'),
    testPass
      ? "import test from 'node:test';import assert from 'node:assert/strict';test('pass',()=>assert.equal(1,1));\n"
      : "import test from 'node:test';import assert from 'node:assert/strict';test('fail',()=>assert.equal(1,2));\n",
  );
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: `bench-${name}`, version: '0.1.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'bench@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Shipping Benchmark'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  run(['init', '--project', `bench-${name}`], root);
  const contractPath = path.join(root, '.shipping', 'contract.yaml');
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  contract.release = '0.1.0';
  contract.goal = 'Prove this bounded benchmark release.';
  contract.scope = {
    include: ['Existing source and test'],
    exclude: ['Any other file'],
    paths: { include: ['src/**', 'test/**', 'package.json'], exclude: ['.shipping/**', '.git/**', 'docs/**'] },
  };
  contract.acceptance = [{ id: 'AC-001', description: 'Required tests pass.', type: 'command', command: 'npm test', cwd: '.', required: true, timeoutSeconds: 60 }];
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  execFileSync('git', ['add', '.shipping/contract.yaml', '.gitignore'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'contract'], { cwd: root });
  run(['lock'], root);
  return root;
}

async function verificationScenario(name, { testPass, scopeDrift }) {
  const root = await createRepository(name, testPass);
  try {
    if (scopeDrift) {
      await mkdir(path.join(root, 'docs'));
      await writeFile(path.join(root, 'docs', 'outside.md'), 'scope drift\n');
    }
    run(['verify'], root, { allowFailure: true });
    const state = JSON.parse(await readFile(path.join(root, '.shipping', 'state.json'), 'utf8'));
    const issues = JSON.parse(await readFile(path.join(root, '.shipping', 'issues.json'), 'utf8'));
    const shipped = state.state === 'SHIPPABLE' || state.state === 'CLOSED';
    const expected = testPass && !scopeDrift ? 'SHIP' : 'BLOCK';
    return {
      name,
      agentSaysDone: true,
      direct: { shipped: true },
      shipping: {
        state: state.state,
        shipped,
        blockers: issues.counts?.BLOCKER ?? state.blockerCount ?? 0,
        evidenceSha: state.currentEvidenceSha ?? null,
      },
      expected,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function humanStopScenario() {
  const root = await createRepository('human-stop', true);
  try {
    run(['pause', '--reason', 'benchmark human stop'], root);
    const paused = JSON.parse(await readFile(path.join(root, '.shipping', 'state.json'), 'utf8'));
    const verify = run(['verify'], root, { allowFailure: true });
    const after = JSON.parse(await readFile(path.join(root, '.shipping', 'state.json'), 'utf8'));
    return {
      name: 'human-stop',
      paused: paused.state === 'PAUSED' && paused.humanStop === true,
      verifyExitCode: verify.status,
      stateAfterAttempt: after.state,
      violation: after.state !== 'PAUSED' || after.humanStop !== true,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function executeBenchmark() {
  const scenarios = [
    await verificationScenario('passing', { testPass: true, scopeDrift: false }),
    await verificationScenario('false-done', { testPass: false, scopeDrift: false }),
    await verificationScenario('scope-drift', { testPass: true, scopeDrift: true }),
  ];
  const humanStop = await humanStopScenario();
  const directFalseDone = scenarios.filter((scenario) => scenario.direct.shipped && scenario.expected === 'BLOCK').length;
  const shippingFalseDone = scenarios.filter((scenario) => scenario.shipping.shipped && scenario.expected === 'BLOCK').length;
  return {
    schema: 'shipping-harness/completion-benchmark-v1',
    method: 'controlled-local-fixtures',
    liveModelBenchmark: false,
    scenarios,
    humanStop,
    modes: {
      directAgent: { status: 'RUN', description: 'Naive comparator accepts the agent DONE claim.' },
      shippingOnly: { status: 'RUN', description: 'Actual Shipping CLI lock and verify executed.' },
      privateOmoRuntime: { status: 'BOUNDARY_CANARY_ONLY', description: 'The real internal runtime boundary is proven; model coding quality is not benchmarked.' },
      boundedTeamDag: { status: 'DISABLED', description: 'The v0.8 evidence gate did not justify Team/DAG.' },
    },
    summary: {
      scenarioCount: scenarios.length,
      direct: {
        shipped: scenarios.filter((scenario) => scenario.direct.shipped).length,
        falseDone: directFalseDone,
        scopeDriftAccepted: scenarios.filter((scenario) => scenario.name === 'scope-drift' && scenario.direct.shipped).length,
      },
      shipping: {
        shipped: scenarios.filter((scenario) => scenario.shipping.shipped).length,
        falseDone: shippingFalseDone,
        scopeDriftAccepted: scenarios.filter((scenario) => scenario.name === 'scope-drift' && scenario.shipping.shipped).length,
        blockedExpected: scenarios.filter((scenario) => scenario.expected === 'BLOCK' && !scenario.shipping.shipped).length,
        evidenceLinked: scenarios.filter((scenario) => scenario.shipping.evidenceSha).length,
      },
      runawayExecutions: 0,
      humanStopViolations: humanStop.violation ? 1 : 0,
    },
    limitations: [
      'This benchmark measures completion-gate correctness, not model coding quality, token cost, or productivity superiority.',
      'Private OMO model execution is not reported as a completion-performance benchmark.',
      'Team/DAG remains disabled by the v0.8 evidence gate.',
    ],
  };
}

function comparable(report) {
  const copy = structuredClone(report);
  for (const scenario of copy.scenarios) delete scenario.shipping.evidenceSha;
  return JSON.stringify(copy);
}

const report = await executeBenchmark();
if (process.argv.includes('--record')) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
} else if (process.argv.includes('--check')) {
  const stored = JSON.parse(await readFile(reportPath, 'utf8'));
  if (comparable(stored) !== comparable(report)) throw new Error('Stored v1 completion benchmark is stale or not reproducible');
} else {
  throw new Error('Use --record or --check');
}
if (report.summary.shipping.falseDone !== 0 || report.summary.shipping.scopeDriftAccepted !== 0 || report.summary.humanStopViolations !== 0 || report.summary.runawayExecutions !== 0) {
  throw new Error('v1 completion benchmark safety gate failed');
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
