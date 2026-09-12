// Surface-freeze test: pins the public surface (MCP tools, CLI help text, schemas/v1
// contents) to SHA-256 hashes measured at the v1.8.2 close. Phase B refactors src/mcp
// and src/cli internals but must never change bytes any external caller observes.
//
// If this test fails after a refactor, the refactor changed the surface: fix the
// refactor, never these hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';
import { renderHelp } from '../../src/cli/output.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const EXPECTED = {
  tools: 'f4cf418cff5d25ea1c373021a9e3068a3851898a89b93fb55edf8e4a5cc0e8ab',
  // v1.10.0 Phase B: `lock`, `verify` and `close` gained the --skip-preflight,
  // --no-baseline-replay and --allow-uncommitted flags. A flag that cannot be discovered
  // from help is not a usable surface, so the baseline is updated deliberately and the
  // change is recorded in section 6 of
  // docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md.
  // Previous (v1.8.2) hash: cf161627cf9c2d578f77069fd5d19b4b7911eca119cfe19ed5caf643d282419c
  help: 'be5c0995563e66b8cf936cd7074b1279388e7b608aa42e061612f429b7332396',
  // v1.10.0: schemas/v1/state.schema.json gained the optional `integrity` object and the
  // example was updated with it. Deliberate, additive, and recorded in section 6 of
  // docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md.
  // Previous (v1.8.2) hash: 563fa876d0c61f612c2f4fa8666d2ad7561d5ad1d29e04e8e1773b22d83923c8
  schemas: 'd8303d3c7d52f650534a0ed65b4aa090098a82d5fb854c898e270a97cdc4ab36',
};

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Walk a directory recursively and return absolute file paths.
 * @param {string} dir absolute directory to walk
 * @returns {string[]} absolute file paths found under dir
 */
function walkFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Compute the schemas/v1 surface hash: sha256 of the newline-joined, byte-sorted
 * list of "schemas/v1/<relative-path>:sha256(content)" lines.
 * @returns {string} hex sha256 digest
 */
function computeSchemasHash() {
  const root = path.join(repoRoot, 'schemas', 'v1');
  const files = walkFiles(root).map((abs) => `schemas/v1/${path.relative(root, abs)}`).sort();
  const lines = files.map((relWithPrefix) => {
    const abs = path.join(repoRoot, relWithPrefix);
    const content = fs.readFileSync(abs);
    return `${relWithPrefix}:${sha256Hex(content)}`;
  });
  return sha256Hex(lines.join('\n'));
}

test('SHIPPING_TOOLS surface is byte-identical to the v1.8.2 baseline', () => {
  const hash = sha256Hex(JSON.stringify(SHIPPING_TOOLS));
  assert.equal(hash, EXPECTED.tools);
});

test('renderHelp() output is byte-identical to the recorded baseline', () => {
  const hash = sha256Hex(renderHelp());
  assert.equal(hash, EXPECTED.help);
});

test('schemas/v1 contents are byte-identical to the recorded baseline', () => {
  const hash = computeSchemasHash();
  assert.equal(hash, EXPECTED.schemas);
});
