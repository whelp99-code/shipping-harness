#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { callShippingTool, SHIPPING_TOOLS } from '../src/mcp/tools.mjs';
import { loadApprovedReleaseTrain } from '../src/core/release-train.mjs';

const check = process.argv.includes('--check');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-release-train-pilot-'));
try {
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'shipping-release-train-pilot',
    version: '0.4.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'node --check src/index.mjs',
      test: 'node --test',
      package: 'node -e "process.exit(0)"',
    },
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'src', 'index.mjs'), 'export const ready = true;\n');
  await writeFile(path.join(root, 'README.md'), '# Disposable Release Train Pilot\n');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Shipping Release Train Pilot']);
  git(root, ['config', 'user.email', 'shipping-release-train@example.invalid']);
  git(root, ['add', 'package.json', 'src/index.mjs', 'README.md']);
  git(root, ['commit', '-qm', 'fixture: create release-train pilot']);

  const beforeHead = git(root, ['rev-parse', 'HEAD']);
  const beforeTracked = git(root, ['diff', '--binary', 'HEAD']);
  const goal = 'Deliver one useful local workflow, make it operable with rollback, and prove it in a bounded internal pilot.';
  const first = await callShippingTool(root, 'shipping_start', { goal, release: '0.5.0', proposerId: 'pilot-host-none' });
  const second = await callShippingTool(root, 'shipping_start', { goal, release: '0.5.0', proposerId: 'pilot-host-none' });
  const proposal = first.structuredContent;

  requireCondition(SHIPPING_TOOLS.length === 9, 'Release train added or removed an MCP tool');
  requireCondition(second.structuredContent.reused === true, 'Identical start did not reuse the active proposal');
  requireCondition(second.structuredContent.proposalId === proposal.proposalId, 'Identical start changed proposal identity');
  requireCondition(second.structuredContent.releaseTrain.hash === proposal.releaseTrain.hash, 'Identical start changed train hash');
  requireCondition(proposal.releaseTrain.modelAuthority === false, 'Release train granted model authority');
  requireCondition(proposal.releaseTrain.currentRelease === '0.5.0', 'Current release is not the requested proposal release');
  requireCondition(proposal.releaseTrain.releases.length === 3, 'Clean software pilot should have three rolling releases');
  requireCondition(proposal.releaseTrain.releases[0].detailLevel === 'CURRENT_FULL', 'Current release lacks full detail');
  requireCondition(proposal.releaseTrain.releases.slice(1).every((entry) => entry.canGrantCurrentAuthority === false), 'Future release acquired current authority');
  requireCondition(proposal.releaseTrain.releases.slice(1).every((entry) => entry.acceptance.exactCommands.length === 0), 'Future release received exact command authority');
  requireCondition(proposal.plainBrief?.quality?.healthy === true, 'Release-train plain brief failed quality checks');
  requireCondition(proposal.plainBriefText.includes('## 전체 개발계획'), 'Beginner report lacks release-train section');
  requireCondition(proposal.plainBrief.releaseTrain?.totalReleases === 3, 'Beginner release-train summary is incomplete');

  const pending = await callShippingTool(root, 'shipping_status', {});
  requireCondition(pending.structuredContent.pendingProposal.releaseTrain.hash === proposal.releaseTrain.hash, 'Pending status lost train authority');
  requireCondition(pending.structuredContent.userView.plainBriefText === proposal.plainBriefText, 'Status changed Shipping-generated beginner report');

  const approved = await callShippingTool(root, 'shipping_approve_scope', {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    confirm: true,
  });
  requireCondition(approved.structuredContent.state === 'LOCKED', 'Proposal did not lock');
  requireCondition(approved.structuredContent.releaseTrainHash === proposal.releaseTrain.hash, 'Approval lost train hash');
  const stored = await loadApprovedReleaseTrain(root);
  requireCondition(stored?.train?.hash === proposal.releaseTrain.hash, 'Approved train was not persisted');
  requireCondition(stored.binding.proposalHash === proposal.proposalHash, 'Train binding lost proposal hash');

  const active = await callShippingTool(root, 'shipping_status', {});
  requireCondition(active.structuredContent.releaseTrain.hash === proposal.releaseTrain.hash, 'Active status lost approved train');
  requireCondition(active.structuredContent.releaseTrainBinding.contractHash === approved.structuredContent.contractHash, 'Train binding lost contract hash');

  const afterHead = git(root, ['rev-parse', 'HEAD']);
  const afterTracked = git(root, ['diff', '--binary', 'HEAD']);
  requireCondition(afterHead === beforeHead, 'Pilot changed target Git HEAD');
  requireCondition(afterTracked === beforeTracked, 'Pilot changed tracked source');

  const envelope = JSON.parse(await readFile(path.join(root, '.shipping', 'release-train.json'), 'utf8'));
  const result = {
    schema: 'shipping-harness/release-train-pilot-v1',
    status: 'PASS',
    checkedAt: new Date().toISOString(),
    mcpTools: SHIPPING_TOOLS.length,
    proposal: {
      id: proposal.proposalId,
      reused: second.structuredContent.reused,
      state: proposal.proposalState,
      release: proposal.release,
    },
    releaseTrain: {
      id: proposal.releaseTrain.id,
      hash: proposal.releaseTrain.hash,
      versions: proposal.releaseTrain.releases.map((entry) => entry.version),
      stages: proposal.releaseTrain.releases.map((entry) => entry.stage),
      currentFull: proposal.releaseTrain.releases[0].detailLevel === 'CURRENT_FULL',
      futureAuthority: proposal.releaseTrain.releases.slice(1).some((entry) => entry.canGrantCurrentAuthority),
      persisted: envelope.train.hash === proposal.releaseTrain.hash,
      binding: envelope.binding,
    },
    plainBrief: {
      healthy: proposal.plainBrief.quality.healthy,
      trainHeading: proposal.plainBriefText.includes('## 전체 개발계획'),
      structuredBytes: proposal.plainBrief.quality.structuredBytes,
      renderedBytes: proposal.plainBrief.quality.renderedBytes,
    },
    targetMutation: false,
    targetApproval: true,
    targetExecution: false,
    publicPublish: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (check && result.status !== 'PASS') process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
