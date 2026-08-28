import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderApprovalCard,
  renderProgressCard,
  renderBlockerCard,
  renderCompletionCard,
} from '../../packages/shipping-plugin/renderers/index.mjs';

test('beginner renderers expose only the next useful decision', () => {
  const approval = renderApprovalCard({
    release: '0.1.0',
    proposalId: 'p1',
    proposalHash: 'a'.repeat(64),
    approvalBrief: {
      status: 'APPROVABLE',
      outcome: '문서를 등록하고 검색할 수 있다.',
      included: ['문서 등록', '검색'],
      deferred: ['모바일 앱'],
      acceptance: [{ id: 'AC-001', description: '검색 흐름 통과' }],
      assumptions: [],
      risks: [],
      questions: [],
      limits: { maxFixCycles: 2 },
    },
  });
  assert.equal(approval.state, 'AWAITING_APPROVAL');
  assert.deepEqual(approval.actions, ['이대로 시작', '범위 수정', '중단']);
  assert.equal(approval.text.includes('모바일 앱'), true);

  const progress = renderProgressCard({ project: 'demo', release: '0.1.0', userState: 'RUNNING', summary: '개발 중입니다.', goals: { doneTasks: 1, totalTasks: 3 }, blockerCount: 0, nextAction: '검증을 계속하세요.', canPause: true });
  assert.match(progress.text, /1\/3/u);
  assert.equal(progress.canPause, true);

  const blocker = renderBlockerCard({ blockers: [{ id: 'ISSUE-1', title: '빌드 실패', basisId: 'AC-001' }], remainingFixCycles: 1 });
  assert.match(blocker.text, /빌드 실패/u);
  assert.equal(blocker.remainingFixCycles, 1);

  const completion = renderCompletionCard({ project: 'demo', release: '0.1.0', requiredPassed: 3, requiredTotal: 3, blockerCount: 0, deferredCount: 2, reportPath: '.shipping/releases/0.1.0.md' });
  assert.match(completion.text, /3\/3/u);
  assert.equal(completion.state, 'CLOSED');
});

test('approval and blocker renderers remain bounded', () => {
  const many = Array.from({ length: 30 }, (_, index) => `항목 ${index + 1}`);
  const approval = renderApprovalCard({ approvalBrief: { status: 'APPROVABLE', outcome: 'bounded', included: many, deferred: many, acceptance: many, assumptions: many, risks: many, questions: [], limits: {} } });
  assert.equal(approval.included.length, 9);
  assert.ok(approval.text.length < 10000);
  const blocker = renderBlockerCard({ blockers: many.map((title, index) => ({ id: `B-${index}`, title })) });
  assert.equal(blocker.blockers.length, 6);
  assert.equal(blocker.hiddenCount, 24);
});
