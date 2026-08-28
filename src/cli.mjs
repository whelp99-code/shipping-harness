import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs, booleanOption, stringOption } from './cli/args.mjs';
import { printJson, renderHelp, renderStatus } from './cli/output.mjs';
import { initializeContract, loadContract, lockContract, contractHash } from './core/contract.mjs';
import { assertContainedPath, exists, fileSize, readText } from './core/fs.mjs';
import { findGitRoot, currentGitSha } from './core/git.mjs';
import { runtimePaths } from './core/paths.mjs';
import { abort, initializeState, pause, readState, resume, transitionState } from './core/state.mjs';
import { addManualIssue } from './core/issues.mjs';
import { beginFixCycle, closeRelease, releaseStatus, verifyRelease } from './core/gate.mjs';
import { coreDoctor } from './core/host.mjs';
import { normalizeError, ShippingError } from './core/errors.mjs';
import { collectAdapterArtifacts, listAdapters, probeAdapter, probeAllAdapters } from './adapters/registry.mjs';
import { executeAdapter } from './adapters/runner.mjs';
import { decideStop, ingestLifecycleEvent } from './core/hooks.mjs';
import { prepareNextRelease } from './core/release-transition.mjs';
import { VERSION } from './version.mjs';

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

  const root = resolveRoot(rootOption);
  const paths = runtimePaths(root);

  if (command === 'init') {
    const projectName = stringOption(options, 'project') || path.basename(root);
    const initialized = await initializeContract(root, projectName);
    await initializeState(root);
    await ensureRuntimeIgnore(root);
    const result = { root, contract: initialized.path, state: paths.state, next: 'Edit and commit the contract, then run `shipping-harness lock`.' };
    if (json) printJson(result);
    else process.stdout.write(`Initialized Shipping Harness in ${root}\nContract: ${initialized.path}\n${result.next}\n`);
    return 0;
  }

  if (command === 'contract') {
    const action = positionals[1] ?? 'check';
    const contract = await loadContract(paths.contract);
    const result = { valid: true, hash: contractHash(contract), contract };
    if (action === 'show' || json) printJson(result);
    else if (action === 'check') process.stdout.write(`Contract valid: ${result.hash}\n`);
    else throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown contract action: ${action}`);
    return 0;
  }

  if (command === 'lock') {
    const state = await readState(root);
    if (state.state !== 'DRAFT') throw new ShippingError('ERR_LOCK_STATE', `Contract can lock only from DRAFT, current state is ${state.state}`);
    const sha = currentGitSha(root);
    const { contract, lock } = await lockContract(root, sha);
    const updated = await transitionState(root, 'LOCKED', {
      release: contract.release,
      contractHash: lock.contractHash,
      baselineSha: lock.baselineSha,
    }, 'contract locked by operator');
    const result = { root, contractHash: lock.contractHash, baselineSha: sha, state: updated.state };
    if (json) printJson(result);
    else process.stdout.write(`Locked ${contract.project} ${contract.release}\nContract: ${lock.contractHash}\nBaseline: ${sha}\n`);
    return 0;
  }

  if (command === 'release') {
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

  if (command === 'adapter') {
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
    if (action === 'probe') {
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
    if (action === 'collect') {
      const requested = positionals[2] ?? stringOption(options, 'adapter');
      if (!requested) throw new ShippingError('ERR_ADAPTER_REQUIRED', 'Provide an adapter name');
      const result = await collectAdapterArtifacts(requested, { contract, root });
      if (json) printJson(result);
      else process.stdout.write(`${result.adapter}: collected ${result.collected.length}, missing ${result.missing.length}\n`);
      return 0;
    }
    throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown adapter action: ${action}`);
  }

  if (command === 'run') {
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

  if (command === 'hook') {
    const action = positionals[1];
    const adapter = stringOption(options, 'adapter', 'omo');
    const event = stringOption(options, 'event', 'Stop');
    const runId = stringOption(options, 'run-id');
    if (action === 'decision') {
      const result = await decideStop(root, { adapter, event, runId });
      if (json) printJson(result);
      else process.stdout.write(`${result.action}: ${result.reasonCode} (state=${result.state}, blockers=${result.blockers})\n`);
      return result.continue ? 3 : 0;
    }
    if (action === 'ingest') {
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
    throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown hook action: ${action ?? '(missing)'}`);
  }

  if (command === 'verify') {
    const result = await verifyRelease(root);
    if (json) printJson(result);
    else process.stdout.write(`Release decision: ${result.decision}\nPass: ${result.manifest.summary.passed}/${result.manifest.summary.total}\nBlockers: ${result.issues.counts.BLOCKER}\n`);
    return result.decision === 'SHIPPABLE' ? 0 : 2;
  }

  if (command === 'fix') {
    const result = await beginFixCycle(root);
    if (json) printJson(result);
    else process.stdout.write(`Fix cycle ${result.fixCycles} started.\n`);
    return result.state === 'BLOCKED' ? 2 : 0;
  }

  if (command === 'pause') {
    const result = await pause(root, stringOption(options, 'reason', 'operator pause'));
    if (json) printJson(result);
    else process.stdout.write(`Paused from ${result.resumeState}.\n`);
    return 0;
  }

  if (command === 'resume') {
    const result = await resume(root, stringOption(options, 'reason', 'operator resume'));
    if (json) printJson(result);
    else process.stdout.write(`Resumed to ${result.state}.\n`);
    return 0;
  }

  if (command === 'abort') {
    const result = await abort(root, stringOption(options, 'reason', 'operator abort'));
    if (json) printJson(result);
    else process.stdout.write(`Release aborted: ${result.abortReason}\n`);
    return 0;
  }

  if (command === 'issue' && positionals[1] === 'add') {
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

  if (command === 'close') {
    const result = await closeRelease(root);
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

  if (command === 'status') {
    const result = await releaseStatus(root);
    if (json) printJson(result);
    else process.stdout.write(renderStatus(result));
    return result.state.state === 'BLOCKED' || result.state.blockerCount > 0 ? 2 : 0;
  }

  if (command === 'doctor') {
    const result = await coreDoctor(root);
    if (json) printJson(result);
    else {
      process.stdout.write(`Node ${result.node.version}: ${result.node.supported ? 'supported' : 'unsupported'}\n`);
      for (const adapter of result.adapters) process.stdout.write(`${adapter.name}: ${adapter.verificationLevel}${adapter.version ? ` (${adapter.version})` : ''}\n`);
    }
    return result.node.supported && result.git.executable ? 0 : 2;
  }

  throw new ShippingError('ERR_COMMAND_UNKNOWN', `Unknown command: ${command}`);
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