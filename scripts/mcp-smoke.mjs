import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(projectRoot, 'bin', 'shipping-harness-mcp.mjs');
const child = spawn(process.execPath, [binary, '--root', projectRoot], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'shipping-harness-smoke', version: '0.3.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
const requests = [
  { jsonrpc: '2.0', id: 'discover', method: 'server/discover', params: { _meta: meta } },
  { jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: { _meta: meta } },
  { jsonrpc: '2.0', id: 'status', method: 'tools/call', params: { _meta: meta, name: 'shipping_status', arguments: {} } },
];
for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
child.stdin.end();

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const exitCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('MCP smoke client timed out'));
  }, 15000);
  child.on('error', reject);
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve(code ?? 1);
  });
});
if (exitCode !== 0) throw new Error(`MCP server exited ${exitCode}: ${stderr}`);
const lines = stdout.split(/\r?\n/u).filter(Boolean);
if (lines.length !== requests.length) throw new Error(`Expected ${requests.length} protocol lines, received ${lines.length}: ${stdout}`);
const responses = lines.map((line) => JSON.parse(line));
const discover = responses.find((response) => response.id === 'discover');
const tools = responses.find((response) => response.id === 'tools');
const status = responses.find((response) => response.id === 'status');
if (!discover?.result?.supportedVersions?.includes('2026-07-28')) throw new Error('Discovery response is missing the latest protocol version');
if (!Array.isArray(tools?.result?.tools) || tools.result.tools.length < 8) throw new Error('Tool list is incomplete');
if (status?.result?.isError) throw new Error(`Read-only status call failed: ${JSON.stringify(status.result)}`);
process.stdout.write(`mcp smoke: discovery, ${tools.result.tools.length} tools, and status passed\n`);