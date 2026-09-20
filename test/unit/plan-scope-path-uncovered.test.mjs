// v1.13.16: a plan stage's scopeInclude replaces the contract's prose scope and never
// touches scope.paths.include, which is what the gate measures. That division is right --
// a plan file able to widen the path allowlist would hold more authority than a plan file
// should -- but nothing said so. A reporting session wrote `uv.lock` into a stage scope,
// saw the contract's prose pick it up, and found out only by reading the source that the
// allowlist had not moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stageScopePathDiagnostics } from '../../src/core/plan-proposal.mjs';

const ALLOWLIST = { include: ['src/**', 'docs/**', 'pyproject.toml'], exclude: [] };

test('a file the stage names but the allowlist does not cover is reported', () => {
  const diagnostics = stageScopePathDiagnostics({ scopeInclude: ['Keep the version in pyproject.toml and uv.lock in step.'] }, ALLOWLIST);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /^PLAN_SCOPE_PATH_UNCOVERED: uv\.lock /u);
  assert.match(diagnostics[0], /never widens scope\.paths\.include/u, 'the reader learns why the prose had no effect');
  assert.match(diagnostics[0], /would count as scope drift/u, 'and what it costs later');
  assert.match(diagnostics[0], /name it in the goal sentence/u, 'and what to do instead');
});

test('a path the allowlist already covers is silent, including through a glob', () => {
  assert.deepEqual(stageScopePathDiagnostics({ scopeInclude: ['Update docs/guide.md and src/main.mjs.'] }, ALLOWLIST), []);
  assert.deepEqual(stageScopePathDiagnostics({ scopeInclude: ['Bump pyproject.toml.'] }, ALLOWLIST), [], 'an exact allowlist entry counts as covered');
});

test('ordinary prose produces nothing, because only extractable tokens count', () => {
  assert.deepEqual(stageScopePathDiagnostics({
    scopeInclude: [
      'Prove the release can be installed, checked, and rolled back.',
      'Cover 3/4 of the operator paths and follow https://example.invalid/docs/guide.',
    ],
  }, ALLOWLIST), [], 'a fraction and a URL are not repository paths');
});

test('scopeExclude is read too, and each path is reported once', () => {
  const diagnostics = stageScopePathDiagnostics({
    scopeInclude: ['Touch uv.lock here.', 'And uv.lock again.'],
    scopeExclude: ['Never touch secrets.env.'],
  }, ALLOWLIST);
  assert.equal(diagnostics.length, 2, 'uv.lock is named three times across both lists and reported once');
  assert.ok(diagnostics.some((entry) => entry.includes('uv.lock')));
  assert.ok(diagnostics.some((entry) => entry.includes('secrets.env')));
});

test('a stage with no scope statements, or an absent allowlist, is handled', () => {
  assert.deepEqual(stageScopePathDiagnostics({}, ALLOWLIST), []);
  assert.deepEqual(stageScopePathDiagnostics({ scopeInclude: [] }, {}), []);
  const unrestricted = stageScopePathDiagnostics({ scopeInclude: ['Touch uv.lock.'] }, {});
  assert.equal(unrestricted.length, 1, 'an empty allowlist covers nothing here; scope.paths.include must state what it permits');
});
