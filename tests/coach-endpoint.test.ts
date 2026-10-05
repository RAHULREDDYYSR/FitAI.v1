import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCoachEndpoint } from '../src/lib/coach-endpoint';

test('all coach routes use the configured external base without changing local defaults', () => {
  const base = 'https://sample.supabase.co/functions/v1/fitai-api/';
  assert.equal(resolveCoachEndpoint('chat'), '/api/ai/chat');
  assert.equal(resolveCoachEndpoint('status', base), 'https://sample.supabase.co/functions/v1/fitai-api/status');
  assert.equal(resolveCoachEndpoint('preview/chat', base), 'https://sample.supabase.co/functions/v1/fitai-api/preview/chat');
  for (const unsafe of ['http://example.com/api', 'https://user:secret@example.com/api', 'https://example.com/api?token=secret']) {
    assert.throws(() => resolveCoachEndpoint('chat', unsafe));
  }
});
