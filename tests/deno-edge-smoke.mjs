// Exercises the actual deployable bundle in Deno. Remote services are fixtures.
import { generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';

function check(condition, message) { if (!condition) throw new Error(message); }

Deno.env.delete('FITAI_COACH_MODEL');
Deno.env.set('FITAI_OPENAI_API_KEY', 'fitai-local-runtime-test');
Deno.env.set('FITAI_ALLOWED_ORIGINS', 'https://gen-lang-client-0375724084.web.app');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'runtime-fixture' };
const now = Math.floor(Date.now() / 1000);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const payload = [encode({ alg: 'RS256', kid: jwk.kid }), encode({
  aud: 'gen-lang-client-0375724084', iss: 'https://securetoken.google.com/gen-lang-client-0375724084',
  sub: 'fixture-user', exp: now + 300, iat: now, auth_time: now,
})].join('.');
const token = payload + '.' + sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url');
let modelCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('www.googleapis.com/service_accounts/')) return Response.json({ keys: [jwk] });
  if (url === 'https://api.openai.com/v1/chat/completions') {
    modelCalls++;
    check(options.signal instanceof AbortSignal, 'SDK must propagate the request signal');
    const request = JSON.parse(options.body);
    check(request.model === 'gpt-6-luna', 'SDK must request the Luna default');
    check(!('temperature' in request) && !('reasoning_effort' in request), 'Luna must use provider defaults');
    check(request.response_format.type === 'json_schema', 'SDK must use structured outputs');
    return Response.json({
      id: 'fixture-completion', object: 'chat.completion', created: now, model: 'gpt-6-luna',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', refusal: null,
        content: JSON.stringify({ mode: 'answer', text: 'Warm up with easy movement and light practice sets.',
          targetId: null, routine: null, edit: null, profilePatch: null }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  throw new Error('Unexpected outbound request in runtime smoke test');
};

let handler;
const originalServe = Deno.serve;
Deno.serve = callback => { handler = callback; };
try {
  await import('../supabase/functions/fitai-api/index.js');
  check(typeof handler === 'function', 'Bundle must register its handler');
  const base = 'https://fixture.supabase.co/functions/v1/fitai-api';
  const health = await handler(new Request(base + '/health'));
  check(health.status === 200, 'Bundle health failed');
  const body = JSON.stringify({ message: 'Give me practical advice about warming up before lifting.', history: [],
    context: { profile: null, routines: [], workouts: [] }, pending: null });
  const headers = { origin: 'https://gen-lang-client-0375724084.web.app', 'content-type': 'application/json' };
  const missing = await handler(new Request(base + '/chat', { method: 'POST', headers, body }));
  check(missing.status === 401 && modelCalls === 0, 'Missing token must not call the model');
  const valid = await handler(new Request(base + '/chat', { method: 'POST', headers: { ...headers, authorization: 'Bearer ' + token }, body }));
  const reply = await valid.json();
  check(valid.status === 200 && reply.text === 'Warm up with easy movement and light practice sets.', 'Verified Firebase session must reach the SDK');
  check(valid.headers.get('access-control-allow-origin') === headers.origin, 'CORS must allow the configured frontend');
  const invalid = await handler(new Request(base + '/chat', { method: 'POST', headers: { ...headers, authorization: 'Bearer ' + token + 'bad' }, body }));
  check(invalid.status === 401 && modelCalls === 1, 'Invalid signature must not call the model');
  console.log('Deno bundle: health, Firebase RSA verification, CORS, authentication and OpenAI structured-output SDK passed with fixtures.');
} finally {
  Deno.serve = originalServe;
  globalThis.fetch = originalFetch;
}
