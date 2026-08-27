import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { hashFile } from '../core/crypto.mjs';
import { assertContainedPath, exists } from '../core/fs.mjs';
import { ShippingError, invariant } from '../core/errors.mjs';
import { adapterConfiguration } from './sdk.mjs';

const BLOCKED_SEGMENTS = new Set(['.git', '.shipping', '.ssh', '.aws', '.gnupg']);
const BLOCKED_BASENAMES = new Set([
  '.env',
  'auth.json',
  'credentials',
  'credentials.json',
  'tokens.json',
  'id_rsa',
  'id_ed25519',
]);

/** @param {string} candidate */
export function validateArtifactCandidate(candidate) {
  invariant(typeof candidate === 'string' && candidate.trim(), 'ERR_ARTIFACT_PATH', 'Artifact path must be a non-empty string');
  const raw = candidate.trim();
  invariant(!raw.includes('\0'), 'ERR_ARTIFACT_PATH', 'Artifact path contains a null byte');
  invariant(!raw.startsWith('~'), 'ERR_ARTIFACT_PATH', 'Home-directory artifact paths are forbidden', { path: raw });
  invariant(!path.isAbsolute(raw) && !/^[A-Za-z]:[\\/]/u.test(raw) && !raw.startsWith('\\\\'), 'ERR_ARTIFACT_PATH', 'Absolute artifact paths are forbidden', { path: raw });
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//u, '');
  const segments = normalized.split('/').filter(Boolean);
  invariant(segments.length > 0 && !segments.includes('..'), 'ERR_ARTIFACT_PATH', 'Artifact path must remain inside the repository', { path: raw });
  invariant(!segments.some((segment) => BLOCKED_SEGMENTS.has(segment)), 'ERR_ARTIFACT_PATH', 'Artifact path targets protected runtime or credential state', { path: raw });
  invariant(!BLOCKED_BASENAMES.has(segments.at(-1).toLowerCase()), 'ERR_ARTIFACT_PATH', 'Artifact path targets a credential-like file', { path: raw });
  return normalized;
}

/** @param {string} root @param {string} candidate */
function resolveExistingArtifact(root, candidate) {
  const normalized = validateArtifactCandidate(candidate);
  const absolute = path.resolve(root, normalized);
  if (!existsSync(absolute)) return { normalized, absolute, present: false };
  const realRoot = realpathSync(root);
  const realArtifact = realpathSync(absolute);
  const relative = path.relative(realRoot, realArtifact);
  invariant(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), 'ERR_PATH_OUTSIDE_REPO', 'Artifact symlink escapes repository root', {
    path: normalized,
    resolved: realArtifact,
  });
  return { normalized, absolute, present: true };
}

/** @param {string} root @param {Record<string, any>} config */
export function configuredArtifactPresence(root, config) {
  const candidates = Array.isArray(config?.artifactPaths) ? config.artifactPaths : [];
  const receipts = candidates.map((candidate) => resolveExistingArtifact(root, candidate));
  return {
    candidates: receipts.map((entry) => entry.normalized),
    present: receipts.filter((entry) => entry.present).map((entry) => entry.normalized),
    missing: receipts.filter((entry) => !entry.present).map((entry) => entry.normalized),
  };
}

/** @param {unknown} parsed */
function summarizeJson(parsed) {
  if (Array.isArray(parsed)) return { type: 'array', length: parsed.length };
  if (parsed && typeof parsed === 'object') return { type: 'object', keys: Object.keys(parsed).sort().slice(0, 50) };
  return { type: parsed === null ? 'null' : typeof parsed };
}

/** @param {string} filePath @param {string} text */
function summarizeContent(filePath, text) {
  if (filePath.endsWith('.json')) {
    try {
      return { format: 'json', ...summarizeJson(JSON.parse(text)) };
    } catch (error) {
      throw new ShippingError('ERR_ARTIFACT_INVALID', `Invalid JSON adapter artifact: ${filePath}`, {
        path: filePath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (filePath.endsWith('.jsonl')) {
    const lines = text.split(/\r?\n/u).filter(Boolean);
    const first = lines.length > 0 ? (() => {
      try {
        return summarizeJson(JSON.parse(lines[0]));
      } catch (error) {
        throw new ShippingError('ERR_ARTIFACT_INVALID', `Invalid JSONL adapter artifact: ${filePath}:1`, {
          path: filePath,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    })() : null;
    for (let index = 1; index < lines.length; index += 1) {
      try {
        JSON.parse(lines[index]);
      } catch (error) {
        throw new ShippingError('ERR_ARTIFACT_INVALID', `Invalid JSONL adapter artifact: ${filePath}:${index + 1}`, {
          path: filePath,
          line: index + 1,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { format: 'jsonl', records: lines.length, firstRecord: first };
  }
  return {
    format: filePath.endsWith('.jsonc') ? 'jsonc' : 'text',
    lines: text ? text.split(/\r?\n/u).length : 0,
  };
}

/**
 * Collect metadata and digests only. Raw external artifact content is never copied
 * into Shipping Harness receipts.
 * @param {string} root
 * @param {string} adapterName
 * @param {Record<string, any>} contract
 * @param {{maxBytes?: number}} [options]
 */
export async function collectConfiguredArtifacts(root, adapterName, contract, options = {}) {
  const config = adapterConfiguration(contract, adapterName);
  const presence = configuredArtifactPresence(root, config);
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const collected = [];
  for (const candidate of presence.present) {
    const absolute = path.resolve(root, candidate);
    await assertContainedPath(root, absolute);
    const information = await stat(absolute);
    invariant(information.isFile(), 'ERR_ARTIFACT_TYPE', 'Adapter artifact must be a regular file', { path: candidate });
    invariant(information.size <= maxBytes, 'ERR_ARTIFACT_TOO_LARGE', 'Adapter artifact exceeds the collection size limit', {
      path: candidate,
      size: information.size,
      maxBytes,
    });
    invariant(await exists(absolute), 'ERR_ARTIFACT_MISSING', 'Adapter artifact disappeared during collection', { path: candidate });
    const text = await readFile(absolute, 'utf8');
    collected.push({
      path: candidate,
      bytes: information.size,
      sha256: await hashFile(absolute),
      summary: summarizeContent(candidate, text),
    });
  }
  return {
    schema: 'shipping-harness/adapter-artifacts-v1',
    adapter: adapterName,
    collected,
    missing: presence.missing,
  };
}