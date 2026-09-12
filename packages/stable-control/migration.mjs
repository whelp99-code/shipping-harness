import { randomUUID } from 'node:crypto';
import { stableInvariant } from './errors.mjs';
import { STABLE_SCHEMAS, stableSchemaDescriptor, validateStableArtifact } from './schema-registry.mjs';
import { readJson, readJsonLines } from '../../src/core/fs.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';
import { evaluateStateIntegrity, ledgerProvenState } from '../../src/core/state-integrity.mjs';
import { writeSignedState } from '../../src/core/state.mjs';

export const SUPPORTED_RELEASES = Object.freeze(['0.6.0', '0.7.0', '0.8.0', '0.9.0', '1.0.0']);

const LEGACY_SCHEMA_MAP = Object.freeze({
  'shipping-harness/goal-task-v1': STABLE_SCHEMAS.goalGraph,
  'shipping-harness/mcp-result-v1': STABLE_SCHEMAS.mcpSurface,
});

/**
 * @param {string} from
 * @param {string} [to]
 * @returns {Readonly<{from: string, to: string, supported: true}>}
 */
export function assertSupportedUpgrade(from, to = '1.0.0') {
  stableInvariant(SUPPORTED_RELEASES.includes(from), 'ERR_MIGRATION_VERSION', `Unsupported source release: ${from}`);
  stableInvariant(to === '1.0.0', 'ERR_MIGRATION_VERSION', `Unsupported target release: ${to}`);
  return Object.freeze({ from, to, supported: true });
}

function preserveAuthority(before, after) {
  if (before.state === 'CLOSED') stableInvariant(after.state === 'CLOSED', 'ERR_MIGRATION_AUTHORITY', 'Migration cannot reopen CLOSED work');
  if (before.humanStop === true) stableInvariant(after.humanStop === true, 'ERR_MIGRATION_AUTHORITY', 'Migration cannot remove human stop');
  if (before.contractHash !== undefined) stableInvariant(after.contractHash === before.contractHash, 'ERR_MIGRATION_AUTHORITY', 'Migration cannot change contract authority');
  if (before.gitSha !== undefined) stableInvariant(after.gitSha === before.gitSha, 'ERR_MIGRATION_AUTHORITY', 'Migration cannot change Git evidence binding');
  if (before.source_git_sha !== undefined) stableInvariant(after.source_git_sha === before.source_git_sha, 'ERR_MIGRATION_AUTHORITY', 'Migration cannot change runtime source binding');
  if (before.requires_shipping_verification === true) stableInvariant(after.requires_shipping_verification === true, 'ERR_MIGRATION_AUTHORITY', 'Migration cannot trust a runtime completion claim');
}

/** @param {Record<string, any>} value @param {{kind?: string}} [options] */
export function migrateArtifact(value, { kind } = {}) {
  stableInvariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_MIGRATION_ARTIFACT', 'Migration input must be an object');
  const original = value.schema ?? value.rpc;
  stableInvariant(typeof original === 'string' && original.length > 0, 'ERR_MIGRATION_ARTIFACT', 'Migration input has no schema discriminator');
  const target = LEGACY_SCHEMA_MAP[original] ?? original;
  // Fail closed before copying unknown future surfaces.
  stableSchemaDescriptor(target);
  const migrated = structuredClone(value);
  if (migrated.schema !== undefined) migrated.schema = target;
  else migrated.rpc = target;
  if (kind !== undefined) stableInvariant(typeof kind === 'string' && kind.length > 0, 'ERR_MIGRATION_KIND', 'Migration kind must be a non-empty string');
  preserveAuthority(value, migrated);
  validateStableArtifact(target, migrated);
  return Object.freeze({ artifact: migrated, fromSchema: original, toSchema: target, changed: original !== target });
}

/**
 * @typedef {{changed?: boolean, fromSchema?: string, toSchema?: string, artifact?: Record<string, unknown>}} MigratedArtifact
 */

/**
 * @param {{fromRelease: string, toRelease?: string, sourceState?: string, targetState?: string, artifacts: MigratedArtifact[]}} options
 * @returns {Readonly<{schema: string, migrationId: string, fromRelease: string, toRelease: string, sourceState: string|undefined, targetState: string|undefined, changed: boolean, artifacts: MigratedArtifact[], createdAt: string}>}
 */
export function migrationReceipt({ fromRelease, toRelease = '1.0.0', sourceState, targetState, artifacts }) {
  assertSupportedUpgrade(fromRelease, toRelease);
  stableInvariant(Array.isArray(artifacts) && artifacts.length > 0 && artifacts.length <= 256, 'ERR_MIGRATION_RECEIPT', 'Migration artifacts are required and bounded');
  stableInvariant(sourceState === targetState || sourceState !== 'CLOSED', 'ERR_MIGRATION_AUTHORITY', 'CLOSED migration state cannot change');
  return Object.freeze({
    schema: STABLE_SCHEMAS.migrationReceipt,
    migrationId: `MIGRATION-${randomUUID()}`,
    fromRelease,
    toRelease,
    sourceState,
    targetState,
    changed: artifacts.some((entry) => entry.changed === true),
    artifacts: structuredClone(artifacts),
    createdAt: new Date().toISOString(),
  });
}

/**
 * @param {string} schema
 * @returns {Readonly<{deprecated: boolean, replacement: string|null, removal: string|null}>}
 */
export function deprecationNotice(schema) {
  if (LEGACY_SCHEMA_MAP[schema]) return Object.freeze({ deprecated: true, replacement: LEGACY_SCHEMA_MAP[schema], removal: '2.0.0' });
  return Object.freeze({ deprecated: false, replacement: null, removal: null });
}

/**
 * v1.9 → v1.10 `.shipping/` promotion: sign an existing state.json that has no `integrity`
 * field. The state is signed only when the ledger already proves the state it claims, so a
 * genuine legacy CLOSED becomes VERIFIED and an unprovable one stays UNVERIFIED_LEGACY.
 * The ledger is never rewritten; a single `state.migrated` event is appended.
 * @param {string} root
 * @returns {Promise<{changed: boolean, level: string, reason: string, from: string, to: string}>}
 */
export async function migrateStateIntegrity(root) {
  const paths = runtimePaths(root);
  const state = await readJson(paths.state);
  const events = await readJsonLines(paths.ledger);
  const before = await evaluateStateIntegrity(root, state, events);
  if (state.integrity) return { changed: false, level: before.level, reason: 'state is already signed', from: '1.9', to: '1.10' };
  if (before.level !== 'UNVERIFIED_LEGACY') {
    return { changed: false, level: before.level, reason: before.reason, from: '1.9', to: '1.10' };
  }
  if (ledgerProvenState(events) !== state.state) {
    return { changed: false, level: 'UNVERIFIED_LEGACY', reason: 'the ledger does not prove the recorded state; state left unsigned', from: '1.9', to: '1.10' };
  }
  const { integrity: _ignored, ...body } = state;
  await writeSignedState(root, body, { type: 'state.migrated', to: body.state, from: body.state, reason: 'v1.9 to v1.10 state integrity promotion', fromRelease: '1.9', toRelease: '1.10' });
  const after = await evaluateStateIntegrity(root, await readJson(paths.state), await readJsonLines(paths.ledger));
  return { changed: true, level: after.level, reason: after.reason, from: '1.9', to: '1.10' };
}
