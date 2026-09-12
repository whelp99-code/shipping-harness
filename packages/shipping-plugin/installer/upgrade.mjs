import path from 'node:path';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { exists, readJson, writeJsonAtomic } from '../../../src/core/fs.mjs';
import { invariant } from '../../../src/core/errors.mjs';
import { applyCodexRegistration } from './host-registration.mjs';
import { installShippingPlugin } from './install.mjs';
import { assertContainedPath, pluginPaths } from './paths.mjs';
import { doctorShippingPlugin } from '../doctor/doctor.mjs';

async function history(paths) {
  return await exists(paths.upgradeHistory) ? readJson(paths.upgradeHistory) : { schema: 'shipping-plugin/upgrade-history-v1', items: [] };
}

/** @param {{packageRoot: string, installRoot: string, host?: string, codexHome?: string|null, codexExecutable?: string, projectRoot?: string|null, dryRun?: boolean, run?: any, now?: string}} input */
export async function upgradeShippingPlugin(input) {
  const paths = pluginPaths(input.installRoot);
  const current = await exists(paths.receipt) ? JSON.parse(await readFile(paths.receipt, 'utf8')) : null;
  const packageJson = JSON.parse(await readFile(path.join(input.packageRoot, 'package.json'), 'utf8'));
  const nextVersion = packageJson.version;
  const needed = !current || current.packageVersion !== nextVersion;
  if (input.dryRun !== false) {
    return { schema: 'shipping-plugin/upgrade-v1', dryRun: true, changed: false, from: current?.packageVersion ?? null, to: nextVersion, needed, preservesProjectState: true };
  }
  let backup = null;
  if (current && needed) {
    const id = `${current.packageVersion}-${String(current.receiptHash ?? 'unknown').slice(0, 12)}`.replace(/[^0-9A-Za-z._-]/gu, '_');
    const backupRoot = assertContainedPath(paths.backups, path.join(paths.backups, id), 'plugin backup');
    await mkdir(backupRoot, { recursive: true });
    if (await exists(paths.assets)) await cp(paths.assets, path.join(backupRoot, 'assets'), { recursive: true, force: true });
    if (await exists(paths.receipt)) await cp(paths.receipt, path.join(backupRoot, 'install-receipt.json'), { force: true });
    if (await exists(paths.registration)) await cp(paths.registration, path.join(backupRoot, 'registration.json'), { force: true });
    backup = { id, backupRoot, packageVersion: current.packageVersion, receiptHash: current.receiptHash, createdAt: input.now ?? new Date().toISOString() };
    await writeJsonAtomic(path.join(backupRoot, 'backup.json'), { schema: 'shipping-plugin/backup-v1', ...backup });
  }
  const install = await installShippingPlugin({ ...input, dryRun: false, replace: true });
  const document = await history(paths);
  const item = {
    id: `upgrade-${Date.now()}`,
    at: input.now ?? new Date().toISOString(),
    from: current?.packageVersion ?? null,
    to: nextVersion,
    backup,
    receiptHash: install.receipt?.receiptHash ?? current?.receiptHash ?? null,
  };
  document.items.push(item);
  await writeJsonAtomic(paths.upgradeHistory, document);
  return { schema: 'shipping-plugin/upgrade-v1', dryRun: false, changed: install.changed || needed, from: item.from, to: item.to, backup, install, historyItem: item, preservesProjectState: true };
}

/** @param {{installRoot: string, backupId?: string|null, run?: any, dryRun?: boolean}} input */
export async function rollbackShippingPlugin(input) {
  const paths = pluginPaths(input.installRoot);
  const document = await history(paths);
  const candidates = document.items.filter((entry) => entry.backup);
  const entry = input.backupId ? candidates.find((item) => item.backup.id === input.backupId) : candidates.at(-1);
  invariant(entry?.backup, 'ERR_PLUGIN_ROLLBACK', 'No matching plugin backup is available');
  const backupRoot = assertContainedPath(paths.backups, entry.backup.backupRoot, 'plugin backup');
  invariant(await exists(path.join(backupRoot, 'backup.json')), 'ERR_PLUGIN_ROLLBACK', 'Backup metadata is missing');
  if (input.dryRun !== false) return { schema: 'shipping-plugin/rollback-v1', dryRun: true, changed: false, from: entry.to, to: entry.from, backup: entry.backup, preservesProjectState: true };
  await cp(path.join(backupRoot, 'assets'), paths.assets, { recursive: true, force: true });
  await cp(path.join(backupRoot, 'install-receipt.json'), paths.receipt, { force: true });
  await cp(path.join(backupRoot, 'registration.json'), paths.registration, { force: true });
  const receipt = await readJson(paths.receipt);
  if (receipt.host === 'codex' && receipt.registration) applyCodexRegistration(receipt.registration, { replace: true, run: input.run });
  document.items.push({ id: `rollback-${Date.now()}`, at: new Date().toISOString(), from: entry.to, to: entry.from, backupId: entry.backup.id });
  await writeJsonAtomic(paths.upgradeHistory, document);
  const after = await doctorShippingPlugin({ installRoot: input.installRoot, projectRoot: receipt.projectRoot, run: input.run });
  return { schema: 'shipping-plugin/rollback-v1', dryRun: false, changed: true, from: entry.to, to: entry.from, backup: entry.backup, receipt, after, preservesProjectState: true };
}
