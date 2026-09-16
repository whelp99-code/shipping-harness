import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stableInvariant } from './errors.mjs';

export const STABLE_VERSION = '1.0.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_ROOT = path.join(ROOT, 'schemas', 'v1');
const MIGRATION_SCHEMA_ID = ['shipping-harness', 'migration-v1'].join('/');
const EVENT_SCHEMA_ID = ['shipping-harness', 'event-v1'].join('/');
const COMPATIBILITY_SCHEMA_ID = ['shipping-harness', 'compatibility-v1'].join('/');

const descriptors = {
  contract: ['shipping-harness/v1', 'contract.schema.json', 'contract.example.json'],
  lock: ['shipping-harness/lock-v1', 'lock.schema.json', 'lock.example.json'],
  state: ['shipping-harness/state-v1', 'state.schema.json', 'state.example.json'],
  decision: ['shipping-harness/decision-v1', 'decision.schema.json', 'decision.example.json'],
  goalGraph: ['shipping-harness/goals-v1', 'goals.schema.json', 'goals.example.json'],
  evidence: ['shipping-harness/evidence-v1', 'evidence.schema.json', 'evidence.example.json'],
  release: ['shipping-harness/release-v1', 'release.schema.json', 'release.example.json'],
  userView: ['shipping-harness/user-view-v1', 'user-view.schema.json', 'user-view.example.json'],
  pluginManifest: ['shipping-harness/plugin-v1', 'plugin.schema.json', 'plugin.example.json'],
  mcpSurface: ['shipping-harness/mcp-surface-v1', 'mcp-surface.schema.json', 'mcp-surface.example.json'],
  omoWorkOrder: ['shipping-omo/v1', 'omo-work-order.schema.json', 'omo-work-order.example.json'],
  omoReceipt: ['shipping-omo-receipt/v1', 'omo-receipt.schema.json', 'omo-receipt.example.json'],
  remoteRequest: ['shipping-remote/request-v1', 'remote-request.schema.json', 'remote-request.example.json'],
  remoteResponse: ['shipping-remote/response-v1', 'remote-response.schema.json', 'remote-response.example.json'],
  approvalReceipt: ['shipping-remote-approval/v1', 'approval-receipt.schema.json', 'approval-receipt.example.json'],
  notification: ['shipping-remote/notification-v1', 'notification.schema.json', 'notification.example.json'],
  backup: ['shipping-harness/backup-v1', 'backup.schema.json', 'backup.example.json'],
  migrationReceipt: [MIGRATION_SCHEMA_ID, 'migration-receipt.schema.json', 'migration-receipt.example.json'],
  stableEvent: [EVENT_SCHEMA_ID, 'stable-event.schema.json', 'stable-event.example.json'],
  health: ['shipping-harness/health-v1', 'health.schema.json', 'health.example.json'],
  compatibility: [COMPATIBILITY_SCHEMA_ID, 'compatibility.schema.json', 'compatibility.example.json'],
  releaseTrain: ['shipping-harness/release-train-v1', 'release-train.schema.json', 'release-train.example.json'],
  autopilotPolicy: ['shipping-harness/autopilot-policy-v1', 'autopilot-policy.schema.json', 'autopilot-policy.example.json'],
  autopilotDecision: ['shipping-harness/autopilot-decision-v1', 'autopilot-decision.schema.json', 'autopilot-decision.example.json'],
  autopilotState: ['shipping-harness/autopilot-state-v1', 'autopilot-state.schema.json', 'autopilot-state.example.json'],
  intentGate: ['https://shipping-harness.local/schemas/v1/intent-gate.schema.json', 'intent-gate.schema.json', 'intent-gate.example.json'],
  goalDiscovery: ['shipping-harness/goal-discovery-v1', 'goal-discovery.schema.json', 'goal-discovery.example.json'],
  decisionLedgerEvent: ['shipping-harness/decision-ledger-event-v1', 'decision-ledger-event.schema.json', 'decision-ledger-event.example.json'],
  goalCharter: ['shipping-harness/goal-charter-v1', 'goal-charter.schema.json', 'goal-charter.example.json'],
  shippingPlan: ['shipping-harness/plan-v1', 'shipping-plan.schema.json', 'shipping-plan.example.json'],
};

