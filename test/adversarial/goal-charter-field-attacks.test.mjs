import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import { auditGoalCharterHistory, loadArchivedGoalCharter, persistAcceptedGoalCharter } from '../../src/core/goal-charter.mjs';
import { hashObject } from '../../src/core/crypto.mjs';
import { writeJsonAtomic } from '../../src/core/fs.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const goal = 'Complete one useful internal workflow with repository-owned tests and no external deployment.';

function nextReleaseCharter(charter, release = '0.2.0') {
  const next = structuredClone(charter);
  next.release = release;
  next.proposalId = `${charter.proposalId}-next`;
  next.proposalRevision += 1;
  next.proposalHash = 'b'.repeat(64);
  next.binding.previewHash = 'c'.repeat(64);
  next.binding.contractHash = 'd'.repeat(64);
  next.binding.releaseTrainHash = 'e'.repeat(64);
  next.binding.acceptedAt = new Date(Date.parse(charter.binding.acceptedAt) + 1000).toISOString();
  delete next.hash;
  next.hash = hashObject(next);
  return next;
}

async function approvedFixture() {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  const created = await createScopeProposal(fixture.root, { goal, release: '0.1.0' });
  const approved = await approveScopeProposal(fixture.root, {
    proposalId: created.proposal.id,
    proposalHash: created.proposal.hash,
    confirm: true,
    approverType: 'human',
    approverId: 'field-adversary-owner',
  });
  return { fixture, charter: approved.goalCharter };
}

function validReceipt(release, requiredFailed = 0) {
  return {
    schema: 'shipping-harness/release-v1',
    release,
    project: 'fixture-project',
    worker: 'fixture-worker',
    goal,
    contractHash: '1'.repeat(64),
    baselineSha: '2'.repeat(40),
    closedGitSha: '3'.repeat(40),
    closedAt: new Date().toISOString(),
    acceptance: { total: 1, passed: requiredFailed === 0 ? 1 : 0, failed: requiredFailed, requiredFailed },
    issueCounts: { BLOCKER: 0, NEXT: 0, IGNORE: 0, UNKNOWN: 0 },
  };
}

test('next-release charter rollover fails without a predecessor CLOSED receipt', async () => {
  const { fixture, charter } = await approvedFixture();
  try {
    await assert.rejects(
      persistAcceptedGoalCharter(fixture.root, nextReleaseCharter(charter)),
      (error) => error.code === 'ERR_GOAL_CHARTER_PREDECESSOR_OPEN',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('failed or incomplete predecessor receipt cannot authorize charter rollover', async () => {
  const { fixture, charter } = await approvedFixture();
  try {
    const receiptPath = path.join(runtimePaths(fixture.root).releases, '0.1.0.json');
    await writeJsonAtomic(receiptPath, validReceipt('0.1.0', 1));
    await assert.rejects(
      persistAcceptedGoalCharter(fixture.root, nextReleaseCharter(charter)),
      (error) => error.code === 'ERR_GOAL_CHARTER_PREDECESSOR_OPEN',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rehashed archived charter tamper is detected against the immutable Decision Ledger acceptance', async () => {
  const { fixture, charter } = await approvedFixture();
  try {
    const receiptPath = path.join(runtimePaths(fixture.root).releases, '0.1.0.json');
    await writeJsonAtomic(receiptPath, validReceipt('0.1.0', 0));
    await persistAcceptedGoalCharter(fixture.root, nextReleaseCharter(charter));
    const archived = await loadArchivedGoalCharter(fixture.root, '0.1.0');
    const archivePath = path.join(runtimePaths(fixture.root).releases, '0.1.0-goal-charter.json');
    const tampered = structuredClone(archived);
    tampered.outcome = `${tampered.outcome} silently changed`;
    delete tampered.hash;
    tampered.hash = hashObject(tampered);
    await writeFile(archivePath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    await assert.rejects(
      auditGoalCharterHistory(fixture.root),
      (error) => error.code === 'ERR_GOAL_CHARTER_ARCHIVE_DRIFT',
    );
    assert.notEqual((await readFile(archivePath, 'utf8')).length, 0);
  } finally {
    await fixture.cleanup();
  }
});
