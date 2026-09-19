// The list of gates a version close must pass, and the deliberate exclusions from it.
// Split out of scripts/release-verify.mjs in v1.13.8 so scripts/test-suite-coverage.mjs
// can audit it without executing a release verification: before v1.13.8 nothing checked
// that every test/<suite>/ directory was actually reachable from a gate, and four of them
// (autopilot, usability, omp-main-harness, team-dag) were run by nothing for five
// releases. See docs/planning/39-V1.13.8-....md.

/**
 * How many skips a step's output reported. Test runners print "ℹ skipped N"; a smoke
 * script is not a test runner and cannot, so one that declines to run (no OMP host, no
 * private runtime) used to print nothing countable and read as a plain PASS. A line of
 * the form `SKIPPED: <reason>` counts as one skip, and release:verify prints it as a
 * WARNING like any other. A step that did not run must read as neither red nor green.
 * @param {string} text Combined stdout and stderr of the step.
 * @returns {number} Number of skips reported.
 */
export function countSkipped(text) {
  let total = 0;
  for (const match of text.matchAll(/ℹ\s+skipped\s+(\d+)/gu)) total += Number(match[1]);
  for (const _ of text.matchAll(/^SKIPPED: .+$/gmu)) total += 1;
  return total;
}

/** @typedef {{ name: string, script: string }} ReleaseVerifyStep */

/** @type {ReleaseVerifyStep[]} */
export const STEPS = [
  { name: 'check', script: 'check' },
  { name: 'test:plugin', script: 'test:plugin' },
  { name: 'test:remote', script: 'test:remote' },
  { name: 'test:stable', script: 'test:stable' },
  { name: 'test:autopilot', script: 'test:autopilot' },
  { name: 'test:usability', script: 'test:usability' },
  { name: 'test:omp-main', script: 'test:omp-main' },
  { name: 'test:team-dag', script: 'test:team-dag' },
  { name: 'security', script: 'security' },
  { name: 'security:inventory', script: 'security:inventory' },
  { name: 'license:check', script: 'license:check' },
  { name: 'verify:docs', script: 'verify:docs' },
  { name: 'verify:gate-coverage', script: 'verify:gate-coverage' },
  { name: 'smoke:release-train', script: 'smoke:release-train' },
  { name: 'smoke:autopilot', script: 'smoke:autopilot' },
  { name: 'smoke:autopilot:field', script: 'smoke:autopilot:field' },
  { name: 'smoke:goal-discovery', script: 'smoke:goal-discovery' },
  { name: 'smoke:goal-charter', script: 'smoke:goal-charter' },
  { name: 'test:goal-charter:field', script: 'test:goal-charter:field' },
  { name: 'smoke:goal-charter:field', script: 'smoke:goal-charter:field' },
  { name: 'test:intent-gate', script: 'test:intent-gate' },
  { name: 'smoke:intent-gate', script: 'smoke:intent-gate' },
  { name: 'smoke:omp-main', script: 'smoke:omp-main' },
];

/**
 * Test directories deliberately not reachable from any gate, each with the reason.
 * scripts/test-suite-coverage.mjs fails on an uncovered directory that is not listed
 * here, so dropping a suite out of the gate is a decision someone has to write down.
 * @type {Record<string, string>}
 */
export const UNGATED_SUITES = {
  'test/omo': 'The private OMO bridge was retired in v1.11.1; its sealed manifest pins a runtime path that no longer exists, so these tests cannot pass until the runtime is rebuilt under a new ADR. Run `npm run test:omo-bridge` manually then. See packages/internal-omo-bridge/DEPRECATED.md.',
};

/**
 * npm scripts that look like gates but deliberately are not steps, each with the reason.
 * Kept next to STEPS so the exclusions are one list someone can read, rather than
 * knowledge that only exists in whoever last edited the file.
 * @type {Record<string, string>}
 */
export const UNGATED_SCRIPTS = {
  'test:omo-bridge': 'Runs test/omo; see UNGATED_SUITES for the retired private OMO runtime.',
  'smoke:remote': 'scripts/remote-gateway-smoke.mjs needs the retired private OMO runtime at its pinned absolute path. test:remote covers the gateway logic and is a step.',
  'smoke:stable': 'scripts/v1-final-smoke.mjs calls verifyPrivateOmoPromotion() and shells out to smoke:remote, so it needs the same retired runtime. It also rewrites docs/reports/v1-final-smoke.json, which AGENTS.md says must not be regenerated casually. test:stable covers the frozen v1 surface and is a step.',
  'test:decision': 'Alias: every file it names lives under test/unit, test/adversarial, and is already run by `npm test` inside the check step.',
  'test:goals': 'Alias for files already under test/unit, test/integration, test/adversarial.',
  'test:release-train': 'Alias for files already under test/mcp, test/adversarial.',
  'test:goal-discovery': 'Alias for files already under test/mcp, test/adversarial, test/integration.',
  'test:goal-charter': 'Alias for files already under test/unit, test/integration, test/adversarial.',
  'test:autopilot:field': 'Subset of test:autopilot, which is a step.',
  'test:goal-direction:field': 'Alias of test:goal-charter:field, which is a step.',
  'smoke:goal-direction:field': 'Alias of smoke:goal-charter:field, which is a step.',
  'test:unit': 'Subset of `npm test` inside the check step.',
  'test:integration': 'Subset of `npm test` inside the check step.',
  'test:adapter': 'Subset of `npm test` inside the check step.',
  'test:mcp': 'Subset of `npm test` inside the check step.',
  'test:adversarial': 'Subset of `npm test` inside the check step.',
  'test': 'Run by the check step.',
  'test:coverage': 'Coverage variant of `npm test`; the check step runs the same tests.',
};