export const STABLE_SCHEMA_DESCRIPTORS = Object.freeze(Object.fromEntries(
  Object.entries(descriptors).map(([name, [id, file, example]]) => [name, Object.freeze({
    name,
    id,
    file,
    example,
    schemaPath: path.join(SCHEMA_ROOT, file),
    examplePath: path.join(SCHEMA_ROOT, 'examples', example),
  })]),
));

export const STABLE_SCHEMAS = Object.freeze(Object.fromEntries(
  Object.entries(STABLE_SCHEMA_DESCRIPTORS).map(([name, descriptor]) => [name, descriptor.id]),
));

export const SCHEMA_FILES = Object.freeze(Object.fromEntries(
  Object.entries(STABLE_SCHEMA_DESCRIPTORS).map(([name, descriptor]) => [name, descriptor.file]),
));

const BY_ID = new Map(Object.values(STABLE_SCHEMA_DESCRIPTORS).map((descriptor) => [descriptor.id, descriptor]));

const REQUIRED_FIELDS = Object.freeze({
  contract: ['project', 'worker', 'release', 'goal', 'scope', 'acceptance', 'blockerPolicy', 'budgets', 'stopPolicy', 'releasePolicy'],
  lock: ['contractHash', 'baselineSha', 'release', 'scopeRevision', 'lockedAt'],
  state: ['state', 'release', 'humanStop'],
  decision: ['proposer', 'mode', 'evidenceHash', 'gitSha', 'release', 'projectName', 'outcome', 'scope', 'acceptance', 'decisions', 'assumptions', 'risks', 'questions', 'hash'],
  goalGraph: ['project', 'release', 'contractHash', 'goals', 'tasks'],
  evidence: ['runId', 'release', 'contractHash', 'gitSha', 'results', 'summary'],
  release: ['release', 'state', 'contractHash'],
  userView: ['initialized', 'userState', 'summary', 'blockerCount', 'nextAction'],
  pluginManifest: ['name', 'displayName', 'version', 'localOnly', 'mcp', 'userFlow', 'approval', 'surfaces'],
  mcpSurface: ['protocolVersions', 'tools', 'resources'],
  omoWorkOrder: ['work_order_id', 'release_id', 'contract_hash', 'git_sha', 'shipping_session_id', 'allowed_paths', 'forbidden_paths', 'budgets', 'execution', 'issued_at', 'expires_at', 'nonce', 'key_id', 'signature'],
  omoReceipt: ['work_order_id', 'shipping_session_id', 'release_id', 'contract_hash', 'source_git_sha', 'status', 'requires_shipping_verification', 'shipping_finisher_authority', 'terminal_replay_allowed', 'usage', 'path_analysis', 'receipt_hash', 'signature'],
  remoteRequest: ['requestId', 'actorId', 'projectId', 'action', 'timestamp', 'nonce', 'signature'],
  remoteResponse: ['requestId', 'ok'],
  approvalReceipt: ['receiptId', 'requestId', 'actorId', 'projectId', 'release', 'proposalId', 'proposalHash', 'gitSha', 'nonce', 'issuedAt', 'expiresAt', 'oneTime', 'signature'],
  notification: ['id', 'createdAt', 'projectId', 'type', 'dedupeKey'],
  backup: ['backupId', 'projectId', 'createdAt', 'files', 'totalBytes', 'signature'],
  migrationReceipt: [MIGRATION_SCHEMA_ID, 'migration-receipt.schema.json', 'migration-receipt.example.json'],
  stableEvent: [EVENT_SCHEMA_ID, 'stable-event.schema.json', 'stable-event.example.json'],
  health: ['status', 'checks', 'internalOnly'],
  compatibility: [COMPATIBILITY_SCHEMA_ID, 'compatibility.schema.json', 'compatibility.example.json'],
  releaseTrain: ['id', 'project', 'finalGoal', 'status', 'currentIndex', 'currentRelease', 'modelAuthority', 'deterministic', 'rollingPlan', 'source', 'limits', 'releases', 'trainCompleteWhen', 'hash'],
  autopilotPolicy: ['id', 'profile', 'enabled', 'modelAuthority', 'defaultDecision', 'permissions', 'consequencePolicy', 'closureRequirements', 'limits', 'binding', 'hash'],
  autopilotDecision: ['policyId', 'policyHash', 'action', 'decision', 'code', 'allowed', 'requiresHuman', 'stopsAutomation', 'effects', 'reasons', 'nextState', 'released', 'message', 'inputFingerprint', 'hash'],
  autopilotState: ['enabled', 'profile', 'modelAuthority', 'policyHash', 'releaseTrainHash', 'currentRelease', 'currentIndex', 'phase', 'sequence', 'replanRequired', 'released', 'baselineSha', 'startedAt', 'updatedAt', 'hash'],
  intentGate: ['requestText', 'status', 'defaultMode', 'inferredMode', 'selectedMode', 'effectiveMode', 'inferenceReason', 'confirmationSource', 'question', 'analysisComplete', 'planningAllowed', 'implementationAllowed', 'autopilotAllowed', 'modelAuthority', 'commandAuthority', 'approvalAuthority', 'closureAuthority', 'hash'],
  goalDiscovery: ['evidenceHash', 'gitSha', 'explicitGoal', 'round', 'maxRounds', 'status', 'questions', 'resolutions', 'candidates', 'recommendedCandidateId', 'critic', 'direction', 'nextAction', 'questionPolicy', 'modelAuthority', 'hash'],
  decisionLedgerEvent: ['sequence', 'occurredAt', 'proposalId', 'proposalRevision', 'proposalHash', 'gitSha', 'type', 'discoveryHash', 'provenance', 'evidenceRefs', 'eventKey', 'previousHash', 'modelAuthority', 'released', 'hash'],
  shippingPlan: ['project', 'program', 'stages'],
  goalCharter: ['id', 'status', 'project', 'release', 'proposalId', 'proposalRevision', 'proposalHash', 'gitSha', 'discoveryHash', 'directionHash', 'candidateHash', 'criticHash', 'outcome', 'primaryUser', 'operatingBoundary', 'value', 'include', 'nonGoals', 'successCriteria', 'assumptions', 'rollback', 'replanTriggers', 'evidenceRefs', 'binding', 'commandAuthority', 'approvalAuthority', 'closureAuthority', 'deploymentAuthority', 'modelAuthority', 'released', 'hash'],
});

