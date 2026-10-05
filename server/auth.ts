import { createPublicKey, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CoachError } from './coach';

type Keys = { keys: Array<JsonWebKey & { kid: string }> };
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;
// Firebase rotates signing keys infrequently. A short refresh cooldown still
// lets a rotated key through promptly while bounding refreshes from random kids.
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30 * 1000;
export function createTokenVerifier(projectId: string, fetchKeys = async (): Promise<Keys> => {
  try {
    const response = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Key service unavailable');
    const keys = await response.json() as Keys;
    if (!Array.isArray(keys.keys) || !keys.keys.length) throw new Error('Invalid key response');
    return keys;
  } catch { throw new CoachError('AUTH_UNAVAILABLE', 'Sign-in verification is temporarily unavailable. Please retry.', 503); }
}) {
  let cached: Keys | null = null;
  let expiresAt = 0;
  let fetching: Promise<Keys> | null = null;
  let lastUnknownKidRefreshAt = 0;
  const refreshKeys = async (): Promise<Keys> => {
    if (!fetching) {
      fetching = fetchKeys().then(keys => {
        cached = keys;
        expiresAt = Date.now() + KEY_CACHE_TTL_MS;
        lastUnknownKidRefreshAt = Date.now();
        return keys;
      });
    }
    const currentFetch = fetching;
    try { return await currentFetch; }
    finally { if (fetching === currentFetch) fetching = null; }
  };
  return async (token: string): Promise<string> => {
    try {
      if (token.length > 8192) throw new Error('Token too long');
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Malformed token');
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid algorithm');
      if (!cached || expiresAt < Date.now()) await refreshKeys();
      let key = cached.keys.find(key => key.kid === header.kid);
      if (!key) {
        const now = Date.now();
        // Join an in-flight fetch regardless of the cooldown. Otherwise only
        // one request per cooldown window can refresh for an unknown kid.
        if (fetching) await fetching;
        else if (now - lastUnknownKidRefreshAt >= UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
          lastUnknownKidRefreshAt = now;
          await refreshKeys();
        }
        key = cached?.keys.find(key => key.kid === header.kid);
      }
      if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: key as any, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid signature');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const now = Math.floor(Date.now() / 1000);
      if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
        typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
        !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 30 ||
        !Number.isFinite(claims.auth_time) || claims.auth_time > now + 30) throw new Error('Invalid claims');
      return claims.sub;
    } catch (error) {
      if (error instanceof CoachError) throw error;
      throw new CoachError('UNAUTHORIZED', 'Your session expired. Sign in again to use the coach.', 401);
    }
  };
}
