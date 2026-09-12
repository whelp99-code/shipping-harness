// Common MCP tool-call preprocessing: argument shape validation and response
// envelope construction. Every handler in handlers.mjs goes through these so
// argument validation and error normalization stay in one place.
import { invariant } from '../core/errors.mjs';

/** @param {unknown} value @returns {Record<string, any>} */
export function objectArguments(value) {
  invariant(value === undefined || (value && typeof value === 'object' && !Array.isArray(value)), 'ERR_MCP_ARGUMENTS', 'Tool arguments must be an object');
  return /** @type {Record<string, any>} */ (value ?? {});
}

/** @param {Record<string, any>} args @param {string[]} allowed */
export function rejectUnknownKeys(args, allowed) {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  invariant(unknown.length === 0, 'ERR_MCP_ARGUMENTS', `Unknown tool argument(s): ${unknown.join(', ')}`, { unknown });
}

/** @param {unknown} value @param {string} label @param {number} min @param {number} max @returns {string} */
export function requiredString(value, label, min, max) {
  invariant(typeof value === 'string' && value.trim().length >= min && value.length <= max, 'ERR_MCP_ARGUMENTS', `${label} must be a string between ${min} and ${max} characters`);
  return value.trim();
}

/** @param {Record<string, any>} data @param {string} text @returns {Record<string, any>} */
export function complete(data, text) {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text }],
    structuredContent: data,
    isError: false,
  };
}
