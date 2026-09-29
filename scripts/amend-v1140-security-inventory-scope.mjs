#!/usr/bin/env node
// AMEND-1.14.0-001. Locked verify failed security:inventory because
// src/core/autopilot.mjs changed and docs/reports/v1-security-inventory.json
// was outside the path allowlist. This adds that record and this script.
import path from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { contractHash, loadContract } from '../src/core/contract.mjs';
import { stableStringify } from '../src/core/crypto.mjs';
import { invariant } from '../src/core/errors.mjs';
import { readJson, writeAtomic, writeJsonAtomic } from '../src/core/fs.mjs';
import { currentGitSha } from '../src/core/git.mjs';
import { runtimePaths } from '../src/core/paths.mjs';
import { patchState, readState, recordLedger } from '../src/core/state.mjs';

const root = process.cwd();
const paths = runtimePaths(root);
const amendmentId = 'AMEND-1.14.0-001';
const amendmentsDir = path.join(paths.directory, 'amendments');
const receiptPath = path.join(amendmentsDir, `${amendmentId}.json`);
const addedPaths = [
  'docs/reports/v1-security-inventory.json',
  'scripts/amend-v1140-security-inventory-scope.mjs',
];

const [contract, lock, state, rawContract] = await Promise.all([
  loadContract(paths.contract),
  readJson(paths.lock),
  readState(root),
  readFile(paths.contract, 'utf8'),
]);
invariant(contract.release === '1.14.0', 'ERR_AMEND_RELEASE', 'This amendment is valid only for v1.14.0');
invariant(lock.contractHash === contractHash(contract), 'ERR_AMEND_LOCK', 'Existing contract is already different from its lock');
invariant(state.state === 'LOCKED' || state.state === 'TRIAGE', 'ERR_AMEND_STATE', `Unexpected amendment state: ${state.state}`);
for (const added of addedPaths) {
  invariant(!contract.scope.paths.include.includes(added), 'ERR_AMEND_TARGET', `Path is already included: ${added}`);
}

const corrected = structuredClone(contract);
corrected.scope.paths.include = [...new Set([...corrected.scope.paths.include, ...addedPaths])].sort();
const oldHash = contractHash(contract);
const newHash = contractHash(corrected);
invariant(oldHash !== newHash, 'ERR_AMEND_NO_CHANGE', 'Contract amendment did not change the hash');
await mkdir(amendmentsDir, { recursive: true, mode: 0o700 });
await writeAtomic(path.join(amendmentsDir, `${amendmentId}-before-contract.yaml`), rawContract);
await writeJsonAtomic(path.join(amendmentsDir, `${amendmentId}-before-lock.json`), lock);
const receipt = {
  schema: 'shipping-harness/contract-amendment-v1',
  id: amendmentId,
  project: contract.project,
  release: contract.release,
  actor: 'human-approved-sequential-build',
  kind: 'post-lock-inventory-record',
  reason: 'Locked verify failed security:inventory because src/core/autopilot.mjs changed. The inventory record lives outside the locked allowlist. This amendment adds that record and this script so the refreshed digest can be committed without a scope blocker. Acceptance commands are unchanged.',
  previousState: state.state,
  previousContractHash: oldHash,
  correctedContractHash: newHash,
  added: addedPaths.map((value) => ({ field: 'scope.paths.include', value })),
  removed: [],
  semanticProductScopeExpansion: false,
  executableAcceptanceChanged: false,
  productionCodeChanged: false,
  sourceGitSha: currentGitSha(root),
  recordedAt: new Date().toISOString(),
};
await writeJsonAtomic(receiptPath, receipt);
await writeAtomic(paths.contract, stableStringify(corrected));
await rm(paths.lock, { force: false });
await patchState(root, {
  state: 'DRAFT',
  contractHash: null,
  baselineSha: null,
  currentEvidenceSha: null,
  lastRunId: null,
  lastVerifiedAt: null,
  scopeAmendmentId: amendmentId,
}, 'v1.14.0 security inventory record added to scope');
await recordLedger(root, {
  type: 'contract.amended',
  amendmentId,
  previousContractHash: oldHash,
  correctedContractHash: newHash,
  added: receipt.added,
  semanticProductScopeExpansion: false,
  receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/'),
});
process.stdout.write(`${JSON.stringify({ amendmentId, oldHash, newHash, state: 'DRAFT' })}\n`);
