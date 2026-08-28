import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STABLE_SCHEMAS,
  loadStableExample,
  loadStableSchema,
  stableSchemaNames,
  validateAllStableExamples,
  validateStableArtifact,
} from '../../packages/stable-control/index.mjs';

test('every stable schema has a frozen document, bounded example, and matching identifier', async () => {
  const names = stableSchemaNames();
  assert.ok(names.length >= 20);
  for (const name of names) {
    const schema = await loadStableSchema(name);
    const example = await loadStableExample(name);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, STABLE_SCHEMAS[name]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(example.schema, schema.$id);
  }
  const validated = await validateAllStableExamples();
  assert.equal(validated.length, names.length);
});

test('stable validation requires authority-bearing OMO fields', async () => {
  const work = await loadStableExample('omoWorkOrder');
  assert.equal(validateStableArtifact(STABLE_SCHEMAS.omoWorkOrder, work), work);
  assert.throws(
    () => validateStableArtifact(STABLE_SCHEMAS.omoReceipt, { schema: STABLE_SCHEMAS.omoReceipt }),
    /Missing stable field/u,
  );
});
