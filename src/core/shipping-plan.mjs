// A repository-owned, reviewable project plan file (docs/shipping-plan.json by
// default). The host model may write it; the harness only validates it. The file can
// never carry a command: `command`, `shell`, `args`, `argv`, `env` and `environment`
// keys are rejected anywhere in the document, and stage acceptance is expressed only
// as a reference to a candidate command the project analyzer already detected.
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hashFile, hashObject, stableStringify } from './crypto.mjs';
import { ShippingError, invariant } from './errors.mjs';
import { assertContainedPath, exists, fileSize, readJson } from './fs.mjs';
import { runtimePaths } from './paths.mjs';

export const PLAN_SCHEMA = 'shipping-harness/plan-v1';
export const DEFAULT_PLAN_PATH = 'docs/shipping-plan.json';

export const PLAN_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024,
  maxStages: 24,
  maxAcceptanceRefs: 8,
  maxDependsOn: 8,
  maxScopeItems: 24,
  maxSources: 16,
  maxProjectLength: 160,
  maxTitleLength: 200,
  maxOutcomeLength: 1000,
  maxScopeItemLength: 500,
  maxPathLength: 300,
  maxNoteLength: 500,
  maxRefLength: 80,
  projectionOutcomeLength: 200,
  maxProjectionBytes: 16 * 1024,
});

const FORBIDDEN_KEYS = Object.freeze(['command', 'shell', 'args', 'argv', 'env', 'environment']);
const STAGE_ID = /^S-[A-Za-z0-9_-]{1,32}$/u;
const REF_ID = /^[A-Za-z0-9._:-]{1,80}$/u;
const PLAN_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/u;
const STAGE_SIZES = Object.freeze(['PATCH', 'MILESTONE']);

/** Tier budgets. MILESTONE and PROGRAM keep the contract's existing budgets. */
export const PLAN_TIER_BUDGETS = Object.freeze({
  PATCH: Object.freeze({ maxFixCycles: 1, maxAgentRuns: 1 }),
});

/**
 * Reject `command`-like keys anywhere in a parsed plan document.
 * @param {unknown} value
 * @param {string} [location]
 * @returns {void}
 */
export function assertNoRawCommandKeys(value, location = 'plan') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawCommandKeys(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      throw new ShippingError('ERR_PLAN_RAW_COMMAND', `Plan documents cannot carry commands: ${location}.${key} is forbidden`, { location, key });
    }
    assertNoRawCommandKeys(nested, `${location}.${key}`);
  }
}

/** @param {Record<string, any>} value @param {string[]} allowed @param {string} label */
function rejectUnknownPlanKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    invariant(allowed.includes(key), 'ERR_PLAN_INVALID', `${label}.${key} is not an allowed plan field`, { label, key });
  }
}

/** @param {unknown} value @param {string} label @param {number} max */
function planText(value, label, max) {
  invariant(typeof value === 'string', 'ERR_PLAN_INVALID', `${label} must be a string`, { label });
  const text = value.trim().replace(/\s+/gu, ' ');
  invariant(text.length > 0 && text.length <= max, 'ERR_PLAN_INVALID', `${label} must be between 1 and ${max} characters`, { label });
  return text;
}

/** @param {unknown} value @param {string} label @param {number} maxItems @param {number} maxLength */
function planTextArray(value, label, maxItems, maxLength) {
  if (value === undefined) return [];
  invariant(Array.isArray(value), 'ERR_PLAN_INVALID', `${label} must be an array`, { label });
  invariant(value.length <= maxItems, 'ERR_PLAN_INVALID', `${label} accepts at most ${maxItems} entries`, { label });
  return value.map((entry, index) => planText(entry, `${label}[${index}]`, maxLength));
}

