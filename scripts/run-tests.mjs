import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { walkFiles } from './shared.mjs';

// Line coverage threshold for `--coverage`: measured integer minus 2 percentage
// points (recorded in docs/planning/33-V1.9.0-ENGINEERING-INFRASTRUCTURE-DEVELOPMENT-PLAN.md section 6).
const COVERAGE_LINES_THRESHOLD = 84;

const args = process.argv.slice(2);
const withCoverage = args.includes('--coverage');
const requested = args.find((value) => !value.startsWith('--')) ?? 'all';
const valid = new Set(['all', 'unit', 'integration', 'adapter', 'mcp', 'adversarial']);
if (!valid.has(requested)) {
  process.stderr.write(`Unknown test suite: ${requested}\n`);
  process.exit(2);
}

const roots = requested === 'all'
  ? ['test/unit', 'test/integration', 'test/adapter', 'test/mcp', 'test/adversarial']
  : [`test/${requested}`];
const files = (await Promise.all(
  roots.map((root) => walkFiles(path.resolve(root), (file) => file.endsWith('.test.mjs'))),
)).flat();

if (files.length === 0) {
  process.stderr.write(`No ${requested} test files found.\n`);
  process.exit(1);
}

const coverageArgs = withCoverage
  ? ['--experimental-test-coverage', `--test-coverage-lines=${COVERAGE_LINES_THRESHOLD}`]
  : [];
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...coverageArgs, ...files], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 300000,
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}