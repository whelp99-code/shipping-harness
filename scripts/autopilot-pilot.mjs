#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateAutopilotAction, autopilotStatus } from '../src/core/autopilot.mjs';
import { callShippingTool, SHIPPING_TOOLS } from '../src/mcp/tools.mjs';

const check = process.argv.includes('--check');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-autopilot-pilot-'));
try {
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'shipping-autopilot-pilot',
    version: '0.7.0',
    private: true,
    type: 'module',
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'src', 'index.mjs'), 'export const ready = true;\n');
  await writeFile(path.join(root, 'README.md'), '# Disposable Policy Autopilot Pilot\n');
  await writeFile(path.join(root, 'Makefile'), [
    'smoke:',
    '\t@node -e "process.stdout.write(\'smoke-pass\')"',
    '',
    'e2e:',
    '\t@node -e "process.stdout.write(\'e2e-pass\')"',
    '',
  ].join('\n'));

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Shipping Autopilot Pilot']);
  git(root, ['config', 'user.email', 'shipping-autopilot@example.invalid']);
  git(root, ['add', 'package.json', 'src/index.mjs', 'README.md', 'Makefile']);
  git(root, ['commit', '-qm', 'fixture: create policy-autopilot pilot']);

  const sourceHead = git(root, ['rev-parse', 'HEAD']);
  const goal = 'Deliver one useful local workflow, make it operable with rollback, and prove it in a bounded internal pilot.';
  const started = await callShippingTool(root, 'shipping_start', {
    goal,
    release: '0.7.0',
    proposerId: 'autopilot-pilot-host',
  });
  const proposal = started.structuredContent;
  requireCondition(SHIPPING_TOOLS.length === 9, 'Autopilot changed the bounded nine-tool MCP surface');
  requireCondition(proposal.proposalState === 'READY_FOR_APPROVAL', `Pilot proposal is ${proposal.proposalState}`);

  const approved = await callShippingTool(root, 'shipping_approve_scope', {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    confirm: true,
    autopilotProfile: 'LOCAL_REVERSIBLE',
    confirmAutopilot: true,
  });
  requireCondition(approved.structuredContent.state === 'LOCKED', 'Initial release did not lock');
  requireCondition(approved.structuredContent.autopilot.profile === 'LOCAL_REVERSIBLE', 'Local reversible policy was not activated');

  const execution = await callShippingTool(root, 'shipping_execute', {});
  requireCondition(execution.structuredContent.mode === 'host-agent', 'Pilot unexpectedly invoked an external adapter');
  requireCondition(execution.structuredContent.autopilot.decision === 'AUTO', 'Safe local implementation was not AUTO');
  requireCondition(execution.structuredContent.released === false, 'Implementation marked RELEASED');

  const paused = await callShippingTool(root, 'shipping_pause', { action: 'pause', reason: 'pilot human stop' });
  requireCondition(paused.structuredContent.autopilot.phase === 'PAUSED', 'Human pause did not stop autopilot');
  const resumed = await callShippingTool(root, 'shipping_pause', { action: 'resume', reason: 'pilot resume' });
  requireCondition(resumed.structuredContent.autopilot.phase === 'IMPLEMENTING', 'Autopilot did not resume the prior phase');

  const verified = await callShippingTool(root, 'shipping_verify', {});
  requireCondition(verified.structuredContent.decision === 'SHIPPABLE', 'Pilot acceptance did not become SHIPPABLE');
  requireCondition(verified.structuredContent.autoClosure?.closed === true, 'Proven local release did not close automatically');
  requireCondition(verified.structuredContent.autoClosure?.state === 'CLOSED', 'Automatic closure did not reach CLOSED');
  requireCondition(verified.structuredContent.released === false, 'Automatic CLOSED was confused with RELEASED');

  git(root, ['add', '.shipping']);
  git(root, ['commit', '-qm', 'chore: commit policy-authorized closure evidence']);
  const closureHead = git(root, ['rev-parse', 'HEAD']);

  const nextVersion = proposal.releaseTrain.releases[1].version;
  const nextGoal = proposal.releaseTrain.releases[1].valueGate.statement;
  const next = await callShippingTool(root, 'shipping_start', {
    goal: nextGoal,
    release: nextVersion,
    proposerId: 'autopilot-pilot-next-host',
  });
  requireCondition(next.structuredContent.proposalState === 'READY_FOR_APPROVAL', 'Fresh replan is not approval-ready');
  const continued = await callShippingTool(root, 'shipping_approve_scope', {
    proposalId: next.structuredContent.proposalId,
    proposalHash: next.structuredContent.proposalHash,
    confirm: false,
    autopilotContinuation: true,
  });
  requireCondition(continued.structuredContent.continuation === true, 'Train continuation was not policy-authorized');
  requireCondition(continued.structuredContent.continuationDecision.decision === 'NOTIFY', 'Safe train continuation was not NOTIFY');
  requireCondition(continued.structuredContent.release === nextVersion, 'Continuation selected the wrong train release');
  requireCondition(continued.structuredContent.released === false, 'Train continuation marked RELEASED');

  const releaseAttempt = await evaluateAutopilotAction(root, {
    action: 'RELEASE',
    effects: ['PUBLIC', 'EXTERNAL_NETWORK_WRITE'],
    rollbackAvailable: true,
    exactScope: true,
    localOnly: false,
  });
  requireCondition(releaseAttempt.decision.decision === 'ASK', 'Public release did not require human authority');
  requireCondition(releaseAttempt.decision.allowed === false, 'Public release was automatically allowed');
  requireCondition(releaseAttempt.decision.released === false, 'Public release decision marked RELEASED');

  const status = await autopilotStatus(root);
  requireCondition(status.released === false && status.state.released === false, 'Durable state marked RELEASED');
  requireCondition(status.eventCount > 0, 'Autopilot ledger is empty');

  const result = {
    schema: 'shipping-harness/autopilot-pilot-v1',
    status: 'PASS',
    checkedAt: new Date().toISOString(),
    sourceHead,
    closureHead,
    mcpTools: SHIPPING_TOOLS.length,
    policy: {
      profile: status.policy.profile,
      defaultDecision: status.policy.defaultDecision,
      modelAuthority: status.policy.modelAuthority,
      released: status.released,
    },
    firstRelease: {
      release: proposal.release,
      verification: verified.structuredContent.decision,
      autoClosed: verified.structuredContent.autoClosure.closed,
      released: verified.structuredContent.released,
    },
    continuation: {
      release: continued.structuredContent.release,
      decision: continued.structuredContent.continuationDecision.decision,
      state: continued.structuredContent.state,
    },
    publicRelease: {
      decision: releaseAttempt.decision.decision,
      allowed: releaseAttempt.decision.allowed,
      released: releaseAttempt.decision.released,
    },
    humanStop: { pause: 'PASS', resume: 'PASS' },
    ledgerEvents: status.eventCount,
    publicPublish: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (check && result.status !== 'PASS') process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
