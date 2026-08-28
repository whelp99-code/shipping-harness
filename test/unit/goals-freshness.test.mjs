import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGoalGraph } from '../../src/core/goals/compiler.mjs';
import { assertFreshTaskEvidence, createTaskEvidenceReceipt } from '../../src/core/goals/freshness.mjs';

const graph = compileGoalGraph({
  project: 'freshness-fixture',
  release: '0.5.0',
  goal: 'Require current evidence.',
  acceptance: [{ id: 'AC-001', description: 'Fresh proof exists.' }],
}, { contractHash: 'd'.repeat(64) });
const task = graph.tasks[0];
const currentSha = '1'.repeat(40);


test('Task evidence binds Task, consumer, release, contract, graph, and current Git SHA', () => {
  const receipt = createTaskEvidenceReceipt({
    graph,
    task,
    gitSha: currentSha,
    evidenceRef: 'evidence://AC-001/run-1',
    command: 'npm test',
    recordedAt: '2026-08-28T06:00:00.000Z',
  });
  assert.equal(assertFreshTaskEvidence(graph, task, receipt, currentSha), receipt);
  assert.throws(() => assertFreshTaskEvidence(graph, task, receipt, '2'.repeat(40)), /does not match current/u);

  const tampered = { ...receipt, evidenceRef: 'evidence://fabricated' };
  assert.throws(() => assertFreshTaskEvidence(graph, task, tampered, currentSha), /receipt hash is invalid/u);
});


test('agent DONE text or a passing label without a signed receipt is not completion evidence', () => {
  assert.throws(() => assertFreshTaskEvidence(graph, task, 'DONE', currentSha), /cannot become DONE without evidence/u);
  assert.throws(() => assertFreshTaskEvidence(graph, task, { status: 'PASS' }, currentSha), /Unsupported Task evidence schema/u);
});
