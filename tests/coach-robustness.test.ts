import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { runCoach, type Decision } from '../server/coach';
import { createAIRouter } from '../routes/ai';
import { mergeRoutineEdit, routineSnapshot, type CoachProposal, type CoachRequest } from '../src/lib/coach-contract';
import { applyDemoProposal, readDemo } from '../src/lib/demo';

const source = { id: 'routine-1', name: 'Upper Body', description: 'Keep it simple', exercises: [
  { exerciseId: 'chest-1', name: 'Bench Press', note: 'Shoulder feels best with a pause', catalogRevision: 9,
    sets: [{ weight: 40, reps: 8, completed: true, note: 'Easy warmup', importedId: 'set-1' }, { weight: 50, reps: 6, completed: false, importedId: 'set-2', note: 'Paused reps' }] },
  { exerciseId: 'legs-1', name: 'Squat', note: 'Leave unchanged', sets: [{ weight: 30, reps: 10, completed: false, note: 'Keep this note' }] },
] };
const baseRequest = (message: string): CoachRequest => ({
  message, history: [], pending: null,
  context: { profile: null, routines: [routineSnapshot(source)], workouts: [] },
});
const answer = (text: string): Decision => ({ mode: 'answer', text, targetId: null, routine: null, edit: null, profilePatch: null });

test('mergeRoutineEdit keeps exercise/set metadata and notes while applying set changes', () => {
  const merged = mergeRoutineEdit(source, {
    name: source.name, description: source.description,
    exercises: [
      { exerciseId: 'chest-1', name: 'Bench Press', sets: [{ weight: 40, reps: 8, completed: false }, { weight: 50, reps: 8, completed: false }] },
      { exerciseId: 'legs-1', name: 'Squat', sets: [{ weight: 30, reps: 10, completed: false }] },
    ],
  });
  assert.equal(merged.exercises[0].note, source.exercises[0].note);
  assert.equal(merged.exercises[0].catalogRevision, 9);
  assert.equal(merged.exercises[0].sets[0].note, 'Easy warmup');
  assert.equal(merged.exercises[0].sets[0].importedId, 'set-1');
  assert.equal(merged.exercises[0].sets[1].note, 'Paused reps');
  assert.equal(merged.exercises[1].note, 'Leave unchanged');
  assert.equal(merged.exercises[1].sets[0].note, 'Keep this note');
  assert.equal(merged.exercises[0].sets[1].reps, 8);
});

test('personal-record factual answer is grounded while general coaching remains available', async () => {
  let calls = 0;
  const provider = async () => { calls++; return answer('Your bench press personal record is 120 kg.'); };
  const personal = await runCoach(baseRequest('What is my bench press personal record?'), provider);
  assert.equal(calls, 1);
  assert.equal(personal.proposal, null);
  assert.match(personal.text, /will not estimate missing personal records/i);
  const guidance = await runCoach(baseRequest('How do I choose a weight for squats?'), async () => answer('Start light enough to keep every rep controlled, then add weight gradually.'));
  assert.match(guidance.text, /Start light enough/);
});

test('cancellation prevents a repair call after invalid provider output', async () => {
  const controller = new AbortController();
  let calls = 0; let signalSeen: AbortSignal | undefined;
  const operation = runCoach(baseRequest('Give me a plan'), async (_request, _repair, signal) => {
    calls++; signalSeen = signal;
    controller.abort();
    return { hallucinated: true };
  }, controller.signal);
  await assert.rejects(operation);
  assert.equal(signalSeen, controller.signal);
  assert.equal(calls, 1);
});

test('aborted HTTP /chat request propagates its signal to a waiting provider', async t => {
  const app = express(); app.use(express.json());
  let sawSignal: AbortSignal | undefined;
  let signalAbortedResolve!: () => void;
  const signalAborted = new Promise<void>(resolve => { signalAbortedResolve = resolve; });
  app.use('/ai', createAIRouter({
    verifyToken: async () => 'abort-test-user',
    provider: async (_request, _repair, signal) => {
      sawSignal = signal;
      await new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) { signalAbortedResolve(); reject(new Error('aborted')); return; }
        signal?.addEventListener('abort', () => { signalAbortedResolve(); reject(new Error('aborted')); }, { once: true });
      });
    },
  }));
  const server = await new Promise<any>(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const client = new AbortController();
  const response = fetch(`http://127.0.0.1:${server.address().port}/ai/chat`, {
    method: 'POST', headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
    body: JSON.stringify(baseRequest('Give me a training plan')), signal: client.signal,
  }).catch(() => undefined);
  for (let i = 0; i < 40 && !sawSignal; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(sawSignal, 'provider should receive the request signal');
  client.abort();
  await Promise.race([signalAborted, new Promise((_, reject) => setTimeout(() => reject(new Error('server did not abort provider signal')), 1000))]);
  assert.equal(sawSignal!.aborted, true);
  await response;
});

