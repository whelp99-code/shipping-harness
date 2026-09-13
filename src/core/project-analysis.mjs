import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashObject } from './crypto.mjs';
import { assertContainedPath, exists, fileSize } from './fs.mjs';
import { runGit } from './git.mjs';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TRACKED_FILES = 10000;
const MAX_WORKSPACE_CANDIDATES = 40;
const MAX_WORKSPACE_DEPTH = 4;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts',
  '.mjs', '.cjs', '.php', '.py', '.rb', '.rs', '.sh', '.swift', '.svelte', '.ts', '.tsx', '.vue',
]);
const IGNORED_ROOTS = new Set([
  '.git', '.shipping', 'build', 'coverage', 'dist', 'node_modules', 'target', 'vendor', '.venv', 'venv',
]);
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;
const WORKSPACE_MARKERS = new Set([
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Makefile', 'makefile', 'GNUmakefile',
  'Taskfile.yml', 'Taskfile.yaml', 'justfile', 'docker-compose.yml', 'compose.yml', 'RELEASE_MANIFEST.json',
]);
const MAKE_TARGET_PRIORITY = Object.freeze([
  'verify', 'package', 'release-check', 'smoke', 'e2e', 'integration', 'web-check',
  'check', 'test', 'build', 'lint', 'typecheck',
]);
const AGGREGATE_MAKE_TARGETS = new Set(['verify', 'release-check', 'check']);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

function normalizedPath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  return normalized || '.';
}

function safeWorkspaceRoot(candidate) {
  const normalized = normalizedPath(candidate);
  if (normalized === '.') return true;
  const segments = normalized.split('/');
  return segments.length <= MAX_WORKSPACE_DEPTH
    && segments.every((segment) => SAFE_PATH_SEGMENT.test(segment) && !IGNORED_ROOTS.has(segment));
}

function workspacePath(workspaceRoot, relative) {
  return workspaceRoot === '.' ? relative : `${workspaceRoot}/${relative}`;
}

async function boundedText(root, relativePath) {
  const target = path.join(root, relativePath);
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  if ((await fileSize(target)) > MAX_MANIFEST_BYTES) return null;
  return readFile(target, 'utf8');
}

function trackedFiles(root) {
  const result = runGit(root, ['ls-files', '-z'], { allowFailure: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.exitCode !== 0) return [];
  return result.stdout.split('\0').filter(Boolean).slice(0, MAX_TRACKED_FILES).map((entry) => entry.replaceAll('\\', '/'));
}

function filesInWorkspace(files, workspaceRoot) {
  if (workspaceRoot === '.') return files;
  const prefix = `${workspaceRoot}/`;
  return files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
}

function detectSourceRoots(files) {
  const roots = new Set();
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (segments.length < 2 || IGNORED_ROOTS.has(segments[0]) || !SAFE_PATH_SEGMENT.test(segments[0])) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) roots.add(segments[0]);
  }
  for (const conventional of ['src', 'app', 'apps', 'lib', 'packages', 'test', 'tests', 'scripts', 'docs']) {
    if (files.some((file) => file === conventional || file.startsWith(`${conventional}/`))) roots.add(conventional);
  }
  return [...roots].sort().slice(0, 24);
}

function nodeCommands(scripts, manager, cwd) {
  const commandFor = (name) => {
    if (manager === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
    if (manager === 'yarn') return `yarn ${name}`;
    if (manager === 'pnpm') return `pnpm ${name}`;
    if (manager === 'bun') return `bun run ${name}`;
    return `npm run ${name}`;
  };
  const preferred = ['lint', 'typecheck', 'build', 'test'];
  const selected = preferred.filter((name) => {
    const script = scripts[name];
    if (typeof script !== 'string' || !script.trim()) return false;
    if (name === 'test' && /no test specified|exit\s+1\b/iu.test(script)) return false;
    return true;
  });
  if (selected.length === 0 && typeof scripts.check === 'string' && scripts.check.trim()) selected.push('check');
  if (typeof scripts.verify === 'string' && scripts.verify.trim()) selected.unshift('verify');
  if (typeof scripts.package === 'string' && scripts.package.trim()) selected.push('package');
  return [...new Set(selected)].slice(0, 6).map((name) => ({
    id: `node-${name}`,
    description: `Existing package script '${name}' passes.`,
    command: commandFor(name),
    cwd,
    source: workspacePath(cwd, 'package.json'),
    confidence: 'high',
    aggregate: name === 'verify' || name === 'check',
  }));
}

function makeTargets(text, cwd, source = 'Makefile') {
  if (!text) return [];
  const targets = new Set();
  for (const match of text.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?![=])/gmu)) targets.add(match[1]);
  const selected = MAKE_TARGET_PRIORITY.filter((target) => targets.has(target));
  const hasAggregate = selected.some((target) => AGGREGATE_MAKE_TARGETS.has(target));
  const filtered = hasAggregate
    ? selected.filter((target) => AGGREGATE_MAKE_TARGETS.has(target) || target === 'package')
    : selected;
  return filtered.slice(0, 6).map((target) => ({
    id: `make-${target}`,
    description: `Existing Make target '${target}' passes.`,
    command: `make ${target}`,
    cwd,
    source: workspacePath(cwd, source),
    confidence: target === 'verify' || target === 'package' ? 'high' : 'medium',
    aggregate: AGGREGATE_MAKE_TARGETS.has(target),
  }));
}

