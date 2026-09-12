import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { stableStringify } from '../../src/core/crypto.mjs';
import { invariant } from '../../src/core/errors.mjs';

/** @param {unknown} value @param {string} key */
export function signObject(value, key) {
  invariant(typeof key === 'string' && key.length >= 32, 'ERR_OMO_BRIDGE_KEY', 'Private OMO HMAC key must contain at least 32 characters');
  return createHmac('sha256', key).update(stableStringify(value)).digest('hex');
}

/** @param {unknown} value @param {string} signature @param {string} key */
export function verifySignature(value, signature, key) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/u.test(signature)) return false;
  const expected = signObject(value, key);
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/**
 * @returns {*}
 */
export function generateHmacKey() {
  return randomBytes(48).toString('hex');
}
