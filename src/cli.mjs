import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs, booleanOption, stringOption } from './cli/args.mjs';
import { printJson, renderHelp, renderStatus } from './cli/output.mjs';
import { initializeContract, loadContract, lockContract, contractHash } from './core/contract.mjs';
import { exists, readText } from './core/fs.mjs';
import { findGitRoot, currentGitSha } from './core/git.mjs';
import { runtimePaths } from './core/paths.mjs';
import { abort, initializeState, pause, readState, resume, transitionState } from './core/state.mjs';
import { addManualIssue } from './core/issues.mjs';
import { beginFixCycle, closeRelease, releaseStatus, verifyRelease } from './core/gate.mjs';
import { coreDoctor, executeCoreHost } from './core/host.mjs';
import { normalizeError, ShippingError } from './core/errors.mjs';

const VERSION = '0.1.0';

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

  if (command === 'run') {
    const host = stringOption(options, 'host', 'generic');
    if (!['generic', 'codex'].includes(host)) throw new ShippingError('ERR_HOST_UNKNOWN', `Unsupported v0.1 host: ${host}`);
    const manifest = await executeCoreHost(root, {
      host,
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
      for (const host of result.hosts) process.stdout.write(`${host.name}: ${host.verificationLevel}${host.version ? ` (${host.version})` : ''}\n`);
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