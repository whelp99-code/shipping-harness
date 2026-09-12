import crypto from 'node:crypto';
/**
 * @param {unknown} value
 * @returns {string}
 */
export function stable(value){if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;return JSON.stringify(value);}
/**
 * @param {unknown} value
 * @param {import('node:crypto').BinaryLike} secret
 * @returns {string}
 */
export function hmac(value,secret){return crypto.createHmac('sha256',secret).update(stable(value)).digest('hex');}
/**
 * @param {import('node:crypto').BinaryLike} value
 * @returns {string}
 */
export function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function safeHex(left,right){return /^[a-f0-9]{64}$/u.test(left??'')&&/^[a-f0-9]{64}$/u.test(right??'')&&crypto.timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));}
/**
 * @param {string} prefix
 * @returns {string}
 */
export function randomId(prefix){return`${prefix}-${crypto.randomUUID()}`;}
