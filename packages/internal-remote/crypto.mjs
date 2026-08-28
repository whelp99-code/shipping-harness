import crypto from 'node:crypto';
export function stable(value){if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;return JSON.stringify(value);}
export function hmac(value,secret){return crypto.createHmac('sha256',secret).update(stable(value)).digest('hex');}
export function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
export function safeHex(left,right){return /^[a-f0-9]{64}$/u.test(left??'')&&/^[a-f0-9]{64}$/u.test(right??'')&&crypto.timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));}
export function randomId(prefix){return`${prefix}-${crypto.randomUUID()}`;}
