import path from 'node:path';

/** @param {string} root */
export function runtimePaths(root) {
  const directory = path.join(root, '.shipping');
  return {
    root,
    directory,
    contract: path.join(directory, 'contract.yaml'),
    lock: path.join(directory, 'contract.lock'),
    state: path.join(directory, 'state.json'),
    ledger: path.join(directory, 'ledger.jsonl'),
    issues: path.join(directory, 'issues.json'),
    backlog: path.join(directory, 'backlog.json'),
    releaseTrain: path.join(directory, 'release-train.json'),
    decisionLedger: path.join(directory, 'decision-ledger.jsonl'),
    decisionLedgerLock: path.join(directory, '.decision-ledger.lock'),
    autopilotPolicy: path.join(directory, 'autopilot-policy.json'),
    autopilotState: path.join(directory, 'autopilot-state.json'),
    autopilotLedger: path.join(directory, 'autopilot-ledger.jsonl'),
    autopilotMutation: path.join(directory, 'autopilot-mutation.json'),
    autopilotLock: path.join(directory, '.autopilot.lock'),
    integrations: path.join(directory, 'integrations.json'),
    hooks: path.join(directory, 'hooks.jsonl'),
    proposals: path.join(directory, 'proposals'),
    evidence: path.join(directory, 'evidence'),
    releases: path.join(directory, 'releases'),
    tmp: path.join(directory, 'tmp'),
  };
}