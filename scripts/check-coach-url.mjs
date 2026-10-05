import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
const base = process.env.VITE_COACH_API_URL;
if (!base) throw new Error('Set VITE_COACH_API_URL to your deployed Supabase function URL before deploying Hosting.');
const url = new URL(base);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('VITE_COACH_API_URL must be a public HTTPS URL without credentials or query parameters.');
console.log('External coach API URL is configured.');
