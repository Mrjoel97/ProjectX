---
status: resolved
trigger: "Immediately after the finalized production deployment, loading the production web app throws a client-side module-evaluation error: \"Uncaught Error: Provided address was not an absolute URL.\" Trace begins in hashed chunks new X at 0kc1c9x60yeky.js:2:54971, module evaluation at 3_vqa4emnrlqm.js:1:11501. Identify the exact constructor and environment value, prove root cause, and implement a minimal fix only if confirmed. Do not deploy or modify external state."
created: 2026-08-13T02:50:24.1767083+03:00
updated: 2026-08-13T03:31:00+03:00
---

## Current Focus

hypothesis: Confirmed and resolved — Vercel encrypted-variable pull semantics produced an empty build-time client URL; the value is now non-sensitive and the release gate rejects empty or non-HTTPS values.
test: Completed CI, guarded production release, clean browser load, console inspection, and deployed bundle scan.
expecting: Production initializes without the absolute-URL exception and its provider chunk embeds the real Convex URL rather than an empty constructor argument.
next_action: None; archive the resolved debug session.

## Symptoms

expected: https://www.pikar-ai.com loads the application normally and authentication initializes.
actual: Browser throws during JS module evaluation and the application fails to initialize.
errors: Uncaught Error: Provided address was not an absolute URL. at new X (0kc1c9x60yeky.js:2:54971) at module evaluation (3_vqa4emnrlqm.js:1:11501), followed by Turbopack frames.
reproduction: Load the newly deployed production site in a browser.
started: Reported immediately after production deployment SHA 6b08c5231fa34f0ea4cd3e58c6fda6e730796f01 completed successfully.

## Eliminated

## Evidence

- timestamp: 2026-08-13T02:55:41+03:00
  checked: Repository state and deployment SHA
  found: The shared worktree is heavily dirty; local HEAD is 5c06b33cdaa79bc3ed9ffb8625367f0243d9341f while the reported deployment SHA is origin/main merge commit 6b08c5231fa34f0ea4cd3e58c6fda6e730796f01.
  implication: Preserve all unrelated changes and compare production evidence against the reported deployment commit rather than assuming local HEAD equals production.

- timestamp: 2026-08-13T02:55:41+03:00
  checked: Exact error literal in installed dependencies
  found: Convex 1.42.1 contains the exact literal "Provided address was not an absolute URL." in src/react/client.ts and src/browser/sync/client.ts; no application source contains it.
  implication: The `new X` stack frame is a minified Convex client constructor, not an application-defined error.

- timestamp: 2026-08-13T02:55:41+03:00
  checked: apps/web/app/providers.tsx
  found: Client module scope executes `new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)` before Providers renders.
  implication: A malformed build-time NEXT_PUBLIC_CONVEX_URL deterministically aborts client module evaluation and matches the reported timing and Turbopack frame.

- timestamp: 2026-08-13T03:06:18+03:00
  checked: Public production HTML and the two exact reported chunks
  found: HTML maps Providers to `3_vqa4emnrlqm.js` and Convex to `0kc1c9x60yeky.js`. Providers module 45744 contains `new ... ConvexReactClient("")`.
  implication: The exact production build-time NEXT_PUBLIC_CONVEX_URL value was the empty string; this is direct artifact evidence, not an inference from local configuration.

- timestamp: 2026-08-13T03:06:18+03:00
  checked: ConvexReactClient 1.42.1 constructor implementation
  found: Undefined throws a distinct "No address provided" error; non-string throws a type error; a string without `://`, including the production empty string, throws the exact reported "Provided address was not an absolute URL." literal.
  implication: The production error uniquely selects the string-without-scheme branch and the artifact identifies that string as empty.

