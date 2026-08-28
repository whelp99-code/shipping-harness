import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invariant } from './errors.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const STABLE_SCHEMAS=Object.freeze({
 contract:'shipping-harness/contract-v1',decision:'shipping-harness/decision-v1',goalTask:'shipping-harness/goal-task-v1',evidence:'shipping-harness/evidence-v1',release:'shipping-harness/release-v1',mcpResult:'shipping-harness/mcp-result-v1',omoWorkOrder:'shipping-omo/v1',omoReceipt:'shipping-omo-receipt/v1',remoteRequest:'shipping-harness/remote-request-v1',remoteResponse:'shipping-harness/remote-response-v1',backup:'shipping-harness/backup-v1'
});
export const SCHEMA_FILES=Object.freeze({
 [STABLE_SCHEMAS.contract]:'contract.schema.json',[STABLE_SCHEMAS.decision]:'decision.schema.json',[STABLE_SCHEMAS.goalTask]:'goal-task.schema.json',[STABLE_SCHEMAS.evidence]:'evidence.schema.json',[STABLE_SCHEMAS.release]:'release.schema.json',[STABLE_SCHEMAS.mcpResult]:'mcp-result.schema.json',[STABLE_SCHEMAS.omoWorkOrder]:'omo-work-order.schema.json',[STABLE_SCHEMAS.omoReceipt]:'omo-receipt.schema.json',[STABLE_SCHEMAS.remoteRequest]:'remote-request.schema.json',[STABLE_SCHEMAS.remoteResponse]:'remote-response.schema.json',[STABLE_SCHEMAS.backup]:'backup.schema.json'
});
export async function loadSchema(id){const file=SCHEMA_FILES[id];invariant(file,'ERR_STABLE_SCHEMA',`Unknown stable schema: ${id}`);return JSON.parse(await readFile(path.join(root,'schemas/v1',file),'utf8'));}
export function validateStableArtifact(id,value){invariant(SCHEMA_FILES[id],'ERR_STABLE_SCHEMA',`Unknown stable schema: ${id}`);invariant(value&&typeof value==='object'&&!Array.isArray(value),'ERR_STABLE_ARTIFACT','Stable artifact must be an object');const schema=value.schema??value.rpc;invariant(schema===id,'ERR_STABLE_ARTIFACT',`Artifact schema mismatch: expected ${id}, received ${String(schema)}`);const required={
 [STABLE_SCHEMAS.contract]:['project','release','goal','scope','acceptance'],[STABLE_SCHEMAS.decision]:['mode','approvalStatus','scope','acceptance'],[STABLE_SCHEMAS.goalTask]:['release','contractHash','goals','tasks'],[STABLE_SCHEMAS.evidence]:['release','contractHash','gitSha','criterionId'],[STABLE_SCHEMAS.release]:['release','state','contractHash'],[STABLE_SCHEMAS.mcpResult]:['ok'],[STABLE_SCHEMAS.omoWorkOrder]:['workOrderId','releaseId','contractHash','sourceGitSha','shippingSessionId','budgets'],[STABLE_SCHEMAS.omoReceipt]:['workOrderId','releaseId','sourceGitSha','requiresShippingVerification','status','signature'],[STABLE_SCHEMAS.remoteRequest]:['requestId','actorId','projectId','action','timestamp','nonce','signature'],[STABLE_SCHEMAS.remoteResponse]:['requestId','ok'],[STABLE_SCHEMAS.backup]:['backupId','projectId','files','signature']
 }[id]??[];for(const key of required)invariant(Object.hasOwn(value,key),'ERR_STABLE_ARTIFACT',`Missing stable field ${key}`);return value;}
