export function stableInvariant(condition, code, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

// Backward-compatible name used by the first v1 implementation batch.
export const invariant = stableInvariant;
