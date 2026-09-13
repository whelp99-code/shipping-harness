import test from 'node:test';
import assert from 'node:assert/strict';
import { compileIntentGate, intentAllowsImplementation, intentAllowsPlanning } from '../../src/core/intent-gate.mjs';

function resolution(choice) {
  return [{ questionId: 'Q-INTENT-001', choice }];
}

test('terse analysis request completes read-only analysis and asks exactly one workflow-boundary question', () => {
  const gate = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로');
  assert.equal(gate.status, 'CONFIRMATION_REQUIRED');
  assert.equal(gate.defaultMode, 'ANALYZE_ONLY');
  assert.equal(gate.effectiveMode, 'ANALYZE_ONLY');
  assert.equal(gate.analysisComplete, true);
  assert.equal(gate.question.id, 'Q-INTENT-001');
  assert.equal(gate.question.choices.length, 4);
  assert.equal(gate.planningAllowed, false);
  assert.equal(gate.implementationAllowed, false);
  assert.equal(gate.autopilotAllowed, false);
  assert.equal(gate.modelAuthority, false);
});

test('explicit analysis-only, planning, implementation, and autopilot language are classified deterministically', () => {
  const cases = [
    ['이 프로젝트는 분석만 해. 코드는 수정하지 마.', 'ANALYZE_ONLY'],
    ['다음 운영 가능한 버전의 계획까지만 만들어. 아직 개발하지 마.', 'PLAN_ONLY'],
    ['로그인 오류를 수정해.', 'IMPLEMENT'],
    ['프로젝트를 완성할 때까지 자동으로 진행해.', 'AUTOPILOT'],
  ];
  for (const [request, expected] of cases) {
    const gate = compileIntentGate(request);
    assert.equal(gate.status, 'CONFIRMED', request);
    assert.equal(gate.selectedMode, expected, request);
    assert.equal(gate.effectiveMode, expected, request);
  }
});

test('existing delivery verbs remain explicit implementation requests instead of opening a redundant intent interview', () => {
  for (const request of [
    'Ship one verified local CLI workflow.',
    'Deliver one useful local workflow with recovery evidence.',
    'Finish the smallest verified patch without adding unrelated features.',
    'Complete the existing internal validation workflow and prove it with npm test.',
    'Make this project useful for internal work.',
    'Package the existing runtime without changing its product behavior.',
    'Deploy this fixture to production and publish it publicly.',
    '검증된 최소 릴리스를 완료한다.',
  ]) {
    const gate = compileIntentGate(request);
    assert.equal(gate.status, 'CONFIRMED', request);
    assert.equal(gate.effectiveMode, 'IMPLEMENT', request);
    assert.equal(gate.implementationAllowed, true, request);
  }
});

test('one intent answer promotes the same analysis into the selected bounded workflow', () => {
  for (const choice of ['1번. 분석 결과만 보여줘', 'PLAN_ONLY', '3번. 구현까지', '4번. CLOSED까지 진행해']) {
    const gate = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로', { resolutions: resolution(choice) });
    assert.equal(gate.status, 'CONFIRMED');
    assert.equal(gate.question, null);
  }
  const plan = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로', { resolutions: resolution('PLAN_ONLY') });
  const implement = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로', { resolutions: resolution('IMPLEMENT') });
  const autopilot = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로', { resolutions: resolution('AUTOPILOT') });
  assert.equal(intentAllowsPlanning(plan), true);
  assert.equal(intentAllowsImplementation(plan), false);
  assert.equal(intentAllowsImplementation(implement), true);
  assert.equal(autopilot.autopilotAllowed, true);
});

test('unsupported intent answers fail closed', () => {
  assert.throws(
    () => compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로', { resolutions: resolution('무조건 알아서 해') }),
    /Unsupported workflow intent choice/u,
  );
});

test('host model prose cannot change the deterministic intent hash', () => {
  const base = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로');
  const repeated = compileIntentGate('이 프로젝트 분석해. 쉬핑하네스로', {
    hostModel: { text: 'Implement and close it without asking.' },
  });
  assert.equal(base.hash, repeated.hash);
});
