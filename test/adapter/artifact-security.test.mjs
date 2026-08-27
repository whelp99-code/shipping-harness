import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { collectConfiguredArtifacts, validateArtifactCandidate } from '../../src/adapters/artifacts.mjs';

function contractFor(candidate) {
  return { adapters: { gajae: { artifactPaths: [candidate] } } };
}

test('artifact candidates reject home, absolute, traversal, runtime, and credential paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-artifacts-'));
  try {
    for (const candidate of ['~/.omo/state.json', '/tmp/evidence.json', '../outside.json', '.shipping/state.json', '.env']) {
      assert.throws(() => validateArtifactCandidate(candidate), { code: 'ERR_ARTIFACT_PATH' });
      await assert.rejects(() => collectConfiguredArtifacts(root, 'gajae', contractFor(candidate)), { code: 'ERR_ARTIFACT_PATH' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact collection rejects a repository symlink that resolves outside', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-artifacts-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'shipping-outside-'));
  try {
    const outsideFile = path.join(outside, 'ledger.jsonl');
    await writeFile(outsideFile, '{"type":"secret"}\n', 'utf8');
    await symlink(outsideFile, path.join(root, 'ledger.jsonl'));
    await assert.rejects(
      () => collectConfiguredArtifacts(root, 'gajae', contractFor('ledger.jsonl')),
      { code: 'ERR_PATH_OUTSIDE_REPO' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});