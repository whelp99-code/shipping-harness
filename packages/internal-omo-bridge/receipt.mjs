import { hmac, safeHexEqual } from './stable.mjs';
import { invariant, pathAllowed, validateBudgets } from './policy.mjs';
const STATUSES=new Set(['completed','cancelled','blocked','failed','unavailable']);
export function validateReceipt(receipt,{order,secret,currentGitSha}) {
  invariant(receipt&&typeof receipt==='object'&&!Array.isArray(receipt),'ERR_OMO_RECEIPT','Receipt must be an object');
  invariant(receipt.schema==='shipping-omo-receipt/v1'&&STATUSES.has(receipt.status),'ERR_OMO_RECEIPT','Unsupported receipt schema or status');
  const signature=receipt.signature; const unsigned={...receipt}; delete unsigned.signature;
  invariant(safeHexEqual(hmac(unsigned,secret),signature),'ERR_OMO_RECEIPT_SIGNATURE','Receipt signature is invalid');
  for(const key of ['workOrderId','releaseId','shippingSessionId','sourceGitSha','contractHash']) invariant(receipt[key]===order[key],'ERR_OMO_RECEIPT_BINDING',`Receipt ${key} does not match the signed work order`);
  invariant(receipt.sourceGitSha===currentGitSha,'ERR_OMO_STALE','Receipt was produced from a stale Git SHA');
  invariant(receipt.requiresShippingVerification===true,'ERR_OMO_RECEIPT_AUTHORITY','OMO receipts must require independent Shipping verification');
  invariant(Array.isArray(receipt.changedPaths),'ERR_OMO_RECEIPT','changedPaths must be an array');
  for(const changed of receipt.changedPaths) invariant(pathAllowed(changed,order.allowedPaths,order.forbiddenPaths),'ERR_OMO_SCOPE',`Runtime changed a path outside the signed scope: ${changed}`);
  const budgets=validateBudgets(order.budgets); const usage=receipt.usage??{};
  invariant(Number.isInteger(usage.turns)&&usage.turns>=0&&usage.turns<=budgets.toolCalls,'ERR_OMO_USAGE','Receipt turn usage is invalid');
  invariant(Number.isInteger(usage.toolCalls)&&usage.toolCalls>=0&&usage.toolCalls<=budgets.toolCalls,'ERR_OMO_USAGE','Receipt tool-call usage exceeds budget');
  invariant(Number.isInteger(usage.continuations)&&usage.continuations>=0&&usage.continuations<=budgets.continuations,'ERR_OMO_USAGE','Receipt continuation usage exceeds budget');
  return Object.freeze({...receipt,authority:'runtime-claim-only',shippingVerificationRequired:true});
}
