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
  // Merge of origin/main intent gate (v1.8.3 snapshot): shipping_start's `title` and
  // `description` now state that terse or ambiguous requests default to read-only
  // analysis and ask one workflow-boundary question. The tool count stays nine, no tool
  // was renamed, and no input property was added or removed. Deliberate tool-surface
  // change, recorded in section 6 of
  // docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md
  // under "Merge of origin/main intent gate".
  // Previous (v1.8.2) hash: f4cf418cff5d25ea1c373021a9e3068a3851898a89b93fb55edf8e4a5cc0e8ab
  //
  // v1.12.0 Phase A (plan-aware proposals): shipping_start gained the optional `planPath`
  // and `stageId` input properties and shipping_refine gained the optional `stageId`. The
  // tool count stays nine, no tool was renamed or removed, every added property is
  // optional, `additionalProperties: false` is kept, and no property is named
  // command/shell/args/argv/env/environment. Deliberate tool-surface change, recorded in
  // section 6 of
  // docs/planning/36-V1.12.0-PLAN-AWARE-PROPOSALS-DEVELOPMENT-PLAN.md under "Phase A".
  // Previous (v1.8.3 merge) hash: 2634c56694a462b373c12b9f153a4da5ac6290cb1a697f56f1c20fb1599bf26a
  //
  // v1.13.0 Phase A (baseline auto-commit): shipping_start gained the optional
  // `commitBaseline` boolean (default true), which commits the user's working tree as one
  // local, undoable baseline commit before analysis. The tool count stays nine, no tool was
  // renamed or removed, the added property is optional, `additionalProperties: false` is
  // kept, and no property is named command/shell/args/argv/env/environment. Deliberate
  // tool-surface change, recorded in section 6 of
  // docs/planning/38-V1.13.0-DIRTY-TREE-FRICTION-DEVELOPMENT-PLAN.md under "Phase A".
  // Previous (v1.12.0 Phase A) hash: 96807c58dc354de688d6fe4e66ae93dfa01b95ec03fa497bf755676f2a5a8792
  tools: 'a8038208c25805a295802e2cdcef6bec0136afe2a5ec3075b35a8e6b8137eca0',
  // v1.10.0 Phase B: `lock`, `verify` and `close` gained the --skip-preflight,
  // --no-baseline-replay and --allow-uncommitted flags. A flag that cannot be discovered
  // from help is not a usable surface, so the baseline is updated deliberately and the
  // change is recorded in section 6 of
  // docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md.
  // Previous (v1.8.2) hash: cf161627cf9c2d578f77069fd5d19b4b7911eca119cfe19ed5caf643d282419c
  //
  // v1.12.0 Phase B (plan-aware proposals surface): the CLI gained `plan status
  // [--plan PATH] [--json]` (progress table over the plan file) and `plan check
  // [--plan PATH] [--json]` (validate the plan file only, printing resolvable
  // candidate command IDs; exits 1 with the plan error code when invalid). Both
  // default `--plan` to docs/shipping-plan.json and are read-only. Deliberate
  // help-surface change, recorded in section 6 of
  // docs/planning/36-V1.12.0-PLAN-AWARE-PROPOSALS-DEVELOPMENT-PLAN.md under "Phase B".
  // Previous (v1.10.0 Phase B) hash: be5c0995563e66b8cf936cd7074b1279388e7b608aa42e061612f429b7332396
  help: '5fe7d6db59280adcb85e1b4f3b12e5a669c8ee49ed1cc346a7d098e68b5b0cb2',
  // v1.10.0 dirty-tree fix pass: schemas/v1/evidence.schema.json gained the optional
  // `treeFingerprint` and `dirtyPaths` fields, schemas/v1/state.schema.json gained the
  // optional `currentEvidenceFingerprint`, and schemas/v1/contract.schema.json gained the
  // optional `budgets.maxRedundantVerifyRuns` (with `budgets.maxVerifyRuns` redefined as
  // the total cap, range widened to 1..200). All additive, `additionalProperties: false`
  // kept, and the three examples updated. Recorded in section 6 of
  // docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md.
  // Previous (v1.10.0 Phase C) hash: 6d34415223f226331ab66e916b1424eb672dbd00324c750f2d18123a6af14893
  // Previous (v1.10.0 Phase A/B) hash: d8303d3c7d52f650534a0ed65b4aa090098a82d5fb854c898e270a97cdc4ab36
  // Previous (v1.8.2) hash: 563fa876d0c61f612c2f4fa8666d2ad7561d5ad1d29e04e8e1773b22d83923c8
  //
  // Merge of origin/main intent gate (v1.8.3 snapshot): schemas/v1/intent-gate.schema.json
  // and schemas/v1/examples/intent-gate.example.json are new files. Purely additive; no
  // existing schema changed. Recorded in the same section 6 entry.
  // Previous (v1.10.0 dirty-tree) hash: 163a44c39f77bd0db7c050a38696caef95ba0714977d495bb0908fc3ce9f05d7
  //
  // v1.12.0 Phase A (plan-aware proposals): schemas/v1/shipping-plan.schema.json and its
  // example are new files, schemas/v1/contract.schema.json gained the optional `plan`
  // object ({path, planHash, stageId, tier}), and schemas/v1/release.schema.json gained
  // the optional `planStageId`, `planHash` and `tier`. All additive,
  // `additionalProperties: false` kept everywhere, examples updated, and README table
  // extended. Recorded in section 6 of
  // docs/planning/36-V1.12.0-PLAN-AWARE-PROPOSALS-DEVELOPMENT-PLAN.md under "Phase A".
  // Previous (v1.8.3 merge) hash: 947bde699a45beaf77ecb80a8575d47fba269c0c5d55fc3bba8ee1011dc0a101
  //
  // v1.12.1 Phase A (plan update rules): schemas/v1/release.schema.json and
  // schemas/v1/lock.schema.json gained the optional `planStage` snapshot (the frozen
  // stage definition a closed receipt and the current lock attest to), and
  // schemas/v1/shipping-plan.schema.json gained the optional `program.supersedes`
  // SHA-256 of the plan a new plan replaces. All three examples were updated. Purely
  // additive, `additionalProperties: false` kept everywhere, no required field added or
  // removed. `tools` and `help` are unchanged: no MCP tool definition and no CLI help
  // line changed — `--plan` and `planPath` still exist, only their accepted value
  // narrowed to the fixed default. Recorded in section 6 of
  // docs/planning/37-V1.12.1-PLAN-UPDATE-RULES-DEVELOPMENT-PLAN.md under "Phase A".
  // Previous (v1.12.0 Phase A) hash: 56c481e6a7b66e22a0150fd9a53a4b6dd8de2aead679316a26ac2abd94d1af83
  //
  // v1.12.1 Phase B (plan drift and history): schemas/v1/shipping-plan.schema.json gained
  // the optional top-level `revision` (a positive integer bumped on every update that
  // changes the plan hash) and `sources[].sha256` (the source file's content hash at
  // write time, compared against the file on disk to report PLAN_SOURCE_DRIFT /
  // PLAN_SOURCE_MISSING; never blocks). The example was updated to carry both. Purely
  // additive, `additionalProperties: false` kept, no required field added or removed.
  // `tools` and `help` are unchanged. Recorded in section 6 of
  // docs/planning/37-V1.12.1-PLAN-UPDATE-RULES-DEVELOPMENT-PLAN.md under "Phase B".
  // Previous (v1.12.1 Phase A) hash: 0b5ca73c8fb594644b29e8778c18491304565f7160292683ea491867a79de187
  //
  // v1.13.0 Phase B (post-lock commit evidence): schemas/v1/release.schema.json gained the
  // optional `postLockCommits` (bounded {sha, subject, paths} rows for every commit between
  // the locked baseline and the closed revision) and `postLockCommitsTruncated`, and the
  // example was updated to carry one row. Purely additive, `additionalProperties: false`
  // kept, no required field added or removed, and the field never blocks a close.
  // `help` is unchanged: v1.13.0 adds no CLI command or flag. Recorded in section 6 of
  // docs/planning/38-V1.13.0-DIRTY-TREE-FRICTION-DEVELOPMENT-PLAN.md under "Phase B".
  // Previous (v1.12.1 Phase B) hash: 51ee7657dcb759ab404c150b9c6f0a9939ed074e208710542761c431e153ec0e
  schemas: 'faec1160a58ad1dfcab9f613973faced4401cfe61a07752cec9a3af589c11c29',
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
