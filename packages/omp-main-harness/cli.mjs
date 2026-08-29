import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctorOmpMainHarness } from './doctor.mjs';
import { bootstrapOmpMainHarness, installOmpMainHarness, planOmpMainHarness, rollbackOmpMainHarness } from './install.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? '');
}

function flag(name) {
  return process.argv.includes(name);
}

function input() {
  return {
    home: option('--home') ?? undefined,
    agentDir: option('--agent-dir') ?? undefined,
    shippingPrefix: option('--shipping-prefix') ?? undefined,
    ompCommand: option('--omp-command') ?? undefined,
    npmCommand: option('--npm-command') ?? undefined,
    packagePath: option('--package') ?? undefined,
    backupId: option('--backup-id') ?? undefined,
    tag: option('--tag') ?? undefined,
    requireTag: !flag('--no-tag-check'),
    dryRun: !flag('--apply'),
  };
}

function help() {
  return `Shipping Harness OMP Main Harness\n\nUsage:\n  shipping-harness-omp preview [options]\n  shipping-harness-omp bootstrap [--tag vX.Y.Z] [--apply] [options]\n  shipping-harness-omp install --package <shipping-harness.tgz> [--apply] [options]\n  shipping-harness-omp doctor [options]\n  shipping-harness-omp rollback --backup-id <id> [--apply] [options]\n  shipping-harness-omp field-smoke [--project <path>] [--check] [options]\n\nOptions:\n  --home <path>             User home to manage (default: $HOME)\n  --agent-dir <path>        OMP agent directory (default: ~/.omp/agent)\n  --shipping-prefix <path>  npm user-global prefix (default: ~/.local)\n  --omp-command <path>      OMP executable or wrapper (default: omp)\n  --npm-command <path>      npm executable (default: /usr/bin/npm)\n  --json                    Print structured JSON\n  --apply                   Perform writes; omitted means preview\n\nSafety:\n  bootstrap requires a clean annotated tag by default, never publishes, preserves the old package and OMP files, and automatically rolls back a failed install.\n`;
}

function render(command, result) {
  if (flag('--json')) return `${JSON.stringify(result, null, 2)}\n`;
  if (command === 'doctor') {
    return [
      `Shipping Harness: ${result.shippingVersion ?? 'missing'} (${result.checks.shippingVersion ? 'PASS' : 'FAIL'})`,
      `OMP: ${result.ompVersion ?? 'missing'} (${result.checks.ompSmoke ? 'PASS' : 'FAIL'})`,
      `MCP tools: ${result.details.protocol?.tools ?? 0} (${result.checks.protocol ? 'PASS' : 'FAIL'})`,
      `Approval: ${result.details.configuration?.approvalMode ?? 'missing'} (${result.checks.approvalPolicy ? 'PASS' : 'FAIL'})`,
      `Main harness: ${result.healthy ? 'PASS' : 'FAIL'}`,
      `Receipt: ${result.paths.receipt}`,
    ].join('\n') + '\n';
  }
  if (command === 'rollback') return `Rollback ${result.dryRun ? 'preview' : 'completed'}: ${result.backupId} -> Shipping ${result.restoredShippingVersion ?? 'none'}\n`;
  if (command === 'field-smoke') return `OMP field smoke: ${result.status} / OMP ${result.omp?.version} / ${result.mcp?.tools} tools / nested pilot ${result.pilot?.status}\n`;
  if (result.dryRun) return `OMP main-harness preview: Shipping ${result.currentShippingVersion ?? 'not installed'} -> ${result.targetShippingVersion}, OMP ${result.omp?.version}\nRun the same command with --apply after review.\n`;
  return [
    'DONE',
    `Shipping Harness: ${result.shippingVersion}`,
    `OMP: omp/${result.ompVersion}`,
    `MCP tools: ${result.tools} PASS`,
    `Approval: ${result.approvalMode}`,
    `Main harness: ${result.mainHarness ? 'enabled' : 'disabled'}`,
    `Receipt: ${result.receipt}`,
    `Backup: ${result.backup?.path}`,
    `Rollback: ${result.rollbackCommand}`,
  ].join('\n') + '\n';
}

export async function main() {
  const command = process.argv[2] ?? 'help';
  if (['help', '--help', '-h'].includes(command)) {
    process.stdout.write(help());
    return;
  }
  let result;
  if (command === 'preview') result = await planOmpMainHarness(input());
  else if (command === 'bootstrap') result = await bootstrapOmpMainHarness(input());
  else if (command === 'install') result = await installOmpMainHarness(input());
  else if (command === 'doctor') result = await doctorOmpMainHarness(input());
  else if (command === 'rollback') {
    const value = input();
    if (!value.backupId) throw new Error('--backup-id is required for rollback');
    result = await rollbackOmpMainHarness(value);
  } else if (command === 'field-smoke') {
    const { runFieldSmoke } = await import('./field-smoke.mjs');
    result = await runFieldSmoke({
      ompCommand: option('--omp-command') ?? undefined,
      project: option('--project') ?? undefined,
      check: flag('--check'),
    });
  } else throw new Error(`Unknown OMP main-harness command: ${command}`);
  process.stdout.write(render(command, result));
  if (command === 'doctor' && !result.healthy) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error && typeof error === 'object' && 'code' in error ? ` [${error.code}]` : '';
    process.stderr.write(`shipping-harness-omp: ${error instanceof Error ? error.message : String(error)}${code}\n`);
    process.exitCode = 1;
  });
}
