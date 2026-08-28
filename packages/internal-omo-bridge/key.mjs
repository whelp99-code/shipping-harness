import { chmod, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, writeAtomic } from '../../src/core/fs.mjs';
import { invariant } from '../../src/core/errors.mjs';
import { generateHmacKey } from './canonical.mjs';

/** @param {string} root @param {Record<string, any>} config */
export async function loadOrCreateBridgeKey(root, config) {
  const keyPath = path.resolve(config.hmacKeyPath);
  const expectedRoot = path.resolve(root, '.shipping', 'tmp');
  const relative = path.relative(expectedRoot, keyPath);
  invariant(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'ERR_OMO_BRIDGE_KEY_PATH', 'Private OMO key must remain under .shipping/tmp');
  if (await exists(keyPath)) {
    const info = await lstat(keyPath);
    invariant(info.isFile() && !info.isSymbolicLink(), 'ERR_OMO_BRIDGE_KEY_PATH', 'Private OMO key must be a regular file');
    const key = (await readFile(keyPath, 'utf8')).trim();
    invariant(key.length >= 32, 'ERR_OMO_BRIDGE_KEY', 'Private OMO key is invalid');
    await chmod(keyPath, 0o600);
    return { key, keyPath, created: false };
  }
  const key = generateHmacKey();
  await writeAtomic(keyPath, `${key}\n`);
  await chmod(keyPath, 0o600);
  return { key, keyPath, created: true };
}