/** @param {Record<string, any>} raw @param {number} index */
function validateStage(raw, index) {
  const label = `plan.stages[${index}]`;
  invariant(raw && typeof raw === 'object' && !Array.isArray(raw), 'ERR_PLAN_INVALID', `${label} must be an object`, { label });
  rejectUnknownPlanKeys(raw, ['id', 'title', 'outcome', 'dependsOn', 'acceptanceRefs', 'scopeInclude', 'scopeExclude', 'size'], label);
  const id = planText(raw.id, `${label}.id`, 40);
  invariant(STAGE_ID.test(id), 'ERR_PLAN_INVALID', `${label}.id must look like S-01`, { label, id });
  const size = raw.size === undefined ? 'MILESTONE' : planText(raw.size, `${label}.size`, 20);
  invariant(STAGE_SIZES.includes(size), 'ERR_PLAN_INVALID', `${label}.size must be PATCH or MILESTONE`, { label, size });
  const dependsOn = planTextArray(raw.dependsOn, `${label}.dependsOn`, PLAN_LIMITS.maxDependsOn, 40);
  for (const dependency of dependsOn) invariant(STAGE_ID.test(dependency), 'ERR_PLAN_INVALID', `${label}.dependsOn contains an invalid stage ID`, { label, dependency });
  const acceptanceRefs = planTextArray(raw.acceptanceRefs, `${label}.acceptanceRefs`, PLAN_LIMITS.maxAcceptanceRefs, PLAN_LIMITS.maxRefLength);
  for (const ref of acceptanceRefs) invariant(REF_ID.test(ref), 'ERR_PLAN_INVALID', `${label}.acceptanceRefs contains an invalid reference`, { label, ref });
  return {
    id,
    title: planText(raw.title, `${label}.title`, PLAN_LIMITS.maxTitleLength),
    outcome: planText(raw.outcome, `${label}.outcome`, PLAN_LIMITS.maxOutcomeLength),
    dependsOn,
    acceptanceRefs,
    scopeInclude: planTextArray(raw.scopeInclude, `${label}.scopeInclude`, PLAN_LIMITS.maxScopeItems, PLAN_LIMITS.maxScopeItemLength),
    scopeExclude: planTextArray(raw.scopeExclude, `${label}.scopeExclude`, PLAN_LIMITS.maxScopeItems, PLAN_LIMITS.maxScopeItemLength),
    size,
  };
}

/** @param {Array<{id: string, dependsOn: string[]}>} stages */
function assertAcyclicStages(stages) {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const state = new Map();
  /** @param {string} id @param {string[]} trail */
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    invariant(state.get(id) !== 'open', 'ERR_PLAN_CYCLE', `Plan stage dependencies contain a cycle: ${[...trail, id].join(' -> ')}`, { cycle: [...trail, id] });
    state.set(id, 'open');
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency, [...trail, id]);
    state.set(id, 'done');
  };
  for (const stage of stages) visit(stage.id, []);
}

/** @param {Record<string, any>} raw @param {number} index */
function validateSource(raw, index) {
  const label = `plan.sources[${index}]`;
  invariant(raw && typeof raw === 'object' && !Array.isArray(raw), 'ERR_PLAN_INVALID', `${label} must be an object`, { label });
  rejectUnknownPlanKeys(raw, ['path', 'note', 'sha256'], label);
  const source = { path: planText(raw.path, `${label}.path`, PLAN_LIMITS.maxPathLength) };
  invariant(!path.isAbsolute(source.path) && !source.path.split('/').includes('..'), 'ERR_PLAN_INVALID', `${label}.path must be a repository-relative path`, { label });
  if (raw.note !== undefined) source.note = planText(raw.note, `${label}.note`, PLAN_LIMITS.maxNoteLength);
  if (raw.sha256 !== undefined) {
    invariant(typeof raw.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(raw.sha256), 'ERR_PLAN_INVALID', `${label}.sha256 must be a SHA-256 hex digest`, { label });
    source.sha256 = raw.sha256;
  }
  return source;
}

/**
 * Validate a parsed plan document and return its normalized form.
 * @param {unknown} document
 * @returns {{schema: string, project: string, program: {title: string, outcome: string}, sources: Array<{path: string, note?: string, sha256?: string}>, stages: Array<Record<string, any>>, revision?: number}}
 */
