// v1.13.15: a reporting session pointed out that ERR_PLAN_HISTORY_LOST is the most useful
// error this product emits, because it says what changed, what was expected, what was
// observed, and where the evidence is. The diagnostics next to it name the defect and
// stop. Reading "stages[2].size must be PATCH or MILESTONE" gives no reason to suspect
// that the whole file was rejected and the proposal in front of you is no longer
// plan-derived. Naming a defect without naming what it costs leaves the reader to find
// that out by being surprised later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goalPathDiagnostics } from '../../src/core/goal-paths.mjs';
import { compilePlanTiers } from '../../src/core/plan-proposal.mjs';

test('an invalid plan file says the scope is no longer plan-derived, not only which field is wrong', async () => {
  const compiled = await compilePlanTiers({
    binding: null,
    planError: { code: 'ERR_PLAN_INVALID', message: 'plan.stages[2].size must be PATCH or MILESTONE' },
    analysis: {},
    goal: 'Deliver one useful local workflow.',
    progressFor: async () => ({}),
  });
  const diagnostic = compiled.diagnostics.find((entry) => entry.startsWith('PLAN_FILE_INVALID'));
  assert.ok(diagnostic);
  assert.match(diagnostic, /plan\.stages\[2\]\.size must be PATCH or MILESTONE/u, 'the offending field is still named');
  assert.match(diagnostic, /rejects the whole plan file/u, 'one bad stage costs the whole file');
  assert.match(diagnostic, /derived template, not from the plan/u, 'and the reader learns where the scope came from instead');
  assert.equal(compiled.tier, 'PATCH');
});

test('a refused goal path says it is absent from the allowlist, not only why it was refused', () => {
  const [diagnostic] = goalPathDiagnostics({
    added: [],
    refused: [{ token: 'docs/../../secrets', reason: 'outside-repository' }],
  });
  assert.match(diagnostic, /docs\/\.\.\/\.\.\/secrets/u);
  assert.match(diagnostic, /outside-repository/u, 'the reason survives');
  assert.match(diagnostic, /not added to scope\.paths\.include/u, 'and so does what follows from it');
  assert.match(diagnostic, /scope drift/u);
});

test('an added goal path still names the token that widened the scope', () => {
  const [diagnostic] = goalPathDiagnostics({ added: [{ glob: 'src/**', token: 'src' }], refused: [] });
  assert.match(diagnostic, /GOAL_PATH_ADDED: src\/\*\* \(goal named "src"\)/u, 'a widening was already self-explaining and is unchanged');
});
