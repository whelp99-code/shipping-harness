import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ShippingError, invariant } from './errors.mjs';
import { stableStringify } from './crypto.mjs';

/** @param {string} target */
export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    // Existence probe: absence and any other access error (permissions, ENOTDIR) both mean "not present" to callers.
    return false;
  }
}

/** @param {string} directory */
export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

/** @param {string} filePath */
export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

/** @template T @param {string} filePath @returns {Promise<T>} */
export async function readJson(filePath) {
  try {
    return JSON.parse(await readText(filePath));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new ShippingError('ERR_FILE_MISSING', `Required file is missing: ${filePath}`, { filePath });
    }
    throw new ShippingError('ERR_JSON_INVALID', `Invalid JSON in ${filePath}`, {
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @param {string} filePath
 * @param {string | Buffer} content
 */
export async function writeAtomic(filePath, content) {
  const directory = path.dirname(filePath);
  await ensureDir(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** @param {string} filePath @param {unknown} value */
export async function writeJsonAtomic(filePath, value) {
  await writeAtomic(filePath, stableStringify(value));
}

/** @param {string} filePath @param {unknown} value */
export async function appendJsonLine(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** @param {string} filePath */
export async function readJsonLines(filePath) {
  if (!(await exists(filePath))) return [];
  const text = await readText(filePath);
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new ShippingError('ERR_LEDGER_CORRUPT', `Invalid JSONL at ${filePath}:${index + 1}`, {
          filePath,
          line: index + 1,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    });
}

/**
 * Ensure an existing or future target remains below root after resolving symlinks.
 * @param {string} root
 * @param {string} target
 */
export async function assertContainedPath(root, target) {
  const realRoot = await realpath(root);
  const absoluteTarget = path.resolve(target);
  let existing = absoluteTarget;
  while (!(await exists(existing))) {
    const parent = path.dirname(existing);
    invariant(parent !== existing, 'ERR_PATH_OUTSIDE_REPO', 'Unable to resolve a repository-contained parent', {
      root,
      target,
    });
    existing = parent;
  }
  const realExisting = await realpath(existing);
  const relative = path.relative(realRoot, realExisting);
  invariant(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), 'ERR_PATH_OUTSIDE_REPO', 'Path escapes repository root', {
    root: realRoot,
    target: absoluteTarget,
    resolvedAncestor: realExisting,
  });
  return absoluteTarget;
}

/** @param {string} filePath */
export async function fileSize(filePath) {
  return (await stat(filePath)).size;
}

/** @param {string} filePath @param {string} content */
export async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
}