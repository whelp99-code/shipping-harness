// v1.12.1 Phase A, end to end against the real CLI: one stage is bound, locked, verified
// and closed; afterwards the unstarted stages are still free to edit while the closed one
// is frozen. The whole point of the feature is that the second half of that sentence is
// enforced, so the flow runs for real rather than against hand-written receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { parseCliJson, runCli } from '../helpers/cli.mjs';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import { DEFAULT_PLAN_PATH, PLAN_SCHEMA } from '../../src/core/shipping-plan.mjs';

const THREE_STAGE_PLAN = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
  stages: [
    {
      id: 'S-01',
      title: 'Deliver the core flow',
      outcome: 'Complete the core fixture flow so it runs end to end on the current revision.',
      dependsOn: [],
      acceptanceRefs: ['node-test'],
      scopeInclude: ['Core flow implementation and its acceptance evidence.'],
      scopeExclude: ['Optional polish and future extensibility work.'],
      size: 'MILESTONE',
    },
    {
      id: 'S-02',
      title: 'Operate and recover',
      outcome: 'Complete the install, health check, and rollback paths with reproducible evidence.',
      dependsOn: ['S-01'],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
    {
      id: 'S-03',
      title: 'Field harden',
      outcome: 'Complete the field hardening pass and remove every release blocker found in the pilot.',
      dependsOn: ['S-02'],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
  ],
};

/** @param {{root: string}} fixture @param {Record<string, any>} plan */
async function writePlan(fixture, plan) {
  await writeFile(path.join(fixture.root, DEFAULT_PLAN_PATH), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

/** Bind, lock, verify and close the next plan stage through the real engine and CLI. */
async function closeNextStage(fixture) {
  const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
  await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
  assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
  const closed = runCli(fixture.root, ['close', '--json']);
  assert.equal(closed.exitCode, 0, closed.stderr);
  return proposal.contract.plan.stageId;
}

test('a closed stage freezes while the unstarted stages stay editable', async () => {
  const fixture = await createFixtureRepo({ files: { [DEFAULT_PLAN_PATH]: `${JSON.stringify(THREE_STAGE_PLAN, null, 2)}\n` } });
  try {
    assert.equal(await closeNextStage(fixture), 'S-01');

    // The receipt froze the full stage definition, not only its identifier.
    const receipt = JSON.parse(await readFile(path.join(fixture.root, '.shipping', 'releases', '0.1.0.json'), 'utf8'));
    assert.equal(receipt.planStageId, 'S-01');
    assert.deepEqual(receipt.planStage, {
      id: 'S-01',
      title: 'Deliver the core flow',
      outcome: 'Complete the core fixture flow so it runs end to end on the current revision.',
      dependsOn: [],
      acceptanceRefs: ['node-test'],
      scopeInclude: ['Core flow implementation and its acceptance evidence.'],
      scopeExclude: ['Optional polish and future extensibility work.'],
      size: 'MILESTONE',
    });
    // The lock that authorized it froze the same definition.
    const lock = JSON.parse(await readFile(path.join(fixture.root, '.shipping', 'contract.lock'), 'utf8'));
    assert.deepEqual(lock.planStage, receipt.planStage);

    // Editing an unstarted stage, and adding a new one, is an ordinary update.
    const updated = JSON.parse(JSON.stringify(THREE_STAGE_PLAN));
    updated.stages[1].title = 'Operate, recover, and observe';
    updated.stages[1].outcome = 'Complete install, health check, rollback, and the metrics endpoint.';
    updated.stages.push({
      id: 'S-04',
      title: 'Localize',
      outcome: 'Complete the localization pass for every operator-facing string.',
      dependsOn: ['S-03'],
      acceptanceRefs: ['node-test'],
      size: 'PATCH',
    });
    await writePlan(fixture, updated);
    const checked = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(checked.exitCode, 0, checked.stdout + checked.stderr);
    assert.deepEqual(parseCliJson(checked).protectedStageIds, ['S-01']);
    const status = runCli(fixture.root, ['plan', 'status', '--json']);
    assert.equal(status.exitCode, 0);
    assert.deepEqual(
      [parseCliJson(status).progress.done, parseCliJson(status).progress.total, parseCliJson(status).progress.nextStageId],
      [1, 4, 'S-02'],
    );

    // Renaming the closed stage is refused, with the receipt cited as the evidence.
    const renamed = JSON.parse(JSON.stringify(updated));
    renamed.stages[0].title = 'Deliver the core flow, but differently';
    await writePlan(fixture, renamed);
    const refused = runCli(fixture.root, ['plan', 'check']);
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stdout, /^VIOLATION: S-01 CHANGED title \(evidence: \.shipping\/releases\/0\.1\.0\.json\)$/mu);
    assert.match(refused.stdout, /\[ERR_PLAN_HISTORY_LOST\]/u);
    const refusedJson = runCli(fixture.root, ['plan', 'status', '--json']);
    assert.equal(refusedJson.exitCode, 1);
    assert.equal(parseCliJson(refusedJson).error.code, 'ERR_PLAN_HISTORY_LOST');

    // Restoring the closed stage's text makes the same file valid again.
    await writePlan(fixture, updated);
    assert.equal(runCli(fixture.root, ['plan', 'check', '--json']).exitCode, 0);
    assert.equal(parseCliJson(runCli(fixture.root, ['plan', 'status', '--json'])).progress.done, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('a plan-bound release cannot close once its stage definition is gone', async () => {
  const fixture = await createFixtureRepo({ files: { [DEFAULT_PLAN_PATH]: `${JSON.stringify(THREE_STAGE_PLAN, null, 2)}\n` } });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);

    const { rm } = await import('node:fs/promises');
    await rm(path.join(fixture.root, DEFAULT_PLAN_PATH));
    // --allow-uncommitted isolates the plan check: without it the deleted in-scope file is
    // refused earlier, by ERR_CLOSE_UNCOMMITTED.
    const closed = runCli(fixture.root, ['close', '--allow-uncommitted', '--json']);
    assert.equal(closed.exitCode, 1);
    assert.equal(parseCliJson(closed).error.code, 'ERR_PLAN_UNAVAILABLE_AT_CLOSE');
  } finally {
    await fixture.cleanup();
  }
});
