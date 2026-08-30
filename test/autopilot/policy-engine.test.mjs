import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autopilotPolicySummary,
  compileAutopilotPolicy,
  decideAutopilot,
  policiesEquivalent,
  validateAutopilotDecision,
  validateAutopilotPolicy,
} from '../../src/core/autopilot-policy.mjs';

function policy(profile = 'LOCAL_REVERSIBLE', overrides = {}) {
  return compileAutopilotPolicy({
    profile,
    proposalId: 'proposal-policy-test',
    proposalHash: 'a'.repeat(64),
    contractHash: 'b'.repeat(64),
    baselineSha: 'c'.repeat(40),
    releaseTrainHash: 'd'.repeat(64),
    approvedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  });
}

test('LOCAL_REVERSIBLE policy is deterministic, default-deny, and model-independent', () => {
  const first = policy();
  const second = policy('LOCAL_REVERSIBLE', { hostModel: 'ignored' });
  assert.deepEqual(first, second);
  assert.equal(first.profile, 'LOCAL_REVERSIBLE');
  assert.equal(first.enabled, true);
  assert.equal(first.defaultDecision, 'STOP');
  assert.equal(first.modelAuthority, false);
  assert.equal(first.permissions.IMPLEMENT, 'AUTO');
  assert.equal(first.permissions.CLOSE, 'NOTIFY');
  assert.equal(first.permissions.RELEASE, 'ASK');
  assert.equal(first.consequencePolicy.automaticReleased, false);
  assert.equal(policiesEquivalent(first, second), true);
  assert.equal(autopilotPolicySummary(first).automaticReleased, false);
  validateAutopilotPolicy(first);
});

test('MANUAL policy preserves ordinary human approval while allowing read and verify', () => {
  const manual = policy('MANUAL');
  assert.equal(manual.enabled, false);
  assert.equal(decideAutopilot(manual, { action: 'ANALYZE', effects: ['LOCAL_READ'] }).decision, 'AUTO');
  assert.equal(decideAutopilot(manual, { action: 'VERIFY', effects: ['LOCAL_READ'] }).decision, 'AUTO');
  const implement = decideAutopilot(manual, { action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true });
  assert.equal(implement.decision, 'ASK');
  assert.equal(implement.requiresHuman, true);
});

test('safe local implementation, verification, blocker repair, and proven close are policy-authorized', () => {
  const local = policy();
  for (const action of ['IMPLEMENT', 'FIX_BLOCKERS']) {
    const decision = decideAutopilot(local, { action, effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true, fixCycles: 0 });
    assert.equal(decision.decision, 'AUTO');
    assert.equal(decision.allowed, true);
    assert.equal(decision.released, false);
    validateAutopilotDecision(decision);
  }
  const verify = decideAutopilot(local, { action: 'VERIFY', effects: ['LOCAL_READ'] });
  assert.equal(verify.decision, 'AUTO');
  const close = decideAutopilot(local, {
    action: 'CLOSE',
    effects: ['LOCAL_REVERSIBLE'],
    rollbackAvailable: true,
    valueGateProven: true,
    acceptancePassed: true,
    evidenceFresh: true,
    blockerCount: 0,
    unknownCount: 0,
    scopeDrift: 0,
    releaseState: 'SHIPPABLE',
    exactScope: true,
    localOnly: true,
  });
  assert.equal(close.decision, 'NOTIFY');
  assert.equal(close.allowed, true);
  assert.equal(close.released, false);
});