- timestamp: 2026-08-13T03:06:18+03:00
  checked: .github/workflows/deploy-production.yml at the deployed SHA
  found: After `vercel pull`, the validator checks only whether a line begins `NEXT_PUBLIC_CONVEX_URL=`. A Vercel dotenv line `NEXT_PUBLIC_CONVEX_URL=""` passes this grep, then `vercel build --prod` embeds the empty string.
  implication: The release gate verified key presence but not its value, allowing a deterministically broken client artifact to be uploaded and promoted.

- timestamp: 2026-08-13T03:18:42+03:00
  checked: Direct ConvexReactClient constructor controls
  found: Empty string reproduced the exact production error; undefined produced the distinct missing-address error; `https://example.convex.cloud` constructed successfully.
  implication: Competing missing-value and unrelated-constructor hypotheses are ruled out; the embedded empty string is causal.

- timestamp: 2026-08-13T03:18:42+03:00
  checked: Revised release validation against quoted dotenv fixtures
  found: The gate rejected empty NEXT_PUBLIC_CONVEX_URL, rejected a host-only relative value, accepted an absolute HTTPS value, and rejected a missing required secret.
  implication: The minimal workflow fix blocks the exact failure mode and preserves valid releases.

- timestamp: 2026-08-13T03:18:42+03:00
  checked: Static verification
  found: Python parsed deploy-production.yml successfully and `git diff --check` passed for both changed files.
  implication: The workflow edit is syntactically valid YAML and contains no whitespace errors.

- timestamp: 2026-08-13T03:31:00+03:00
  checked: Vercel production environment correction
  found: The operator established that encrypted Vercel variables pull as empty for this prebuilt workflow and recreated NEXT_PUBLIC_CONVEX_URL with `--no-sensitive` as `https://opulent-octopus-494.convex.cloud`.
  implication: This explains why a configured-looking Vercel key became `""` specifically during the local `vercel build --prod`; the build now receives the real public endpoint.

- timestamp: 2026-08-13T03:31:00+03:00
  checked: Guard integration and release pipeline
  found: The workflow guard merged in PR #7 at SHA 311ddf70; main CI run 31653310021 passed; production run 31653512312 attempt 2 passed every gate.
  implication: The prevention fix is integrated and the corrected configuration successfully traversed the complete production release process.

- timestamp: 2026-08-13T03:31:00+03:00
  checked: Clean production browser verification
  found: Playwright loaded https://www.pikar-ai.com successfully. The console contained only an unrelated favicon.ico 404 and no absolute-URL exception.
  implication: The original module-evaluation failure no longer reproduces in the real production workflow.

- timestamp: 2026-08-13T03:31:00+03:00
  checked: Deployed client bundle
  found: Chunk `1lfnoh4c5g-us.js` contains the production Convex URL and contains no empty ConvexReactClient constructor argument.
  implication: Artifact inspection verifies the causal build input changed exactly as predicted by the root-cause model.

## Resolution

root_cause: NEXT_PUBLIC_CONVEX_URL was stored as an encrypted/sensitive Vercel production variable, whose value pulled as empty into the local prebuilt release environment. The workflow's presence-only grep accepted `NEXT_PUBLIC_CONVEX_URL=""`, and `vercel build --prod` embedded that empty string. apps/web/app/providers.tsx then evaluated `new ConvexReactClient("")`; Convex 1.42.1 requires `://` and threw the exact runtime error before application initialization.
fix: Recreated the public Convex URL as a non-sensitive Vercel production variable with value `https://opulent-octopus-494.convex.cloud`. Updated the production workflow to load pulled dotenv values, reject empty required values, and require NEXT_PUBLIC_CONVEX_URL to be an absolute HTTPS URL before build/upload; merged through PR #7 at SHA 311ddf70.
verification: Constructor controls reproduced the exact error only for the empty string. Validation fixtures rejected empty/relative/missing values and accepted HTTPS. Main CI run 31653310021 and production run 31653512312 attempt 2 passed. Clean Playwright production load succeeded with no absolute-URL error, and deployed chunk 1lfnoh4c5g-us.js contains the real production Convex URL with no empty constructor argument.
files_changed: [.github/workflows/deploy-production.yml]
