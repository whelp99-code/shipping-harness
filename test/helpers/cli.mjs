import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binPath = path.join(projectRoot, 'bin', 'shipping-harness.mjs');

/** @param {string} root @param {string[]} args */
export function runCli(root, args) {
  const result = spawnSync(process.execPath, [binPath, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

/** @param {ReturnType<typeof runCli>} result */
export function parseCliJson(result) {
  return JSON.parse(result.stdout);
}