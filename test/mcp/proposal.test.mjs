import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { approveScopeProposal, createScopeProposal, loadScopeProposal } from '../../src/core/proposals.mjs';
import { readState } from '../../src/core/state.mjs';
import { analyzeRepository } from '../../src/core/project-analysis.mjs';

test('repository analysis creates a minimal proposal and explicit approval locks it', async () => {
  const fixture = await createFixtureRepo({ packageScripts: { build: `node -e "process.exit(0)"`, lint: `node -e "process.exit(0)"` } });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Ship a working command line greeting', release: '0.1.0' });
    assert.equal(proposal.readyForApproval, true);
    assert.deepEqual(proposal.analysis.types, ['node']);
    assert.deepEqual(proposal.contract.acceptance.map((criterion) => criterion.command), ['npm run lint', 'npm run build', 'npm test']);
    assert.ok(proposal.contract.scope.exclude.some((item) => item.includes('Unrequested web')));
    assert.equal(proposal.plan.length, 4);

    await assert.rejects(
      approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: false }),
      (error) => error.code === 'ERR_APPROVAL_REQUIRED',
    );
    const approved = await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
    assert.equal(approved.state.state, 'LOCKED');
    assert.equal((await readState(fixture.root)).approvedProposalHash, proposal.hash);
  } finally {
    await fixture.cleanup();
  }
});

test('proposal approval rejects stale Git SHA, dirty source, and tampering', async () => {
  const stale = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(stale.root, { goal: 'Deliver a stable fixture release' });
    await writeFile(path.join(stale.root, 'README.md'), '# Changed\n', 'utf8');
    await stale.commit('change after proposal');
    await assert.rejects(
      approveScopeProposal(stale.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true }),
      (error) => error.code === 'ERR_PROPOSAL_STALE',
    );
  } finally {
    await stale.cleanup();
  }

  const dirty = await createFixtureRepo();
  try {
    const { proposal } = await createScopeProposal(dirty.root, { goal: 'Deliver a stable fixture release' });
    await writeFile(path.join(dirty.root, 'README.md'), '# Dirty\n', 'utf8');
    await assert.rejects(
      approveScopeProposal(dirty.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true }),
      (error) => error.code === 'ERR_PROPOSAL_DIRTY',
    );
  } finally {
    await dirty.cleanup();
  }

  const tampered = await createFixtureRepo();
  try {
    const { proposal, proposalPath } = await createScopeProposal(tampered.root, { goal: 'Deliver a stable fixture release' });
    const raw = JSON.parse(await readFile(proposalPath, 'utf8'));
    raw.goal = 'Tampered goal';
    await writeFile(proposalPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    await assert.rejects(loadScopeProposal(tampered.root, proposal.id), (error) => error.code === 'ERR_PROPOSAL_TAMPERED');
  } finally {
    await tampered.cleanup();
  }
});

test('analysis ignores placeholder failing npm tests and includes lockfile evidence', async () => {
  const fixture = await createFixtureRepo({ testScript: 'echo "Error: no test specified" && exit 1' });
  try {
    await writeFile(path.join(fixture.root, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
    await fixture.commit('add lockfile');
    const analysis = await analyzeRepository(fixture.root);
    assert.ok(analysis.manifests.includes('package-lock.json'));
    assert.deepEqual(analysis.candidateCommands.map((candidate) => candidate.command), ['git diff --check']);
    assert.ok(analysis.diagnostics.some((diagnostic) => diagnostic.includes('fallback gate is weak')));
  } finally {
    await fixture.cleanup();
  }
});

test('generated proposals strip inherited adapter commands before approval', async () => {
  const fixture = await createFixtureRepo({
    contract: (contract) => ({
      ...contract,
      adapters: { ...contract.adapters, codex: { ...contract.adapters.codex, command: 'codex exec hidden-task' } },
    }),
  });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Ship without hidden executable configuration' });
    assert.equal(proposal.contract.adapters.codex.command, null);
    assert.ok(proposal.diagnostics.some((diagnostic) => diagnostic.includes('Existing adapter commands were removed')));
  } finally {
    await fixture.cleanup();
  }
});

test('analysis and proposal storage reject symlinks escaping the repository', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'shipping-harness-outside-'));
  const manifestFixture = await createFixtureRepo();
  try {
    const outsidePackage = path.join(outside, 'package.json');
    await writeFile(outsidePackage, '{"name":"outside","scripts":{"test":"echo leaked"}}\n', 'utf8');
    await unlink(path.join(manifestFixture.root, 'package.json'));
    await symlink(outsidePackage, path.join(manifestFixture.root, 'package.json'));
    await assert.rejects(analyzeRepository(manifestFixture.root), (error) => error.code === 'ERR_PATH_OUTSIDE_REPO');
  } finally {
    await manifestFixture.cleanup();
  }

  const proposalFixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await mkdir(path.join(proposalFixture.root, '.shipping'));
    await symlink(outside, path.join(proposalFixture.root, '.shipping', 'proposals'));
    await assert.rejects(
      createScopeProposal(proposalFixture.root, { goal: 'Do not write proposal data outside the repository' }),
      (error) => error.code === 'ERR_PATH_OUTSIDE_REPO',
    );
  } finally {
    await proposalFixture.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});