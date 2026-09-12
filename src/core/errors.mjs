export class ShippingError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   * @param {number} [exitCode]
   */
  constructor(code, message, details = {}, exitCode = 1) {
    super(message);
    this.name = 'ShippingError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

/**
 * @param {unknown} condition
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {asserts condition}
 */
export function invariant(condition, code, message, details = {}) {
  if (!condition) {
    throw new ShippingError(code, message, details);
  }
}

/** @param {unknown} error */
export function normalizeError(error) {
  if (error instanceof ShippingError) return error;
  if (error instanceof Error) {
    return new ShippingError('ERR_UNEXPECTED', error.message, {
      name: error.name,
      stack: error.stack,
    });
  }
  return new ShippingError('ERR_UNEXPECTED', String(error));
}