test('close fails closed when any value, acceptance, evidence, rollback, blocker, unknown, scope, or state gate is missing', () => {
  const local = policy();
  const base = {
    action: 'CLOSE',
    effects: ['LOCAL_REVERSIBLE'],
    rollbackAvailable: true,
    valueGateProven: true,
    acceptancePassed: true,
    evidenceFresh: true,
    blockerCount: 0,
    unknownCount: 0,
    scopeDrift: 0,
    releaseState: 'SHIPPABLE',
    exactScope: true,
    localOnly: true,
  };
  for (const [field, value, code] of [
    ['rollbackAvailable', false, 'ROLLBACK_UNPROVEN'],
    ['valueGateProven', false, 'VALUE_GATE_UNPROVEN'],
    ['acceptancePassed', false, 'ACCEPTANCE_NOT_PASSED'],
    ['evidenceFresh', false, 'EVIDENCE_NOT_FRESH'],
    ['blockerCount', 1, 'BLOCKERS_REMAIN'],
    ['unknownCount', 1, 'UNKNOWNS_REMAIN'],
    ['scopeDrift', 1, 'SCOPE_DRIFT'],
    ['releaseState', 'RUNNING', 'NOT_SHIPPABLE'],
  ]) {
    const decision = decideAutopilot(local, { ...base, [field]: value });
    assert.equal(decision.decision, 'STOP', field);
    assert.ok(decision.reasons.includes(code), `${field}: ${decision.reasons.join(',')}`);
  }
});

test('external, data, auth, security, license, cost, customer, production, and public effects never auto-run', () => {
  const local = policy();
  for (const effect of ['DATA_STATE', 'AUTH', 'SECURITY_POLICY', 'LICENSE', 'COST', 'EXTERNAL_NETWORK_WRITE', 'CUSTOMER_COMMUNICATION', 'PRODUCTION', 'PUBLIC']) {
    const decision = decideAutopilot(local, { action: 'IMPLEMENT', effects: [effect], rollbackAvailable: true, exactScope: true, localOnly: effect !== 'EXTERNAL_NETWORK_WRITE' });
    assert.ok(['ASK', 'STOP'].includes(decision.decision), `${effect} was ${decision.decision}`);
    assert.equal(decision.allowed, false);
    assert.equal(decision.released, false);
  }
  const release = decideAutopilot(local, { action: 'RELEASE', effects: ['PUBLIC'], rollbackAvailable: true, exactScope: true, localOnly: false });
  assert.equal(release.decision, 'ASK');
  assert.equal(release.released, false);
});

test('hard-stop effects, missing rollback, inexact scope, human stop, stale policy, and fix exhaustion stop automation', () => {
  const local = policy();
  for (const request of [
    { action: 'IMPLEMENT', effects: ['UNKNOWN'], rollbackAvailable: true, exactScope: true, localOnly: true },
    { action: 'IMPLEMENT', effects: ['CORE_VALUE_REDUCTION'], rollbackAvailable: true, exactScope: true, localOnly: true },
    { action: 'IMPLEMENT', effects: ['ACCEPTANCE_WEAKENING'], rollbackAvailable: true, exactScope: true, localOnly: true },
    { action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: false, exactScope: true, localOnly: true },
    { action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: false, localOnly: true },
    { action: 'IMPLEMENT', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true, humanStop: true },
    { action: 'VERIFY', effects: ['LOCAL_READ'], policyBindingCurrent: false },
    { action: 'FIX_BLOCKERS', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true, fixCycles: 2, maxFixCycles: 2 },
  ]) {
    const decision = decideAutopilot(local, request);
    assert.equal(decision.decision, 'STOP', JSON.stringify(request));
    assert.equal(decision.stopsAutomation, true);
  }
});

test('advance requires predecessor CLOSED, committed closure, and fresh replan', () => {
  const local = policy();
  const allowed = decideAutopilot(local, {
    action: 'ADVANCE_RELEASE',
    effects: ['LOCAL_REVERSIBLE'],
    rollbackAvailable: true,
    exactScope: true,
    localOnly: true,
    predecessorClosed: true,
    cleanCommittedClosure: true,
    replanReady: true,
  });
  assert.equal(allowed.decision, 'NOTIFY');
  for (const field of ['predecessorClosed', 'cleanCommittedClosure', 'replanReady']) {
    const blocked = decideAutopilot(local, {
      action: 'ADVANCE_RELEASE', effects: ['LOCAL_REVERSIBLE'], rollbackAvailable: true, exactScope: true, localOnly: true,
      predecessorClosed: true, cleanCommittedClosure: true, replanReady: true, [field]: false,
    });
    assert.equal(blocked.decision, 'STOP');
  }
});
