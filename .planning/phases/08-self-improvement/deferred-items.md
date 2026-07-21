# Phase 8 — Deferred / Out-of-Scope Items

Discovered during execution, NOT fixed (pre-existing or out of the touching plan's scope).

## 08-01

- **Pre-existing tsc error** `convex/lib/functions.ts(25,3): error TS2322: Type 'string | undefined' is not assignable to type 'string'`.
  Present on base commit (verified by stashing the schema.ts change — the error stands alone). Unrelated to the additive Phase-8 schema additions (feedback / optimizerConfig / plans.skillVersion / requests.skillVersion), which introduce zero new source errors. Not this plan's scope.
