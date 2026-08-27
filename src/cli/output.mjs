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
    `Evidence fresh    ${status.evidenceFresh ? 'YES' : 'NO'}`,
    `Agent runs        ${status.state.agentRuns}`,
    `Fix cycles        ${status.state.fixCycles}`,
    '',
    'Issues',
    `  BLOCKER         ${counts.BLOCKER}`,
    `  NEXT            ${counts.NEXT}`,
    `  IGNORE          ${counts.IGNORE}`,
    `  UNKNOWN         ${counts.UNKNOWN}`,
  ];
  if (status.contractError) lines.push('', `Contract diagnostic: ${status.contractError}`);
  if (status.closedDrift?.violations?.length) {
    lines.push('', `Closed-version drift: ${status.closedDrift.violations.length} violation(s)`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderHelp() {
  return `Shipping Harness\n\n` +
    `Usage: shipping-harness <command> [options]\n\n` +
    `Core commands:\n` +
    `  init [--project NAME] [--root PATH]\n` +
    `  contract check|show [--json]\n` +
    `  lock\n` +
    `  run --host generic|codex --command "..." [--verify]\n` +
    `  verify\n` +
    `  fix\n` +
    `  pause [--reason TEXT]\n` +
    `  resume [--reason TEXT]\n` +
    `  abort [--reason TEXT]\n` +
    `  issue add --title TEXT --class BLOCKER|NEXT|IGNORE|UNKNOWN [--basis ID] [--evidence REF]\n` +
    `  close\n` +
    `  status [--json]\n` +
    `  doctor [--json]\n` +
    `  version\n`;
}