function namedTaskTargets(text, cwd, source) {
  if (!text) return [];
  const targets = new Set();
  const pattern = source.startsWith('Taskfile')
    ? /^\s{2}([A-Za-z0-9_.-]+):\s*$/gmu
    : /^([A-Za-z0-9_.-]+)\s*:(?![=])/gmu;
  for (const match of text.matchAll(pattern)) targets.add(match[1]);
  const commandPrefix = source.startsWith('Taskfile') ? 'task' : 'just';
  const selected = MAKE_TARGET_PRIORITY.filter((target) => targets.has(target));
  const hasAggregate = selected.some((target) => AGGREGATE_MAKE_TARGETS.has(target));
  return (hasAggregate ? selected.filter((target) => AGGREGATE_MAKE_TARGETS.has(target) || target === 'package') : selected)
    .slice(0, 6)
    .map((target) => ({
      id: `${commandPrefix}-${target}`,
      description: `Existing ${source} target '${target}' passes.`,
      command: `${commandPrefix} ${target}`,
      cwd,
      source: workspacePath(cwd, source),
      confidence: target === 'verify' || target === 'package' ? 'high' : 'medium',
      aggregate: AGGREGATE_MAKE_TARGETS.has(target),
    }));
}

async function workspaceTopLevel(root, workspaceRoot) {
  const target = workspaceRoot === '.' ? root : path.join(root, workspaceRoot);
  await assertContainedPath(root, target);
  try {
    return (await readdir(target, { withFileTypes: true }))
      .filter((entry) => !IGNORED_ROOTS.has(entry.name))
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  } catch {
    // Best-effort listing for the human-readable analysis; an unreadable directory yields an empty list, not a failed scan.
    return [];
  }
}

