import path from 'node:path';
import { hashObject } from './crypto.mjs';
import { runGit } from './git.mjs';

const MAX_TRACKED_FILES = 10000;
const MAX_COMPONENTS = 16;
const MAX_THEMES = 3;
const STACK_ORDER = ['python', 'node', 'rust', 'go', 'swift', 'java', 'shell', 'playwright', 'alembic'];

function normalized(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '') || '.';
}

function trackedFiles(root) {
  const result = runGit(root, ['ls-files', '-z'], { allowFailure: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.exitCode !== 0) return [];
  return result.stdout.split('\0').filter(Boolean).slice(0, MAX_TRACKED_FILES).map(normalized);
}

function within(file, root) {
  const candidate = normalized(file);
  const base = normalized(root);
  return base === '.' || candidate === base || candidate.startsWith(`${base}/`);
}

function stackSetForFiles(files, known = []) {
  const stacks = new Set(known);
  if (files.some((file) => /(?:^|\/)pyproject\.toml$|\.py$/u.test(file))) stacks.add('python');
  if (files.some((file) => /(?:^|\/)package\.json$|\.(?:js|jsx|mjs|cjs|ts|tsx)$/u.test(file))) stacks.add('node');
  if (files.some((file) => /playwright\.config\.|(?:^|\/)playwright(?:\/|$)|(?:^|\/)tests?\/.*\.spec\.(?:js|ts)$/u.test(file))) stacks.add('playwright');
  if (files.some((file) => /(?:^|\/)alembic(?:\/|$)|alembic\.ini$/u.test(file))) stacks.add('alembic');
  if (files.some((file) => /\.sh$/u.test(file))) stacks.add('shell');
  if (files.some((file) => /(?:^|\/)Cargo\.toml$|\.rs$/u.test(file))) stacks.add('rust');
  if (files.some((file) => /(?:^|\/)go\.mod$|\.go$/u.test(file))) stacks.add('go');
  if (files.some((file) => /\.swift$/u.test(file))) stacks.add('swift');
  if (files.some((file) => /\.(?:java|kt|kts)$/u.test(file))) stacks.add('java');
  return [...stacks].sort((left, right) => {
    const a = STACK_ORDER.indexOf(left); const b = STACK_ORDER.indexOf(right);
    return (a < 0 ? 999 : a) - (b < 0 ? 999 : b) || left.localeCompare(right);
  });
}

function componentRole(root, files, selectedRoot) {
  const text = `${root} ${files.slice(0, 50).join(' ')}`.toLowerCase();
  if (/playwright|apps?\/web|frontend|web\//u.test(text)) return 'web-and-e2e';
  if (/alembic|migrations?/u.test(text)) return 'database-migrations';
  if (/scripts?\//u.test(text)) return 'verification-and-operations';
  if (root === selectedRoot) return 'primary-runtime';
  return 'supporting-component';
}

function buildComponentGraph(files, analysis) {
  const selectedRoot = analysis.workspace?.root ?? '.';
  const components = [];
  const seen = new Set();
  /** @param {string} root @param {string[]} [knownStacks] @param {string | null} [name] */
  const add = (root, knownStacks = [], name = null) => {
    const normalizedRoot = normalized(root);
    if (seen.has(normalizedRoot)) return;
    const componentFiles = files.filter((file) => within(file, normalizedRoot));
    if (componentFiles.length === 0) return;
    seen.add(normalizedRoot);
    components.push({
      id: `COMP-${hashObject({ root: normalizedRoot }).slice(0, 10)}`,
      name: name ?? (normalizedRoot === '.' ? analysis.projectName : path.posix.basename(normalizedRoot)),
      root: normalizedRoot,
      role: componentRole(normalizedRoot, componentFiles, selectedRoot),
      stacks: stackSetForFiles(componentFiles, knownStacks),
      trackedFileCount: componentFiles.length,
    });
  };

  add(selectedRoot, analysis.types, analysis.projectName);
  for (const candidate of analysis.workspaceCandidates ?? []) {
    if (candidate.root !== selectedRoot && within(candidate.root, selectedRoot)) add(candidate.root, candidate.types, candidate.projectName);
  }
  const selectedFiles = files.filter((file) => within(file, selectedRoot));
  const supporting = [
    { pattern: /(?:^|\/)alembic(?:\/|$)|(?:^|\/)migrations?(?:\/|$)/u, suffix: 'alembic', stacks: ['python', 'alembic'], name: 'database migrations' },
    { pattern: /(?:^|\/)scripts?(?:\/|$)/u, suffix: 'scripts', stacks: ['shell'], name: 'verification scripts' },
  ];
  for (const item of supporting) {
    if (!selectedFiles.some((file) => item.pattern.test(file))) continue;
    const root = selectedRoot === '.' ? item.suffix : `${selectedRoot}/${item.suffix}`;
    add(root, item.stacks, item.name);
  }

  const bounded = components.slice(0, MAX_COMPONENTS);
  const primary = bounded.find((entry) => entry.root === selectedRoot) ?? bounded[0] ?? null;
  const allStacks = [...new Set(bounded.flatMap((entry) => entry.stacks))];
  const primaryStack = primary?.stacks.find((entry) => analysis.types.includes(entry)) ?? primary?.stacks[0] ?? null;
  return {
    schema: 'shipping-harness/component-graph-v1',
    primaryComponentId: primary?.id ?? null,
    primaryStack,
    supportingStacks: allStacks.filter((entry) => entry !== primaryStack),
    components: bounded,
    truncated: components.length > MAX_COMPONENTS,
  };
}

/**
 * @param {*} command
 * @returns {*}
 */
export function acceptanceCommandMetadata(command) {
  const text = String(command ?? '').trim().toLowerCase();
  if (/\b(?:deploy|publish|release-to|terraform apply|kubectl apply)\b/u.test(text)) {
    return { sideEffect: 'external-state', isolationRequired: true, deterministicOutputRequired: false, automaticallyRunnable: false };
  }
  if (/\b(?:package|pack|release)\b/u.test(text)) {
    return { sideEffect: 'generated-artifacts', isolationRequired: true, deterministicOutputRequired: true, automaticallyRunnable: true };
  }
  if (/\b(?:migrate|migration|alembic upgrade|prisma migrate)\b/u.test(text)) {
    return { sideEffect: 'data-state', isolationRequired: true, deterministicOutputRequired: false, automaticallyRunnable: false };
  }
  if (/\b(?:build|compile)\b/u.test(text)) {
    return { sideEffect: 'build-artifacts', isolationRequired: false, deterministicOutputRequired: false, automaticallyRunnable: true };
  }
  return { sideEffect: 'none-or-test-output', isolationRequired: false, deterministicOutputRequired: false, automaticallyRunnable: true };
}

/**
 * @param {*} commands
 * @returns {*}
 */
export function annotateAcceptanceCommands(commands = []) {
  return commands.map((entry) => ({ ...entry, ...acceptanceCommandMetadata(entry.command) }));
}

const THEME_RULES = Object.freeze([
  { id: 'web-auth', title: 'Web authentication verification', pattern: /auth|login|session|playwright/u },
  { id: 'release-packaging', title: 'Release packaging reproducibility', pattern: /package|packaging|release|manifest|checksum|sha256/u },
  { id: 'database-migration', title: 'Database migration safety', pattern: /alembic|migrat|schema|database|\bdb\b/u },
  { id: 'security', title: 'Security hardening', pattern: /security|credential|secret|token|permission/u },
  { id: 'configuration', title: 'Configuration validation', pattern: /config|setting|environment/u },
  { id: 'regression', title: 'Regression coverage', pattern: /tests?|spec|verify|check/u },
  { id: 'documentation', title: 'Operational documentation', pattern: /docs?|readme|runbook|guide/u },
]);

function themeForPath(file) {
  const lower = file.toLowerCase();
  return THEME_RULES.find((rule) => rule.pattern.test(lower)) ?? { id: 'product', title: 'Product implementation' };
}

function buildWorkThemes(baseline) {
  const groups = new Map();
  for (const entry of baseline.entries ?? []) {
    if (!entry.blocking || !['PRODUCT', 'RELEASE_EVIDENCE'].includes(entry.category)) continue;
    for (const file of entry.paths ?? [entry.path]) {
      const theme = themeForPath(file);
      const current = groups.get(theme.id) ?? { id: `THEME-${theme.id.toUpperCase().replace(/[^A-Z0-9]+/gu, '-')}`, title: theme.title, paths: [], categories: new Set() };
      current.paths.push(file);
      current.categories.add(entry.category);
      groups.set(theme.id, current);
    }
  }
  const ranked = [...groups.values()].map((entry) => ({ ...entry, paths: [...new Set(entry.paths)].sort(), categories: [...entry.categories].sort() }))
    .sort((left, right) => right.paths.length - left.paths.length || left.title.localeCompare(right.title));
  if (ranked.length <= MAX_THEMES) return ranked;
  const kept = ranked.slice(0, MAX_THEMES - 1);
  const remainder = ranked.slice(MAX_THEMES - 1);
  kept.push({
    id: 'THEME-SUPPORTING-RELEASE-WORK',
    title: 'Supporting release regression work',
    paths: [...new Set(remainder.flatMap((entry) => entry.paths))].sort(),
    categories: [...new Set(remainder.flatMap((entry) => entry.categories))].sort(),
  });
  return kept;
}

function commandCoversPath(command, entry, file) {
  const cwd = normalized(command.cwd ?? '.');
  if (!within(file, cwd)) return false;
  if (command.supplemental || command.command === 'git diff --check') return false;
  const text = command.command.toLowerCase();
  if (command.aggregate) return true;
  if (/package|pack|release/u.test(text)) return entry.category === 'RELEASE_EVIDENCE' || /package|release|manifest|checksum|sha256/u.test(file.toLowerCase());
  if (/e2e|playwright|web-check/u.test(text)) return /apps?\/web|frontend|auth|login|playwright|tests?.*spec/u.test(file.toLowerCase());
  if (/test|pytest|jest|vitest/u.test(text)) return entry.category === 'PRODUCT' && !/docs?\//u.test(file.toLowerCase());
  if (/lint|typecheck|mypy|ruff|check|build|compile/u.test(text)) return entry.category === 'PRODUCT';
  return false;
}

function buildAcceptanceCoverage(baseline, commands) {
  const rows = [];
  for (const entry of baseline.entries ?? []) {
    if (!entry.blocking || !['PRODUCT', 'RELEASE_EVIDENCE'].includes(entry.category)) continue;
    for (const file of entry.paths ?? [entry.path]) {
      const coveredBy = commands.filter((command) => commandCoversPath(command, entry, file)).map((command) => command.id);
      rows.push({ path: file, category: entry.category, coveredBy, covered: coveredBy.length > 0 });
    }
  }
  const uncoveredPaths = rows.filter((row) => !row.covered).map((row) => row.path);
  return {
    schema: 'shipping-harness/acceptance-coverage-v1',
    complete: uncoveredPaths.length === 0,
    reason: rows.length === 0 ? 'NO_DIRTY_PRODUCT_PATHS' : uncoveredPaths.length === 0 ? 'ALL_DIRTY_PRODUCT_PATHS_COVERED' : 'UNCOVERED_PRODUCT_PATHS',
    totalPaths: rows.length,
    coveredPaths: rows.filter((row) => row.covered).length,
    uncoveredPaths,
    rows,
  };
}

function goalRecommendation(themes, analysis) {
  if (themes.length === 0) return null;
  const titles = themes.map((theme) => theme.title.toLowerCase());
  const work = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
  const version = analysis.versionEvidence?.recommendedVersion;
  return {
    authority: 'recommendation-only',
    text: `Complete ${work} while preserving behavior outside the changed areas${version ? `, then verify the ${version} release` : ''}.`,
    evidenceThemeIds: themes.map((theme) => theme.id),
    explicitUserGoalWins: true,
  };
}

/**
 * Build bounded project intelligence from tracked path evidence and the current
 * classified baseline. Repository prose never becomes policy or authority.
 */
export function buildProjectIntelligence(root, analysis, baseline, explicitGoal) {
  const files = trackedFiles(root);
  const commands = annotateAcceptanceCommands(analysis.candidateCommands ?? []);
  const componentGraph = buildComponentGraph(files, analysis);
  const workThemes = buildWorkThemes(baseline);
  const acceptanceCoverage = buildAcceptanceCoverage(baseline, commands);
  const recommendation = goalRecommendation(workThemes, analysis);
  const result = {
    schema: 'shipping-harness/project-intelligence-v1',
    explicitGoal,
    componentGraph,
    workThemes,
    goalRecommendation: recommendation,
    acceptanceCoverage,
    acceptanceCommands: commands,
  };
  return { ...result, hash: hashObject(result) };
}

/**
 * @param {*} proposal
 * @returns {*}
 */
export function buildOneScreenApproval(proposal) {
  const brief = proposal.approvalBrief ?? {};
  const intelligence = proposal.intelligence ?? proposal.analysis?.intelligence ?? null;
  const card = {
    schema: 'shipping-harness/one-screen-approval-v1',
    release: proposal.release,
    state: proposal.canonicalState,
    goal: proposal.goal,
    recommendedGoal: intelligence?.goalRecommendation?.text ?? null,
    recommendationIsAuthority: false,
    included: (brief.included ?? []).slice(0, 5),
    excluded: (brief.deferred ?? []).slice(0, 5),
    checks: (proposal.contract?.acceptance ?? []).slice(0, 8).map((entry) => ({
      id: entry.id,
      command: entry.command,
      cwd: entry.cwd ?? '.',
      sideEffect: entry.sideEffect ?? acceptanceCommandMetadata(entry.command).sideEffect,
      isolated: entry.isolationRequired === true,
    })),
    workThemes: (intelligence?.workThemes ?? []).slice(0, MAX_THEMES).map((entry) => ({ id: entry.id, title: entry.title, pathCount: entry.paths.length })),
    coverage: intelligence?.acceptanceCoverage ? {
      complete: intelligence.acceptanceCoverage.complete,
      coveredPaths: intelligence.acceptanceCoverage.coveredPaths,
      totalPaths: intelligence.acceptanceCoverage.totalPaths,
      uncoveredPaths: intelligence.acceptanceCoverage.uncoveredPaths.slice(0, 10),
    } : null,
    readyForApproval: proposal.canonicalState === 'READY_FOR_APPROVAL',
    detailsAvailable: true,
  };
  return { ...card, boundedBytes: Buffer.byteLength(JSON.stringify(card)) };
}
