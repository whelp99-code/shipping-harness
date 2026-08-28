import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { walkFiles, relative } from './shared.mjs';
import { assertContainedPath } from '../src/core/fs.mjs';
import { validateArtifactCandidate } from '../src/adapters/artifacts.mjs';
import { sanitizeHookPayload } from '../src/core/hooks.mjs';
import { SHIPPING_TOOLS } from '../src/mcp/tools.mjs';
import {
  signRemoteRequest,
  validateRemoteConfig,
  validateRemoteRequest,
} from '../packages/internal-remote/index.mjs';
import { validateListen } from '../packages/internal-remote/policy.mjs';

const failures = [];
const sourceFiles = [
  ...await walkFiles(path.resolve('src'), (file) => file.endsWith('.mjs')),
  ...await walkFiles(path.resolve('packages', 'internal-remote'), (file) => file.endsWith('.mjs')),
];
const forbidden = [
  { name: 'eval', pattern: /\beval\s*\(/gu },
  { name: 'Function constructor', pattern: /\bnew\s+Function\s*\(/gu },
  { name: 'hardcoded OpenAI key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu },
  { name: 'hardcoded GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/gu },
  { name: 'home-directory inspection', pattern: /\b(?:homedir\s*\(|process\.env\.(?:HOME|USERPROFILE))/gu },
];
for (const filePath of sourceFiles) {
  const content = await readFile(filePath, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) failures.push(`${relative(filePath)} contains forbidden ${rule.name}`);
    rule.pattern.lastIndex = 0;
  }
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (Object.keys(packageJson.dependencies ?? {}).length > 0) failures.push('runtime dependencies must remain empty for the current local-first release');
if (packageJson.bin?.['shipping-harness-mcp'] !== './bin/shipping-harness-mcp.mjs') failures.push('shipping-harness-mcp package binary is missing or incorrect');
if (packageJson.bin?.['shipping-harness-remote'] !== './bin/shipping-harness-remote.mjs') failures.push('shipping-harness-remote package binary is missing or incorrect');
const ignore = await readFile('.gitignore', 'utf8');
for (const entry of ['.shipping/evidence/', '.shipping/tmp/', '.chatgpt2codex/']) {
  if (!ignore.split(/\r?\n/u).includes(entry)) failures.push(`.gitignore missing ${entry}`);
}

const forbiddenToolProperties = new Set(['command', 'shell', 'args', 'argv', 'env', 'environment']);
for (const tool of SHIPPING_TOOLS) {
  if (tool.inputSchema?.additionalProperties !== false) failures.push(`${tool.name} must reject additional properties`);
  for (const property of Object.keys(tool.inputSchema?.properties ?? {})) {
    if (forbiddenToolProperties.has(property)) failures.push(`${tool.name} exposes forbidden arbitrary execution property: ${property}`);
  }
}
const mcpFiles = await walkFiles(path.resolve('src/mcp'), (file) => file.endsWith('.mjs'));
for (const filePath of mcpFiles) {
  const content = await readFile(filePath, 'utf8');
  if (/from\s+['"]node:(?:http|https|http2|net|tls)['"]/gu.test(content)) failures.push(`${relative(filePath)} opens a network-capable runtime in the local MCP surface`);
}

for (const candidate of ['~/.omo/state.json', '/tmp/ledger.jsonl', '../ledger.jsonl', '.shipping/state.json', '.env']) {
  let rejected = false;
  try {
    validateArtifactCandidate(candidate);
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push(`unsafe artifact path was accepted: ${candidate}`);
}

const sanitizedPayload = sanitizeHookPayload({
  token: 'security-check-secret-token',
  nested: { message: 'api_key=[REDACTED]' },
});
const sanitizedText = JSON.stringify(sanitizedPayload);
if (sanitizedText.includes('security-check-secret-token') || sanitizedText.includes('abcdefghijklmnopqrstuvwxyz')) {
  failures.push('hook payload secret redaction failed');
}

const remoteExample = JSON.parse(await readFile('config/internal-remote.example.json', 'utf8'));
if (remoteExample.schema !== 'shipping-remote/config-v1') failures.push('internal remote example schema is invalid');
if (!Array.isArray(remoteExample.allowedRoots) || remoteExample.allowedRoots.length === 0) failures.push('internal remote example has no explicit allowlist root');
if (Object.hasOwn(remoteExample, 'serverCredential')) failures.push('internal remote example contains an inline server credential');
if (!remoteExample.serverCredentialEnv) failures.push('internal remote example does not name a server credential environment variable');
for (const actor of remoteExample.actors ?? []) {
  if (Object.hasOwn(actor, 'credential')) failures.push(`internal remote example actor ${actor.id ?? 'unknown'} contains an inline credential`);
  if (!actor.credentialEnv) failures.push(`internal remote example actor ${actor.id ?? 'unknown'} has no credential environment variable`);
}

for (const publicHost of ['0.0.0.0', '::', '8.8.8.8', '1.1.1.1']) {
  let rejected = false;
  try { validateListen(publicHost); } catch { rejected = true; }
  if (!rejected) failures.push(`public remote listen host was accepted: ${publicHost}`);
}
for (const privateHost of ['127.0.0.1', '10.0.0.10', '192.168.1.10', '::1']) {
  try { validateListen(privateHost); } catch { failures.push(`private remote listen host was rejected: ${privateHost}`); }
}

const tempRoot = await mkdtemp(path.join(process.cwd(), '.security-check-'));
try {
  const outside = path.join(tempRoot, 'outside');
  const repo = path.join(tempRoot, 'repo');
  await mkdir(outside);
  await mkdir(repo);
  await writeFile(path.join(outside, 'secret'), 'not readable through repo link');
  await symlink(outside, path.join(repo, 'escape'));
  let rejected = false;
  try {
    await assertContainedPath(repo, path.join(repo, 'escape', 'secret'));
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push('symlink escape was not rejected');

  const actorCredential = `security-actor-${'a'.repeat(32)}`;
  const serverCredential = `security-server-${'b'.repeat(40)}`;
  const config = validateRemoteConfig({
    schema: 'shipping-remote/config-v1',
    allowedRoots: [tempRoot],
    serverCredential,
    actors: [{ id: 'owner', credential: actorCredential, permissions: ['read', 'write'], projects: ['repo'] }],
    projects: [{ id: 'repo', root: repo }],
  }, { allowInlineCredentials: true });
  const unsigned = {
    schema: 'shipping-remote/request-v1',
    requestId: 'security-request',
    actorId: 'owner',
    projectId: 'repo',
    action: 'shipping/status',
    params: {},
    timestamp: new Date().toISOString(),
    nonce: 'security-nonce',
  };
  try {
    validateRemoteRequest(signRemoteRequest(unsigned, actorCredential), config);
  } catch (error) {
    failures.push(`valid signed internal remote request was rejected: ${error.message}`);
  }
  const injected = { ...unsigned, requestId: 'injected', nonce: 'injected', params: { nested: { command: 'sh' } } };
  let injectionRejected = false;
  try {
    validateRemoteRequest(signRemoteRequest(injected, actorCredential), config);
  } catch {
    injectionRejected = true;
  }
  if (!injectionRejected) failures.push('nested remote command injection was accepted');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`security: ${sourceFiles.length} source files scanned; local MCP and internal remote command/network/secret/replay/path boundaries verified\n`);
}
