# FitAI API on Firebase Functions

This codebase serves the existing Express AI API as the second-generation HTTP function `fitaiApi` in `us-central1`. Firebase Hosting forwards `/api/**` to that function and serves the built SPA for other paths.

The function has public invocation so Firebase Hosting can reach it. Personalized coach routes still require a verified Firebase ID token, as enforced by the shared API router.

## Prerequisites

- Firebase CLI installed and authenticated
- A Firebase project selected with `firebase use <project-id>`
- The project on the Blaze plan with Cloud Functions and Secret Manager enabled
- Node.js 22 and npm

## Configure the OpenAI key

Set the Functions secret interactively so its value is not written into the repository:

```sh
firebase functions:secrets:set FITAI_OPENAI_API_KEY
```

The function uses the existing provider and defaults to `gpt-5-nano`. The secret is only bound to the function at runtime.

## Build and deploy

Install dependencies and build the bundled CommonJS entry point:

```sh
npm --prefix firebase-api ci
npm --prefix firebase-api run build
npm run build
```

Deploy the `fitai-api` Functions codebase and Hosting configuration:

```sh
firebase deploy --only functions:fitai-api,hosting
```

The `firebase.json` predeploy hook runs `npm ci` and rebuilds the API bundle. Deploy Hosting after the frontend build so `dist/` exists.

## Local API build

`npm --prefix firebase-api run build` bundles project TypeScript modules and the exercise catalog into `firebase-api/lib/index.cjs`, while leaving npm packages external for Cloud Functions to install from `package-lock.json`.
