import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashFile } from '../../src/core/crypto.mjs';
import { verifyRestoreEvidence } from '../../src/core/core5-restore.mjs';

test('restore evidence verifies existing digests and rejects missing or escaped paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'core5-restore-'));
  await writeFile(path.join(root, 'dump.sql'), 'restored');
  const digest = await hashFile(path.join(root, 'dump.sql'));
  const evidence = { schema: 'shipping-harness/core5-restore-evidence.v1', restoreId: 'r1', artifacts: [{ id: 'dump', path: 'dump.sql', sha256: digest }] };
  assert.equal((await verifyRestoreEvidence(root, evidence)).checked.length, 1);
  await assert.rejects(verifyRestoreEvidence(root, { ...evidence, artifacts: [{ ...evidence.artifacts[0], path: '../dump.sql' }] }), /escapes repository/);
  await assert.rejects(verifyRestoreEvidence(root, { ...evidence, artifacts: [{ ...evidence.artifacts[0], path: 'missing.sql' }] }), /missing/);
});