/**
 * @typedef {Readonly<{name: string, id: string, file: string, example: string, schemaPath: string, examplePath: string}>} StableSchemaDescriptor
 */

/**
 * A JSON Schema 2020-12 node, limited to the keywords validateNode() understands.
 * @typedef {{$schema?: string, $id?: string, 'x-shipping-version'?: string, type?: string|string[], required?: string[], properties?: Record<string, JsonSchemaNode>, additionalProperties?: boolean|JsonSchemaNode, items?: JsonSchemaNode, const?: unknown, enum?: unknown[], allOf?: JsonSchemaNode[], anyOf?: JsonSchemaNode[], oneOf?: JsonSchemaNode[], minLength?: number, maxLength?: number, pattern?: string, format?: string, minimum?: number, maximum?: number, exclusiveMinimum?: number, exclusiveMaximum?: number, minItems?: number, maxItems?: number, uniqueItems?: boolean, minProperties?: number, maxProperties?: number}} JsonSchemaNode
 */

/**
 * @returns {string[]}
 */
export function stableSchemaNames() {
  return Object.keys(STABLE_SCHEMA_DESCRIPTORS);
}

/**
 * @param {string} nameOrId
 * @returns {StableSchemaDescriptor}
 */
export function stableSchemaDescriptor(nameOrId) {
  const descriptor = STABLE_SCHEMA_DESCRIPTORS[nameOrId] ?? BY_ID.get(nameOrId);
  stableInvariant(descriptor, 'ERR_STABLE_SCHEMA', `Unsupported stable schema: ${String(nameOrId)}`);
  return descriptor;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    const failure = /** @type {Error & {code?: string}} */ (new Error(`Unable to read stable JSON document: ${filePath}`));
    failure.code = error?.code === 'ENOENT' ? 'ERR_STABLE_SCHEMA_MISSING' : 'ERR_STABLE_SCHEMA_JSON';
    failure.cause = error;
    throw failure;
  }
}

