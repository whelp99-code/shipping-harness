import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs, booleanOption, stringOption } from './cli/args.mjs';
import { printJson, renderHelp, renderStatus } from './cli/output.mjs';
import { initializeContract, loadContract, lockContract, contractHash } from './core/contract.mjs';
import { assertContainedPath, exists, fileSize, readText } from './core/fs.mjs';
import { findGitRoot, currentGitSha } from './core/git.mjs';
import { runtimePaths } from './core/paths.mjs';
import { abort, initializeState, pause, readState, recordLedger, resume, transitionState } from './core/state.mjs';
import { addManualIssue } from './core/issues.mjs';
import { beginFixCycle, closeRelease, releaseStatus, verifyRelease } from './core/gate.mjs';
import { preflightWarnings, runAcceptancePreflight } from './core/contract-defect.mjs';
import { coreDoctor } from './core/host.mjs';
import { normalizeError, ShippingError } from './core/errors.mjs';
import { collectAdapterArtifacts, listAdapters, probeAdapter, probeAllAdapters } from './adapters/registry.mjs';
import { executeAdapter } from './adapters/runner.mjs';
import { decideStop, ingestLifecycleEvent } from './core/hooks.mjs';
import { prepareNextRelease } from './core/release-transition.mjs';
import { VERSION } from './version.mjs';
import { abortGoalRuntime, pauseGoalRuntime, resumeGoalRuntime } from './core/goals/authority.mjs';
import { analyzeRepository } from './core/project-analysis.mjs';
import { DEFAULT_PLAN_PATH, auditPlanHistory, computePlanProgress, loadShippingPlan, resolveAcceptanceRefs } from './core/shipping-plan.mjs';

/** @param {string | null} requested */
function resolveRoot(requested) {
  return findGitRoot(path.resolve(requested || process.cwd()));
}

/** @param {string} root */
async function ensureRuntimeIgnore(root) {
  const ignorePath = path.join(root, '.gitignore');
  const required = ['.shipping/evidence/', '.shipping/tmp/'];
  const existing = (await exists(ignorePath)) ? await readText(ignorePath) : '';
  const missing = required.filter((entry) => !existing.split(/\r?\n/u).includes(entry));
  if (missing.length > 0) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(ignorePath, `${existing}${prefix}${missing.join('\n')}\n`, 'utf8');
  }
}

/**
 * @typedef {{ root: string, paths: ReturnType<typeof runtimePaths>, positionals: string[], options: Record<string, any>, json: boolean }} CliContext
 */

/** @param {CliContext} ctx */
async function initCommand({ root, paths, options, json }) {
  const projectName = stringOption(options, 'project') || path.basename(root);
  const initialized = await initializeContract(root, projectName);
  await initializeState(root);
  await ensureRuntimeIgnore(root);
  const result = { root, contract: initialized.path, state: paths.state, next: 'Edit and commit the contract, then run `shipping-harness lock`.' };
  if (json) printJson(result);
  else process.stdout.write(`Initialized Shipping Harness in ${root}\nContract: ${initialized.path}\n${result.next}\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function contractCommand({ paths, positionals, json }) {
  const action = positionals[1] ?? 'check';
  const contract = await loadContract(paths.contract);
  const result = { valid: true, hash: contractHash(contract), contract };
  if (action === 'show' || json) printJson(result);
  else if (action === 'check') process.stdout.write(`Contract valid: ${result.hash}\n`);
  else throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown contract action: ${action}`);
  return 0;
}

/** @param {CliContext} ctx */
async function lockCommand({ root, paths, options, json }) {
  const state = await readState(root);
  if (state.state !== 'DRAFT') throw new ShippingError('ERR_LOCK_STATE', `Contract can lock only from DRAFT, current state is ${state.state}`);
  // Preflight runs before the lock, against the pre-implementation tree. It never blocks.
  const preflight = booleanOption(options, 'skip-preflight')
    ? null
    : await runAcceptancePreflight(root, await loadContract(paths.contract));
  const sha = currentGitSha(root);
  const { contract, lock } = await lockContract(root, sha);
  const updated = await transitionState(root, 'LOCKED', {
    release: contract.release,
    contractHash: lock.contractHash,
    baselineSha: lock.baselineSha,
  }, 'contract locked by operator');
  await recordLedger(root, { type: 'lock.preflight', release: contract.release, baselineSha: sha, acceptancePreflight: preflight });
  const result = { root, contractHash: lock.contractHash, baselineSha: sha, state: updated.state, acceptancePreflight: preflight };
  if (json) printJson(result);
  else {
    process.stdout.write(`Locked ${contract.project} ${contract.release}\nContract: ${lock.contractHash}\nBaseline: ${sha}\n`);
    for (const warning of preflightWarnings(preflight ?? [])) process.stdout.write(`WARNING: acceptance preflight: ${warning}\n`);
  }
  return 0;
}

