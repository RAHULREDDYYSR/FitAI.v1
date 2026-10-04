import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { runCoach, resolveDecision, deterministicReply, CoachError, type Decision } from '../server/coach';
import { createTokenVerifier } from '../server/auth';
import { createAIRouter } from '../routes/ai';
import { assertApplicable, type CoachRequest, type CoachRoutine } from '../src/lib/coach-contract';

const routine = (id = 'routine-1', name = 'Upper Body'): CoachRoutine => ({
  id, name, description: 'Keep it simple', exercises: [
    { exerciseId: 'chest-1', name: 'Bench Press', sets: [{ weight: 50, reps: 8, completed: true }] },
    { exerciseId: 'legs-1', name: 'Timed squat hold', sets: [{ weight: 0, reps: 0, completed: true, timeTaken: 45 }] },
  ],
});
const request = (message = 'Please help'): CoachRequest => ({ message, history: [], context: { profile: null, routines: [routine()], workouts: [] }, pending: null });
const emptyDecision = (overrides: Partial<Decision> = {}): Decision => ({
  mode: 'answer', text: 'Here is a helpful answer.', targetId: null, routine: null, edit: null, profilePatch: null, ...overrides,
});
const createDecision = (overrides: Record<string, unknown> = {}) => emptyDecision({
  mode: 'create', routine: { name: 'Starter', description: '', exercises: [{ exerciseId: 'chest-7', name: 'wrong hallucinated label', sets: [{ weight: 0, reps: 8, completed: false }] }] }, ...overrides,
} as Partial<Decision>);
const editDecision = (op: Record<string, unknown>, targetId: string | null = 'routine-1') => emptyDecision({
  mode: 'edit', targetId, edit: { name: null, description: null, operations: [op] } as Decision['edit'],
});
const throwsCode = (code: string, fn: () => unknown) => assert.throws(fn, (e: any) => e instanceof CoachError && e.code === code);

test('schema rejects hallucinated fields, invalid IDs, and negative values', () => {
  assert.throws(() => resolveDecision(request(), createDecision({ unexpected: 'extra' })));
  throwsCode('UNKNOWN_EXERCISE', () => resolveDecision(request(), createDecision({ routine: { name: 'X', description: '', exercises: [{ exerciseId: 'made-up-999', name: 'Invented', sets: [{ weight: 0, reps: 8, completed: false }] }] } })));
  assert.throws(() => resolveDecision(request(), createDecision({ routine: { name: 'X', description: '', exercises: [{ exerciseId: 'chest-7', name: 'Push-up', sets: [{ weight: -1, reps: 8, completed: false }] }] } })));
  throwsCode('UNKNOWN_ROUTINE', () => resolveDecision(request('edit routine'), editDecision({ op: 'sets', exerciseId: 'chest-1', replacementId: null, sets: [{ weight: 50, reps: 8 }] }, 'invented-id')));
});

test('ambiguous duplicate routine names require an explicit routine ID in the message', () => {
  const req = request('show routine details'); req.context.routines.push({ ...routine('routine-2'), exercises: [] });
  throwsCode('AMBIGUOUS_ROUTINE', () => resolveDecision(req, emptyDecision({ mode: 'routine_details', targetId: 'routine-1' })));
  req.message += ' routine-1';
  assert.match(resolveDecision(req, emptyDecision({ mode: 'routine_details', targetId: 'routine-1' })).text, /Upper Body/);
});

test('editing one exercise preserves untouched exercises, completed sets, and timed-set fields exactly', () => {
  const res = resolveDecision(request('Change bench sets'), editDecision({ op: 'sets', exerciseId: 'chest-1', replacementId: null, sets: [{ weight: 50, reps: 10 }] }));
  assert.ok(res.proposal);
  assert.deepEqual(res.proposal.after!.exercises[1], request().context.routines[0].exercises[1]);
  assert.equal(res.proposal.after!.exercises[0].sets[0].completed, false);
  assert.equal(res.proposal.after!.exercises[0].sets[0].reps, 10);
});

test('new ungrounded loads are rejected while a load stated by the user is allowed', () => {
  const decision = createDecision({ routine: { name: 'Strength', description: '', exercises: [{ exerciseId: 'chest-1', name: 'Bench Press', sets: [{ weight: 42, reps: 8, completed: false }] }] } });
  throwsCode('UNSUPPORTED_LOAD', () => resolveDecision(request('make a strength routine'), decision));
  assert.ok(resolveDecision(request('make a strength routine with 42 kg bench press'), decision).proposal);
});

