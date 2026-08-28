import { ShippingError, normalizeError } from '../core/errors.mjs';
import { VERSION } from '../version.mjs';
import { SHIPPING_TOOLS, callShippingTool } from './tools.mjs';

export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MCP_LEGACY_VERSION = '2025-11-25';
export const MCP_SUPPORTED_VERSIONS = Object.freeze([MCP_PROTOCOL_VERSION, MCP_LEGACY_VERSION]);
export const MCP_SERVER_INFO = Object.freeze({ name: 'shipping-harness', version: VERSION });
export const MCP_MAX_MESSAGE_BYTES = 1024 * 1024;
export const MCP_MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
export const MCP_MAX_RESULT_BYTES = 1024 * 1024;
export const MCP_MAX_JSON_DEPTH = 24;

class McpProtocolError extends Error {
  /** @param {number} code @param {string} message @param {unknown} [data] */
  constructor(code, message, data) {
    super(message);
    this.name = 'McpProtocolError';
    this.code = code;
    this.data = data;
  }
}

/** @param {unknown} value @param {number} [depth] */
export function assertSafeJson(value, depth = 0) {
  if (depth > MCP_MAX_JSON_DEPTH) throw new McpProtocolError(-32602, `JSON nesting exceeds ${MCP_MAX_JSON_DEPTH}`);
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new McpProtocolError(-32602, 'JSON array exceeds 1000 items');
    for (const item of value) assertSafeJson(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 200) throw new McpProtocolError(-32602, 'JSON object exceeds 200 properties');
    for (const [, nested] of entries) assertSafeJson(nested, depth + 1);
  }
}

