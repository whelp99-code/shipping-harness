import path from 'node:path';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hmac, safeHex, sha256, randomId } from './crypto.mjs';
import { invariant } from './policy.mjs';

const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
const ALLOWED_ROOTS = [
  'contract.yaml',
  'contract.lock',
  'state.json',
  'ledger.jsonl',
  'issues.json',
  'backlog.json',
  'integrations.json',
  'hooks.jsonl',
  'goals',
  'releases',
  'proposals',
  'evidence',
];
const TERMINAL_STATES = new Set(['CLOSED', 'ABORTED']);
const ACTIVE_STATES = new Set(['RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING']);

function safeRelative(value) {
  const text = String(value ?? '').replaceAll('\\', '/');
  invariant(text && !text.startsWith('/') && !text.includes('\0'), 'ERR_BACKUP_PATH', 'Invalid backup path');
  const normalized = path.posix.normalize(text);
  invariant(normalized !== '.' && normalized !== '..' && !normalized.startsWith('../'), 'ERR_BACKUP_PATH', 'Backup path escapes root');
  invariant(!/(^|\/)(auth\.json|credentials|private[-_]?key|\.env)(\/|$)/iu.test(normalized), 'ERR_BACKUP_SECRET', 'Credential-like paths are not allowed in backups');
  return normalized;
}

function allowedShipping(relative) {
  return ALLOWED_ROOTS.some((root) => relative === root || relative.startsWith(`${root}/`));
}

async function walk(base, current = '', output = []) {
  const directory = path.join(base, current);
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return output;
    throw error;
  }
  for (const entry of entries) {
    const relative = safeRelative(path.posix.join(current, entry.name));
    if (relative === 'tmp' || relative.startsWith('tmp/')) continue;
    const full = path.join(base, relative);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(base, relative, output);
    } else if (entry.isFile() && allowedShipping(relative)) {
      const information = await stat(full);
      invariant(information.size <= MAX_FILE, 'ERR_BACKUP_SIZE', `Backup file too large: ${relative}`);
      output.push({ relative, full, size: information.size });
    }
  }
  return output;
}

