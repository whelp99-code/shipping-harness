import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('H04 evaluator passes non-empty schema-shaped results', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'core5-h04-'));
  const report = path.join(dir, 'report.json');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['ci/core5/h04/eval-runner.mjs'], { env: { ...process.env, CORE5_EVAL_REPORT: report }, stdio: 'ignore' });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
  const value = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(value.status, 'PASS');
  assert.ok(value.testCount > 0);
});
