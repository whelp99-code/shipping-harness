import { createMcpProtocol, errorResponse, MCP_MAX_MESSAGE_BYTES, parseMcpLine } from './protocol.mjs';

/**
 * Run the newline-delimited JSON-RPC STDIO binding.
 * @param {{root: string, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, error?: NodeJS.WritableStream, maxInFlight?: number, maxQueued?: number}} options
 */
export function startStdioServer(options) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const maxInFlight = options.maxInFlight ?? 4;
  const maxQueued = options.maxQueued ?? 64;
  const protocol = createMcpProtocol(options.root);
  let buffer = Buffer.alloc(0);
  let discardingOversizedLine = false;
  const queue = [];
  const inFlight = new Set();

  /** @param {Record<string, any>} message */
  function writeMessage(message) {
    output.write(`${JSON.stringify(message)}\n`);
  }

  /** @param {string} line */
  function enqueue(line) {
    if (queue.length >= maxQueued) {
      let id = null;
      try { id = parseMcpLine(line)?.id ?? null; } catch { /* The overload response remains uncorrelated. */ }
      writeMessage(errorResponse(id, -32000, 'Server busy: request queue limit reached'));
      return;
    }
    queue.push(line);
    drain();
  }

  function drain() {
    while (inFlight.size < maxInFlight && queue.length > 0) {
      const line = queue.shift();
      const task = processLine(line)
        .catch((unexpected) => {
          error.write(`shipping-harness-mcp: ${unexpected instanceof Error ? unexpected.message : String(unexpected)}\n`);
        })
        .finally(() => {
          inFlight.delete(task);
          drain();
        });
      inFlight.add(task);
    }
  }

  /** @param {string} line */
  async function processLine(line) {
    let message;
    try {
      message = parseMcpLine(line);
    } catch (parseError) {
      writeMessage(errorResponse(null, -32700, parseError instanceof Error ? parseError.message : 'Parse error: Invalid JSON'));
      return;
    }
    const response = await protocol.handle(message);
    if (!response) return;
    if (message.id !== undefined && protocol.state.cancelled.has(String(message.id))) return;
    writeMessage(response);
  }

  input.on('data', (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (discardingOversizedLine) {
      const newline = bytes.indexOf(0x0a);
      if (newline === -1) return;
      discardingOversizedLine = false;
      buffer = bytes.subarray(newline + 1);
    } else {
      buffer = Buffer.concat([buffer, bytes]);
    }

    while (true) {
      const newline = buffer.indexOf(0x0a);
      if (newline === -1) break;
      let line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, -1);
      if (line.length === 0) continue;
      if (line.length > MCP_MAX_MESSAGE_BYTES) {
        writeMessage(errorResponse(null, -32700, `Message exceeds ${MCP_MAX_MESSAGE_BYTES} bytes`));
        continue;
      }
      enqueue(line.toString('utf8'));
    }

    if (buffer.length > MCP_MAX_MESSAGE_BYTES) {
      buffer = Buffer.alloc(0);
      discardingOversizedLine = true;
      writeMessage(errorResponse(null, -32700, `Message exceeds ${MCP_MAX_MESSAGE_BYTES} bytes`));
    }
  });

  const completed = new Promise((resolve) => {
    input.on('end', () => {
      const wait = () => {
        if (queue.length === 0 && inFlight.size === 0) resolve();
        else setTimeout(wait, 5);
      };
      wait();
    });
  });
  input.on('error', (streamError) => error.write(`shipping-harness-mcp input: ${streamError.message}\n`));
  output.on('error', (streamError) => error.write(`shipping-harness-mcp output: ${streamError.message}\n`));
  return { completed, protocol };
}