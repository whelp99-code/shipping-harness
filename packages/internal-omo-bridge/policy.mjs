import path from 'node:path';
export const MAXIMUMS = Object.freeze({ parallelWorkers:2, agentDepth:1, continuations:3, fixCycles:2, wallClockSeconds:3600, toolCalls:200 });
export const DEFAULT_BUDGETS = Object.freeze({ parallelWorkers:2, agentDepth:1, continuations:3, fixCycles:2, wallClockSeconds:900, toolCalls:100 });
export function invariant(condition, code, message, details) { if (!condition) { const error=new Error(message); error.code=code; error.details=details; throw error; } }
export function normalizeRelative(value) {
  invariant(typeof value==='string'&&value.length>0,'ERR_OMO_PATH','A repository-relative path is required');
  const text=value.replaceAll('\\','/'); invariant(!text.startsWith('/')&&!/^[A-Za-z]:\//u.test(text)&&!text.includes('\0'),'ERR_OMO_PATH','Absolute or invalid path is forbidden');
  const normalized=path.posix.normalize(text); invariant(normalized!=='.'&&normalized!=='..'&&!normalized.startsWith('../'),'ERR_OMO_PATH','Path escapes the repository');
  invariant(normalized!=='.git'&&!normalized.startsWith('.git/')&&normalized!=='.shipping'&&!normalized.startsWith('.shipping/'),'ERR_OMO_PATH','Protected runtime paths are forbidden'); return normalized;
}
function globRegex(glob) { const escaped=glob.replace(/[.+^${}()|[\]\\]/gu,'\\$&').replace(/\*\*/gu,'§§').replace(/\*/gu,'[^/]*').replace(/§§/gu,'.*'); return new RegExp(`^${escaped}$`,'u'); }
export function pathAllowed(relative, allowed, forbidden) { const p=normalizeRelative(relative); return !forbidden.some((g)=>globRegex(g).test(p))&&allowed.some((g)=>globRegex(g).test(p)); }
export function validateBudgets(input={}) { const out={...DEFAULT_BUDGETS,...input}; for(const [key,max] of Object.entries(MAXIMUMS)){ invariant(Number.isInteger(out[key])&&out[key]>=1&&out[key]<=max,'ERR_OMO_BUDGET',`${key} must be between 1 and ${max}`); } return out; }
export function contained(base,target){ const b=path.resolve(base),t=path.resolve(target),rel=path.relative(b,t); return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)); }
