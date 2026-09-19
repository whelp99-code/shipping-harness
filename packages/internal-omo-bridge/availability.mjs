// Whether the private OMO runtime this bridge pins is actually installed. The runtime
// was retired in v1.11.1 and its pin is a real absolute path outside this repository,
// so it is absent on most machines and on every CI runner. Code that needs it must
// report a skip, never crash and never quietly pass.
//
// v1.13.10: this lived in test/omo/helpers.mjs, reachable only from tests, so the two
// smoke scripts that need the same answer had no way to ask and died with ENOENT
// instead. That is why smoke:remote and smoke:stable were excluded from the gate.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {string} [root] Repository root holding config/upstreams/omo-pin.json.
 * @returns {{available: boolean, reason: string}} Availability and, when absent, why.
 */
export function privateOmoRuntimeAvailability(root = packageRoot) {
  const pinPath = path.join(root, 'config', 'upstreams', 'omo-pin.json');
  let pin;
  try {
    pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  } catch (error) {
    return { available: false, reason: `omo-pin.json could not be read: ${error?.message ?? error}` };
  }
  const manifestPath = path.join(pin.runtimeRoot, 'runtime-manifest.json');
  if (!existsSync(manifestPath)) {
    return { available: false, reason: `the private OMO runtime retired in v1.11.1 is not installed at its pinned path (missing ${manifestPath})` };
  }
  return { available: true, reason: '' };
}

/**
 * Print a `SKIPPED: <reason>` line release:verify counts, and report whether the caller
 * should stop. Keeps the two smoke scripts from each inventing the same shape.
 * @param {string} [root] Repository root.
 * @returns {boolean} True when the runtime is absent and a skip was printed.
 */
export function skipWithoutPrivateOmoRuntime(root = packageRoot) {
  const runtime = privateOmoRuntimeAvailability(root);
  if (runtime.available) return false;
  process.stdout.write(`SKIPPED: ${runtime.reason}\n`);
  return true;
}
