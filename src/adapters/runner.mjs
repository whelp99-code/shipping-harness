import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLockedContract } from '../core/contract.mjs';
import { assertContainedPath, ensureDir, writeAtomic, writeJsonAtomic } from '../core/fs.mjs';
import { runtimePaths } from '../core/paths.mjs';
import { runBoundedCommand } from '../core/process.mjs';
import { beginAgentRun, finishAgentRun } from '../core/gate.mjs';
import { invariant } from '../core/errors.mjs';
import { adapterConfiguration, configuredCommand } from './sdk.mjs';
import { collectAdapterArtifacts, probeAdapter, resolveAdapter } from './registry.mjs';

/**
 * Execute an explicit operator command through a registered adapter boundary.
 * Adapter discovery never implies authorization to invent a third-party command.
 * @param {string} root
 * @param {{adapter: string, command?: string | null, cwd?: string}} request
 */
export async function executeAdapter(root, request) {
  const { contract, lock } = await assertLockedContract(root);
  const adapter = resolveAdapter(request.adapter);
  const config = adapterConfiguration(contract, adapter.name);
  const command = request.command || configuredCommand(config);
  invariant(typeof command === 'string' && command.trim(), 'ERR_ADAPTER_COMMAND_REQUIRED', `No execution command configured for ${adapter.name}`);
  const cwd = path.resolve(root, request.cwd ?? '.');
  await assertContainedPath(root, cwd);
  await beginAgentRun(root, adapter.name);

  const runId = `agent-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const runDirectory = path.join(runtimePaths(root).evidence, runId);
  await ensureDir(runDirectory);
  const result = await runBoundedCommand({
    command,
    cwd,
    timeoutSeconds: contract.budgets.maxCommandSeconds,
    maxOutputBytes: contract.budgets.maxOutputBytes,
    env: {
      SHIPPING_HARNESS_AGENT_RUN_ID: runId,
      SHIPPING_HARNESS_ADAPTER: adapter.name,
      SHIPPING_HARNESS_CONTRACT_HASH: lock.contractHash,
    },
  });

  const logPath = path.join(runDirectory, 'agent.log');
  await writeAtomic(logPath, [
    `adapter: ${adapter.name}`,
    `command: ${command}`,
    `exitCode: ${String(result.exitCode)}`,
    `timedOut: ${String(result.timedOut)}`,
    `outputLimitExceeded: ${String(result.outputLimitExceeded)}`,
    '',
    '--- stdout (redacted) ---',
    result.stdout,
    '',
    '--- stderr (redacted) ---',
    result.stderr,
    '',
  ].join('\n'));

  const report = probeAdapter(adapter.name, { contract, root });
  const artifacts = await collectAdapterArtifacts(adapter.name, { contract, root });
  const manifest = {
    schema: 'shipping-harness/agent-run-v1',
    runId,
    adapter: adapter.name,
    adapterReport: report,
    artifacts,
    contractHash: lock.contractHash,
    command,
    cwd: path.relative(root, cwd).replaceAll('\\', '/') || '.',
    result: {
      ...result,
      stdout: undefined,
      stderr: undefined,
      logPath: path.relative(root, logPath).replaceAll('\\', '/'),
    },
  };
  await writeJsonAtomic(path.join(runDirectory, 'manifest.json'), manifest);
  await finishAgentRun(root, manifest.result);
  return manifest;
}