/**
 * @param {string} nameOrId
 * @returns {Promise<JsonSchemaNode>}
 */
export async function loadStableSchema(nameOrId) {
  const descriptor = stableSchemaDescriptor(nameOrId);
  const schema = await readJson(descriptor.schemaPath);
  validateStableSchemaDefinition(descriptor, schema);
  return schema;
}

// Compatibility alias used by the initial v1 tests and downstream internal tooling.
export const loadSchema = loadStableSchema;

/**
 * @param {string} nameOrId
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadStableExample(nameOrId) {
  const descriptor = stableSchemaDescriptor(nameOrId);
  return readJson(descriptor.examplePath);
}

/**
 * @param {string|StableSchemaDescriptor} descriptorOrName
 * @param {JsonSchemaNode} schema
 * @returns {JsonSchemaNode}
 */
export function validateStableSchemaDefinition(descriptorOrName, schema) {
  const descriptor = typeof descriptorOrName === 'string'
    ? stableSchemaDescriptor(descriptorOrName)
    : descriptorOrName;
  stableInvariant(schema && typeof schema === 'object' && !Array.isArray(schema), 'ERR_STABLE_SCHEMA', `${descriptor.name} schema must be an object`);
  stableInvariant(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'ERR_STABLE_SCHEMA', `${descriptor.name} must use JSON Schema 2020-12`);
  stableInvariant(schema.$id === descriptor.id, 'ERR_STABLE_SCHEMA_ID', `${descriptor.name} schema ID mismatch`);
  stableInvariant(schema['x-shipping-version'] === STABLE_VERSION, 'ERR_STABLE_SCHEMA_VERSION', `${descriptor.name} schema version mismatch`);
  stableInvariant(schema.type === 'object', 'ERR_STABLE_SCHEMA', `${descriptor.name} root must be an object`);
  stableInvariant(Array.isArray(schema.required) && schema.required.includes('schema'), 'ERR_STABLE_SCHEMA', `${descriptor.name} must require its schema discriminator`);
  stableInvariant(schema.properties?.schema?.const === descriptor.id, 'ERR_STABLE_SCHEMA_ID', `${descriptor.name} discriminator must equal its schema ID`);
  return schema;
}

