import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { MANAGED_RELATIVE_PATHS, OMP_BACKUP_SCHEMA, OMP_ROLLBACK_SCHEMA } from './constants.mjs';
import {
  assertInside,
  copyFileAtomic,
  exists,
  fileReceipt,
  invariant,
  readJson,
  removeKnownFile,
  writeJsonAtomic,
} from './io.mjs';
import { backupInstalledShippingPackage, installShippingPackage, installedShippingVersion } from './package.mjs';

/** @param {Date} date */
function backupId(date) {
  return `shipping-harness-${date.toISOString().replace(/[:.]/gu, '')}`;
}

/** @param {Record<string, any>} paths @param {string} id */
export function backupDirectory(paths, id) {
  invariant(/^shipping-harness-[0-9TZ-]+$/u.test(id), 'ERR_OMP_BACKUP_ID', `Invalid backup ID: ${id}`);
  return assertInside(paths.backups, path.join(paths.backups, id), 'backup directory');
}

/**
 * @param {Record<string, any>} paths
 * @param {{shippingPrefix: string, npmCommand?: string, ompVersion?: string|null, now?: Date}} input
 */
export async function createOmpBackup(paths, input) {
  const now = input.now ?? new Date();
  const id = backupId(now);
  const directory = backupDirectory(paths, id);
  const filesRoot = path.join(directory, 'files');
  const packagesRoot = path.join(directory, 'packages');
  await mkdir(filesRoot, { recursive: true, mode: 0o700 });
  await mkdir(packagesRoot, { recursive: true, mode: 0o700 });

  const files = [];
  for (const relativePath of MANAGED_RELATIVE_PATHS) {
    const source = assertInside(paths.agentDir, path.join(paths.agentDir, relativePath), 'managed OMP source');
    const receipt = await fileReceipt(source);
    const backupRelativePath = receipt.existed ? path.join('files', relativePath).replaceAll('\\', '/') : null;
    if (receipt.existed) {
      const destination = assertInside(directory, path.join(directory, backupRelativePath), 'managed OMP backup');
      await copyFileAtomic(source, destination, receipt.mode ?? 0o600);
    }
    files.push({ relativePath, backupRelativePath, ...receipt });
  }

  const previousShippingVersion = installedShippingVersion(input.shippingPrefix);
  const previousPackage = await backupInstalledShippingPackage({
    prefix: input.shippingPrefix,
    destination: packagesRoot,
    npmCommand: input.npmCommand,
  });
  const manifest = {
    schema: OMP_BACKUP_SCHEMA,
    backupId: id,
    createdAt: now.toISOString(),
    agentDir: paths.agentDir,
    shippingPrefix: path.resolve(input.shippingPrefix),
    previousShippingVersion,
    ompVersion: input.ompVersion ?? null,
    files,
    previousPackage: previousPackage ? {
      path: path.relative(directory, previousPackage.path).replaceAll('\\', '/'),
      version: previousPackage.version,
      sha256: previousPackage.sha256,
    } : null,
  };
  await writeJsonAtomic(path.join(directory, 'manifest.json'), manifest, 0o600);
  return { id, directory, manifest };
}

/**
 * @param {Record<string, any>} paths
 * @param {{backupId: string, shippingPrefix: string, npmCommand?: string, dryRun?: boolean}} input
 */
export async function restoreOmpBackup(paths, input) {
  const directory = backupDirectory(paths, input.backupId);
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = await readJson(manifestPath);
  invariant(manifest?.schema === OMP_BACKUP_SCHEMA, 'ERR_OMP_BACKUP_SCHEMA', 'Unsupported OMP backup manifest');
  invariant(path.resolve(manifest.agentDir) === path.resolve(paths.agentDir), 'ERR_OMP_BACKUP_TARGET', 'Backup belongs to a different OMP agent directory');
  invariant(path.resolve(manifest.shippingPrefix) === path.resolve(input.shippingPrefix), 'ERR_OMP_BACKUP_TARGET', 'Backup belongs to a different Shipping prefix');
  const dryRun = input.dryRun !== false;

  if (!dryRun) {
    for (const entry of manifest.files ?? []) {
      invariant(MANAGED_RELATIVE_PATHS.includes(entry.relativePath), 'ERR_OMP_BACKUP_FILE', `Backup contains unmanaged path: ${entry.relativePath}`);
      const target = assertInside(paths.agentDir, path.join(paths.agentDir, entry.relativePath), 'managed OMP restore target');
      if (entry.existed) {
        const source = assertInside(directory, path.join(directory, entry.backupRelativePath), 'managed OMP restore source');
        const observed = await fileReceipt(source);
        invariant(observed.sha256 === entry.sha256, 'ERR_OMP_BACKUP_TAMPERED', `Backup file digest changed: ${entry.relativePath}`);
        await copyFileAtomic(source, target, entry.mode ?? 0o600);
      } else {
        await removeKnownFile(target);
      }
    }

    if (manifest.previousPackage) {
      const archive = assertInside(directory, path.join(directory, manifest.previousPackage.path), 'previous package');
      const restored = await installShippingPackage({
        prefix: input.shippingPrefix,
        archive,
        npmCommand: input.npmCommand,
        expectedVersion: manifest.previousPackage.version,
        requireOmpCli: false,
      });
      invariant(restored.packageSha256 === manifest.previousPackage.sha256, 'ERR_OMP_BACKUP_TAMPERED', 'Previous package digest changed');
    }
  }

  const result = {
    schema: OMP_ROLLBACK_SCHEMA,
    backupId: input.backupId,
    restoredAt: new Date().toISOString(),
    dryRun,
    restoredShippingVersion: dryRun ? manifest.previousShippingVersion : installedShippingVersion(input.shippingPrefix),
    restoredFiles: (manifest.files ?? []).map((entry) => ({ relativePath: entry.relativePath, existed: entry.existed })),
    packageRestored: Boolean(manifest.previousPackage),
  };
  if (!dryRun) await writeJsonAtomic(path.join(directory, 'rollback.json'), result, 0o600);
  return result;
}

/** @param {Record<string, any>} paths @param {string} id */
export async function readOmpBackup(paths, id) {
  const directory = backupDirectory(paths, id);
  const manifest = await readJson(path.join(directory, 'manifest.json'));
  invariant(manifest?.schema === OMP_BACKUP_SCHEMA, 'ERR_OMP_BACKUP_SCHEMA', 'Unsupported OMP backup manifest');
  return { directory, manifest };
}
