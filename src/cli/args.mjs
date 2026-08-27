/**
 * Minimal deterministic argument parser.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const pair = token.slice(2).split('=', 2);
    const key = pair[0];
    if (pair.length === 2) {
      options[key] = pair[1];
      continue;
    }
    if (key.startsWith('no-')) {
      options[key.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positionals, options };
}

/** @param {Record<string, unknown>} options @param {string} key @param {string | null} [fallback] */
export function stringOption(options, key, fallback = null) {
  const value = options[key];
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (value === true) return '';
  return fallback;
}

/** @param {Record<string, unknown>} options @param {string} key @param {boolean} [fallback] */
export function booleanOption(options, key, fallback = false) {
  const value = options[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}