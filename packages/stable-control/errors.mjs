/**
 * @param {unknown} condition
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {asserts condition}
 */
export function stableInvariant(condition, code, message, details) {
  if (condition) return;
  const error = /** @type {Error & {code?: string, details?: unknown}} */ (new Error(message));
  error.code = code;
  error.details = details;
  throw error;
}

// Backward-compatible name used by the first v1 implementation batch.
export const invariant = stableInvariant;
