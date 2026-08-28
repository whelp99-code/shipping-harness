import crypto from 'node:crypto';
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function hmac(value, secret) { return crypto.createHmac('sha256', secret).update(stable(value)).digest('hex'); }
export function safeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/u.test(left ?? '') || !/^[a-f0-9]{64}$/u.test(right ?? '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
export function randomId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
