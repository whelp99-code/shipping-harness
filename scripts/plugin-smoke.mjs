import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hashFile } from '../src/core/crypto.mjs';
import { singleNpmPackEntry } from '../src/core/npm-pack.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'shipping-plugin-smoke-'));
const packDir = path.join(tmp, 'pack');
const envRoot = path.join(tmp, 'env');
const installRoot = path.join(tmp, 'plugin');
const codexHome = path.join(tmp, '.codex');
const fixture = path.join(tmp, 'fixture');
await Promise.all([packDir, envRoot, installRoot, codexHome, fixture].map((dir) => mkdir(dir, { recursive: true })));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

class McpClient {
  constructor(binary, root) {
    this.child = spawn(process.execPath, [binary, '--root', root], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.queue = [];
    this.waiters = [];
    this.stderr = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.rl.on('line', (line) => {
      const value = JSON.parse(line);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(value);
      else this.queue.push(value);
    });
  }
  async request(id, method, params = {}) {
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP request ${method} timed out: ${this.stderr}`)), 15000);
      const wrapped = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject };
      if (this.queue.length > 0) wrapped.resolve(this.queue.shift());
      else this.waiters.push(wrapped);
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const response = await promise;
    if (response.error) throw new Error(`${method} protocol error: ${JSON.stringify(response.error)}`);
    if (response.result?.isError) throw new Error(`${method} tool error: ${JSON.stringify(response.result.structuredContent)}`);
    return response.result;
  }
  async close() {
    this.child.stdin.end();
    await new Promise((resolve) => this.child.once('close', resolve));
  }
}

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'shipping-plugin-smoke', version: '0.6.0' },
  'io.modelcontextprotocol/clientCapabilities': { resources: true },
};
const tool = (name, argumentsValue = {}) => ({ _meta: meta, name, arguments: argumentsValue });

try {
  const packOutput = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: projectRoot });
  const packed = singleNpmPackEntry(JSON.parse(packOutput));
  const tarball = path.join(packDir, packed.filename);
  run('npm', ['install', '--prefix', envRoot, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: tmp });
  const installedRoot = path.join(envRoot, 'node_modules', 'shipping-harness');
  const pluginCli = path.join(installedRoot, 'bin', 'shipping-harness-plugin.mjs');
  const mcpBinary = path.join(installedRoot, 'bin', 'shipping-harness-mcp.mjs');
  const cliBinary = path.join(installedRoot, 'bin', 'shipping-harness.mjs');
  assert.equal(run(process.execPath, [cliBinary, 'version'], { cwd: tmp }).trim(), '0.6.0');

  await writeFile(path.join(fixture, 'package.json'), `${JSON.stringify({
    name: 'shipping-plugin-smoke-fixture',
    private: true,
    scripts: {
      build: `node -e "process.stdout.write('build-pass')"`,
      test: `node -e "process.stdout.write('test-pass')"`,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(fixture, 'README.md'), '# Shipping Plugin Smoke Fixture\n', 'utf8');
  run('git', ['init', '-b', 'main'], { cwd: fixture });
  run('git', ['config', 'user.name', 'Shipping Plugin Smoke'], { cwd: fixture });
  run('git', ['config', 'user.email', 'shipping-plugin-smoke@example.invalid'], { cwd: fixture });
  run('git', ['add', '.'], { cwd: fixture });
  run('git', ['commit', '-m', 'fixture baseline'], { cwd: fixture });

  const installJson = run(process.execPath, [pluginCli, 'install', '--install-root', installRoot, '--host', 'codex', '--codex-home', codexHome, '--project-root', fixture, '--apply', '--json'], { cwd: tmp });
  const install = JSON.parse(installJson);
  assert.equal(install.receipt.packageVersion, '0.6.0');
  assert.equal(install.receipt.publicListener, false);
  const codexEnv = { ...process.env, CODEX_HOME: codexHome };
  const registration = run('codex', ['mcp', 'get', 'shipping-harness'], { cwd: fixture, env: codexEnv });
  assert.match(registration, /transport:\s+stdio/u);
  assert.match(registration, /shipping-harness-mcp\.mjs/u);

  const client = new McpClient(mcpBinary, fixture);
  const discover = await client.request(1, 'server/discover', { _meta: meta });
  assert.equal(discover.supportedVersions.includes('2026-07-28'), true);
  const resources = await client.request(2, 'resources/list', { _meta: meta });
  assert.equal(resources.resources.some((entry) => entry.uri === 'shipping://current/status'), true);
  const started = await client.request(3, 'tools/call', tool('shipping_start', { goal: '완성된 로컬 설치와 테스트 흐름을 증명하는 가장 작은 버전을 끝낸다.', proposerId: 'installed-smoke-agent' }));
  const proposal = started.structuredContent;
  assert.equal(proposal.readyForApproval, true);
  assert.equal(proposal.userView.userState, 'AWAITING_APPROVAL');
  await client.request(4, 'tools/call', tool('shipping_approve_scope', { proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, confirm: true }));
  await client.request(5, 'tools/call', tool('shipping_pause', { action: 'pause', reason: 'smoke pause' }));
  const paused = await client.request(6, 'tools/call', tool('shipping_status'));
  assert.equal(paused.structuredContent.userView.userState, 'PAUSED');
  await client.request(7, 'tools/call', tool('shipping_pause', { action: 'resume', reason: 'smoke resume' }));
  const verified = await client.request(8, 'tools/call', tool('shipping_verify'));
  assert.equal(verified.structuredContent.decision, 'SHIPPABLE');
  const closed = await client.request(9, 'tools/call', tool('shipping_close'));
  assert.equal(closed.structuredContent.state, 'CLOSED');
  const finalStatus = await client.request(10, 'resources/read', { _meta: meta, uri: 'shipping://current/status' });
  assert.equal(JSON.parse(finalStatus.contents[0].text).userState, 'CLOSED');
  await client.close();

  const statePath = path.join(fixture, '.shipping', 'state.json');
  const stateHash = await hashFile(statePath);
  run(process.execPath, [pluginCli, 'uninstall', '--install-root', installRoot, '--apply', '--json'], { cwd: tmp });
  assert.equal(await hashFile(statePath), stateHash);
  run(process.execPath, [pluginCli, 'install', '--install-root', installRoot, '--host', 'codex', '--codex-home', codexHome, '--project-root', fixture, '--apply', '--json'], { cwd: tmp });
  assert.equal(await hashFile(statePath), stateHash);
  const doctor = JSON.parse(run(process.execPath, [pluginCli, 'doctor', '--install-root', installRoot, '--project-root', fixture, '--json'], { cwd: tmp }));
  assert.equal(doctor.healthy, true);

  process.stdout.write(`${JSON.stringify({
    schema: 'shipping-harness/v0.6-plugin-smoke-v1',
    package: packed.filename,
    packageVersion: install.receipt.packageVersion,
    codexRegistration: true,
    resources: resources.resources.length,
    userFlow: ['start', 'approve', 'pause', 'resume', 'verify', 'close'],
    finalState: 'CLOSED',
    uninstallReinstallStatePreserved: true,
    doctorHealthy: true,
  }, null, 2)}\n`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
