/** @param {unknown} value */
export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** @param {Record<string, any>} status */
export function renderStatus(status) {
  const counts = status.issues.counts;
  const lines = [
    `Shipping Harness — ${status.contract?.project ?? 'uninitialized'}`,
    '',
    `State             ${status.state.state}`,
    `Release           ${status.contract?.release ?? status.state.release ?? '-'}`,
    `Git branch        ${status.git.branch ?? '-'}`,
    `Git SHA           ${status.git.sha.slice(0, 12)}`,
    `Git clean         ${status.git.clean ? 'YES' : 'NO'}`,
    `Contract valid    ${status.contractValid ? 'YES' : 'NO'}`,
    `State integrity   ${status.integrity?.level ?? 'UNKNOWN'}`,
    `Evidence fresh    ${status.evidenceFresh ? 'YES' : 'NO'}`,
    `Agent runs        ${status.state.agentRuns}`,
    `Fix cycles        ${status.state.fixCycles}`,
    `Post-lock commits ${status.commitsSinceLock ?? '-'}`,
    '',
    'Issues',
    `  BLOCKER         ${counts.BLOCKER}`,
    `  NEXT            ${counts.NEXT}`,
    `  IGNORE          ${counts.IGNORE}`,
    `  UNKNOWN         ${counts.UNKNOWN}`,
  ];
  if (status.integrity && status.integrity.ok === false) {
    lines.push('', `State integrity BROKEN: ${status.integrity.reason}`, `Proven state from ledger: ${status.integrity.ledgerState ?? 'unknown'}`);
  }
  const contractDefects = (status.issues.items ?? []).filter((issue) => (issue.diagnostics ?? [])
    .some((entry) => entry && typeof entry === 'object' && entry.code === 'CONTRACT_DEFECT_SUSPECTED'));
  for (const issue of contractDefects) {
    const diagnostic = issue.diagnostics.find((entry) => entry?.code === 'CONTRACT_DEFECT_SUSPECTED');
    lines.push('', `CONTRACT_DEFECT_SUSPECTED: ${diagnostic.detail}`);
  }
  if (status.scopeWarning?.outside?.length) {
    lines.push('', `Scope warning: ${status.scopeWarning.outside.length} changed path(s) outside the approved scope: ${status.scopeWarning.outside.slice(0, 10).join(', ')}`);
  }
  if (status.evidenceDirty?.dirtyPaths?.length) {
    lines.push('', `evidence: dirty (${status.evidenceDirty.dirtyPaths.length} uncommitted paths)`,
      `  ${status.evidenceDirty.dirtyPaths.slice(0, 10).join(', ')}`);
  }
  if (status.verifyBudget) {
    lines.push('', `Verify runs      ${status.verifyBudget.verifyRuns}/${status.verifyBudget.maxVerifyRuns}`,
      `Redundant runs   ${status.verifyBudget.redundantVerifyRuns}/${status.verifyBudget.maxRedundantVerifyRuns ?? 5}`);
  }
  if (status.contractError) lines.push('', `Contract diagnostic: ${status.contractError}`);
  if (status.closedDrift?.violations?.length) {
    lines.push('', `Closed-version drift: ${status.closedDrift.violations.length} violation(s)`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @returns {string}
 */
export function renderHelp() {
  return `Shipping Harness\n\n` +
    `Usage: shipping-harness <command> [options]\n\n` +
    `Core commands:\n` +
    `  init [--project NAME] [--root PATH]\n` +
    `  contract check|show [--json]\n` +
    `  lock [--skip-preflight]\n` +
    `  release prepare --version X.Y.Z [--goal TEXT]\n` +
    `  adapter list\n` +
    `  adapter probe NAME|--all [--json]\n` +
    `  adapter collect NAME [--json]\n` +
    `  run --host generic|codex|gajae|ouroboros|omo --command "..." [--verify]\n` +
    `  hook ingest --adapter omo --event Stop [--payload-file FILE]\n` +
    `  hook decision --adapter omo --event Stop\n` +
    `  verify [--no-baseline-replay]\n` +
    `  fix\n` +
    `  pause [--reason TEXT]\n` +
    `  resume [--reason TEXT]\n` +
    `  abort [--reason TEXT]\n` +
    `  issue add --title TEXT --class BLOCKER|NEXT|IGNORE|UNKNOWN [--basis ID] [--evidence REF]\n` +
    `  close [--allow-uncommitted]\n` +
    `  status [--json]\n` +
    `  plan status [--plan PATH] [--json]\n` +
  `  plan check [--plan PATH] [--json]\n` +
    `  core5 bundle lock|check [--criterion-version core5-criteria-vN] [--migration-ids ID,...] [--tools NAME=VERSION,...] [--models NAME=VERSION,...] [--images NAME=VERSION,...] [--evidence PATH,...]\n` +
    `  core5 decision [--json]\n` +
    `  doctor [--json]\n` +
    `  MCP server: shipping-harness-mcp --root /absolute/project/path\n` +
    `  version\n`;
}
