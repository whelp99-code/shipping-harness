// Proves that every test/<suite>/ directory and every test:*/smoke:* npm script is
// either reachable from `npm run release:verify` or deliberately excluded with a written
// reason in scripts/release-verify-steps.mjs.
//
// Why this exists: until v1.13.8, test/autopilot, test/usability, test/omp-main-harness
// and test/team-dag were run by nothing. `npm test` walks only unit, integration,
// adapter, mcp and adversarial, and none of those four had a release-verify step. A
// regression introduced in v1.13.0 sat in test/autopilot for five releases while
// release:verify reported every one of them green. A gate that does not know what it is
// failing to run is not a gate.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { STEPS, UNGATED_SCRIPTS, UNGATED_SUITES } from './release-verify-steps.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Suite directories `npm test` walks; mirrors the roots list in scripts/run-tests.mjs. */
const NPM_TEST_ROOTS = ['test/unit', 'test/integration', 'test/adapter', 'test/mcp', 'test/adversarial'];

/**
 * Expand an npm script to the shell commands it ultimately runs, following `npm run`
 * indirection so an alias cannot hide an uncovered suite.
 * @param {string} name Script name.
 * @param {Record<string, string>} scripts All package.json scripts.
 * @param {Set<string>} [seen] Scripts already expanded, to stop a cycle.
 * @returns {string[]} Command strings.
 */
export function expandScript(name, scripts, seen = new Set()) {
  if (seen.has(name) || !(name in scripts)) return [];
  seen.add(name);
  const command = scripts[name];
  const commands = [command];
  for (const match of command.matchAll(/npm (?:run|run-script) (?:-s )?([\w:-]+)/gu)) {
    commands.push(...expandScript(match[1], scripts, seen));
  }
  // `npm test` and `npm start` are shorthands that skip `run`; missing them is how the
  // first version of this audit reported test/adapter as uncovered when `check` ran it.
  for (const match of command.matchAll(/npm (test|start)\b(?! *:)/gu)) {
    commands.push(...expandScript(match[1], scripts, seen));
  }
  return commands;
}

/**
 * Which test directories a set of commands reaches, counting both explicit paths and
 * the suite roots `npm test` walks.
 * @param {string[]} commands Command strings.
 * @returns {Set<string>} Directories such as "test/autopilot".
 */
export function reachedSuites(commands) {
  const reached = new Set();
  for (const command of commands) {
    for (const match of command.matchAll(/test\/([\w.-]+)\//gu)) reached.add(`test/${match[1]}`);
    if (/run-tests\.mjs\s+all/u.test(command)) for (const root of NPM_TEST_ROOTS) reached.add(root);
    for (const match of command.matchAll(/run-tests\.mjs\s+(unit|integration|adapter|mcp|adversarial)/gu)) reached.add(`test/${match[1]}`);
  }
  return reached;
}

/**
 * Audit gate coverage. The step list and both exclusion records are injectable so a test
 * can reproduce a hole; reading them from the module would make the audit agree with
 * itself no matter what it was handed.
 * @param {{scripts: Record<string, string>, suiteDirectories: string[], steps?: {name: string, script: string}[], ungatedSuites?: Record<string, string>, ungatedScripts?: Record<string, string>}} input Package scripts, the test directories on disk, and optional overrides.
 * @returns {{uncoveredSuites: string[], ungatedScripts: string[], staleExclusions: string[], covered: string[]}}
 */
export function auditCoverage(input) {
  const steps = input.steps ?? STEPS;
  const excludedSuites = input.ungatedSuites ?? UNGATED_SUITES;
  const excludedScripts = input.ungatedScripts ?? UNGATED_SCRIPTS;
  const gateCommands = steps.flatMap((step) => expandScript(step.script, input.scripts));
  const covered = reachedSuites(gateCommands);
  const uncoveredSuites = input.suiteDirectories.filter((suite) => !covered.has(suite) && !(suite in excludedSuites));
  const gatedNames = new Set(steps.map((step) => step.script));
  const ungatedScripts = Object.keys(input.scripts)
    .filter((name) => /^(test|smoke)(:|$)/u.test(name))
    .filter((name) => !gatedNames.has(name) && !(name in excludedScripts));
  const staleExclusions = [
    ...Object.keys(excludedSuites).filter((suite) => !input.suiteDirectories.includes(suite)),
    ...Object.keys(excludedScripts).filter((name) => !(name in input.scripts) || gatedNames.has(name)),
  ];
  return { uncoveredSuites, ungatedScripts, staleExclusions, covered: [...covered].sort() };
}

/** @returns {Promise<string[]>} test/<suite> directories that hold at least one *.test.mjs. */
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scripts = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
  const report = auditCoverage({ scripts, suiteDirectories: await suiteDirectories() });
  const problems = [
    ...report.uncoveredSuites.map((suite) => `${suite} is run by no release:verify step and has no reason in UNGATED_SUITES`),
    ...report.ungatedScripts.map((name) => `npm script "${name}" is neither a release:verify step nor listed in UNGATED_SCRIPTS`),
    ...report.staleExclusions.map((name) => `"${name}" is excluded in scripts/release-verify-steps.mjs but is now gated or gone; drop the stale entry`),
  ];
  if (problems.length > 0) {
    process.stderr.write(`test-suite-coverage: ${problems.length} problem(s)\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(`test-suite-coverage: ${report.covered.length} suite directories reachable from release:verify, ${Object.keys(UNGATED_SUITES).length} excluded with a stated reason.\n`);
}
