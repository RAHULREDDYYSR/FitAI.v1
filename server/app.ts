import express from 'express';
import { createAIRouter } from '../routes/ai';

// Shared by the local Node server and the deployed Firebase HTTP function.
export function createAPIApp(options: Parameters<typeof createAIRouter>[0] = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Cloud Functions parses JSON before Express; enforce the same cap there.
  app.use((req, res, next) => {
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (rawBody && rawBody.length > 256 * 1024) {
      res.status(413).json({ error: 'Invalid or oversized request body.' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/ai', createAIRouter(options));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid or oversized request body.' });
  });
  return app;
}
