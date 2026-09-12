import { invariant } from './errors.mjs';

/** @param {string} value */
export function normalizeRepositoryPath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
  invariant(!normalized.startsWith('/') && !normalized.split('/').includes('..'), 'ERR_PATH_OUTSIDE_REPO', `Invalid repository-relative path: ${value}`);
  return normalized;
}

/** @param {string} pattern */
export function globToRegExp(pattern) {
  const normalized = normalizeRepositoryPath(pattern);
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === '*' && next === '*') {
      const after = normalized[index + 2];
      if (after === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(character)) expression += `\\${character}`;
    else expression += character;
  }
  expression += '$';
  return new RegExp(expression, 'u');
}

/** @param {string} value @param {string} pattern */
export function matchesGlob(value, pattern) {
  return globToRegExp(pattern).test(normalizeRepositoryPath(value));
}

/** @param {string} value @param {readonly string[]} patterns */
export function matchesAnyGlob(value, patterns) {
  return patterns.some((pattern) => matchesGlob(value, pattern));
}

const RUNTIME_IGNORES = Object.freeze([
  '.shipping/**',
  '.finisher/evidence/**',
  '.git/**',
]);

/**
 * @param {string[]} changedPaths
 * @param {{include: string[], exclude: string[]}} policy
 */
export function analyzeScope(changedPaths, policy) {
  const allowed = [];
  const ignored = [];
  const violations = [];
  for (const rawPath of changedPaths) {
    const filePath = normalizeRepositoryPath(rawPath);
    if (matchesAnyGlob(filePath, RUNTIME_IGNORES)) {
      ignored.push({ path: filePath, reason: 'shipping-runtime' });
      continue;
    }
    if (matchesAnyGlob(filePath, policy.exclude)) {
      violations.push({ path: filePath, reason: 'denied-pattern' });
      continue;
    }
    if (policy.include.length > 0 && !matchesAnyGlob(filePath, policy.include)) {
      violations.push({ path: filePath, reason: 'outside-include' });
      continue;
    }
    allowed.push(filePath);
  }
  return { allowed, ignored, violations };
}