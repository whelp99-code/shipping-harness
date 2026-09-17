// v1.13.0 Phase C adversarial: the goal sentence is untrusted user input and the one thing
// in the system that can WIDEN an approved scope. Nothing it names may escape the
// repository, reach harness runtime state, or override the exclude list, and every refusal
// has to be visible in the approval brief rather than silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goalPathDiagnostics, scopePathsForGoal } from '../../src/core/goal-paths.mjs';
import { analyzeScope } from '../../src/core/glob.mjs';
import { verifyRelease } from '../../src/core/gate.mjs';
import { approveScopeProposal } from '../../src/core/proposals.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

const SCOPE = Object.freeze({
  include: ['README.md', 'package.json', 'test/**'],
  exclude: ['.shipping/contract.yaml', '.shipping/contract.lock', '.git/**', 'node_modules/**', 'dist/**', 'coverage/**', 'target/**'],
});

const ATTACKS = [
  ['../../etc/passwd', 'parent-traversal'],
  ['../secrets/key.mjs', 'parent-traversal'],
  ['/etc/passwd', 'absolute-path'],
  ['/home/someone/.ssh/id_rsa', 'absolute-path'],
  ['~/.aws/credentials', 'home-directory-path'],
  ['.git/config', 'repository-internals'],
  ['.shipping/state.json', 'shipping-runtime'],
  ['.shipping/contract.yaml', 'shipping-runtime'],
  ['node_modules/evil/index.js', 'excluded-path'],
  ['dist/bundle.js', 'excluded-path'],
  ['coverage/lcov.info', 'excluded-path'],
];

for (const [token, reason] of ATTACKS) {
  test(`a goal naming ${token} adds nothing and reports GOAL_PATH_REFUSED (${reason})`, () => {
    const result = scopePathsForGoal(`Please also update ${token} while you are at it`, SCOPE);
    assert.deepEqual(result.added, [], `${token} widened the scope`);
    assert.deepEqual(result.refused, [{ token: token.replace(/^\.\//u, ''), reason }]);
    assert.deepEqual(goalPathDiagnostics(result), [`GOAL_PATH_REFUSED: ${token} (${reason})`]);
  });
}

test('one refused path does not stop a legitimate one in the same sentence', () => {
  const result = scopePathsForGoal('Implement src/index.mjs and then read /etc/passwd', SCOPE);
  assert.deepEqual(result.added, [{ glob: 'src/**', token: 'src/index.mjs' }]);
  assert.deepEqual(result.refused, [{ token: '/etc/passwd', reason: 'absolute-path' }]);
  const diagnostics = goalPathDiagnostics(result);
  assert.ok(diagnostics.includes('GOAL_PATH_ADDED: src/** (goal named "src/index.mjs")'));
  assert.ok(diagnostics.includes('GOAL_PATH_REFUSED: /etc/passwd (absolute-path)'));
});

test('a Windows-style absolute path and a UNC path are refused too', () => {
  for (const token of ['C:\\Windows\\system32\\evil.mjs', '\\\\server\\share\\secret.mjs']) {
    const result = scopePathsForGoal(`Write to ${token}`, SCOPE);
    assert.deepEqual(result.added, [], token);
    assert.equal(result.refused[0].reason, 'absolute-path', token);
  }
});

test('an added glob can never match a path outside the repository', () => {
  const result = scopePathsForGoal('Create src/index.mjs', SCOPE);
  const widened = { ...SCOPE, include: [...SCOPE.include, ...result.added.map((entry) => entry.glob)] };
  // analyzeScope refuses to even normalize an escaping path, and the harness only ever
  // feeds it repository-relative paths reported by git.
  assert.throws(() => analyzeScope(['../outside.mjs'], widened), (error) => error.code === 'ERR_PATH_OUTSIDE_REPO');
  for (const runtimePath of ['.shipping/state.json', '.git/config']) {
    const analyzed = analyzeScope([runtimePath], widened);
    assert.deepEqual(analyzed.allowed, [], `${runtimePath} became in-scope work`);
    assert.equal(analyzed.ignored.length + analyzed.violations.length, 1);
  }
});

test('the v1.13.0 §1.3 scenario: a goal-named file in an absent directory is not scope drift', async () => {
  // The fixture baseline has no src/ directory at all, which is exactly the case where the
  // repository analyzer could not derive the path and the first verify blocked.
  const fixture = await createFixtureRepo({
    testScript: 'node --test test/hello.test.mjs',
    files: {
      'test/hello.test.mjs': [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { hello } from '../src/index.mjs';",
        "test('hello', () => assert.equal(hello(), 'hello'));",
        '',
      ].join('\n'),
    },
  });
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Implement hello() in a new file src/index.mjs so the existing test suite passes',
      release: '0.1.0',
    });
    const data = started.structuredContent;
    assert.ok(data.scope.paths.include.includes('src/**'), `src/** is missing from ${JSON.stringify(data.scope.paths.include)}`);
    assert.ok(
      data.diagnostics.includes('GOAL_PATH_ADDED: src/** (goal named "src/index.mjs")'),
      `the widening is not visible in ${JSON.stringify(data.diagnostics)}`,
    );

    await approveScopeProposal(fixture.root, {
      proposalId: data.proposalId,
      proposalHash: data.proposalHash,
      confirm: true,
      approverId: 'human-operator',
    });
    await fixture.write('src/index.mjs', "export function hello() { return 'hello'; }\n");
    await fixture.commit('feat: implement hello() in the approved scope');

    const verification = await verifyRelease(fixture.root);
    assert.deepEqual(verification.scope.violations, [], 'the implementation was refused as scope drift');
    assert.ok(verification.scope.allowed.includes('src/index.mjs'));
    assert.equal(verification.decision, 'SHIPPABLE');
  } finally {
    await fixture.cleanup();
  }
});

test('a goal that names harness runtime state never puts it into the proposed scope', async () => {
  const fixture = await createFixtureRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Ship a bounded fixture release and also edit .shipping/state.json and ../../etc/passwd',
      release: '0.1.0',
    });
    const data = started.structuredContent;
    for (const entry of data.scope.paths.include) {
      assert.ok(!entry.startsWith('.shipping'), `harness state entered scope: ${entry}`);
      assert.ok(!entry.includes('..'), `a traversal entered scope: ${entry}`);
      assert.ok(!entry.startsWith('/'), `an absolute path entered scope: ${entry}`);
    }
    assert.ok(data.diagnostics.includes('GOAL_PATH_REFUSED: .shipping/state.json (shipping-runtime)'));
    assert.ok(data.diagnostics.includes('GOAL_PATH_REFUSED: ../../etc/passwd (parent-traversal)'));
  } finally {
    await fixture.cleanup();
  }
});
