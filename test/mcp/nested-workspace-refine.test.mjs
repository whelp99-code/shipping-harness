import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runGit } from '../../src/core/git.mjs';
import { analyzeRepository, buildAcceptanceCriteria } from '../../src/core/project-analysis.mjs';
import { loadScopeProposal } from '../../src/core/proposals.mjs';
import { callShippingTool, SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';

async function addRuntime(root, name, version = '1.1.0') {
  const runtime = path.join(root, name);
  await mkdir(path.join(runtime, 'src'), { recursive: true });
  await mkdir(path.join(runtime, 'tests'), { recursive: true });
  await writeFile(path.join(runtime, 'Makefile'), [
    'verify:',
    '\t@true',
    'package:',
    '\t@true',
    'web-check:',
    '\t@true',
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(runtime, 'RELEASE_MANIFEST.json'), `${JSON.stringify({ version }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(runtime, 'pyproject.toml'), `[project]\nname = "${name}"\nversion = "${version}"\n[tool.pytest.ini_options]\n`, 'utf8');
  await writeFile(path.join(runtime, 'README.md'), `# ${name}\n`, 'utf8');
  await writeFile(path.join(runtime, 'src', 'app.py'), 'print("ok")\n', 'utf8');
  await writeFile(path.join(runtime, 'tests', 'test_app.py'), 'def test_ok(): assert True\n', 'utf8');
  return runtime;
}

async function nestedRepo(names = ['evoharvest-runtime-v1.1.0']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-nested-'));
  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.name', 'Shipping Nested Test']);
  runGit(root, ['config', 'user.email', 'shipping-nested@example.invalid']);
  await writeFile(path.join(root, 'README.md'), '# Repository wrapper\n', 'utf8');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n', 'utf8');
  for (const name of names) await addRuntime(root, name, name.match(/(\d+\.\d+\.\d+)/u)?.[1] ?? '1.1.0');
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'nested baseline']);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const outcome = 'Verify, package, and hand off the existing local runtime without adding product features';

test('nested runtime selection derives cwd-bound verify/package gates and a patch version', async () => {
  const fixture = await nestedRepo();
  try {
    const analysis = await analyzeRepository(fixture.root, { goal: outcome });
    assert.equal(analysis.workspace.root, 'evoharvest-runtime-v1.1.0');
    assert.equal(analysis.workspace.confidence, 'high');
    assert.equal(analysis.workspace.ambiguous, false);
    assert.equal(analysis.versionEvidence.baseVersion, '1.1.0');
    assert.equal(analysis.versionEvidence.changeKind, 'patch');
    assert.equal(analysis.versionEvidence.recommendedVersion, '1.1.1');
    assert.deepEqual(
      analysis.candidateCommands.map((entry) => [entry.command, entry.cwd]),
      [
        ['make verify', 'evoharvest-runtime-v1.1.0'],
        ['make package', 'evoharvest-runtime-v1.1.0'],
        ['git diff --check', '.'],
      ],
    );
    assert.deepEqual(
      buildAcceptanceCriteria(analysis).map((entry) => [entry.command, entry.cwd]),
      [
        ['make verify', 'evoharvest-runtime-v1.1.0'],
        ['make package', 'evoharvest-runtime-v1.1.0'],
        ['git diff --check', '.'],
      ],
    );
  } finally {
    await fixture.cleanup();
  }
});

test('shipping_start uses nested mechanical evidence as the authority-bearing proposal', async () => {
  const fixture = await nestedRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: outcome });
    const proposal = started.structuredContent;
    assert.equal(proposal.release, '1.1.1');
    assert.equal(proposal.workspace.root, 'evoharvest-runtime-v1.1.0');
    assert.equal(proposal.proposalState, 'READY_FOR_APPROVAL');
    assert.equal(proposal.acceptanceStrength.level, 'STRONG');
    assert.deepEqual(
      proposal.acceptance.map((entry) => [entry.command, entry.cwd]),
      [
        ['make verify', 'evoharvest-runtime-v1.1.0'],
        ['make package', 'evoharvest-runtime-v1.1.0'],
        ['git diff --check', '.'],
      ],
    );
  } finally {
    await fixture.cleanup();
  }
});

