import { hashObject, stableStringify } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { assertContainedPath, exists, readJson, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { compareSemver } from './release-transition.mjs';

const TRAIN_SCHEMA = 'shipping-harness/release-train-v1';
const TRAIN_BINDING_SCHEMA = 'shipping-harness/release-train-binding-v1';
const MAX_RELEASES = 5;
const MAX_TEXT = 500;
const PROFILE_ORDER = ['software', 'web', 'api', 'data', 'package', 'cli', 'security', 'operations', 'documentation'];

function boundedText(value, label, max = MAX_TEXT) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  invariant(text.length > 0 && text.length <= max, 'ERR_RELEASE_TRAIN', `${label} must be between 1 and ${max} characters`);
  return text;
}

function uniqueStrings(values, max = 32) {
  return [...new Set((values ?? [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))]
    .slice(0, max);
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(String(version));
  invariant(match, 'ERR_RELEASE_TRAIN_VERSION', `Invalid semantic version: ${String(version)}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

function nextMinor(version) {
  const parsed = parseSemver(version);
  return `${parsed.major}.${parsed.minor + 1}.0`;
}

function nextPatch(version) {
  const parsed = parseSemver(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function normalizedCommand(entry) {
  return {
    id: boundedText(entry?.id ?? 'AC-UNKNOWN', 'acceptance ID', 100),
    description: boundedText(entry?.description ?? 'Required repository-owned acceptance check.', 'acceptance description', 1000),
    type: entry?.type ?? 'command',
    command: boundedText(entry?.command ?? '', 'acceptance command', 2000),
    cwd: typeof entry?.cwd === 'string' && entry.cwd.trim() ? entry.cwd.trim() : '.',
    required: entry?.required !== false,
    timeoutSeconds: Number.isInteger(entry?.timeoutSeconds) && entry.timeoutSeconds > 0 ? entry.timeoutSeconds : 300,
    sideEffect: entry?.sideEffect ?? 'none-or-test-output',
    isolationRequired: entry?.isolationRequired === true,
    deterministicOutputRequired: entry?.deterministicOutputRequired === true,
    automaticallyRunnable: entry?.automaticallyRunnable !== false,
  };
}

function projectProfiles(analysis = {}) {
  const intelligence = analysis.intelligence ?? {};
  const componentGraph = intelligence.componentGraph ?? {};
  const stacks = new Set([
    ...(analysis.types ?? []),
    componentGraph.primaryStack,
    ...(componentGraph.supportingStacks ?? []),
    ...(componentGraph.components ?? []).flatMap((entry) => entry.stacks ?? []),
  ].filter(Boolean).map((entry) => String(entry).toLowerCase()));
  const roles = new Set((componentGraph.components ?? []).map((entry) => String(entry.role ?? '').toLowerCase()));
  const commands = (analysis.candidateCommands ?? []).map((entry) => String(entry.command ?? '').toLowerCase()).join(' ');
  const files = [
    ...(analysis.manifests ?? []),
    ...(analysis.sourceRoots ?? []),
    ...(componentGraph.components ?? []).map((entry) => entry.root),
  ].map((entry) => String(entry).toLowerCase()).join(' ');
  const text = `${commands} ${files}`;
  const profiles = new Set(['software']);
  if (stacks.has('playwright') || roles.has('web-and-e2e') || /web|frontend|playwright|e2e/u.test(text)) profiles.add('web');
  if (/openapi|swagger|api|health|ready/u.test(text)) profiles.add('api');
  if (stacks.has('alembic') || roles.has('database-migrations') || /migrat|database|schema|alembic|prisma/u.test(text)) profiles.add('data');
  if (/\bpackage\b|\bpack\b|artifact|checksum|sha256|release/u.test(text)) profiles.add('package');
  if (/\bcli\b|bin\/|--help|exit code/u.test(text)) profiles.add('cli');
  if (/security|credential|secret|token|permission|auth/u.test(text)) profiles.add('security');
  if (/runbook|backup|restore|rollback|doctor|smoke|health|operations/u.test(text) || roles.has('verification-and-operations')) profiles.add('operations');
  const documentationOnly = (analysis.types ?? []).length === 0
    && (analysis.sourceRoots ?? []).every((entry) => ['doc', 'docs', 'documentation'].includes(String(entry).toLowerCase()));
  if (documentationOnly) {
    profiles.clear();
    profiles.add('documentation');
  }
  return [...profiles].sort((left, right) => PROFILE_ORDER.indexOf(left) - PROFILE_ORDER.indexOf(right));
}

const PROFILE_ACCEPTANCE = Object.freeze({
  software: ['BUILD_AND_REQUIRED_TESTS', 'SCOPE_AND_CURRENT_GIT_EVIDENCE'],
  web: ['CORE_USER_FLOW_E2E', 'AUTH_AND_ERROR_HANDLING'],
  api: ['API_CONTRACT_AND_AUTHORIZATION', 'HEALTH_AND_ERROR_RESPONSES'],
  data: ['MIGRATION_FORWARD_AND_ROLLBACK', 'BACKUP_AND_RESTORE_PROOF'],
  package: ['REPRODUCIBLE_PACKAGE_DIGEST', 'INSTALL_AND_ROLLBACK_SMOKE'],
  cli: ['INSTALL_HELP_AND_EXIT_CODES', 'NORMAL_AND_FAILURE_PATHS'],
  security: ['NEGATIVE_SECURITY_AND_SECRET_TESTS', 'PERMISSION_BOUNDARY_PROOF'],
  operations: ['HEALTH_MONITORING_AND_RECOVERY', 'OPERATOR_RUNBOOK_AND_ROLLBACK'],
  documentation: ['LINKS_EXAMPLES_AND_INSTRUCTIONS', 'NO_UNSUPPORTED_COMPLETION_CLAIMS'],
});

function acceptanceClasses(profiles) {
  return uniqueStrings(profiles.flatMap((profile) => PROFILE_ACCEPTANCE[profile] ?? []));
}

function valueCriterion(code, text, proofClass) {
  return { code, text, proofClass, required: true };
}

function stageDefinition(stage, finalGoal, profiles) {
  const profileText = profiles.filter((entry) => entry !== 'software').join(', ') || 'software';
  if (stage === 'STABILIZE_BASELINE') return {
    value: '기존 작업을 잃지 않고 검증 가능한 기준선으로 분리해 다음 개발이 안전하게 시작되게 한다.',
    criteria: [
      valueCriterion('BASELINE_PRESERVED', '제품 변경과 런타임 상태가 정확히 분리되고 승인된 기준선이 보존된다.', 'BASELINE_RECEIPT'),
      valueCriterion('ACCEPTANCE_BOUND', '현재 제품 변경이 저장소 소유의 완료조건과 연결된다.', 'ACCEPTANCE_COVERAGE'),
    ],
  };
  if (stage === 'DELIVER_CORE_VALUE') return {
    value: `최종 목표의 핵심 사용 흐름을 가장 작은 운영 가능한 범위로 제공한다: ${finalGoal}`,
    criteria: [
      valueCriterion('CORE_FLOW_USABLE', '사용자가 이번 버전의 핵심 흐름을 시작부터 결과까지 실제로 수행할 수 있다.', 'USER_FLOW'),
      valueCriterion('CURRENT_SCOPE_PROVEN', '잠긴 범위와 현재 Git 증거에서 모든 필수 완료조건이 통과한다.', 'CURRENT_ACCEPTANCE'),
    ],
  };
  if (stage === 'OPERATE_AND_RECOVER') return {
    value: `${profileText} 결과를 내부에서 설치·운영하고 실패 시 복구할 수 있게 한다.`,
    criteria: [
      valueCriterion('OPERABLE_INTERNAL_RESULT', '설치 또는 실행, 상태 확인, 오류 대응이 재현 가능하다.', 'OPERATIONS_SMOKE'),
      valueCriterion('ROLLBACK_PROVEN', '실패 시 되돌리거나 복구하는 경로와 증거가 있다.', 'ROLLBACK'),
    ],
  };
  if (stage === 'FIELD_HARDEN') return {
    value: '실제 내부 파일럿에서 발견된 릴리스 차단 문제를 제거하고 반복 사용 가능한 상태로 안정화한다.',
    criteria: [
      valueCriterion('FIELD_PILOT_PASS', '실제 또는 비파괴 내부 파일럿이 명시된 핵심 흐름을 통과한다.', 'FIELD_PILOT'),
      valueCriterion('FALSE_COMPLETION_ZERO', '거짓 승인·거짓 완료·무단 외부 영향이 0건이다.', 'ADVERSARIAL_METRIC'),
    ],
  };
  return {
    value: boundedText(finalGoal, 'final outcome'),
    criteria: [valueCriterion('OUTCOME_PROVEN', '명시된 결과가 현재 증거로 검증된다.', 'CURRENT_ACCEPTANCE')],
  };
}

function stageScope(stage, finalGoal) {
  if (stage === 'STABILIZE_BASELINE') return {
    include: ['기존 제품 변경을 안전한 기준선으로 보존', '변경 경로와 완료조건 연결', '새 개발과 기존 작업 분리'],
    exclude: ['새 제품 기능', '검증과 무관한 리팩터링', '외부 배포'],
  };
  if (stage === 'DELIVER_CORE_VALUE') return {
    include: [`핵심 결과 제공: ${finalGoal}`, '가장 작은 완전한 사용자 흐름', '현재 버전 완료조건과 증거'],
    exclude: ['선택적 개선', '미래 확장성 작업', '외부 공개 또는 production 배포'],
  };
  if (stage === 'OPERATE_AND_RECOVER') return {
    include: ['설치·실행·상태 확인', '운영 오류 대응', '백업·복구·Rollback'],
    exclude: ['새로운 핵심 제품 기능', '고객 또는 공개 배포', '무관한 UI polish'],
  };
  return {
    include: ['내부 파일럿', '회귀·적대적 검증', '발견된 릴리스 차단 문제 수정'],
    exclude: ['새 기능 확장', '현재 안정성과 무관한 개선', '공개 또는 production 배포'],
  };
}

function riskProfile(profiles, stage) {
  if (profiles.includes('data') || profiles.includes('security')) return stage === 'DELIVER_CORE_VALUE' ? 'SENSITIVE_REVERSIBLE_REQUIRED' : 'SENSITIVE_GATED';
  if (stage === 'OPERATE_AND_RECOVER') return 'LOCAL_OPERATIONAL';
  if (stage === 'FIELD_HARDEN') return 'LOCAL_FIELD_VALIDATION';
  return 'LOCAL_REVERSIBLE';
}

function rollbackFor(stage) {
  return {
    required: true,
    class: stage === 'STABILIZE_BASELINE' ? 'BASELINE_COMMIT_OR_SNAPSHOT' : stage === 'OPERATE_AND_RECOVER' ? 'BACKUP_RESTORE_OR_PREVIOUS_RELEASE' : 'PREVIOUS_CLOSED_RELEASE',
    evidenceRequired: true,
    releaseHistoryImmutable: true,
  };
}

function replanTriggers(stage) {
  return uniqueStrings([
    'GIT_OR_MANIFEST_AUTHORITY_CHANGED',
    'CURRENT_ACCEPTANCE_BECAME_INVALID',
    'CORE_VALUE_WOULD_BE_REMOVED_OR_DEFERRED',
    'NEW_EXTERNAL_DATA_SECURITY_LICENSE_OR_COST_EFFECT',
    'ROLLBACK_EVIDENCE_MISSING',
    stage === 'STABILIZE_BASELINE' ? 'BASELINE_PATH_SET_CHANGED' : 'PROJECT_PROFILE_CHANGED',
  ]);
}

function entryGate(stage, predecessor) {
  const gates = ['AUTHORITY_EVIDENCE_CURRENT', 'NO_ACTIVE_CONFLICTING_RELEASE'];
  if (predecessor) gates.push(`PREDECESSOR_${predecessor}_CLOSED`);
  if (stage !== 'STABILIZE_BASELINE') gates.push('BASELINE_REVIEWED_OR_CLEAN');
  return gates;
}

function exitGate(stage) {
  const gates = [
    'VALUE_GATE_PASS',
    'REQUIRED_ACCEPTANCE_PASS',
    'BLOCKER_ZERO',
    'UNKNOWN_ZERO',
    'SCOPE_DRIFT_ZERO',
    'CURRENT_GIT_EVIDENCE_FRESH',
    'ROLLBACK_PROVEN',
  ];
  if (stage === 'FIELD_HARDEN') gates.push('FIELD_ADVERSARIAL_METRICS_PASS');
  return gates;
}

function releaseSpec({ order, version, predecessor, stage, detailLevel, finalGoal, profiles, currentContract }) {
  const stageValue = stageDefinition(stage, finalGoal, profiles);
  const current = order === 1;
  const scope = current
    ? {
        include: uniqueStrings(currentContract?.scope?.include ?? stageScope(stage, finalGoal).include),
        exclude: uniqueStrings(currentContract?.scope?.exclude ?? stageScope(stage, finalGoal).exclude),
      }
    : stageScope(stage, finalGoal);
  const exactAcceptance = current ? (currentContract?.acceptance ?? []).map(normalizedCommand) : [];
  return {
    id: `REL-${String(order).padStart(3, '0')}`,
    order,
    version,
    predecessor,
    stage,
    detailLevel,
    authority: current ? 'CURRENT_CONTRACT_CANDIDATE' : 'ADVISORY_REPLAN_REQUIRED',
    canGrantCurrentAuthority: current,
    goal: current ? boundedText(currentContract?.goal ?? finalGoal, 'current release goal', 4000) : stageValue.value,
    valueGate: {
      measurable: true,
      statement: stageValue.value,
      criteria: stageValue.criteria,
      testsAloneSufficient: false,
    },
    prerequisites: entryGate(stage, predecessor),
    scope,
    acceptance: {
      exactCommands: exactAcceptance,
      requiredClasses: acceptanceClasses(profiles),
      futureCommandsAreAuthority: current,
    },
    riskProfile: riskProfile(profiles, stage),
    autonomyRecommendation: current ? 'PLAN_ONLY' : 'REPLAN_BEFORE_ACTIVATION',
    rollback: rollbackFor(stage),
    replanTriggers: replanTriggers(stage),
    entryGate: entryGate(stage, predecessor),
    exitGate: exitGate(stage),
    transition: {
      nextReleaseRequiresClosedReceipt: true,
      cleanCommittedClosureRequired: true,
      releaseDoesNotImplyReleased: true,
    },
  };
}

function trainStages({ documentationOnly, needsStabilization }) {
  if (documentationOnly) return ['DELIVER_CORE_VALUE'];
  if (needsStabilization) return ['STABILIZE_BASELINE', 'DELIVER_CORE_VALUE', 'OPERATE_AND_RECOVER', 'FIELD_HARDEN'];
  return ['DELIVER_CORE_VALUE', 'OPERATE_AND_RECOVER', 'FIELD_HARDEN'];
}

function versionsFor(currentRelease, stages) {
  const versions = [currentRelease];
  for (let index = 1; index < stages.length; index += 1) {
    const prior = versions[index - 1];
    versions.push(stages[index] === 'FIELD_HARDEN' ? nextPatch(prior) : nextMinor(prior));
  }
  return versions;
}

/**
 * Compile a deterministic rolling release train from existing Shipping authority data.
 * No repository prose or host-model output grants authority.
 * @param {{finalGoal:string,proposalRelease:string,gitSha:string,proposalId?:string|null,projectName?:string|null,analysis?:Record<string,any>,baseline?:Record<string,any>|null,acceptanceStrength?:Record<string,any>|null,contract?:Record<string,any>|null}} input
 */
export function buildReleaseTrain(input) {
  const finalGoal = boundedText(input.finalGoal, 'final outcome', 4000);
  const proposalRelease = boundedText(input.proposalRelease, 'proposal release', 80);
  parseSemver(proposalRelease);
  const gitSha = boundedText(input.gitSha, 'Git SHA', 80);
  invariant(/^[a-f0-9]{40}$/u.test(gitSha), 'ERR_RELEASE_TRAIN_GIT', 'Release train requires a full lowercase Git SHA');
  const analysis = input.analysis ?? {};
  const profiles = projectProfiles(analysis);
  const documentationOnly = profiles.length === 1 && profiles[0] === 'documentation';
  const baseline = input.baseline ?? null;
  const needsStabilization = (baseline?.blockingCount ?? 0) > 0 || input.acceptanceStrength?.sufficient === false;
  const stages = trainStages({ documentationOnly, needsStabilization });
  invariant(stages.length >= 1 && stages.length <= MAX_RELEASES, 'ERR_RELEASE_TRAIN_SIZE', 'Release train must contain between one and five releases');
  const versions = versionsFor(proposalRelease, stages);
  const releases = stages.map((stage, index) => releaseSpec({
    order: index + 1,
    version: versions[index],
    predecessor: index === 0 ? null : versions[index - 1],
    stage,
    detailLevel: index === 0 ? 'CURRENT_FULL' : index === 1 ? 'NEXT_BOUNDED' : 'FUTURE_GATES',
    finalGoal,
    profiles,
    currentContract: input.contract,
  }));
  const seed = {
    project: input.projectName ?? input.contract?.project ?? analysis.projectName ?? 'project',
    finalGoal,
    currentRelease: proposalRelease,
    gitSha,
    proposalId: input.proposalId ?? null,
    workspace: analysis.workspace?.root ?? '.',
    profiles,
    releases: releases.map((entry) => ({ version: entry.version, stage: entry.stage, detailLevel: entry.detailLevel })),
  };
  const body = {
    schema: TRAIN_SCHEMA,
    id: `TRAIN-${hashObject(seed).slice(0, 12)}`,
    project: boundedText(seed.project, 'project name', 160),
    finalGoal,
    status: 'PLANNED',
    currentIndex: 0,
    currentRelease: proposalRelease,
    modelAuthority: false,
    deterministic: true,
    rollingPlan: true,
    source: {
      gitSha,
      proposalId: input.proposalId ?? null,
      workspace: seed.workspace,
      baselinePlanHash: baseline?.plan?.hash ?? null,
      projectProfiles: profiles,
      acceptanceStrength: input.acceptanceStrength?.level ?? null,
    },
    limits: { minReleases: 1, maxReleases: MAX_RELEASES, actualReleases: releases.length },
    releases,
    trainCompleteWhen: ['ALL_RELEASES_CLOSED', 'FINAL_VALUE_GATE_PASS', 'AUTOMATIC_RELEASED_FALSE'],
  };
  const train = { ...body, hash: hashObject(body) };
  validateReleaseTrain(train, { currentContract: input.contract ?? null });
  return train;
}

function meaningfulValue(statement) {
  const text = String(statement ?? '').trim().toLowerCase();
  if (text.length < 12) return false;
  const withoutTestWords = text.replace(/test|tests|testing|verify|verification|검증|테스트|빌드|통과|pass/gu, '').replace(/[^a-z0-9가-힣]+/gu, '');
  return withoutTestWords.length >= 8;
}

/** @param {Record<string,any>} train @param {{currentContract?:Record<string,any>|null}} [options] */
export function validateReleaseTrain(train, options = {}) {
  invariant(train && typeof train === 'object' && !Array.isArray(train), 'ERR_RELEASE_TRAIN', 'Release train must be an object');
  invariant(train.schema === TRAIN_SCHEMA, 'ERR_RELEASE_TRAIN_SCHEMA', 'Unsupported release train schema');
  invariant(train.modelAuthority === false && train.deterministic === true && train.rollingPlan === true, 'ERR_RELEASE_TRAIN_AUTHORITY', 'Release train must be deterministic and model-non-authoritative');
  invariant(Array.isArray(train.releases) && train.releases.length >= 1 && train.releases.length <= MAX_RELEASES, 'ERR_RELEASE_TRAIN_SIZE', 'Release train must contain between one and five releases');
  invariant(train.currentIndex === 0 && train.currentRelease === train.releases[0].version, 'ERR_RELEASE_TRAIN_CURRENT', 'First release must be the current release');
  const versions = new Set();
  for (let index = 0; index < train.releases.length; index += 1) {
    const release = train.releases[index];
    parseSemver(release.version);
    invariant(!versions.has(release.version), 'ERR_RELEASE_TRAIN_VERSION', `Duplicate release version: ${release.version}`);
    versions.add(release.version);
    if (index > 0) {
      invariant(compareSemver(release.version, train.releases[index - 1].version) > 0, 'ERR_RELEASE_TRAIN_VERSION', 'Release train versions must be strictly increasing');
      invariant(release.predecessor === train.releases[index - 1].version, 'ERR_RELEASE_TRAIN_PREDECESSOR', 'Release predecessor does not match the prior train release');
    } else invariant(release.predecessor === null, 'ERR_RELEASE_TRAIN_PREDECESSOR', 'Current release cannot have a train predecessor');
    invariant(['CURRENT_FULL', 'NEXT_BOUNDED', 'FUTURE_GATES'].includes(release.detailLevel), 'ERR_RELEASE_TRAIN_DETAIL', `Unsupported planning depth: ${String(release.detailLevel)}`);
    invariant(index === 0 ? release.detailLevel === 'CURRENT_FULL' : release.detailLevel !== 'CURRENT_FULL', 'ERR_RELEASE_TRAIN_DETAIL', 'Only the current release may have full current detail');
    invariant(release.valueGate?.measurable === true && meaningfulValue(release.valueGate.statement), 'ERR_RELEASE_TRAIN_VALUE', `Release ${release.version} lacks meaningful user value`);
    invariant(Array.isArray(release.valueGate.criteria) && release.valueGate.criteria.length > 0 && release.valueGate.testsAloneSufficient === false, 'ERR_RELEASE_TRAIN_VALUE', `Release ${release.version} lacks a measurable value gate`);
    invariant(Array.isArray(release.entryGate) && release.entryGate.length > 0, 'ERR_RELEASE_TRAIN_ENTRY', `Release ${release.version} lacks an entry gate`);
    invariant(Array.isArray(release.exitGate) && release.exitGate.length > 0, 'ERR_RELEASE_TRAIN_EXIT', `Release ${release.version} lacks an exit gate`);
    invariant(release.rollback?.required === true && release.rollback?.evidenceRequired === true, 'ERR_RELEASE_TRAIN_ROLLBACK', `Release ${release.version} lacks rollback proof`);
    invariant(Array.isArray(release.replanTriggers) && release.replanTriggers.length > 0, 'ERR_RELEASE_TRAIN_REPLAN', `Release ${release.version} lacks replan triggers`);
    invariant(release.transition?.nextReleaseRequiresClosedReceipt === true && release.transition?.releaseDoesNotImplyReleased === true, 'ERR_RELEASE_TRAIN_TRANSITION', `Release ${release.version} weakens transition authority`);
    if (index === 0) {
      invariant(release.authority === 'CURRENT_CONTRACT_CANDIDATE' && release.canGrantCurrentAuthority === true, 'ERR_RELEASE_TRAIN_AUTHORITY', 'Current release authority is invalid');
    } else {
      invariant(release.authority === 'ADVISORY_REPLAN_REQUIRED' && release.canGrantCurrentAuthority === false, 'ERR_RELEASE_TRAIN_AUTHORITY', 'Future releases cannot grant current authority');
      invariant(release.acceptance?.exactCommands?.length === 0 && release.acceptance?.futureCommandsAreAuthority === false, 'ERR_RELEASE_TRAIN_FUTURE_COMMAND', 'Future release commands cannot become authority before replan');
    }
  }
  if (options.currentContract) {
    const expected = (options.currentContract.acceptance ?? []).map(normalizedCommand);
    invariant(stableStringify(train.releases[0].acceptance.exactCommands) === stableStringify(expected), 'ERR_RELEASE_TRAIN_CURRENT', 'Current train acceptance does not match the proposal contract');
    invariant(train.releases[0].goal === options.currentContract.goal, 'ERR_RELEASE_TRAIN_CURRENT', 'Current train goal does not match the proposal contract');
  }
  const { hash, ...body } = train;
  invariant(hash === hashObject(body), 'ERR_RELEASE_TRAIN_HASH', 'Release train hash does not match its authority content');
  return train;
}

export function releaseTrainSummary(train) {
  if (!train) return null;
  validateReleaseTrain(train);
  return {
    schema: 'shipping-harness/release-train-summary-v1',
    id: train.id,
    hash: train.hash,
    finalGoal: train.finalGoal,
    currentRelease: train.currentRelease,
    currentIndex: train.currentIndex,
    totalReleases: train.releases.length,
    modelAuthority: false,
    releases: train.releases.map((release, index) => ({
      order: release.order,
      version: release.version,
      stage: release.stage,
      detailLevel: release.detailLevel,
      current: index === train.currentIndex,
      value: release.valueGate.statement,
      authority: release.authority,
    })),
  };
}

export function bindApprovedReleaseTrain(train, binding) {
  validateReleaseTrain(train);
  const body = {
    schema: TRAIN_BINDING_SCHEMA,
    train,
    binding: {
      proposalId: boundedText(binding.proposalId, 'proposal ID', 160),
      proposalHash: boundedText(binding.proposalHash, 'proposal hash', 64),
      contractHash: boundedText(binding.contractHash, 'contract hash', 64),
      baselineSha: boundedText(binding.baselineSha, 'baseline SHA', 40),
      approvedAt: boundedText(binding.approvedAt, 'approval time', 80),
    },
  };
  invariant(/^[a-f0-9]{64}$/u.test(body.binding.proposalHash), 'ERR_RELEASE_TRAIN_BINDING', 'Proposal hash must be SHA-256');
  invariant(/^[a-f0-9]{64}$/u.test(body.binding.contractHash), 'ERR_RELEASE_TRAIN_BINDING', 'Contract hash must be SHA-256');
  invariant(/^[a-f0-9]{40}$/u.test(body.binding.baselineSha), 'ERR_RELEASE_TRAIN_BINDING', 'Baseline SHA must be a full Git SHA');
  invariant(Number.isFinite(Date.parse(body.binding.approvedAt)), 'ERR_RELEASE_TRAIN_BINDING', 'Approval time must be ISO date-time');
  return { ...body, hash: hashObject(body) };
}

export async function persistApprovedReleaseTrain(root, train, binding) {
  const target = runtimePaths(root).releaseTrain;
  await assertContainedPath(root, target);
  const envelope = bindApprovedReleaseTrain(train, binding);
  await writeJsonAtomic(target, envelope);
  return { path: target, envelope };
}

export async function loadApprovedReleaseTrain(root) {
  const target = runtimePaths(root).releaseTrain;
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  const envelope = await readJson(target);
  invariant(envelope?.schema === TRAIN_BINDING_SCHEMA, 'ERR_RELEASE_TRAIN_BINDING', 'Unsupported release train binding schema');
  const { hash, ...body } = envelope;
  invariant(hash === hashObject(body), 'ERR_RELEASE_TRAIN_BINDING', 'Release train binding hash does not match its content');
  validateReleaseTrain(envelope.train);
  return envelope;
}

export const RELEASE_TRAIN = Object.freeze({
  schema: TRAIN_SCHEMA,
  bindingSchema: TRAIN_BINDING_SCHEMA,
  maxReleases: MAX_RELEASES,
});
