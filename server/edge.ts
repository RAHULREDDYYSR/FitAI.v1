import { z } from 'zod';
import firebaseConfig from '../firebase-applet-config.json';
import { CoachError, runCoach, runPreviewCoach, type DecisionProvider } from './coach';
import { createTokenVerifier } from './auth';
import { isAIConfigured, openAIProvider } from './openai';
import { chatRequestSchema } from '../src/lib/coach-contract';

const JSON_LIMIT = 256 * 1024;
const MAP_LIMIT = 10_000;
const WINDOW_MS = 60_000;

type TokenVerifier = (token: string) => Promise<string>;
type EdgeOptions = {
  verifyToken?: TokenVerifier;
  provider?: DecisionProvider;
  configured?: boolean | (() => boolean);
  allowedOrigins?: string[];
};
type Bucket = { start: number; count: number; active: number };
type IngressBucket = { start: number; count: number };

function configuredOrigins() {
  return [
    `https://${firebaseConfig.projectId}.web.app`,
    `https://${firebaseConfig.projectId}.firebaseapp.com`,
    'http://localhost:3000',
  ];
}

function json(data: unknown, status: number, headers?: HeadersInit): Response {
  const out = new Headers(headers);
  out.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers: out });
}

function failure(code: string, message: string, status: number, headers?: HeadersInit) {
  return json({ code, error: message }, status, headers);
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.body) throw new CoachError('INVALID_JSON', 'A JSON request body is required.', 400);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > JSON_LIMIT) throw new CoachError('BODY_TOO_LARGE', 'The request body exceeds the 256 KB limit.', 413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > JSON_LIMIT) {
        await reader.cancel().catch(() => undefined);
        throw new CoachError('BODY_TOO_LARGE', 'The request body exceeds the 256 KB limit.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new CoachError('INVALID_JSON', 'The request body must contain valid JSON.', 400); }
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip')?.trim();
  const candidate = forwarded || real;
  return candidate && candidate.length <= 128 ? candidate : 'unknown';
}

function routePath(pathname: string): string | null {
  const bases = ['/fitai-api', '/functions/v1/fitai-api'];
  const base = bases.find(candidate => pathname === candidate || pathname.startsWith(`${candidate}/`));
  if (!base) return null;
  return pathname.slice(base.length) || '/';
}

export function createEdgeHandler(options: EdgeOptions = {}) {
  const verifyToken = options.verifyToken || createTokenVerifier(firebaseConfig.projectId);
  const provider = options.provider || openAIProvider;
  const configured = options.configured ?? isAIConfigured;
  const allowedOrigins = new Set(options.allowedOrigins || configuredOrigins());
  const userBuckets = new Map<string, Bucket>();
  const ingressBuckets = new Map<string, IngressBucket>();
  let totalActive = 0;

  const handler = async (request: Request): Promise<Response> => {
    const path = routePath(new URL(request.url).pathname);
    if (path === null) return failure('NOT_FOUND', 'Not found.', 404);

    const headers = new Headers({ vary: 'Origin' });
    const origin = request.headers.get('origin');
    if (origin) {
      if (!allowedOrigins.has(origin)) return failure('ORIGIN_NOT_ALLOWED', 'This origin is not allowed.', 403, headers);
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
      headers.set('access-control-allow-headers', 'Authorization, Content-Type');
      headers.set('access-control-max-age', '600');
    }

    if (request.method === 'OPTIONS') {
      if (!['/health', '/status', '/chat', '/preview/chat'].includes(path)) return failure('NOT_FOUND', 'Not found.', 404, headers);
      return new Response(null, { status: 204, headers });
    }
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    if (path === '/health' && request.method === 'GET') return json({ status: 'ok' }, 200, headers);
    if (path === '/status' && request.method === 'GET') {
      const isConfigured = typeof configured === 'function' ? configured() : configured;
      return json({ configured: Boolean(isConfigured), preview: true, liveResearch: false }, 200, headers);
    }
    const preview = path === '/preview/chat';
    if (!(path === '/chat' || preview) || request.method !== 'POST') return failure('NOT_FOUND', 'Not found.', 404, headers);

    const now = Date.now();
    for (const [key, bucket] of ingressBuckets) if (now - bucket.start >= WINDOW_MS) ingressBuckets.delete(key);
    const ip = clientIp(request);
    if (ingressBuckets.size >= MAP_LIMIT && !ingressBuckets.has(ip)) return failure('BUSY', 'Please retry shortly.', 429, headers);
    const ingress = ingressBuckets.get(ip) || { start: now, count: 0 };
    if (ingress.count >= 60) return failure('RATE_LIMITED', 'Please wait before making another request.', 429, { ...Object.fromEntries(headers), 'retry-after': '30' });
    ingress.count++;
    ingressBuckets.set(ip, ingress);

    let uid: string;
    if (preview) uid = `preview:${ip}`;
    else {
      const authorization = request.headers.get('authorization') || '';
      if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) return failure('UNAUTHORIZED', 'Sign in to use personalized coaching.', 401, headers);
      try { uid = await verifyToken(authorization.slice(7)); }
      catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499, headers });
        if (error instanceof CoachError) return failure(error.code, error.message, error.status, headers);
        return failure('UNAUTHORIZED', 'Your session expired. Sign in again to use the coach.', 401, headers);
      }
    }
    if (typeof uid !== 'string' || !uid || uid.length > 128) return failure('UNAUTHORIZED', 'Your session expired. Sign in again to use the coach.', 401, headers);
    if (request.signal.aborted) return new Response(null, { status: 499, headers });

    let raw: unknown;
    try { raw = await readJson(request); }
    catch (error) {
      if (request.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return new Response(null, { status: 499, headers });
      if (error instanceof CoachError) return failure(error.code, error.message, error.status, headers);
      return failure('INVALID_JSON', 'The request body must contain valid JSON.', 400, headers);
    }
    let parsed;
    try { parsed = chatRequestSchema.parse(raw); }
    catch (error) {
      if (error instanceof z.ZodError) return failure('INVALID_DATA', 'The request contained invalid data.', 422, headers);
      return failure('INVALID_DATA', 'The request contained invalid data.', 422, headers);
    }

    const timestamp = Date.now();
    for (const [key, bucket] of userBuckets) if (!bucket.active && timestamp - bucket.start >= WINDOW_MS) userBuckets.delete(key);
    if (userBuckets.size >= MAP_LIMIT && !userBuckets.has(uid)) return failure('BUSY', 'The coach is busy. Please retry shortly.', 429, headers);
    let bucket = userBuckets.get(uid);
    if (!bucket) { bucket = { start: timestamp, count: 0, active: 0 }; userBuckets.set(uid, bucket); }
    if (timestamp - bucket.start >= WINDOW_MS) { bucket.start = timestamp; bucket.count = 0; }
    const userLimit = preview ? 60 : 12;
    if (bucket.count >= userLimit || bucket.active >= 2 || totalActive >= 10) {
      return failure('RATE_LIMITED', 'Please wait a moment before asking again.', 429, { ...Object.fromEntries(headers), 'retry-after': '30' });
    }
    bucket.count++; bucket.active++; totalActive++;
    try {
      if (request.signal.aborted) return new Response(null, { status: 499, headers });
      const result = preview ? await runPreviewCoach(parsed) : await runCoach(parsed, provider, request.signal);
      if (request.signal.aborted) return new Response(null, { status: 499, headers });
      return json(result, 200, headers);
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499, headers });
      if (error instanceof z.ZodError) return failure('INVALID_DATA', 'The request or generated plan contained invalid data. Nothing has changed.', 422, headers);
      if (error instanceof CoachError) return failure(error.code, error.message, error.status, headers);
      if ((error as { status?: number })?.status === 429) return failure('PROVIDER_RATE_LIMITED', 'The AI service is busy. Wait a moment and retry.', 429, headers);
      return failure('AI_UNAVAILABLE', 'The coach could not complete this request. Nothing has changed. Please retry.', 503, headers);
    } finally {
      bucket.active = Math.max(0, bucket.active - 1);
      totalActive = Math.max(0, totalActive - 1);
    }
  };
  return handler;
}
