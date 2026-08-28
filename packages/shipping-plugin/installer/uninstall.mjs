import { readFile, rm } from 'node:fs/promises';
import { invariant } from '../../../src/core/errors.mjs';
import { exists } from '../../../src/core/fs.mjs';
import { removeCodexRegistration } from './host-registration.mjs';
import { pluginPaths } from './paths.mjs';

/**
 * @param {{installRoot: string, dryRun?: boolean, run?: any, allowMissing?: boolean}} input
 */
export async function uninstallShippingPlugin(input) {
  const paths = pluginPaths(input.installRoot);
  if (!(await exists(paths.receipt))) {
    invariant(input.allowMissing !== false, 'ERR_PLUGIN_NOT_INSTALLED', 'Shipping plugin installation receipt was not found');
    return {
      schema: 'shipping-harness/plugin-uninstall-result-v1',
      dryRun: input.dryRun !== false,
      changed: false,
      missing: true,
      pluginHome: paths.pluginHome,
    };
  }
  const receipt = JSON.parse(await readFile(paths.receipt, 'utf8'));
  invariant(receipt.schema === 'shipping-harness/plugin-install-receipt-v1', 'ERR_PLUGIN_RECEIPT', 'Unsupported Shipping plugin receipt schema');
  const plan = {
    pluginHome: paths.pluginHome,
    host: receipt.host,
    registration: receipt.registration,
    preserves: receipt.preserves ?? [],
  };
  if (input.dryRun !== false) {
    return { schema: 'shipping-harness/plugin-uninstall-result-v1', dryRun: true, changed: false, missing: false, plan };
  }
  const hostResult = receipt.host === 'codex'
    ? removeCodexRegistration(receipt.registration, { run: input.run, allowMissing: true })
    : { changed: false, missing: false, profileRemovedWithPluginHome: true };
  await rm(paths.pluginHome, { recursive: true, force: false });
  return {
    schema: 'shipping-harness/plugin-uninstall-result-v1',
    dryRun: false,
    changed: true,
    missing: false,
    plan,
    hostResult,
    preserved: plan.preserves,
  };
}
