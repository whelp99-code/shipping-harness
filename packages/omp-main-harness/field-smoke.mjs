import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from './io.mjs';
import { SHIPPING_TOOL_NAMES, TESTED_OMP_HOSTS, OMP_FIELD_SMOKE_SCHEMA, OMP_MCP_PROTOCOL } from './constants.mjs';
import { createNestedPilotFixture } from './fixture.mjs';
import { invariant, parseOmpVersion, resolveOnPath, runCommand, writeJsonAtomic } from './io.mjs';
import { McpLineClient, ompToolCall } from './mcp-smoke.mjs';
import { packageRoot } from './paths.mjs';
import { analyzeRepository } from '../../src/core/project-analysis.mjs';

function gitSnapshot(root) {
  try {
    return {
      head: runCommand('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 30000 }).stdout.trim(),
      status: runCommand('git', ['status', '--porcelain'], { cwd: root, timeoutMs: 30000 }).stdout,
      diff: runCommand('git', ['diff', '--name-only', 'HEAD'], { cwd: root, timeoutMs: 30000 }).stdout,
    };
  } catch {
    // Not a Git repository (or git unavailable): report no baseline instead of failing the smoke check.
    return null;
  }
}

async function actualProjectReadOnly(project) {
  const target = path.resolve(project);
  if (!(await exists(target))) return { available: false, path: target };
  const before = gitSnapshot(target);
  const analysis = await analyzeRepository(target);
  const after = gitSnapshot(target);
  invariant(JSON.stringify(before) === JSON.stringify(after), 'ERR_FIELD_PROJECT_MUTATED', 'Read-only field analysis changed the target project');
  return {
    available: true,
    path: target,
    unchanged: true,
    head: before?.head ?? null,
    dirty: Boolean(before?.status),
    workspace: analysis.workspace,
    versionEvidence: analysis.versionEvidence,
    acceptance: analysis.candidateCommands.map((entry) => ({ command: entry.command, cwd: entry.cwd })),
  };
}

async function nestedPlanningPilot(ompVersion) {
  const fixture = await createNestedPilotFixture();
  const mcpScript = path.join(packageRoot(), 'bin', 'shipping-harness-mcp.mjs');
  const before = gitSnapshot(fixture.root);
  const client = new McpLineClient({
    command: process.execPath,
    args: [mcpScript, '--root', fixture.root],
    cwd: fixture.root,
  });
  try {
    const initialized = await client.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: OMP_MCP_PROTOCOL,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'omp-coding-agent', version: ompVersion },
      },
    });
    invariant(!initialized.error && initialized.result?.protocolVersion === OMP_MCP_PROTOCOL, 'ERR_FIELD_MCP', 'OMP initialize lane failed');
    client.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await client.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const toolNames = (listed.result?.tools ?? []).map((entry) => entry.name);
    invariant(toolNames.length === SHIPPING_TOOL_NAMES.length && SHIPPING_TOOL_NAMES.every((name) => toolNames.includes(name)), 'ERR_FIELD_TOOLS', 'Field pilot did not discover all nine Shipping tools');

    const started = await client.request(ompToolCall(3, 'shipping_start', {
      goal: 'Prepare the smallest local verification and packaging patch for the nested runtime without changing target source.',
    }));
    invariant(started.result?.isError !== true, 'ERR_FIELD_START', 'Field pilot shipping_start failed', started.result);
    const initial = started.result?.structuredContent;
    invariant(initial?.proposalState === 'NEEDS_INPUT' && initial.workspace?.ambiguous === true, 'ERR_FIELD_START', 'Field pilot did not expose the workspace ambiguity truthfully');
    const candidate = initial.workspaceCandidates?.find((entry) => entry.root === 'beta-runtime-v1.1.0');
    invariant(candidate, 'ERR_FIELD_WORKSPACE', 'Expected beta runtime candidate was not found');

    const refined = await client.request(ompToolCall(4, 'shipping_refine', {
      proposalId: initial.proposalId,
      proposalHash: initial.proposalHash,
      workspaceCandidateId: candidate.id,
    }));
    invariant(refined.result?.isError !== true, 'ERR_FIELD_REFINE', 'Field pilot shipping_refine failed', refined.result);
    const revision = refined.result?.structuredContent;
    invariant(revision?.proposalId === initial.proposalId && revision.revision === 2, 'ERR_FIELD_IDENTITY', 'Field pilot did not preserve one proposal identity and increment its revision');
    invariant(revision?.proposalState === 'READY_FOR_APPROVAL' && revision.readyForApproval === true, 'ERR_FIELD_READY', 'Refined field proposal is not truthfully ready for approval');
    const acceptance = revision.acceptance?.map((entry) => [entry.command, entry.cwd]);
    invariant(JSON.stringify(acceptance) === JSON.stringify([
      ['make verify', 'beta-runtime-v1.1.0'],
      ['make package', 'beta-runtime-v1.1.0'],
      ['git diff --check', '.'],
    ]), 'ERR_FIELD_ACCEPTANCE', 'Field pilot acceptance commands or cwd values are not authority-bound to the nested workspace', { acceptance });

    const status = await client.request(ompToolCall(5, 'shipping_status'));
    const pending = status.result?.structuredContent?.pendingProposal;
    invariant(pending?.proposalId === initial.proposalId && pending.revision === 2, 'ERR_FIELD_STATUS', 'Field pilot status lost the active proposal revision');
    invariant(status.result?.structuredContent?.userView?.userState === 'AWAITING_APPROVAL', 'ERR_FIELD_STATUS', 'Field pilot status is not approval-waiting');
    const after = gitSnapshot(fixture.root);
    invariant(before?.head === after?.head && before?.diff === after?.diff, 'ERR_FIELD_SOURCE_MUTATED', 'Planning-only pilot modified tracked target source');
    invariant(!(await exists(path.join(fixture.root, '.shipping', 'contract.lock'))), 'ERR_FIELD_APPROVED', 'Planning-only pilot unexpectedly approved the target proposal');

    return {
      status: 'PASS',
      toolNames,
      proposalId: initial.proposalId,
      initialRevision: initial.revision,
      finalRevision: revision.revision,
      selectedWorkspace: revision.workspace.root,
      recommendedRelease: revision.release,
      proposalState: revision.proposalState,
      userState: status.result.structuredContent.userView.userState,
      acceptance,
      trackedSourceChanged: false,
      approved: false,
    };
  } finally {
    await client.close();
    await fixture.cleanup();
  }
}

