import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** @param {string | Buffer} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

/** @param {unknown} value */
export function stableStringify(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

/** @param {unknown} value */
export function hashObject(value) {
  return sha256(stableStringify(value));
}

/** @param {string} filePath */
export async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}