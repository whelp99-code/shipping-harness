import { STABLE_SCHEMAS } from './schema-registry.mjs';

const SHIPPING_HEALTHY = new Set(['DRAFT', 'LOCKED', 'RUNNING', 'VERIFYING', 'TRIAGE', 'FIXING', 'PAUSED', 'SHIPPABLE', 'CLOSED']);
const OMO_HEALTHY = new Set(['live', 'UNAVAILABLE', 'DISABLED']);
const REMOTE_HEALTHY = new Set(['healthy', 'DISABLED']);

/**
 * `shippingStatus.state` is normally the release state object from `releaseStatus()`; callers that
 * already flattened it may pass the state name directly, hence the string-carrying intersection.
 * @typedef {{state?: string & {state?: string}}} ShippingStatusLike
 */

/**
 * @param {{shippingStatus?: ShippingStatusLike, pluginDoctor?: {healthy?: boolean}, omoProbe?: {status?: string}, remoteHealth?: {status?: string}}} options
 * @returns {{schema: string, status: 'HEALTHY'|'DEGRADED', checks: {shipping: string, plugin: string, omo: string, remote: string}, reasons: string[], internalOnly: true}}
 */
export function stableHealth({ shippingStatus, pluginDoctor, omoProbe, remoteHealth }) {
  const checks = {
    shipping: shippingStatus?.state?.state ?? shippingStatus?.state ?? 'UNKNOWN',
    plugin: pluginDoctor?.healthy === true ? 'HEALTHY' : 'DEGRADED',
    omo: omoProbe?.status ?? 'UNAVAILABLE',
    remote: remoteHealth?.status ?? 'DISABLED',
  };
  const reasons = [];
  if (!SHIPPING_HEALTHY.has(checks.shipping) || checks.shipping === 'BLOCKED' || checks.shipping === 'ABORTED') reasons.push(`shipping:${checks.shipping}`);
  if (checks.plugin !== 'HEALTHY') reasons.push('plugin:DEGRADED');
  if (!OMO_HEALTHY.has(checks.omo)) reasons.push(`omo:${checks.omo}`);
  if (!REMOTE_HEALTHY.has(checks.remote)) reasons.push(`remote:${checks.remote}`);
  return {
    schema: STABLE_SCHEMAS.health,
    status: reasons.length > 0 ? 'DEGRADED' : 'HEALTHY',
    checks,
    reasons,
    internalOnly: true,
  };
}
