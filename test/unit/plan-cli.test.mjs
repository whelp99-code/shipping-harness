import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { runCli, parseCliJson } from '../helpers/cli.mjs';
import { PLAN_SCHEMA } from '../../src/core/shipping-plan.mjs';
import { sha256 } from '../../src/core/crypto.mjs';

const THREE_STAGE_PLAN = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: {
    title: 'Fixture program',
    outcome: 'Deliver the fixture product end to end so an operator can run it and recover from failure.',
  },
  stages: [
    { id: 'S-01', title: 'Deliver the core flow', outcome: 'Complete the core fixture flow end to end.', dependsOn: [], acceptanceRefs: [], size: 'MILESTONE' },
    { id: 'S-02', title: 'Operate and recover', outcome: 'Complete install, health check, and rollback.', dependsOn: ['S-01'], acceptanceRefs: [], size: 'MILESTONE' },
  ],
};

/** @param {Record<string, any> | null} plan */
function planFixture(plan) {
  return createFixtureRepo(plan ? { files: { 'docs/shipping-plan.json': `${JSON.stringify(plan, null, 2)}\n` } } : {});
}

test('plan status without a plan file reports absence and does not fail', async () => {
  const fixture = await planFixture(null);
  try {
    const result = runCli(fixture.root, ['plan', 'status', '--json']);
    assert.equal(result.exitCode, 0);
    const parsed = parseCliJson(result);
    assert.equal(parsed.present, false);
    assert.equal(parsed.path, 'docs/shipping-plan.json');
  } finally {
    await fixture.cleanup();
  }
});

test('plan status with a plan file prints a progress table over stage id, title, status, and next', async () => {
  const fixture = await planFixture(THREE_STAGE_PLAN);
  try {
    const jsonResult = runCli(fixture.root, ['plan', 'status', '--json']);
    assert.equal(jsonResult.exitCode, 0);
    const parsed = parseCliJson(jsonResult);
    assert.equal(parsed.present, true);
    assert.equal(parsed.path, 'docs/shipping-plan.json');
    assert.match(parsed.planHash, /^[a-f0-9]{64}$/u);
    assert.deepEqual([parsed.progress.total, parsed.progress.done, parsed.progress.nextStageId], [2, 0, 'S-01']);
    assert.deepEqual(parsed.stages.map((stage) => stage.id), ['S-01', 'S-02']);
    assert.equal(parsed.stages[0].title, 'Deliver the core flow');
    assert.equal(parsed.stages[0].status, 'READY');
    assert.equal(parsed.stages[0].next, true);
    assert.equal(parsed.stages[1].status, 'BLOCKED_BY_DEPENDENCY');

    const textResult = runCli(fixture.root, ['plan', 'status']);
    assert.equal(textResult.exitCode, 0);
    assert.match(textResult.stdout, /Progress: 0\/2 \(0%\)/u);
    assert.match(textResult.stdout, /Next: S-01/u);
    assert.match(textResult.stdout, /S-01/u);
    assert.match(textResult.stdout, /Deliver the core flow/u);
  } finally {
    await fixture.cleanup();
  }
});

test('plan check on a valid plan file prints the resolvable candidate command ids and exits 0', async () => {
  const fixture = await planFixture(THREE_STAGE_PLAN);
  try {
    const result = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(result.exitCode, 0);
    const parsed = parseCliJson(result);
    assert.equal(parsed.present, true);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.stageCount, 2);
    assert.ok(Array.isArray(parsed.candidateCommandIds));
    assert.ok(parsed.candidateCommandIds.length > 0);

    const textResult = runCli(fixture.root, ['plan', 'check']);
    assert.equal(textResult.exitCode, 0);
    assert.match(textResult.stdout, /Plan valid/u);
    assert.match(textResult.stdout, /Candidate command IDs/u);
  } finally {
    await fixture.cleanup();
  }
});

test('plan check without a plan file reports absence and exits 0', async () => {
  const fixture = await planFixture(null);
  try {
    const result = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(result.exitCode, 0);
    const parsed = parseCliJson(result);
    assert.equal(parsed.present, false);
    assert.equal(parsed.valid, null);
    assert.ok(Array.isArray(parsed.candidateCommandIds), 'ids are listed even before a plan file exists');
  } finally {
    await fixture.cleanup();
  }
});

test('plan check on an invalid plan file exits 1 with the plan error code and touches no state', async () => {
  const fixture = await planFixture({ schema: 'bogus' });
  try {
    const result = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(result.exitCode, 1);
    const parsed = parseCliJson(result);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'ERR_PLAN_INVALID');

    const statusResult = runCli(fixture.root, ['plan', 'status', '--json']);
    assert.equal(statusResult.exitCode, 1);
    assert.equal(parseCliJson(statusResult).error.code, 'ERR_PLAN_INVALID');
  } finally {
    await fixture.cleanup();
  }
});

