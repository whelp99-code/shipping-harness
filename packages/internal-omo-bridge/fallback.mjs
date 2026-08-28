import { invariant } from './policy.mjs';
export function fallbackDecision({runtimeStatus,contractAdapters={},allowFallback=false}) {
  if(runtimeStatus==='live') return {decision:'PRIVATE_OMO',reason:'private-runtime-live'};
  if(allowFallback){ const adapter=['codex','generic'].find((name)=>typeof contractAdapters?.[name]?.command==='string'&&contractAdapters[name].command.trim()); if(adapter) return {decision:'CONFIGURED_FALLBACK',adapter,reason:'private-runtime-unavailable'}; }
  return {decision:'BLOCKED',reason:'private-runtime-unavailable-and-no-approved-fallback'};
}
export function assertNoArbitraryExecutionInput(value){ if(!value||typeof value!=='object') return; for(const key of Object.keys(value)){ invariant(!['command','shell','argv','args','env','environment'].includes(key),'ERR_OMO_ARBITRARY_COMMAND',`Arbitrary execution field is forbidden: ${key}`); if(value[key]&&typeof value[key]==='object') assertNoArbitraryExecutionInput(value[key]); } }
