import net from 'node:net';
import path from 'node:path';

/**
 * @param {unknown} condition
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {asserts condition}
 */
export function invariant(condition, code, message, details) {
  if (condition) return;
  const error = /** @type {Error & {code?: string, details?: unknown}} */ (new Error(message));
  error.code = code;
  error.details = details;
  throw error;
}

export const ACTION_PERMISSION = Object.freeze({
  'projects/list': 'read',
  'shipping/status': 'read',
  'shipping/start': 'write',
  'shipping/approve': 'approve',
  'shipping/execute': 'write',
  'shipping/pause': 'control',
  'shipping/resume': 'control',
  'shipping/abort': 'control',
  'shipping/fix-blockers': 'write',
  'shipping/verify': 'write',
  'shipping/close': 'close',
  'evidence/summary': 'read',
  'approval/issue': 'approve',
  'notifications/list': 'read',
  'backup/create': 'admin',
  'backup/restore': 'admin',
  'health/read': 'read',
});

export const ALLOWED_ACTIONS = Object.freeze(Object.keys(ACTION_PERMISSION));

export const MUTATING_ACTIONS = Object.freeze(new Set([
  'shipping/start',
  'shipping/approve',
  'shipping/execute',
  'shipping/pause',
  'shipping/resume',
  'shipping/abort',
  'shipping/fix-blockers',
  'shipping/verify',
  'shipping/close',
  'approval/issue',
  'backup/create',
  'backup/restore',
]));

const FORBIDDEN_KEYS = new Set([
  'command',
  'rawcommand',
  'shell',
  'argv',
  'args',
  'env',
  'environment',
  'cwd',
  'executable',
  'binary',
  'program',
  'script',
  'providerkey',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'credential',
  'credentials',
]);

function normalizedKey(key) {
  return String(key).replace(/[-_\s]/gu, '').toLowerCase();
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {void}
 */
export function rejectArbitraryExecution(value, depth = 0) {
  invariant(depth <= 16, 'ERR_REMOTE_DEPTH', 'Remote input nesting is too deep');
  if (Array.isArray(value)) {
    invariant(value.length <= 256, 'ERR_REMOTE_SIZE', 'Remote array is too large');
    for (const item of value) rejectArbitraryExecution(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const entries = Object.entries(value);
  invariant(entries.length <= 128, 'ERR_REMOTE_SIZE', 'Remote object is too large');
  for (const [key, nested] of entries) {
    invariant(!FORBIDDEN_KEYS.has(normalizedKey(key)), 'ERR_REMOTE_ARBITRARY', `Remote execution or credential field is forbidden: ${key}`);
    rejectArbitraryExecution(nested, depth + 1);
  }
}

/**
 * @param {string} host
 * @returns {boolean}
 */
export function privateListenHost(host) {
  if (host === 'localhost' || host === '::1') return true;
  if (net.isIP(host) !== 4) return false;
  const parts = host.split('.').map(Number);
  return parts[0] === 127
    || parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

/**
 * @param {string} host
 * @returns {string}
 */
export function validateListen(host) {
  invariant(privateListenHost(host), 'ERR_REMOTE_LISTEN', 'Gateway listen host must be loopback or private IPv4; public and unspecified listeners are forbidden');
  return host;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} [max]
 * @returns {string}
 */
export function boundedString(value, label, max = 4096) {
  invariant(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= max, 'ERR_REMOTE_ARGUMENT', `${label} is required and bounded`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {{min?: number, max?: number, fallback?: number}} [options]
 * @returns {number}
 */
export function boundedInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const candidate = /** @type {unknown} */ (value ?? fallback);
  invariant(typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= min && candidate <= max, 'ERR_REMOTE_CONFIG', `${label} must be an integer between ${min} and ${max}`);
  return /** @type {number} */ (candidate);
}

/**
 * @param {string} parent
 * @param {string} target
 * @returns {boolean}
 */
export function pathWithin(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * @param {string} parent
 * @param {string} target
 * @param {string} [code]
 * @returns {string}
 */
export function assertPathWithin(parent, target, code = 'ERR_REMOTE_PATH') {
  invariant(pathWithin(parent, target), code, 'Path is outside the configured internal root', { parent: path.resolve(parent), target: path.resolve(target) });
  return path.resolve(target);
}
