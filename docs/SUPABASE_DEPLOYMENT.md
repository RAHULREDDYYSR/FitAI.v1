# Supabase backend with Firebase Hosting

This option runs the coach API in a Supabase Edge Function. Firebase Hosting serves the frontend, and Firebase Auth/Firestore continue to manage accounts and saved data. It does not deploy Google Cloud Functions or use Google Secret Manager. Supabase's free-plan allowances apply; project pausing and quota limits can affect availability. OpenAI usage is still billed separately.

## Create and connect a project

Create a project in a **Free** organization at https://supabase.com/dashboard. Keep its database password private. Copy the public project URL from its project settings; the part before `.supabase.co` is the project reference.

From the repository root, replace `YOUR_PROJECT_REF` below with that reference:

```sh
git pull --ff-only origin main
npm ci
npx --yes supabase@latest login
```

No database migration or Supabase database password is needed by this API.

## Set server credentials

The existing root `.env` can contain `OPENAI_API_KEY`; the server also accepts `FITAI_OPENAI_API_KEY`. Both are server-only. Upload a file containing only the server variables you intend to store:

```sh
npx --yes supabase@latest secrets set --env-file .env --project-ref YOUR_PROJECT_REF
```

Alternatively, set `FITAI_OPENAI_API_KEY` through the project's Edge Function secrets dashboard. Do not paste credentials into chat, a public frontend variable, or Git. For a custom frontend domain, set `FITAI_ALLOWED_ORIGINS` to its exact origin along with any other allowed sites, separated by commas. Default origins are the existing Firebase `web.app`/`firebaseapp.com` sites and `http://localhost:3000`.

## Deploy the backend and frontend

```sh
npm run deploy:supabase -- --project-ref YOUR_PROJECT_REF

export VITE_COACH_API_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/fitai-api"
npm run deploy:hosting
```

`deploy:supabase` validates and bundles the existing coach code into the function, then uploads it with API bundling; Docker is not required. `deploy:hosting` builds the frontend with its public backend URL and deploys only Hosting using `firebase.hosting-only.json`. It requires your normal Firebase Hosting login and project access. The Google Functions/Secret Manager billing requirement is avoided. An existing project suspended because of billing or other account issues may still require those issues to be resolved for Hosting itself.

`VITE_COACH_API_URL` is a public URL, not a credential. Keep it in an ignored `.env.local` if you want it to persist across builds. Leave it empty when using the local Node server. If an invalid URL is configured, the deployment check stops before publishing.

## Verify the deployment

```sh
curl "https://YOUR_PROJECT_REF.supabase.co/functions/v1/fitai-api/health"
curl "https://YOUR_PROJECT_REF.supabase.co/functions/v1/fitai-api/status"
```

Expect `{"status":"ok"}` and `"configured":true`. Verify a signed-in chat, then preview and explicitly apply a routine change on the deployed frontend. Sample previews do not establish real model quality or real Firestore transaction execution.

The gateway's Supabase JWT check is disabled in `supabase/config.toml` because the function verifies **Firebase** ID tokens itself. Personalized chat still rejects missing or invalid tokens before a model call. Health/status and the template sample endpoint are public. Do not remove the Firebase verifier. CORS allows exact configured origins, and HTTP bodies are capped at 256 KiB. Rate and concurrency limits are local to each edge isolate; they do not constitute an account-wide spending cap.

## Local validation

```sh
npm run lint
npm test
npm run build:supabase
npx --yes deno@2 run --allow-env --allow-read tests/deno-edge-smoke.mjs
```

The Deno smoke executes the actual generated deployment bundle with fixture signing keys and a fixture OpenAI response. It checks runtime compatibility, RSA verification, CORS, and the SDK's structured-output request. It does not spend tokens or claim a successful remote deployment.
