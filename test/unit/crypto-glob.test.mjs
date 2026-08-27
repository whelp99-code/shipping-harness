import test from 'node:test';
import assert from 'node:assert/strict';
import { hashObject, stableStringify } from '../../src/core/crypto.mjs';
import { analyzeScope, matchesGlob } from '../../src/core/glob.mjs';

test('canonical hashing ignores object key insertion order', () => {
  const first = { z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] };
  const second = { list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 };
  assert.equal(stableStringify(first), stableStringify(second));
  assert.equal(hashObject(first), hashObject(second));
});

test('glob matching supports recursive and single-segment patterns', () => {
  assert.equal(matchesGlob('src/core/gate.mjs', 'src/**'), true);
  assert.equal(matchesGlob('src/gate.mjs', 'src/*.mjs'), true);
  assert.equal(matchesGlob('src/core/gate.mjs', 'src/*.mjs'), false);
  assert.equal(matchesGlob('README.md', 'README.?d'), true);
});

test('scope analysis applies deny precedence and ignores runtime evidence', () => {
  const report = analyzeScope(
    ['src/core/new.mjs', 'secrets/key.txt', 'outside.txt', '.shipping/evidence/run/log'],
    { include: ['src/**', 'secrets/**'], exclude: ['secrets/**'] },
  );
  assert.deepEqual(report.allowed, ['src/core/new.mjs']);
  assert.deepEqual(report.violations, [
    { path: 'secrets/key.txt', reason: 'denied-pattern' },
    { path: 'outside.txt', reason: 'outside-include' },
  ]);
  assert.equal(report.ignored.length, 1);
});