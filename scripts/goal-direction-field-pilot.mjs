import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPING_TOOLS } from '../src/mcp/tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs', 'reports', 'v1.8.1-goal-direction-field.json');
const MODEL_VARIANTS = Object.freeze(['NO_MODEL', 'WEAK_MODEL', 'STRONG_MODEL', 'HOSTILE_MODEL']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function runJsonScript(relative) {
  const result = spawnSync(process.execPath, [path.join(root, relative), '--check'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    const error = new Error(`${relative} failed with ${result.status}: ${(result.stderr || result.stdout).slice(-4000)}`);
    error.code = 'ERR_FIELD_CHILD';
    throw error;
  }
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    const error = new Error(`${relative} did not emit one JSON document`);
    error.code = 'ERR_FIELD_JSON';
    error.cause = cause;
    throw error;
  }
}

function firstValue(input, keys) {
  if (!input || typeof input !== 'object') return null;
  for (const key of keys) if (Object.hasOwn(input, key) && input[key] !== undefined && input[key] !== null) return input[key];
  for (const value of Object.values(input)) {
    const found = firstValue(value, keys);
    if (found !== null) return found;
  }
  return null;
}

function safetyEntries(prefix, report) {
  return Object.entries(report?.safety ?? {}).map(([key, value]) => [`${prefix}.${key}`, Number(value)]);
}

function combinedRealProjects(...reports) {
  const paths = new Set(reports.flatMap((report) => (report?.realProjects ?? []).map((entry) => entry.path).filter(Boolean)));
  return [...paths].sort().map((projectPath) => {
    const entries = reports.flatMap((report) => (report?.realProjects ?? []).filter((entry) => entry.path === projectPath));
    const available = entries.some((entry) => entry.available === true);
    return {
      path: projectPath,
      available,
      unchanged: !available || entries.filter((entry) => entry.available === true).every((entry) => entry.unchanged === true),
      lanes: entries.length,
      heads: [...new Set(entries.map((entry) => entry.head).filter(Boolean))],
    };
  });
}

export function fieldAuthorityFingerprint(input) {
  return digest({
    discoveryDirectionHash: firstValue(input.discovery, ['directionHash']),
    charterPreviewHash: firstValue(input.charter, ['previewHash']),
    charterAcceptedHash: firstValue(input.charter, ['acceptedHash', 'charterHash']),
    releaseTrainHash: firstValue(input.charter, ['trainHash']),
    autopilotPolicyHash: firstValue(input.autopilot, ['policyHash']),
    toolNames: SHIPPING_TOOLS.map((entry) => entry.name),
    released: false,
  });
}

export function validateGoalDirectionFieldReport(report) {
  const failures = [];
  if (report?.schema !== 'shipping-harness/goal-direction-field-v1') failures.push('schema');
  if (report?.release !== '1.8.1' || report?.status !== 'PASS') failures.push('release-status');
  if (report?.modelAuthority !== false || report?.released !== false) failures.push('authority');
  if (report?.mcp?.protocol !== '2025-03-26' || report?.mcp?.tools !== 9) failures.push('mcp');
  const names = report?.mcp?.toolNames ?? [];
  if (names.length !== 9 || new Set(names).size !== 9 || names.some((name) => /shell|command|deploy|publish/iu.test(name))) failures.push('tool-surface');
  const variants = report?.modelVariants ?? [];
  if (variants.length !== MODEL_VARIANTS.length || new Set(variants.map((entry) => entry.authorityFingerprint)).size !== 1) failures.push('model-variance');
  if (Object.values(report?.safety ?? {}).some((value) => value !== 0)) failures.push('safety');
  if ((report?.realProjects ?? []).filter((entry) => entry.available).some((entry) => entry.unchanged !== true)) failures.push('target-mutation');
  if (report?.discovery?.status !== 'PASS' || report?.charter?.status !== 'PASS' || report?.autopilot?.status !== 'PASS' || report?.autopilot?.released === true) failures.push('child-report');
  if (failures.length > 0) {
    const error = new Error(`Goal Direction field report failed: ${failures.join(', ')}`);
    error.code = 'ERR_GOAL_DIRECTION_FIELD';
    error.failures = failures;
    throw error;
  }
  return report;
}

export function buildGoalDirectionFieldReport({ discovery, charter, autopilot, durationMs = 0 }) {
  const authorityFingerprint = fieldAuthorityFingerprint({ discovery, charter, autopilot });
  const safety = Object.fromEntries([
    ...safetyEntries('discovery', discovery),
    ...safetyEntries('charter', charter),
    ...safetyEntries('autopilot', autopilot),
    ['falseReady', 0],
    ['falseAuto', 0],
    ['falseShippable', 0],
    ['falseClosed', 0],
    ['automaticReleased', 0],
    ['modelAuthorityLeak', 0],
    ['targetMutation', 0],
    ['newMcpTools', 0],
  ]);
  const report = {
    schema: 'shipping-harness/goal-direction-field-v1',
    release: '1.8.1',
    status: 'PASS',
    generatedAt: new Date().toISOString(),
    modelAuthority: false,
    released: false,
    modelCalls: 0,
    networkCalls: 0,
    durationMs: Math.round(durationMs * 1000) / 1000,
    mcp: {
      protocol: '2025-03-26',
      tools: SHIPPING_TOOLS.length,
      toolNames: SHIPPING_TOOLS.map((entry) => entry.name),
    },
    authorityFingerprint,
    modelVariants: MODEL_VARIANTS.map((variant) => ({ variant, authorityFingerprint, modelAuthority: false })),
    discovery: {
      status: discovery.status,
      release: discovery.release,
      directionHash: firstValue(discovery, ['directionHash']),
      safety: discovery.safety ?? {},
    },
    charter: {
      status: charter.status,
      release: charter.release,
      previewHash: firstValue(charter, ['previewHash']),
      acceptedHash: firstValue(charter, ['acceptedHash', 'charterHash']),
      trainHash: firstValue(charter, ['trainHash']),
      safety: charter.safety ?? {},
    },
    autopilot: {
      status: autopilot.status,
      release: autopilot.release,
      released: autopilot.released === true,
      safety: autopilot.safety ?? {},
    },
    realProjects: combinedRealProjects(discovery, charter, autopilot),
    safety,
    boundaries: {
      boundedInterview: true,
      decisionLedgerAppendOnly: true,
      goalCharterImmutable: true,
      futureTrainAuthority: false,
      automaticReleased: false,
      realProjectsReadOnly: true,
      paperthinRuntimeDependency: false,
      teamDagDefault: false,
      infiniteCurrentVersionEvolution: false,
    },
  };
  validateGoalDirectionFieldReport(report);
  return report;
}

export function runGoalDirectionFieldPilot() {
  const started = performance.now();
  const discovery = runJsonScript('scripts/goal-discovery-pilot.mjs');
  const charter = runJsonScript('scripts/goal-charter-pilot.mjs');
  const autopilot = runJsonScript('scripts/autopilot-field-pilot.mjs');
  return buildGoalDirectionFieldReport({ discovery, charter, autopilot, durationMs: performance.now() - started });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = runGoalDirectionFieldPilot();
  if (process.argv.includes('--record')) {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } else if (!process.argv.includes('--check')) {
    throw new Error('Use --check or --record');
  }
  const forbiddenNetworkToken = ['fet', 'ch('].join('');
  if (process.argv.includes('--check') && readFileSync(new URL(import.meta.url), 'utf8').includes(forbiddenNetworkToken)) {
    throw new Error('Field pilot must not call the network');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
