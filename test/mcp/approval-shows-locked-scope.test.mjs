// v1.13.13: reported from a live proposal bound to a plan stage. The approval screen is
// the only place this product asks a person to decide, and it showed three generic
// sentences while the contract about to be locked carried the stage's own include and
// exclude lists. SCOPE_DRIFT_ZERO is later judged against that contract, so the approver
// was reading one thing and approving another. The brief was built from the decision
// before the stage was applied to the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const PLAN = JSON.parse(await readFile(new URL('../../schemas/v1/examples/shipping-plan.example.json', import.meta.url), 'utf8'));
delete PLAN.program.supersedes;
delete PLAN.sources;

const MAKEFILE = 'e2e:\n\t@node -e "process.stdout.write(\'e2e-pass\')"\n\nsmoke:\n\t@node -e "process.stdout.write(\'smoke-pass\')"\n';
const GOAL = 'Deliver the core flow so a user can complete it from start to result on the current revision.';

async function fixtureWithPlan(mutate = (plan) => plan) {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  await writeFile(path.join(fixture.root, 'Makefile'), MAKEFILE, 'utf8');
  await mkdir(path.join(fixture.root, 'docs'), { recursive: true });
  await writeFile(path.join(fixture.root, 'docs', 'shipping-plan.json'), `${JSON.stringify(mutate(structuredClone(PLAN)), null, 2)}\n`, 'utf8');
  await fixture.commit('fixture: a plan the proposal can bind to');
  return fixture;
}

test('the approval screen shows the scope the plan stage will actually lock', async () => {
  const fixture = await fixtureWithPlan();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0', stageId: 'S-01' });
    const proposal = started.structuredContent;
    const stage = PLAN.stages.find((entry) => entry.id === 'S-01');

    assert.deepEqual(proposal.approvalBrief.included, stage.scopeInclude, 'the approver must read the include list that will be locked');
    assert.deepEqual(proposal.approvalBrief.deferred, stage.scopeExclude);
    assert.equal(proposal.approvalBrief.planStageId, 'S-01', 'the screen must say which stage this is');
    assert.match(proposal.approvalBrief.text, /Plan stage: S-01/u);

    // The one-screen view is a projection of the same brief and must not diverge from it.
    assert.deepEqual(proposal.oneScreenApproval.included, proposal.approvalBrief.included);
    assert.deepEqual(proposal.oneScreenApproval.excluded, proposal.approvalBrief.deferred);
  } finally {
    await fixture.cleanup();
  }
});

test('a stage that states no scope of its own falls back to the derived scope, not to nothing', async () => {
  const fixture = await fixtureWithPlan((plan) => {
    plan.stages[0].scopeInclude = [];
    plan.stages[0].scopeExclude = [];
    return plan;
  });
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0', stageId: 'S-01' });
    const included = started.structuredContent.approvalBrief.included;
    assert.ok(included.length > 0, 'an empty stage scope must never empty the approval screen');
    assert.ok(included.some((entry) => entry.includes('Deliver the stated release goal')), 'it falls back to the derived scope');
  } finally {
    await fixture.cleanup();
  }
});

test('with no plan at all the approval screen is unchanged', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await writeFile(path.join(fixture.root, 'Makefile'), MAKEFILE, 'utf8');
    await fixture.commit('fixture: no plan file');
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0' });
    const brief = started.structuredContent.approvalBrief;
    assert.equal(brief.planStageId, null);
    assert.ok(!brief.text.includes('Plan stage:'));
    assert.ok(brief.included.some((entry) => entry.includes('Deliver the stated release goal')));
  } finally {
    await fixture.cleanup();
  }
});

test('a long scope trims facts to fit the budget instead of deleting the whole brief', async () => {
  const fixture = await fixtureWithPlan((plan) => {
    plan.stages[0].scopeInclude = [
      '릴리스 빌드와 app/current 재연결',
      '상태 점검 경로(웹 준비 엔드포인트, sb doctor, sb status) 확인',
      '백업 생성·검증과 이전 릴리스 relink 롤백 증명',
      '이 경로에서 드러난 수집·마스킹·브리핑 결함 수정',
    ];
    return plan;
  });
  try {
    const goal = '릴리스 빌드를 만들고 app/current 를 재연결한 뒤 상태 점검 경로와 백업 생성·검증, 이전 릴리스 relink 롤백까지 실측으로 증명하고 그 과정에서 드러난 수집·마스킹·브리핑 결함을 함께 고친다';
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal, release: '0.1.0', stageId: 'S-01' });
    const brief = started.structuredContent.plainBrief;

    assert.ok(brief, 'the projection for the least technical reader must not be what disappears');
    assert.equal(started.structuredContent.plainBriefError, null);
    assert.equal(brief.quality.healthy, true);
    assert.equal(brief.quality.checks.boundedOutput, true);
    assert.ok(Buffer.byteLength(JSON.stringify(brief)) <= 8192);

    assert.ok(brief.factGraph.factsTruncated > 0, 'this input does not fit without trimming, so the trim must be recorded');
    assert.ok(brief.factGraph.facts.length >= 2, 'the canonical state and the next action are never trimmed');
    assert.equal(brief.factGraph.facts[0].code, 'CANONICAL_STATE');
    assert.equal(brief.factGraph.facts[1].code, 'PRIMARY_NEXT_ACTION');
  } finally {
    await fixture.cleanup();
  }
});

test('a brief that already fits is not trimmed and claims no truncation', async () => {
  // No plan and a short goal: the smallest shape this tool produces, which fits as it is.
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await writeFile(path.join(fixture.root, 'Makefile'), MAKEFILE, 'utf8');
    await fixture.commit('fixture: no plan file');
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: GOAL, release: '0.1.0' });
    const brief = started.structuredContent.plainBrief;
    assert.ok(brief);
    assert.equal(brief.quality.checks.boundedOutput, true);
    assert.equal(brief.factGraph.factsTruncated, undefined, 'nothing was dropped, so nothing is claimed');
  } finally {
    await fixture.cleanup();
  }
});
