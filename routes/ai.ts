import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { CoachError, runCoach, runPreviewCoach, type DecisionProvider } from '../server/coach';
import { openAIProvider, isAIConfigured } from '../server/openai';
import { createTokenVerifier } from '../server/auth';
import firebaseConfig from '../firebase-applet-config.json';

export function createAIRouter(options: { verifyToken?: (token: string) => Promise<string>; provider?: DecisionProvider } = {}) {
  const router = Router();
  const verifyToken = options.verifyToken || createTokenVerifier(firebaseConfig.projectId);
  const provider = options.provider || openAIProvider;
  const buckets = new Map<string, { start: number; count: number; active: number }>();
  const authBuckets = new Map<string, { start: number; count: number }>();
  let totalActive = 0;
  router.get('/status', (_req, res) => res.json({ configured: isAIConfigured(), preview: true, liveResearch: false }));
  const limited: RequestHandler = async (req, res, next) => {
    try {
      let uid: string;
      // Bound unauthenticated work before token verification or outbound key fetches.
      const current = Date.now();
      for (const [key, bucket] of authBuckets) if (current - bucket.start >= 60000) authBuckets.delete(key);
      const ip = req.ip || 'unknown';
      if (authBuckets.size >= 10000 && !authBuckets.has(ip)) throw new CoachError('BUSY', 'Please retry shortly.', 429);
      const ingress = authBuckets.get(ip) || { start: current, count: 0 };
      if (ingress.count >= 60) throw new CoachError('RATE_LIMITED', 'Please wait a moment before asking again.', 429);
      ingress.count++; authBuckets.set(ip, ingress);
      if (req.path.startsWith('/preview/')) uid = 'preview:' + req.ip;
      else {
        const header = req.get('authorization') || '';
        if (!header.startsWith('Bearer ')) throw new CoachError('UNAUTHORIZED', 'Sign in to use personalized coaching.', 401);
        uid = await verifyToken(header.slice(7));
      }
      if (req.aborted || res.destroyed) return;
      const now = Date.now();
      for (const [key, bucket] of buckets) if (!bucket.active && now - bucket.start > 60000) buckets.delete(key);
      if (buckets.size >= 10000 && !buckets.has(uid)) throw new CoachError('BUSY', 'The coach is busy. Please retry shortly.', 429);
      let bucket = buckets.get(uid);
      if (!bucket) { bucket = { start: now, count: 0, active: 0 }; buckets.set(uid, bucket); }
      if (now - bucket.start >= 60000) { bucket.start = now; bucket.count = 0; }
      if (bucket.count >= (uid.startsWith('preview:') ? 60 : 12) || bucket.active >= 2 || totalActive >= 10) {
        res.setHeader('Retry-After', '30');
        throw new CoachError('RATE_LIMITED', 'Please wait a moment before asking again.', 429);
      }
      bucket.count++; bucket.active++; totalActive++;
      let released = false;
      const release = () => { if (!released) { released = true; bucket!.active--; totalActive--; } };
      res.once('finish', release); res.once('close', release);
      next();
    } catch (error) { next(error); }
  };
  router.post('/preview/chat', limited, async (req, res, next) => {
    try { res.json(await runPreviewCoach(req.body)); } catch (e) { next(e); }
  });
  router.post('/chat', limited, async (req, res, next) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    if (req.aborted || res.destroyed) controller.abort();
    try { res.json(await runCoach(req.body, provider, controller.signal)); } catch (e) { if (!controller.signal.aborted) next(e); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  });
  router.use((error: any, _req: any, res: any, _next: any) => {
    if (error instanceof z.ZodError) return res.status(422).json({ code: 'INVALID_DATA', error: 'The request or generated plan contained invalid data. Nothing has changed. Try a smaller, more specific request.' });
    if (error instanceof CoachError) return res.status(error.status).json({ code: error.code, error: error.message });
    const status = error.status === 429 ? 429 : 503;
    res.status(status).json({ code: status === 429 ? 'PROVIDER_RATE_LIMITED' : 'AI_UNAVAILABLE', error: status === 429 ? 'The AI service is busy. Wait a moment and retry.' : 'The coach could not complete this request. Nothing has changed. Please retry.' });
  });
  return router;
}
