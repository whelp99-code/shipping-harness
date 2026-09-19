// v1.13.8: npm 12 changed `npm pack --json` from an array of packed entries to an object
// keyed by package name. Five call sites assumed the array, including the OMP install and
// backup paths in packages/omp-main-harness/package.mjs, so on npm >= 12 they crashed
// with "Cannot read properties of undefined (reading 'filename')". It went unnoticed
// because the two scripts that exercise packing (smoke:stable, plugin-smoke) were not
// release:verify steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNpmPackResult, singleNpmPackEntry } from '../../src/core/npm-pack.mjs';

const ENTRY = { id: 'shipping-harness@1.13.8', name: 'shipping-harness', version: '1.13.8', filename: 'shipping-harness-1.13.8.tgz' };

test('the npm >= 12 name-keyed object and the pre-12 array yield the same entry', () => {
  assert.equal(singleNpmPackEntry({ 'shipping-harness': ENTRY }).filename, ENTRY.filename);
  assert.equal(singleNpmPackEntry([ENTRY]).filename, ENTRY.filename);
  assert.deepEqual(normalizeNpmPackResult({ 'shipping-harness': ENTRY }), normalizeNpmPackResult([ENTRY]));
});

test('a result with no packed filename is refused rather than read as undefined', () => {
  for (const parsed of [{}, [], null, undefined, 'shipping-harness-1.13.8.tgz', [{ name: 'x' }], { a: { name: 'x' } }]) {
    assert.throws(() => singleNpmPackEntry(parsed), (error) => error.code === 'ERR_NPM_PACK_SHAPE', `should refuse ${JSON.stringify(parsed) ?? 'undefined'}`);
  }
});

test('an ambiguous multi-package result is refused under the caller supplied code', () => {
  const two = { a: { ...ENTRY, filename: 'a.tgz' }, b: { ...ENTRY, filename: 'b.tgz' } };
  assert.throws(() => singleNpmPackEntry(two), (error) => error.code === 'ERR_NPM_PACK_SHAPE');
  assert.throws(() => singleNpmPackEntry(two, 'ERR_OMP_PACKAGE_PACK'), (error) => error.code === 'ERR_OMP_PACKAGE_PACK');
  assert.equal(normalizeNpmPackResult(two).length, 2, 'normalize keeps both; only the single-entry helper refuses');
});

test('entries without a filename are dropped instead of poisoning the list', () => {
  const mixed = { good: ENTRY, bad: { name: 'no-filename' }, worse: null };
  assert.deepEqual(normalizeNpmPackResult(mixed), [ENTRY]);
  assert.equal(singleNpmPackEntry(mixed).filename, ENTRY.filename);
});
