import { build } from 'esbuild';

await build({
  entryPoints: ['supabase/entry.ts'],
  outfile: 'supabase/functions/fitai-api/index.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  external: ['node:crypto', 'node:buffer'],
  logLevel: 'info',
});
