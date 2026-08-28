const MAX_ITEMS = 8;

function bounded(items, fallback = '없음') {
  if (!Array.isArray(items) || items.length === 0) return [fallback];
  const visible = items.slice(0, MAX_ITEMS).map((item) => typeof item === 'string' ? item : item.description ?? item.statement ?? item.prompt ?? String(item));
  if (items.length > MAX_ITEMS) visible.push(`외 ${items.length - MAX_ITEMS}개`);
  return visible;
}

/** @param {Record<string, any>} proposal */
export function renderApprovalCard(proposal) {
  const brief = proposal.approvalBrief ?? proposal;
  const card = {
    schema: 'shipping-plugin/approval-card-v1',
    kind: 'approval',
    title: `${proposal.release ?? ''} 범위 승인`.trim(),
    state: brief.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'AWAITING_APPROVAL',
    outcome: brief.outcome ?? proposal.goal ?? '승인할 목표가 없습니다.',
    included: bounded(brief.included),
    deferred: bounded(brief.deferred),
    acceptance: bounded(brief.acceptance),
    assumptions: bounded(brief.assumptions),
    risks: bounded(brief.risks),
    questions: bounded(brief.questions),
    limits: brief.limits ?? {},
    actions: brief.status === 'NEEDS_INPUT'
      ? ['질문에 답하기', '중단']
      : ['이대로 시작', '범위 수정', '중단'],
    proposalId: proposal.proposalId ?? proposal.id ?? null,
    proposalHash: proposal.proposalHash ?? proposal.hash ?? null,
  };
  card.text = [
    card.title,
    `목표: ${card.outcome}`,
    `이번 버전: ${card.included.join(' / ')}`,
    `다음 버전: ${card.deferred.join(' / ')}`,
    `완료 확인: ${card.acceptance.join(' / ')}`,
    card.risks[0] === '없음' ? '중요 위험: 없음' : `중요 위험: ${card.risks.join(' / ')}`,
    `선택: ${card.actions.join(' | ')}`,
  ].join('\n');
  return card;
}