export function validateShippingPlan(document) {
  assertNoRawCommandKeys(document);
  invariant(document && typeof document === 'object' && !Array.isArray(document), 'ERR_PLAN_INVALID', 'plan must be an object');
  const raw = /** @type {Record<string, any>} */ (document);
  rejectUnknownPlanKeys(raw, ['schema', 'project', 'program', 'sources', 'stages', 'revision'], 'plan');
  invariant(raw.schema === PLAN_SCHEMA, 'ERR_PLAN_INVALID', `plan.schema must equal ${PLAN_SCHEMA}`, { schema: raw.schema });
  if (raw.revision !== undefined) {
    invariant(Number.isInteger(raw.revision) && raw.revision >= 1, 'ERR_PLAN_INVALID', 'plan.revision must be a positive integer', { revision: raw.revision });
  }
  invariant(raw.program && typeof raw.program === 'object' && !Array.isArray(raw.program), 'ERR_PLAN_INVALID', 'plan.program must be an object');
  rejectUnknownPlanKeys(raw.program, ['title', 'outcome', 'supersedes'], 'plan.program');
  if (raw.program.supersedes !== undefined) {
    invariant(typeof raw.program.supersedes === 'string' && /^[a-f0-9]{64}$/u.test(raw.program.supersedes), 'ERR_PLAN_INVALID', 'plan.program.supersedes must be a SHA-256 hex digest of the plan it replaces', { label: 'plan.program.supersedes' });
  }
  invariant(Array.isArray(raw.stages) && raw.stages.length > 0, 'ERR_PLAN_INVALID', 'plan.stages must contain at least one stage');
  invariant(raw.stages.length <= PLAN_LIMITS.maxStages, 'ERR_PLAN_INVALID', `plan.stages accepts at most ${PLAN_LIMITS.maxStages} stages`);
  if (raw.sources !== undefined) {
    invariant(Array.isArray(raw.sources), 'ERR_PLAN_INVALID', 'plan.sources must be an array');
    invariant(raw.sources.length <= PLAN_LIMITS.maxSources, 'ERR_PLAN_INVALID', `plan.sources accepts at most ${PLAN_LIMITS.maxSources} entries`);
  }
  const stages = raw.stages.map((stage, index) => validateStage(stage, index));
  const ids = new Set();
  for (const stage of stages) {
    invariant(!ids.has(stage.id), 'ERR_PLAN_INVALID', `Duplicate plan stage ID: ${stage.id}`, { id: stage.id });
    ids.add(stage.id);
  }
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) {
      invariant(ids.has(dependency), 'ERR_PLAN_INVALID', `Plan stage ${stage.id} depends on unknown stage ${dependency}`, { id: stage.id, dependency });
      invariant(dependency !== stage.id, 'ERR_PLAN_CYCLE', `Plan stage ${stage.id} depends on itself`, { id: stage.id });
    }
  }
  assertAcyclicStages(stages);
  return {
    schema: PLAN_SCHEMA,
    project: planText(raw.project, 'plan.project', PLAN_LIMITS.maxProjectLength),
    program: {
      title: planText(raw.program.title, 'plan.program.title', PLAN_LIMITS.maxTitleLength),
      outcome: planText(raw.program.outcome, 'plan.program.outcome', PLAN_LIMITS.maxOutcomeLength),
      ...(raw.program.supersedes === undefined ? {} : { supersedes: raw.program.supersedes }),
    },
    sources: (raw.sources ?? []).map((source, index) => validateSource(source, index)),
    stages,
    ...(raw.revision === undefined ? {} : { revision: raw.revision }),
  };
}

/**
 * The canonical hash of a validated plan.
 * @param {Record<string, any>} plan
 * @returns {string}
 */
export function planHash(plan) {
  return hashObject(plan);
}

/** @param {string} root @param {string} relativePath */
async function resolvePlanPath(root, relativePath) {
  invariant(typeof relativePath === 'string' && relativePath.length > 0 && relativePath.length <= PLAN_LIMITS.maxPathLength, 'ERR_PLAN_PATH', 'Plan path must be a bounded repository-relative path');
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//u, '');
  invariant(PLAN_PATH.test(normalized) && !normalized.split('/').includes('..'), 'ERR_PLAN_PATH', `Plan path must be a repository-relative .json path: ${relativePath}`, { relativePath });
  invariant(!normalized.startsWith('.shipping/'), 'ERR_PLAN_PATH', 'Plan files cannot live under .shipping/', { relativePath });
  const absolute = path.join(root, normalized);
  await assertContainedPath(root, absolute);
  return { normalized, absolute };
}

