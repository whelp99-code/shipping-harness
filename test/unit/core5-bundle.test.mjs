import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore5ReleaseBundle, validateCore5ReleaseBundle } from '../../src/core/core5-bundle.mjs';

const input = {
  release: '1.0.0',
  repository: { revision: 'a'.repeat(40), contractHash: 'b'.repeat(64) },
  migrationIds: ['core5-001'],
  toolVersions: { node: '22.0.0' },
  modelVersions: { evaluator: 'baseline-1' },
  imageVersions: { runner: 'sha256:' + 'c'.repeat(64) },
  criterionVersion: 'core5-criteria-v1',
  criteria: [{ id: 'T29', description: 'Complete evidence', required: true }],
  evidenceManifest: [{ id: 'EVID-001', path: 'docs/HANDOVER.md', sha256: 'd'.repeat(64) }],
  createdAt: '2026-09-20T00:00:00.000Z',
};

test('Core5 bundle is content addressed and validates against its lock', () => {
  const bundle = createCore5ReleaseBundle(input);
  assert.equal(validateCore5ReleaseBundle(bundle, { revision: input.repository.revision, contractHash: input.repository.contractHash }), bundle);
  assert.equal(bundle.criteriaHash.length, 64);
  assert.equal(bundle.bundleHash.length, 64);
});

test('Core5 bundle rejects criterion weakening and revision drift', () => {
  const bundle = createCore5ReleaseBundle(input);
  assert.throws(() => validateCore5ReleaseBundle({ ...bundle, criteria: [{ ...bundle.criteria[0], description: 'Weakened' }] }), /hash does not match/);
  assert.throws(() => validateCore5ReleaseBundle(bundle, { revision: 'e'.repeat(40) }), /revision does not match/);
});

test('Core5 bundle rejects duplicate migrations and unsafe evidence paths', () => {
  assert.throws(() => createCore5ReleaseBundle({ ...input, migrationIds: ['m-1', 'm-1'] }), /duplicates/);
  assert.throws(() => createCore5ReleaseBundle({ ...input, evidenceManifest: [{ ...input.evidenceManifest[0], path: '../escape' }] }), /repository-contained/);
});
