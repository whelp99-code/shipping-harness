import { renderApprovalCard } from './approval.mjs';
import { renderBlockerCard } from './blocker.mjs';
import { renderCompletionCard } from './completion.mjs';
import { renderProgressCard } from './progress.mjs';

/**
 * Render from authoritative user state. Caller-supplied presentation hints cannot
 * turn BLOCKED/RUNNING into CLOSED or hide release blockers.
 * @param {Record<string, any>} input
 */
export function renderShippingCard(input) {
  const userState = input.userState ?? input.state ?? input.userView?.userState ?? 'PLANNING';
  let card;
  if (userState === 'AWAITING_APPROVAL' || input.kind === 'approval') {
    card = renderApprovalCard(input.proposal ?? input);
  } else if (userState === 'BLOCKED' || (input.blockerCount ?? 0) > 0 || (input.blockers?.length ?? 0) > 0) {
    card = renderBlockerCard(input);
  } else if (userState === 'CLOSED') {
    card = renderCompletionCard(input);
  } else {
    card = renderProgressCard({ ...input, userState });
  }
  const label = card.kind === 'approval'
    ? 'Shipping Harness 범위 승인'
    : card.kind === 'blocker'
      ? 'Shipping Harness 출시 차단 문제'
      : card.kind === 'completion'
        ? 'Shipping Harness 버전 완료'
        : `Shipping Harness ${card.stateLabel ?? '진행 상태'}`;
  return {
    ...card,
    accessibility: {
      label,
      liveRegion: card.kind === 'progress' ? 'polite' : 'assertive',
      keyboardActions: Array.isArray(card.actions) ? card.actions.map((action, index) => ({ id: `action-${index + 1}`, label: action })) : [],
    },
    fallbackText: card.text,
  };
}
