import { cp, mkdir, readFile } from 'node:fs/promises';
import { hashObject } from '../../../src/core/crypto.mjs';
import { invariant } from '../../../src/core/errors.mjs';
import { exists, writeJsonAtomic } from '../../../src/core/fs.mjs';
import { checkPluginCompatibility, assertPluginCompatibility } from './compatibility.mjs';
import { applyCodexRegistration, inspectCodexRegistration } from './host-registration.mjs';
import { createPluginInstallPlan } from './plan.mjs';
import { pluginPaths, validateCodexHome } from './paths.mjs';

/**
 * @param {{packageRoot: string, installRoot: string, host?: string, codexHome?: string|null, codexExecutable?: string, projectRoot?: string|null, dryRun?: boolean, replace?: boolean, run?: any, now?: string}} input
 */
export async function installShippingPlugin(input) {
  const plan = await createPluginInstallPlan(input);
  const compatibility = checkPluginCompatibility({
    host: plan.host,
    codexExecutable: plan.host === 'codex' ? plan.registration.executable : undefined,
    run: input.run,
  });
  assertPluginCompatibility(compatibility);
  if (input.dryRun !== false) {
    return { schema: 'shipping-harness/plugin-install-result-v1', dryRun: true, changed: false, plan, compatibility };
  }
  if (plan.host === 'codex') plan.registration.codexHome = validateCodexHome(input.codexHome);
  const paths = pluginPaths(plan.installRoot);
  if (await exists(paths.receipt)) {
    const previous = JSON.parse(await readFile(paths.receipt, 'utf8'));
    const sameReceipt = previous.schema === 'shipping-harness/plugin-install-receipt-v1' &&
      previous.planHash === plan.planHash && previous.packageVersion === plan.packageVersion && previous.host === plan.host;
    if (sameReceipt) {
      const registrationExact = plan.host === 'codex'
        ? inspectCodexRegistration(plan.registration, { run: input.run }).exact
        : await exists(paths.registration);
      if (registrationExact && await exists(paths.manifest) && await exists(paths.skill) && await exists(paths.instructions)) {
        return {
          schema: 'shipping-harness/plugin-install-result-v1',
          dryRun: false,
          changed: false,
          idempotent: true,
          plan,
          compatibility,
          hostResult: { changed: false, idempotent: true },
          receipt: previous,
        };
      }
    }
  }
  await mkdir(paths.pluginHome, { recursive: true });
  await cp(plan.assetSource, paths.assets, { recursive: true, force: true, errorOnExist: false });
  await writeJsonAtomic(paths.registration, {
    schema: 'shipping-harness/plugin-registration-v1',
    installedAt: input.now ?? new Date().toISOString(),
    host: plan.host,
    registration: plan.registration,
    planHash: plan.planHash,
    publicListener: false,
    arbitraryCommandInput: false,
  });
  const hostResult = plan.host === 'codex'
    ? applyCodexRegistration(plan.registration, { replace: input.replace === true, run: input.run })
    : { changed: true, idempotent: false, profileWritten: true };
  const installedAt = input.now ?? new Date().toISOString();
  const receiptBody = {
    schema: 'shipping-harness/plugin-install-receipt-v1',
    installedAt,
    packageRoot: plan.packageRoot,
    packageVersion: plan.packageVersion,
    installRoot: plan.installRoot,
    pluginHome: plan.pluginHome,
    projectRoot: plan.projectRoot,
    host: plan.host,
    registration: plan.registration,
    planHash: plan.planHash,
    hostResult: {
      changed: hostResult.changed,
      idempotent: hostResult.idempotent ?? false,
    },
    preserves: plan.preserves,
    publicListener: false,
    arbitraryCommandInput: false,
  };
  const receipt = { ...receiptBody, receiptHash: hashObject(receiptBody) };
  await writeJsonAtomic(paths.receipt, receipt);
  invariant(receipt.receiptHash.length === 64, 'ERR_PLUGIN_RECEIPT', 'Plugin receipt hash was not created');
  return { schema: 'shipping-harness/plugin-install-result-v1', dryRun: false, changed: true, plan, compatibility, hostResult, receipt };
}
