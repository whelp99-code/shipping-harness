// v1.13.8: the gate did not know which suites it was failing to run. test/autopilot,
// test/usability, test/omp-main-harness and test/team-dag were reachable from no
// release:verify step, and a regression introduced in v1.13.0 sat in test/autopilot for
// five releases while release:verify reported green. These tests pin the audit that
// makes that impossible to repeat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCoverage, expandScript, reachedSuites } from '../../scripts/test-suite-coverage.mjs';
import { STEPS, UNGATED_SCRIPTS, UNGATED_SUITES } from '../../scripts/release-verify-steps.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scripts = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).scripts;

async function suiteDirectories() {
  const entries = await readdir(path.join(repoRoot, 'test'), { withFileTypes: true });
  const suites = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'helpers') continue;
    const files = await readdir(path.join(repoRoot, 'test', entry.name));
    if (files.some((file) => file.endsWith('.test.mjs'))) suites.push(`test/${entry.name}`);
  }
  return suites.sort();
}

test('every test suite directory in this repo is gated or excluded with a written reason', async () => {
  const report = auditCoverage({ scripts, suiteDirectories: await suiteDirectories() });
  assert.deepEqual(report.uncoveredSuites, []);
  assert.deepEqual(report.ungatedScripts, []);
  assert.deepEqual(report.staleExclusions, [], 'an exclusion that is now gated or gone must be removed, not left to rot');
});

test('the four suites that v1.13.0 shipped past are now reachable from a gate', async () => {
  const report = auditCoverage({ scripts, suiteDirectories: await suiteDirectories() });
  for (const suite of ['test/autopilot', 'test/usability', 'test/omp-main-harness', 'test/team-dag']) {
    assert.ok(report.covered.includes(suite), `${suite} must be reachable from release:verify`);
  }
});

test('the audit reproduces the v1.13.0 hole rather than agreeing with itself', () => {
  const fixture = {
    scripts: { check: 'npm test', test: 'node scripts/run-tests.mjs all', 'test:autopilot': 'node --test test/autopilot/*.test.mjs' },
    suiteDirectories: ['test/unit', 'test/autopilot'],
    ungatedSuites: {},
    ungatedScripts: {},
  };
  const holed = auditCoverage({ ...fixture, steps: [{ name: 'check', script: 'check' }] });
  assert.deepEqual(holed.uncoveredSuites, ['test/autopilot']);
  assert.ok(holed.ungatedScripts.includes('test:autopilot'));

  const closed = auditCoverage({ ...fixture, steps: [{ name: 'check', script: 'check' }, { name: 'test:autopilot', script: 'test:autopilot' }] });
  assert.deepEqual(closed.uncoveredSuites, []);
  assert.ok(!closed.ungatedScripts.includes('test:autopilot'));
});

test('script expansion follows npm run indirection and the bare npm test shorthand', () => {
  const expanded = expandScript('check', scripts);
  assert.ok(expanded.some((command) => command.includes('run-tests.mjs all')), 'bare `npm test` inside check must be followed');
  const cyclic = expandScript('a', { a: 'npm run b', b: 'npm run a && node --test test/unit/x.test.mjs' });
  assert.ok(cyclic.some((command) => command.includes('test/unit/')), 'a cycle must not lose the commands already seen');
});

test('reachedSuites counts the npm test roots and explicit paths, not script names', () => {
  const roots = reachedSuites(['node scripts/run-tests.mjs all']);
  for (const suite of ['test/unit', 'test/integration', 'test/adapter', 'test/mcp', 'test/adversarial']) {
    assert.ok(roots.has(suite));
  }
  assert.ok(!roots.has('test/autopilot'), '`npm test` has never walked test/autopilot');
  assert.ok(reachedSuites(['node --test test/team-dag/entry-gate.test.mjs']).has('test/team-dag'));
});

test('every exclusion carries a non-empty reason', () => {
  for (const [name, reason] of [...Object.entries(UNGATED_SUITES), ...Object.entries(UNGATED_SCRIPTS)]) {
    assert.equal(typeof reason, 'string');
    assert.ok(reason.trim().length >= 20, `${name} needs a real reason, not a placeholder`);
  }
});

test('every release:verify step names a script that exists', () => {
  for (const step of STEPS) assert.ok(step.script in scripts, `release:verify step ${step.name} runs a missing script`);
});
