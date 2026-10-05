import 'openai/shims/web';
import { createEdgeHandler } from '../server/edge';
import { serverEnv } from '../server/env';

declare const Deno: { serve(handler: (request: Request) => Promise<Response>): unknown };

const allowedOrigins = (serverEnv('FITAI_ALLOWED_ORIGINS') ||
  'https://gen-lang-client-0375724084.web.app,https://gen-lang-client-0375724084.firebaseapp.com,http://localhost:3000')
  .split(',').map(origin => origin.trim()).filter(Boolean);

Deno.serve(createEdgeHandler({ allowedOrigins }));
