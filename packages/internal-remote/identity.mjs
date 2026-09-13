import path from 'node:path';
import { realpathSync } from 'node:fs';
import {
  ACTION_PERMISSION,
  assertPathWithin,
  boundedInteger,
  boundedString,
  invariant,
  pathWithin,
} from './policy.mjs';

const PERMISSIONS = /** @type {Set<string>} */ (new Set(Object.values(ACTION_PERMISSION)));

function resolveCredential({ inline, envName, env, label, minimum, allowInlineCredentials }) {
  if (inline !== undefined) {
    invariant(allowInlineCredentials, 'ERR_REMOTE_CONFIG', `${label} must be supplied through an environment variable in operational configuration`);
    boundedString(inline, label, 8192);
    invariant(inline.length >= minimum, 'ERR_REMOTE_CONFIG', `${label} is too short`);
    return inline;
  }
  boundedString(envName, `${label} environment variable name`, 160);
  const value = env[envName];
  boundedString(value, label, 8192);
  invariant(value.length >= minimum, 'ERR_REMOTE_CONFIG', `${label} is too short`);
  return value;
}

function realDirectory(directory, label) {
  boundedString(directory, label, 4096);
  invariant(path.isAbsolute(directory), 'ERR_REMOTE_CONFIG', `${label} must be absolute`);
  try {
    return realpathSync(directory);
  } catch (error) {
    invariant(false, 'ERR_REMOTE_CONFIG', `${label} must exist and resolve without symlink escape`, { directory, cause: error instanceof Error ? error.message : String(error) });
  }
}

function optionalEvidencePath(value, roots, label) {
  if (value === undefined || value === null) return null;
  boundedString(value, label, 4096);
  invariant(path.isAbsolute(value), 'ERR_REMOTE_CONFIG', `${label} must be absolute`);
  const resolved = realpathSync(value);
  invariant(roots.some((root) => pathWithin(root, resolved)), 'ERR_REMOTE_CONFIG', `${label} is outside every configured internal root`);
  return resolved;
}

/**
 * Shapes of the raw (untrusted, pre-validation) remote config document.
 * @typedef {{id?: unknown, credential?: string, credentialEnv?: string, permissions?: string[], projects?: string[], disabled?: unknown}} RawRemoteActor
 * @typedef {{id?: unknown, root?: unknown, omoRuntimeManifest?: unknown, runtimePinFiles?: unknown[]}} RawRemoteProject
 * @typedef {{schema?: string, allowedRoots?: unknown[], actors?: RawRemoteActor[], projects?: RawRemoteProject[], serverCredential?: string, serverCredentialEnv?: string, maxClockSkewMs?: unknown, maxBodyBytes?: unknown, maxConcurrent?: unknown, ratePerMinute?: unknown, replayTtlMs?: unknown, approvalTtlMs?: unknown, notificationLimit?: unknown}} RawRemoteConfig
 */

/**
 * Validated remote configuration.
 * @typedef {{id: string, credential: string, permissions: string[], projects: string[], disabled: boolean}} RemoteActor
 * @typedef {{id: string, root: string, omoRuntimeManifest: string|null, runtimePinFiles: (string|null)[]}} RemoteProject
 * @typedef {Readonly<{schema: string, allowedRoots: string[], actors: Record<string, RemoteActor>, projects: Record<string, RemoteProject>, serverCredential: string, maxClockSkewMs: number, maxBodyBytes: number, maxConcurrent: number, ratePerMinute: number, replayTtlMs: number, approvalTtlMs: number, notificationLimit: number}>} RemoteConfig
 */

/**
 * @param {RawRemoteConfig} raw
 * @param {{env?: NodeJS.ProcessEnv, allowInlineCredentials?: boolean}} [options]
 * @returns {RemoteConfig}
 */
