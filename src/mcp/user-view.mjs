import { compilePlainBriefSafe } from '../core/plain-brief.mjs';

const USER_STATE_MAP = Object.freeze({
  DRAFT: 'PLANNING',
  LOCKED: 'RUNNING',
  RUNNING: 'RUNNING',
  VERIFYING: 'RUNNING',
  TRIAGE: 'RUNNING',
  FIXING: 'RUNNING',
  PAUSED: 'PAUSED',
  BLOCKED: 'BLOCKED',
  SHIPPABLE: 'SHIPPABLE',
  CLOSED: 'CLOSED',
  ABORTED: 'ABORTED',
});

function nextAction(state, blockers) {
  if (state === 'PLANNING') return '원하는 결과를 한 문장으로 말하세요.';
  if (state === 'INTENT_CONFIRMATION_REQUIRED') return '분석만, 계획까지, 구현까지, 검증·CLOSED까지 중 원하는 범위를 하나 선택하세요.';
  if (state === 'ANALYSIS_COMPLETE') return '읽기 전용 분석 결과를 확인하세요.';
  if (state === 'PLAN_COMPLETE') return '버전별 계획과 완료조건을 확인하세요.';
  if (state === 'NEEDS_INPUT') return '남은 핵심 질문에 답하거나 권장 안전안을 승인하세요.';
  if (state === 'DIRTY_BASELINE') return '기존 변경사항의 기준선 보존 계획을 검토하세요.';
  if (state === 'NEEDS_ACCEPTANCE') return '실제 빌드·테스트·검증 명령을 확인해 완료조건에 반영하세요.';
  if (state === 'AWAITING_APPROVAL') return '제안된 범위를 검토하고 승인하거나 수정하세요.';
  if (state === 'RUNNING') return blockers > 0 ? '출시 차단 문제만 수정하세요.' : '개발과 검증을 계속하세요.';
  if (state === 'PAUSED') return '준비되면 다시 시작하거나 취소하세요.';
  if (state === 'BLOCKED') return '차단 이유와 증거를 확인한 뒤 필요한 결정만 하세요.';
  if (state === 'SHIPPABLE') return '필수 검증을 통과했습니다. 버전을 닫으세요.';
  if (state === 'CLOSED') return '완료 보고서를 확인하고 다음 버전을 별도로 검토하세요.';
  if (state === 'ABORTED') return '새 버전 목표를 정한 뒤 다시 시작하세요.';
  return '상태를 다시 확인하세요.';
}

