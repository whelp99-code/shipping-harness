import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { applyOmpConfiguration } from '../../packages/omp-main-harness/config.mjs';
import { doctorOmpMainHarness } from '../../packages/omp-main-harness/doctor.mjs';
import { installOmpMainHarness, planOmpMainHarness, rollbackOmpMainHarness } from '../../packages/omp-main-harness/install.mjs';
import { installedShippingVersion, packShippingSource, shippingPrefixPaths } from '../../packages/omp-main-harness/package.mjs';
import { ompMainPaths } from '../../packages/omp-main-harness/paths.mjs';
import { createFakeOmpEnvironment, createOldShippingPackage, installPackage } from './helpers.mjs';

async function currentPackage(environment) {
  const destination = path.join(environment.root, 'current-pack');
  await mkdir(destination, { recursive: true });
  return packShippingSource({ destination, npmCommand: '/usr/bin/npm' });
}

test('user-local upgrade installs v1.1.1, merges OMP safely, passes doctor, and rolls back exactly', async () => {
  const environment = await createFakeOmpEnvironment();
  try {
    const oldPackage = await createOldShippingPackage(environment.root);
    installPackage(environment.prefix, oldPackage);
    assert.equal(installedShippingVersion(environment.prefix), '1.0.1');
    const before = await environment.snapshot();
    const packed = await currentPackage(environment);
    assert.equal(packed.version, '1.1.1');

    const installed = await installOmpMainHarness({
      home: environment.home,
      agentDir: environment.agentDir,
      shippingPrefix: environment.prefix,
      ompCommand: environment.omp,
      npmCommand: '/usr/bin/npm',
      packagePath: packed.path,
      sourceTag: 'v1.1.1-test',
      dryRun: false,
    });
    assert.equal(installed.shippingVersion, '1.1.1');
    assert.equal(installed.ompVersion, '18.0.10');
    assert.equal(installed.tools, 9);
    assert.equal(installed.mainHarness, true);
    assert.equal(installed.doctor.healthy, true);
    assert.equal(installedShippingVersion(environment.prefix), '1.1.1');

    const mcp = JSON.parse(await readFile(path.join(environment.agentDir, 'mcp.json'), 'utf8'));
    assert.deepEqual(mcp.preserve, { value: true });
    assert.equal(mcp.mcpServers.existing.command, '/usr/bin/true');
    assert.equal(mcp.mcpServers['shipping-harness'].command, path.join(environment.prefix, 'bin', 'shipping-harness-mcp'));
    const config = await readFile(path.join(environment.agentDir, 'config.yml'), 'utf8');
    assert.match(config, /existing\/model/u);
    const agents = await readFile(path.join(environment.agentDir, 'AGENTS.md'), 'utf8');
    assert.equal(agents.split('<!-- >>> SHIPPING-HARNESS-MAIN >>>').length - 1, 1);
    assert.match(agents, /Keep this rule/u);
    const receipt = JSON.parse(await readFile(path.join(environment.agentDir, 'shipping-harness-install.json'), 'utf8'));
    assert.equal(receipt.shippingHarness.version, '1.1.1');
    assert.equal(receipt.omp.version, '18.0.10');
    assert.equal(receipt.integration.tools, 9);
    assert.equal(receipt.integration.managerSmoke, 'PASS');
    assert.equal(receipt.integration.mainHarness, true);
    assert.equal(receipt.publicPublish, false);

    const paths = ompMainPaths({ home: environment.home, agentDir: environment.agentDir });
    const prefix = shippingPrefixPaths(environment.prefix);
    await applyOmpConfiguration(paths, { omp: environment.omp, shippingMcp: prefix.mcp }, { dryRun: false });
    const agentsAfterSecondApply = await readFile(path.join(environment.agentDir, 'AGENTS.md'), 'utf8');
    assert.equal(agentsAfterSecondApply.split('<!-- >>> SHIPPING-HARNESS-MAIN >>>').length - 1, 1);

    const doctor = await doctorOmpMainHarness({
      home: environment.home,
      agentDir: environment.agentDir,
      shippingPrefix: environment.prefix,
      ompCommand: environment.omp,
      expectedVersion: '1.1.1',
    });
    assert.equal(doctor.healthy, true);

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
    assert.equal(installedShippingVersion(environment.prefix), '1.0.1');
    const after = await environment.snapshot();
    assert.deepEqual(after, before);
  } finally {
    await environment.cleanup();
  }
});

test('preview is read-only and reports the actual OMP host and target package', async () => {
  const environment = await createFakeOmpEnvironment();
  try {
    const oldPackage = await createOldShippingPackage(environment.root);
    installPackage(environment.prefix, oldPackage);
    const before = await environment.snapshot();
    const packed = await currentPackage(environment);
    const preview = await planOmpMainHarness({
      home: environment.home,
      agentDir: environment.agentDir,
      shippingPrefix: environment.prefix,
      ompCommand: environment.omp,
      packagePath: packed.path,
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.currentShippingVersion, '1.0.1');
    assert.equal(preview.targetShippingVersion, '1.1.1');
    assert.equal(preview.omp.version, '18.0.10');
    assert.deepEqual(await environment.snapshot(), before);
  } finally {
    await environment.cleanup();
  }
});

test('tampered backup data fails closed instead of restoring untrusted configuration', async () => {
  const environment = await createFakeOmpEnvironment();
  try {
    const oldPackage = await createOldShippingPackage(environment.root);
    installPackage(environment.prefix, oldPackage);
    const packed = await currentPackage(environment);
    const installed = await installOmpMainHarness({
      home: environment.home,
      agentDir: environment.agentDir,
      shippingPrefix: environment.prefix,
      ompCommand: environment.omp,
      packagePath: packed.path,
      dryRun: false,
    });
    const manifestPath = path.join(installed.backup.path, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const mcp = manifest.files.find((entry) => entry.relativePath === 'mcp.json');
    assert.ok(mcp?.backupRelativePath);
    await writeFile(path.join(installed.backup.path, mcp.backupRelativePath), 'tampered\n', 'utf8');
    await assert.rejects(
      rollbackOmpMainHarness({
        home: environment.home,
        agentDir: environment.agentDir,
        shippingPrefix: environment.prefix,
        ompCommand: environment.omp,
        backupId: installed.backup.id,
        dryRun: false,
      }),
      (error) => error.code === 'ERR_OMP_BACKUP_TAMPERED',
    );
  } finally {
    await environment.cleanup();
  }
});

test('OMP agent directory cannot escape the managed ~/.omp root', async () => {
  const environment = await createFakeOmpEnvironment();
  try {
    assert.throws(
      () => ompMainPaths({ home: environment.home, agentDir: path.join(environment.root, 'outside-agent') }),
      (error) => error.code === 'ERR_OMP_PATH_ESCAPE',
    );
  } finally {
    await environment.cleanup();
  }
});
