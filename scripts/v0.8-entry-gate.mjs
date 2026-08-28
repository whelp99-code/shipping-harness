import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportPath=path.join(root,'docs/reports/v0.8-entry-gate.json');
function readJson(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
export function evaluateEntryGate({pilot,pin}){
  const metrics=pilot.metrics??{};
  const criteria={
    multipleIndependentTasks:Number(metrics.independentParallelTasks??0)>=2,
    coordinationBlockers:Number(metrics.coordinationBlockers??0)>=1,
    measuredCompletionGain:Number(metrics.completionGainPercent??0)>=10,
    noFalseDoneRegression:Number(metrics.falseDoneDelta??0)<=0,
    realModelExecution:pilot.modelTask?.status==='completed'
  };
  const enabled=Object.values(criteria).every(Boolean);
  return {
    schema:'shipping-harness/v0.8-entry-gate-v1',
    release:'0.8.0',
    decision:enabled?'ENABLED':'DISABLED',
    teamMode:enabled,
    dagMode:enabled,
    criteria,
    pilotEvidence:'docs/reports/v0.7-omo-bridge-smoke.json',
    privateRuntime:{tag:pin.tag,commit:pin.commit,teamModeAtPilot:pilot.privateRuntime?.teamMode??false,dagModeAtPilot:pilot.privateRuntime?.dagMode??false},
    reason:enabled?'Measured v0.7 coordination evidence justifies a bounded Team/DAG experiment.':'v0.7 proved the private runtime boundary, canary, cancellation and fallback, but did not prove a multi-agent coordination bottleneck or completion gain. Team/DAG stays off.',
    next:'Re-evaluate only after a real internal pilot records at least two parallelizable tasks, a coordination blocker and a measured completion gain without false-done regression.',
    limits:{maxNodesPerRun:24,maxTeamMembers:4,maxParallelMembers:2,maxDepth:1,maxNodeRetries:1,maxGraphAmendments:1,maxReviewCycles:2,maxRolePingPong:2,maxWallClockMinutes:120,unlimitedValuesAllowed:false}
  };
}
export function currentDecision(){return evaluateEntryGate({pilot:readJson(path.join(root,'docs/reports/v0.7-omo-bridge-smoke.json')),pin:readJson(path.join(root,'config/upstreams/omo-pin.json'))});}
function comparable(value){const copy=structuredClone(value);delete copy.generatedAt;return JSON.stringify(copy);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const decision={...currentDecision(),generatedAt:new Date().toISOString()};
  if(process.argv.includes('--check')){
    if(!fs.existsSync(reportPath))throw new Error('v0.8 entry-gate report is missing');
    const stored=readJson(reportPath);if(comparable(stored)!==comparable(decision))throw new Error('v0.8 entry-gate report is stale or inconsistent');
    if(stored.decision!=='DISABLED')throw new Error('This pilot does not justify enabling Team/DAG');
    process.stdout.write(`${JSON.stringify(stored,null,2)}\n`);
  }else{fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,`${JSON.stringify(decision,null,2)}\n`);process.stdout.write(`${JSON.stringify(decision,null,2)}\n`);}
}