export function validateRemoteConfig(raw, {
  env = process.env,
  allowInlineCredentials = false,
} = {}) {
  invariant(raw && typeof raw === 'object' && !Array.isArray(raw), 'ERR_REMOTE_CONFIG', 'Remote config must be an object');
  invariant(raw.schema === 'shipping-remote/config-v1', 'ERR_REMOTE_CONFIG', 'Unsupported remote config schema');

  invariant(Array.isArray(raw.allowedRoots) && raw.allowedRoots.length > 0 && raw.allowedRoots.length <= 16, 'ERR_REMOTE_CONFIG', 'At least one bounded internal root is required');
  const allowedRoots = [...new Set(raw.allowedRoots.map((entry, index) => realDirectory(entry, `allowedRoots[${index}]`)))];

  /** @type {Record<string, RemoteActor>} */
  const actors = {};
  for (const item of raw.actors ?? []) {
    invariant(item && typeof item === 'object' && !Array.isArray(item), 'ERR_REMOTE_CONFIG', 'Actor configuration must be an object');
    const id = boundedString(item.id, 'actor id', 160);
    invariant(!actors[id], 'ERR_REMOTE_CONFIG', 'Actor IDs must be unique');
    const credential = resolveCredential({
      inline: item.credential,
      envName: item.credentialEnv,
      env,
      label: `actor ${id} credential`,
      minimum: 32,
      allowInlineCredentials,
    });
    const permissions = [...new Set(item.permissions ?? [])];
    invariant(permissions.length > 0 && permissions.every((permission) => PERMISSIONS.has(permission)), 'ERR_REMOTE_CONFIG', 'Actor permissions are invalid');
    const projects = [...new Set(item.projects ?? [])];
    invariant(projects.length > 0 && projects.length <= 64 && projects.every((projectId) => typeof projectId === 'string' && projectId.length > 0), 'ERR_REMOTE_CONFIG', 'Actor project allowlist is required');
    actors[id] = { id, credential, permissions, projects, disabled: item.disabled === true };
  }
  invariant(Object.keys(actors).length > 0, 'ERR_REMOTE_CONFIG', 'At least one actor is required');

  const serverCredential = resolveCredential({
    inline: raw.serverCredential,
    envName: raw.serverCredentialEnv,
    env,
    label: 'server signing credential',
    minimum: 40,
    allowInlineCredentials,
  });

  /** @type {Record<string, RemoteProject>} */
  const projects = {};
  const seenRoots = new Set();
  for (const item of raw.projects ?? []) {
    invariant(item && typeof item === 'object' && !Array.isArray(item), 'ERR_REMOTE_CONFIG', 'Project configuration must be an object');
    const id = boundedString(item.id, 'project id', 160);
    invariant(!projects[id], 'ERR_REMOTE_CONFIG', 'Project IDs must be unique');
    const root = realDirectory(item.root, `project ${id} root`);
    invariant(allowedRoots.some((allowedRoot) => pathWithin(allowedRoot, root)), 'ERR_REMOTE_CONFIG', `Project ${id} is outside every configured internal root`);
    invariant(!seenRoots.has(root), 'ERR_REMOTE_CONFIG', 'Multiple project IDs cannot alias the same real repository root');
    seenRoots.add(root);
    projects[id] = {
      id,
      root,
      omoRuntimeManifest: optionalEvidencePath(item.omoRuntimeManifest, allowedRoots, `project ${id} OMO runtime manifest`),
      runtimePinFiles: (item.runtimePinFiles ?? []).map((entry, index) => optionalEvidencePath(entry, allowedRoots, `project ${id} runtimePinFiles[${index}]`)),
    };
  }
  invariant(Object.keys(projects).length > 0, 'ERR_REMOTE_CONFIG', 'At least one project is required');

  for (const actor of Object.values(actors)) {
    invariant(actor.projects.every((projectId) => projects[projectId]), 'ERR_REMOTE_CONFIG', `Actor ${actor.id} references an unknown project`);
  }

  return Object.freeze({
    schema: raw.schema,
    allowedRoots,
    actors,
    projects,
    serverCredential,
    maxClockSkewMs: boundedInteger(raw.maxClockSkewMs, 'maxClockSkewMs', { min: 1000, max: 300000, fallback: 120000 }),
    maxBodyBytes: boundedInteger(raw.maxBodyBytes, 'maxBodyBytes', { min: 1024, max: 65536, fallback: 32768 }),
    maxConcurrent: boundedInteger(raw.maxConcurrent, 'maxConcurrent', { min: 1, max: 8, fallback: 4 }),
    ratePerMinute: boundedInteger(raw.ratePerMinute, 'ratePerMinute', { min: 1, max: 120, fallback: 30 }),
    replayTtlMs: boundedInteger(raw.replayTtlMs, 'replayTtlMs', { min: 60000, max: 3600000, fallback: 600000 }),
    approvalTtlMs: boundedInteger(raw.approvalTtlMs, 'approvalTtlMs', { min: 30000, max: 300000, fallback: 180000 }),
    notificationLimit: boundedInteger(raw.notificationLimit, 'notificationLimit', { min: 10, max: 10000, fallback: 1000 }),
  });
}

/**
 * @param {RemoteConfig} config
 * @param {{actorId: string, projectId: string, action: string}} request
 * @returns {{actor: RemoteActor, project: RemoteProject, permission: string}}
 */
export function authorize(config, { actorId, projectId, action }) {
  const actor = config.actors[actorId];
  invariant(actor && !actor.disabled, 'ERR_REMOTE_IDENTITY', 'Unknown or disabled actor');
  invariant(actor.projects.includes(projectId), 'ERR_REMOTE_PROJECT', 'Actor is not allowed to access this project');
  const project = config.projects[projectId];
  invariant(project, 'ERR_REMOTE_PROJECT', 'Unknown project');
  // validateRemoteConfig already proved every project root sits inside an allowed root, so find() cannot miss here.
  const allowedRoot = /** @type {string} */ (config.allowedRoots.find((root) => pathWithin(root, project.root)));
  assertPathWithin(allowedRoot, project.root, 'ERR_REMOTE_PROJECT');
  const permission = ACTION_PERMISSION[action];
  invariant(permission && actor.permissions.includes(permission), 'ERR_REMOTE_PERMISSION', `Actor lacks ${permission ?? 'unknown'} permission`);
  return { actor, project, permission };
}
