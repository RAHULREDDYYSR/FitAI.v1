import test from 'node:test';
import assert from 'node:assert/strict';
import { zodResponseFormat } from 'openai/helpers/zod';
import { modelDecisionSchema } from '../server/openai';

test('OpenAI strict response schema requires every property, including draft defaults', () => {
  const schema = zodResponseFormat(modelDecisionSchema, 'coach_decision').json_schema.schema;
  function inspect(value: any) {
    if (!value || typeof value !== 'object') return;
    if (value.properties) {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort());
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(inspect);
      else inspect(child);
    }
  }
  inspect(schema);
});
