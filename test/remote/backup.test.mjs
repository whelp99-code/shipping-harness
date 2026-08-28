import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  createBackup,
  restoreBackup,
  validateBackup,
} from '../../packages/internal-remote/index.mjs';
import { fixture, serverSecret } from './helpers.mjs';

test('signed backup restores Shipping state and preserves an evidence-only OMO manifest', async () => {
  const f = await fixture();
  try {
    const extra = path.join(f.root, 'runtime-manifest.json');
    await writeFile(extra, `${JSON.stringify({ release: '0.7.0' })}\n`);
    const bundlePath = path.join(f.root, 'backups', 'one.json');
    const made = await createBackup({
      projectId: 'p1',
      projectRoot: f.project,
      serverSecret,
      outputPath: bundlePath,
      extraEvidenceFiles: [{ source: extra, logicalPath: 'omo/runtime-manifest.json' }],
    });
    assert.ok(made.fileCount >= 3);
    const bundle = validateBackup(JSON.parse(await readFile(bundlePath, 'utf8')), { projectId: 'p1', serverSecret });
    assert.ok(bundle.files.some((item) => item.path === 'evidence/omo/runtime-manifest.json' && item.restore === false));
    await writeFile(path.join(f.project, '.shipping', 'state.json'), `${JSON.stringify({ state: 'CLOSED', release: 'BROKEN' })}\n`);
    const restored = await restoreBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, bundlePath });
    assert.equal(restored.restored, true);
    assert.equal(restored.pausedAfterRestore, false);
    assert.equal(JSON.parse(await readFile(path.join(f.project, '.shipping', 'state.json'), 'utf8')).release, '0.9.0');
  } finally {
    await f.cleanup();
  }
});

test('a restored non-terminal release is forced into PAUSED with human stop', async () => {
  const f = await fixture();
  try {
    const statePath = path.join(f.project, '.shipping', 'state.json');
    await writeFile(statePath, `${JSON.stringify({ state: 'LOCKED', release: '0.9.0', humanStop: false })}\n`);
    const bundlePath = path.join(f.root, 'locked-backup.json');
    await createBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, outputPath: bundlePath });
    await writeFile(statePath, `${JSON.stringify({ state: 'CLOSED', release: 'BROKEN' })}\n`);
    const restored = await restoreBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, bundlePath });
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(restored.restoredOriginalState, 'LOCKED');
    assert.equal(restored.pausedAfterRestore, true);
    assert.equal(state.state, 'PAUSED');
    assert.equal(state.resumeState, 'LOCKED');
    assert.equal(state.humanStop, true);
  } finally {
    await f.cleanup();
  }
});

test('tampered bundle and restore over active work fail closed', async () => {
  const f = await fixture();
  try {
    const bundlePath = path.join(f.root, 'backup.json');
    await createBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, outputPath: bundlePath });
    const tampered = JSON.parse(await readFile(bundlePath, 'utf8'));
    tampered.files[0].bytes = Buffer.from('evil').toString('base64');
    await writeFile(bundlePath, JSON.stringify(tampered));
    await assert.rejects(
      () => restoreBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, bundlePath }),
      /signature|integrity/i,
    );

    const activeBundle = path.join(f.root, 'active-backup.json');
    await createBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, outputPath: activeBundle });
    await writeFile(path.join(f.project, '.shipping', 'state.json'), `${JSON.stringify({ state: 'RUNNING', release: '0.9.0' })}\n`);
    await assert.rejects(
      () => restoreBackup({ projectId: 'p1', projectRoot: f.project, serverSecret, bundlePath: activeBundle }),
      /pause|active/i,
    );
  } finally {
    await f.cleanup();
  }
});