test('shipping_refine selects a tied workspace under one proposal identity and immutable revision chain', async () => {
  const fixture = await nestedRepo(['alpha-runtime-v1.0.0', 'beta-runtime-v1.0.0']);
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: outcome });
    const initial = started.structuredContent;
    assert.equal(initial.proposalState, 'NEEDS_INPUT');
    assert.equal(initial.readyForApproval, false);
    assert.equal(initial.workspace.ambiguous, true);
    const beta = initial.workspaceCandidates.find((entry) => entry.root === 'beta-runtime-v1.0.0');
    assert.ok(beta);

    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: initial.proposalId,
      proposalHash: initial.proposalHash,
      workspaceCandidateId: beta.id,
    });
    const revision = refined.structuredContent;
    assert.equal(revision.proposalId, initial.proposalId);
    assert.equal(revision.revision, 2);
    assert.equal(revision.previousHash, initial.proposalHash);
    assert.equal(revision.workspace.root, 'beta-runtime-v1.0.0');
    assert.equal(revision.workspace.requested, true);
    assert.equal(revision.proposalState, 'READY_FOR_APPROVAL');
    assert.equal(revision.readyForApproval, true);

    const archived = JSON.parse(await readFile(path.join(fixture.root, revision.archivedRevisionPath), 'utf8'));
    assert.equal(archived.hash, initial.proposalHash);
    assert.equal(archived.revision, 1);
    await assert.rejects(
      loadScopeProposal(fixture.root, `${initial.proposalId}.r1`),
      (error) => error.code === 'ERR_PROPOSAL_ID',
    );
    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(status.structuredContent.pendingProposal.proposalId, initial.proposalId);
    assert.equal(status.structuredContent.pendingProposal.revision, 2);
    assert.equal(status.structuredContent.userView.userState, 'AWAITING_APPROVAL');
  } finally {
    await fixture.cleanup();
  }
});

test('refinement rejects raw execution fields, stale hashes, and unauthorized mode changes', async () => {
  const fixture = await nestedRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', { goal: outcome });
    const initial = started.structuredContent;
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_refine', {
        proposalId: initial.proposalId,
        proposalHash: initial.proposalHash,
        command: 'make verify',
      }),
      (error) => error.code === 'ERR_MCP_ARGUMENTS',
    );
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_refine', {
        proposalId: initial.proposalId,
        proposalHash: initial.proposalHash,
        mode: 'SAFE',
      }),
      (error) => error.code === 'ERR_PROPOSAL_MODE_AUTHORIZATION',
    );
    const refined = await callShippingTool(fixture.root, 'shipping_refine', {
      proposalId: initial.proposalId,
      proposalHash: initial.proposalHash,
      mode: 'SAFE',
      modeAuthorizedByUser: true,
    });
    assert.equal(refined.structuredContent.mode, 'SAFE');
    assert.equal(refined.structuredContent.revision, 2);
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_refine', {
        proposalId: initial.proposalId,
        proposalHash: initial.proposalHash,
        rescan: true,
      }),
      (error) => error.code === 'ERR_PROPOSAL_HASH',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('v1.1 MCP surface contains exactly nine bounded beginner tools', () => {
  assert.deepEqual(
    SHIPPING_TOOLS.map((tool) => tool.name),
    [
      'shipping_start',
      'shipping_refine',
      'shipping_approve_scope',
      'shipping_execute',
      'shipping_status',
      'shipping_verify',
      'shipping_fix_blockers',
      'shipping_pause',
      'shipping_close',
    ],
  );
  const refine = SHIPPING_TOOLS.find((tool) => tool.name === 'shipping_refine');
  assert.equal(refine.inputSchema.additionalProperties, false);
  for (const forbidden of ['command', 'shell', 'argv', 'args', 'env', 'credentials', 'push', 'deploy']) {
    assert.equal(Object.hasOwn(refine.inputSchema.properties, forbidden), false);
  }
});
