// Runs every check a version close requires as one script instead of a 21-entry
// `npm run` chain in package.json. Steps are independent (each npm script owns its
// own temp fixtures / read-only checks) and run in a pool sized to the CPU count.
// At the end this prints one summary table (name, duration, result) plus a highly
// visible WARNING for any step whose test run reported skipped tests, and exits 0
// only when no step failed — skips are surfaced, never hidden, but do not fail the
// build (see docs/planning/33-V1.9.0-ENGINEERING-INFRASTRUCTURE-DEVELOPMENT-PLAN.md
// section 6, Phase B, item 12: the private OMO runtime tests skip on machines where
// the pinned runtime is not installed).
import { spawn } from 'node:child_process';
import os from 'node:os';

/** @typedef {{ name: string, script: string }} ReleaseVerifyStep */

/** @type {ReleaseVerifyStep[]} */
const STEPS = [
  { name: 'check', script: 'check' },
  { name: 'test:plugin', script: 'test:plugin' },
  { name: 'test:omo-bridge', script: 'test:omo-bridge' },
  { name: 'test:remote', script: 'test:remote' },
  { name: 'test:stable', script: 'test:stable' },
  { name: 'security', script: 'security' },
  { name: 'security:inventory', script: 'security:inventory' },
  { name: 'license:check', script: 'license:check' },
  { name: 'verify:docs', script: 'verify:docs' },
  { name: 'smoke:release-train', script: 'smoke:release-train' },
  { name: 'smoke:autopilot', script: 'smoke:autopilot' },
  { name: 'smoke:autopilot:field', script: 'smoke:autopilot:field' },
  { name: 'smoke:goal-discovery', script: 'smoke:goal-discovery' },
  { name: 'smoke:goal-charter', script: 'smoke:goal-charter' },
  { name: 'test:goal-charter:field', script: 'test:goal-charter:field' },
  { name: 'smoke:goal-charter:field', script: 'smoke:goal-charter:field' },
  { name: 'test:intent-gate', script: 'test:intent-gate' },
  { name: 'smoke:intent-gate', script: 'smoke:intent-gate' },
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const step of STEPS) process.stdout.write(`${step.name}\n`);
  process.exit(0);
}

/** @param {string} text @returns {number} */
function countSkipped(text) {
  let total = 0;
  for (const match of text.matchAll(/ℹ\s+skipped\s+(\d+)/gu)) total += Number(match[1]);
  return total;
}

/** @param {ReleaseVerifyStep} step */
function runStep(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', step.script], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      resolve({
        name: step.name,
        script: step.script,
        durationMs: Date.now() - started,
        passed: code === 0,
        exitCode: code,
        skipped: countSkipped(`${stdout}\n${stderr}`),
        output: `${stdout}${stderr}`,
      });
    });
    child.on('error', (error) => {
      resolve({
        name: step.name,
        script: step.script,
        durationMs: Date.now() - started,
        passed: false,
        exitCode: null,
        skipped: 0,
        output: `${error.message}\n`,
      });
    });
  });
}

/** @param {ReleaseVerifyStep[]} steps @param {number} concurrency */
async function runPool(steps, concurrency) {
  const queue = [...steps];
  const results = [];
  async function worker() {
    while (queue.length > 0) {
      const step = queue.shift();
      if (!step) return;
      results.push(await runStep(step));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, steps.length)) }, worker));
  return results;
}

const results = await runPool(STEPS, os.cpus().length || 4);
results.sort((a, b) => STEPS.findIndex((s) => s.name === a.name) - STEPS.findIndex((s) => s.name === b.name));

const failed = results.filter((result) => !result.passed);
const skippedSteps = results.filter((result) => result.skipped > 0);

process.stdout.write('\nrelease:verify summary\n');
process.stdout.write('-'.repeat(72) + '\n');
for (const result of results) {
  const status = result.passed ? 'PASS' : 'FAIL';
  const seconds = (result.durationMs / 1000).toFixed(1);
  const skipNote = result.skipped > 0 ? ` (${result.skipped} skipped)` : '';
  process.stdout.write(`${status.padEnd(4)} ${result.name.padEnd(28)} ${seconds.padStart(6)}s${skipNote}\n`);
}
process.stdout.write('-'.repeat(72) + '\n');

if (skippedSteps.length > 0) {
  process.stdout.write('\nWARNING: the following steps had skipped tests:\n');
  for (const result of skippedSteps) {
    process.stdout.write(`  WARNING: ${result.name} skipped ${result.skipped} test(s) - private OMO runtime is not installed at the pinned path\n`);
  }
  process.stdout.write('\n');
}

if (failed.length > 0) {
  process.stdout.write(`FAILED steps (${failed.length}/${results.length}):\n`);
  for (const result of failed) {
    process.stdout.write(`  - ${result.name} (exit ${result.exitCode})\n`);
    process.stderr.write(`\n=== ${result.name} output ===\n${result.output}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`All ${results.length} steps passed.${skippedSteps.length > 0 ? ' See WARNING above for skipped tests.' : ''}\n`);
  process.exitCode = 0;
}
