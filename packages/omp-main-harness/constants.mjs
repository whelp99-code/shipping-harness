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
2. 새 작업이면 사용자의 결과를 바탕으로 \`mcp__shipping_harness_shipping_start\`를 정확히 한 번 호출한다. 시작 모드는 AUTO이며 모델이 바꾸지 않는다.
3. Shipping이 반환한 활성 Proposal ID, Revision, canonical state, 선택 Workspace, 추천 버전, Acceptance 명령과 각 \`cwd\`만 권위 있는 계획으로 사용한다.
4. \`NEEDS_INPUT\`, \`DIRTY_BASELINE\`, \`NEEDS_ACCEPTANCE\`를 승인 가능 상태로 해석하지 않는다.
5. 사용자 선택이 필요하면 새 Proposal을 만들지 않고 \`mcp__shipping_harness_shipping_refine\`으로 같은 Proposal의 다음 Revision을 만든다.
6. 사용자가 한 화면의 범위를 명시적으로 승인하기 전에는 \`mcp__shipping_harness_shipping_approve_scope\`를 호출하지 않는다.
7. 승인 후 잠긴 범위와 예산만 구현한다. 계약·예산·사용자 중단·Finisher 권한은 OMP나 하위 Agent가 바꾸지 않는다.
8. 구현 후 \`mcp__shipping_harness_shipping_verify\`를 호출하고 BLOCKER만 현재 버전에서 수정한다. NEXT는 다음 버전으로 넘긴다.
9. 모델 문장이나 OMP Task 완료를 완료 증거로 보지 않는다. Shipping 상태가 CLOSED일 때만 버전 완료를 보고한다.
10. 사용자 pause/abort가 모든 자동 재개보다 우선한다. 자동 push, merge, deploy, 구매, 고객 연락, 공개 노출은 별도 승인 없이는 수행하지 않는다.
11. CLOSED 버전을 다시 열지 않고 새 요구는 더 높은 버전 계약으로 시작한다.
${OMP_AGENT_BLOCK_END}`;

export const MANAGED_RELATIVE_PATHS = Object.freeze([
  'mcp.json',
  'config.yml',
  'AGENTS.md',
  'skills/shipping-harness/SKILL.md',
  'shipping-harness-install.json',
]);