function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^v/u, '');
  const match = SEMVER.exec(normalized);
  if (!match) return null;
  return { value: normalized, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

function compareParsedVersions(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function bumpVersion(base, kind) {
  if (!base) return '0.1.0';
  if (kind === 'major') return `${base.major + 1}.0.0`;
  if (kind === 'minor') return `${base.major}.${base.minor + 1}.0`;
  return `${base.major}.${base.minor}.${base.patch + 1}`;
}

function changeKind(goal) {
  if (/\b(breaking|incompatible|remove public|drop support|major version)\b/iu.test(goal)) return 'major';
  if (/\b(add|new feature|introduce|support new|user-visible feature|minor version)\b/iu.test(goal)) return 'minor';
  return 'patch';
}

function pyprojectVersion(text) {
  if (!text) return null;
  return /^\s*version\s*=\s*["']([^"']+)["']/mu.exec(text)?.[1] ?? null;
}

function versionFromReleaseManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value;
  for (const candidate of [record.version, record.release, record.productVersion, record.runtime?.version]) {
    if (parseSemver(candidate)) return String(candidate).replace(/^v/u, '');
  }
  return null;
}

function buildVersionEvidence(root, goal, candidates) {
  const evidence = candidates.flatMap((candidate) => candidate.versions ?? []);
  const tags = runGit(root, ['tag', '--list'], { allowFailure: true, maxBuffer: 1024 * 1024 });
  if (tags.exitCode === 0) {
    for (const tag of tags.stdout.split(/\r?\n/u).filter(Boolean)) {
      const parsed = parseSemver(tag);
      if (parsed) evidence.push({ source: 'git-tag', path: null, version: parsed.value, confidence: 'medium', priority: 70 });
    }
  }
  const parsed = evidence
    .map((entry) => ({ entry, parsed: parseSemver(entry.version) }))
    .filter((item) => item.parsed)
    .sort((left, right) => right.entry.priority - left.entry.priority || compareParsedVersions(right.parsed, left.parsed));
  const base = parsed[0]?.parsed ?? null;
  const kind = changeKind(goal);
  return {
    schema: 'shipping-harness/version-evidence-v1',
    baseVersion: base?.value ?? null,
    changeKind: kind,
    recommendedVersion: bumpVersion(base, kind),
    confidence: parsed[0]?.entry?.confidence ?? 'low',
    evidence: parsed.slice(0, 20).map(({ entry }) => ({
      source: entry.source,
      path: entry.path,
      version: entry.version,
      confidence: entry.confidence,
    })),
    explicitVersionWins: true,
  };
}

async function inspectWorkspace(root, workspaceRoot, allFiles) {
  const files = filesInWorkspace(allFiles, workspaceRoot);
  const topLevel = await workspaceTopLevel(root, workspaceRoot);
  const has = (name) => topLevel.some((entry) => entry.name === name);
  const read = (name) => boundedText(root, workspacePath(workspaceRoot, name));
  const makeName = has('Makefile') ? 'Makefile' : has('GNUmakefile') ? 'GNUmakefile' : has('makefile') ? 'makefile' : null;
  const [packageText, pyproject, cargo, goMod, makefile, taskfileYml, taskfileYaml, justfile, releaseText] = await Promise.all([
    read('package.json'), read('pyproject.toml'), read('Cargo.toml'), read('go.mod'),
    makeName ? read(makeName) : null,
    read('Taskfile.yml'), read('Taskfile.yaml'), read('justfile'), read('RELEASE_MANIFEST.json'),
  ]);
  const readmeName = ['README.md', 'README.rst', 'README.txt', 'README'].find(has) ?? null;
  const types = [];
  const manifests = [];
  const commands = [];
  const diagnostics = [];
  const versions = [];
  const sourceRootsRelative = detectSourceRoots(files);
  let projectName = workspaceRoot === '.' ? path.basename(root) : path.basename(workspaceRoot);

  if (packageText) {
    manifests.push('package.json');
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) if (has(lock)) manifests.push(lock);
    types.push('node');
    try {
      const packageJson = JSON.parse(packageText);
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) projectName = packageJson.name.trim();
      if (parseSemver(packageJson.version)) versions.push({ source: 'package-manifest', path: workspacePath(workspaceRoot, 'package.json'), version: packageJson.version, confidence: 'high', priority: 90 });
      const manager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lock') || has('bun.lockb') ? 'bun' : 'npm';
      commands.push(...nodeCommands(packageJson.scripts ?? {}, manager, workspaceRoot));
    } catch (error) {
      diagnostics.push(`package.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (pyproject) {
    manifests.push('pyproject.toml');
    types.push('python');
    const version = pyprojectVersion(pyproject);
    if (version && parseSemver(version)) versions.push({ source: 'pyproject', path: workspacePath(workspaceRoot, 'pyproject.toml'), version, confidence: 'high', priority: 90 });
    if (/\[tool\.ruff\]|\bruff\b/u.test(pyproject)) commands.push({ id: 'python-ruff', description: 'Configured Ruff checks pass.', command: 'python -m ruff check .', cwd: workspaceRoot, source: workspacePath(workspaceRoot, 'pyproject.toml'), confidence: 'medium', aggregate: false });
    if (/\[tool\.mypy\]|\bmypy\b/u.test(pyproject)) commands.push({ id: 'python-mypy', description: 'Configured mypy checks pass.', command: 'python -m mypy .', cwd: workspaceRoot, source: workspacePath(workspaceRoot, 'pyproject.toml'), confidence: 'medium', aggregate: false });
    if (/\[tool\.pytest\]|pytest/u.test(pyproject) || files.some((file) => file.startsWith('tests/'))) commands.push({ id: 'python-pytest', description: 'Python tests pass.', command: 'python -m pytest', cwd: workspaceRoot, source: workspacePath(workspaceRoot, 'pyproject.toml'), confidence: 'medium', aggregate: false });
  }
  if (cargo) {
    manifests.push('Cargo.toml'); types.push('rust');
    commands.push(
      { id: 'rust-check', description: 'Rust project type-checks.', command: 'cargo check', cwd: workspaceRoot, source: workspacePath(workspaceRoot, 'Cargo.toml'), confidence: 'high', aggregate: false },
      { id: 'rust-test', description: 'Rust tests pass.', command: 'cargo test', cwd: workspaceRoot, source: workspacePath(workspaceRoot, 'Cargo.toml'), confidence: 'high', aggregate: false },
    );
  }
  if (goMod) {
    manifests.push('go.mod'); types.push('go');
    commands.push({ id: 'go-test', description: 'Go tests pass.', command: 'go test ./...', cwd: workspaceRoot, source: workspacePath(workspaceRoot, 'go.mod'), confidence: 'high', aggregate: false });
  }
  if (makefile && makeName) {
    manifests.push(makeName);
    const extracted = makeTargets(makefile, workspaceRoot, makeName);
    if (extracted.length > 0) {
      const hasAggregate = extracted.some((entry) => entry.aggregate);
      if (commands.length === 0 || hasAggregate) commands.splice(0, commands.length, ...extracted);
      else commands.push(...extracted);
    }
  }
  const taskName = taskfileYml ? 'Taskfile.yml' : taskfileYaml ? 'Taskfile.yaml' : null;
  const taskText = taskfileYml ?? taskfileYaml;
  if (taskText && taskName) { manifests.push(taskName); commands.push(...namedTaskTargets(taskText, workspaceRoot, taskName)); }
  if (justfile) { manifests.push('justfile'); commands.push(...namedTaskTargets(justfile, workspaceRoot, 'justfile')); }
  if (releaseText) {
    manifests.push('RELEASE_MANIFEST.json');
    try {
      const releaseManifest = JSON.parse(releaseText);
      const version = versionFromReleaseManifest(releaseManifest);
      if (version) versions.push({ source: 'release-manifest', path: workspacePath(workspaceRoot, 'RELEASE_MANIFEST.json'), version, confidence: 'high', priority: 100 });
    } catch (error) {
      diagnostics.push(`RELEASE_MANIFEST.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (readmeName) manifests.push(readmeName);
  const nameVersion = parseSemver(path.basename(workspaceRoot).match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u)?.[1] ?? null);
  if (nameVersion) versions.push({ source: 'workspace-name', path: workspaceRoot, version: nameVersion.value, confidence: 'low', priority: 20 });

  const uniqueCommands = [...new Map(commands.map((entry) => [`${entry.cwd}\0${entry.command}`, entry])).values()].slice(0, 8);
  const sourceFileCount = files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())).length;
  const hasTests = sourceRootsRelative.includes('test') || sourceRootsRelative.includes('tests');
  let score = 0;
  score += types.length * 5;
  if (makeName || taskName || justfile) score += 4;
  if (releaseText) score += 4;
  if (sourceFileCount > 0) score += 3;
  if (hasTests) score += 2;
  if (uniqueCommands.length > 0) score += 2;
  if (uniqueCommands.some((entry) => entry.aggregate)) score += 4;
  if (readmeName) score += 1;
  score += Math.min(3, Math.floor(files.length / 20));

  return {
    id: `WS-${hashObject({ root: workspaceRoot }).slice(0, 12)}`,
    root: workspaceRoot,
    projectName,
    score,
    types: [...new Set(types)],
    manifests: [...new Set(manifests)].map((entry) => workspacePath(workspaceRoot, entry)),
    sourceRoots: sourceRootsRelative.map((entry) => workspacePath(workspaceRoot, entry)),
    sourceFileCount,
    trackedFileCount: files.length,
    hasTests,
    candidateCommands: uniqueCommands,
    versions,
    readme: readmeName ? workspacePath(workspaceRoot, readmeName) : null,
    diagnostics,
  };
}

