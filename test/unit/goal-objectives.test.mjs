// v1.13.3: a goal that claims more than the contract can prove says so out loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countEnumeratedObjectives,
  externalReferences,
  unprovenObjectiveDiagnostics,
} from '../../src/core/goal-objectives.mjs';

test('an ordinary one-sentence goal enumerates nothing and warns about nothing', () => {
  const goal = 'Implement hello() in src/index.mjs so the existing test suite passes';
  assert.equal(countEnumeratedObjectives(goal), 0);
  assert.deepEqual(unprovenObjectiveDiagnostics({ goalText: goal, requiredAcceptanceCount: 2 }), []);
});

test('a goal listing more outcomes than the contract proves reports the gap', () => {
  const goal = [
    'Finish the remaining scope:',
    '(a) ship the resume point',
    '(b) demonstrate isolated vault collection',
    '(c) read the provider configuration',
    '(d) wire the collectors',
  ].join('\n');
  assert.equal(countEnumeratedObjectives(goal), 4);
  const [first] = unprovenObjectiveDiagnostics({ goalText: goal, requiredAcceptanceCount: 2 });
  assert.match(first, /^UNPROVEN_OBJECTIVES: the goal enumerates 4 outcomes and the contract locks 2 required/u);
});

test('a single enumerated outcome is an ordinary goal, not an uncovered list', () => {
  assert.deepEqual(unprovenObjectiveDiagnostics({ goalText: '- do the one thing', requiredAcceptanceCount: 0 }), []);
});

test('an outcome count matched by acceptance reports no gap', () => {
  const goal = '1. lint the sources\n2. run the tests';
  assert.equal(countEnumeratedObjectives(goal), 2);
  assert.deepEqual(unprovenObjectiveDiagnostics({ goalText: goal, requiredAcceptanceCount: 2 }), []);
});

test('references outside the repository are named, because no repository command reaches them', () => {
  const goal = 'Collect from postgres at 100.109.217.124:5433 using ~/.config/agent/provider.toml and https://api.example.invalid/v1';
  const found = externalReferences(goal);
  assert.ok(found.includes('https://api.example.invalid/v1'), `urls reported: ${found}`);
  assert.ok(found.includes('~/.config/agent/provider.toml'), `home paths reported: ${found}`);
  assert.ok(found.includes('100.109.217.124:5433'), `host:port reported: ${found}`);
  const diagnostics = unprovenObjectiveDiagnostics({ goalText: goal, requiredAcceptanceCount: 5 });
  assert.equal(diagnostics.length, 1, 'only the external-reference fact fires here');
  assert.match(diagnostics[0], /^EXTERNAL_REFERENCE: /u);
});

test('a goal that stays inside the repository names no external reference', () => {
  assert.deepEqual(externalReferences('Update docs/spec.md and src/core/gate.mjs'), []);
});

// v1.13.4: reported from a live session. A goal listing its outcomes inside one sentence
// counted as zero, so the gap went unreported exactly where it was easiest to miss.
test('outcomes listed inside one sentence are counted like outcomes on their own lines', () => {
  assert.equal(countEnumeratedObjectives('Finish (a) the resume point, (b) the collection demo, and (c) the collectors'), 3);
  const [first] = unprovenObjectiveDiagnostics({
    goalText: 'Finish (a) the resume point, (b) the collection demo, and (c) the collectors',
    requiredAcceptanceCount: 2,
  });
  assert.match(first, /^UNPROVEN_OBJECTIVES: the goal enumerates 3 outcomes/u);
});

test('prose that merely uses a parenthesis is not a list', () => {
  assert.equal(countEnumeratedObjectives('Implement slugify(input) in src/index.mjs so the suite passes'), 0);
});
