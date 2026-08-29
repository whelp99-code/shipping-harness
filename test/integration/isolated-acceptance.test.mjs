import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contractHash } from '../../src/core/contract.mjs';
import { runAcceptance } from '../../src/core/evidence.mjs';
import { currentGitSha, runGit } from '../../src/core/git.mjs';
import { runIsolatedAcceptance } from '../../src/core/isolated-verification.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function addPackageScript(fixture, source) {
  await mkdir(path.join(fixture.root, 'scripts'), { recursive: true });
  await writeFile(path.join(fixture.root, 'scripts', 'package.mjs'), source, 'utf8');
  runGit(fixture.root, ['add', 'scripts/package.mjs']);
  runGit(fixture.root, ['commit', '-m', 'add package script']);
}

function criterion(overrides = {}) {
  return {
    id: 'AC-ISO-001',
    description: 'The deterministic package is produced in isolation.',
    type: 'command',
    command: 'node scripts/package.mjs',
    cwd: '.',
    required: true,
    timeoutSeconds: 30,
    sideEffect: 'generated-artifacts',
    isolationRequired: true,
    deterministicOutputRequired: true,
    automaticallyRunnable: true,
    ...overrides,
  };
}

function commandInput() {
  return { timeoutSeconds: 30, maxOutputBytes: 1024 * 1024, env: { SHIPPING_TEST: 'isolated' } };
}

async function absent(target) {
  try { await access(target); return false; } catch { return true; }
}

test('deterministic package acceptance runs twice in detached worktrees and leaves source unchanged', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await addPackageScript(fixture, `import { mkdir, writeFile } from 'node:fs/promises';\nawait mkdir('artifact', { recursive: true });\nawait writeFile('artifact/package.txt', 'stable-package\\n');\n`);
    await writeFile(path.join(fixture.root, 'README.md'), '# source has an unrelated dirty note\n', 'utf8');
    const result = await runIsolatedAcceptance(fixture.root, currentGitSha(fixture.root), criterion(), commandInput());
    assert.equal(result.exitCode, 0);
    assert.equal(result.deterministicMismatch, false);
    assert.equal(result.sourceMutationDetected, false);
    assert.equal(result.isolation.mode, 'detached-git-worktree');
    assert.equal(result.isolation.sourceUnchanged, true);
    assert.equal(result.isolation.deterministic, true);
    assert.equal(result.isolation.firstArtifactDigest, result.isolation.secondArtifactDigest);
    assert.ok(result.isolation.artifactChanges.includes('artifact/package.txt'));
    assert.equal(await absent(path.join(fixture.root, 'artifact', 'package.txt')), true);
    assert.match(runGit(fixture.root, ['status', '--short']).stdout, /README\.md/u);
  } finally {
    await fixture.cleanup();
  }
});

test('runAcceptance records isolated deterministic proof in the normal evidence manifest', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: true });
  try {
    await addPackageScript(fixture, `import { mkdir, writeFile } from 'node:fs/promises';\nawait mkdir('artifact', { recursive: true });\nawait writeFile('artifact/package.txt', 'manifest-stable\\n');\n`);
    const contract = {
      schema: 'shipping-harness/v1',
      project: 'isolated-fixture',
      worker: 'shipping-harness',
      release: '0.1.0',
      goal: 'Prove isolated package evidence.',
      scope: { include: ['package'], exclude: ['deploy'], paths: { include: ['**'], exclude: ['.shipping/**'] } },
      acceptance: [criterion()],
      blockerPolicy: ['acceptance-failure'],
      budgets: { maxFixCycles: 1, maxAgentRuns: 1, maxCommandSeconds: 60, maxOutputBytes: 1024 * 1024 },
      stopPolicy: { humanInterruptWins: true, autoContinueAfterInterrupt: false, closeWhenRequiredGatesPass: true },
      releasePolicy: { autoCommit: false, autoTag: false, autoPush: false, generateReport: true },
      adapters: { generic: { command: null, artifactPaths: [] } },
    };
    const lock = { schema: 'shipping-harness/lock-v1', contractHash: contractHash(contract), baselineSha: currentGitSha(fixture.root), release: '0.1.0', scopeRevision: 1 };
    const { manifest } = await runAcceptance(fixture.root, contract, lock, currentGitSha(fixture.root));
    assert.deepEqual(manifest.summary, { total: 1, passed: 1, failed: 0, requiredFailed: 0 });
    const result = manifest.results[0];
    assert.equal(result.status, 'PASS');
    assert.equal(result.sideEffect, 'generated-artifacts');
    assert.equal(result.isolationRequired, true);
    assert.equal(result.deterministicOutputRequired, true);
    assert.equal(result.isolation.mode, 'detached-git-worktree');
    assert.equal(result.isolation.sourceUnchanged, true);
    assert.equal(result.isolation.deterministic, true);
    assert.equal(await absent(path.join(fixture.root, 'artifact', 'package.txt')), true);
  } finally {
    await fixture.cleanup();
  }
});

test('non-deterministic package artifacts fail closed without polluting source', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await addPackageScript(fixture, `import { randomUUID } from 'node:crypto';\nimport { mkdir, writeFile } from 'node:fs/promises';\nawait mkdir('artifact', { recursive: true });\nawait writeFile('artifact/package.txt', randomUUID() + '\\n');\n`);
    const result = await runIsolatedAcceptance(fixture.root, currentGitSha(fixture.root), criterion(), commandInput());
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.deterministicMismatch, true);
    assert.equal(result.sourceMutationDetected, false);
    assert.equal(result.isolation.sourceUnchanged, true);
    assert.equal(result.isolation.deterministic, false);
    assert.notEqual(result.isolation.firstArtifactDigest, result.isolation.secondArtifactDigest);
    assert.equal(await absent(path.join(fixture.root, 'artifact', 'package.txt')), true);
  } finally {
    await fixture.cleanup();
  }
});

test('external or data-state commands cannot be auto-executed through the isolation helper', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await assert.rejects(
      runIsolatedAcceptance(fixture.root, currentGitSha(fixture.root), criterion({
        command: 'printf forbidden',
        sideEffect: 'external-state',
        deterministicOutputRequired: false,
        automaticallyRunnable: false,
      }), commandInput()),
      (error) => error.code === 'ERR_ISOLATION_MANUAL',
    );
  } finally {
    await fixture.cleanup();
  }
});
