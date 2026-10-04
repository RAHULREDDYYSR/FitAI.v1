import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createAPIApp } from '../server/app';

const openAIKey = defineSecret('FITAI_OPENAI_API_KEY');
const app = createAPIApp();

export const fitaiApi = onRequest({
  invoker: 'public',
  region: 'us-central1',
  secrets: [openAIKey],
  timeoutSeconds: 120,
  memory: '256MiB',
  concurrency: 10,
  maxInstances: 2,
}, app);
