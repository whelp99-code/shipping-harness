import { readFile } from 'node:fs/promises';
import { hashObject } from '../../../src/core/crypto.mjs';
import { exists } from '../../../src/core/fs.mjs';
import { inspectCodexRegistration } from '../installer/host-registration.mjs';
import { pluginPaths } from '../installer/paths.mjs';
import { inspectProjectRoot } from './project.mjs';

function receiptHashValid(receipt) {
  if (!receipt || typeof receipt !== 'object' || typeof receipt.receiptHash !== 'string') return false;
  const { receiptHash, ...body } = receipt;
  return receiptHash === hashObject(body);
}

/** @param {{installRoot: string, projectRoot?: string|null, run?: any}} input */
export async function doctorShippingPlugin(input) {
  const paths = pluginPaths(input.installRoot);
  const checks = [];
  let receipt = null;
  if (await exists(paths.receipt)) {
    try {
      receipt = JSON.parse(await readFile(paths.receipt, 'utf8'));
      checks.push({ id: 'receipt-readable', ok: true, detail: receipt.packageVersion ?? null });
      checks.push({ id: 'receipt-integrity', ok: receiptHashValid(receipt), detail: receipt.receiptHash ?? null });
    } catch (error) {
      checks.push({ id: 'receipt-readable', ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  } else {
    checks.push({ id: 'receipt-readable', ok: false, detail: 'install receipt is missing' });
  }
  for (const [id, target] of [
    ['manifest', paths.manifest],
    ['skill', paths.skill],
    ['instructions', paths.instructions],
    ['hooks', paths.hooks],
    ['registration-file', paths.registration],
  ]) checks.push({ id, ok: await exists(target), detail: target });

  if (receipt?.host === 'codex' && receipt.registration) {
    const observed = inspectCodexRegistration(receipt.registration, { run: input.run });
    checks.push({ id: 'codex-registration', ok: observed.exact, detail: observed.error ?? observed.observed });
  } else if (receipt?.host === 'generic') {
    checks.push({ id: 'generic-registration', ok: await exists(paths.registration), detail: paths.registration });
  }

  const project = await inspectProjectRoot(input.projectRoot ?? receipt?.projectRoot ?? null);
  const failed = checks.filter((entry) => !entry.ok);
  const repairActions = [];
  if (failed.some((entry) => ['receipt-readable', 'receipt-integrity', 'manifest', 'skill', 'instructions', 'hooks', 'registration-file'].includes(entry.id))) repairActions.push('reinstall-assets');
  if (failed.some((entry) => entry.id === 'codex-registration')) repairActions.push('repair-host-registration');
  if (!project.healthy) repairActions.push('inspect-project-only');
  return {
    schema: 'shipping-plugin/doctor-v1',
    healthy: failed.length === 0 && project.healthy,
    installRoot: paths.installRoot,
    pluginHome: paths.pluginHome,
    receipt,
    checks,
    project,
    repairActions,
    preservesProjectState: true,
  };
}
