const MAX_BLOCKERS = 6;

/** @param {Record<string, any>} view */
export function renderBlockerCard(view) {
  const raw = Array.isArray(view.blockers) ? view.blockers : [];
  const blockers = raw.slice(0, MAX_BLOCKERS).map((item) => ({
    id: item.id ?? 'BLOCKER',
    reason: item.plainReason ?? item.title ?? item.description ?? '원인을 확인해야 합니다.',
    basis: item.basisId ?? item.basis ?? null,
    evidence: item.evidenceSummary ?? item.evidenceRef ?? '상세 증거 확인',
    userDecisionRequired: item.userDecisionRequired === true,
    recommendedAction: item.recommendedAction ?? '출시 차단 문제만 수정한 뒤 다시 검증하세요.',
  }));
  const card = {
    schema: 'shipping-plugin/blocker-card-v1',
    kind: 'blocker',
    title: '버전을 막는 문제가 있습니다',
    state: 'BLOCKED',
    blockers,
    hiddenCount: Math.max(0, raw.length - blockers.length),
    remainingFixCycles: view.remainingFixCycles ?? null,
    actions: ['차단 문제만 수정', '증거 보기', '중단'],
  };
  card.text = [
    card.title,
    ...blockers.map((item) => `- ${item.id}: ${item.reason}${item.basis ? ` (${item.basis})` : ''}\n  다음: ${item.recommendedAction}`),
    card.hiddenCount > 0 ? `외 ${card.hiddenCount}개` : null,
    card.remainingFixCycles === null ? null : `남은 수정 기회: ${card.remainingFixCycles}`,
  ].filter(Boolean).join('\n');
  return card;
}
