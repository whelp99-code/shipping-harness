import path from 'node:path';
import { assertLockedContract } from '../core/contract.mjs';
import { loadEvidence } from '../core/evidence.mjs';
import { exists, readJson } from '../core/fs.mjs';
import { releaseStatus } from '../core/gate.mjs';
import { runtimePaths } from '../core/paths.mjs';
import { ShippingError } from '../core/errors.mjs';
import { buildBlockerView, buildUserStatusView } from './user-view.mjs';

export const SHIPPING_RESOURCES = Object.freeze([
  { uri: 'shipping://current/status', name: 'Current beginner status', description: 'Concise truthful state and next action.', mimeType: 'application/json' },
  { uri: 'shipping://current/blockers', name: 'Current release blockers', description: 'Only issues that currently block release.', mimeType: 'application/json' },
  { uri: 'shipping://current/contract', name: 'Locked release summary', description: 'Goal, included/deferred scope, acceptance, and budgets.', mimeType: 'application/json' },
  { uri: 'shipping://current/evidence', name: 'Current evidence summary', description: 'Bounded summary of the latest verification evidence.', mimeType: 'application/json' },
  { uri: 'shipping://current/backlog', name: 'Deferred backlog', description: 'Items deferred to a later version.', mimeType: 'application/json' },
]);

export function listShippingResources() {
  return SHIPPING_RESOURCES.map((entry) => ({ ...entry }));
}

function jsonContent(uri, value) {
  return { uri, mimeType: 'application/json', text: `${JSON.stringify(value, null, 2)}\n` };
}

/** @param {string} root @param {string} uri */
export async function readShippingResource(root, uri) {
  if (!SHIPPING_RESOURCES.some((resource) => resource.uri === uri)) {
    throw new ShippingError('ERR_MCP_RESOURCE_UNKNOWN', `Unknown Shipping resource: ${uri}`);
  }
  const paths = runtimePaths(root);
  if (uri === 'shipping://current/status') {
    if (!(await exists(paths.state))) return jsonContent(uri, buildUserStatusView({ initialized: false }));
    return jsonContent(uri, buildUserStatusView(await releaseStatus(root)));
  }
  if (uri === 'shipping://current/blockers') {
    if (!(await exists(paths.state))) return jsonContent(uri, { schema: 'shipping-harness/blocker-view-v1', blockers: [], remainingFixCycles: 0 });
    return jsonContent(uri, buildBlockerView(await releaseStatus(root)));
  }
  if (uri === 'shipping://current/contract') {
    const { contract, lock } = await assertLockedContract(root);
    return jsonContent(uri, {
      schema: 'shipping-harness/contract-summary-v1',
      project: contract.project,
      release: contract.release,
      goal: contract.goal,
      included: contract.scope.include,
      deferred: contract.scope.exclude,
      acceptance: contract.acceptance.map(({ id, description, required }) => ({ id, description, required })),
      budgets: contract.budgets,
      contractHash: lock.contractHash,
      baselineSha: lock.baselineSha,
    });
  }
  if (uri === 'shipping://current/backlog') {
    const value = await exists(paths.backlog) ? await readJson(paths.backlog) : { schema: 'shipping-harness/backlog-v1', items: [] };
    return jsonContent(uri, value);
  }
  const status = await releaseStatus(root);
  const runId = status.state?.lastRunId;
  if (!runId) return jsonContent(uri, { schema: 'shipping-harness/evidence-summary-v1', available: false, reason: 'No verification run exists.' });
  const evidence = await loadEvidence(root, runId);
  const results = Array.isArray(evidence.manifest?.results) ? evidence.manifest.results : [];
  return jsonContent(uri, {
    schema: 'shipping-harness/evidence-summary-v1',
    available: true,
    runId,
    gitSha: evidence.manifest?.gitSha ?? status.state.currentEvidenceSha ?? null,
    contractHash: evidence.manifest?.contractHash ?? status.state.contractHash ?? null,
    summary: evidence.manifest?.summary ?? null,
    results: results.slice(0, 50).map((entry) => ({
      criterionId: entry.criterionId,
      status: entry.status,
      required: entry.required,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      logPath: entry.logPath ? path.relative(root, entry.logPath).replaceAll('\\', '/') : null,
    })),
    truncated: results.length > 50,
  });
}
