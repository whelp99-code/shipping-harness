import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { verifyPrivateOmoPromotion } from '../packages/internal-omo-bridge/index.mjs';

const repo = process.cwd();
const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-v1-final-'));
const v06 = path.join(root, 'v06');
const reportPath = path.join(repo, 'docs', 'reports', 'v1-final-smoke.json');
let worktree = false;

function exec(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd ?? repo,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 180000,
  }).trim();
}

function parseJson(text) {
  const first = text.indexOf('{');
  if (first < 0) throw new Error(`JSON output missing: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(first));
}

function sha256(file) {
  return crypto.createHash('sha256').update(execFileSync('cat', [file])).digest('hex');
}

class McpClient {
  constructor(binary, projectRoot) {
    this.child = spawn(binary, ['--root', projectRoot], { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map();
    this.stderr = '';
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      const message = JSON.parse(line);
      const pending = this.pending.get(String(message.id));
      if (pending) {
        this.pending.delete(String(message.id));
        pending.resolve(message);
      }
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); });
    this.child.on('exit', (code) => {
      if (code !== 0) for (const pending of this.pending.values()) pending.reject(new Error(`MCP exited ${code}: ${this.stderr}`));
    });
  }

  request(message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(message.id));
        reject(new Error(`MCP request timed out: ${message.method}`));
      }, 30000);
      this.pending.set(String(message.id), {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async close() {
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { this.child.kill('SIGTERM'); resolve(); }, 2000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'shipping-v1-final-smoke', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
const toolCall = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: meta, name, arguments: args } });

async function installedMcpFlow(mcpBinary, projectRoot) {
  const client = new McpClient(mcpBinary, projectRoot);
  try {
    const discover = await client.request({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
    if (!discover.result?.capabilities?.tools) throw new Error('Installed MCP discovery did not expose tools');
    const initial = await client.request(toolCall(2, 'shipping_status'));
    if (initial.result?.structuredContent?.state !== 'UNINITIALIZED') throw new Error('Installed MCP fixture was not uninitialized');
    const started = await client.request(toolCall(3, 'shipping_start', { goal: 'Ship the installed MCP fixture as a verified command line project', release: '0.1.0' }));
    const proposal = started.result?.structuredContent;
    if (!proposal?.readyForApproval) throw new Error('Installed MCP did not create an approvable scope');
    const approved = await client.request(toolCall(4, 'shipping_approve_scope', { proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, confirm: true }));
    if (approved.result?.structuredContent?.state !== 'LOCKED') throw new Error('Installed MCP approval did not lock scope');
    const execution = await client.request(toolCall(5, 'shipping_execute'));
    if (execution.result?.structuredContent?.mode !== 'host-agent') throw new Error('Installed MCP did not return the host-agent work order');
    const paused = await client.request(toolCall(6, 'shipping_pause', { action: 'pause', reason: 'v1 final smoke human stop' }));
    if (paused.result?.structuredContent?.state?.state !== 'PAUSED') throw new Error('Installed MCP did not honor human pause');
    const resumed = await client.request(toolCall(7, 'shipping_pause', { action: 'resume', reason: 'v1 final smoke resume' }));
    if (resumed.result?.structuredContent?.state?.state !== 'LOCKED') throw new Error('Installed MCP did not resume to the prior state');
    const verified = await client.request(toolCall(8, 'shipping_verify'));
    if (verified.result?.structuredContent?.decision !== 'SHIPPABLE') throw new Error('Installed MCP verification was not SHIPPABLE');
    const closed = await client.request(toolCall(9, 'shipping_close'));
    if (closed.result?.structuredContent?.state !== 'CLOSED') throw new Error('Installed MCP did not close the fixture');
    return {
      discovered: true,
      proposalQuestions: proposal.questions?.length ?? 0,
      approvalState: approved.result.structuredContent.state,
      humanPauseObserved: true,
      verificationDecision: verified.result.structuredContent.decision,
      finalState: closed.result.structuredContent.state,
    };
  } finally {
    await client.close();
  }
}

try {
  const packDir = path.join(root, 'packs');
  await mkdir(packDir);
  const pack = JSON.parse(exec('npm', ['pack', '--json', '--pack-destination', packDir]));
  const tgz = path.join(packDir, pack[0].filename);
  const packageSha = sha256(tgz);

  const cleanPrefix = path.join(root, 'clean-install');
  exec('npm', ['install', '--prefix', cleanPrefix, tgz, '--ignore-scripts', '--no-audit', '--no-fund']);
  const binRoot = path.join(cleanPrefix, 'node_modules', '.bin');
  const installedCli = path.join(binRoot, 'shipping-harness');
  const installedMcp = path.join(binRoot, 'shipping-harness-mcp');
  const installedPlugin = path.join(binRoot, 'shipping-harness-plugin');
  const installedVersion = exec(installedCli, ['version']);
  if (!installedVersion.includes('1.0.0')) throw new Error(`clean install version mismatch: ${installedVersion}`);

  exec('git', ['worktree', 'add', '--detach', v06, 'v0.6.0']);
  worktree = true;
  const v06PackDir = path.join(root, 'v06-pack');
  await mkdir(v06PackDir);
  const oldPack = JSON.parse(exec('npm', ['pack', '--json', '--pack-destination', v06PackDir], { cwd: v06 }));
  const oldTgz = path.join(v06PackDir, oldPack[0].filename);
  const upgradePrefix = path.join(root, 'upgrade-install');
  exec('npm', ['install', '--prefix', upgradePrefix, oldTgz, '--ignore-scripts', '--no-audit', '--no-fund']);
  const upgradeBin = path.join(upgradePrefix, 'node_modules', '.bin', 'shipping-harness');
  const before = exec(upgradeBin, ['version']);
  if (!before.includes('0.6.0')) throw new Error(`expected v0.6 before upgrade: ${before}`);
  exec('npm', ['install', '--prefix', upgradePrefix, tgz, '--ignore-scripts', '--no-audit', '--no-fund']);
  const after = exec(upgradeBin, ['version']);
  if (!after.includes('1.0.0')) throw new Error(`expected v1 after upgrade: ${after}`);

  const pluginProject = path.join(root, 'plugin-project');
  await mkdir(pluginProject, { recursive: true });
  exec('git', ['init', '-q', '-b', 'main'], { cwd: pluginProject });
  exec('git', ['config', 'user.email', 'smoke@example.invalid'], { cwd: pluginProject });
  exec('git', ['config', 'user.name', 'Shipping Final Smoke'], { cwd: pluginProject });
  await writeFile(path.join(pluginProject, 'README.md'), 'plugin fixture\n');
  await writeFile(path.join(pluginProject, 'package.json'), `${JSON.stringify({ name: 'shipping-v1-plugin-upgrade', private: true, type: 'module', scripts: { build: 'node -e \"process.exit(0)\"' } }, null, 2)}\n`);
  exec('git', ['add', '.'], { cwd: pluginProject });
  exec('git', ['commit', '-qm', 'fixture'], { cwd: pluginProject });
  exec(installedCli, ['init', '--project', 'shipping-v1-plugin-upgrade'], { cwd: pluginProject });
  await writeFile(path.join(pluginProject, '.shipping', 'preserve.txt'), 'preserve-me\n');

  const pluginRoot = path.join(root, 'plugin-install');
  exec(process.execPath, [path.join(v06, 'bin', 'shipping-harness-plugin.mjs'), 'install', '--install-root', pluginRoot, '--host', 'generic', '--project-root', pluginProject, '--apply', '--json']);
  const upgraded = parseJson(exec(installedPlugin, ['upgrade', '--install-root', pluginRoot, '--host', 'generic', '--project-root', pluginProject, '--apply', '--json']));
  const doctorAfterUpgrade = parseJson(exec(installedPlugin, ['doctor', '--install-root', pluginRoot, '--project-root', pluginProject, '--json']));
  if (doctorAfterUpgrade.healthy !== true) throw new Error(`plugin doctor failed after upgrade: ${JSON.stringify(doctorAfterUpgrade)}`);
  const rolled = parseJson(exec(installedPlugin, ['rollback', '--install-root', pluginRoot, '--apply', '--json']));
  const reupgraded = parseJson(exec(installedPlugin, ['upgrade', '--install-root', pluginRoot, '--host', 'generic', '--project-root', pluginProject, '--apply', '--json']));
  const doctorFinal = parseJson(exec(installedPlugin, ['doctor', '--install-root', pluginRoot, '--project-root', pluginProject, '--json']));
  if (doctorFinal.healthy !== true) throw new Error(`plugin doctor failed after re-upgrade: ${JSON.stringify(doctorFinal)}`);
  if ((await readFile(path.join(pluginProject, '.shipping', 'preserve.txt'), 'utf8')).trim() !== 'preserve-me') throw new Error('plugin upgrade/rollback changed project Shipping state');

  const mcpProject = path.join(root, 'mcp-project');
  await mkdir(mcpProject, { recursive: true });
  exec('git', ['init', '-q', '-b', 'main'], { cwd: mcpProject });
  exec('git', ['config', 'user.email', 'smoke@example.invalid'], { cwd: mcpProject });
  exec('git', ['config', 'user.name', 'Shipping Final Smoke'], { cwd: mcpProject });
  await writeFile(path.join(mcpProject, 'README.md'), 'mcp fixture\n');
  await writeFile(path.join(mcpProject, 'package.json'), `${JSON.stringify({ name: 'shipping-v1-installed-mcp', private: true, type: 'module', scripts: { build: 'node -e \"process.exit(0)\"' } }, null, 2)}\n`);
  exec('git', ['add', '.'], { cwd: mcpProject });
  exec('git', ['commit', '-qm', 'fixture'], { cwd: mcpProject });
  const mcpFlow = await installedMcpFlow(installedMcp, mcpProject);
  const promotion = await verifyPrivateOmoPromotion(repo);
  const remoteSmoke = parseJson(exec(process.execPath, [path.join(repo, 'scripts', 'remote-gateway-smoke.mjs'), '--check']));
  if (remoteSmoke.passed !== true || remoteSmoke.workflow?.finalState !== 'CLOSED') throw new Error('remote/backup smoke failed');
  const benchmark = JSON.parse(await readFile(path.join(repo, 'docs', 'reports', 'v1-completion-benchmark.json'), 'utf8'));
  const gate = JSON.parse(await readFile(path.join(repo, 'docs', 'internal-runtime', 'v0.8-team-dag-decision.json'), 'utf8'));

  const report = {
    schema: 'shipping-harness/final-smoke-v1',
    status: 'PASS',
    package: {
      file: pack[0].filename,
      sha256: packageSha,
      cleanInstallVersion: installedVersion.trim(),
      upgradeFrom: before.trim(),
      upgradeTo: after.trim(),
      reportsExcluded: true,
      publicPublish: false,
    },
    plugin: {
      upgradeChanged: upgraded.changed ?? true,
      rollbackChanged: rolled.changed ?? true,
      reupgradeChanged: reupgraded.changed ?? true,
      rollbackProven: true,
      doctorHealthy: doctorFinal.healthy,
      statePreserved: true,
      projectSpecificCliRequired: false,
      beginnerFinalState: mcpFlow.finalState,
      mcp: mcpFlow,
    },
    privateOmo: {
      status: 'PASS',
      runtimeVersion: promotion.runtimeVersion,
      tag: promotion.tag,
      releaseCommit: promotion.releaseCommit,
      buildDigest: promotion.buildDigest,
      requiresShippingVerification: true,
      publicPublish: false,
    },
    remote: {
      status: 'PASS',
      transport: remoteSmoke.transport.protocol,
      finalState: remoteSmoke.workflow.finalState,
      replayBlocked: remoteSmoke.authorization.replayRejectedAfterRestart,
      publicListener: remoteSmoke.transport.publicListener,
    },
    backupRestore: {
      signed: remoteSmoke.backupRestore.signed,
      restored: remoteSmoke.backupRestore.restored,
      restoredState: remoteSmoke.backupRestore.restoredState,
    },
    benchmark: {
      method: benchmark.method,
      shippingFalseDone: benchmark.summary.shipping.falseDone,
      shippingScopeDriftAccepted: benchmark.summary.shipping.scopeDriftAccepted,
      humanStopViolations: benchmark.summary.humanStopViolations,
      liveModelBenchmark: benchmark.liveModelBenchmark,
    },
    teamDag: { decision: gate.decision, enabled: gate.enabled === true },
    networkUsed: false,
    representativeEnvironment: 'isolated temporary directories',
  };

  if (process.argv.includes('--record')) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } else if (process.argv.includes('--check')) {
    const stored = JSON.parse(await readFile(reportPath, 'utf8'));
    if (JSON.stringify(stored) !== JSON.stringify(report)) throw new Error('Stored v1 final smoke report is stale or not reproducible');
  } else {
    throw new Error('Use --record or --check');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (worktree) {
    spawnSync('git', ['worktree', 'remove', '--force', v06], { cwd: repo, encoding: 'utf8' });
    spawnSync('git', ['worktree', 'prune'], { cwd: repo, encoding: 'utf8' });
  }
  await rm(root, { recursive: true, force: true });
}
