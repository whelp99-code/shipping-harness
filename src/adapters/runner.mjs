import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLockedContract } from '../core/contract.mjs';
import { assertContainedPath, ensureDir, writeAtomic, writeJsonAtomic } from '../core/fs.mjs';
import { runtimePaths } from '../core/paths.mjs';
import { runBoundedCommand } from '../core/process.mjs';
import { beginAgentRun, finishAgentRun } from '../core/gate.mjs';
import { invariant } from '../core/errors.mjs';
import { sha256 } from '../core/crypto.mjs';
import { sanitizeHookPayload } from '../core/hooks.mjs';
import { adapterConfiguration, configuredCommand } from './sdk.mjs';
import { collectAdapterArtifacts, probeAdapter, resolveAdapter } from './registry.mjs';

/**
 * v1.10.0 Phase C: `toolCalls` is host-reported, optional cost telemetry. Run through the
 * same sanitizer as any other hook-adjacent payload, then require a non-negative integer.
 * @param {unknown} value
 */
function normalizeToolCalls(value) {
  if (value === undefined || value === null) return null;
  const sanitized = sanitizeHookPayload(value);
  invariant(Number.isInteger(sanitized) && sanitized >= 0, 'ERR_TOOL_CALLS_INVALID', 'toolCalls must be a non-negative integer', { value });
  return sanitized;
}

/**
 * Execute an explicit operator command through a registered adapter boundary.
 * Adapter discovery never implies authorization to invent a third-party command.
 * @param {string} root
 * @param {{adapter: string, command?: string | null, cwd?: string, toolCalls?: number | null}} request
 */
export async function executeAdapter(root, request) {
  const { contract, lock } = await assertLockedContract(root);
  const adapter = resolveAdapter(request.adapter);
  const config = adapterConfiguration(contract, adapter.name);
  const command = request.command || configuredCommand(config);
  invariant(typeof command === 'string' && command.trim(), 'ERR_ADAPTER_COMMAND_REQUIRED', `No execution command configured for ${adapter.name}`);
  const cwd = path.resolve(root, request.cwd ?? '.');
  await assertContainedPath(root, cwd);
  const toolCalls = normalizeToolCalls(request.toolCalls);
  const runningState = await beginAgentRun(root, adapter.name);
  const verifyRunsAtStart = runningState.verifyRuns ?? 0;

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
  const commandDigest = sha256(command);
  await writeAtomic(logPath, [
    `adapter: ${adapter.name}`,
    `commandDigest: ${commandDigest}`,
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
  // v1.10.0 Phase C cost telemetry: verifyRunsAtStart/End bracket this single synchronous
  // run, during which no `verify` call can interleave, so both equal the same snapshot.
  const telemetry = {
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    outputBytes: result.capturedBytes,
    toolCalls,
    verifyRunsAtStart,
    verifyRunsAtEnd: verifyRunsAtStart,
  };
  const manifest = {
    schema: 'shipping-harness/agent-run-v1',
    runId,
    adapter: adapter.name,
    adapterReport: report,
    artifacts,
    contractHash: lock.contractHash,
    commandDigest,
    cwd: path.relative(root, cwd).replaceAll('\\', '/') || '.',
    telemetry,
    result: {
      ...result,
      stdout: undefined,
      stderr: undefined,
      logPath: path.relative(root, logPath).replaceAll('\\', '/'),
    },
  };
  await writeJsonAtomic(path.join(runDirectory, 'manifest.json'), manifest);
  await finishAgentRun(root, manifest.result, telemetry);
  return manifest;
}