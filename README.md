# FitAI

A React training workspace with workout logging, saved routines, progress charts, and a coach that proposes changes for review.

## Run locally

Use Node.js 24.5+ (the cloud environment has 24.19.0).

```sh
npm ci
NODE_USE_ENV_PROXY=1 npm run dev
```

The Express server serves the app and `/api/ai/*` on port 3000. Development watches server code and uses Vite for frontend updates. Choose **Explore sample workspace** to try the interface without signing in. Sample data and changes stay in browser storage; sample responses do not call a model. Google sign-in uses the existing Firebase project in `firebase-applet-config.json`.

For real AI replies, securely configure `FITAI_OPENAI_API_KEY` for `api.openai.com` in cloud environment settings, or put it in an ignored `.env.local` on an unmanaged machine. Never commit it, prefix it with `VITE_`, or expose it through Vite configuration. A ChatGPT/Codex subscription does not provide an application API credential. `OPENAI_API_KEY` is also supported on unmanaged machines; managed cloud bindings should use the non-reserved `FITAI_OPENAI_API_KEY` name.

`FITAI_COACH_MODEL` defaults to the low-cost `gpt-5-nano`. It can be changed server-side to a model supporting structured outputs. We do not rely on the internal model names available only to Codex agents. `NODE_USE_ENV_PROXY=1` lets Node's native fetch use the platform HTTPS proxy with TLS verification intact. On machines without a proxy, it is harmless.

## How the coach works

- Common library, profile, and history questions are rendered directly from supplied saved data. Templates and performed sessions are kept distinct, and recent history is not presented as an all-time total.
- A single model decision handles coaching, planning, or targeted edits, with at most one repair for invalid output. There are no recursive tool loops or paid conversation-summary calls.
- Exercise IDs, routine targets, values, new working loads, and ambiguous routine names are validated. The model proposes operations against individual exercises, so an edit does not regenerate the rest of a routine. Existing notes and legacy exercise/set metadata survive edits.
- Every create, edit, delete, or profile change gets an explicit preview. Chat messages such as “approve,” “save it later,” or “do not approve” never execute writes.
- Applying a chat preview uses a Firestore transaction: check ownership, the current conversation proposal, its expiry, and the original data; write the change and an immutable receipt together. Duplicate application returns the existing receipt. Stale previews fail rather than overwrite newer edits. This uses the existing Firestore rules and conversation/message paths. Goal suggestions in Profile also check ownership and the original profile in a transaction before changing the reviewed goal.
- API calls require signed Firebase ID tokens. The server verifies signature, project audience, issuer, expiry and timestamps. Requests and model concurrency are bounded; canceled requests cancel model work; failures do not claim success.
- There is no live web search or fabricated citation feature. General guidance is labeled accordingly. Voice dictation uses the browser's speech-recognition capability where supported, without an app transcription API key.

The server validates against the authenticated caller's supplied context; it does not use an admin credential to load Firestore data. The final write is checked against the real Firestore snapshot in a transaction. General coaching language can still be imperfect; validation tests do not establish that a model never hallucinates.

## Checks

```sh
npm run lint             # TypeScript
npm test                 # Deterministic regression and HTTP/auth tests
npm run build            # Production frontend
python3 tests/ui-smoke.py # Running server, Python Playwright, /usr/bin/chromium
NODE_USE_ENV_PROXY=1 npm run eval:agents # Four actual model evals; needs API credential
```

The browser smoke exercises desktop and mobile layouts, facts, a draft/edit/apply sequence, negative approval, preservation of untouched exercises, discard, goal previews and reload persistence in the sample workspace. It performs no real-account database writes. The optional live suite verifies that each case actually calls the model and fails on upstream/auth/network errors; cases skipped for missing credentials are not passes. See [AI evaluation notes](docs/AI_EVALUATION.md).

## Production and integrations

For a backend on Supabase's free plan, use [Supabase deployment instructions](docs/SUPABASE_DEPLOYMENT.md). This retains Firebase Auth and Firestore while moving only the coach API to an Edge Function. Build the frontend with the public `VITE_COACH_API_URL`, then use `npm run deploy:hosting` to publish Hosting alone. Google Cloud Functions and Secret Manager are not used by that path; OpenAI API usage remains separate.

Build and run the Node server to retain the AI API:

```sh
npm run build
NODE_ENV=production NODE_USE_ENV_PROXY=1 npm start
```

Firebase Hosting serves the frontend and forwards `/api/**` to the second-generation `fitaiApi` function in `us-central1`. The separate `firebase-api/` codebase bundles the same API used by the local server; the older `functions/` tracing codebase is preserved. Deployment requires a Firebase login with access to the configured project, the Blaze plan, and a Secret Manager value named `FITAI_OPENAI_API_KEY`. A cloud workspace secret does not automatically create the production Functions secret.

From an authenticated machine, set the production secret securely and deploy:

```sh
npx --yes firebase-tools@latest functions:secrets:set FITAI_OPENAI_API_KEY --project gen-lang-client-0375724084
npm run deploy:firebase
```

The deploy command validates the frontend and regression suite; the Functions predeploy hook installs, checks and builds the API package. It deploys only the `fitai-api` codebase and Hosting, preserving existing Firestore rules. See [API deployment instructions](firebase-api/README.md). After deployment, verify `/api/health`, `/api/ai/status`, and a signed-in draft/apply workflow on the actual Hosting URL. Neither local tests nor a successful build establish deployment success.

Real Google sign-in needs Firebase's authorized-domain configuration. Cloud networking must allow the Firebase/Google destinations plus `api.openai.com`; review and save the environment draft before publishing. Secret requirements in a saved draft do not supply a value or apply network changes. Google Sheets is an optional signed-in integration. The optional `functions/` LangSmith proxy has its own Node 20 runtime and is not required by the local coaching workflow. Historical scripts under `scripts/` that patch application files are not setup commands.
