import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { STABLE_SCHEMAS } from './schema-registry.mjs';
import { stableInvariant } from './errors.mjs';

const SECRET_KEY = /(authorization|api[-_]?key|token|password|secret|cookie|credential)/iu;
const SEVERITIES = new Set(['debug', 'info', 'warn', 'error', 'critical']);

function redact(value, depth = 0) {
  if (depth > 12) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redact(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redact(nested, depth + 1),
    ]));
  }
  if (typeof value === 'string' && value.length > 8192) return `${value.slice(0, 8192)}[TRUNCATED]`;
  return value;
}

/**
 * StableEventLog.
 */
export class StableEventLog {
  constructor(file) {
    stableInvariant(typeof file === 'string' && file.length > 0, 'ERR_STABLE_EVENT_PATH', 'Stable event path is required');
    this.file = path.resolve(file);
    /** @type {Promise<any>} */
    this.chain = Promise.resolve();
  }

  async append({ type, project, release, severity = 'info', data = {} }) {
    stableInvariant(typeof type === 'string' && type.length > 0 && type.length <= 160, 'ERR_STABLE_EVENT', 'Event type is required and bounded');
    stableInvariant(typeof project === 'string' && project.length > 0 && project.length <= 160, 'ERR_STABLE_EVENT', 'Event project is required and bounded');
    stableInvariant(typeof release === 'string' && release.length > 0 && release.length <= 80, 'ERR_STABLE_EVENT', 'Event release is required and bounded');
    stableInvariant(SEVERITIES.has(severity), 'ERR_STABLE_EVENT', 'Event severity is invalid');
    const event = {
      schema: STABLE_SCHEMAS.stableEvent,
      id: `EV-${randomUUID()}`,
      time: new Date().toISOString(),
      type,
      project,
      release,
      severity,
      data: redact(data),
    };
    const encoded = `${JSON.stringify(event)}\n`;
    stableInvariant(Buffer.byteLength(encoded, 'utf8') <= 65536, 'ERR_STABLE_EVENT_SIZE', 'Stable event exceeds 64 KiB');
    const run = async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await appendFile(this.file, encoded, { mode: 0o600 });
      return event;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async read(limit = 100) {
    stableInvariant(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'ERR_STABLE_EVENT_LIMIT', 'Event read limit must be between 1 and 1000');
    let text = '';
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return text.split('\n').filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
  }
}
