// `npm pack --json` changed shape in npm 12: it used to print an array of packed
// entries and now prints an object keyed by package name. Every consumer in this repo
// assumed the array, so on npm >= 12 packaging and installation paths crashed with
// "Cannot read properties of undefined (reading 'filename')". This module is the single
// place that understands both shapes.
import { invariant } from './errors.mjs';

/**
 * Normalize the parsed stdout of `npm pack --json` into a list of packed entries,
 * accepting both the pre-12 array form and the npm >= 12 name-keyed object form.
 * @param {unknown} parsed Parsed JSON from `npm pack --json`.
 * @returns {Array<{filename: string, name?: string, version?: string, size?: number}>}
 */
export function normalizeNpmPackResult(parsed) {
  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed !== null && typeof parsed === 'object' ? Object.values(parsed) : []);
  const packed = entries.filter((entry) => entry !== null && typeof entry === 'object' && typeof (/** @type {any} */ (entry).filename) === 'string');
  invariant(packed.length > 0, 'ERR_NPM_PACK_SHAPE', 'npm pack --json returned no packed entry with a filename');
  return /** @type {Array<{filename: string}>} */ (packed);
}

/**
 * The single packed entry of an `npm pack --json` run, refusing an ambiguous result.
 * @param {unknown} parsed Parsed JSON from `npm pack --json`.
 * @param {string} [errorCode] Error code to raise when the result is not exactly one entry.
 * @returns {{filename: string, name?: string, version?: string, size?: number}}
 */
export function singleNpmPackEntry(parsed, errorCode = 'ERR_NPM_PACK_SHAPE') {
  const packed = normalizeNpmPackResult(parsed);
  invariant(packed.length === 1, errorCode, `npm pack --json returned ${packed.length} packed entries, expected exactly one`);
  return packed[0];
}
