import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { boundedInteger, boundedString, invariant } from './policy.mjs';

function expiration(value) {
  if (typeof value === 'number') return value;
  return Number(value?.expiresAt ?? 0);
}

/**
 * ReplayStore.
 */
export class ReplayStore {
  constructor(file, { ttlMs = 600000, maxEntries = 10000 } = {}) {
    this.file = path.resolve(file);
    this.ttlMs = boundedInteger(ttlMs, 'replay ttlMs', { min: 1000, max: 24 * 60 * 60 * 1000 });
    this.maxEntries = boundedInteger(maxEntries, 'replay maxEntries', { min: 1, max: 100000 });
    /** @type {Promise<any>} */
    this.chain = Promise.resolve();
  }

  async #load() {
    try {
      const document = JSON.parse(await readFile(this.file, 'utf8'));
      invariant(document?.schema === 'shipping-remote/replay-v1' && document.entries && typeof document.entries === 'object', 'ERR_REMOTE_REPLAY_STORE', 'Replay store is invalid');
      return document;
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return { schema: 'shipping-remote/replay-v1', entries: {} };
      }
      throw error;
    }
  }

  async #persist(document) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }

  /** @param {string} key @param {{now?: number, ttlMs?: number, metadata?: Record<string, any> | null}} [options] */
  async claimKey(key, { now = Date.now(), ttlMs = this.ttlMs, metadata = null } = {}) {
    boundedString(key, 'replay key', 1024);
    const boundedTtl = boundedInteger(ttlMs, 'replay claim ttlMs', { min: 1000, max: 24 * 60 * 60 * 1000 });
    const run = async () => {
      const document = await this.#load();
      for (const [entryKey, value] of Object.entries(document.entries)) {
        if (expiration(value) <= now) delete document.entries[entryKey];
      }
      invariant(document.entries[key] === undefined, 'ERR_REMOTE_REPLAY', 'Request or one-time receipt was already consumed');
      invariant(Object.keys(document.entries).length < this.maxEntries, 'ERR_REMOTE_REPLAY_CAPACITY', 'Replay store capacity is exhausted');
      document.entries[key] = { claimedAt: now, expiresAt: now + boundedTtl, metadata };
      await this.#persist(document);
      return true;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async claim(actorId, nonce, now = Date.now()) {
    boundedString(actorId, 'actorId', 160);
    boundedString(nonce, 'nonce', 256);
    return this.claimKey(`request:${actorId}:${nonce}`, { now, metadata: { type: 'request', actorId } });
  }
}
