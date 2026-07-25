// Voice-doc discussion module (DOCV-01) — the flagship "talk to your report" flow.
//
// LANE OWNERSHIP: Lane C (`lane-c/voice-doc`). Created empty in the Wave-0 freeze commit (14-01)
// so every later plan fills in THIS file instead of editing a shared one. Plans 14-03 and 14-05
// own its contents; 14-04 mints against it from `voiceToken.ts`.
//
// DEFAULT-runtime (V8) module — NO `"use node"` directive. `llm.ts` is the ONE node module, and a
// second one re-triggers the TypeScript `internal`-graph circular-inference cliff documented at
// `vaultLlm.ts:2-7` (it collapses the whole generated API to `any`/`{}`). To stay clear of that
// cliff every handler added here carries an EXPLICIT `Promise<...>` return type — never an
// inferred one (Pitfall 9, the same mitigation `evaluations.ts` and `proactiveReview.ts` use).
//
// Conventions this module must hold as it fills in:
//   - CLAUDE.md §2: no raw `query`/`mutation`/`action` imports — use the tenant-scoped wrappers
//     from `./lib/functions.ts`.
//   - CLAUDE.md §1: the pure literals (framework, thread id, tool shape, char caps) live in
//     `@pikar/voice`'s `docSession.ts`. Do not re-declare one here.
//   - CLAUDE.md §4: retrieval/review audit payloads carry refs, hashes and counts ONLY. A
//     `citationExcerpt` is verbatim report content — legal in `evaluations.findings[]` and in the
//     memo body, ILLEGAL in every `audit` / `deadLetters` / `telemetry` payload and in
//     `agentSteps`. Plan 14-09 pins that with a mutation-verified static scan.
//
// A Convex module with zero exports is valid; that is what keeps this freeze commit inert.