function typeMatches(expected, value) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function validateNode(schema, value, location) {
  if (schema === true || schema === undefined) return;
  stableInvariant(schema !== false, 'ERR_STABLE_DOCUMENT', `${location} is forbidden`);

  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf) validateNode(branch, value, location);
  if (Array.isArray(schema.anyOf)) {
    // A branch rejection is expected control flow for this combinator, not a bug; only the aggregate count matters.
    const successes = schema.anyOf.filter((branch) => {
      try { validateNode(branch, value, location); return true; } catch { return false; }
    });
    stableInvariant(successes.length > 0, 'ERR_STABLE_DOCUMENT', `${location} does not match any allowed shape`);
  }
  if (Array.isArray(schema.oneOf)) {
    // Same combinator pattern as anyOf above: branch rejections are data, the exact match count is what is validated.
    const successes = schema.oneOf.filter((branch) => {
      try { validateNode(branch, value, location); return true; } catch { return false; }
    });
    stableInvariant(successes.length === 1, 'ERR_STABLE_DOCUMENT', `${location} must match exactly one allowed shape`);
  }

  if (Object.hasOwn(schema, 'const')) {
    stableInvariant(Object.is(value, schema.const), 'ERR_STABLE_DOCUMENT', `${location} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum)) {
    stableInvariant(schema.enum.some((entry) => Object.is(entry, value)), 'ERR_STABLE_DOCUMENT', `${location} is not an allowed value`);
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    stableInvariant(expected.some((type) => typeMatches(type, value)), 'ERR_STABLE_DOCUMENT', `${location} must be ${expected.join(' or ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined) stableInvariant(value.length >= schema.minLength, 'ERR_STABLE_DOCUMENT', `${location} is too short`);
    if (schema.maxLength !== undefined) stableInvariant(value.length <= schema.maxLength, 'ERR_STABLE_DOCUMENT', `${location} is too long`);
    if (schema.pattern !== undefined) stableInvariant(new RegExp(schema.pattern, 'u').test(value), 'ERR_STABLE_DOCUMENT', `${location} does not match the required pattern`);
    if (schema.format === 'date-time') stableInvariant(Number.isFinite(Date.parse(value)), 'ERR_STABLE_DOCUMENT', `${location} must be an ISO date-time`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined) stableInvariant(value >= schema.minimum, 'ERR_STABLE_DOCUMENT', `${location} is below minimum`);
    if (schema.maximum !== undefined) stableInvariant(value <= schema.maximum, 'ERR_STABLE_DOCUMENT', `${location} exceeds maximum`);
    if (schema.exclusiveMinimum !== undefined) stableInvariant(value > schema.exclusiveMinimum, 'ERR_STABLE_DOCUMENT', `${location} must exceed minimum`);
    if (schema.exclusiveMaximum !== undefined) stableInvariant(value < schema.exclusiveMaximum, 'ERR_STABLE_DOCUMENT', `${location} must be below maximum`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) stableInvariant(value.length >= schema.minItems, 'ERR_STABLE_DOCUMENT', `${location} has too few items`);
    if (schema.maxItems !== undefined) stableInvariant(value.length <= schema.maxItems, 'ERR_STABLE_DOCUMENT', `${location} has too many items`);
    if (schema.uniqueItems === true) {
      const encoded = value.map((entry) => JSON.stringify(entry));
      stableInvariant(new Set(encoded).size === encoded.length, 'ERR_STABLE_DOCUMENT', `${location} contains duplicate items`);
    }
    if (schema.items) value.forEach((entry, index) => validateNode(schema.items, entry, `${location}[${index}]`));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      stableInvariant(Object.hasOwn(value, required), 'ERR_STABLE_DOCUMENT', `${location}.${required} is required`);
    }
    for (const [key, nested] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) validateNode(properties[key], nested, `${location}.${key}`);
      else if (schema.additionalProperties === false) stableInvariant(false, 'ERR_STABLE_DOCUMENT', `${location}.${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateNode(schema.additionalProperties, nested, `${location}.${key}`);
    }
    if (schema.minProperties !== undefined) stableInvariant(Object.keys(value).length >= schema.minProperties, 'ERR_STABLE_DOCUMENT', `${location} has too few properties`);
    if (schema.maxProperties !== undefined) stableInvariant(Object.keys(value).length <= schema.maxProperties, 'ERR_STABLE_DOCUMENT', `${location} has too many properties`);
  }
}

/**
 * @param {string} nameOrId
 * @param {Record<string, unknown>} value
 * @returns {Record<string, unknown>}
 */
export function validateStableArtifact(nameOrId, value) {
  const descriptor = stableSchemaDescriptor(nameOrId);
  stableInvariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_STABLE_ARTIFACT', `${descriptor.name} artifact must be an object`);
  stableInvariant(value.schema === descriptor.id, 'ERR_STABLE_ARTIFACT', `${descriptor.name} artifact schema mismatch`);
  for (const key of REQUIRED_FIELDS[descriptor.name] ?? []) {
    stableInvariant(Object.hasOwn(value, key), 'ERR_STABLE_ARTIFACT', `Missing stable field ${key}`);
  }
  return value;
}

/**
 * @param {string} nameOrId
 * @param {Record<string, unknown>} value
 * @returns {Promise<Record<string, unknown>>}
 */
export async function validateStableDocument(nameOrId, value) {
  const descriptor = stableSchemaDescriptor(nameOrId);
  const schema = await loadStableSchema(descriptor.name);
  validateNode(schema, value, descriptor.name);
  stableInvariant(value.schema === descriptor.id, 'ERR_STABLE_SCHEMA_ID', `${descriptor.name} document schema mismatch`);
  return value;
}

/**
 * @returns {Promise<readonly Readonly<{name: string, id: string, schema: string, example: string}>[]>}
 */
export async function validateAllStableExamples() {
  const results = [];
  for (const name of stableSchemaNames()) {
    const descriptor = stableSchemaDescriptor(name);
    const example = await loadStableExample(name);
    await validateStableDocument(name, example);
    results.push(Object.freeze({ name, id: descriptor.id, schema: descriptor.file, example: descriptor.example }));
  }
  return Object.freeze(results);
}
