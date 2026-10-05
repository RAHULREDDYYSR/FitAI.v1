export function resolveCoachEndpoint(path: string, configuredBase = ''): string {
  const base = configuredBase.trim().replace(/\/+$/, '');
  if (!base) return `/api/ai/${path}`;
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('The coach API must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid coach API URL.');
  return `${base}/${path}`;
}

export const coachEndpoint = (path: string) => resolveCoachEndpoint(path, import.meta.env.VITE_COACH_API_URL || '');