/**
 * Compare each source's recorded `sha256` against the file on disk. Never blocks: a
 * changed or missing source file only ever produces a diagnostic. A source with no
 * `sha256` (a v1.12.0 plan, or one written before its first update) is reported once as
 * `PLAN_LEGACY_FORMAT` and otherwise left alone — there is nothing to compare it against.
 * @param {string} root
 * @param {Array<{path: string, sha256?: string}>} sources
 * @returns {Promise<{diagnostics: string[], sourceDrift: Array<{path: string, expected: string, observed: string | null}>, legacyFormat: boolean}>}
 */
async function auditPlanSources(root, sources) {
  const diagnostics = [];
  const sourceDrift = [];
  let legacySources = false;
  for (const source of sources) {
    if (typeof source.sha256 !== 'string') {
      legacySources = true;
      continue;
    }
    const absolute = path.join(root, source.path);
    await assertContainedPath(root, absolute);
    if (!(await exists(absolute))) {
      diagnostics.push(`PLAN_SOURCE_MISSING: ${source.path}`);
      sourceDrift.push({ path: source.path, expected: source.sha256, observed: null });
      continue;
    }
    const observed = await hashFile(absolute);
    if (observed !== source.sha256) {
      diagnostics.push(`PLAN_SOURCE_DRIFT: ${source.path} changed since the plan was written (plan ${source.sha256.slice(0, 8)}, now ${observed.slice(0, 8)})`);
      sourceDrift.push({ path: source.path, expected: source.sha256, observed });
    }
  }
  return { diagnostics: legacySources ? [...diagnostics, 'PLAN_LEGACY_FORMAT: sources carry no sha256; set revision and source hashes on the next update'] : diagnostics, sourceDrift, legacyFormat: legacySources };
}

/**
 * Load, bound, and validate the repository plan file. The path is fixed: an update
 * rewrites `docs/shipping-plan.json` in place, it never adds a second plan file.
 * With `auditHistory`, a plan that contradicts the evidence already on disk is refused.
 * @param {string} root
 * @param {string} [relativePath]
 * @param {{auditHistory?: boolean}} [options]
 * @returns {Promise<{path: string, absolutePath: string, plan: Record<string, any>, planHash: string, diagnostics: string[], progressPlanHash: string | null, sourceDrift: Array<{path: string, expected: string, observed: string | null}>, legacyFormat: boolean} | null>}
 */
export async function loadShippingPlan(root, relativePath = DEFAULT_PLAN_PATH, options = {}) {
  invariant(relativePath === DEFAULT_PLAN_PATH, 'ERR_PLAN_PATH_FIXED', `The plan file path is fixed at ${DEFAULT_PLAN_PATH}; an update rewrites that file instead of adding another one: ${relativePath}`, { requested: relativePath, expected: DEFAULT_PLAN_PATH });
  const { normalized, absolute } = await resolvePlanPath(root, relativePath);
  if (!(await exists(absolute))) return null;
  const size = await fileSize(absolute);
  invariant(size <= PLAN_LIMITS.maxFileBytes, 'ERR_PLAN_TOO_LARGE', `Plan file exceeds ${PLAN_LIMITS.maxFileBytes} bytes: ${normalized}`, { path: normalized, size });
  const plan = validateShippingPlan(await readJson(absolute));
  const hash = planHash(plan);
  const superseded = await resolvePlanSupersedes(root, plan, hash);
  if (options.auditHistory === true && !superseded.superseded) await assertPlanHistory(root, plan);
  const sources = await auditPlanSources(root, plan.sources);
  const legacyRevision = plan.revision === undefined;
  const legacyFormat = sources.legacyFormat || legacyRevision;
  const diagnostics = [...superseded.diagnostics, ...sources.diagnostics];
  if (legacyRevision && !sources.legacyFormat) diagnostics.push('PLAN_LEGACY_FORMAT: plan carries no revision; set revision on the next update');
  return {
    path: normalized,
    absolutePath: absolute,
    plan,
    planHash: hash,
    diagnostics,
    progressPlanHash: superseded.progressPlanHash,
    sourceDrift: sources.sourceDrift,
    legacyFormat,
  };
}

/**
 * The deterministic reference identifier of one analyzer candidate command.
 * @param {{id?: string, command?: string, cwd?: string}} candidate
 * @returns {string}
 */
