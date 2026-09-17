// What a goal claims, measured against what the contract can prove.
//
// A goal that enumerates several outcomes often names work no repository command can
// reach: an external database, a home-directory configuration, a third-party collector.
// The harness locks only what it can prove, so the extra outcomes are silently absent
// from the gate and the release closes without evidence for them. That is correct
// behaviour and the wrong silence: an approver cannot see what is not being proven.
//
// This module makes the shape visible without judging it. It counts what the goal
// enumerates and what the goal points at outside the repository, states both as facts,
// and never blocks. Deciding whether the gap matters stays with the person approving.
//
// It is pure: no filesystem, no git, no clock, no model.

/** Largest number of enumerated objectives counted in one goal. */
export const MAX_COUNTED_OBJECTIVES = 32;

/** Largest number of external references reported. */
export const MAX_EXTERNAL_REFERENCES = 6;

// `(a)` `a)` `1.` `2)` `-` `*` `•` at the start of a line or after a separator.
const ENUMERATION_MARKER = /(?:^|\n)\s*(?:\(?[a-z]\)|\(?\d{1,2}[.)]|[-*•])\s+\S/giu;
const URL_LIKE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/gu;
const HOME_PATH = /(?:^|\s)~\/\S+/gu;
const ABSOLUTE_PATH = /(?:^|\s)\/(?:etc|var|usr|opt|home|Users|Volumes)\/\S+/gu;
const HOST_PORT = /\b(?:[A-Za-z][A-Za-z0-9.-]*|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}\b/gu;

/**
 * How many outcomes the goal enumerates. Only explicit list markers count, so an ordinary
 * one-sentence goal reports zero and never triggers a warning.
 * @param {string} goalText
 * @returns {number}
 */
export function countEnumeratedObjectives(goalText) {
  if (typeof goalText !== 'string' || !goalText.trim()) return 0;
  return Math.min(MAX_COUNTED_OBJECTIVES, [...goalText.matchAll(ENUMERATION_MARKER)].length);
}

/**
 * The things a goal names that lie outside the repository. Each one is somewhere no
 * repository-owned acceptance command can reach.
 * @param {string} goalText
 * @returns {string[]}
 */
export function externalReferences(goalText) {
  if (typeof goalText !== 'string' || !goalText.trim()) return [];
  const found = [];
  const seen = new Set();
  for (const pattern of [URL_LIKE, HOME_PATH, ABSOLUTE_PATH, HOST_PORT]) {
    for (const match of goalText.matchAll(pattern)) {
      const token = match[0].trim().replace(/[.,;:!?)\]}]+$/u, '');
      if (!token || seen.has(token)) continue;
      seen.add(token);
      found.push(token.slice(0, 120));
      if (found.length >= MAX_EXTERNAL_REFERENCES) return found;
    }
  }
  return found;
}

/**
 * Facts an approver needs before deciding, never a block.
 * @param {{goalText: string, requiredAcceptanceCount: number}} input
 * @returns {string[]}
 */
export function unprovenObjectiveDiagnostics(input) {
  const goalText = input?.goalText ?? '';
  const proven = Number.isInteger(input?.requiredAcceptanceCount) ? input.requiredAcceptanceCount : 0;
  const diagnostics = [];
  const enumerated = countEnumeratedObjectives(goalText);
  // One enumerated outcome is an ordinary goal, not a list the gate is failing to cover.
  if (enumerated >= 2 && enumerated > proven) {
    diagnostics.push(`UNPROVEN_OBJECTIVES: the goal enumerates ${enumerated} outcomes and the contract locks ${proven} required acceptance check(s). The harness cannot tell which outcomes those checks prove, so any outcome without one closes on review alone.`);
  }
  const external = externalReferences(goalText);
  if (external.length > 0) {
    diagnostics.push(`EXTERNAL_REFERENCE: the goal names ${external.join(', ')} outside this repository. No repository-owned acceptance command can prove work there.`);
  }
  return diagnostics;
}
