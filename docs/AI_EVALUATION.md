# AI evaluation notes

## Reproduced baseline failures

The original client-side functions were exercised with the existing code before replacement:

| Input | Original behavior | New behavior |
|---|---|---|
| `do not approve` | Approval regex returned `true` | Chat never commits; use the explicit preview button |
| `not yet, save it later` | Approval regex returned `true` | No write from chat text |
| `yes? can you explain it first` | Approval regex returned `true` | No write from chat text |
| Unknown exercise ID/name, `weight: -30`, `reps: -5` | Normalization retained invented exercise and invalid values | Schema/catalog validation rejects the proposal |
| Unknown routine ID in an update | Client used `setDoc(..., {merge:true})`, which can create a new document | Target must exist in supplied context and the actual apply-time transaction |
| Delete/update tool call | Executed immediately; later prose could claim success even for unsuccessful deletion results | Validated preview; successful persistence generates the completion message |

The previous graph also made multiple routing/tool/synthesis calls, guessed working loads from body weight, embedded API keys in the browser, and used unconstrained summarization as memory. Those mechanisms were removed.

## Deterministic evidence

`npm test` tests the actual decision resolver and schema, HTTP router, JWT signature verification, cancellation, metadata merging, and sample persistence. Cases cover invented identifiers/fields, negative values, grounded loads, ambiguous names, partial edits (including timed/unchanged sets), invalid completion claims and links, the one-repair limit, templates versus logs, stale/expired proposals, authentication failures, throttling/error redaction, key-rotation cooldowns, client-abort propagation, and idempotent application.

`tests/ui-smoke.py` runs the actual frontend and public sample endpoint in Chromium on desktop/mobile. It confirms that previewing and negative approval do not change data, that explicit application changes only the reviewed exercise, and that changes survive reload. It also exercises discard, progress loading and goal previews. Sample responses are templates and clearly labeled, so this is not evidence of live model quality or real Firebase transaction execution.

## Live evaluation

`npm run eval:agents` has four credential-gated cases: missing personal-record facts, precise partial edits, unsupported new loads, and adversarial requests for fake sources/completion claims. Each enabled case verifies that the configured model was called. Missing credentials produce skipped tests. Authentication, network, timeout, and provider failures cannot count as passes.

No application API credential was available during this change, so no real-model evaluations ran. Real signed-in Firebase reads/writes were also not exercised. Enable the server-only credential and network settings, then run the live suite and a signed-in create/edit/delete workflow to validate those integrations.

## Practical limits

General model-written coaching advice still needs human judgment; deterministic guardrails cover specific failure modes, not all possible factual errors. Common personal facts use deterministic renderers, and free-form answers to personal-history/statistics questions fall back to clarification. Source URLs and model completion claims are rejected. The API works from caller-supplied context, while the database transaction independently verifies ownership and the fresh saved state. Limits are process-local; a multi-instance production deployment should share rate/concurrency accounting through its gateway or datastore.