function workspaceRoots(files) {
  const roots = new Set(['.']);
  for (const file of files) {
    if (!WORKSPACE_MARKERS.has(path.posix.basename(file))) continue;
    const root = normalizedPath(path.posix.dirname(file));
    if (safeWorkspaceRoot(root)) roots.add(root);
    if (roots.size >= MAX_WORKSPACE_CANDIDATES) break;
  }
  return [...roots];
}

function selectWorkspace(candidates, requestedId) {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || b.trackedFileCount - a.trackedFileCount || a.root.localeCompare(b.root));
  let selected = requestedId ? ranked.find((entry) => entry.id === requestedId) : ranked[0];
  if (requestedId && !selected) throw Object.assign(new Error(`Unknown workspace candidate: ${requestedId}`), { code: 'ERR_WORKSPACE_CANDIDATE' });
  selected ??= ranked[0];
  const second = ranked.find((entry) => entry.id !== selected.id) ?? null;
  const gap = second ? selected.score - second.score : selected.score;
  const tied = Boolean(second && selected.score === second.score && selected.score > 0);
  const confidence = selected.score >= 10 && gap >= 4 ? 'high' : selected.score >= 5 && gap >= 2 ? 'medium' : 'low';
  return {
    selected,
    confidence,
    ambiguous: tied && !requestedId,
    alternatives: ranked.filter((entry) => entry.id !== selected.id).slice(0, 5),
    requested: Boolean(requestedId),
  };
}

