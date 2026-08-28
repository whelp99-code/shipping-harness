const STATE_LABELS = Object.freeze({
  PLANNING: '계획 중',
  AWAITING_APPROVAL: '승인 대기',
  RUNNING: '개발 중',
  PAUSED: '일시정지',
  BLOCKED: '문제로 중단',
  SHIPPABLE: '완료 준비됨',
  CLOSED: '버전 완료',
  ABORTED: '취소됨',
});

/** @param {Record<string, any>} view */
export function renderProgressCard(view) {
  const goals = view.goals ?? {};
  const card = {
    schema: 'shipping-plugin/progress-card-v1',
    kind: 'progress',
    title: `${view.project ?? '프로젝트'} ${view.release ?? ''}`.trim(),
    state: view.userState ?? view.state ?? 'PLANNING',
    stateLabel: STATE_LABELS[view.userState ?? view.state] ?? '상태 확인 필요',
    summary: view.summary ?? '현재 상태를 확인하고 있습니다.',
    completed: goals.doneTasks ?? 0,
    total: goals.totalTasks ?? 0,
    blockers: view.blockerCount ?? 0,
    nextAction: view.nextAction ?? '상태를 다시 확인하세요.',
    canPause: Boolean(view.canPause),
    canResume: Boolean(view.canResume),
    canClose: Boolean(view.canClose),
  };
  const progress = card.total > 0 ? `${card.completed}/${card.total}` : '작업 목록 준비 중';
  card.text = [
    `${card.title} — ${card.stateLabel}`,
    card.summary,
    `진행: ${progress}`,
    `출시 차단 문제: ${card.blockers}`,
    `다음: ${card.nextAction}`,
  ].join('\n');
  return card;
}
