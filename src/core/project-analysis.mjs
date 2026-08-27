import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertContainedPath, exists, fileSize } from './fs.mjs';
import { runGit } from './git.mjs';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TRACKED_FILES = 10000;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts',
  '.mjs', '.cjs', '.php', '.py', '.rb', '.rs', '.sh', '.swift', '.svelte', '.ts', '.tsx', '.vue',
]);
const IGNORED_ROOTS = new Set([
  '.git', '.shipping', 'build', 'coverage', 'dist', 'node_modules', 'target', 'vendor', '.venv', 'venv',
]);
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;

/** @param {string} root @param {string} relativePath */
async function boundedText(root, relativePath) {
  const target = path.join(root, relativePath);
  if (!(await exists(target))) return null;
  await assertContainedPath(root, target);
  if ((await fileSize(target)) > MAX_MANIFEST_BYTES) return null;
  return readFile(target, 'utf8');
}

/** @param {string} root */
function trackedFiles(root) {
  const result = runGit(root, ['ls-files', '-z'], { allowFailure: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.exitCode !== 0) return [];
  return result.stdout.split('\0').filter(Boolean).slice(0, MAX_TRACKED_FILES);
}

/** @param {string[]} files */
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

/** @param {Record<string, any>} scripts @param {string} manager */
function nodeCommands(scripts, manager) {
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
  return selected.map((name) => ({
    id: `node-${name}`,
    description: `Existing package script '${name}' passes.`,
    command: commandFor(name),
    source: 'package.json',
    confidence: 'high',
  }));
}

/** @param {string | null} text */
function makeTargets(text) {
  if (!text) return [];
  const targets = new Set();
  for (const match of text.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?![=])/gmu)) targets.add(match[1]);
  return ['lint', 'typecheck', 'check', 'build', 'test']
    .filter((target) => targets.has(target))
    .map((target) => ({
      id: `make-${target}`,
      description: `Existing Make target '${target}' passes.`,
      command: `make ${target}`,
      source: 'Makefile',
      confidence: 'medium',
    }));
}

/** @param {string} root */
async function topLevelNames(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => !IGNORED_ROOTS.has(entry.name))
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  } catch {
    return [];
  }
}

/**
 * Read bounded repository-owned metadata without executing project code.
 * @param {string} root
 */