/**
 * @typedef {{id: string, description: string, command: string, cwd?: string, source?: string, confidence?: string, aggregate?: boolean, supplemental?: boolean, sideEffect?: string, isolationRequired?: boolean, deterministicOutputRequired?: boolean, automaticallyRunnable?: boolean}} CandidateCommand
 * @typedef {{name: string, type: string}} TopLevelEntry
 * @typedef {{schema: string, projectName: string, types: string[], manifests: string[], sourceRoots: string[], trackedFileCount: number, trackedFileCountTruncated: boolean, topLevel: TopLevelEntry[], candidateCommands: CandidateCommand[], readme: string|null, diagnostics: string[], workspace: {id: string, root: string, score: number, confidence: string, ambiguous: boolean, requested: boolean}, workspaceCandidates: Array<{id: string, root: string, projectName: string, score: number, types: string[], manifests: string[], commandCount: number, trackedFileCount: number}>, versionEvidence: Record<string, any>, intelligence?: Record<string, any>}} ProjectAnalysis
 * @typedef {{id: string, description: string, type: string, command: string, cwd: string, required: boolean, timeoutSeconds: number, sideEffect: string, isolationRequired: boolean, deterministicOutputRequired: boolean, automaticallyRunnable: boolean}} AcceptanceCriterion
 */

/**
 * @param {string} root
 * @param {{workspaceCandidateId?: string|null, goal?: string}} [options]
 * @returns {Promise<ProjectAnalysis>}
 */
export async function analyzeRepository(root, options = {}) {
  const files = trackedFiles(root);
  const roots = workspaceRoots(files);
  const inspected = [];
  for (const workspaceRoot of roots) inspected.push(await inspectWorkspace(root, workspaceRoot, files));
  const selection = selectWorkspace(inspected, options.workspaceCandidateId);
  const selected = selection.selected;
  const rootTopLevel = await workspaceTopLevel(root, '.');
  const diagnostics = [...selected.diagnostics];
  let commands = selected.candidateCommands;
  if (commands.length === 0) {
    commands = [{
      id: 'git-diff-check',
      description: 'Git reports no whitespace or conflict-marker errors.',
      command: 'git diff --check',
      cwd: '.',
      source: 'shipping-harness-fallback',
      confidence: 'low',
      aggregate: false,
      supplemental: true,
    }];
    diagnostics.push('No existing build or test command was detected; the fallback gate is weak and should be reviewed before approval.');
  } else if (selected.root !== '.' && !commands.some((entry) => entry.command === 'git diff --check' && entry.cwd === '.')) {
    commands = [...commands, {
      id: 'git-diff-check',
      description: 'Repository-root Git reports no whitespace or conflict-marker errors.',
      command: 'git diff --check',
      cwd: '.',
      source: 'shipping-harness-supplemental',
      confidence: 'high',
      aggregate: false,
      supplemental: true,
    }].slice(0, 8);
  }
  if (selection.ambiguous) diagnostics.push('Multiple product workspaces have equal mechanical scores; one grouped workspace choice is required.');
  const versionEvidence = buildVersionEvidence(root, options.goal ?? '', inspected);
  return {
    schema: 'shipping-harness/project-analysis-v2',
    projectName: selected.projectName,
    types: selected.types,
    manifests: selected.manifests,
    sourceRoots: selected.sourceRoots,
    trackedFileCount: files.length,
    trackedFileCountTruncated: files.length >= MAX_TRACKED_FILES,
    topLevel: rootTopLevel,
    candidateCommands: commands,
    readme: selected.readme,
    diagnostics,
    workspace: {
      id: selected.id,
      root: selected.root,
      score: selected.score,
      confidence: selection.confidence,
      ambiguous: selection.ambiguous,
      requested: selection.requested,
    },
    workspaceCandidates: [selected, ...selection.alternatives].map((entry) => ({
      id: entry.id,
      root: entry.root,
      projectName: entry.projectName,
      score: entry.score,
      types: entry.types,
      manifests: entry.manifests,
      commandCount: entry.candidateCommands.length,
      trackedFileCount: entry.trackedFileCount,
    })),
    versionEvidence,
  };
}