test('disconnect during token verification never reaches provider and releases no quota slot', async t => {
  const app = express(); app.use(express.json());
  let providerCalls = 0;
  let markSlowStarted!: () => void;
  const slowStarted = new Promise<void>(resolve => { markSlowStarted = resolve; });
  let finishSlowAuth!: (uid: string) => void;
  const slowAuth = new Promise<string>(resolve => { finishSlowAuth = resolve; });
  let markPeerClosed!: () => void;
  const peerClosed = new Promise<void>(resolve => { markPeerClosed = resolve; });
  app.use('/ai', (_req, res, next) => { res.once('close', markPeerClosed); next(); });
  app.use('/ai', createAIRouter({
    verifyToken: async token => {
      if (token === 'slow') { markSlowStarted(); return slowAuth; }
      return 'disconnect-test-user';
    },
    provider: async () => {
      providerCalls++;
      await new Promise(resolve => setTimeout(resolve, 80));
      return answer('Safe general guidance.');
    },
  }));
  const server = await new Promise<any>(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/ai/chat`;
  const body = JSON.stringify(baseRequest('Give me some general training guidance.'));

  const disconnected = new AbortController();
  const slowResponse = fetch(url, { method: 'POST', headers: { authorization: 'Bearer slow', 'content-type': 'application/json' }, body, signal: disconnected.signal }).catch(() => undefined);
  await slowStarted;
  disconnected.abort();
  await slowResponse;
  await Promise.race([peerClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('client disconnect did not reach server')), 1000))]);
  finishSlowAuth('disconnect-test-user');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(providerCalls, 0, 'a disconnected request must not invoke the provider after auth completes');

  // Two simultaneous good calls use both per-user slots. A leaked slot from
  // the abandoned request would make the router reject one of these with 429.
  const healthy = () => fetch(url, { method: 'POST', headers: { authorization: 'Bearer healthy', 'content-type': 'application/json' }, body });
  const responses = await Promise.all([healthy(), healthy()]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(providerCalls, 2);
});

function installMemoryStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  } });
  return values;
}
function demoEditProposal(before: ReturnType<typeof routineSnapshot>, after: NonNullable<CoachProposal['after']>, id: string, expiresAt = Date.now() + 60_000): CoachProposal {
  return { id, kind: 'edit', targetId: before.id, before, after, profilePatch: null, beforeProfile: null, summary: 'Adjust one exercise', expiresAt };
}

test('demo apply changes only the target exercise and applying the same proposal twice is idempotent', () => {
  installMemoryStorage();
  const initial = readDemo();
  const target = initial.routines[0];
  const before = routineSnapshot(target);
  const after = structuredClone(before);
  after.exercises[0].sets[0].reps = 9;
  const proposal = demoEditProposal(before, { name: after.name, description: after.description, exercises: after.exercises }, '123e4567-e89b-42d3-a456-426614174000');
  const firstReceipt = applyDemoProposal(proposal);
  const afterFirst = readDemo();
  const secondReceipt = applyDemoProposal(proposal);
  const afterSecond = readDemo();
  assert.equal(firstReceipt, secondReceipt);
  assert.equal(afterFirst.routines.filter(r => r.id === target.id).length, 1);
  assert.equal(afterSecond.routines.filter(r => r.id === target.id).length, 1);
  assert.equal(afterSecond.routines[0].exercises[0].sets[0].reps, 9);
  assert.deepEqual(afterSecond.routines[0].exercises.slice(1), target.exercises.slice(1));
  assert.equal(afterSecond.workouts.length, initial.workouts.length);
});

test('demo apply rejects stale and expired proposals', () => {
  installMemoryStorage();
  const initial = readDemo();
  const target = initial.routines[0];
  const before = routineSnapshot(target);
  const after = structuredClone(before);
  after.exercises[0].sets[0].reps = 9;
  const stale = demoEditProposal(before, { name: after.name, description: after.description, exercises: after.exercises }, '223e4567-e89b-42d3-a456-426614174000');
  const changed = { ...target, description: 'changed since preview' };
  const store = JSON.parse((globalThis.localStorage as any).getItem('fitai_sample_workspace_v1'));
  store.routines[0] = changed;
  (globalThis.localStorage as any).setItem('fitai_sample_workspace_v1', JSON.stringify(store));
  assert.throws(() => applyDemoProposal(stale), /changed since this preview/i);
  const expired = demoEditProposal(routineSnapshot(changed), { name: after.name, description: after.description, exercises: after.exercises }, '323e4567-e89b-42d3-a456-426614174000', Date.now() - 1);
  assert.throws(() => applyDemoProposal(expired), /preview expired/i);
});
