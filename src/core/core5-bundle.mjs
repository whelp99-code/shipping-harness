import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { hashObject, hashFile, stableStringify } from './crypto.mjs';
import { currentGitSha } from './git.mjs';
import { ShippingError, invariant } from './errors.mjs';

export const CORE5_BUNDLE_SCHEMA = 'shipping-harness/core5-release-bundle.v1';
export const CORE5_BUNDLE_PATH = '.shipping/core5-release-bundle.json';
const CRITERION_VERSION = /^core5-criteria-v[0-9]+$/u;

/** @param {unknown} value @param {string} label */
function nonEmptyString(value, label) {
  invariant(typeof value === 'string' && value.trim().length > 0, 'ERR_CORE5_BUNDLE_INVALID', `${label} must be a non-empty string`);
  return value.trim();
}

/** @param {unknown} value @param {string} label */
function stringMap(value, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_CORE5_BUNDLE_INVALID', `${label} must be an object`);
  const result = {};
  for (const [key, entry] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    result[nonEmptyString(key, `${label} key`)] = nonEmptyString(entry, `${label}.${key}`);
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

/** @param {unknown} value */
function criteriaList(value) {
  invariant(Array.isArray(value) && value.length > 0, 'ERR_CORE5_BUNDLE_CRITERIA', 'criteria must contain at least one criterion');
  const ids = new Set();
  const result = value.map((entry, index) => {
    invariant(entry && typeof entry === 'object' && !Array.isArray(entry), 'ERR_CORE5_BUNDLE_CRITERIA', `criteria[${index}] must be an object`);
    const row = /** @type {Record<string, unknown>} */ (entry);
    const id = nonEmptyString(row.id, `criteria[${index}].id`);
    invariant(!ids.has(id), 'ERR_CORE5_BUNDLE_CRITERIA', `Duplicate criterion: ${id}`);
    ids.add(id);
    invariant(typeof row.description === 'string' && row.description.trim(), 'ERR_CORE5_BUNDLE_CRITERIA', `${id}.description is required`);
    invariant(typeof row.required === 'boolean', 'ERR_CORE5_BUNDLE_CRITERIA', `${id}.required must be boolean`);
    return { id, description: row.description.trim(), required: row.required };
  });
  invariant(result.some((entry) => entry.required), 'ERR_CORE5_BUNDLE_CRITERIA', 'At least one criterion must be required');
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {unknown} value */
function migrations(value) {
  invariant(Array.isArray(value), 'ERR_CORE5_BUNDLE_INVALID', 'migrationIds must be an array');
  const result = value.map((entry, index) => nonEmptyString(entry, `migrationIds[${index}]`));
  invariant(new Set(result).size === result.length, 'ERR_CORE5_BUNDLE_INVALID', 'migrationIds must not contain duplicates');
  return [...result].sort();
}

/** @param {unknown} value */
function evidence(value) {
  invariant(Array.isArray(value) && value.length > 0, 'ERR_CORE5_BUNDLE_EVIDENCE', 'evidenceManifest must contain at least one entry');
  const ids = new Set();
  return value.map((entry, index) => {
    invariant(entry && typeof entry === 'object' && !Array.isArray(entry), 'ERR_CORE5_BUNDLE_EVIDENCE', `evidenceManifest[${index}] must be an object`);
    const row = /** @type {Record<string, unknown>} */ (entry);
    const id = nonEmptyString(row.id, `evidenceManifest[${index}].id`);
    const relativePath = nonEmptyString(row.path, `${id}.path`);
    invariant(!path.isAbsolute(relativePath) && !relativePath.split('/').includes('..'), 'ERR_CORE5_BUNDLE_EVIDENCE', `${id}.path must remain repository-contained`);
    invariant(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(row.sha256), 'ERR_CORE5_BUNDLE_EVIDENCE', `${id}.sha256 must be a SHA-256 digest`);
    invariant(!ids.has(id), 'ERR_CORE5_BUNDLE_EVIDENCE', `Duplicate evidence id: ${id}`);
    ids.add(id);
    return { id, path: relativePath.replaceAll('\\', '/'), sha256: row.sha256 };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {Record<string, any>} bundle */
function unsigned(bundle) {
  const { bundleHash: _bundleHash, ...body } = bundle;
  return body;
}

/** @param {Record<string, any>} input */
export function createCore5ReleaseBundle(input) {
  const criteria = criteriaList(input.criteria);
  const criterionVersion = nonEmptyString(input.criterionVersion, 'criterionVersion');
  invariant(CRITERION_VERSION.test(criterionVersion), 'ERR_CORE5_BUNDLE_CRITERIA', 'criterionVersion must be immutable core5-criteria-vN');
  const bundle = {
    schema: CORE5_BUNDLE_SCHEMA,
    bundleVersion: '1',
    release: nonEmptyString(input.release, 'release'),
    repository: {
      revision: nonEmptyString(input.repository?.revision, 'repository.revision'),
      contractHash: nonEmptyString(input.repository?.contractHash, 'repository.contractHash'),
    },
    migrationIds: migrations(input.migrationIds ?? []),
    toolVersions: stringMap(input.toolVersions ?? {}, 'toolVersions'),
    modelVersions: stringMap(input.modelVersions ?? {}, 'modelVersions'),
    imageVersions: stringMap(input.imageVersions ?? {}, 'imageVersions'),
    supplyChain: {
      sbom: nonEmptyString(input.supplyChain?.sbom ?? 'UNSET', 'supplyChain.sbom'),
      licenses: nonEmptyString(input.supplyChain?.licenses ?? 'UNSET', 'supplyChain.licenses'),
      imageDigests: nonEmptyString(input.supplyChain?.imageDigests ?? 'UNSET', 'supplyChain.imageDigests'),
    },
    criterionVersion,
    criteria,
    criteriaHash: hashObject(criteria),
    evidenceManifest: evidence(input.evidenceManifest),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  invariant(!Number.isNaN(Date.parse(bundle.createdAt)), 'ERR_CORE5_BUNDLE_INVALID', 'createdAt must be an ISO date');
  return { ...bundle, bundleHash: hashObject(unsigned(bundle)) };
}

/** @param {Record<string, any>} bundle @param {{revision?: string, contractHash?: string, criterionVersion?: string, criteriaHash?: string}} [expected] */
export function validateCore5ReleaseBundle(bundle, expected = {}) {
  invariant(bundle && typeof bundle === 'object', 'ERR_CORE5_BUNDLE_INVALID', 'Core5 release bundle must be an object');
  invariant(bundle.schema === CORE5_BUNDLE_SCHEMA, 'ERR_CORE5_BUNDLE_SCHEMA', 'Unsupported Core5 release bundle schema');
  const rebuilt = createCore5ReleaseBundle(bundle);
  invariant(bundle.bundleHash === rebuilt.bundleHash, 'ERR_CORE5_BUNDLE_TAMPERED', 'Core5 release bundle hash does not match its contents');
  for (const [name, value] of Object.entries({
    revision: expected.revision,
    contractHash: expected.contractHash,
    criterionVersion: expected.criterionVersion,
    criteriaHash: expected.criteriaHash,
  })) if (value !== undefined) {
    const actual = name === 'revision' ? bundle.repository.revision : name === 'contractHash' ? bundle.repository.contractHash : bundle[name];
    invariant(actual === value, 'ERR_CORE5_BUNDLE_MISMATCH', `Core5 bundle ${name} does not match the expected locked value`, { expected: value, actual });
  }
  return bundle;
}

/** @param {string} root @param {Record<string, any>} input */
export async function lockCore5ReleaseBundle(root, input) {
  const filePath = path.join(root, CORE5_BUNDLE_PATH);
  try {
    const existing = JSON.parse(await readFile(filePath, 'utf8'));
    throw new ShippingError('ERR_CORE5_BUNDLE_IMMUTABLE', 'Core5 release bundle is already locked and cannot be overwritten', { path: filePath, bundleHash: existing.bundleHash });
  } catch (error) {
    if (error instanceof ShippingError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  const bundle = createCore5ReleaseBundle({ ...input, repository: { ...input.repository, revision: input.repository?.revision ?? currentGitSha(root) } });
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stableStringify(bundle), 'utf8');
  return { path: filePath, bundle };
}

/** @param {string} root @param {{revision?: string, contractHash?: string, criterionVersion?: string, criteriaHash?: string}} [expected] */
export async function loadAndValidateCore5ReleaseBundle(root, expected = {}) {
  const filePath = path.join(root, CORE5_BUNDLE_PATH);
  let bundle;
  try { bundle = JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    throw new ShippingError('ERR_CORE5_BUNDLE_MISSING', `Core5 release bundle is missing: ${filePath}`, { cause: error instanceof Error ? error.message : String(error) });
  }
  return validateCore5ReleaseBundle(bundle, expected);
}

/** @param {string} root @param {string[]} paths */
export async function evidenceEntries(root, paths) {
  return Promise.all(paths.map(async (relativePath, index) => ({ id: `EVID-${String(index + 1).padStart(3, '0')}`, path: relativePath, sha256: await hashFile(path.join(root, relativePath)) })));
}