/** @param {Record<string, any>} status */
export function buildUserStatusView(status) {
  if (status?.pendingProposal) {
    const proposal = status.pendingProposal;
    const userState = proposal.state === 'READY_FOR_APPROVAL' ? 'AWAITING_APPROVAL' : proposal.state;
    const summaries = {
      PLANNING: '이번 버전의 목표와 범위를 정하는 중입니다.',
      INTENT_CONFIRMATION_REQUIRED: '읽기 전용 분석은 완료됐고, 이후 어디까지 진행할지 한 번 확인해야 합니다.',
      ANALYSIS_COMPLETE: '요청한 읽기 전용 프로젝트 분석이 완료됐습니다.',
      PLAN_COMPLETE: '목표와 버전별 계획은 준비됐고 구현은 시작하지 않았습니다.',
      NEEDS_INPUT: '승인 전에 사용자의 핵심 결정이 필요합니다.',
      DIRTY_BASELINE: '기존 변경사항이 있어 아직 범위를 잠글 수 없습니다.',
      NEEDS_ACCEPTANCE: '완료를 증명할 강한 빌드·테스트·검증 기준이 부족합니다.',
      AWAITING_APPROVAL: '검토 가능한 한 개의 범위 제안이 준비되었습니다.',
    };
    const compiled = proposal.plainBrief
      ? { plainBrief: proposal.plainBrief, error: proposal.plainBriefError ?? null }
      : compilePlainBriefSafe({
          ...proposal,
          canonicalState: proposal.state,
          release: proposal.release,
        });
    return {
      schema: 'shipping-harness/user-view-v1',
      initialized: status.initialized === true,
      project: status.contract?.project ?? null,
      release: proposal.release,
      proposalId: proposal.proposalId,
      proposalRevision: proposal.revision,
      coreState: proposal.state,
      userState,
      summary: summaries[userState] ?? '활성 제안의 상태를 확인하고 있습니다.',
      blockerCount: 0,
      goals: null,
      nextAction: nextAction(userState, 0),
      canPause: false,
      canResume: false,
      canClose: false,
      readyForApproval: proposal.readyForApproval,
      questionCount: proposal.questionCount,
      dirtyPathCount: proposal.dirtyPathCount,
      acceptanceStrength: proposal.acceptanceStrength,
      baseline: proposal.baseline ?? null,
      intelligence: proposal.intelligence ?? null,
      intentGate: proposal.intentGate ?? null,
      goalDiscovery: proposal.goalDiscovery ?? null,
      goalCharter: proposal.goalCharter ?? null,
      oneScreenApproval: proposal.oneScreenApproval ?? null,
      releaseTrain: proposal.releaseTrain ?? null,
      releaseTrainSummary: proposal.releaseTrainSummary ?? null,
      briefFactGraph: compiled.plainBrief?.factGraph ?? proposal.briefFactGraph ?? null,
      actionEnvelope: compiled.plainBrief?.actionEnvelope ?? proposal.actionEnvelope ?? null,
      plainBrief: compiled.plainBrief ?? null,
      plainBriefText: compiled.plainBrief?.renderedText ?? proposal.plainBriefText ?? null,
      plainBriefError: compiled.error ?? proposal.plainBriefError ?? null,
      nextActionCode: proposal.nextAction ?? null,
    };
  }
  if (!status?.initialized && !status?.state?.state) {
    return {
      schema: 'shipping-harness/user-view-v1',
      initialized: false,
      userState: 'PLANNING',
      summary: '아직 Shipping Harness가 시작되지 않았습니다.',
      blockerCount: 0,
      nextAction: nextAction('PLANNING', 0),
      canPause: false,
      canResume: false,
      canClose: false,
    };
  }
  const coreState = status.state?.state ?? status.state ?? 'DRAFT';
  const userState = USER_STATE_MAP[coreState] ?? 'PLANNING';
  const blockerCount = status.issues?.counts?.BLOCKER ?? status.state?.blockerCount ?? 0;
  const goals = status.goals ? {
    totalTasks: status.goals.tasks?.total ?? status.goals.totalTasks ?? 0,
    doneTasks: status.goals.tasks?.DONE ?? status.goals.doneTasks ?? 0,
    blockedTasks: status.goals.tasks?.BLOCKED ?? status.goals.blockedTasks ?? 0,
  } : null;
  const project = status.contract?.project ?? null;
  const release = status.contract?.release ?? status.state?.release ?? null;
  const compiled = compilePlainBriefSafe({
    state: status.state,
    release,
    contract: status.contractDetail ?? status.contract ?? null,
    issues: status.issues ?? null,
    evidenceFresh: status.evidenceFresh === true,
    blockerCount,
    unknownCount: status.issues?.counts?.UNKNOWN ?? status.state?.unknownCount ?? 0,
    currentEvidenceSha: status.state?.currentEvidenceSha ?? null,
    contractHash: status.state?.contractHash ?? status.contract?.hash ?? null,
    releaseTrain: status.releaseTrain ?? null,
  });
  const summaryByState = {
    PLANNING: '이번 버전의 목표와 범위를 정하는 중입니다.',
    RUNNING: blockerCount > 0 ? '개발은 진행 중이지만 출시를 막는 문제가 있습니다.' : '잠긴 범위 안에서 개발과 검증을 진행 중입니다.',
    PAUSED: '사용자가 작업을 일시정지했습니다.',
    BLOCKED: '자동 진행을 멈췄습니다. 해결해야 할 실제 차단 문제가 있습니다.',
    SHIPPABLE: '필수 검증을 모두 통과해 버전을 닫을 수 있습니다.',
    CLOSED: '이 버전은 완료되어 다시 열리지 않습니다.',
    ABORTED: '사용자가 이 버전을 취소했습니다.',
  };
  return {
    schema: 'shipping-harness/user-view-v1',
    initialized: true,
    project,
    release,
    coreState,
    userState,
    summary: summaryByState[userState] ?? '현재 상태를 확인하고 있습니다.',
    blockerCount,
    goals,
    nextAction: nextAction(userState, blockerCount),
    canPause: !['PAUSED', 'CLOSED', 'ABORTED'].includes(userState),
    canResume: userState === 'PAUSED',
    canClose: userState === 'SHIPPABLE',
    evidenceFresh: status.evidenceFresh === true,
    fixCycles: status.state?.fixCycles ?? 0,
    agentRuns: status.state?.agentRuns ?? 0,
    briefFactGraph: compiled.plainBrief?.factGraph ?? null,
    actionEnvelope: compiled.plainBrief?.actionEnvelope ?? null,
    plainBrief: compiled.plainBrief ?? null,
    plainBriefText: compiled.plainBrief?.renderedText ?? null,
    releaseTrain: status.releaseTrain ?? null,
    releaseTrainSummary: status.releaseTrainSummary ?? null,
    releaseTrainBinding: status.releaseTrainBinding ?? null,
    goalCharter: status.goalCharter ?? null,
    goalCharterSummary: status.goalCharterSummary ?? null,
    plainBriefError: compiled.error ?? null,
  };
}

/** @param {Record<string, any>} status */
export function buildBlockerView(status) {
  const contract = status.contract ?? {};
  const maxFixCycles = status.contractDetail?.budgets?.maxFixCycles ?? 2;
  const used = status.state?.fixCycles ?? 0;
  return {
    schema: 'shipping-harness/blocker-view-v1',
    project: contract.project ?? null,
    release: contract.release ?? status.state?.release ?? null,
    blockers: (status.issues?.items ?? [])
      .filter((item) => item.classification === 'BLOCKER')
      .map((item) => ({
        id: item.id,
        title: item.title,
        plainReason: item.description || item.title,
        basisId: item.basisId ?? null,
        evidenceRef: item.evidenceRef ?? null,
        userDecisionRequired: item.userDecisionRequired === true,
        recommendedAction: item.recommendedAction ?? '이 문제만 수정한 뒤 다시 검증하세요.',
      })),
    remainingFixCycles: Math.max(0, maxFixCycles - used),
  };
}
