import { invariant } from './errors.mjs';
import { isWeakCommand } from './acceptance-proof.mjs';

/**
 * Compile a ready discovery direction into the goal and acceptance that lock will bind.
 * Does not grant approval, closure, or release authority.
 * @param {Record<string, any>} direction
 * @param {Array<Record<string, any>>} acceptance
 * @returns {{goal: string, acceptance: Array<Record<string, any>>}}
 */
export function compileDiscoveryLock(direction, acceptance) {
  invariant(direction && typeof direction === 'object', 'ERR_DISCOVERY_LOCK', 'Discovery direction is required');
  invariant(direction.modelAuthority === false && direction.commandAuthority === false, 'ERR_DISCOVERY_LOCK', 'Discovery direction cannot carry model or command authority');
  invariant(direction.approvalAuthority === false && direction.closureAuthority === false && direction.released === false, 'ERR_DISCOVERY_LOCK', 'Discovery direction cannot approve, close, or release');
  const goal = String(direction.outcome ?? '').trim();
  invariant(goal.length > 0, 'ERR_DISCOVERY_LOCK', 'Discovery direction has no outcome to lock');
  const criteria = (Array.isArray(direction.successCriteria) ? direction.successCriteria : [])
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .slice(0, 6);
  const next = (acceptance ?? []).map((entry) => ({ ...entry }));
  const host = next.find((entry) => entry && !isWeakCommand(entry.command));
  if (host && criteria.length > 0) {
    const named = criteria.map((entry) => `User outcome: ${entry}`).join(' ');
    host.description = `${named}. ${host.description ?? ''}`.trim().slice(0, 1000);
  }
  return { goal, acceptance: next };
}