/** @param {CliContext} ctx */
async function releaseCommand({ root, positionals, options, json }) {
  const action = positionals[1];
  if (action !== 'prepare') throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown release action: ${action ?? '(missing)'}`);
  const release = stringOption(options, 'version');
  if (!release) throw new ShippingError('ERR_RELEASE_VERSION', '--version is required');
  const result = await prepareNextRelease(root, {
    release,
    goal: stringOption(options, 'goal'),
  });
  const output = {
    fromRelease: result.fromRelease,
    release: result.release,
    state: result.state,
    contract: path.relative(root, result.contract).replaceAll('\\', '/'),
    archivedContract: path.relative(root, result.archivedContract).replaceAll('\\', '/'),
    archivedLock: result.archivedLock ? path.relative(root, result.archivedLock).replaceAll('\\', '/') : null,
  };
  if (json) printJson(output);
  else process.stdout.write(`Prepared ${output.release} from ${output.fromRelease}. Edit and commit ${output.contract}, then lock it.\n`);
  return 0;
}

/** @param {Record<string, any>} contract @param {string} root @param {string[]} positionals @param {Record<string, any>} options @param {boolean} json */
async function adapterProbeAction(contract, root, positionals, options, json) {
  const all = booleanOption(options, 'all');
  const requested = positionals[2];
  if (!all && !requested) throw new ShippingError('ERR_ADAPTER_REQUIRED', 'Provide an adapter name or --all');
  const result = all
    ? probeAllAdapters({ contract, root })
    : probeAdapter(requested, { contract, root });
  if (json) printJson(result);
  else {
    const reports = Array.isArray(result) ? result : [result];
    for (const report of reports) {
      process.stdout.write(`${report.name}: ${report.verificationLevel}${report.version ? ` (${report.version})` : ''}\n`);
    }
  }
  return 0;
}

/** @param {Record<string, any>} contract @param {string} root @param {string[]} positionals @param {Record<string, any>} options @param {boolean} json */
async function adapterCollectAction(contract, root, positionals, options, json) {
  const requested = positionals[2] ?? stringOption(options, 'adapter');
  if (!requested) throw new ShippingError('ERR_ADAPTER_REQUIRED', 'Provide an adapter name');
  const result = await collectAdapterArtifacts(requested, { contract, root });
  if (json) printJson(result);
  else process.stdout.write(`${result.adapter}: collected ${result.collected.length}, missing ${result.missing.length}\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function adapterCommand({ root, paths, positionals, options, json }) {
  const action = positionals[1] ?? 'list';
  if (action === 'list') {
    const result = listAdapters().map((adapter) => ({
      name: adapter.name,
      displayName: adapter.displayName,
      aliases: adapter.aliases,
    }));
    if (json) printJson(result);
    else for (const adapter of result) process.stdout.write(`${adapter.name}\t${adapter.displayName}\t${adapter.aliases.join(',')}\n`);
    return 0;
  }
  const contract = await loadContract(paths.contract);
  if (action === 'probe') return adapterProbeAction(contract, root, positionals, options, json);
  if (action === 'collect') return adapterCollectAction(contract, root, positionals, options, json);
  throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown adapter action: ${action}`);
}

/** @param {CliContext} ctx */
async function runCommand({ root, options, json }) {
  const host = stringOption(options, 'host', 'generic');
  const manifest = await executeAdapter(root, {
    adapter: host,
    command: stringOption(options, 'command'),
    cwd: stringOption(options, 'cwd', '.'),
  });
  let verification = null;
  if (booleanOption(options, 'verify', true)) verification = await verifyRelease(root);
  const result = { agent: manifest, verification };
  if (json) printJson(result);
  else process.stdout.write(`Agent run ${manifest.runId} finished. ${verification ? `Decision: ${verification.decision}` : 'Verification pending.'}\n`);
  return manifest.result.exitCode === 0 ? 0 : 2;
}

/** @param {string} root @param {string} adapter @param {string} event @param {string | null} runId @param {boolean} json */
async function hookDecisionAction(root, adapter, event, runId, json) {
  const result = await decideStop(root, { adapter, event, runId });
  if (json) printJson(result);
  else process.stdout.write(`${result.action}: ${result.reasonCode} (state=${result.state}, blockers=${result.blockers})\n`);
  return result.continue ? 3 : 0;
}

/** @param {string} root @param {string} adapter @param {string} event @param {string | null} runId @param {Record<string, any>} options @param {boolean} json */
async function hookIngestAction(root, adapter, event, runId, options, json) {
  let payload = null;
  const payloadFile = stringOption(options, 'payload-file');
  const inlinePayload = stringOption(options, 'payload');
  if (payloadFile) {
    const absolute = path.resolve(root, payloadFile);
    await assertContainedPath(root, absolute);
    const bytes = await fileSize(absolute);
    if (bytes > 64 * 1024) throw new ShippingError('ERR_HOOK_PAYLOAD_TOO_LARGE', 'Hook payload file exceeds 64 KiB', { bytes });
    payload = JSON.parse(await readFile(absolute, 'utf8'));
  } else if (inlinePayload) {
    payload = JSON.parse(inlinePayload);
  }
  const result = await ingestLifecycleEvent(root, { adapter, event, runId, payload });
  if (json) printJson(result);
  else process.stdout.write(`Recorded ${result.event.event} from ${result.event.adapter}${result.decision ? `; ${result.decision.action}` : ''}.\n`);
  return result.decision?.continue ? 3 : 0;
}

/** @param {CliContext} ctx */
async function hookCommand({ root, positionals, options, json }) {
  const action = positionals[1];
  const adapter = stringOption(options, 'adapter', 'omo');
  const event = stringOption(options, 'event', 'Stop');
  const runId = stringOption(options, 'run-id');
  if (action === 'decision') return hookDecisionAction(root, adapter, event, runId, json);
  if (action === 'ingest') return hookIngestAction(root, adapter, event, runId, options, json);
  throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown hook action: ${action ?? '(missing)'}`);
}

