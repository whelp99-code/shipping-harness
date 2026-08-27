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
    integrations: path.join(directory, 'integrations.json'),
    hooks: path.join(directory, 'hooks.jsonl'),
    proposals: path.join(directory, 'proposals'),
    evidence: path.join(directory, 'evidence'),
    releases: path.join(directory, 'releases'),
    tmp: path.join(directory, 'tmp'),
  };
}