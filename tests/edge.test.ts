import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachError, type Decision } from '../server/coach';
import { createEdgeHandler } from '../server/edge';
import type { CoachRequest } from '../src/lib/coach-contract';

const requestBody = (message = 'Give me some general training guidance.'): CoachRequest => ({
  message, history: [], pending: null,
  context: { profile: null, routines: [], workouts: [] },
});
const answer: Decision = { mode: 'answer', text: 'Use a manageable load and focus on controlled repetitions.', targetId: null, routine: null, edit: null, profilePatch: null };
const jsonRequest = (path: string, body: unknown, init: RequestInit = {}) => new Request(`http://edge.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> || {}) },
  body: JSON.stringify(body), ...init,
});
const token = { authorization: 'Bearer firebase-token' };
const verify = async (value: string) => {
  if (value !== 'firebase-token') throw new CoachError('UNAUTHORIZED', 'Bad token.', 401);
  return 'user-1';
};

test('CORS answers preflight, allows exact configured origins, and rejects lookalikes', async () => {
  const handler = createEdgeHandler({ allowedOrigins: ['https://fit.example'], configured: true, verifyToken: verify });
  const preflight = await handler(new Request('https://edge.test/functions/v1/fitai-api/chat', {
    method: 'OPTIONS', headers: { origin: 'https://fit.example', 'access-control-request-method': 'POST' },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://fit.example');
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /authorization/i);
  const impostor = await handler(new Request('https://edge.test/fitai-api/health', { headers: { origin: 'https://fit.example.evil' } }));
  assert.equal(impostor.status, 403);
  assert.equal((await impostor.json() as any).code, 'ORIGIN_NOT_ALLOWED');
  const health = await handler(new Request('https://edge.test/fitai-api/health', { headers: { origin: 'https://fit.example' } }));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

test('paid chat verifies Firebase bearer before provider use; preview is unauthenticated and provider free', async () => {
  let calls = 0;
  const handler = createEdgeHandler({
    verifyToken: async value => { if (value !== 'good') throw new CoachError('UNAUTHORIZED', 'Invalid session.', 401); return 'member'; },
    provider: async () => { calls++; return answer; },
  });
  const denied = await handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: { authorization: 'Bearer bad' } }));
  assert.equal(denied.status, 401);
  assert.equal(calls, 0);
  const paid = await handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: { authorization: 'Bearer good' } }));
  assert.equal(paid.status, 200);
  assert.equal(calls, 1);
  const preview = await handler(jsonRequest('/functions/v1/fitai-api/preview/chat', requestBody()));
  assert.equal(preview.status, 200);
  assert.equal((await preview.json() as any).basis, 'preview');
  assert.equal(calls, 1);
});

test('health and status expose expected values with injected configuration', async () => {
  const handler = createEdgeHandler({ configured: false });
  const status = await handler(new Request('https://edge.test/fitai-api/status'));
  assert.deepEqual(await status.json(), { configured: false, preview: true, liveResearch: false });
  const absent = await handler(new Request('https://edge.test/wrong-path/health'));
  assert.equal(absent.status, 404);
});

test('JSON body cap reads the stream even when Content-Length is absent; invalid JSON and schema have distinct statuses', async () => {
  const handler = createEdgeHandler({ verifyToken: verify, provider: async () => answer });
  const oversizedBytes = new TextEncoder().encode(JSON.stringify({ data: 'x'.repeat(260 * 1024) }));
  const oversizedStream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(oversizedBytes); controller.close(); } });
  const oversizedInit: any = { method: 'POST', headers: token, body: oversizedStream, duplex: 'half' };
  const tooLarge = await handler(new Request('https://edge.test/fitai-api/chat', oversizedInit));
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json() as any).code, 'BODY_TOO_LARGE');

  const invalid = await handler(new Request('https://edge.test/fitai-api/chat', {
    method: 'POST', headers: { ...token, 'content-type': 'application/json' }, body: '{bad json',
  }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as any).code, 'INVALID_JSON');
  const schema = await handler(jsonRequest('/fitai-api/chat', { message: 'x' }, { headers: token }));
  assert.equal(schema.status, 422);
  assert.equal((await schema.json() as any).code, 'INVALID_DATA');
});

test('valid model decisions return the exact validated proposal shape', async () => {
  const routine: Decision['routine'] = { name: 'Starter', description: '', exercises: [
    { exerciseId: 'chest-7', name: 'Incline Push Ups', sets: [{ weight: 0, reps: 8, completed: false }] },
  ] };
  const create: Decision = { mode: 'create', text: '', targetId: null, routine, edit: null, profilePatch: null };
  const handler = createEdgeHandler({ verifyToken: verify, provider: async () => create });
  const response = await handler(jsonRequest('/fitai-api/chat', requestBody('Create a starter routine.'), { headers: token }));
  assert.equal(response.status, 200);
  const result = await response.json() as any;
  assert.equal(result.basis, 'draft');
  assert.match(result.text, /nothing has been saved/i);
  assert.deepEqual(Object.keys(result.proposal).sort(), ['after', 'before', 'beforeProfile', 'expiresAt', 'id', 'kind', 'profilePatch', 'summary', 'targetId'].sort());
  assert.equal(result.proposal.kind, 'create');
  assert.equal(result.proposal.targetId, null);
  assert.deepEqual(result.proposal.after.exercises[0], routine!.exercises[0]);
  assert.equal(typeof result.proposal.id, 'string');
  assert.ok(Number.isInteger(result.proposal.expiresAt));
});

test('aborted request during verification never spends a quota slot or invokes the provider', async () => {
  let startVerification!: () => void;
  const started = new Promise<void>(resolve => { startVerification = resolve; });
  let resolveVerification!: (uid: string) => void;
  const verification = new Promise<string>(resolve => { resolveVerification = resolve; });
  let verificationCalls = 0;
  let providerCalls = 0;
  const handler = createEdgeHandler({
    verifyToken: async () => { if (verificationCalls++ === 0) { startVerification(); return verification; } return 'same-user'; },
    provider: async () => { providerCalls++; return answer; },
  });
  const controller = new AbortController();
  const pending = handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: token, signal: controller.signal }));
  await started;
  controller.abort();
  resolveVerification('same-user');
  assert.equal((await pending).status, 499);
  assert.equal(providerCalls, 0);
  const healthy = await handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  assert.equal(healthy.status, 200);
});

test('provider receives cancellation signal and canceled work releases its active slot', async () => {
  let calls = 0;
  let signalSeen: AbortSignal | undefined;
  let hold!: () => void;
  const gate = new Promise<void>(resolve => { hold = resolve; });
  const handler = createEdgeHandler({
    verifyToken: async () => 'cancel-user',
    provider: async (_request, _repair, signal) => {
      calls++; signalSeen = signal;
      await gate;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return answer;
    },
  });
  const controller = new AbortController();
  const pending = handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: token, signal: controller.signal }));
  for (let i = 0; i < 50 && !signalSeen; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(signalSeen);
  controller.abort();
  assert.equal(signalSeen.aborted, true);
  hold();
  assert.equal((await pending).status, 499);

  const healthy = await handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  assert.equal(healthy.status, 200);
  assert.equal(calls, 2);
});

test('rate limits cover per-user requests, concurrent work, and forwarded ingress IP', async () => {
  let calls = 0;
  const perUser = createEdgeHandler({ verifyToken: async () => 'rate-user', provider: async () => { calls++; return answer; } });
  const send = () => perUser(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  const statuses: number[] = [];
  for (let i = 0; i < 13; i++) statuses.push((await send()).status);
  assert.equal(statuses.filter(status => status === 200).length, 12);
  assert.equal(statuses[12], 429);
  assert.equal(calls, 12);

  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const concurrent = createEdgeHandler({ verifyToken: async () => 'parallel-user', provider: async () => { await waiting; return answer; } });
  const one = concurrent(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  const two = concurrent(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  const third = await concurrent(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  assert.equal(third.status, 429);
  release();
  assert.deepEqual([(await one).status, (await two).status], [200, 200]);

  let globalCalls = 0;
  let releaseGlobal!: () => void;
  const globalGate = new Promise<void>(resolve => { releaseGlobal = resolve; });
  const globalHandler = createEdgeHandler({
    verifyToken: async value => value,
    provider: async () => { globalCalls++; await globalGate; return answer; },
  });
  const globalRequests = Array.from({ length: 10 }, (_, index) => globalHandler(jsonRequest('/fitai-api/chat', requestBody(), { headers: { authorization: `Bearer global-${index}` } })));
  for (let i = 0; i < 100 && globalCalls < 10; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(globalCalls, 10);
  const eleventh = await globalHandler(jsonRequest('/fitai-api/chat', requestBody(), { headers: { authorization: 'Bearer global-11' } }));
  assert.equal(eleventh.status, 429);
  releaseGlobal();
  assert.ok((await Promise.all(globalRequests)).every(response => response.status === 200));

  let identity = 0;
  const ingress = createEdgeHandler({ verifyToken: async value => value, provider: async () => answer });
  const preview = () => {
    const id = `ingress-user-${identity++}`;
    return ingress(jsonRequest('/fitai-api/chat', requestBody(), { headers: { authorization: `Bearer ${id}`, 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } }));
  };
  let last: Response | undefined;
  for (let i = 0; i < 61; i++) last = await preview();
  assert.equal(last!.status, 429);
});

test('provider failures do not expose internal messages', async () => {
  const handler = createEdgeHandler({ verifyToken: verify, provider: async () => { throw new Error('secret-token and internal stack'); } });
  const response = await handler(jsonRequest('/fitai-api/chat', requestBody(), { headers: token }));
  assert.equal(response.status, 503);
  const data = await response.json() as any;
  assert.equal(data.code, 'AI_UNAVAILABLE');
  assert.doesNotMatch(data.error, /secret-token|internal stack/);
});
