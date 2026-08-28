import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { hashFile } from '../../src/core/crypto.mjs';
import { doctorShippingPlugin } from '../../packages/shipping-plugin/doctor/doctor.mjs';
import { repairShippingPlugin } from '../../packages/shipping-plugin/doctor/repair.mjs';
import { installShippingPlugin } from '../../packages/shipping-plugin/installer/install.mjs';
import { pluginPaths } from '../../packages/shipping-plugin/installer/paths.mjs';
import { rollbackShippingPlugin, upgradeShippingPlugin } from '../../packages/shipping-plugin/installer/upgrade.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function temporaryPackage(version) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-plugin-package-'));
  await mkdir(path.join(root, 'packages'), { recursive: true });
  await cp(path.join(packageRoot, 'packages', 'shipping-plugin'), path.join(root, 'packages', 'shipping-plugin'), { recursive: true });
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await cp(path.join(packageRoot, 'bin', 'shipping-harness-mcp.mjs'), path.join(root, 'bin', 'shipping-harness-mcp.mjs'));
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: 'shipping-harness', version }, null, 2)}\n`, 'utf8');
  return root;
}

test('doctor detects missing assets and repair restores them without mutating repository Shipping state', async (t) => {
  const fixture = await createFixtureRepo();
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'shipping-plugin-doctor-'));
  t.after(async () => { await fixture.cleanup(); await rm(installRoot, { recursive: true, force: true }); });
  const stateHashBefore = await hashFile(fixture.paths.state);
  await installShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root, dryRun: false });
  const paths = pluginPaths(installRoot);
  await unlink(paths.skill);
  const broken = await doctorShippingPlugin({ installRoot, projectRoot: fixture.root });
  assert.equal(broken.healthy, false);
  assert.ok(broken.repairActions.includes('reinstall-assets'));

  const preview = await repairShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root });
  assert.equal(preview.dryRun, true);
  const repaired = await repairShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root, dryRun: false });
  assert.equal(repaired.after.healthy, true);
  assert.match(await readFile(paths.skill, 'utf8'), /user is the approver/u);
  assert.equal(await hashFile(fixture.paths.state), stateHashBefore);
});

test('upgrade creates rollback metadata and rollback restores the previous plugin version', async (t) => {
  const fixture = await createFixtureRepo();
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'shipping-plugin-upgrade-'));
  const oldPackage = await temporaryPackage('0.5.0');
  t.after(async () => {
    await fixture.cleanup();
    await rm(installRoot, { recursive: true, force: true });
    await rm(oldPackage, { recursive: true, force: true });
  });
  const stateHashBefore = await hashFile(fixture.paths.state);
  const currentPackageVersion = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')).version;
  await installShippingPlugin({ packageRoot: oldPackage, installRoot, host: 'generic', projectRoot: fixture.root, dryRun: false, now: '2026-08-28T01:00:00.000Z' });
  const preview = await upgradeShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root });
  assert.equal(preview.needed, true);
  assert.equal(preview.from, '0.5.0');
  assert.equal(preview.to, currentPackageVersion);

  const upgraded = await upgradeShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot: fixture.root, dryRun: false, now: '2026-08-28T02:00:00.000Z' });
  assert.equal(upgraded.backup.packageVersion, '0.5.0');
  assert.equal(upgraded.install.receipt.packageVersion, currentPackageVersion);
  const rolled = await rollbackShippingPlugin({ installRoot, dryRun: false });
  assert.equal(rolled.receipt.packageVersion, '0.5.0');
  assert.equal(rolled.after.healthy, true);
  assert.equal(await hashFile(fixture.paths.state), stateHashBefore);
});

test('project doctor reports non-git roots without changing them', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-not-git-'));
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'shipping-plugin-empty-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(installRoot, { recursive: true, force: true }); });
  const result = await doctorShippingPlugin({ installRoot, projectRoot: root });
  assert.equal(result.healthy, false);
  assert.equal(result.project.checks[0].id, 'git-root');
  assert.equal(result.project.checks[0].ok, false);
});
