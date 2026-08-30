import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { buildDecisionEvidence } from '../../src/core/decision-evidence.mjs';
import { currentGitSha, runGit } from '../../src/core/git.mjs';
import { hashObject } from '../../src/core/crypto.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

async function put(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function git(root, args) {
  return runGit(root, args, { maxBuffer: 8 * 1024 * 1024 }).stdout;
}

function productFingerprint(root, prefix = '.') {
  return hashObject({
    head: currentGitSha(root),
    diff: git(root, ['diff', '--binary', '--no-ext-diff', '--', prefix]),
    staged: git(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--', prefix]),
  });
}

async function createCleanOperableFixture(release = '0.7.0') {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  await put(fixture.root, 'Makefile', [
    'smoke:',
    '\t@node -e "process.stdout.write(\'smoke-pass\')"',
    '',
    'e2e:',
    '\t@node -e "process.stdout.write(\'e2e-pass\')"',
    '',
  ].join('\n'));
  await fixture.commit('fixture: add field acceptance');
  const started = await callShippingTool(fixture.root, 'shipping_start', {
    goal: 'Deliver one useful local workflow with current evidence and rollback.',
    release,
    proposerId: 'field-matrix-host',
  });
  return { fixture, started };
}

test('clean small project completes through policy-authorized local CLOSED with immutable evidence and RELEASED false', async () => {
  const { fixture, started } = await createCleanOperableFixture();
  try {
    assert.equal(started.structuredContent.proposalState, 'READY_FOR_APPROVAL');
    const approved = await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      confirm: true,
      autopilotProfile: 'LOCAL_REVERSIBLE',
      confirmAutopilot: true,
    });
    const execute = await callShippingTool(fixture.root, 'shipping_execute', {});
    const verified = await callShippingTool(fixture.root, 'shipping_verify', {});
    const status = await callShippingTool(fixture.root, 'shipping_status', {});
    const receipt = JSON.parse(await readFile(path.join(fixture.root, '.shipping', 'releases', `${approved.structuredContent.release}.json`), 'utf8'));
    const evidenceBundle = {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      contractHash: approved.structuredContent.contractHash,
      baselineSha: approved.structuredContent.baselineSha,
      evidenceSha: verified.structuredContent.manifest.gitSha,
      state: status.structuredContent.state.state,
      released: status.structuredContent.autopilot.released,
      receiptRelease: receipt.release,
      requiredFailed: receipt.acceptance.requiredFailed,
    };
    assert.equal(execute.structuredContent.autopilot.decision, 'AUTO');
    assert.equal(verified.structuredContent.decision, 'SHIPPABLE');
    assert.equal(verified.structuredContent.autoClosure.closed, true);
    assert.equal(status.structuredContent.state.state, 'CLOSED');
    assert.equal(status.structuredContent.autopilot.released, false);
    assert.equal(receipt.acceptance.requiredFailed, 0);
    assert.match(hashObject(evidenceBundle), /^[a-f0-9]{64}$/u);
  } finally {
    await fixture.cleanup();
  }
});