/**
 * @param {ProjectAnalysis} analysis
 * @param {string} goal
 * @returns {{include: string[], exclude: string[], paths: {include: string[], exclude: string[]}}}
 */
export function buildMinimalScope(analysis, goal) {
  const includePaths = new Set([
    ...analysis.sourceRoots.map((root) => `${root}/**`),
    ...analysis.manifests,
    'README.md', 'README.rst', 'README.txt',
  ]);
  if (analysis.workspace?.root && analysis.workspace.root !== '.') includePaths.add(`${analysis.workspace.root}/**`);
  if (analysis.sourceRoots.length === 0) {
    const prefix = analysis.workspace?.root && analysis.workspace.root !== '.' ? `${analysis.workspace.root}/` : '';
    for (const entry of analysis.topLevel) {
      if (entry.type === 'directory' && !entry.name.startsWith('.') && SAFE_PATH_SEGMENT.test(entry.name)) includePaths.add(`${prefix}${entry.name}/**`);
    }
    for (const extension of SOURCE_EXTENSIONS) includePaths.add(`${prefix}*${extension}`);
  }
  return {
    include: [
      `Deliver the stated release goal: ${goal.trim()}`,
      'Preserve existing behavior outside the stated goal.',
      'Make every required acceptance check pass and document how to run the shipped result.',
    ],
    exclude: [
      'Unrequested web, mobile, cloud, multi-user, and deployment features.',
      'Speculative architecture rewrites and refactors not required by a failing acceptance criterion.',
      'Optional polish, additional integrations, and future extensibility work.',
    ],
    paths: {
      include: [...includePaths].filter(Boolean).sort(),
      exclude: ['.shipping/contract.yaml', '.shipping/contract.lock', '.git/**', 'node_modules/**', 'dist/**', 'coverage/**', 'target/**'],
    },
  };
}

/**
 * @param {ProjectAnalysis} analysis
 * @returns {AcceptanceCriterion[]}
 */
export function buildAcceptanceCriteria(analysis) {
  return analysis.candidateCommands.map((candidate, index) => ({
    id: `AC-${String(index + 1).padStart(3, '0')}`,
    description: candidate.description,
    type: 'command',
    command: candidate.command,
    cwd: candidate.cwd ?? '.',
    required: true,
    timeoutSeconds: /test|verify|e2e|integration/u.test(candidate.command) ? 600 : 300,
    sideEffect: candidate.sideEffect ?? 'none-or-test-output',
    isolationRequired: candidate.isolationRequired === true,
    deterministicOutputRequired: candidate.deterministicOutputRequired === true,
    automaticallyRunnable: candidate.automaticallyRunnable !== false,
  }));
}

/**
 * @param {ProjectAnalysis} analysis
 * @param {Array<{id: string}>} acceptance
 * @returns {Array<{id: string, title: string, detail: string, acceptance: string[]}>}
 */
export function buildShortPlan(analysis, acceptance) {
  return [
    { id: 'PLAN-001', title: 'Confirm the smallest release', detail: `Review workspace ${analysis.workspace?.root ?? '.'}, detected facts, exclusions, version evidence, and acceptance commands before approval.`, acceptance: [] },
    { id: 'PLAN-002', title: 'Implement only the approved goal', detail: `Change only approved paths for the detected ${analysis.types.join(', ') || 'unknown'} project.`, acceptance: [] },
    { id: 'PLAN-003', title: 'Produce current evidence', detail: 'Run the approved cwd-bound acceptance checks against the current Git revision.', acceptance: acceptance.map((criterion) => criterion.id) },
    { id: 'PLAN-004', title: 'Close or stop', detail: 'Fix release blockers within budget, move optional improvements to backlog, and close when all required gates pass.', acceptance: acceptance.map((criterion) => criterion.id) },
  ];
}