export async function analyzeRepository(root) {
  const files = trackedFiles(root);
  const topLevel = await topLevelNames(root);
  const packageText = await boundedText(root, 'package.json');
  const pyproject = await boundedText(root, 'pyproject.toml');
  const cargo = await boundedText(root, 'Cargo.toml');
  const goMod = await boundedText(root, 'go.mod');
  const makefile = await boundedText(root, 'Makefile');
  const readmeName = ['README.md', 'README.rst', 'README.txt', 'README']
    .find((candidate) => topLevel.some((entry) => entry.name === candidate)) ?? null;

  const types = [];
  const manifests = [];
  const diagnostics = [];
  const commands = [];
  let projectName = path.basename(root);

  if (packageText) {
    manifests.push('package.json');
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
      if (topLevel.some((entry) => entry.name === lock)) manifests.push(lock);
    }
    types.push('node');
    try {
      const packageJson = JSON.parse(packageText);
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) projectName = packageJson.name.trim();
      const manager = topLevel.some((entry) => entry.name === 'pnpm-lock.yaml')
        ? 'pnpm'
        : topLevel.some((entry) => entry.name === 'yarn.lock')
          ? 'yarn'
          : topLevel.some((entry) => entry.name === 'bun.lock' || entry.name === 'bun.lockb')
            ? 'bun'
            : 'npm';
      commands.push(...nodeCommands(packageJson.scripts ?? {}, manager));
    } catch (error) {
      diagnostics.push(`package.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (pyproject) {
    manifests.push('pyproject.toml');
    types.push('python');
    if (/\[tool\.ruff\]|\bruff\b/u.test(pyproject)) commands.push({ id: 'python-ruff', description: 'Configured Ruff checks pass.', command: 'python -m ruff check .', source: 'pyproject.toml', confidence: 'medium' });
    if (/\[tool\.mypy\]|\bmypy\b/u.test(pyproject)) commands.push({ id: 'python-mypy', description: 'Configured mypy checks pass.', command: 'python -m mypy .', source: 'pyproject.toml', confidence: 'medium' });
    if (/\[tool\.pytest\]|pytest/u.test(pyproject) || files.some((file) => file.startsWith('tests/'))) commands.push({ id: 'python-pytest', description: 'Python tests pass.', command: 'python -m pytest', source: 'pyproject.toml', confidence: 'medium' });
  }
  if (cargo) {
    manifests.push('Cargo.toml');
    types.push('rust');
    commands.push(
      { id: 'rust-check', description: 'Rust project type-checks.', command: 'cargo check', source: 'Cargo.toml', confidence: 'high' },
      { id: 'rust-test', description: 'Rust tests pass.', command: 'cargo test', source: 'Cargo.toml', confidence: 'high' },
    );
  }
  if (goMod) {
    manifests.push('go.mod');
    types.push('go');
    commands.push({ id: 'go-test', description: 'Go tests pass.', command: 'go test ./...', source: 'go.mod', confidence: 'high' });
  }
  if (makefile) {
    manifests.push('Makefile');
    if (commands.length === 0) commands.push(...makeTargets(makefile));
  }
  if (readmeName) manifests.push(readmeName);

  const uniqueCommands = [...new Map(commands.map((entry) => [entry.command, entry])).values()].slice(0, 6);
  if (uniqueCommands.length === 0) {
    uniqueCommands.push({
      id: 'git-diff-check',
      description: 'Git reports no whitespace or conflict-marker errors.',
      command: 'git diff --check',
      source: 'shipping-harness-fallback',
      confidence: 'low',
    });
    diagnostics.push('No existing build or test command was detected; the fallback gate is weak and should be reviewed before approval.');
  }

  return {
    schema: 'shipping-harness/repository-analysis-v1',
    projectName,
    types: [...new Set(types)],
    manifests: [...new Set(manifests)],
    sourceRoots: detectSourceRoots(files),
    trackedFileCount: files.length,
    trackedFileCountTruncated: files.length >= MAX_TRACKED_FILES,
    topLevel,
    candidateCommands: uniqueCommands,
    readme: readmeName,
    diagnostics,
  };
}

/** @param {Record<string, any>} analysis @param {string} goal */
export function buildMinimalScope(analysis, goal) {
  const includePaths = new Set([
    ...analysis.sourceRoots.map((root) => `${root}/**`),
    ...analysis.manifests,
    'README.md', 'README.rst', 'README.txt',
  ]);
  if (analysis.sourceRoots.length === 0) {
    for (const entry of analysis.topLevel) {
      if (entry.type === 'directory' && !entry.name.startsWith('.') && SAFE_PATH_SEGMENT.test(entry.name)) includePaths.add(`${entry.name}/**`);
    }
    for (const extension of SOURCE_EXTENSIONS) includePaths.add(`*${extension}`);
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

/** @param {Record<string, any>} analysis */
export function buildAcceptanceCriteria(analysis) {
  return analysis.candidateCommands.map((candidate, index) => ({
    id: `AC-${String(index + 1).padStart(3, '0')}`,
    description: candidate.description,
    type: 'command',
    command: candidate.command,
    cwd: '.',
    required: true,
    timeoutSeconds: candidate.command.includes('test') ? 600 : 300,
  }));
}

/** @param {Record<string, any>} analysis @param {Array<Record<string, any>>} acceptance */
export function buildShortPlan(analysis, acceptance) {
  return [
    { id: 'PLAN-001', title: 'Confirm the smallest release', detail: 'Review the detected project facts, included behavior, exclusions, and acceptance commands before approval.', acceptance: [] },
    { id: 'PLAN-002', title: 'Implement only the approved goal', detail: `Change only approved paths for the detected ${analysis.types.join(', ') || 'unknown'} project.`, acceptance: [] },
    { id: 'PLAN-003', title: 'Produce current evidence', detail: 'Run the approved acceptance checks against the current Git revision.', acceptance: acceptance.map((criterion) => criterion.id) },
    { id: 'PLAN-004', title: 'Close or stop', detail: 'Fix release blockers within budget, move optional improvements to backlog, and close when all required gates pass.', acceptance: acceptance.map((criterion) => criterion.id) },
  ];
}