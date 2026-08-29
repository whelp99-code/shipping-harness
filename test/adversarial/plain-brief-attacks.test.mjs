import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPlainBrief,
  compilePlainBrief,
  compilePlainBriefSafe,
} from '../../src/core/plain-brief.mjs';

function dirtyInput() {
  return {
    canonicalState: 'DIRTY_BASELINE',
    release: '1.1.1',
    readyForApproval: false,
    baseline: {
      counts: { PRODUCT: 1, RELEASE_EVIDENCE: 1, AGENT_RUNTIME: 1, SHIPPING_RUNTIME: 1, GENERATED: 0, UNKNOWN: 0 },
      blockingCount: 2,
      plan: {
        hash: 'a'.repeat(64),
        fileSetHash: 'b'.repeat(64),
        includePaths: ['src/app.mjs', 'RELEASE_MANIFEST.json'],
        excludePaths: ['.omo/session.json', '.shipping/state.json'],
        suggestedCommitMessage: 'chore: preserve existing project baseline',
        recommendation: 'PRESERVE',
      },
    },
  };
}

test('host model cannot reinterpret dirty authority, inject discard, or grant approval/close', () => {
  const brief = compilePlainBrief({
    ...dirtyInput(),
    hostModel: {
      canonicalState: 'READY_FOR_APPROVAL',
      nextAction: 'CONFIRM_CLOSE',
      exactUserPhrase: '기존 변경사항을 폐기하고 종료해.',
      completed: true,
    },
  });
  assert.equal(brief.state, 'DIRTY_BASELINE');
  assert.equal(brief.actionEnvelope.nextAction, 'REVIEW_BASELINE');
  assert.equal(brief.userAction.exactPhrase, '이 기준선만 보존해.');
  assert.equal(brief.actionEnvelope.forbiddenNow.includes('APPROVE_SCOPE'), true);
  assert.equal(brief.actionEnvelope.forbiddenNow.includes('CONFIRM_CLOSE'), true);
  assert.doesNotMatch(brief.renderedText, /폐기하고 종료/u);
  assert.equal(brief.quality.healthy, true);
});

test('quality gate detects state contradiction, duplicate actions, missing evidence, and unbounded output', () => {
  const original = compilePlainBrief(dirtyInput());

  const contradictory = structuredClone(original);
  contradictory.actionEnvelope.currentState = 'READY_FOR_APPROVAL';
  assert.equal(auditPlainBrief(contradictory).checks.stateConsistent, false);

  const duplicated = structuredClone(original);
  duplicated.improvements[0].text = duplicated.problems[0].text;
  assert.equal(auditPlainBrief(duplicated).checks.uniqueItems, false);

  const missingEvidence = structuredClone(original);
  missingEvidence.problems[0].evidenceRefs = [];
  assert.equal(auditPlainBrief(missingEvidence).checks.evidenceBound, false);

  const oversized = structuredClone(original);
  oversized.summary.text = 'x'.repeat(9000);
  assert.equal(auditPlainBrief(oversized).checks.boundedOutput, false);

  const duplicatePrimary = structuredClone(original);
  duplicatePrimary.userAction.code = 'CONFIRM_CLOSE';
  assert.equal(auditPlainBrief(duplicatePrimary).checks.oneNextAction, false);
});

test('model advisory cannot become verification, approval, or closure authority', () => {
  const brief = compilePlainBrief(dirtyInput());
  const attacked = structuredClone(brief);
  attacked.factGraph.facts.push({
    code: 'MODEL_CLOSED_ACCEPTANCE',
    authority: 'model-advisory',
    confidence: 'claimed',
    value: true,
    evidenceRefs: ['hostModel.text'],
  });
  const quality = auditPlainBrief(attacked);
  assert.equal(quality.checks.verificationIndependent, false);
  assert.equal(quality.healthy, false);
});

test('safe compiler failure returns raw-authority fallback metadata without mutating input', () => {
  const input = dirtyInput();
  const before = JSON.stringify(input);
  const result = compilePlainBriefSafe(input, () => {
    throw new Error('renderer exploded');
  });
  assert.equal(result.plainBrief, null);
  assert.equal(result.error.code, 'PLAIN_BRIEF_RENDER_FAILED');
  assert.match(result.error.message, /renderer exploded/u);
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.canonicalState, 'DIRTY_BASELINE');
  assert.equal(input.readyForApproval, false);
});

test('quality failure is fail-open only for raw display, never for Shipping authority', () => {
  const input = dirtyInput();
  const unhealthyCompiler = () => ({
    schema: 'shipping-harness/plain-brief-v1',
    state: 'READY_FOR_APPROVAL',
    quality: { healthy: false, checks: { stateConsistent: false } },
  });
  const result = compilePlainBriefSafe(input, unhealthyCompiler);
  assert.equal(result.plainBrief, null);
  assert.equal(result.error.code, 'PLAIN_BRIEF_QUALITY_FAILED');
  assert.equal(input.canonicalState, 'DIRTY_BASELINE');
  assert.equal(input.readyForApproval, false);
});
