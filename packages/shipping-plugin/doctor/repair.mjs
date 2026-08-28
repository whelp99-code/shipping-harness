import { installShippingPlugin } from '../installer/install.mjs';
import { doctorShippingPlugin } from './doctor.mjs';

/**
 * Repair only plugin assets/registration. Repository .shipping state is read-only.
 * @param {{packageRoot: string, installRoot: string, host?: 'generic'|'codex', codexHome?: string|null, codexExecutable?: string, projectRoot?: string|null, dryRun?: boolean, run?: any}} input
 */
export async function repairShippingPlugin(input) {
  const before = await doctorShippingPlugin(input);
  if (before.healthy) return { schema: 'shipping-plugin/repair-v1', dryRun: input.dryRun !== false, changed: false, before, after: before };
  if (input.dryRun !== false) {
    return {
      schema: 'shipping-plugin/repair-v1',
      dryRun: true,
      changed: false,
      before,
      plannedActions: before.repairActions.filter((entry) => entry !== 'inspect-project-only'),
      refusesProjectStateMutation: true,
    };
  }
  const install = await installShippingPlugin({
    ...input,
    dryRun: false,
    replace: true,
  });
  const after = await doctorShippingPlugin(input);
  return {
    schema: 'shipping-plugin/repair-v1',
    dryRun: false,
    changed: install.changed,
    before,
    install,
    after,
    healthy: after.healthy,
    refusesProjectStateMutation: true,
  };
}