/** @param {{ompCommand?: string, project?: string, check?: boolean}} [input] */
export async function runFieldSmoke(input = {}) {
  const omp = resolveOnPath(input.ompCommand ?? 'omp');
  const versionOutput = runCommand(omp, ['--version'], { timeoutMs: 60000 }).stdout.trim();
  const ompVersion = parseOmpVersion(versionOutput);
  const host = TESTED_OMP_HOSTS.find((entry) => entry.version === ompVersion);
  invariant(host, 'ERR_OMP_UNSUPPORTED', `OMP ${ompVersion} is outside the tested field matrix`, { supported: TESTED_OMP_HOSTS.map((entry) => entry.version) });
  const smoke = runCommand(omp, ['--smoke-test'], { timeoutMs: 120000 }).stdout.trim();
  invariant(/smoke-test:\s*ok/iu.test(smoke), 'ERR_OMP_SMOKE', `OMP smoke failed: ${smoke}`);

  const pilot = await nestedPlanningPilot(ompVersion);
  const actualProject = await actualProjectReadOnly(input.project ?? '/home/jm/orca/projects/EvoHarvest');
  const receipt = {
    schema: OMP_FIELD_SMOKE_SCHEMA,
    status: 'PASS',
    checkedAt: new Date().toISOString(),
    omp: {
      command: omp,
      version: ompVersion,
      protocol: host.protocol,
      surface: host.surface,
      smoke: 'PASS',
    },
    mcp: {
      connected: true,
      tools: SHIPPING_TOOL_NAMES.length,
      toolNames: SHIPPING_TOOL_NAMES,
      refineTool: true,
    },
    pilot,
    actualProject,
    targetMutation: false,
    targetApproval: false,
    publicPublish: false,
  };
  if (input.check) {
    const evidence = path.join(packageRoot(), '.shipping', 'evidence', 'v1.1.1-omp-field-smoke.json');
    await writeJsonAtomic(evidence, receipt, 0o600);
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  runFieldSmoke({
    ompCommand: option('--omp-command'),
    project: option('--project'),
    check: process.argv.includes('--check'),
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    const code = error && typeof error === 'object' && 'code' in error ? ` [${error.code}]` : '';
    process.stderr.write(`shipping-harness-omp-field-smoke: ${error instanceof Error ? error.message : String(error)}${code}\n`);
    process.exitCode = 1;
  });
}
