export const OMP_MAIN_SCHEMA = 'shipping-harness/omp-main-install-v2';
export const OMP_BACKUP_SCHEMA = 'shipping-harness/omp-main-backup-v1';
export const OMP_ROLLBACK_SCHEMA = 'shipping-harness/omp-main-rollback-v1';
export const OMP_FIELD_SMOKE_SCHEMA = 'shipping-harness/omp-main-field-smoke-v1';
export const OMP_SERVER_NAME = 'shipping-harness';
export const OMP_MCP_PROTOCOL = '2025-03-26';
export const OMP_MCP_TIMEOUT_MS = 120000;

export const SHIPPING_TOOL_NAMES = Object.freeze([
  'shipping_start',
  'shipping_refine',
  'shipping_approve_scope',
  'shipping_execute',
  'shipping_status',
  'shipping_verify',
  'shipping_fix_blockers',
  'shipping_pause',
  'shipping_close',
]);

export const OMP_TOOL_NAMES = Object.freeze(
  SHIPPING_TOOL_NAMES.map((name) => `mcp__shipping_harness_${name}`),
);

export const OMP_TOOL_APPROVAL = Object.freeze({
  mcp__shipping_harness_shipping_start: 'allow',
  mcp__shipping_harness_shipping_refine: 'prompt',
  mcp__shipping_harness_shipping_approve_scope: 'prompt',
  mcp__shipping_harness_shipping_execute: 'prompt',
  mcp__shipping_harness_shipping_status: 'allow',
  mcp__shipping_harness_shipping_verify: 'allow',
  mcp__shipping_harness_shipping_fix_blockers: 'prompt',
  mcp__shipping_harness_shipping_pause: 'prompt',
  mcp__shipping_harness_shipping_close: 'prompt',
});

export const TESTED_OMP_HOSTS = Object.freeze([
  Object.freeze({ version: '18.0.10', protocol: OMP_MCP_PROTOCOL, surface: 'omo-balance router + standalone omp-core' }),
  Object.freeze({ version: '15.10.12', protocol: OMP_MCP_PROTOCOL, surface: 'source-linked OMP compatibility lane' }),
]);

export const OMP_AGENT_BLOCK_START = '<!-- >>> SHIPPING-HARNESS-MAIN >>>';
export const OMP_AGENT_BLOCK_END = '<!-- <<< SHIPPING-HARNESS-MAIN <<< -->';

export const OMP_AGENT_BLOCK = `${OMP_AGENT_BLOCK_START}
# Shipping Harness — 기본 개발 거버넌스

지속적으로 남을 소프트웨어·자동화·인프라 변경에는 Shipping Harness를 기본 하네스로 사용한다.

1. 현재 Git 프로젝트에서 먼저 \`mcp__shipping_harness_shipping_status\`를 호출한다.
2. 새 작업이면 사용자 결과를 바탕으로 \`mcp__shipping_harness_shipping_start\`를 정확히 한 번 호출한다. 시작 모드는 AUTO이며 모델이 바꾸지 않는다.
3. Shipping의 Proposal ID, Revision, canonical state, 선택 Workspace, 명령과 각 \`cwd\`, baseline, intelligence, coverage, releaseTrain만 권위 있는 계획으로 사용한다. 추론한 목표는 추천일 뿐 사용자 목표를 덮어쓰지 않는다.
4. releaseTrain의 첫 버전만 현재 계약 후보다. 미래 버전은 \`ADVISORY_REPLAN_REQUIRED\`이며 앞 버전 CLOSED 후 다시 분석되기 전에는 명령·경로·실행·종료 권한이 없다.
5. \`NEEDS_INPUT\`, \`DIRTY_BASELINE\`, \`NEEDS_ACCEPTANCE\`를 승인 가능 상태로 표현하지 않는다.
6. \`DIRTY_BASELINE\`이면 정확한 보존 계획을 먼저 보여준다. Shipping은 commit, stash, reset, discard를 실행하지 않는다. 사용자가 별도로 승인한 정확한 host commit 뒤에만 plan hash와 commit SHA로 같은 Proposal을 rescan한다.
7. 선택·질문·기준선 rescan이 필요하면 새 Proposal을 만들지 않고 \`mcp__shipping_harness_shipping_refine\`을 사용한다. 실제 변화가 없는 \`changed: false\`를 새 Revision으로 보고하지 않는다.
8. changed product path가 Acceptance coverage에 연결되지 않으면 \`NEEDS_ACCEPTANCE\`를 유지한다. 모델 설명으로 검증을 보강하지 않는다.
9. package/release 검증은 Shipping이 표시한 isolation·determinism 정책을 약화하지 않는다. 외부상태·데이터상태 명령을 자동 실행하지 않는다.
10. Shipping이 생성한 \`plainBriefText\`와 \`전체 개발계획\`을 기본 보고서로 그대로 표시한다. 모델이 버전 순서·상태·다음 행동을 다시 작성하지 않는다.
11. 사용자가 현재 버전 범위를 명시적으로 승인하기 전에는 \`mcp__shipping_harness_shipping_approve_scope\`를 호출하지 않는다.
12. 승인 후 잠긴 현재 버전 범위와 예산만 구현하고 \`mcp__shipping_harness_shipping_verify\`를 호출한다. BLOCKER만 수정하고 NEXT는 다음 버전으로 넘긴다.
13. 모델 문장이나 OMP Task 완료를 완료 증거로 보지 않는다. Shipping 상태가 CLOSED일 때만 완료를 보고한다.
14. 사용자 pause/abort가 모든 자동 재개보다 우선한다. 자동 push, merge, deploy, 구매, 고객 연락, 공개 노출은 별도 승인 없이는 수행하지 않는다.
15. CLOSED 버전을 다시 열지 않고 다음 Train 버전은 새 계약과 재계획을 통해서만 시작한다.
${OMP_AGENT_BLOCK_END}`;

export const MANAGED_RELATIVE_PATHS = Object.freeze([
  'mcp.json',
  'config.yml',
  'AGENTS.md',
  'skills/shipping-harness/SKILL.md',
  'shipping-harness-install.json',
]);