test('dirty nested project produces an exact preservation plan without changing product files or granting approval', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await put(fixture.root, 'runtime-v1.1.0/pyproject.toml', '[project]\nname = "field-runtime"\nversion = "1.1.0"\n');
    await put(fixture.root, 'runtime-v1.1.0/src/main.py', 'def run():\n    return "baseline"\n');
    await put(fixture.root, 'runtime-v1.1.0/RELEASE_MANIFEST.json', '{"version":"1.1.0","validated":false}\n');
    await put(fixture.root, 'runtime-v1.1.0/Makefile', 'verify:\n\t@printf "verify-pass\\n"\npackage:\n\t@printf "package-pass\\n"\n');
    await fixture.commit('fixture: add nested runtime');
    await put(fixture.root, 'runtime-v1.1.0/src/main.py', 'def run():\n    return "changed"\n');
    await put(fixture.root, 'runtime-v1.1.0/RELEASE_MANIFEST.json', '{"version":"1.1.0","validated":true}\n');
    await put(fixture.root, '.omo/session.json', '{"runtime":true}\n');
    const before = productFingerprint(fixture.root, 'runtime-v1.1.0');
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Preserve the current nested runtime work and define the smallest verified patch without executing it.',
      release: '1.1.1',
    });
    const proposal = started.structuredContent;
    const after = productFingerprint(fixture.root, 'runtime-v1.1.0');
    const categories = new Map(proposal.baseline.entries.map((entry) => [entry.path, entry]));
    assert.equal(before, after);
    assert.equal(proposal.proposalState, 'DIRTY_BASELINE');
    assert.equal(proposal.readyForApproval, false);
    assert.equal(proposal.nextAction, 'REVIEW_BASELINE');
    assert.equal(proposal.workspace.root, 'runtime-v1.1.0');
    assert.equal(categories.get('runtime-v1.1.0/src/main.py').category, 'PRODUCT');
    assert.equal(categories.get('runtime-v1.1.0/RELEASE_MANIFEST.json').category, 'RELEASE_EVIDENCE');
    assert.equal(categories.get('.omo/').category, 'AGENT_RUNTIME');
    assert.equal(categories.get('.omo/').blocking, false);
    assert.ok(proposal.baseline.plan.includePaths.includes('runtime-v1.1.0/src/main.py'));
    assert.ok(proposal.baseline.plan.excludePaths.some((entry) => entry === '.omo/' || entry === '.omo/session.json'));
    assert.match(proposal.plainBriefText, /## 문제점/u);
    assert.match(proposal.plainBriefText, /이 기준선만 보존해\./u);
  } finally {
    await fixture.cleanup();
  }
});

test('project without an authority-bearing acceptance command remains NEEDS_ACCEPTANCE and cannot be approved', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await writeFile(path.join(fixture.root, 'package.json'), `${JSON.stringify({ name: 'missing-acceptance', version: '0.1.0', private: true }, null, 2)}\n`, 'utf8');
    await fixture.commit('fixture: remove acceptance scripts');
    const before = productFingerprint(fixture.root);
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Finish the smallest useful local release without inventing a test command.',
      release: '0.1.1',
    });
    const after = productFingerprint(fixture.root);
    assert.equal(before, after);
    assert.equal(started.structuredContent.proposalState, 'NEEDS_ACCEPTANCE');
    assert.equal(started.structuredContent.readyForApproval, false);
    assert.equal(started.structuredContent.acceptanceStrength.sufficient, false);
    await assert.rejects(
      callShippingTool(fixture.root, 'shipping_approve_scope', {
        proposalId: started.structuredContent.proposalId,
        proposalHash: started.structuredContent.proposalHash,
        confirm: true,
      }),
      (error) => error?.code === 'ERR_DECISION_NEEDS_INPUT',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('read-only evidence construction preserves a dirty target fingerprint', async () => {
  const fixture = await createFixtureRepo({ initializeShipping: false });
  try {
    await put(fixture.root, 'src/index.mjs', 'export const value = 1;\n');
    await put(fixture.root, 'Makefile', 'test:\n\t@node -e "process.exit(0)"\n');
    await fixture.commit('fixture: add product');
    await put(fixture.root, 'src/index.mjs', 'export const value = 2;\n');
    const before = productFingerprint(fixture.root);
    const evidence = await buildDecisionEvidence(fixture.root, { goal: 'Analyze only; do not mutate the target.', mode: 'AUTO' });
    const after = productFingerprint(fixture.root);
    assert.equal(before, after);
    assert.equal(evidence.gitSha, currentGitSha(fixture.root));
    assert.ok(evidence.baseline.blockingCount > 0);
  } finally {
    await fixture.cleanup();
  }
});
