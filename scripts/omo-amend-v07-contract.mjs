#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { contractHash, loadContract } from '../src/core/contract.mjs';
import { stableStringify } from '../src/core/crypto.mjs';
import { invariant } from '../src/core/errors.mjs';
import { readJson, writeAtomic, writeJsonAtomic } from '../src/core/fs.mjs';
import { currentGitSha } from '../src/core/git.mjs';
import { runtimePaths } from '../src/core/paths.mjs';
import { patchState, readState, recordLedger } from '../src/core/state.mjs';

const root = process.cwd();
const paths = runtimePaths(root);
const amendmentId = 'AMEND-0.7.0-001';
const invalidPath = '../shipping-harness-omo-runtime/**';
const amendmentsDir = path.join(paths.directory, 'amendments');
const receiptPath = path.join(amendmentsDir, `${amendmentId}.json`);

async function main() {
  const [contract, lock, state, rawContract] = await Promise.all([
    loadContract(paths.contract),
    readJson(paths.lock),
    readState(root),
    readFile(paths.contract, 'utf8'),
  ]);
  invariant(contract.release === '0.7.0', 'ERR_AMEND_RELEASE', 'This amendment is valid only for v0.7.0');
  invariant(lock.release === contract.release, 'ERR_AMEND_LOCK', 'Lock release does not match the contract');
  invariant(lock.contractHash === contractHash(contract), 'ERR_AMEND_LOCK', 'Existing contract is already different from its lock');
  const excludes = contract.scope?.paths?.exclude ?? [];
  invariant(excludes.filter((entry) => entry === invalidPath).length === 1, 'ERR_AMEND_TARGET', 'The exact invalid external path must occur once');
  invariant(['LOCKED', 'VERIFYING'].includes(state.state), 'ERR_AMEND_STATE', `Unexpected amendment state: ${state.state}`);
  const corrected = structuredClone(contract);
  corrected.scope.paths.exclude = excludes.filter((entry) => entry !== invalidPath);
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
    actor: 'human-directed-recovery',
    kind: 'non-semantic-invalid-path-correction',
    reason: 'A repository-outside path was mistakenly placed in a repository-relative scope list. The sibling runtime remains external by architecture and cannot be included by this contract.',
    previousState: state.state,
    previousContractHash: oldHash,
    correctedContractHash: newHash,
    previousScopeRevision: lock.scopeRevision,
    removed: [{ field: 'scope.paths.exclude', value: invalidPath }],
    added: [],
    semanticScopeExpansion: false,
    executableAcceptanceChanged: false,
    siblingRuntimeBoundaryChanged: false,
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
  }, 'explicit non-semantic v0.7 contract path correction');
  await recordLedger(root, {
    type: 'contract.amended',
    amendmentId,
    previousContractHash: oldHash,
    correctedContractHash: newHash,
    removed: receipt.removed,
    semanticScopeExpansion: false,
    receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/'),
  });
  process.stdout.write(`${JSON.stringify({ amendmentId, oldHash, newHash, receiptPath: path.relative(root, receiptPath), state: 'DRAFT' }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
