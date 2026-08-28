import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeError } from '../../../src/core/errors.mjs';
import { installShippingPlugin } from './install.mjs';
import { createPluginInstallPlan } from './plan.mjs';
import { uninstallShippingPlugin } from './uninstall.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? '');
}

function flag(name) {
  return process.argv.includes(name);
}

function help() {
  return `Shipping Harness Plugin ${process.env.npm_package_version ?? ''}\n\nUsage:\n  shipping-harness-plugin plan --install-root <path> [--host generic|codex] [--codex-home <path>] [--project-root <path>]\n  shipping-harness-plugin install --install-root <path> [--host generic|codex] [--codex-home <path>] [--project-root <path>] [--apply] [--replace]\n  shipping-harness-plugin uninstall --install-root <path> [--apply]\n\nNormal safety:\n  Without --apply, install and uninstall are dry-runs. Codex apply requires an explicit --codex-home.\n`;
}

function input() {
  return {
    packageRoot,
    installRoot: option('--install-root') ?? '',
    host: option('--host') ?? 'generic',
    codexHome: option('--codex-home'),
    codexExecutable: option('--codex-executable') ?? 'codex',
    projectRoot: option('--project-root'),
    dryRun: !flag('--apply'),
    replace: flag('--replace'),
  };
}

export async function main() {
  const command = process.argv[2] ?? 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(help());
    return;
  }
  let result;
  if (command === 'plan') result = await createPluginInstallPlan(input());
  else if (command === 'install') result = await installShippingPlugin(input());
  else if (command === 'uninstall') result = await uninstallShippingPlugin(input());
  else throw new Error(`Unknown plugin command: ${command}`);
  if (flag('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${command} ${result.dryRun ? 'preview' : 'completed'}: ${result.plan?.pluginHome ?? result.pluginHome ?? ''}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const normalized = normalizeError(error);
    process.stderr.write(`shipping-harness-plugin: ${normalized.message}\n`);
    process.exitCode = 1;
  });
}
