import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { OMP_MCP_PROTOCOL, SHIPPING_TOOL_NAMES } from './constants.mjs';
import { invariant } from './io.mjs';

/**
 * McpLineClient.
 */
export class McpLineClient {
  /** @param {{command: string, args?: string[], cwd: string, env?: Record<string, string>, timeoutMs?: number}} input */
  constructor(input) {
    this.timeoutMs = input.timeoutMs ?? 30000;
    this.child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pending = new Map();
    this.stderr = '';
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        return;
      }
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      pending.resolve(message);
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); });
    this.child.on('exit', (code) => {
      if (code === 0) return;
      for (const pending of this.pending.values()) pending.reject(new Error(`MCP exited ${code}: ${this.stderr.slice(-4000)}`));
      this.pending.clear();
    });
  }

  /** @param {Record<string, any>} message */
  request(message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(message.id));
        reject(new Error(`MCP request timed out: ${message.method}`));
      }, this.timeoutMs);
      this.pending.set(String(message.id), {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  /** @param {Record<string, any>} message */
  notify(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close() {
    this.child.stdin.end();
    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGTERM');
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    }));
  }
}

/** @param {number} id @param {string} name @param {Record<string, any>} [args] */
export function ompToolCall(id, name, args = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

/**
 * Exercise the exact legacy MCP lane used by OMP without invoking a model.
 * @param {{mcpCommand: string, projectRoot: string, ompVersion: string, timeoutMs?: number}} input
 */
export async function runOmpMcpSmoke(input) {
  const client = new McpLineClient({
    command: input.mcpCommand,
    args: ['--root', input.projectRoot],
    cwd: input.projectRoot,
    timeoutMs: input.timeoutMs,
  });
  try {
    const initialized = await client.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: OMP_MCP_PROTOCOL,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'omp-coding-agent', version: input.ompVersion },
      },
    });
    invariant(!initialized.error, 'ERR_OMP_MCP_INITIALIZE', 'Shipping MCP rejected OMP initialize', initialized.error);
    invariant(initialized.result?.protocolVersion === OMP_MCP_PROTOCOL, 'ERR_OMP_MCP_PROTOCOL', 'Shipping MCP negotiated an unexpected protocol version');
    client.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const listed = await client.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    invariant(!listed.error, 'ERR_OMP_MCP_TOOLS', 'Shipping MCP tools/list failed', listed.error);
    const names = (listed.result?.tools ?? []).map((entry) => entry.name);
    invariant(names.length === SHIPPING_TOOL_NAMES.length, 'ERR_OMP_MCP_TOOLS', `Expected ${SHIPPING_TOOL_NAMES.length} Shipping tools, observed ${names.length}`, { names });
    invariant(SHIPPING_TOOL_NAMES.every((name) => names.includes(name)), 'ERR_OMP_MCP_TOOLS', 'Shipping MCP tool inventory is incomplete', { names });

    const status = await client.request(ompToolCall(3, 'shipping_status'));
    invariant(!status.error && status.result?.isError !== true, 'ERR_OMP_MCP_STATUS', 'Shipping MCP status call failed', status.error ?? status.result);
    return {
      protocol: initialized.result.protocolVersion,
      tools: names.length,
      toolNames: names,
      status: status.result?.structuredContent?.state ?? null,
      connected: true,
    };
  } finally {
    await client.close();
  }
}
