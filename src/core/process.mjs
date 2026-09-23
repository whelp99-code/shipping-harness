import { spawn } from 'node:child_process';
import { sha256 } from './crypto.mjs';
import { redactSecrets } from './redaction.mjs';
import { ShippingError, invariant } from './errors.mjs';

/**
 * @typedef {object} CommandRequest
 * @property {string} command
 * @property {string} cwd
 * @property {number} timeoutSeconds
 * @property {number} maxOutputBytes
 * @property {Record<string, string | undefined>} [env]
 * @property {AbortSignal} [signal]
 */

/** @param {import('node:child_process').ChildProcess} child */
function terminate(child) {
  if (!child.pid || child.killed) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    // Killing the process group can fail if it was never created (e.g. detached: false); fall back to the direct child kill.
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Same process-group fallback as above, for the final forced kill.
        child.kill('SIGKILL');
      }
    }
  }, 500).unref();
}

/**
 * Execute an explicitly authorized command with hard time/output bounds.
 * Raw output is held only in bounded memory; only redacted output is returned.
 * @param {CommandRequest} request
 */
export async function runBoundedCommand(request) {
  invariant(typeof request.command === 'string' && request.command.trim(), 'ERR_COMMAND_INVALID', 'Command must be a non-empty string');
  invariant(Number.isInteger(request.timeoutSeconds) && request.timeoutSeconds > 0, 'ERR_COMMAND_INVALID', 'timeoutSeconds must be a positive integer');
  invariant(Number.isInteger(request.maxOutputBytes) && request.maxOutputBytes >= 1024, 'ERR_COMMAND_INVALID', 'maxOutputBytes must be >= 1024');

  const startedAt = new Date();
  /** @type {{stdout: Buffer[], stderr: Buffer[]}} */
  const chunks = { stdout: [], stderr: [] };
  let capturedBytes = 0;
  let outputLimitExceeded = false;
  let timedOut = false;

  const child = spawn(request.command, {
    cwd: request.cwd,
    env: { ...process.env, ...request.env },
    shell: true,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /** @param {'stdout' | 'stderr'} channel @param {Buffer} chunk */
  const capture = (channel, chunk) => {
    if (outputLimitExceeded) return;
    const remaining = request.maxOutputBytes - capturedBytes;
    if (remaining <= 0) {
      outputLimitExceeded = true;
      terminate(child);
      return;
    }
    if (chunk.length <= remaining) {
      chunks[channel].push(chunk);
      capturedBytes += chunk.length;
      return;
    }
    chunks[channel].push(chunk.subarray(0, remaining));
    capturedBytes += remaining;
    outputLimitExceeded = true;
    terminate(child);
  };

  child.stdout?.on('data', (chunk) => capture('stdout', Buffer.from(chunk)));
  child.stderr?.on('data', (chunk) => capture('stderr', Buffer.from(chunk)));

  const onAbort = () => terminate(child);
  if (request.signal) {
    if (request.signal.aborted) terminate(child);
    else request.signal.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    terminate(child);
  }, request.timeoutSeconds * 1000);
  timer.unref();

  const completion = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  }).catch((error) => {
    throw new ShippingError('ERR_COMMAND_SPAWN', `Unable to start command: ${request.command}`, {
      command: request.command,
      cwd: request.cwd,
      cause: error instanceof Error ? error.message : String(error),
    });
  });
  clearTimeout(timer);
  request.signal?.removeEventListener('abort', onAbort);

  const stdoutRaw = Buffer.concat(chunks.stdout);
  const stderrRaw = Buffer.concat(chunks.stderr);
  const finishedAt = new Date();
  const result = /** @type {{exitCode: number | null, signal: NodeJS.Signals | null}} */ (completion);

  return {
    command: request.command,
    cwd: request.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut,
    outputLimitExceeded,
    capturedBytes,
    maxOutputBytes: request.maxOutputBytes,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    stdoutDigest: sha256(stdoutRaw),
    stderrDigest: sha256(stderrRaw),
    stdout: redactSecrets(stdoutRaw.toString('utf8')),
    stderr: redactSecrets(stderrRaw.toString('utf8')),
  };
}