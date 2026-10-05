// Node deployments and Deno/Supabase use the same server-only configuration.
export function serverEnv(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
  if (runtime.Deno) return runtime.Deno.env.get(name);
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}
