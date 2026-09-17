// v1.13.0 Phase C: the goal sentence is read for the paths it names, so a file in a
// directory the baseline does not have yet is inside the approved scope instead of being
// blocked as scope drift on the first verify.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GOAL_PATHS,
  extractGoalPaths,
  goalPathDiagnostics,
  scopePathsForGoal,
} from '../../src/core/goal-paths.mjs';

const SCOPE = Object.freeze({
  include: ['README.md', 'package.json', 'test/**'],
  exclude: ['.shipping/contract.yaml', '.git/**', 'node_modules/**', 'dist/**', 'coverage/**'],
});

test('a goal naming a nested file adds that file\'s directory as a glob', () => {
  const result = scopePathsForGoal('Implement hello() in a new file src/index.mjs so the existing test suite passes', SCOPE);
  assert.deepEqual(result.added, [{ glob: 'src/**', token: 'src/index.mjs' }]);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(goalPathDiagnostics(result), ['GOAL_PATH_ADDED: src/** (goal named "src/index.mjs")']);
});

test('a deeply nested file adds only its own parent directory, not the whole tree', () => {
  const result = scopePathsForGoal('Add the parser in src/core/parsers/json.mjs', SCOPE);
  assert.deepEqual(result.added.map((entry) => entry.glob), ['src/core/parsers/**']);
});

test('a file at the repository root adds only that file', () => {
  const result = scopePathsForGoal('Rewrite CHANGELOG.md for this release', SCOPE);
  assert.deepEqual(result.added, [{ glob: 'CHANGELOG.md', token: 'CHANGELOG.md' }]);
});

test('a trailing slash names a directory and adds that directory', () => {
  const result = scopePathsForGoal('Put everything new under lib/adapters/ for now', SCOPE);
  assert.deepEqual(result.added.map((entry) => entry.glob), ['lib/adapters/**']);
});

test('a path already covered by the derived include adds nothing and refuses nothing', () => {
  const result = scopePathsForGoal('Update test/unit/parser.test.mjs and package.json', SCOPE);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(goalPathDiagnostics(result), []);
});

test('the same directory named twice is added once', () => {
  const result = scopePathsForGoal('Add src/a.mjs and src/b.mjs and src/c.mjs', SCOPE);
  assert.deepEqual(result.added.map((entry) => entry.glob), ['src/**']);
});

test('at most eight goal paths are considered', () => {
  const goal = `Touch ${Array.from({ length: 20 }, (_, index) => `dir${index}/file.mjs`).join(' ')}`;
  const extracted = extractGoalPaths(goal);
  assert.equal(extracted.accepted.length, MAX_GOAL_PATHS);
  assert.equal(scopePathsForGoal(goal, SCOPE).added.length, MAX_GOAL_PATHS);
});

test('a token longer than 200 characters is refused, not truncated into scope', () => {
  const long = `src/${'a'.repeat(210)}.mjs`;
  const result = scopePathsForGoal(`Create ${long}`, SCOPE);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.refused.map((entry) => entry.reason), ['over-length']);
  assert.ok(result.refused[0].token.length <= 201);
});

test('sentence punctuation around a path is stripped before it becomes a glob', () => {
  for (const goal of ['Create `src/index.mjs`.', 'Create "src/index.mjs",', 'Create (src/index.mjs)']) {
    assert.deepEqual(scopePathsForGoal(goal, SCOPE).added.map((entry) => entry.glob), ['src/**'], goal);
  }
});

test('ordinary prose contributes no paths', () => {
  const result = scopePathsForGoal('Remove the decision friction around a dirty working tree and record what happened', SCOPE);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.refused, []);
});

test('an empty or non-string goal yields nothing rather than throwing', () => {
  assert.deepEqual(extractGoalPaths(''), { accepted: [], refused: [] });
  assert.deepEqual(extractGoalPaths(/** @type {any} */ (null)), { accepted: [], refused: [] });
});

// v1.13.2 regression: a slash alone is not path evidence. Reported from a live session
// where the branch name codex/shared-memory-completion-20260907 in a goal sentence added
// codex/** to the approved scope.
test('tokens that merely contain a slash are not read as repository paths', () => {
  const notPaths = [
    'Publish the branch codex/shared-memory-completion-20260907 and finish the rollout',
    'Refactor the feature/login-redesign work',
    'Fix the bug reported at https://github.com/owner/repo/issues/12',
    'Scale the column by the ratio 3/4 before rendering',
    'Follow the guidance in ftp://example.invalid/a/b',
  ];
  for (const goal of notPaths) {
    const extracted = extractGoalPaths(goal);
    assert.deepEqual(extracted.accepted, [], `no path may be taken from: ${goal}`);
    assert.deepEqual(extracted.refused, [], 'prose that is not path-shaped is skipped, not reported');
  }
});

test('path evidence is a file extension or an explicit trailing slash', () => {
  assert.deepEqual(extractGoalPaths('Implement hello() in a new file src/index.mjs').accepted, ['src/index.mjs']);
  assert.deepEqual(extractGoalPaths('Add the packages/newthing/ directory').accepted, ['packages/newthing/']);
  assert.deepEqual(extractGoalPaths('Update README.md with the new flow').accepted, ['README.md']);
  // A URL that ends in a source extension is still a URL.
  assert.deepEqual(extractGoalPaths('Copy https://example.invalid/vendor/lib.mjs into place').accepted, []);
});

test('a refusable path-shaped token is still reported rather than skipped', () => {
  const extracted = extractGoalPaths('Read ~/.config/second-brain/jarvis-provider.toml before starting');
  assert.deepEqual(extracted.accepted, []);
  assert.deepEqual(extracted.refused.map((entry) => entry.reason), ['home-directory-path']);
});
