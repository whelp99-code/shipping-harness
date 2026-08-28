import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertPluginCompatibility, checkPluginCompatibility } from '../../packages/shipping-plugin/installer/compatibility.mjs';
import { installShippingPlugin } from '../../packages/shipping-plugin/installer/install.mjs';
import { createPluginInstallPlan } from '../../packages/shipping-plugin/installer/plan.mjs';
import { pluginPaths } from '../../packages/shipping-plugin/installer/paths.mjs';
import { uninstallShippingPlugin } from '../../packages/shipping-plugin/installer/uninstall.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function tempRoot(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function okRun(command, args) {
  if (String(command).includes('git') && args[0] === '--version') return { status: 0, stdout: 'git version 2.50.0\n', stderr: '' };
  return { status: 1, stdout: '', stderr: 'unsupported fake command' };
}

function codexRunner() {
  let registration = null;
  return {
    run(command, args) {
      if (String(command).includes('git') && args[0] === '--version') return { status: 0, stdout: 'git version 2.50.0\n', stderr: '' };
      if (String(command).includes('codex') && args[0] === 'mcp' && args[1] === '--help') {
        return { status: 0, stdout: 'Manage external MCP servers for Codex\n', stderr: '' };
      }
      if (args[0] === 'mcp' && args[1] === 'get') {
        if (!registration) return { status: 1, stdout: '', stderr: 'not found' };
        return {
          status: 0,
          stdout: `shipping-harness\n  enabled: true\n  transport: stdio\n  command: ${registration.command}\n  args: ${registration.args.join(' ')}\n`,
          stderr: '',
        };
      }
      if (args[0] === 'mcp' && args[1] === 'add') {
        registration = { command: args.at(-2), args: [args.at(-1)] };
        return { status: 0, stdout: 'Added global MCP server\n', stderr: '' };
      }
      if (args[0] === 'mcp' && args[1] === 'remove') {
        registration = null;
        return { status: 0, stdout: 'Removed\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: `unsupported: ${command} ${args.join(' ')}` };
    },
    current() { return registration; },
  };
}


test('generic install is previewable, local-only, idempotent, and uninstall preserves repository state', async (t) => {
  const root = await tempRoot(t, 'shipping-plugin-generic-');
  const installRoot = path.join(root, 'plugin-home');
  const projectRoot = path.join(root, 'project');
  await mkdir(path.join(projectRoot, '.shipping'), { recursive: true });
  const statePath = path.join(projectRoot, '.shipping', 'state.json');
  await writeFile(statePath, '{"state":"CLOSED","release":"0.5.0"}\n', 'utf8');

  const plan = await createPluginInstallPlan({ packageRoot, installRoot, host: 'generic', projectRoot });
  assert.equal(plan.publicListener, false);
  assert.equal(plan.arbitraryCommandInput, false);
  assert.deepEqual(plan.preserves, [path.join(projectRoot, '.shipping')]);
  assert.equal(await readFile(statePath, 'utf8'), '{"state":"CLOSED","release":"0.5.0"}\n');

  const preview = await installShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot, run: okRun });
  assert.equal(preview.dryRun, true);
  await assert.rejects(() => readFile(pluginPaths(installRoot).receipt, 'utf8'));

  const installed = await installShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot, dryRun: false, run: okRun, now: '2026-08-28T06:00:00.000Z' });
  assert.equal(installed.changed, true);
  assert.equal(JSON.parse(await readFile(pluginPaths(installRoot).manifest, 'utf8')).localOnly, true);
  assert.equal((await readFile(pluginPaths(installRoot).skill, 'utf8')).includes('user is the approver'), true);

  const repeated = await installShippingPlugin({ packageRoot, installRoot, host: 'generic', projectRoot, dryRun: false, run: okRun, now: '2026-08-28T07:00:00.000Z' });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.receipt.installedAt, '2026-08-28T06:00:00.000Z');

  const uninstallPreview = await uninstallShippingPlugin({ installRoot });
  assert.equal(uninstallPreview.dryRun, true);
  assert.equal(await readFile(statePath, 'utf8'), '{"state":"CLOSED","release":"0.5.0"}\n');

  const uninstalled = await uninstallShippingPlugin({ installRoot, dryRun: false });
  assert.equal(uninstalled.changed, true);
  assert.equal(await readFile(statePath, 'utf8'), '{"state":"CLOSED","release":"0.5.0"}\n');
  const again = await uninstallShippingPlugin({ installRoot, dryRun: false });
  assert.equal(again.missing, true);
});


test('Codex registration uses an explicit isolated home and is idempotent', async (t) => {
  const root = await tempRoot(t, 'shipping-plugin-codex-');
  const installRoot = path.join(root, 'plugin-home');
  const codexHome = path.join(root, '.codex');
  const fake = codexRunner();

  await assert.rejects(
    () => installShippingPlugin({ packageRoot, installRoot, host: 'codex', dryRun: false, run: fake.run.bind(fake) }),
    /explicit codexHome/u,
  );
  const installed = await installShippingPlugin({
    packageRoot,
    installRoot,
    host: 'codex',
    codexHome,
    codexExecutable: 'codex',
    dryRun: false,
    run: fake.run.bind(fake),
  });
  assert.equal(installed.hostResult.changed, true);
  assert.equal(fake.current().args[0].endsWith('bin/shipping-harness-mcp.mjs'), true);

  const repeated = await installShippingPlugin({
    packageRoot,
    installRoot,
    host: 'codex',
    codexHome,
    codexExecutable: 'codex',
    dryRun: false,
    run: fake.run.bind(fake),
  });
  assert.equal(repeated.idempotent, true);
  await uninstallShippingPlugin({ installRoot, dryRun: false, run: fake.run.bind(fake) });
  assert.equal(fake.current(), null);
});


test('compatibility fails clearly for unsupported Node or missing Git', () => {
  const unsupportedNode = checkPluginCompatibility({ nodeVersion: '21.9.0', run: okRun });
  assert.equal(unsupportedNode.ok, false);
  assert.throws(() => assertPluginCompatibility(unsupportedNode), /requires Node 22\+/u);

  const noGit = checkPluginCompatibility({
    nodeVersion: '22.0.0',
    run: () => ({ status: 1, stdout: '', stderr: 'git missing' }),
  });
  assert.equal(noGit.ok, false);
  assert.throws(() => assertPluginCompatibility(noGit), /requires Git/u);
});