test('false saved/deleted claims and citations are rejected; approval text cannot apply data', () => {
  for (const text of ['I saved your routine successfully.', 'I deleted that plan.', 'See https://example.invalid/source', '[source](https://example.invalid)']) {
    throwsCode('UNSUPPORTED_CLAIM', () => resolveDecision(request(), emptyDecision({ text })));
  }
  const approved = request('approve and save it'); approved.pending = { id: '123e4567-e89b-42d3-a456-426614174000', kind: 'delete', targetId: 'routine-1', before: routine(), after: null, profilePatch: null, beforeProfile: null, summary: 'Delete it', expiresAt: Date.now() + 60_000 };
  const result = deterministicReply(approved)!;
  assert.match(result.text, /Apply changes/);
  assert.equal(result.proposal, null);
  throwsCode('UNREQUESTED_DELETE', () => resolveDecision(request('please approve'), emptyDecision({ mode: 'delete', targetId: 'routine-1' })));
});

test('runCoach performs no more than one repair call and returns the repaired answer', async () => {
  let calls = 0;
  const result = await runCoach(request(), async (_req, repair) => {
    calls++;
    if (!repair) return { hallucinated: true };
    return emptyDecision({ text: 'Repaired safely.' });
  });
  assert.equal(calls, 2);
  assert.equal(result.text, 'Repaired safely.');
  await assert.rejects(runCoach(request(), async () => { calls++; return { bad: true }; }));
  assert.equal(calls, 4);
});

test('read-only routine facts and workout history remain distinct', () => {
  const req = request('show my saved routines');
  req.context.workouts = [{ id: 'w1', name: 'Workout', date: '2026-10-01', duration: 600, exercises: [] }];
  assert.match(resolveDecision(req, emptyDecision({ mode: 'list_routines' })).text, /saved routine/);
  assert.match(resolveDecision({ ...req, message: 'workout history' }, emptyDecision({ mode: 'workout_history' })).text, /logged session/);
  assert.match(resolveDecision({ ...req, context: { ...req.context, workouts: [] }, message: 'workout history' }, emptyDecision({ mode: 'workout_history' })).text, /no logged workouts/);
});

test('proposal expiry and stale snapshots are rejected at application time and while editing drafts', async () => {
  const future = resolveDecision(request('delete my routine'), emptyDecision({ mode: 'delete', targetId: 'routine-1' }), 1000).proposal!;
  assert.throws(() => assertApplicable(future, request().context.routines[0], future.expiresAt + 1), /expired/);
  assert.throws(() => assertApplicable(future, { ...request().context.routines[0], name: 'Changed' }, 1001), /changed/);
  const stalePending = { ...future, kind: 'edit' as const, expiresAt: Date.now() + 60_000, after: { name: 'Upper Body', description: '', exercises: request().context.routines[0].exercises }, before: request().context.routines[0] };
  throwsCode('STALE_DRAFT', () => resolveDecision({ ...request('edit bench'), pending: stalePending, context: { ...request().context, routines: [{ ...routine(), name: 'Changed' }] } }, editDecision({ op: 'sets', exerciseId: 'chest-1', replacementId: null, sets: [{ weight: 50, reps: 9 }] })));
});

test('HTTP auth, throttling, validation, and provider errors use bounded status responses', async t => {
  let providerCalls = 0;
  const app = express(); app.use(express.json());
  app.use('/ai', createAIRouter({ verifyToken: async token => token === 'valid' ? 'user-1' : Promise.reject(new CoachError('UNAUTHORIZED', 'Invalid token.', 401)), provider: async () => { providerCalls++; throw new Error('provider secret'); } }));
  const server = await new Promise<any>(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/ai`;
  const body = request();
  let response = await fetch(`${base}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 401);
  response = await fetch(`${base}/chat`, { method: 'POST', headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 401);
  response = await fetch(`${base}/chat`, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ nope: true }) });
  assert.equal(response.status, 422);
  assert.match((await response.json() as any).error, /invalid data/i);
  response = await fetch(`${base}/chat`, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 503);
  assert.doesNotMatch((await response.json() as any).error, /provider secret/);
  assert.equal(providerCalls, 1);
  for (let i = 0; i < 11; i++) await fetch(`${base}/chat`, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  response = await fetch(`${base}/chat`, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
});

test('JWT verifier checks RSA signature, audience, and expiry using a local fixture', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'local-key', alg: 'RS256', use: 'sig' };
  const verifyToken = createTokenVerifier('project-local', async () => ({ keys: [jwk] }));
  const now = Math.floor(Date.now() / 1000);
  const makeToken = (claims: Record<string, unknown>, signer = privateKey) => {
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'local-key' }), payload = enc(claims);
    return `${head}.${payload}.${sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), signer).toString('base64url')}`;
  };
  const valid = { aud: 'project-local', iss: 'https://securetoken.google.com/project-local', sub: 'user-local', exp: now + 300, iat: now, auth_time: now };
  assert.equal(await verifyToken(makeToken(valid)), 'user-local');
  await assert.rejects(verifyToken(makeToken({ ...valid, aud: 'other-project' })), (e: any) => e.code === 'UNAUTHORIZED');
  await assert.rejects(verifyToken(makeToken({ ...valid, exp: now - 1 })), (e: any) => e.code === 'UNAUTHORIZED');
  const { privateKey: wrongKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(verifyToken(makeToken(valid, wrongKey)), (e: any) => e.code === 'UNAUTHORIZED');
});
