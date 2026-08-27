import { assertLockedContract } from './contract.mjs';
import { findExecutable as findAdapterExecutable, safeProbe as safeAdapterProbe } from '../adapters/sdk.mjs';
import { executeAdapter } from '../adapters/runner.mjs';
import { probeAdapter, probeAllAdapters } from '../adapters/registry.mjs';

/** Backward-compatible executable lookup used by v0.1 callers. @param {string} executable */
export function findExecutable(executable) {
  return findAdapterExecutable(executable)?.executable ?? null;
}

/** Backward-compatible single-attempt probe. @param {string} executablePath @param {string[]} args */
export function safeProbe(executablePath, args = ['--version']) {
  const result = safeAdapterProbe(executablePath, [args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

/** @param {'generic' | 'codex'} host @param {Record<string, any>} contract */
export function probeCoreHost(host, contract) {
  return probeAdapter(host, { contract });
}

/**
 * Compatibility wrapper retained for v0.1 consumers.
 * @param {string} root
 * @param {{host: string, command?: string | null, cwd?: string}} request
 */
export async function executeCoreHost(root, request) {
  return executeAdapter(root, {
    adapter: request.host,
    command: request.command,
    cwd: request.cwd,
  });
}

/** @param {string} root */
export async function coreDoctor(root) {
  const { contract } = await assertLockedContract(root).catch(() => ({ contract: { adapters: {} } }));
  const reports = probeAllAdapters({ contract, root });
  return {
    schema: 'shipping-harness/doctor-v1',
    node: {
      version: process.version,
      supported: Number.parseInt(process.versions.node.split('.')[0], 10) >= 22,
    },
    git: {
      executable: findExecutable('git'),
    },
    adapters: reports,
    hosts: reports,
  };
}