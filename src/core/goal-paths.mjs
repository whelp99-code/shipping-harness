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
//   - a token must carry real path evidence (a file extension, or a trailing slash), so a
//     branch name, a URL, or a fraction is never read as a path;
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

// A filename ends in a short alphabetic extension. Enumerating extensions missed real
// files (coverage/lcov.info); requiring the extension to START with a letter keeps a
// version-shaped branch name (release/v1.2.3) from reading as one.
const FILENAME_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/u;
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

const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

/**
 * A slash alone does not make a path. Branch names (`codex/shared-memory-20260907`),
 * URLs, and fractions (`3/4`) all carry one, and reading them as paths silently widened
 * the approved scope. A token must carry real path evidence: a file extension on its last
 * segment, or an explicit trailing slash. Naming a directory that already exists needs no
 * goal token, because the analyzer already found it; the goal only has to speak for paths
 * the baseline does not have yet, and those are written as files or with a trailing slash.
 * @param {string} token
 */
function hasPathEvidence(token) {
  return token.endsWith('/') || FILENAME_EXTENSION.test(token);
}

/**
 * Whether a token is shaped enough like a path to be worth judging at all. A refusal is
 * only reportable for these; ordinary prose is skipped in silence.
 * @param {string} token
 */
function pathShaped(token) {
  if (URL_LIKE.test(token)) return false;
  return token.includes('/') || FILENAME_EXTENSION.test(token);
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
  // `.git` and `.shipping` are fixed names, not repository policy, so refusing them here
  // keeps the refusal reportable even for a token that carries no path evidence.
  if (segments[0] === '.git') return 'repository-internals';
  if (segments[0] === '.shipping') return 'shipping-runtime';
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
    if (!pathShaped(token)) continue;
    const key = token.slice(0, MAX_GOAL_PATH_LENGTH + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = syntacticRefusal(token);
    if (reason) {
      if (refused.length < MAX_GOAL_PATHS) refused.push({ token: key, reason });
      continue;
    }
    // A branch name or a fraction is path-shaped but carries no path evidence. It is
    // prose, so it is skipped rather than reported: nothing was asked for and refused.
    if (!hasPathEvidence(token)) continue;
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
    // v1.13.15: the consequence, not only the reason. A refused token is simply absent
    // from scope.paths.include, so changing files there later reads as scope drift with
    // nothing connecting it back to the goal sentence that asked for them.
    ...result.refused.map((entry) => `GOAL_PATH_REFUSED: ${entry.token} (${entry.reason}) -- not added to scope.paths.include, so changes there would count as scope drift.`),
  ];
}
