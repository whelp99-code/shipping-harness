import path from 'node:path';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { defaultNpmCommand, runCommand } from '../../packages/omp-main-harness/io.mjs';

export async function createFakeOmpEnvironment() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-omp-main-test-'));
  const home = path.join(root, 'home');
  const agentDir = path.join(home, '.omp', 'agent');
  const prefix = path.join(home, '.local');
  const bin = path.join(root, 'bin');
  await mkdir(path.join(agentDir, 'skills', 'shipping-harness'), { recursive: true });
  await mkdir(prefix, { recursive: true });
  await mkdir(bin, { recursive: true });

  const mcpBefore = {
    mcpServers: {
      existing: { type: 'stdio', command: '/usr/bin/true', enabled: true },
      'shipping-harness': { type: 'stdio', command: '/old/shipping-harness-mcp', enabled: true, timeout: 10 },
    },
    preserve: { value: true },
  };
  await writeFile(path.join(agentDir, 'mcp.json'), `${JSON.stringify(mcpBefore, null, 2)}\n`, 'utf8');
  await writeFile(path.join(agentDir, 'config.yml'), 'modelRoles:\n  default: existing/model\ncomposer:\n  shape: band\n', 'utf8');
  await writeFile(path.join(agentDir, 'AGENTS.md'), '# Existing OMP rules\n\nKeep this rule.\n', 'utf8');
  await writeFile(path.join(agentDir, 'skills', 'shipping-harness', 'SKILL.md'), '# Old Shipping skill\n', 'utf8');
  await writeFile(path.join(agentDir, 'shipping-harness-install.json'), `${JSON.stringify({
    schema: 'shipping-harness/omp-main-install-v1',
    shippingHarness: { version: '1.0.1' },
    omp: { version: '15.10.12' },
    integration: { tools: 8, managerSmoke: 'PASS', mainHarness: true },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(agentDir, '.fake-omp-state.json'), `${JSON.stringify({
    'tools.approvalMode': 'write',
    'tools.approval': { existing_tool: 'allow' },
  }, null, 2)}\n`, 'utf8');

  const omp = path.join(bin, 'omp');
  await writeFile(omp, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const agent = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME, '.omp', 'agent');
const statePath = path.join(agent, '.fake-omp-state.json');
const configPath = path.join(agent, 'config.yml');
const load = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const save = (state) => {
  fs.mkdirSync(agent, { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n', { mode: 0o600 });
  const start = '# >>> fake omp managed tools >>>';
  const end = '# <<< fake omp managed tools <<<';
  let existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  if (existing.includes(start) && existing.includes(end)) {
    existing = existing.slice(0, existing.indexOf(start)).trimEnd() + '\\n';
  }
  const managed = start + '\\n# ' + JSON.stringify(state) + '\\n' + end + '\\n';
  fs.writeFileSync(configPath, existing.trimEnd() + (existing.trim() ? '\\n' : '') + managed, { mode: 0o600 });
};
if (args[0] === '--version') { console.log('omp/18.0.10'); process.exit(0); }
if (args[0] === '--smoke-test') { console.log('smoke-test: ok'); process.exit(0); }
if (args[0] === 'config' && args[1] === 'path') { console.log(agent); process.exit(0); }
if (args[0] === 'config' && args[1] === 'get') {
  const state = load();
  const key = args[2];
  console.log(JSON.stringify({ key, value: state[key] }));
  process.exit(0);
}
if (args[0] === 'config' && args[1] === 'set') {
  const state = load();
  const key = args[2];
  const raw = args[3];
  let value = raw;
  try { value = JSON.parse(raw); } catch {}
  state[key] = value;
  save(state);
  console.log(JSON.stringify({ key, value }));
  process.exit(0);
}
console.error('unsupported fake OMP command: ' + args.join(' '));
process.exit(2);
`, 'utf8');
  await chmod(omp, 0o755);

  return {
    root,
    home,
    agentDir,
    prefix,
    omp,
    mcpBefore,
    async snapshot() {
      const files = {};
      for (const relative of ['mcp.json', 'config.yml', 'AGENTS.md', 'skills/shipping-harness/SKILL.md', 'shipping-harness-install.json']) {
        files[relative] = await readFile(path.join(agentDir, relative), 'utf8');
      }
      return files;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function createOldShippingPackage(root, version = '1.0.1') {
  const source = path.join(root, `old-shipping-${version}`);
  const bin = path.join(source, 'bin');
  const pack = path.join(root, 'old-pack');
  await mkdir(bin, { recursive: true });
  await mkdir(pack, { recursive: true });
  await writeFile(path.join(source, 'package.json'), `${JSON.stringify({
    name: 'shipping-harness',
    version,
    private: true,
    type: 'module',
    bin: {
      'shipping-harness': './bin/shipping-harness.mjs',
      shiph: './bin/shipping-harness.mjs',
      'shipping-harness-mcp': './bin/shipping-harness-mcp.mjs',
    },
    files: ['bin/'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(bin, 'shipping-harness.mjs'), `#!/usr/bin/env node\nif (process.argv[2] === 'version') console.log('${version}'); else console.log('${version}');\n`, 'utf8');
  await writeFile(path.join(bin, 'shipping-harness-mcp.mjs'), '#!/usr/bin/env node\nprocess.stdin.resume();\n', 'utf8');
  await chmod(path.join(bin, 'shipping-harness.mjs'), 0o755);
  await chmod(path.join(bin, 'shipping-harness-mcp.mjs'), 0o755);
  const output = runCommand(defaultNpmCommand(), ['pack', '--json', '--pack-destination', pack], { cwd: source, timeoutMs: 120000 }).stdout;
  const filename = JSON.parse(output)[0].filename;
  return path.join(pack, filename);
}

export function installPackage(prefix, archive) {
  runCommand(defaultNpmCommand(), [
    'install', '--offline', '--global', '--prefix', prefix, archive,
    '--ignore-scripts', '--no-audit', '--no-fund',
  ], { timeoutMs: 180000 });
}