test('plan --plan refuses any path other than the fixed one', async () => {
  const fixture = await createFixtureRepo({ files: { 'plans/custom.json': `${JSON.stringify(THREE_STAGE_PLAN, null, 2)}\n` } });
  try {
    const result = runCli(fixture.root, ['plan', 'status', '--plan', 'plans/custom.json', '--json']);
    assert.equal(result.exitCode, 1);
    assert.equal(parseCliJson(result).error.code, 'ERR_PLAN_PATH_FIXED');
  } finally {
    await fixture.cleanup();
  }
});

test('plan check warns about acceptance references the analyzer cannot resolve', async () => {
  const plan = JSON.parse(JSON.stringify(THREE_STAGE_PLAN));
  plan.stages[1].acceptanceRefs = ['not-a-detected-command'];
  const fixture = await planFixture(plan);
  try {
    const result = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(result.exitCode, 0);
    const parsed = parseCliJson(result);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.unresolvedAcceptanceRefs, { [plan.stages[1].id]: ['not-a-detected-command'] });
    const text = runCli(fixture.root, ['plan', 'check']);
    assert.match(text.stdout, /WARNING: stage .* references undetected commands \(not-a-detected-command\)/u);
  } finally {
    await fixture.cleanup();
  }
});

test('a plan with no revision and sources with no sha256 is legacy, but plan check still passes', async () => {
  const fixture = await planFixture(THREE_STAGE_PLAN);
  try {
    const result = parseCliJson(runCli(fixture.root, ['plan', 'check', '--json']));
    assert.equal(result.valid, true);
    // THREE_STAGE_PLAN itself carries no `revision`, so it reads as legacy too.
    assert.equal(result.legacyFormat, true);
    assert.deepEqual(result.diagnostics, ['PLAN_LEGACY_FORMAT: plan carries no revision; set revision on the next update']);
    assert.deepEqual(result.sourceDrift, []);
    assert.deepEqual(result.history, { entries: 1, lastRevision: null, lastPlanHash: result.planHash });

    const legacy = { ...THREE_STAGE_PLAN, sources: [{ path: 'README.md' }] };
    const legacyFixture = await planFixture(legacy);
    try {
      const legacyResult = parseCliJson(runCli(legacyFixture.root, ['plan', 'check', '--json']));
      assert.equal(legacyResult.legacyFormat, true);
      assert.deepEqual(legacyResult.diagnostics, ['PLAN_LEGACY_FORMAT: sources carry no sha256; set revision and source hashes on the next update']);
      const legacyStatus = runCli(legacyFixture.root, ['plan', 'status']);
      assert.match(legacyStatus.stdout, /^WARNING: PLAN_LEGACY_FORMAT: sources carry no sha256/mu);
      assert.match(legacyStatus.stdout, /^Revision: none \(history entries: 1\)$/mu);
    } finally {
      await legacyFixture.cleanup();
    }
  } finally {
    await fixture.cleanup();
  }
});

test('an edited source file is reported as drift and a missing one as PLAN_SOURCE_MISSING, both without blocking', async () => {
  const content = '# Roadmap\n\nOriginal text.\n';
  const plan = {
    ...THREE_STAGE_PLAN,
    sources: [{ path: 'docs/ROADMAP.md', sha256: sha256(content) }],
    revision: 1,
  };
  const fixture = await createFixtureRepo({
    files: {
      'docs/ROADMAP.md': content,
      'docs/shipping-plan.json': `${JSON.stringify(plan, null, 2)}\n`,
    },
  });
  try {
    const clean = parseCliJson(runCli(fixture.root, ['plan', 'check', '--json']));
    assert.deepEqual(clean.sourceDrift, []);
    assert.equal(clean.legacyFormat, false);

    await writeFile(path.join(fixture.root, 'docs/ROADMAP.md'), '# Roadmap\n\nChanged text.\n', 'utf8');
    const drifted = parseCliJson(runCli(fixture.root, ['plan', 'check', '--json']));
    assert.equal(drifted.sourceDrift.length, 1);
    assert.equal(drifted.sourceDrift[0].path, 'docs/ROADMAP.md');
    assert.equal(drifted.sourceDrift[0].expected, sha256(content));

    const { rm } = await import('node:fs/promises');
    await rm(path.join(fixture.root, 'docs/ROADMAP.md'));
    const missing = parseCliJson(runCli(fixture.root, ['plan', 'check', '--json']));
    assert.equal(missing.sourceDrift.length, 1);
    assert.equal(missing.sourceDrift[0].observed, null);
    assert.match(missing.diagnostics.join('\n'), /^PLAN_SOURCE_MISSING: docs\/ROADMAP\.md$/mu);
  } finally {
    await fixture.cleanup();
  }
});
