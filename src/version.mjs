import { readFileSync } from 'node:fs';

const manifestUrl = new URL('../package.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) {
  throw new Error('package.json contains an invalid Shipping Harness version');
}

export const VERSION = manifest.version;