/** @param {unknown} id @param {unknown} result */
function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/** @param {unknown} id @param {number} code @param {string} message @param {unknown} [data] */
export function errorResponse(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** @param {string} protocolVersion */
function serverMeta(protocolVersion) {
  if (protocolVersion !== MCP_PROTOCOL_VERSION) return undefined;
  return { 'io.modelcontextprotocol/serverInfo': MCP_SERVER_INFO };
}

/** @param {Record<string, any>} result @param {string} protocolVersion */
function withServerMeta(result, protocolVersion) {
  const meta = serverMeta(protocolVersion);
  return meta ? { ...result, _meta: { ...(result._meta ?? {}), ...meta } } : result;
}

/** @param {Record<string, any>} params @param {Record<string, any>} state @param {string} method */
function requestProtocol(params, state, method) {
  if (method === 'server/discover') {
    const requested = params?._meta?.['io.modelcontextprotocol/protocolVersion'];
    if (requested !== undefined && requested !== MCP_PROTOCOL_VERSION) {
      throw new McpProtocolError(-32022, 'Unsupported protocol version', { supported: MCP_SUPPORTED_VERSIONS, requested });
    }
    return MCP_PROTOCOL_VERSION;
  }
  const meta = params?._meta;
  if (meta && typeof meta === 'object') {
    const requested = meta['io.modelcontextprotocol/protocolVersion'];
    if (!MCP_SUPPORTED_VERSIONS.includes(requested)) {
      throw new McpProtocolError(-32022, 'Unsupported protocol version', { supported: MCP_SUPPORTED_VERSIONS, requested: requested ?? 'missing' });
    }
    if (requested === MCP_PROTOCOL_VERSION) {
      if (!meta['io.modelcontextprotocol/clientCapabilities'] || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object') {
        throw new McpProtocolError(-32602, 'Latest MCP requests require io.modelcontextprotocol/clientCapabilities');
      }
    }
    return requested;
  }
  if (state.legacyInitialized) return MCP_LEGACY_VERSION;
  throw new McpProtocolError(-32022, 'Unsupported protocol version', { supported: MCP_SUPPORTED_VERSIONS, requested: 'missing' });
}

/** @param {unknown} message */
function validateMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new McpProtocolError(-32600, 'Invalid Request');
  const request = /** @type {Record<string, any>} */ (message);
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') throw new McpProtocolError(-32600, 'Invalid Request');
  if (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number') throw new McpProtocolError(-32600, 'Invalid Request ID');
  if (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) throw new McpProtocolError(-32602, 'params must be an object');
  return request;
}

/** @param {unknown} error */
function toolErrorResult(error, protocolVersion) {
  const normalized = normalizeError(error);
  return withServerMeta({
    ...(protocolVersion === MCP_PROTOCOL_VERSION ? { resultType: 'complete' } : {}),
    content: [{ type: 'text', text: `${normalized.message} [${normalized.code}]` }],
    structuredContent: { ok: false, error: { code: normalized.code, message: normalized.message } },
    isError: true,
  }, protocolVersion);
}

/**
 * Create a protocol handler with only compatibility state; latest MCP requests remain stateless.
 * @param {string} root
 */
export function createMcpProtocol(root) {
  const state = {
    legacyInitialized: false,
    cancelled: new Set(),
    toolChain: Promise.resolve(),
  };

  /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
  function serializeToolCall(operation) {
    const next = state.toolChain.then(operation, operation);
    state.toolChain = next.catch(() => undefined);
    return next;
  }

  return {
    state,
    /** @param {unknown} rawMessage */
    async handle(rawMessage) {
      let request;
      try {
        assertSafeJson(rawMessage);
        request = validateMessage(rawMessage);
      } catch (error) {
        const normalized = error instanceof McpProtocolError ? error : new McpProtocolError(-32600, 'Invalid Request');
        const id = rawMessage && typeof rawMessage === 'object' && !Array.isArray(rawMessage) ? rawMessage.id : null;
        return errorResponse(id, normalized.code, normalized.message, normalized.data);
      }

      const notification = request.id === undefined;
      if (notification) {
        if (request.method === 'notifications/initialized') state.legacyInitialized = true;
        if (request.method === 'notifications/cancelled') {
          const requestId = request.params?.requestId;
          if (typeof requestId === 'string' || typeof requestId === 'number') state.cancelled.add(String(requestId));
        }
        return null;
      }

      try {
        if (request.method === 'initialize') {
          const requested = request.params?.protocolVersion;
          if (requested !== MCP_LEGACY_VERSION) {
            throw new McpProtocolError(-32022, 'Unsupported protocol version', { supported: [MCP_LEGACY_VERSION], requested: requested ?? 'missing' });
          }
          state.legacyInitialized = true;
          return success(request.id, {
            protocolVersion: MCP_LEGACY_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: MCP_SERVER_INFO,
            instructions: 'Use shipping_start to propose a small release. Never approve scope without explicit user review and confirmation.',
          });
        }

        const params = request.params ?? {};
        const protocolVersion = requestProtocol(params, state, request.method);

        if (request.method === 'server/discover') {
          return success(request.id, withServerMeta({
            resultType: 'complete',
            supportedVersions: MCP_SUPPORTED_VERSIONS,
            capabilities: { tools: { listChanged: false } },
            instructions: 'Start with shipping_start, show the proposal to the user, require explicit approval, then implement only the locked scope and verify before closing.',
            ttlMs: 300000,
            cacheScope: 'public',
          }, MCP_PROTOCOL_VERSION));
        }

        if (request.method === 'ping') {
          return success(request.id, withServerMeta(protocolVersion === MCP_PROTOCOL_VERSION ? { resultType: 'complete' } : {}, protocolVersion));
        }

        if (request.method === 'tools/list') {
          const result = protocolVersion === MCP_PROTOCOL_VERSION
            ? { resultType: 'complete', tools: SHIPPING_TOOLS, ttlMs: 300000, cacheScope: 'private' }
            : { tools: SHIPPING_TOOLS };
          return success(request.id, withServerMeta(result, protocolVersion));
        }

        if (request.method === 'tools/call') {
          const name = params.name;
          if (typeof name !== 'string' || !SHIPPING_TOOLS.some((tool) => tool.name === name)) {
            throw new McpProtocolError(-32602, `Unknown tool: ${String(name)}`);
          }
          const argumentsValue = params.arguments ?? {};
          if (Buffer.byteLength(JSON.stringify(argumentsValue), 'utf8') > MCP_MAX_TOOL_ARGUMENT_BYTES) {
            throw new McpProtocolError(-32602, `Tool arguments exceed ${MCP_MAX_TOOL_ARGUMENT_BYTES} bytes`);
          }
          assertSafeJson(argumentsValue);
          try {
            const toolResult = await serializeToolCall(async () => {
              if (state.cancelled.has(String(request.id))) throw new ShippingError('ERR_MCP_CANCELLED', 'Tool call was cancelled before execution');
              return callShippingTool(root, name, argumentsValue);
            });
            if (Buffer.byteLength(JSON.stringify(toolResult), 'utf8') > MCP_MAX_RESULT_BYTES) {
              throw new ShippingError('ERR_MCP_RESULT_TOO_LARGE', `Tool result exceeds ${MCP_MAX_RESULT_BYTES} bytes`);
            }
            return success(request.id, withServerMeta(protocolVersion === MCP_PROTOCOL_VERSION
              ? toolResult
              : Object.fromEntries(Object.entries(toolResult).filter(([key]) => key !== 'resultType')),
            protocolVersion));
          } catch (error) {
            if (error instanceof ShippingError && ['ERR_MCP_ARGUMENTS', 'ERR_MCP_TOOL_UNKNOWN'].includes(error.code)) {
              throw new McpProtocolError(-32602, error.message);
            }
            return success(request.id, toolErrorResult(error, protocolVersion));
          }
        }

        throw new McpProtocolError(-32601, `Method not found: ${request.method}`);
      } catch (error) {
        const normalized = error instanceof McpProtocolError
          ? error
          : new McpProtocolError(-32603, 'Internal error');
        return errorResponse(request.id, normalized.code, normalized.message, normalized.data);
      }
    },
  };
}

/** @param {string} line */
export function parseMcpLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new McpProtocolError(-32700, 'Parse error: Invalid JSON');
  }
}