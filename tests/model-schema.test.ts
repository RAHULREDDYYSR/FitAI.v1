import test from 'node:test';
import assert from 'node:assert/strict';
import { zodResponseFormat } from 'openai/helpers/zod';
import { coachModel, modelDecisionSchema } from '../server/openai';

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


test('coach defaults to GPT-6 Luna while honoring explicit model overrides', () => {
  const original = process.env.FITAI_COACH_MODEL;
  try {
    delete process.env.FITAI_COACH_MODEL;
    assert.equal(coachModel(), 'gpt-6-luna');
    process.env.FITAI_COACH_MODEL = 'gpt-5-mini';
    assert.equal(coachModel(), 'gpt-5-mini');
  } finally {
    if (original === undefined) delete process.env.FITAI_COACH_MODEL;
    else process.env.FITAI_COACH_MODEL = original;
  }
});
