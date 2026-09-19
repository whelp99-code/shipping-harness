// v1.13.9: v1.13.8 made test:omp-main and smoke:omp-main gate steps for the first time
// and they went red on GitHub while every local gate was green -- the runner has no OMP
// host. Crashing told nobody what happened, and making the smoke exit 0 quietly would
// have been worse: a step that did not run reading as a plain PASS is the exact failure
// mode v1.13.8 existed to remove. It reports a countable skip instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSkipped } from '../../scripts/release-verify-steps.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('a test runner skip and a smoke script skip are both counted', () => {
  assert.equal(countSkipped('ℹ skipped 3\n'), 3);
  assert.equal(countSkipped('SKIPPED: the omp executable was not found on PATH\n'), 1);
  assert.equal(countSkipped('ℹ skipped 2\nSKIPPED: no OMP host\nSKIPPED: no runtime\n'), 4);
});

test('a clean run counts zero, and neither marker is matched loosely', () => {
  assert.equal(countSkipped('ℹ pass 40\nℹ fail 0\nℹ skipped 0\n'), 0);
  assert.equal(countSkipped('All 23 steps passed.\n'), 0);
  assert.equal(countSkipped('SKIPPED:\n'), 0, 'a marker with no reason is not a skip report');
  assert.equal(countSkipped('  SKIPPED: indented, so it is prose in some other output\n'), 0);
  assert.equal(countSkipped('the word SKIPPED: appears mid-line here\n'), 0);
});

test('the OMP field smoke reports a skip and exits zero when the OMP host is absent', () => {
  const output = execFileSync(process.execPath, [
    path.join(repoRoot, 'packages/omp-main-harness/field-smoke.mjs'),
    '--omp-command', 'definitely-not-an-installed-omp-host',
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(output, /^SKIPPED: .+$/mu, 'the skip must be on its own line for release:verify to count it');
  assert.equal(countSkipped(output), 1);
  const receipt = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(receipt.skipped, true);
  assert.match(receipt.reason, /not found on PATH/u);
});
