import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedCommand } from '../../src/core/process.mjs';
import { redactSecrets } from '../../src/core/redaction.mjs';

test('common credential formats are redacted', () => {
  const output = redactSecrets([
    'token=supersecretvalue123',
    'Authorization: Bearer abc.def.ghi',
    'sk-abcdefghijklmnopqrstuvwxyz123456',
  ].join('\n'));
  assert.doesNotMatch(output, /supersecretvalue123/u);
  assert.doesNotMatch(output, /abc\.def\.ghi/u);
  assert.doesNotMatch(output, /sk-abcdefghijklmnopqrstuvwxyz/u);
});

test('bounded command terminates at timeout', async () => {
  const result = await runBoundedCommand({
    command: `node -e "setTimeout(() => {}, 5000)"`,
    cwd: process.cwd(),
    timeoutSeconds: 1,
    maxOutputBytes: 4096,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test('bounded command terminates an output flood', async () => {
  const result = await runBoundedCommand({
    command: `node -e "process.stdout.write('x'.repeat(100000))"`,
    cwd: process.cwd(),
    timeoutSeconds: 5,
    maxOutputBytes: 2048,
  });
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.capturedBytes, 2048);
});