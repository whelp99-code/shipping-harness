import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * @param {unknown} condition
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {asserts condition}
 */
export function invariant(condition, code, message, details = undefined) {
  if (condition) return;
  const error = /** @type {Error & {code?: string, details?: unknown}} */ (new Error(message));
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

/**
 * @param {import('node:crypto').BinaryLike} value
 * @returns {string}
 */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {import('node:fs').PathLike} target
 * @returns {Promise<boolean>}
 */
export async function exists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    // Existence probe: absence and any other access error both mean "not present" to callers.
    return false;
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function validateAbsoluteRoot(value, label) {
  invariant(typeof value === 'string' && value.trim(), 'ERR_OMP_PATH', `${label} is required`);
  invariant(!value.includes('\0'), 'ERR_OMP_PATH', `${label} contains a null byte`);
  const resolved = path.resolve(value);
  invariant(resolved !== path.parse(resolved).root, 'ERR_OMP_PATH', `${label} cannot be a filesystem root`);
  return resolved;
}

/**
 * @param {string} root
 * @param {string} target
 * @param {string} [label]
 * @returns {string}
 */
export function assertInside(root, target, label = 'path') {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  invariant(resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`), 'ERR_OMP_PATH_ESCAPE', `${label} escapes the managed root`, { root: resolvedRoot, target: resolved });
  return resolved;
}

/**
 * @param {string} target
 * @param {string} label
 * @returns {Promise<import('node:fs').Stats>}
 */
export async function assertRegularFile(target, label) {
  const info = await lstat(target).catch(() => null);
  invariant(info, 'ERR_OMP_FILE', `${label} must be a regular file: ${target}`);
  invariant(info.isFile() && !info.isSymbolicLink(), 'ERR_OMP_FILE', `${label} must be a regular file: ${target}`);
  return info;
}

/**
 * @param {string} target
 * @param {string} label
 * @returns {Promise<string>}
 */
export async function assertExecutable(target, label) {
  await assertRegularFile(target, label);
  try {
    await access(target, fsConstants.X_OK);
  } catch {
    // The X_OK access error itself is redundant with the message; the target path is the useful diagnostic.
    invariant(false, 'ERR_OMP_EXECUTABLE', `${label} is not executable: ${target}`);
  }
  return target;
}

/**
 * @param {string} target
 * @param {string} text
 * @param {number} [mode]
 * @returns {Promise<void>}
 */
export async function writeTextAtomic(target, text, mode = 0o600) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, text, { encoding: 'utf8', mode });
  await rename(temporary, target);
  await chmod(target, mode);
}

/**
 * @param {string} target
 * @param {unknown} value
 * @param {number} [mode]
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(target, value, mode = 0o600) {
  await writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`, mode);
}

/** @param {string} target @param {unknown} [fallback] */
export async function readJson(target, fallback = undefined) {
  try {
    return JSON.parse(await readFile(target, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error && typeof error === 'object' && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/**
 * @typedef {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, maxBuffer?: number}} RunCommandOptions
 */

/**
 * @param {string} command
 * @param {string[]} [args]
 * @param {RunCommandOptions} [options]
 * @returns {{stdout: string, stderr: string, status: number}}
 */
export function runCommand(command, args = [], options = {}) {
  invariant(typeof command === 'string' && command.trim(), 'ERR_OMP_COMMAND', 'Command is required');
  invariant(Array.isArray(args) && args.every((entry) => typeof entry === 'string'), 'ERR_OMP_COMMAND', 'Command arguments must be strings');
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120000,
    maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  invariant(result.status === 0, 'ERR_OMP_COMMAND_FAILED', `${command} ${args.join(' ')} failed`, {
    status: result.status,
    stdout: String(result.stdout ?? '').slice(-4000),
    stderr: String(result.stderr ?? '').slice(-4000),
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    status: result.status,
  };
}

/**
 * @param {string} output
 * @param {string} label
 * @returns {unknown}
 */
export function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    invariant(false, 'ERR_OMP_JSON', `${label} did not return JSON`, { output: String(output).slice(0, 2000), cause: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * @param {string} output
 * @returns {string}
 */
export function parseOmpVersion(output) {
  const match = /(?:^|\s)(?:omp\/)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/u.exec(String(output).trim());
  invariant(match, 'ERR_OMP_VERSION', `Could not parse OMP version from: ${String(output).trim()}`);
  return match[1];
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveOnPath(command, env = process.env) {
  if (path.isAbsolute(command) || command.includes(path.sep)) return path.resolve(command);
  const pathValue = env.PATH ?? '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      const result = spawnSync('/usr/bin/test', ['-x', candidate]);
      if (result.status === 0) return candidate;
    } catch {
      // Keep searching.
    }
  }
  return command;
}

/**
 * @typedef {{existed: boolean, sha256: string|null, mode: number|null, bytes: number}} FileReceipt
 */

/**
 * @param {string} target
 * @returns {Promise<FileReceipt>}
 */
export async function fileReceipt(target) {
  if (!(await exists(target))) return { existed: false, sha256: null, mode: null, bytes: 0 };
  const info = await assertRegularFile(target, 'managed OMP file');
  const body = await readFile(target);
  return {
    existed: true,
    sha256: sha256(body),
    mode: info.mode & 0o777,
    bytes: info.size,
  };
}

/** @param {string} source @param {string} target @param {number} [mode] */
export async function copyFileAtomic(source, target, mode = undefined) {
  await assertRegularFile(source, 'backup file');
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await copyFile(source, temporary);
  const sourceMode = mode ?? ((await stat(source)).mode & 0o777);
  await chmod(temporary, sourceMode);
  await rename(temporary, target);
}

/**
 * @param {string} target
 * @returns {Promise<void>}
 */
export async function removeKnownFile(target) {
  const info = await lstat(target).catch(() => null);
  if (!info) return;
  invariant(info.isFile() || info.isSymbolicLink(), 'ERR_OMP_FILE', `Refusing to remove a non-file managed path: ${target}`);
  await rm(target, { force: true });
}
