// v1.13.13: reported from a live session that put MINOR in a plan stage's size. The whole
// plan file was rejected, the proposal silently fell back to a PATCH whose scope came
// from a generic template rather than the plan, and it still read READY_FOR_APPROVAL. The
// explanation was in `diagnostics` and nowhere a person would look. Approving that locks
// a scope the plan never described.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const GOAL = 'Deliver one useful local workflow with current evidence and rollback.';

// The schema's own validated example, so "valid" here means what verify:docs means.
// `supersedes` names a plan hash that exists only in the example's imagined history, and
// `sources` pins digests of files a fixture does not have, so both are dropped: neither
// is what these tests are about.
const VALID_PLAN = JSON.parse(await readFile(new URL('../../schemas/v1/examples/shipping-plan.example.json', import.meta.url), 'utf8'));
delete VALID_PLAN.program.supersedes;
delete VALID_PLAN.sources;

async function fixtureWithBrokenPlan() {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  await writeFile(path.join(fixture.root, 'Makefile'), 'e2e:\n\t@node -e "process.stdout.write(\'e2e-pass\')"\n\nsmoke:\n\t@node -e "process.stdout.write(\'smoke-pass\')"\n', 'utf8');
  // The schema example, with the reported mistake applied to one stage: MINOR is not an
  // allowed stage size, and one bad stage rejects the whole file.
  const plan = structuredClone(VALID_PLAN);
  plan.stages[1].size = 'MINOR';
  await mkdir(path.join(fixture.root, 'docs'), { recursive: true });
  await writeFile(path.join(fixture.root, 'docs', 'shipping-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await fixture.commit('fixture: a plan file that does not validate');
  return fixture;
}

test('asking for a stage from a plan that does not validate refuses instead of proposing something else', async () => {
  const fixture = await fixtureWithBrokenPlan();
  try {
    await assert.rejects(
      () => callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0', stageId: 'S-01' }),
      (error) => {
        assert.equal(error.code, 'ERR_PLAN_REQUEST_UNMET');
        assert.match(error.message, /Stage S-01 cannot be used/u);
        assert.match(error.message, /Nothing was proposed/u, 'the caller must learn the state is untouched');
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('asking for a plan path that does not validate refuses the same way', async () => {
  const fixture = await fixtureWithBrokenPlan();
  try {
    await assert.rejects(
      () => callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0', planPath: 'docs/shipping-plan.json' }),
      (error) => {
        assert.equal(error.code, 'ERR_PLAN_REQUEST_UNMET');
        assert.match(error.message, /The plan cannot be used/u);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('a plan nobody asked for still degrades, but the brief says the scope is not from the plan', async () => {
  const fixture = await fixtureWithBrokenPlan();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0' });
    const proposal = started.structuredContent;
    assert.equal(proposal.shippingPlan, null, 'the invalid plan has no authority and is not projected');
    assert.ok(proposal.diagnostics.some((entry) => entry.startsWith('PLAN_FILE_INVALID')));

    const improvements = proposal.plainBrief.improvements ?? [];
    const warning = improvements.find((entry) => entry.code === 'PLAN_FILE_INVALID');
    assert.ok(warning, 'the degrade must be visible to someone who never opens diagnostics');
    assert.match(warning.text, /일반 템플릿/u, 'the brief must say where the scope actually came from');
    assert.deepEqual(warning.evidenceRefs, ['diagnostics']);
    assert.match(proposal.plainBrief.renderedText, /계획 파일을 읽을 수 없어/u, 'the rendered text a person reads must carry it too');
  } finally {
    await fixture.cleanup();
  }
});

test('a valid plan is unaffected: no warning and the projection is present', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await writeFile(path.join(fixture.root, 'Makefile'), 'e2e:\n\t@node -e "process.stdout.write(\'e2e-pass\')"\n\nsmoke:\n\t@node -e "process.stdout.write(\'smoke-pass\')"\n', 'utf8');
    const plan = structuredClone(VALID_PLAN);
    await mkdir(path.join(fixture.root, 'docs'), { recursive: true });
    await writeFile(path.join(fixture.root, 'docs', 'shipping-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    await fixture.commit('fixture: a plan file that validates');

    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0' });
    const proposal = started.structuredContent;
    assert.ok(!proposal.diagnostics.some((entry) => entry.startsWith('PLAN_FILE_INVALID')));
    const improvements = proposal.plainBrief.improvements ?? [];
    assert.ok(!improvements.some((entry) => entry.code === 'PLAN_FILE_INVALID'));
  } finally {
    await fixture.cleanup();
  }
});
