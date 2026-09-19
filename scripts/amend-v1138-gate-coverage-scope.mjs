#!/usr/bin/env node
// AMEND-1.13.8-001. The locked contract carried v1.8.2's scope verbatim: `release
// prepare` copies the previous release's scope statements and path allowlist forward,
// and this repository's cycle implements before it locks, so the stale scope has been
// inert for many releases and only bites work done after the lock. This release did
// such work -- closing the gate hole surfaced defects in packages/omp-main-harness and
// in CI -- so seven changed paths fell outside the allowlist and verify correctly
// refused with seven scope blockers.
//
// This amendment states the real scope of v1.13.8 and adds those seven paths. It is a
// genuine expansion that touches production code, and it is recorded as one.
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
const amendmentId = 'AMEND-1.13.8-001';
const amendmentsDir = path.join(paths.directory, 'amendments');
const receiptPath = path.join(amendmentsDir, `${amendmentId}.json`);

const ADDED_PATHS = [
  '.github/workflows/ci.yml',
  'docs/planning/39-V1.13.8-SPENT-AUTOPILOT-AND-GATE-COVERAGE-DEVELOPMENT-PLAN.md',
  'packages/omp-main-harness/install.mjs',
  'packages/omp-main-harness/io.mjs',
  'packages/omp-main-harness/package.mjs',
  'test/autopilot/spent-policy-recovery.test.mjs',
  'test/omp-main-harness/npm-command.test.mjs',
];

const SCOPE_INCLUDE = [
  'A policy bound to a release that has a closure receipt and is not the current release is spent: it reports enabled=false and gates nothing.',
  'An activation that cannot succeed is refused before the approval mutates anything, and says that nothing was approved or locked.',
  'Activating a policy on a new train continues the single append-only autopilot ledger chain instead of restarting it at sequence 1.',
  'Every test/<suite>/ directory and every test:*/smoke:* script is reachable from a release:verify step or excluded with a written reason, enforced by a gate step.',
  'The defects that the ungated suites were hiding: the npm pack --json shape, the hardcoded npm path in the OMP package, the frozen version literal in the packaged-install smoke, and the fifth dirty-baseline test.',
  'A pull request runs the same gate list as a release.',
];

const SCOPE_EXCLUDE = [
  'Reopening a closed release, or letting a model approve, close, or mark RELEASED.',
  'Weakening any acceptance gate, budget, or output bound to make a step pass.',
  'Changing what the nine MCP tools are, or the frozen v1 schemas and surface hashes.',
  'Rebuilding or reactivating the retired private OMO runtime, or making a test that needs it fail instead of skip.',
  'Publishing, deployment, customer contact, purchase, credential changes, or external writes.',
];

const [contract, lock, state, rawContract] = await Promise.all([
  loadContract(paths.contract),
  readJson(paths.lock),
  readState(root),
  readFile(paths.contract, 'utf8'),
]);
invariant(contract.release === '1.13.8', 'ERR_AMEND_RELEASE', 'This amendment is valid only for v1.13.8');
invariant(lock.release === contract.release, 'ERR_AMEND_LOCK', 'Lock release does not match the contract');
invariant(lock.contractHash === contractHash(contract), 'ERR_AMEND_LOCK', 'Existing contract is already different from its lock');
invariant(state.state === 'LOCKED' || state.state === 'TRIAGE', 'ERR_AMEND_STATE', `Unexpected amendment state: ${state.state}`);
for (const added of ADDED_PATHS) {
  invariant(!contract.scope.paths.include.includes(added), 'ERR_AMEND_TARGET', `Path is already included: ${added}`);
}

const corrected = structuredClone(contract);
corrected.scope.paths.include = [...new Set([...corrected.scope.paths.include, ...ADDED_PATHS])].sort();
corrected.scope.include = SCOPE_INCLUDE;
corrected.scope.exclude = SCOPE_EXCLUDE;
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
  kind: 'stale-carried-scope-correction-and-expansion',
  reason: 'The locked contract still carried v1.8.2 scope statements and path allowlist, because release prepare copies the previous release forward and this repository implements before it locks, so a stale scope stays inert until work happens after the lock. Closing the release:verify coverage hole surfaced defects in packages/omp-main-harness and in the pull-request CI gate, and fixing them changed seven paths outside the allowlist. This amendment states the real v1.13.8 scope and adds those seven paths. It expands scope over production code and is recorded as such.',
  previousState: state.state,
  previousContractHash: oldHash,
  correctedContractHash: newHash,
  previousScopeRevision: lock.scopeRevision,
  added: [
    ...ADDED_PATHS.map((value) => ({ field: 'scope.paths.include', value })),
    ...SCOPE_INCLUDE.map((value) => ({ field: 'scope.include', value })),
    ...SCOPE_EXCLUDE.map((value) => ({ field: 'scope.exclude', value })),
  ],
  removed: [
    ...contract.scope.include.map((value) => ({ field: 'scope.include', value })),
    ...contract.scope.exclude.map((value) => ({ field: 'scope.exclude', value })),
  ],
  semanticProductScopeExpansion: true,
  executableAcceptanceChanged: false,
  productionCodeChanged: true,
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
}, 'v1.13.8 stale carried scope correction and gate-coverage expansion');
await recordLedger(root, {
  type: 'contract.amended',
  amendmentId,
  previousContractHash: oldHash,
  correctedContractHash: newHash,
  added: receipt.added,
  semanticProductScopeExpansion: true,
  receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/'),
});
process.stdout.write(`${JSON.stringify({ amendmentId, oldHash, newHash, addedPaths: ADDED_PATHS.length, state: 'DRAFT' }, null, 2)}\n`);
