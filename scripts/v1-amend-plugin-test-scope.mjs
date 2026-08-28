#!/usr/bin/env node
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
const amendmentId = 'AMEND-1.0.0-001';
const addedPath = 'test/plugin/doctor-repair.test.mjs';
const amendmentsDir = path.join(paths.directory, 'amendments');
const receiptPath = path.join(amendmentsDir, `${amendmentId}.json`);

const [contract, lock, state, rawContract] = await Promise.all([
  loadContract(paths.contract),
  readJson(paths.lock),
  readState(root),
  readFile(paths.contract, 'utf8'),
]);
invariant(contract.release === '1.0.0', 'ERR_AMEND_RELEASE', 'This amendment is valid only for v1.0.0');
invariant(lock.release === contract.release, 'ERR_AMEND_LOCK', 'Lock release does not match the contract');
invariant(lock.contractHash === contractHash(contract), 'ERR_AMEND_LOCK', 'Existing contract is already different from its lock');
invariant(state.state === 'LOCKED', 'ERR_AMEND_STATE', `Unexpected amendment state: ${state.state}`);
invariant(!contract.scope.paths.include.includes(addedPath), 'ERR_AMEND_TARGET', 'Plugin test path is already included');

const corrected = structuredClone(contract);
corrected.scope.paths.include = [...corrected.scope.paths.include, addedPath].sort();
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
  kind: 'version-independent-regression-test-correction',
  reason: 'The mandatory v1 plugin regression suite contains one historical assertion fixed to v0.6.0. The product upgrade path already passes v0.6.0 to v1.0.0; this amendment permits only that test to compare against the current package version.',
  previousState: state.state,
  previousContractHash: oldHash,
  correctedContractHash: newHash,
  previousScopeRevision: lock.scopeRevision,
  added: [{ field: 'scope.paths.include', value: addedPath }],
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
}, 'explicit v1 regression-test scope correction');
await recordLedger(root, {
  type: 'contract.amended',
  amendmentId,
  previousContractHash: oldHash,
  correctedContractHash: newHash,
  added: receipt.added,
  semanticProductScopeExpansion: false,
  receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/'),
});
process.stdout.write(`${JSON.stringify({ amendmentId, oldHash, newHash, receiptPath: path.relative(root, receiptPath), state: 'DRAFT' }, null, 2)}\n`);
