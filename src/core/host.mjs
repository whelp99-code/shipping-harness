import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLockedContract } from './contract.mjs';
import { assertContainedPath, ensureDir, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { runBoundedCommand } from './process.mjs';
import { beginAgentRun, finishAgentRun } from './gate.mjs';
import { ShippingError, invariant } from './errors.mjs';

/** @param {string} executable */
export function findExecutable(executable) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [executable], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).find(Boolean)?.trim() ?? null;
}

/** @param {string} executablePath @param {string[]} args */
export function safeProbe(executablePath, args = ['--version']) {
  const result = spawnSync(executablePath, args, {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout ?? '').trim().slice(0, 4096),
    stderr: (result.stderr ?? '').trim().slice(0, 4096),
    error: result.error?.message ?? null,
  };
}

/** @param {'generic' | 'codex'} host @param {Record<string, any>} contract */
export function probeCoreHost(host, contract) {
  if (host === 'generic') {
    const configured = typeof contract.adapters?.generic?.command === 'string' && contract.adapters.generic.command.trim();
    return {
      name: 'generic',
      installed: true,
      executable: null,
      verificationLevel: configured ? 'configured' : 'available',
      version: null,
      capabilities: {
        execute: true,
        resume: false,
        cancel: true,
        jsonOutput: false,
        hooks: false,
        durableGoals: false,
        durableLedger: false,
        artifactCollection: true,
        costTelemetry: false,
      },
      diagnostics: configured ? [] : ['No default generic command is configured.'],
    };
  }
  if (host === 'codex') {
    const executable = findExecutable('codex');
    const probe = executable ? safeProbe(executable) : null;
    return {
      name: 'codex',
      installed: Boolean(executable),
      executable,
      verificationLevel: executable && probe?.exitCode === 0 ? 'live' : executable ? 'configured' : 'unavailable',
      version: probe?.stdout || probe?.stderr || null,
      capabilities: {
        execute: Boolean(executable),
        resume: false,
        cancel: true,
        jsonOutput: false,
        hooks: false,
        durableGoals: false,
        durableLedger: false,
        artifactCollection: true,
        costTelemetry: false,
      },
      diagnostics: executable ? (probe?.exitCode === 0 ? [] : ['Codex executable exists but version probe failed.']) : ['Codex executable not found on PATH.'],
    };
  }
  throw new ShippingError('ERR_HOST_UNKNOWN', `Unknown core host: ${host}`);
}

/**
 * @param {string} root
 * @param {{host: 'generic' | 'codex', command?: string | null, cwd?: string}} request
 */
export async function executeCoreHost(root, request) {
  const { contract, lock } = await assertLockedContract(root);
  const hostConfig = contract.adapters?.[request.host] ?? {};
  const command = request.command || hostConfig.command;
  invariant(typeof command === 'string' && command.trim(), 'ERR_HOST_COMMAND_REQUIRED', `No execution command configured for ${request.host}`);
  const cwd = path.resolve(root, request.cwd ?? '.');
  await assertContainedPath(root, cwd);
  await beginAgentRun(root, request.host);
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
      SHIPPING_HARNESS_ADAPTER: request.host,
      SHIPPING_HARNESS_CONTRACT_HASH: lock.contractHash,
    },
  });
  const logPath = path.join(runDirectory, 'agent.log');
  await writeAtomic(logPath, [
    `adapter: ${request.host}`,
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
  const manifest = {
    schema: 'shipping-harness/agent-run-v1',
    runId,
    adapter: request.host,
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

/** @param {string} root */
export async function coreDoctor(root) {
  const { contract } = await assertLockedContract(root).catch(() => ({ contract: { adapters: {} } }));
  return {
    node: {
      version: process.version,
      supported: Number.parseInt(process.versions.node.split('.')[0], 10) >= 22,
    },
    git: {
      executable: findExecutable('git'),
    },
    hosts: [probeCoreHost('generic', contract), probeCoreHost('codex', contract)],
  };
}