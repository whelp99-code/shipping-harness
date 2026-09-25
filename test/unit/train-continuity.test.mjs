import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrainContinuation } from '../../src/core/train-continuity.mjs';
import { ShippingError } from '../../src/core/errors.mjs';

const expected = {
  planHash: 'a'.repeat(64),
  stage: 'DELIVER_CORE_VALUE',
  stageId: 'S-02',
  goal: 'A visitor can see the signed-in name',
};

test('matching plan hash and stage continues', () => {
  assert.equal(assertTrainContinuation(expected, { ...expected, version: '9.9.9' }), true);
});

test('same version with a different plan hash or an unrelated goal is rejected', () => {
  assert.throws(() => assertTrainContinuation(expected, { ...expected, planHash: 'b'.repeat(64) }), (error) => {
    assert.ok(error instanceof ShippingError);
    assert.equal(error.code, 'ERR_TRAIN_CONTINUITY');
    return true;
  });
  assert.throws(() => assertTrainContinuation(expected, { ...expected, goal: 'Ship an unrelated billing portal' }), (error) => {
    assert.ok(error instanceof ShippingError);
    assert.equal(error.code, 'ERR_TRAIN_UNRELATED_GOAL');
    return true;
  });
  assert.throws(() => assertTrainContinuation(expected, { ...expected, stageId: 'S-99' }), (error) => {
    assert.equal(error.code, 'ERR_TRAIN_CONTINUITY');
    return true;
  });
});
