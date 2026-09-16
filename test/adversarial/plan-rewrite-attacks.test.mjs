// v1.12.1 Phase A adversarial: the realistic failure is a host model told "the roadmap
// changed, rewrite the plan file", which rewrites the whole document with a fresh stage
// numbering. Progress is computed from receipts, so a rewrite would silently reset the
// closed stages to zero. Every surface must refuse it, and the cruder attack — deleting
// the receipt that proves a stage closed — must still be caught by state integrity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { parseCliJson, runCli } from '../helpers/cli.mjs';
import { createMcpProtocol, MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol.mjs';
import { approveScopeProposal, createScopeProposal } from '../../src/core/proposals.mjs';
import { lockContract } from '../../src/core/contract.mjs';
import { currentGitSha } from '../../src/core/git.mjs';
import { DEFAULT_PLAN_PATH, PLAN_SCHEMA } from '../../src/core/shipping-plan.mjs';

const meta = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'plan-rewrite-attacks-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

/** @param {number} id @param {string} name @param {Record<string, any>} args */
function call(id, name, args) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } };
}

const ORIGINAL_PLAN = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: { title: 'Fixture program', outcome: 'Deliver the fixture product end to end.' },
  stages: [
    {
      id: 'S-01',
      title: 'Deliver the core flow',
      outcome: 'Complete the core fixture flow so it runs end to end on the current revision.',
      dependsOn: [],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
    {
      id: 'S-02',
      title: 'Operate and recover',
      outcome: 'Complete the install, health check, and rollback paths with reproducible evidence.',
      dependsOn: ['S-01'],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
  ],
};

// The same roadmap, rewritten from scratch under a different numbering. Nothing about it
// is invalid: it is a well-formed plan that happens to erase a closed stage's identity.
const FULL_REWRITE = {
  schema: PLAN_SCHEMA,
  project: 'fixture',
  program: { title: 'Fixture program, revised', outcome: 'Deliver the revised fixture product end to end.' },
  stages: [
    {
      id: 'S-1',
      title: 'Core flow',
      outcome: 'Complete the revised core flow so it runs end to end on the current revision.',
      dependsOn: [],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
    {
      id: 'S-2',
      title: 'Operations',
      outcome: 'Complete the revised install, health check, and rollback paths.',
      dependsOn: ['S-1'],
      acceptanceRefs: ['node-test'],
      size: 'MILESTONE',
    },
  ],
};

/** @param {{root: string}} fixture @param {Record<string, any>} plan */
function writePlan(fixture, plan) {
  return writeFile(path.join(fixture.root, DEFAULT_PLAN_PATH), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

/** A repo with S-01 closed: one DONE stage, no release in flight. */
async function repoWithClosedStage() {
  const fixture = await createFixtureRepo({ files: { [DEFAULT_PLAN_PATH]: `${JSON.stringify(ORIGINAL_PLAN, null, 2)}\n` } });
  const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
  await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
  assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
  assert.equal(runCli(fixture.root, ['close', '--json']).exitCode, 0);
  return fixture;
}

test('a full rewrite under a new id scheme never reaches a proposal, not even a PATCH', async () => {
  const fixture = await repoWithClosedStage();
  try {
    await writePlan(fixture, FULL_REWRITE);

    const checked = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(checked.exitCode, 1);
    const error = parseCliJson(checked).error;
    assert.equal(error.code, 'ERR_PLAN_HISTORY_LOST');
    assert.deepEqual(
      error.details.violations.map((entry) => [entry.stageId, entry.kind, entry.evidence]),
      [['S-01', 'MISSING', '.shipping/releases/0.1.0.json']],
    );

    // An invalid plan degrades to PATCH with a PLAN_FILE_INVALID diagnostic; a rewritten
    // one must not, or the rewrite would stand and keep proposing work from it.
    const protocol = createMcpProtocol(fixture.root);
    const started = await protocol.handle(call(1, 'shipping_start', { goal: 'Complete the rewritten plan' }));
    assert.equal(started.result.isError, true);
    assert.equal(started.result.structuredContent.error.code, 'ERR_PLAN_HISTORY_LOST');
    assert.equal(JSON.stringify(started.result).includes('PLAN_FILE_INVALID'), false);

    // Progress is untouched: the rewrite never becomes the plan of record.
    await writePlan(fixture, ORIGINAL_PLAN);
    const status = runCli(fixture.root, ['plan', 'status', '--json']);
    assert.equal(status.exitCode, 0);
    assert.deepEqual([parseCliJson(status).progress.done, parseCliJson(status).progress.total], [1, 2]);
  } finally {
    await fixture.cleanup();
  }
});

test('a rewrite is refused at lock too, and the running stage is protected by its lock', async () => {
  const fixture = await repoWithClosedStage();
  try {
    const second = await createScopeProposal(fixture.root, { goal: 'Complete the next fixture release' });
    assert.equal(second.proposal.contract.plan.stageId, 'S-02');
    await approveScopeProposal(fixture.root, { proposalId: second.proposal.id, proposalHash: second.proposal.hash, confirm: true });

    await writePlan(fixture, FULL_REWRITE);
    await assert.rejects(
      () => lockContract(fixture.root, currentGitSha(fixture.root)),
      (rejected) => rejected.code === 'ERR_PLAN_HISTORY_LOST',
    );
    const checked = runCli(fixture.root, ['plan', 'check', '--json']);
    assert.equal(checked.exitCode, 1);
    assert.deepEqual(
      parseCliJson(checked).error.details.violations.map((entry) => [entry.stageId, entry.kind, entry.evidence]),
      [['S-01', 'MISSING', '.shipping/releases/0.1.0.json'], ['S-02', 'MISSING', '.shipping/contract.lock']],
    );
  } finally {
    await fixture.cleanup();
  }
});

test('deleting the receipt that proves a stage closed is reported as TAMPERED state', async () => {
  const fixture = await createFixtureRepo({ files: { [DEFAULT_PLAN_PATH]: `${JSON.stringify(ORIGINAL_PLAN, null, 2)}\n` } });
  try {
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Complete the fixture release' });
    await approveScopeProposal(fixture.root, { proposalId: proposal.id, proposalHash: proposal.hash, confirm: true });
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['close', '--json']).exitCode, 0);

    await rm(path.join(fixture.root, '.shipping', 'releases', '0.1.0.json'));
    const status = runCli(fixture.root, ['status', '--json']);
    assert.equal(status.exitCode, 2);
    const parsed = parseCliJson(status);
    assert.equal(parsed.integrity.level, 'TAMPERED');
    assert.equal(parsed.integrity.ok, false);
    assert.match(parsed.integrity.reason, /release receipt/u);
  } finally {
    await fixture.cleanup();
  }
});

test('a plan at any path other than the fixed one is refused by the CLI and by shipping_start', async () => {
  const fixture = await createFixtureRepo({ files: { 'docs/roadmap-plan.json': `${JSON.stringify(ORIGINAL_PLAN, null, 2)}\n` } });
  try {
    for (const args of [['plan', 'check'], ['plan', 'status']]) {
      const result = runCli(fixture.root, [...args, '--plan', 'docs/roadmap-plan.json', '--json']);
      assert.equal(result.exitCode, 1);
      assert.equal(parseCliJson(result).error.code, 'ERR_PLAN_PATH_FIXED');
    }
    const protocol = createMcpProtocol(fixture.root);
    const started = await protocol.handle(call(1, 'shipping_start', { goal: 'Complete the fixture release', planPath: 'docs/roadmap-plan.json' }));
    assert.equal(started.result.isError, true);
    assert.equal(started.result.structuredContent.error.code, 'ERR_PLAN_PATH_FIXED');
  } finally {
    await fixture.cleanup();
  }
});
