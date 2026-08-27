import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { walkFiles, relative } from './shared.mjs';
import { assertContainedPath } from '../src/core/fs.mjs';
import { validateArtifactCandidate } from '../src/adapters/artifacts.mjs';
import { sanitizeHookPayload } from '../src/core/hooks.mjs';
import { SHIPPING_TOOLS } from '../src/mcp/tools.mjs';

const failures = [];
const sourceFiles = await walkFiles(path.resolve('src'), (file) => file.endsWith('.mjs'));
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
if (Object.keys(packageJson.dependencies ?? {}).length > 0) failures.push('runtime dependencies must remain empty for v0.3.0');
if (packageJson.bin?.['shipping-harness-mcp'] !== './bin/shipping-harness-mcp.mjs') failures.push('shipping-harness-mcp package binary is missing or incorrect');
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
  if (/from\s+['"]node:(?:http|https|http2|net|tls)['"]/gu.test(content)) failures.push(`${relative(filePath)} opens a network-capable runtime in local-only v0.3.0`);
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
  nested: { message: 'api_key=abcdefghijklmnopqrstuvwxyz' },
});
const sanitizedText = JSON.stringify(sanitizedPayload);
if (sanitizedText.includes('security-check-secret-token') || sanitizedText.includes('abcdefghijklmnopqrstuvwxyz')) {
  failures.push('hook payload secret redaction failed');
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
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`security: ${sourceFiles.length} files scanned; MCP command/network exposure and artifact/home/secret/path escapes rejected\n`);
}