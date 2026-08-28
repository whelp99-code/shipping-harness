import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { boundedInteger, invariant } from './policy.mjs';
import { randomId } from './crypto.mjs';

function boundedText(value, label, max = 256) {
  invariant(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= max, 'ERR_NOTIFICATION_EVENT', `${label} is required and bounded`);
  return value;
}

function dedupeKey(event) {
  if (typeof event.dedupeKey === 'string' && event.dedupeKey.length > 0) {
    return boundedText(event.dedupeKey, 'notification dedupe key', 512);
  }
  const parts = [
    boundedText(event.projectId, 'notification projectId', 160),
    boundedText(event.type, 'notification type', 80),
    typeof event.state === 'string' ? event.state : '',
    typeof event.release === 'string' ? event.release : '',
    Number.isInteger(event.blockers) ? String(event.blockers) : '',
  ];
  return parts.join(':');
}

function normalizeEvent(event) {
  invariant(event && typeof event === 'object' && !Array.isArray(event), 'ERR_NOTIFICATION_EVENT', 'Notification event must be an object');
  const body = {
    projectId: boundedText(event.projectId, 'notification projectId', 160),
    actorId: boundedText(event.actorId, 'notification actorId', 160),
    type: boundedText(event.type, 'notification type', 80),
    ...(typeof event.state === 'string' ? { state: boundedText(event.state, 'notification state', 80) } : {}),
    ...(typeof event.release === 'string' ? { release: boundedText(event.release, 'notification release', 160) } : {}),
    ...(Number.isInteger(event.blockers) ? { blockers: boundedInteger(event.blockers, 'notification blockers', { min: 0, max: 100000 }) } : {}),
  };
  return { ...body, dedupeKey: dedupeKey({ ...event, ...body }) };
}

export class NotificationStore {
  constructor(file, { maxEntries = 1000, dedupeWindowMs = 24 * 60 * 60 * 1000 } = {}) {
    this.file = path.resolve(file);
    this.maxEntries = boundedInteger(maxEntries, 'notification max entries', { min: 1, max: 10000 });
    this.dedupeWindowMs = boundedInteger(dedupeWindowMs, 'notification dedupe window', { min: 1000, max: 30 * 24 * 60 * 60 * 1000 });
    this.chain = Promise.resolve();
  }

  async #read() {
    let text = '';
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          const failure = new Error(`Invalid notification JSONL at line ${index + 1}`);
          failure.code = 'ERR_NOTIFICATION_CORRUPT';
          failure.cause = error;
          throw failure;
        }
      });
  }

  async #write(items) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = path.join(path.dirname(this.file), `.${path.basename(this.file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      const content = items.length > 0 ? `${items.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async append(event, { now = Date.now() } = {}) {
    const normalized = normalizeEvent(event);
    const run = async () => {
      const items = await this.#read();
      const duplicate = [...items].reverse().find((item) => {
        const created = Date.parse(item.createdAt);
        return item.dedupeKey === normalized.dedupeKey
          && Number.isFinite(created)
          && now - created >= 0
          && now - created <= this.dedupeWindowMs;
      });
      if (duplicate) return { ...duplicate, duplicate: true };

      const body = {
        schema: 'shipping-remote/notification-v1',
        id: randomId('NOTICE'),
        createdAt: new Date(now).toISOString(),
        ...normalized,
      };
      const retained = [...items, body].slice(-this.maxEntries);
      await this.#write(retained);
      return { ...body, duplicate: false };
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async list({ projectId, afterId, limit = 50 } = {}) {
    await this.chain;
    const boundedLimit = boundedInteger(limit, 'notification list limit', { min: 1, max: 100 });
    let items = await this.#read();
    if (projectId !== undefined) {
      boundedText(projectId, 'notification projectId', 160);
      items = items.filter((item) => item.projectId === projectId);
    }
    if (afterId !== undefined) {
      boundedText(afterId, 'notification afterId', 160);
      const index = items.findIndex((item) => item.id === afterId);
      if (index >= 0) items = items.slice(index + 1);
    }
    return items.slice(-boundedLimit);
  }
}
