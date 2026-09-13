import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLockedContract } from '../../src/core/contract.mjs';
import { hashObject } from '../../src/core/crypto.mjs';
import { ensureDir, writeJsonAtomic } from '../../src/core/fs.mjs';
import { beginAgentRun, finishAgentRun, verifyRelease } from '../../src/core/gate.mjs';
import { addManualIssue } from '../../src/core/issues.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { patchState, readState, recordLedger, transitionState } from '../../src/core/state.mjs';
import { adapterConfiguration, configuredCommand } from '../../src/adapters/sdk.mjs';
import { executeAdapter } from '../../src/adapters/runner.mjs';
import { normalizeError } from '../../src/core/errors.mjs';
import { executePrivateOmoRuntime, privateOmoDoctor } from './client.mjs';

/**
 * @param {Record<string, unknown>} contract
 * @returns {'codex'|'generic'|null}
 */
function configuredFallback(contract) {
  for (const adapter of /** @type {const} */ (['codex', 'generic'])) {
    if (configuredCommand(adapterConfiguration(contract, adapter))) return adapter;
  }
  return null;
}

async function writeRuntimeEvidence(root, body) {
  const id = `omo-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(runtimePaths(root).evidence, id);
  await ensureDir(directory);
  const document = {
    schema: 'shipping-harness/private-omo-evidence-v1',
    id,
    createdAt: new Date().toISOString(),
    ...body,
  };
  const evidencePath = path.join(directory, 'manifest.json');
  await writeJsonAtomic(evidencePath, document);
  return { id, evidencePath, document };
}

/**
 * Execute the private OMO runtime only through a locked Shipping release.
 * Runtime completion is recorded as a claim. Independent Shipping verification remains mandatory.
 * @param {string} root
 * @param {{mode?: 'probe'|'native', prompt?: string, requestedAgent?: 'builder'|'tester'|'reviewer', requestedModel?: string|null, verifyAfter?: boolean, timeoutMs?: number}} [options]
 */
export async function executeShippingPrivateOmo(root, options = {}) {
  const { contract, lock } = await assertLockedContract(root);
  let health;
  try {
    health = await privateOmoDoctor(root);
  } catch (error) {
    const normalized = normalizeError(error);
    const fallback = configuredFallback(contract);
    if (fallback) {
      const adapterRun = await executeAdapter(root, { adapter: fallback });
      await recordLedger(root, {
        type: 'private-omo.fallback',
        reason: normalized,
        fallback,
        adapterRunId: adapterRun.runId,
      });
      const verification = options.verifyAfter === false ? null : await verifyRelease(root);
      return {
        schema: 'shipping-harness/private-omo-fallback-v1',
        mode: 'approved-fallback',
        fallback,
        runtimeError: normalized,
        adapterRun,
        verification,
      };
    }

    await beginAgentRun(root, 'private-omo');
    const evidence = await writeRuntimeEvidence(root, {
      contractHash: lock.contractHash,
      release: contract.release,
      status: 'unavailable',
      runtimeError: normalized,
      fallback: 'blocked',
    });
    await addManualIssue(root, {
      title: 'Private OMO runtime unavailable and no approved fallback is configured',
      description: normalized.message,
      classification: 'BLOCKER',
      basisId: 'REQ-OMO-007',
      evidenceRef: path.relative(root, evidence.evidencePath).replaceAll('\\', '/'),
      source: 'private-omo',
      runId: evidence.id,
    });
    const state = await transitionState(root, 'BLOCKED', {
      blockerCount: Math.max(1, (await readState(root)).blockerCount),
      lastAgentResult: { adapter: 'private-omo', status: 'unavailable', evidencePath: evidence.evidencePath },
    }, 'private OMO unavailable without an approved fallback');
    return {
      schema: 'shipping-harness/private-omo-fallback-v1',
      mode: 'blocked',
      runtimeError: normalized,
      evidence,
      state,
      verification: null,
    };
  }

  await beginAgentRun(root, 'private-omo');
  try {
    const execution = await executePrivateOmoRuntime(root, options);
    const evidence = await writeRuntimeEvidence(root, {
      contractHash: lock.contractHash,
      release: contract.release,
      status: execution.receipt.status,
      health: execution.health,
      order: {
        work_order_id: execution.order.work_order_id,
        release_id: execution.order.release_id,
        shipping_session_id: execution.order.shipping_session_id,
        git_sha: execution.order.git_sha,
        goal_ids: execution.order.goal_ids,
        task_ids: execution.order.task_ids,
        requirement_ids: execution.order.requirement_ids,
        acceptance_ids: execution.order.acceptance_ids,
        allowed_paths: execution.order.allowed_paths,
        forbidden_paths: execution.order.forbidden_paths,
        budgets: execution.order.budgets,
        execution: {
          mode: execution.order.execution.mode,
          requested_agent: execution.order.execution.requested_agent,
          requested_model: execution.order.execution.requested_model,
          credential_mode: execution.order.execution.credential_mode,
        },
      },
      receipt: execution.receipt,
      receiptDigest: hashObject(execution.receipt),
      releaseCompletionTrusted: false,
      requiresShippingVerification: true,
    });
    const runResult = {
      adapter: 'private-omo',
      status: execution.receipt.status,
      exitCode: execution.runtimeExitCode,
      timedOut: execution.receipt.timed_out === true,
      outputLimitExceeded: execution.receipt.output_exceeded === true,
      evidencePath: path.relative(root, evidence.evidencePath).replaceAll('\\', '/'),
      receiptHash: execution.receipt.receipt_hash,
      requiresShippingVerification: true,
    };
    await finishAgentRun(root, runResult);
    await patchState(root, {
      lastPrivateOmoSessionId: execution.order.shipping_session_id,
      lastPrivateOmoReceiptHash: execution.receipt.receipt_hash,
      lastPrivateOmoEvidence: runResult.evidencePath,
    }, 'private OMO receipt recorded as an untrusted execution claim');
    await recordLedger(root, {
      type: 'private-omo.receipt',
      sessionId: execution.order.shipping_session_id,
      receiptHash: execution.receipt.receipt_hash,
      status: execution.receipt.status,
      evidencePath: runResult.evidencePath,
      releaseCompletionTrusted: false,
    });
    const verification = options.verifyAfter === false ? null : await verifyRelease(root);
    return {
      schema: 'shipping-harness/private-omo-execution-result-v1',
      mode: 'private-omo',
      health: {
        runtimeVersion: health.promotion.runtimeVersion,
        buildDigest: health.promotion.buildDigest,
      },
      execution,
      evidence,
      verification,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const evidence = await writeRuntimeEvidence(root, {
      contractHash: lock.contractHash,
      release: contract.release,
      status: 'failed',
      runtimeError: normalized,
      releaseCompletionTrusted: false,
    });
    await finishAgentRun(root, {
      adapter: 'private-omo',
      status: 'failed',
      exitCode: 1,
      timedOut: false,
      outputLimitExceeded: false,
      evidencePath: path.relative(root, evidence.evidencePath).replaceAll('\\', '/'),
      requiresShippingVerification: true,
    });
    throw error;
  }
}

/**
 * @param {Record<string, unknown>} contract
 * @returns {{mode: 'approved-fallback'|'blocked', adapter: 'codex'|'generic'|null}}
 */
export function privateOmoFallbackDecision(contract) {
  const fallback = configuredFallback(contract);
  return fallback
    ? { mode: 'approved-fallback', adapter: fallback }
    : { mode: 'blocked', adapter: null };
}
