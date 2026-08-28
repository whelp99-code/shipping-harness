/** @param {Record<string, any>} view */
export function renderCompletionCard(view) {
  const card = {
    schema: 'shipping-plugin/completion-card-v1',
    kind: 'completion',
    title: `${view.project ?? '프로젝트'} ${view.release ?? ''} 완료`.trim(),
    state: 'CLOSED',
    requiredPassed: view.requiredPassed ?? view.acceptance?.passed ?? 0,
    requiredTotal: view.requiredTotal ?? view.acceptance?.total ?? 0,
    blockerCount: view.blockerCount ?? 0,
    deferredCount: view.deferredCount ?? view.backlogCount ?? 0,
    reportPath: view.reportPath ?? view.releaseReport ?? null,
    receiptPath: view.receiptPath ?? null,
    commit: view.commit ?? null,
    tag: view.tag ?? null,
    push: view.push ?? false,
    nextVersionSuggestion: view.nextVersionSuggestion ?? null,
    actions: ['완료 보고서 보기', '다음 버전 검토'],
  };
  card.text = [
    card.title,
    `필수 검증: ${card.requiredPassed}/${card.requiredTotal} 통과`,
    `출시 차단 문제: ${card.blockerCount}`,
    `다음 버전으로 이동: ${card.deferredCount}개`,
    card.reportPath ? `보고서: ${card.reportPath}` : null,
    card.tag ? `태그: ${card.tag}` : '태그: 생성되지 않음',
    card.push ? '원격 저장소 반영: 완료' : '원격 저장소 반영: 안 함',
  ].filter(Boolean).join('\n');
  return card;
}
