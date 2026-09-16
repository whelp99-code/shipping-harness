import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { PLAN_SCHEMA } from '../../src/core/shipping-plan.mjs';

const THREE_STAGE_PLAN = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: {
    title: 'Fixture program',
    outcome: 'Deliver the fixture product end to end so an operator can run it and recover from failure.',
  },
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
      size: 'PATCH',
    },
  ],
};

function planFixture() {
  return createFixtureRepo({
    packageScripts: { test: `node -e "process.stdout.write('fixture-pass')"` },
    files: { 'docs/shipping-plan.json': `${JSON.stringify(THREE_STAGE_PLAN, null, 2)}\n` },
  });
}

test('shipping_start text with a bound plan renders the three fixed blocks in order and names one approvable proposal', async () => {
  const fixture = await planFixture();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Complete the fixture release',
      release: '0.1.0',
    });
    const data = started.structuredContent;
    assert.equal(data.tier, 'MILESTONE');
    assert.equal(data.shippingPlan.milestone.stageId, 'S-01');
    assert.equal(data.shippingPlan.patch, null);

    const text = started.content[0].text;
    assert.equal(text, data.plainBriefText);
    const programIndex = text.indexOf('## 전체 목표');
    const releaseIndex = text.indexOf('## 이번 릴리즈');
    const currentStateIndex = text.indexOf('## 현재 상태');
    assert.ok(programIndex >= 0, 'PROGRAM block is present');
    assert.ok(releaseIndex > programIndex, 'MILESTONE block follows the PROGRAM block');
    assert.ok(currentStateIndex === -1 || currentStateIndex > releaseIndex, 'plan blocks precede the rest of the report');
    assert.doesNotMatch(text, /## 작은 수정/u, 'no separate patch candidate exists alongside this milestone');

    // Exactly one approvable proposal is named, and PROGRAM is explicitly authority-free.
    assert.match(text, /Deliver the core flow/u);
    assert.match(text, /MILESTONE 제안만 승인 대상입니다/u);
    assert.match(text, /PROGRAM\(전체 목표\)에는 실행·승인 권한이 없습니다/u);
    assert.doesNotMatch(text, /PATCH 제안만 승인 대상입니다/u);

    const progressLine = text.match(/^\d+\/\d+ 완료$/mu);
    assert.ok(progressLine, 'progress line "N/M 완료" is present');
    assert.equal(progressLine[0], '0/3 완료');
  } finally {
    await fixture.cleanup();
  }
});

test('shipping_start text without a bound plan is unchanged: no plan blocks, tier PATCH, plan null', async () => {
  const fixture = await createFixtureRepo({
    packageScripts: { test: `node -e "process.stdout.write('fixture-pass')"` },
  });
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Finish the smallest verified patch without adding unrelated product features',
      release: '0.1.0',
    });
    const data = started.structuredContent;
    assert.equal(data.tier, 'PATCH');
    assert.equal(data.shippingPlan, null);
    const text = started.content[0].text;
    assert.doesNotMatch(text, /## 전체 목표/u);
    assert.doesNotMatch(text, /## 이번 릴리즈/u);
    assert.doesNotMatch(text, /## 작은 수정/u);
  } finally {
    await fixture.cleanup();
  }
});
