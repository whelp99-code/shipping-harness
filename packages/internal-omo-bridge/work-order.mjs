import { hmac, randomId } from './stable.mjs';
import { invariant, normalizeRelative, validateBudgets } from './policy.mjs';
const ALLOWED_OPERATIONS=new Set(['version-probe','canary-write','model-task']);
function strings(value,label,max=256){ invariant(Array.isArray(value)&&value.length<=max&&value.every((item)=>typeof item==='string'&&item.length>0),'ERR_OMO_ORDER',`${label} must be a bounded non-empty string array`); return [...value]; }
export function createWorkOrder(input) {
  invariant(input&&typeof input==='object','ERR_OMO_ORDER','Work-order input is required');
  invariant(typeof input.releaseId==='string'&&typeof input.contractHash==='string'&&typeof input.sourceGitSha==='string'&&typeof input.shippingSessionId==='string','ERR_OMO_ORDER','Release, contract, Git SHA and session bindings are required');
  invariant(input.operation&&ALLOWED_OPERATIONS.has(input.operation.kind),'ERR_OMO_OPERATION','Unsupported private OMO operation');
  const now=input.now??Date.now(); const ttlMs=Math.min(input.ttlMs??300_000,3_600_000);
  const operation={...input.operation}; if(operation.kind==='canary-write') operation.relativePath=normalizeRelative(operation.relativePath); if(operation.kind==='model-task') invariant(typeof operation.prompt==='string'&&Buffer.byteLength(operation.prompt,'utf8')<=64*1024,'ERR_OMO_OPERATION','Model prompt must be bounded');
  const order={ schema:'shipping-omo/v1', workOrderId:input.workOrderId??randomId('WO'), releaseId:input.releaseId, contractHash:input.contractHash, sourceGitSha:input.sourceGitSha, shippingSessionId:input.shippingSessionId, goalIds:strings(input.goalIds??[],'goalIds'), taskIds:strings(input.taskIds??[],'taskIds'), requirementIds:strings(input.requirementIds??[],'requirementIds'), acceptanceIds:strings(input.acceptanceIds??[],'acceptanceIds'), projectRoot:input.projectRoot, allowedPaths:strings(input.allowedPaths,'allowedPaths'), forbiddenPaths:strings(input.forbiddenPaths??['.git/**','.shipping/**'],'forbiddenPaths'), budgets:validateBudgets(input.budgets), operation, issuedAt:new Date(now).toISOString(), expiresAt:new Date(now+ttlMs).toISOString() };
  return Object.freeze(order);
}
export function signWorkOrder(order,secret){ invariant(typeof secret==='string'&&secret.length>=16,'ERR_OMO_SECRET','Shared secret must contain at least 16 characters'); return { order, signature:hmac(order,secret) }; }
