import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGoalGraph } from '../src/core/goals/compiler.mjs';
import { createTaskEvidenceReceipt } from '../src/core/goals/freshness.mjs';
import { readyTaskIds } from '../src/core/goals/graph.mjs';
import { recoverGoalRuntime } from '../src/core/goals/recovery.mjs';
import { goalStatusView } from '../src/core/goals/status-view.mjs';
import {
  createGoalCheckpoint,
  initializeGoalRuntime,
  readGoalRuntime,
  recordTaskAttempt,
  transitionStoredGoal,
  transitionStoredTask,
} from '../src/core/goals/store.mjs';
import { currentGitSha } from '../src/core/git.mjs';

const scriptPath = fileURLToPath(import.meta.url);

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function smokeGraph() {
  return compileGoalGraph({
    project: 'goal-runtime-smoke',
    release: '0.5.0',
    goal: 'Recover interrupted work and finish from fresh evidence.',
    acceptance: [
      { id: 'AC-001', description: 'Build work completes.' },
      { id: 'AC-002', description: 'Verification work completes.' },
    ],
  }, {
    contractHash: '7'.repeat(64),
    taskSpecs: [
      {
        id: 'TASK-BUILD',
        title: 'Build the local artifact',
        consumer: { type: 'acceptance', id: 'AC-001' },
        maxAttempts: 2,
      },
      {
        id: 'TASK-VERIFY',
        title: 'Verify the local artifact',
        consumer: { type: 'acceptance', id: 'AC-002' },
        dependsOn: ['TASK-BUILD'],
        maxAttempts: 2,
      },
    ],
  });
}

async function phaseOne(root) {
  const graph = smokeGraph();
  await initializeGoalRuntime(root, graph);
  await transitionStoredGoal(root, graph.goals[0].id, 'ACTIVE');
  await transitionStoredTask(root, 'TASK-BUILD', 'READY');
  await transitionStoredTask(root, 'TASK-BUILD', 'RUNNING');
  await recordTaskAttempt(root, {
    taskId: 'TASK-BUILD',
    attemptId: 'attempt-build-001',
    command: 'node build.mjs',
    gitSha: currentGitSha(root),
    status: 'running',
  });
  await createGoalCheckpoint(root, { checkpointId: 'before-process-exit', reason: 'simulate interrupted process' });
}

async function phaseInspect(root) {
  const status = await goalStatusView(root);
  if (!status || status.goalCounts.DONE !== 1 || status.taskCounts.DONE !== 2 || status.terminal !== true) {
    throw new Error(`Recovered terminal status is invalid: ${JSON.stringify(status)}`);
  }
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

async function completeTask(root, taskId, evidenceRef) {
  const before = await readGoalRuntime(root);
  const task = before.tasks.find((candidate) => candidate.id === taskId);
  if (task.state === 'PENDING') await transitionStoredTask(root, taskId, 'READY');
  const afterReady = await readGoalRuntime(root);
  const readyTask = afterReady.tasks.find((candidate) => candidate.id === taskId);
  if (readyTask.state === 'READY') await transitionStoredTask(root, taskId, 'RUNNING');
  const afterRunning = await readGoalRuntime(root);
  const runningTask = afterRunning.tasks.find((candidate) => candidate.id === taskId);
  if (runningTask.state === 'RUNNING') await transitionStoredTask(root, taskId, 'VERIFYING');
  const verifying = await readGoalRuntime(root);
  const verifyingTask = verifying.tasks.find((candidate) => candidate.id === taskId);
  const sha = currentGitSha(root);
  const evidence = createTaskEvidenceReceipt({ graph: verifying, task: verifyingTask, gitSha: sha, evidenceRef });
  await transitionStoredTask(root, taskId, 'DONE', { currentGitSha: sha, evidence });
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-harness-goal-smoke-'));
  try {
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.name', 'Shipping Harness Goal Smoke']);
    git(root, ['config', 'user.email', 'shipping-harness-goal-smoke@example.invalid']);
    await writeFile(path.join(root, 'package.json'), '{"name":"goal-runtime-smoke","private":true}\n', 'utf8');
    await writeFile(path.join(root, 'README.md'), '# Goal runtime smoke\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'baseline']);

    const phase = spawnSync(process.execPath, [scriptPath, '--phase-one', root], { encoding: 'utf8', windowsHide: true });
    if (phase.status !== 0) throw new Error(`phase-one process failed: ${phase.stderr}`);

    const recovered = await recoverGoalRuntime(root);
    if (recovered.graph.tasks.find((task) => task.id === 'TASK-BUILD').state !== 'RUNNING') {
      throw new Error(`Interrupted task did not recover as RUNNING: ${JSON.stringify(recovered.graph.tasks)}`);
    }
    await transitionStoredTask(root, 'TASK-BUILD', 'VERIFYING');
    const buildVerifying = await readGoalRuntime(root);
    const buildTask = buildVerifying.tasks.find((task) => task.id === 'TASK-BUILD');
    const sha = currentGitSha(root);
    const buildEvidence = createTaskEvidenceReceipt({
      graph: buildVerifying,
      task: buildTask,
      gitSha: sha,
      evidenceRef: 'evidence://AC-001/real-process-recovery',
    });
    await transitionStoredTask(root, 'TASK-BUILD', 'DONE', { currentGitSha: sha, evidence: buildEvidence });
    if (!readyTaskIds(await readGoalRuntime(root)).includes('TASK-VERIFY')) throw new Error('Dependent verification task did not become ready');
    await completeTask(root, 'TASK-VERIFY', 'evidence://AC-002/real-process-recovery');
    const current = await readGoalRuntime(root);
    await transitionStoredGoal(root, current.goals[0].id, 'VERIFYING');
    await transitionStoredGoal(root, current.goals[0].id, 'DONE');

    const inspect = spawnSync(process.execPath, [scriptPath, '--inspect', root], { encoding: 'utf8', windowsHide: true });
    if (inspect.status !== 0) throw new Error(`inspection process failed: ${inspect.stderr}`);
    const inspected = JSON.parse(inspect.stdout.trim());
    if (inspected.tasks.some((task) => task.attempts > task.maxAttempts)) throw new Error('Recovered task exceeded its attempt budget');
    process.stdout.write('goal runtime smoke: separate-process interruption, recovery, dependency, fresh evidence, and terminal re-read PASS\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const [mode, root] = process.argv.slice(2);
if (mode === '--phase-one') await phaseOne(path.resolve(root));
else if (mode === '--inspect') await phaseInspect(path.resolve(root));
else await main();
