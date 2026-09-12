#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises';
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
const amendmentId = 'AMEND-0.9.0-001';
const additions = ['scripts/build.mjs', 'scripts/amend-v09-packaging-scope.mjs'];
const amendmentsDirectory = path.join(paths.directory, 'amendments');
const receiptPath = path.join(amendmentsDirectory, `${amendmentId}.json`);

async function main() {
  const [contract, lock, state, rawContract] = await Promise.all([
    loadContract(paths.contract),
    readJson(paths.lock),
    readState(root),
    readFile(paths.contract, 'utf8'),
  ]);
  invariant(contract.release === '0.9.0', 'ERR_AMEND_RELEASE', 'This amendment is valid only for v0.9.0');
  invariant(lock.release === contract.release, 'ERR_AMEND_LOCK', 'Lock release does not match the contract');
  invariant(lock.contractHash === contractHash(contract), 'ERR_AMEND_LOCK', 'Existing contract differs from its lock');
  invariant(state.state === 'LOCKED', 'ERR_AMEND_STATE', `Unexpected amendment state: ${state.state}`);

  const corrected = structuredClone(contract);
  corrected.scope.paths.include = [...new Set([...corrected.scope.paths.include, ...additions])];
  corrected.scope.include = [...corrected.scope.include,
    'The distributable build includes the existing packages and config trees and marks the internal remote CLI executable; this is packaging of the locked v0.9 behavior, not new product scope.',
  ];
  const oldHash = contractHash(contract);
  const newHash = contractHash(corrected);
  invariant(oldHash !== newHash, 'ERR_AMEND_NO_CHANGE', 'Contract amendment did not change the hash');

  await mkdir(amendmentsDirectory, { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(amendmentsDirectory, `${amendmentId}-before-contract.yaml`), rawContract);
  await writeJsonAtomic(path.join(amendmentsDirectory, `${amendmentId}-before-lock.json`), lock);
  const receipt = {
    schema: 'shipping-harness/contract-amendment-v1',
    id: amendmentId,
    project: contract.project,
    release: contract.release,
    actor: 'human-approved-sequential-build',
    kind: 'required-distribution-path-correction',
    reason: 'The locked v0.9 build acceptance requires a runnable remote binary, but scripts/build.mjs was omitted from the approved path list and the current distributor did not copy packages/ or config/. The amendment permits only that packaging correction.',
    previousState: state.state,
    previousContractHash: oldHash,
    correctedContractHash: newHash,
    previousScopeRevision: lock.scopeRevision,
    removed: [],
    added: additions.map((value) => ({ field: 'scope.paths.include', value })),
    semanticScopeExpansion: false,
    executableAcceptanceChanged: false,
    publicBoundaryChanged: false,
    remoteActionSurfaceChanged: false,
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
  }, 'explicit v0.9 distribution path correction');
  await recordLedger(root, {
    type: 'contract.amended',
    amendmentId,
    previousContractHash: oldHash,
    correctedContractHash: newHash,
    added: receipt.added,
    semanticScopeExpansion: false,
    receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/'),
  });
  process.stdout.write(`${JSON.stringify({
    amendmentId,
    oldHash,
    newHash,
    receiptPath: path.relative(root, receiptPath),
    state: 'DRAFT',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
