// Goal-named scope paths (v1.13.0 Phase C).
//
// The repository analyzer derives `scope.paths.include` from what already exists on disk.
// A goal that names a file in a directory the baseline does not have yet ("implement
// hello() in a new file src/index.mjs") therefore produced a scope the implementation
// immediately violated, and the first verify blocked on `Unapproved scope drift`.
//
// This module reads the goal sentence for path-like tokens and turns them into globs. The
// goal text is untrusted user input and is the one thing in the system that can WIDEN an
// approved scope, so every addition is bounded, refusable, and visible:
//
//   - absolute paths, `..`, `~`, anything matching `scope.paths.exclude`, and anything
//     under `.shipping/` or `.git/` are refused, never added;
//   - at most 8 tokens of at most 200 characters each are considered at all;
//   - every addition and every refusal is reported so the approval brief can show the
//     human exactly why the proposed scope grew.
//
// It is pure: no filesystem, no git, no clock.
import path from 'node:path';
import { matchesAnyGlob, normalizeRepositoryPath } from './glob.mjs';

/** Largest number of goal-named paths considered in one goal sentence. */
export const MAX_GOAL_PATHS = 8;

/** Largest goal-named path token considered. */
export const MAX_GOAL_PATH_LENGTH = 200;

const SOURCE_EXTENSION = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|json|jsonc|py|rb|rs|go|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|css|scss|less|html|htm|vue|svelte|md|mdx|rst|txt|yml|yaml|toml|ini|cfg|proto|graphql|gradle|tf)$/iu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>"'`]+$/u;
const LEADING_PUNCTUATION = /^[([{<"'`]+/u;

/**
 * Split the goal into whitespace-delimited tokens and strip the punctuation a sentence
 * wraps a path in. `src/index.mjs.` and `` `src/index.mjs` `` both yield `src/index.mjs`.
 * @param {string} goalText
 * @returns {string[]}
 */
function candidateTokens(goalText) {
  return goalText
    .split(/\s+/u)
    .map((token) => token.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, ''))
    .filter(Boolean);
}

/** @param {string} token */
function looksLikePath(token) {
  return token.includes('/') || SOURCE_EXTENSION.test(token);
}

/**
 * Why a path-like token can never become scope, independent of any repository state.
 * @param {string} token
 * @returns {string | null}
 */
function syntacticRefusal(token) {
  if (token.includes('\0')) return 'null-byte';
  if (token.length > MAX_GOAL_PATH_LENGTH) return 'over-length';
  if (token.startsWith('~')) return 'home-directory-path';
  if (path.isAbsolute(token) || /^[A-Za-z]:[\\/]/u.test(token) || token.startsWith('\\\\')) return 'absolute-path';
  const segments = token.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) return 'parent-traversal';
  return null;
}

/**
 * Path-like tokens named by a goal sentence, with the ones that can never be scope
 * separated out so the refusal is reportable rather than silent.
 * @param {string} goalText
 * @returns {{accepted: string[], refused: Array<{token: string, reason: string}>}}
 */
export function extractGoalPaths(goalText) {
  if (typeof goalText !== 'string' || !goalText.trim()) return { accepted: [], refused: [] };
  const accepted = [];
  const refused = [];
  const seen = new Set();
  for (const token of candidateTokens(goalText)) {
    if (!looksLikePath(token)) continue;
    const key = token.slice(0, MAX_GOAL_PATH_LENGTH + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = syntacticRefusal(token);
    if (reason) {
      if (refused.length < MAX_GOAL_PATHS) refused.push({ token: key, reason });
      continue;
    }
    accepted.push(token.replaceAll('\\', '/').replace(/^\.\//u, ''));
    if (accepted.length >= MAX_GOAL_PATHS) break;
  }
  return { accepted, refused };
}

/**
 * The glob one goal-named path contributes. A file directly at the repository root
 * contributes only itself, so naming `package.json` never widens scope to `**`.
 * @param {string} token
 * @returns {string}
 */
function globForToken(token) {
  const trimmed = token.replace(/\/+$/u, '');
  if (token.endsWith('/')) return `${trimmed}/**`;
  const parent = path.posix.dirname(trimmed);
  return parent === '.' || parent === '' ? trimmed : `${parent}/**`;
}

/** @param {string} token @param {{include: string[], exclude: string[]}} scopePaths */
function policyRefusal(token, scopePaths) {
  if (token === '.shipping' || token.startsWith('.shipping/')) return 'shipping-runtime';
  if (token === '.git' || token.startsWith('.git/')) return 'repository-internals';
  const excludes = Array.isArray(scopePaths?.exclude) ? scopePaths.exclude : [];
  return matchesAnyGlob(token, excludes) ? 'excluded-path' : null;
}

/**
 * Turn the paths a goal sentence names into scope globs.
 *
 * `root` is only used to prove containment: every accepted token is already relative and
 * free of `..`, so resolving it against the root can never leave the repository, and a
 * token that somehow does is refused rather than added.
 * @param {string} goalText
 * @param {{include: string[], exclude: string[]}} scopePaths the scope built so far
 * @param {string | null} [root]
 * @returns {{added: Array<{glob: string, token: string}>, refused: Array<{token: string, reason: string}>}}
 */
export function scopePathsForGoal(goalText, scopePaths, root = null) {
  const extracted = extractGoalPaths(goalText);
  const added = [];
  const refused = [...extracted.refused];
  const include = Array.isArray(scopePaths?.include) ? scopePaths.include : [];
  const covered = new Set(include);
  for (const token of extracted.accepted) {
    /** @type {string} */
    let normalized;
    try {
      normalized = normalizeRepositoryPath(token);
    } catch {
      refused.push({ token, reason: 'invalid-repository-path' });
      continue;
    }
    const reason = policyRefusal(normalized, scopePaths);
    if (reason) {
      refused.push({ token: normalized, reason });
      continue;
    }
    if (root) {
      const base = path.resolve(root);
      const resolved = path.resolve(base, normalized);
      if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
        refused.push({ token: normalized, reason: 'outside-repository' });
        continue;
      }
    }
    const glob = globForToken(normalized);
    if (covered.has(glob) || matchesAnyGlob(normalized, include)) continue;
    covered.add(glob);
    added.push({ glob, token: normalized });
  }
  return { added, refused };
}

/**
 * The approval-brief diagnostics for one goal-derived scope decision. Every widening is
 * named with the goal token that caused it; every refusal says what was refused and why.
 * @param {{added: Array<{glob: string, token: string}>, refused: Array<{token: string, reason: string}>}} result
 * @returns {string[]}
 */
export function goalPathDiagnostics(result) {
  return [
    ...result.added.map((entry) => `GOAL_PATH_ADDED: ${entry.glob} (goal named "${entry.token}")`),
    ...result.refused.map((entry) => `GOAL_PATH_REFUSED: ${entry.token} (${entry.reason})`),
  ];
}
