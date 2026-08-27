import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeState, pause, readState, resume, transitionState } from '../../src/core/state.mjs';
import { normalizeIssue, countIssues } from '../../src/core/issues.mjs';

test('state machine rejects invalid transitions and preserves human pause authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-state-test-'));
  try {
    await initializeState(root);
    await assert.rejects(() => transitionState(root, 'CLOSED', {}, 'invalid'), /Invalid transition/u);
    await transitionState(root, 'LOCKED', {}, 'valid');
    const paused = await pause(root, 'human requested pause');
    assert.equal(paused.state, 'PAUSED');
    assert.equal(paused.humanStop, true);
    const resumed = await resume(root, 'human resumed');
    assert.equal(resumed.state, 'LOCKED');
    assert.equal(resumed.humanStop, false);
    assert.equal((await readState(root)).state, 'LOCKED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsupported blocker is downgraded to UNKNOWN', () => {
  const issue = normalizeIssue({
    title: 'Reviewer preference',
    classification: 'BLOCKER',
    description: 'No acceptance or policy basis supplied.',
  });
  assert.equal(issue.classification, 'UNKNOWN');
  assert.equal(issue.requestedClassification, 'BLOCKER');
  assert.match(issue.diagnostics[0], /downgraded/u);
  assert.deepEqual(countIssues([issue]), { BLOCKER: 0, NEXT: 0, IGNORE: 0, UNKNOWN: 1 });
});