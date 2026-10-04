import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { CoachError } from '../server/coach';
import { createTokenVerifier } from '../server/auth';

const projectId = 'fitai-test-project';
function signingKey(kid: string) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } as JsonWebKey & { kid: string };
  return {
    jwk,
    token() {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const header = encode({ alg: 'RS256', kid });
      const now = Math.floor(Date.now() / 1000);
      const payload = encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: 'user-1', iat: now, auth_time: now, exp: now + 3600 });
      const content = `${header}.${payload}`;
      return `${content}.${sign('RSA-SHA256', Buffer.from(content), pair.privateKey).toString('base64url')}`;
    },
  };
}

test('unknown kids share one refresh and repeated random kids are cooldown limited', async () => {
  const key = signingKey('known');
  let now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    let fetchCount = 0;
    let finishRefresh!: (keys: { keys: typeof key.jwk[] }) => void;
    const verifier = createTokenVerifier(projectId, async () => {
      fetchCount++;
      if (fetchCount === 1) return { keys: [key.jwk] };
      return new Promise(resolve => { finishRefresh = resolve; });
    });
    assert.equal(await verifier(key.token()), 'user-1');
    now += 30_001;
    const unknown = signingKey('random-kid').token();
    const first = verifier(unknown);
    const second = verifier(unknown);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetchCount, 2, 'concurrent unknown kids should share a refresh');
    finishRefresh({ keys: [key.jwk] });
    await assert.rejects(first, (e: unknown) => e instanceof CoachError && e.code === 'UNAUTHORIZED');
    await assert.rejects(second, (e: unknown) => e instanceof CoachError && e.code === 'UNAUTHORIZED');

    for (let i = 0; i < 20; i++) {
      await assert.rejects(verifier(signingKey(`random-${i}`).token()), (e: unknown) => e instanceof CoachError && e.code === 'UNAUTHORIZED');
    }
    assert.equal(fetchCount, 2, 'random kids within the cooldown should not trigger fetches');
  } finally { Date.now = originalNow; }
});

test('a rotated Firebase key is accepted after the refresh cooldown', async () => {
  const oldKey = signingKey('old');
  const newKey = signingKey('new');
  let now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    let fetchCount = 0;
    const verifier = createTokenVerifier(projectId, async () => ({ keys: ++fetchCount === 1 ? [oldKey.jwk] : [newKey.jwk] }));
    assert.equal(await verifier(oldKey.token()), 'user-1');
    now += 30_001;
    assert.equal(await verifier(newKey.token()), 'user-1');
    assert.equal(fetchCount, 2);
  } finally { Date.now = originalNow; }
});

test('key service errors retain AUTH_UNAVAILABLE semantics', async () => {
  const verifier = createTokenVerifier(projectId, async () => {
    throw new CoachError('AUTH_UNAVAILABLE', 'Sign-in verification is temporarily unavailable. Please retry.', 503);
  });
  const key = signingKey('unavailable');
  await assert.rejects(verifier(key.token()), (e: unknown) => e instanceof CoachError && e.code === 'AUTH_UNAVAILABLE' && e.status === 503);
});
