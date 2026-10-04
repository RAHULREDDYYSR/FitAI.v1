import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAPIApp } from '../server/app';

test('deployment API preserves health, authentication, JSON errors and body limits', async t => {
  const app = createAPIApp({ verifyToken: async () => { throw new Error('not used'); } });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('x-powered-by'), null);
  const missing = await fetch(`${base}/api/missing`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') || '', /application\/json/);
  const unauthenticated = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauthenticated.status, 401);
  const invalid = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  const oversized = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(270000) }) });
  assert.equal(oversized.status, 413);
  assert.match(oversized.headers.get('content-type') || '', /application\/json/);
});

test('Firebase pre-parsed JSON still obeys the API body limit', async t => {
  const platform = express();
  platform.use(express.json({ limit: '1mb', verify: (req, _res, body) => {
    (req as typeof req & { rawBody: Buffer }).rawBody = body;
  } }));
  platform.use(createAPIApp());
  const server = platform.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(270000) }),
  });
  assert.equal(response.status, 413);
});