export function candidateCommandRef(candidate) {
  const seed = `${candidate?.cwd ?? '.'} ${candidate?.command ?? ''}`;
  return `CMD-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

/**
 * Resolve each stage's acceptance references against the analyzer's candidate commands.
 * A reference matches either the candidate's own ID or its deterministic CMD- reference.
 * @param {Record<string, any>} plan
 * @param {Record<string, any> | null | undefined} analysis
 * @returns {Map<string, {resolved: Array<Record<string, any>>, unresolved: string[]}>}
 */
export function resolveAcceptanceRefs(plan, analysis) {
  // Proposal-default candidates plus stage-scoped scripts (test:parse, lint:api, …), which
  // never enter a default proposal but may be referenced by a plan stage.
  const candidates = [...(analysis?.candidateCommands ?? []), ...(analysis?.stageCommands ?? [])];
  const index = new Map();
  for (const candidate of candidates) {
    if (typeof candidate?.id === 'string') index.set(candidate.id, candidate);
    index.set(candidateCommandRef(candidate), candidate);
  }
  const result = new Map();
  for (const stage of plan.stages) {
    const resolved = [];
    const unresolved = [];
    for (const ref of stage.acceptanceRefs) {
      const candidate = index.get(ref);
      if (candidate) resolved.push(candidate);
      else unresolved.push(ref);
    }
    result.set(stage.id, { resolved, unresolved });
  }
  return result;
}

/**
 * Every CLOSED release receipt on disk, oldest file name first, with the evidence path
 * a violation can cite. A malformed or non-receipt file proves nothing and is skipped.
 * @param {string} root
 * @returns {Promise<Array<{evidence: string, receipt: Record<string, any>}>>}
 */
async function readClosedReceipts(root) {
  const { releases } = runtimePaths(root);
  /** @type {string[]} */
  let entries;
  try {
    entries = await readdir(releases);
  } catch {
    // No receipts yet: every stage is simply not DONE.
    return [];
  }
  const found = [];
  for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
    /** @type {Record<string, any> | null} */
    let receipt;
    try {
      receipt = await readJson(path.join(releases, entry));
    } catch {
      continue;
    }
    const closed = receipt && receipt.schema === 'shipping-harness/release-v1' && (receipt.state === 'CLOSED' || typeof receipt.closedAt === 'string');
    if (closed && receipt) found.push({ evidence: `.shipping/releases/${entry}`, receipt });
  }
  return found;
}

/** @param {string} root @param {string | null} [onlyPlanHash] */
async function closedPlanStageIds(root, onlyPlanHash = null) {
  const ids = new Set();
  for (const { receipt } of await readClosedReceipts(root)) {
    if (typeof receipt.planStageId !== 'string') continue;
    if (onlyPlanHash !== null && receipt.planHash !== onlyPlanHash) continue;
    ids.add(receipt.planStageId);
  }
  return ids;
}

/** @param {string} root */
async function activePlanStageId(root) {
  const { contract: contractPath } = runtimePaths(root);
  if (!(await exists(contractPath))) return null;
  try {
    const contract = await readJson(contractPath);
    const stageId = contract?.plan?.stageId;
    return typeof stageId === 'string' ? stageId : null;
  } catch {
    // An unreadable contract is reported by the contract layer, not by plan progress.
    return null;
  }
}

/** @param {Array<Record<string, any>>} stages @param {Set<string>} done @param {string | null} active @param {Set<string>} unresolved */
function stageStates(stages, done, active, unresolved) {
  const states = new Map();
  for (const stage of stages) {
    const dependenciesSatisfied = stage.dependsOn.every((dependency) => done.has(dependency));
    let state = 'BLOCKED_BY_DEPENDENCY';
    if (done.has(stage.id)) state = 'DONE';
    else if (active === stage.id) state = 'ACTIVE';
    else if (unresolved.has(stage.id)) state = 'BLOCKED_BY_UNRESOLVED';
    else if (dependenciesSatisfied) state = 'READY';
    states.set(stage.id, {
      id: stage.id,
      state,
      dependenciesSatisfied,
      unmetDependencies: stage.dependsOn.filter((dependency) => !done.has(dependency)),
    });
  }
  return states;
}

/**
 * Deterministic plan progress from closed release receipts and the current contract.
 * @param {string} root
 * @param {Record<string, any>} plan
 * @param {{unresolvedStageIds?: string[], planHash?: string | null}} [options] `planHash` counts only receipts from that plan (a superseding plan restarts at zero).
 * @returns {Promise<{total: number, done: number, active: number, ready: number, percent: number, nextStageId: string | null, stages: Array<Record<string, any>>}>}
 */
export async function computePlanProgress(root, plan, options = {}) {
  const done = await closedPlanStageIds(root, options.planHash ?? null);
  const active = await activePlanStageId(root);
  const unresolved = new Set(options.unresolvedStageIds ?? []);
  const states = stageStates(plan.stages, done, active, unresolved);
  const entries = plan.stages.map((stage) => states.get(stage.id));
  const doneCount = entries.filter((entry) => entry.state === 'DONE').length;
  const activeCount = entries.filter((entry) => entry.state === 'ACTIVE').length;
  const readyCount = entries.filter((entry) => entry.state === 'READY').length;
  return {
    total: plan.stages.length,
    done: doneCount,
    active: activeCount,
    ready: readyCount,
    percent: plan.stages.length === 0 ? 0 : Math.round((doneCount / plan.stages.length) * 100),
    nextStageId: entries.find((entry) => entry.state === 'READY')?.id ?? null,
    stages: entries,
  };
}

/** The stage fields a closure receipt and a contract lock freeze as evidence. */
export const PLAN_STAGE_SNAPSHOT_FIELDS = Object.freeze(['id', 'title', 'outcome', 'dependsOn', 'acceptanceRefs', 'scopeInclude', 'scopeExclude', 'size']);

/**
 * The immutable snapshot of one plan stage, written into the lock at bind time and into
 * the release receipt at close time. It is the only record of what the stage said when
 * the work was authorized, so it never contains anything derived from the current file.
 * @param {Record<string, any>} stage
 * @returns {Record<string, any>}
 */
export function planStageSnapshot(stage) {
  return {
    id: stage.id,
    title: stage.title,
    outcome: stage.outcome,
    dependsOn: [...(stage.dependsOn ?? [])],
    acceptanceRefs: [...(stage.acceptanceRefs ?? [])],
    scopeInclude: [...(stage.scopeInclude ?? [])],
    scopeExclude: [...(stage.scopeExclude ?? [])],
    size: stage.size,
  };
}

/**
 * The ACTIVE stage's evidence: the current lock. Once the state is CLOSED the receipt is
 * the evidence and the stale lock must not be compared a second time.
 * @param {string} root
 * @returns {Promise<{evidence: string, snapshot: Record<string, any>} | null>}
 */
async function activeStageSnapshot(root) {
  const paths = runtimePaths(root);
  /** @type {Record<string, any> | null} */
  let state = null;
  try {
    state = await readJson(paths.state);
  } catch {
    // An unreadable state file is reported by the state layer; the lock is still evidence.
  }
  if (state?.state === 'CLOSED') return null;
  if (!(await exists(paths.lock))) return null;
  try {
    const lock = await readJson(paths.lock);
    const snapshot = lock?.planStage;
    if (!snapshot || typeof snapshot.id !== 'string') return null;
    return { evidence: '.shipping/contract.lock', snapshot };
  } catch {
    // An unreadable lock is reported by the contract layer, not by the plan history audit.
    return null;
  }
}

/** @param {Record<string, any>} stage @param {{snapshot: Record<string, any>, evidence: string}} entry */
function compareStageSnapshot(stage, entry) {
  const observed = planStageSnapshot(stage);
  const violations = [];
  for (const field of PLAN_STAGE_SNAPSHOT_FIELDS) {
    const expected = entry.snapshot[field];
    if (expected === undefined) continue;
    if (stableStringify(expected) === stableStringify(observed[field])) continue;
    violations.push({
      stageId: stage.id,
      // Rewriting what a finished stage depended on rewrites the shape of the past itself,
      // so it is reported apart from an ordinary field edit.
      kind: field === 'dependsOn' ? 'DEPENDS_ON_REWRITTEN' : 'CHANGED',
      field,
      expected,
      observed: observed[field],
      evidence: entry.evidence,
    });
  }
  return violations;
}

/** @param {string} root @returns {Promise<Array<{stageId: string, snapshot: Record<string, any> | null, evidence: string}>>} */
async function stagesWithEvidence(root) {
  const entries = [];
  for (const { evidence, receipt } of await readClosedReceipts(root)) {
    if (typeof receipt.planStageId !== 'string') continue;
    entries.push({ stageId: receipt.planStageId, snapshot: receipt.planStage ?? null, evidence });
  }
  const active = await activeStageSnapshot(root);
  if (active) entries.push({ stageId: active.snapshot.id, snapshot: active.snapshot, evidence: active.evidence });
  return entries;
}

/**
 * Compare the plan file against every stage that already carries evidence — a CLOSED
 * release receipt (DONE) or the current lock (ACTIVE). Stages with no evidence are free
 * to change, and a brand-new stage is always allowed.
 * @param {string} root
 * @param {Record<string, any>} plan
 * @returns {Promise<{ok: boolean, violations: Array<Record<string, any>>, protectedStageIds: string[]}>}
 */
export async function auditPlanHistory(root, plan) {
  const entries = await stagesWithEvidence(root);
  const byId = new Map(plan.stages.map((stage) => [stage.id, stage]));
  const violations = [];
  for (const entry of entries) {
    const stage = byId.get(entry.stageId);
    if (!stage) {
      violations.push({ stageId: entry.stageId, kind: 'MISSING', field: null, expected: entry.stageId, observed: null, evidence: entry.evidence });
      continue;
    }
    // A v1.12.0 receipt predates the snapshot: its stage ID is the only evidence it carries.
    const snapshot = entry.snapshot;
    if (snapshot) violations.push(...compareStageSnapshot(stage, { snapshot, evidence: entry.evidence }));
  }
  return { ok: violations.length === 0, violations, protectedStageIds: [...new Set(entries.map((entry) => entry.stageId))].sort() };
}

/** @param {Record<string, any>} violation */
function violationLine(violation) {
  return `${violation.stageId} ${violation.kind}${violation.field ? ` ${violation.field}` : ''} (${violation.evidence})`;
}

/**
 * Refuse a plan file that contradicts the evidence already on disk.
 * @param {string} root
 * @param {Record<string, any>} plan
 * @returns {Promise<{ok: boolean, violations: Array<Record<string, any>>, protectedStageIds: string[]}>}
 */
export async function assertPlanHistory(root, plan) {
  const audit = await auditPlanHistory(root, plan);
  if (audit.ok) return audit;
  const lines = audit.violations.slice(0, 12).map((violation) => violationLine(violation));
  throw new ShippingError('ERR_PLAN_HISTORY_LOST', `Plan file rewrites stages that already carry evidence: ${lines.join('; ')}`, { violations: audit.violations });
}

/**
 * Resolve `program.supersedes`. A plan that declares the hash of a plan whose stages were
 * actually closed is a new plan, not an update: the history audit does not apply to it and
 * its progress restarts from zero, with the uninherited stage count reported.
 * @param {string} root
 * @param {Record<string, any>} plan
 * @param {string} hash
 * @returns {Promise<{superseded: boolean, diagnostics: string[], progressPlanHash: string | null}>}
 */
async function resolvePlanSupersedes(root, plan, hash) {
  const supersedes = plan.program?.supersedes;
  if (typeof supersedes !== 'string') return { superseded: false, diagnostics: [], progressPlanHash: null };
  let matched = false;
  const inherited = new Set();
  for (const { receipt } of await readClosedReceipts(root)) {
    if (receipt.planHash !== supersedes) continue;
    matched = true;
    if (typeof receipt.planStageId === 'string') inherited.add(receipt.planStageId);
  }
  invariant(matched, 'ERR_PLAN_SUPERSEDES_UNKNOWN', `plan.program.supersedes names a plan no closed release receipt records: ${supersedes}`, { supersedes });
  return {
    superseded: true,
    diagnostics: [`PLAN_SUPERSEDED: ${inherited.size} completed stages from plan ${supersedes.slice(0, 8)} are not inherited`],
    progressPlanHash: hash,
  };
}
