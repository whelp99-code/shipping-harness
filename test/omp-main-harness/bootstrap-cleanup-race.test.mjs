import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  bootstrapOmpMainHarness,
  rollbackOmpMainHarness,
} from '../../packages/omp-main-harness/install.mjs';
import { installedShippingVersion } from '../../packages/omp-main-harness/package.mjs';
import {
  createFakeOmpEnvironment,
  createOldShippingPackage,
  installPackage,
} from './helpers.mjs';

const CURRENT_VERSION = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

async function bootstrapScratchDirectories() {
  return new Set(
    (await readdir(os.tmpdir()))
      .filter((entry) => entry.startsWith('shipping-omp-bootstrap-')),
  );
}

test('bootstrap waits for the complete install before removing its temporary package and remains rollback-safe', async () => {
  const environment = await createFakeOmpEnvironment();
  try {
    const previousPackage = await createOldShippingPackage(environment.root);
    installPackage(environment.prefix, previousPackage);
    assert.equal(installedShippingVersion(environment.prefix), '1.0.1');
    const managedBefore = await environment.snapshot();
    const scratchBefore = await bootstrapScratchDirectories();

    const installed = await bootstrapOmpMainHarness({
      home: environment.home,
      agentDir: environment.agentDir,
      shippingPrefix: environment.prefix,
      ompCommand: environment.omp,
      npmCommand: '/usr/bin/npm',
      dryRun: false,
      requireTag: false,
      tag: `v${CURRENT_VERSION}-bootstrap-test`,
    });

    assert.equal(installed.shippingVersion, CURRENT_VERSION);
    assert.equal(installed.ompVersion, '18.0.10');
    assert.equal(installed.tools, 9);
    assert.equal(installed.mainHarness, true);
    assert.equal(installed.doctor.healthy, true);
    assert.equal(installedShippingVersion(environment.prefix), CURRENT_VERSION);
    assert.ok(installed.backup?.id);
    const backupManifest = JSON.parse(
      await readFile(path.join(installed.backup.path, 'manifest.json'), 'utf8'),
    );
    assert.equal(backupManifest.previousShippingVersion, '1.0.1');
    assert.equal(backupManifest.previousPackage.version, '1.0.1');
    assert.match(backupManifest.previousPackage.sha256, /^[a-f0-9]{64}$/u);

    const receipt = JSON.parse(
      await readFile(path.join(environment.agentDir, 'shipping-harness-install.json'), 'utf8'),
    );
    assert.equal(receipt.shippingHarness.version, CURRENT_VERSION);
    assert.equal(receipt.omp.version, '18.0.10');
    assert.equal(receipt.integration.tools, 9);
    assert.equal(receipt.integration.refineTool, true);
    assert.equal(receipt.integration.managerSmoke, 'PASS');
    assert.equal(receipt.integration.mainHarness, true);
    assert.equal(receipt.backup.id, installed.backup.id);

    const scratchAfter = await bootstrapScratchDirectories();
    const leaked = [...scratchAfter].filter((entry) => !scratchBefore.has(entry));
    assert.deepEqual(leaked, []);

    const rolledBack = await rollbackOmpMainHarness({
      home: environment.home,
      agentDir: environment.agentDir,
      shippingPrefix: environment.prefix,
      ompCommand: environment.omp,
      npmCommand: '/usr/bin/npm',
      backupId: installed.backup.id,
      dryRun: false,
    });
    assert.equal(rolledBack.restoredShippingVersion, '1.0.1');
    assert.equal(rolledBack.packageRestored, true);
    assert.equal(installedShippingVersion(environment.prefix), '1.0.1');
    assert.deepEqual(await environment.snapshot(), managedBefore);
  } finally {
    await environment.cleanup();
  }
});
