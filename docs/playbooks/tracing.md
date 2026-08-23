# Playbook: LLM Tracing (Foglamp)

> Last verified: 2026-08-22 against `01254a1`
> Build history: none (added outside a phase, on owner request) · Related ADRs: none

## Purpose

Every model call the product makes is emitted to [Foglamp](https://foglamp.dev) as a trace, so an
agent turn can be inspected after the fact — which agent ran, on which model, with which tools, in
which conversation, and what it cost. This is observability only: it changes no behaviour, gates
nothing, and is a silent no-op when `FOGLAMP_API_KEY` is unset.

## Key files

- `packages/backend/convex/lib/foglamp.ts` — the ONE `fog` instance. Exports `fogIntegration()`
  (per-call binding), `traced()` (ambient binding + drain), `flushTelemetry()`.
- `packages/backend/convex/llm.ts` — 16 instrumented call sites; `traced()` at `runCockpitAgent`
  and at the offline script harness.
- `packages/backend/convex/dispatch.ts` — `traced()` at `runSpecialist`, `runResearch`, `runMedia`
  and the offline script harness. No call sites of its own (it holds no `generateText`, by design).
- `packages/backend/convex/intake.ts`, `packages/backend/convex/vaultExtract.ts` — one
  `attachment-extractor` call site each.

## Dependencies & blast radius

- `foglamp@0.9.0` — **pinned EXACT, no caret** (CLAUDE.md §6: it is pre-1.0, so a `^` would let
  a minor bump change the `telemetry.integrations` contract under us). Peer on `ai` (this repo:
  `7.0.20` → the **v7** `telemetry.integrations` path, NOT the `wrap()` path used for v4–v6).
- `FOGLAMP_API_KEY` in the Convex **deployment** env for real traces (`.env` locally).
- No schema, no table, no cron, no scheduler edge. Nothing in the governed pipeline depends on it.

## Data flow

1. A node-runtime action begins an agent turn.
2. For a *known* agent, the call site passes `telemetry: { integrations: [fogIntegration({...})] }`.
3. For the *shared* loop (`runAgentLoop`, used by the cockpit AND all five specialists) the caller
   instead wraps with `traced({ agentName: "…" }, …)`; ambient context layers UNDER the call site's
   own `traceName: "agent-loop"`, so the agent identity comes from the caller.
4. `traced()` drains via `fog.flush()` in a `finally` when the turn ends, success or throw.

## Invariants — what must never break

1. **Only `"use node"` modules may import `lib/foglamp.ts`.** The `foglamp` entry statically
   imports `node:async_hooks`, which the Convex V8 runtime does not provide. Violating this is a
   deploy-time bundle error, not a caught exception. *Not enforced by a test — see gaps.*
2. **The instance is constructed lazily, never at module load.** `foglamp()` arms a background
   flush `setInterval` that calls `globalThis.fetch`; convex-test globs EVERY module under
   `convex/` into EVERY test file, so eager construction arms that timer in all 95 suites and
   breaks any test asserting a path issues no fetch. Enforced by `media.test.ts`
   ("never buys a sandbox"), which fails with a phantom fetch if this regresses.
3. **`agentName` / `traceName` / `workflowName` are static string literals at the call site.**
   Never a variable, template literal or concatenation — dynamic values explode trace cardinality
   and belong in `metadata`, `workflowRunId` or `sessionId`. Enforced at the type level by
   `IntegrationInput` only for *presence*, not staticness. *Staticness is unenforced — see gaps.*
4. **Telemetry never fails a governed action.** `flushTelemetry()` swallows; `traced()` only adds a
   `finally`. A dropped span is always preferable to a dead-lettered request.
5. **No payload content leaves the process.** Trace context carries names, ids and counts only —
   the same refs-only discipline as CLAUDE.md §4. Never put draft bodies, prompts, recipient
   addresses or document text into `metadata`.

## How to change safely

- **Adding a model call in a node module** → add `telemetry: { integrations: [fogIntegration({
  agentName: "…" })] }` with a literal name, and reuse an existing agent name if it is the same
  behaviour.
- **Adding a model call in a V8 module** → you cannot trace it. Either leave it untraced (and say
  so here) or move the call into a node action. Do NOT add `"use node"` to a module holding
  queries/mutations — that is structurally illegal in Convex, not merely discouraged.
- **Adding a specialist** → wrap its entry action in `traced()` with a new literal `agentName`;
  do not touch the shared `runAgentLoop` call site.

## How to verify

- `pnpm --filter @pikar/backend typecheck` — proves the `telemetry` option and `IntegrationInput`
  identity rule (exactly one of `traceName`/`agentName`; `workflowName`/`workflowRunId` both-or-
  neither) are satisfied at every site.
- `cd packages/backend && npx vitest run` — 2336 tests; guards invariant 2 in particular. Baseline
  before and after any change here: an eager-construction regression shows up as ONE failure in
  `media.test.ts` and nowhere else.
- Real traces: trigger a genuine flow (a cockpit turn at `/dashboard/workspace`) with
  `FOGLAMP_API_KEY` set on the deployment, then look at the Foglamp dashboard. There is deliberately
  no smoke script — a synthetic trace proves the SDK works, not that the product is wired.

## Operational notes

- `FOGLAMP_API_KEY` must be set with `npx convex env set` on the deployment; `.env` only covers
  local tooling. Vitest does not load `.env`, so tests are always keyless (and therefore silent).
- Convex is serverless but is NOT Vercel: the SDK's automatic `waitUntil` path never fires here,
  which is why `traced()` drains explicitly.

## Known gaps & deferred work

- **7 of 27 model calls are untraceable.** `blueprint.ts`, `onboarding.ts` (×2), `vaultDigest.ts`,
  `vaultLlm.ts` (×2) and `voiceDoc.ts` are V8-runtime modules holding query/mutation builders, so
  they can never import `lib/foglamp.ts`. Upgrade path: move the model call into a node action and
  leave the DB work behind.
- **`transcribe()` cannot be traced at all** on `ai@7.0.20` — its options are `{ model, audio,
  providerOptions, maxRetries, abortSignal, headers, download }`, with no `telemetry`. This kills
  the planned `audio-transcriber` agent (`intake.ts`, `vaultTranscribe.ts`). Upgrade path: watch
  for telemetry support in a later `ai` release.
- **Workflow correlation is partial.** `cockpit-turn` and `sub-agent-dispatch` carry a real
  `workflowRunId`; `governed-pipeline` does NOT, because its model calls sit inside
  action-cache-wrapped inner actions (`routeUncached`, `draftUncached`) whose ARGS ARE THE CACHE
  KEY — threading `requestId` in would bust the cache on every request. Upgrade path: an
  out-of-band correlation id that the cache ignores.
- **Invariant 1 has no test.** A static scan asserting no default-runtime module imports
  `lib/foglamp.ts` would catch it at CI instead of at deploy.