/** @param {CliContext} ctx */
async function verifyCommand({ root, options, json }) {
  const result = await verifyRelease(root, { baselineReplay: booleanOption(options, 'baseline-replay', true) });
  if (json) printJson(result);
  else process.stdout.write(`Release decision: ${result.decision}\nPass: ${result.manifest.summary.passed}/${result.manifest.summary.total}\nBlockers: ${result.issues.counts.BLOCKER}\n`);
  return result.decision === 'SHIPPABLE' ? 0 : 2;
}

/** @param {CliContext} ctx */
async function fixCommand({ root, json }) {
  const result = await beginFixCycle(root);
  if (json) printJson(result);
  else process.stdout.write(`Fix cycle ${result.fixCycles} started.\n`);
  return result.state === 'BLOCKED' ? 2 : 0;
}

/** @param {CliContext} ctx */
async function pauseCommand({ root, options, json }) {
  const reason = stringOption(options, 'reason', 'operator pause');
  const result = await pause(root, reason);
  await pauseGoalRuntime(root, reason);
  if (json) printJson(result);
  else process.stdout.write(`Paused from ${result.resumeState}.\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function resumeCommand({ root, options, json }) {
  const reason = stringOption(options, 'reason', 'operator resume');
  const result = await resume(root, reason);
  await resumeGoalRuntime(root, reason);
  if (json) printJson(result);
  else process.stdout.write(`Resumed to ${result.state}.\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function abortCommand({ root, options, json }) {
  const reason = stringOption(options, 'reason', 'operator abort');
  const result = await abort(root, reason);
  await abortGoalRuntime(root, reason);
  if (json) printJson(result);
  else process.stdout.write(`Release aborted: ${result.abortReason}\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function issueCommand({ root, positionals, options, json }) {
  if (positionals[1] !== 'add') throw new ShippingError('ERR_COMMAND_UNKNOWN', 'Unknown command: issue');
  const title = stringOption(options, 'title');
  if (!title) throw new ShippingError('ERR_ISSUE_TITLE', '--title is required');
  const document = await addManualIssue(root, {
    title,
    description: stringOption(options, 'description', ''),
    classification: String(stringOption(options, 'class', 'UNKNOWN')).toUpperCase(),
    basisId: stringOption(options, 'basis'),
    evidenceRef: stringOption(options, 'evidence'),
  });
  if (json) printJson(document);
  else process.stdout.write(`Issue recorded. Counts: ${JSON.stringify(document.counts)}\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function closeCommand({ root, options, json }) {
  const result = await closeRelease(root, { allowUncommitted: booleanOption(options, 'allow-uncommitted') });
  const output = {
    release: result.receipt.release,
    state: result.state.state,
    receipt: path.relative(root, result.receiptPath).replaceAll('\\', '/'),
    report: path.relative(root, result.reportPath).replaceAll('\\', '/'),
    backlog: result.backlog.items.length,
  };
  if (json) printJson(output);
  else process.stdout.write(`Closed ${output.release}\nReceipt: ${output.receipt}\nReport: ${output.report}\nBacklog items: ${output.backlog}\n`);
  return 0;
}

/** @param {CliContext} ctx */
async function statusCommand({ root, json }) {
  const result = await releaseStatus(root);
  if (json) printJson(result);
  else process.stdout.write(renderStatus(result));
  if (result.integrity?.ok === false) return 2;
  return result.state.state === 'BLOCKED' || result.state.blockerCount > 0 ? 2 : 0;
}

/** Fixed-width columns for the plain-text `plan status` table. @param {Array<{id: string, title: string, status: string, next: boolean}>} rows */
function renderPlanTable(rows) {
  const lines = ['ID       STATUS                    NEXT  TITLE'];
  for (const row of rows) {
    lines.push(`${row.id.padEnd(9)}${row.status.padEnd(26)}${row.next ? '<-- ' : '    '}${row.title}`);
  }
  return `${lines.join('\n')}\n`;
}

/** @param {string} root @param {Record<string, any>} options */
async function loadPlanForCli(root, options) {
  const planPath = stringOption(options, 'plan', DEFAULT_PLAN_PATH);
  const binding = await loadShippingPlan(root, planPath, { auditHistory: true });
  return { planPath, binding };
}

/**
 * Report a plan file that contradicts the evidence on disk as one VIOLATION line per
 * rewritten stage, and exit 1. It is a refusal, not a crash, so no stack is printed.
 * @param {Record<string, any>} error
 * @param {boolean} json
 * @returns {number}
 */
function reportPlanHistoryViolations(error, json) {
  if (json) {
    printJson({ ok: false, error: { code: error.code, message: error.message, details: error.details } });
    return 1;
  }
  for (const violation of /** @type {Array<Record<string, any>>} */ (error.details?.violations ?? [])) {
    const field = violation.field ? ` ${violation.field}` : '';
    process.stdout.write(`VIOLATION: ${violation.stageId} ${violation.kind}${field} (evidence: ${violation.evidence})\n`);
  }
  process.stdout.write(`${error.message} [${error.code}]\n`);
  return 1;
}

/** @param {CliContext} ctx */
async function planStatusCommand({ root, options, json }) {
  const { planPath, binding } = await loadPlanForCli(root, options);
  if (!binding) {
    const result = { present: false, path: planPath };
    if (json) printJson(result);
    else process.stdout.write(`No plan file at ${planPath}.\n`);
    return 0;
  }
  const progress = await computePlanProgress(root, binding.plan, { planHash: binding.progressPlanHash });
  const titles = new Map(binding.plan.stages.map((stage) => [stage.id, stage.title]));
  const rows = progress.stages.map((entry) => ({
    id: entry.id,
    title: titles.get(entry.id) ?? entry.id,
    status: entry.state,
    next: entry.id === progress.nextStageId,
  }));
  const result = { present: true, path: binding.path, planHash: binding.planHash, progress, stages: rows, diagnostics: binding.diagnostics };
  if (json) printJson(result);
  else {
    process.stdout.write(`Plan: ${binding.path} (${binding.planHash})\n`);
    process.stdout.write(`Progress: ${progress.done}/${progress.total} (${progress.percent}%)\n`);
    process.stdout.write(`Next: ${progress.nextStageId ?? '-'}\n`);
    for (const diagnostic of binding.diagnostics) process.stdout.write(`${diagnostic}\n`);
    process.stdout.write('\n');
    process.stdout.write(renderPlanTable(rows));
  }
  return 0;
}

/** @param {CliContext} ctx */
async function planCheckCommand({ root, options, json }) {
  const { planPath, binding } = await loadPlanForCli(root, options);
  const analysis = await analyzeRepository(root);
  const candidateCommandIds = analysis.candidateCommands.map((candidate) => candidate.id);
  const idsLine = `Candidate command IDs (for stages[].acceptanceRefs): ${candidateCommandIds.join(', ') || '(none detected)'}\n`;
  if (!binding) {
    const result = { present: false, valid: null, path: planPath, candidateCommandIds };
    if (json) printJson(result);
    else process.stdout.write(`No plan file at ${planPath}.\n${idsLine}`);
    return 0;
  }
  // A reference the analyzer cannot resolve keeps its stage out of READY; surface it here, before a proposal.
  const unresolvedAcceptanceRefs = Object.fromEntries([...resolveAcceptanceRefs(binding.plan, analysis).entries()]
    .filter(([, entry]) => entry.unresolved.length > 0)
    .map(([stageId, entry]) => [stageId, entry.unresolved]));
  const audit = await auditPlanHistory(root, binding.plan);
  const result = { present: true, valid: true, path: binding.path, planHash: binding.planHash, stageCount: binding.plan.stages.length, candidateCommandIds, unresolvedAcceptanceRefs, protectedStageIds: audit.protectedStageIds, diagnostics: binding.diagnostics };
  if (json) printJson(result);
  else {
    process.stdout.write(`Plan valid: ${binding.path} (${binding.planHash})\n`);
    process.stdout.write(`Stages: ${result.stageCount}\n${idsLine}`);
    process.stdout.write(`Stages already carrying evidence (immutable): ${audit.protectedStageIds.join(', ') || '(none)'}\n`);
    for (const diagnostic of binding.diagnostics) process.stdout.write(`${diagnostic}\n`);
    for (const [stageId, refs] of Object.entries(unresolvedAcceptanceRefs)) {
      process.stdout.write(`WARNING: stage ${stageId} references undetected commands (${refs.join(', ')}); it cannot become READY.\n`);
    }
  }
  return 0;
}

/** @param {CliContext} ctx */
async function planCommand(ctx) {
  const action = ctx.positionals[1] ?? 'status';
  if (action !== 'status' && action !== 'check') throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown plan action: ${action}`);
  try {
    return action === 'status' ? await planStatusCommand(ctx) : await planCheckCommand(ctx);
  } catch (error) {
    if (/** @type {Record<string, any>} */ (error)?.code !== 'ERR_PLAN_HISTORY_LOST') throw error;
    return reportPlanHistoryViolations(/** @type {Record<string, any>} */ (error), ctx.json);
  }
}

/** @param {CliContext} ctx */
async function doctorCommand({ root, json }) {
  const result = await coreDoctor(root);
  if (json) printJson(result);
  else {
    process.stdout.write(`Node ${result.node.version}: ${result.node.supported ? 'supported' : 'unsupported'}\n`);
    for (const adapter of result.adapters) process.stdout.write(`${adapter.name}: ${adapter.verificationLevel}${adapter.version ? ` (${adapter.version})` : ''}\n`);
  }
  return result.node.supported && result.git.executable ? 0 : 2;
}

/** Command name to handler. Populated after declaration so handlers can be defined above in reading order. */
const COMMANDS = Object.freeze({
  init: initCommand,
  contract: contractCommand,
  lock: lockCommand,
  release: releaseCommand,
  adapter: adapterCommand,
  run: runCommand,
  hook: hookCommand,
  verify: verifyCommand,
  fix: fixCommand,
  pause: pauseCommand,
  resume: resumeCommand,
  abort: abortCommand,
  issue: issueCommand,
  close: closeCommand,
  status: statusCommand,
  plan: planCommand,
  doctor: doctorCommand,
});

/** @param {string[]} argv */
export async function main(argv = process.argv.slice(2)) {
  const { positionals, options } = parseArgs(argv);
  const command = positionals[0] ?? 'help';
  const rootOption = stringOption(options, 'root');
  const json = booleanOption(options, 'json');

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(renderHelp());
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown command: ${command}`);

  const root = resolveRoot(rootOption);
  const paths = runtimePaths(root);
  return handler({ root, paths, positionals, options, json });
}

/** @param {unknown} error */
export function handleCliError(error) {
  const normalized = normalizeError(error);
  const jsonRequested = process.argv.includes('--json');
  if (jsonRequested) {
    printJson({ ok: false, error: { code: normalized.code, message: normalized.message, details: normalized.details } });
  } else {
    process.stderr.write(`shipping-harness: ${normalized.message} [${normalized.code}]\n`);
  }
  return normalized.exitCode;
}