export async function createBackup({
  projectId,
  projectRoot,
  serverSecret,
  outputPath,
  extraEvidenceFiles = [],
}) {
  const shippingRoot = path.join(path.resolve(projectRoot), '.shipping');
  const candidates = await walk(shippingRoot);
  const files = [];
  let totalBytes = 0;

  for (const item of candidates) {
    const bytes = await readFile(item.full);
    totalBytes += bytes.length;
    invariant(totalBytes <= MAX_TOTAL, 'ERR_BACKUP_SIZE', 'Backup exceeds total size limit');
    files.push({
      path: `shipping/${item.relative}`,
      bytes: bytes.toString('base64'),
      size: bytes.length,
      sha256: sha256(bytes),
      restore: true,
    });
  }

  for (const item of extraEvidenceFiles) {
    if (!item?.source || !item?.logicalPath) continue;
    const logical = safeRelative(item.logicalPath);
    const bytes = await readFile(item.source);
    totalBytes += bytes.length;
    invariant(bytes.length <= MAX_FILE && totalBytes <= MAX_TOTAL, 'ERR_BACKUP_SIZE', 'Backup evidence exceeds size limit');
    files.push({
      path: `evidence/${logical}`,
      bytes: bytes.toString('base64'),
      size: bytes.length,
      sha256: sha256(bytes),
      restore: false,
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const body = {
    schema: 'shipping-harness/backup-v1',
    backupId: randomId('BACKUP'),
    projectId,
    createdAt: new Date().toISOString(),
    files,
    totalBytes,
  };
  const bundle = { ...body, signature: hmac(body, serverSecret) };
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  return {
    backupId: bundle.backupId,
    path: outputPath,
    fileCount: files.length,
    totalBytes,
    signature: bundle.signature,
  };
}

export function validateBackup(bundle, { projectId, serverSecret }) {
  invariant(bundle?.schema === 'shipping-harness/backup-v1' && bundle.projectId === projectId, 'ERR_BACKUP_SCHEMA', 'Backup project or schema mismatch');
  const unsigned = { ...bundle };
  delete unsigned.signature;
  invariant(safeHex(hmac(unsigned, serverSecret), bundle.signature), 'ERR_BACKUP_SIGNATURE', 'Backup signature is invalid');
  let totalBytes = 0;
  for (const file of bundle.files ?? []) {
    safeRelative(file.path);
    const bytes = Buffer.from(file.bytes, 'base64');
    invariant(bytes.length === file.size && sha256(bytes) === file.sha256, 'ERR_BACKUP_INTEGRITY', `Backup file integrity failed: ${file.path}`);
    invariant(file.restore === true || file.restore === false, 'ERR_BACKUP_INTEGRITY', `Backup restore flag is invalid: ${file.path}`);
    totalBytes += bytes.length;
  }
  invariant(totalBytes === bundle.totalBytes && totalBytes <= MAX_TOTAL, 'ERR_BACKUP_SIZE', 'Backup total size mismatch');
  return bundle;
}

async function pauseRestoredNonTerminal(stage) {
  const statePath = path.join(stage, 'state.json');
  let state;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { paused: false, restoredState: null };
    throw error;
  }
  const restoredState = state.state;
  if (TERMINAL_STATES.has(restoredState) || restoredState === 'PAUSED') {
    return { paused: restoredState === 'PAUSED', restoredState };
  }
  const now = new Date().toISOString();
  await writeFile(statePath, `${JSON.stringify({
    ...state,
    state: 'PAUSED',
    resumeState: restoredState || 'LOCKED',
    humanStop: true,
    recoveryReason: 'restored-from-signed-backup',
    updatedAt: now,
  }, null, 2)}\n`, { mode: 0o600 });
  return { paused: true, restoredState };
}

export async function restoreBackup({ projectId, projectRoot, serverSecret, bundlePath }) {
  const bundle = validateBackup(JSON.parse(await readFile(bundlePath, 'utf8')), { projectId, serverSecret });
  const shippingRoot = path.join(path.resolve(projectRoot), '.shipping');
  let currentState = null;
  try {
    currentState = JSON.parse(await readFile(path.join(shippingRoot, 'state.json'), 'utf8')).state;
  } catch {}
  invariant(!ACTIVE_STATES.has(currentState), 'ERR_BACKUP_ACTIVE', 'Pause or stop active work before restore');

  const stage = path.join(path.dirname(shippingRoot), `.shipping-restore-${bundle.backupId}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true, mode: 0o700 });
  for (const file of bundle.files) {
    if (file.restore !== true || !file.path.startsWith('shipping/')) continue;
    const relative = safeRelative(file.path.slice('shipping/'.length));
    invariant(allowedShipping(relative), 'ERR_BACKUP_PATH', `Restore path is not an allowed Shipping state path: ${relative}`);
    const target = path.join(stage, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, Buffer.from(file.bytes, 'base64'), { mode: 0o600 });
  }
  const recovery = await pauseRestoredNonTerminal(stage);

  const previous = path.join(path.dirname(shippingRoot), `.shipping-before-restore-${Date.now()}`);
  try {
    await rename(shippingRoot, previous);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await rename(stage, shippingRoot);
  } catch (error) {
    try { await rename(previous, shippingRoot); } catch {}
    throw error;
  }
  return {
    restored: true,
    backupId: bundle.backupId,
    previousPath: previous,
    fileCount: bundle.files.filter((file) => file.restore === true && file.path.startsWith('shipping/')).length,
    restoredOriginalState: recovery.restoredState,
    pausedAfterRestore: recovery.paused,
  };
}

export function migrateBackup(bundle) {
  invariant(bundle?.schema === 'shipping-harness/backup-v1', 'ERR_BACKUP_MIGRATION', 'Unsupported backup schema');
  return bundle;
}
