import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertContainedPath, ensureDir, exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { runBoundedCommand } from './process.mjs';
import { runIsolatedAcceptance } from './isolated-verification.mjs';
import { invariant, ShippingError } from './errors.mjs';

/** @param {string} value */
function safeName(value) {
  return value.replace(/[^0-9A-Za-z._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 100) || 'criterion';
}

/**
 * @param {string} root
 * @param {Record<string, any>} contract
 * @param {Record<string, any>} lock
 * @param {string} gitSha
 */
export async function runAcceptance(root, contract, lock, gitSha) {
  const paths = runtimePaths(root);
  const runId = `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const runDirectory = path.join(paths.evidence, runId);
  await ensureDir(runDirectory);

  const results = [];
  for (const criterion of contract.acceptance) {
    const relativeCwd = criterion.cwd ?? '.';
    const commandCwd = path.resolve(root, relativeCwd);
    await assertContainedPath(root, commandCwd);
    const timeoutSeconds = Math.min(
      criterion.timeoutSeconds ?? contract.budgets.maxCommandSeconds,
      contract.budgets.maxCommandSeconds,
    );
    const commandInput = {
      timeoutSeconds,
      maxOutputBytes: contract.budgets.maxOutputBytes,
      env: {
        SHIPPING_HARNESS_RUN_ID: runId,
        SHIPPING_HARNESS_CRITERION_ID: criterion.id,
        SHIPPING_HARNESS_CONTRACT_HASH: lock.contractHash,
        SHIPPING_HARNESS_GIT_SHA: gitSha,
      },
    };
    const result = criterion.isolationRequired === true
      ? await runIsolatedAcceptance(root, gitSha, criterion, commandInput)
      : await runBoundedCommand({ command: criterion.command, cwd: commandCwd, ...commandInput });
    const passed = result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded
      && result.deterministicMismatch !== true && result.sourceMutationDetected !== true;
    const logName = `${safeName(criterion.id)}.log`;
    const logPath = path.join(runDirectory, logName);
    const log = [
      `criterion: ${criterion.id}`,
      `description: ${criterion.description}`,
      `command: ${criterion.command}`,
      `cwd: ${relativeCwd}`,
      `exitCode: ${String(result.exitCode)}`,
      `signal: ${String(result.signal)}`,
      `timedOut: ${String(result.timedOut)}`,
      `outputLimitExceeded: ${String(result.outputLimitExceeded)}`,
      `sideEffect: ${criterion.sideEffect ?? 'none-or-test-output'}`,
      `isolationRequired: ${String(criterion.isolationRequired === true)}`,
      `deterministic: ${String(result.isolation?.deterministic ?? true)}`,
      `sourceUnchanged: ${String(result.isolation?.sourceUnchanged ?? true)}`,
      `stdoutDigest: ${result.stdoutDigest}`,
      `stderrDigest: ${result.stderrDigest}`,
      '',
      '--- stdout (redacted) ---',
      result.stdout,
      '',
      '--- stderr (redacted) ---',
      result.stderr,
      '',
    ].join('\n');
    await writeAtomic(logPath, log);
    results.push({
      criterionId: criterion.id,
      description: criterion.description,
      required: criterion.required,
      status: passed ? 'PASS' : 'FAIL',
      command: criterion.command,
      cwd: relativeCwd,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      outputLimitExceeded: result.outputLimitExceeded,
      capturedBytes: result.capturedBytes,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdoutDigest: result.stdoutDigest,
      stderrDigest: result.stderrDigest,
      sideEffect: criterion.sideEffect ?? 'none-or-test-output',
      isolationRequired: criterion.isolationRequired === true,
      deterministicOutputRequired: criterion.deterministicOutputRequired === true,
      isolation: result.isolation ?? null,
      deterministicMismatch: result.deterministicMismatch === true,
      sourceMutationDetected: result.sourceMutationDetected === true,
      logPath: path.relative(root, logPath).replaceAll('\\', '/'),
    });
  }

  const manifest = {
    schema: 'shipping-harness/evidence-v1',
    runId,
    release: contract.release,
    contractHash: lock.contractHash,
    gitSha,
    baselineSha: lock.baselineSha,
    startedAt: results[0]?.startedAt ?? new Date().toISOString(),
    finishedAt: results.at(-1)?.finishedAt ?? new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.status === 'PASS').length,
      failed: results.filter((item) => item.status === 'FAIL').length,
      requiredFailed: results.filter((item) => item.required && item.status === 'FAIL').length,
    },
  };
  const manifestPath = path.join(runDirectory, 'manifest.json');
  await writeJsonAtomic(manifestPath, manifest);
  return { manifest, manifestPath };
}

/**
 * Record one baseline replay per replayed criterion into the stored evidence manifest.
 * The manifest is the audit record of the verification, so the replay belongs in it.
 * @param {string} root
 * @param {Record<string, any>} manifest
 * @param {Array<Record<string, any>>} replays
 * @returns {Promise<Record<string, any>>}
 */
export async function recordBaselineReplays(root, manifest, replays) {
  if (!Array.isArray(replays) || replays.length === 0) return manifest;
  const byId = new Map(replays.map((row) => [row.id, row]));
  const updated = {
    ...manifest,
    results: manifest.results.map((result) => {
      const row = byId.get(result.criterionId);
      return row
        ? { ...result, baselineReplay: { id: row.id, exitCode: row.exitCode, durationMs: row.durationMs } }
        : result;
    }),
  };
  const manifestPath = path.join(runtimePaths(root).evidence, manifest.runId, 'manifest.json');
  await writeJsonAtomic(manifestPath, updated);
  return updated;
}

/** @param {string} root @param {string} runId */
export async function loadEvidence(root, runId) {
  const manifestPath = path.join(runtimePaths(root).evidence, runId, 'manifest.json');
  if (!(await exists(manifestPath))) {
    throw new ShippingError('ERR_EVIDENCE_MISSING', `Evidence manifest is missing for ${runId}`, { runId, manifestPath });
  }
  return readJson(manifestPath);
}

/**
 * @param {Record<string, any>} manifest
 * @param {{contractHash: string, gitSha: string}} expected
 */
export function assertFreshEvidence(manifest, expected) {
  invariant(manifest.contractHash === expected.contractHash, 'ERR_EVIDENCE_STALE', 'Evidence belongs to a different contract', {
    expected: expected.contractHash,
    actual: manifest.contractHash,
  });
  invariant(manifest.gitSha === expected.gitSha, 'ERR_EVIDENCE_STALE', 'Evidence belongs to a different Git SHA', {
    expected: expected.gitSha,
    actual: manifest.gitSha,
  });
  invariant(Array.isArray(manifest.results), 'ERR_EVIDENCE_INVALID', 'Evidence results are invalid');
  return manifest;
}