import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { hashFile, hashObject } from './crypto.mjs';
import { ShippingError, invariant } from './errors.mjs';

export const RESTORE_EVIDENCE_SCHEMA = 'shipping-harness/core5-restore-evidence.v1';

/** @param {Record<string, any>} evidence */
export function validateRestoreEvidence(evidence) {
  invariant(evidence?.schema === RESTORE_EVIDENCE_SCHEMA, 'ERR_RESTORE_EVIDENCE_SCHEMA', 'Unsupported restore evidence schema');
  invariant(typeof evidence.restoreId === 'string' && evidence.restoreId.length > 0, 'ERR_RESTORE_EVIDENCE_INVALID', 'restoreId is required');
  invariant(Array.isArray(evidence.artifacts) && evidence.artifacts.length > 0, 'ERR_RESTORE_EVIDENCE_MISSING', 'Restore evidence must list at least one artifact');
  const ids = new Set();
  for (const [index, artifact] of evidence.artifacts.entries()) {
    invariant(typeof artifact?.id === 'string' && artifact.id.length > 0 && !ids.has(artifact.id), 'ERR_RESTORE_EVIDENCE_INVALID', `Invalid or duplicate artifact at ${index}`);
    ids.add(artifact.id);
    invariant(typeof artifact.path === 'string' && !path.isAbsolute(artifact.path) && !artifact.path.split(/[\\/]/u).includes('..'), 'ERR_RESTORE_EVIDENCE_PATH', `Artifact ${artifact.id} path escapes repository`);
    invariant(typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(artifact.sha256), 'ERR_RESTORE_EVIDENCE_INVALID', `Artifact ${artifact.id} needs sha256`);
  }
  return evidence;
}

/** @param {string} root @param {Record<string, any>} evidence */
export async function verifyRestoreEvidence(root, evidence) {
  validateRestoreEvidence(evidence);
  const checked = [];
  for (const artifact of evidence.artifacts) {
    const absolute = path.resolve(root, artifact.path);
    invariant(absolute === root || absolute.startsWith(`${root}${path.sep}`), 'ERR_RESTORE_EVIDENCE_PATH', `Artifact ${artifact.id} is outside repository`);
    try { await access(absolute); } catch { throw new ShippingError('ERR_RESTORE_EVIDENCE_MISSING', `Restore artifact is missing: ${artifact.path}`); }
    const actual = await hashFile(absolute);
    invariant(actual === artifact.sha256, 'ERR_RESTORE_EVIDENCE_DIGEST', `Restore artifact digest mismatch: ${artifact.path}`, { expected: artifact.sha256, actual });
    checked.push({ id: artifact.id, path: artifact.path, sha256: actual });
  }
  return { schema: RESTORE_EVIDENCE_SCHEMA, restoreId: evidence.restoreId, checked, evidenceHash: hashObject(checked) };
}

/** @param {string} filePath */
export async function readRestoreEvidence(filePath) {
  try { return validateRestoreEvidence(JSON.parse(await readFile(filePath, 'utf8'))); } catch (error) {
    if (error instanceof ShippingError) throw error;
    throw new ShippingError('ERR_RESTORE_EVIDENCE_INVALID', `Unable to read restore evidence: ${filePath}`, { cause: error instanceof Error ? error.message : String(error) });
  }
}
