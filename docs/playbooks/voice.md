# Playbook: Live Voice Sessions

> Last verified: 2026-07-20 against 35f2b6f
> Build history: `.planning/phases/06-live-voice-sessions/` · Related ADRs: none

## Purpose

Lets a user hold a live, bidirectional voice conversation with the Executive Agent
(browser-direct WebRTC over the OpenAI Realtime API), hard-capped at 15 minutes by a
server-side watchdog. When the session ends — cleanly or abnormally — a structured
markdown brief is generated in the spoken language, stored + indexed in the knowledge
vault, and optionally handed off into the normal plan pipeline at the existing review gate.

## Key files

Pure packages (`packages/*` — no Convex, unit-testable):

- `packages/voice/src/realtime.ts` — pinned live OpenAI Realtime API shapes: endpoint
  constants (`CLIENT_SECRETS_URL`, `CALLS_URL`, `hangupUrl(callId)`), default model
  snapshot, session-config key names, and `response.done` usage field names.
- `packages/voice/src/brief.ts` — `buildBriefMarkdown(sections, transcript, language)`:
  pure fixed-section markdown composer; empty sections render "None"; transcript welded
  verbatim in code (never model-authored).
- `packages/voice/src/session.ts` — session status FSM (`active → ended_clean |
  ended_abnormal`, terminal once ended) + `capEndsAt(startedAt)` / `CAP_MS`.
- `packages/voice/src/metering.ts` — `accumulateUsage()` folds `response.done` usage
  deltas into cumulative token counters.
- `packages/cost/src/cost.ts` — `priceRealtime()` + `REALTIME_PRICING` (fail-closed,
  mirrors `priceTranscription`).

Backend adapters (thin, added in later plans — pre-registered in `watch.json`):

- `packages/backend/convex/voice.ts` — tenant-wrapped `startSession`/`recordUsage`/
  `endSessionClean`/`forceEndSession`/`storeBrief`/`getActiveSession`; arms the watchdog.
- `packages/backend/convex/voiceToken.ts` — plain-runtime `action` minting the ephemeral
  client secret + `hangupCall`; reads `OPENAI_API_KEY` from env, never returns it.

Frontend (later plan): `apps/web/app/(app)/dashboard/voice/` — pre-flight → live session
→ post-call summary.

## Dependencies & blast radius

Run `graphify query "voice"` for the current subgraph. Couplings graphify cannot see:

- Runtime contract: `voice.startSession` must persist the `call_id` (from the
  `/v1/realtime/calls` `Location` header) BEFORE the session is "active" — the watchdog
  force-terminate has nothing to target otherwise.
- External service: OpenAI Realtime API (GA `/v1/realtime/client_secrets` + `/calls` +
  `/calls/{id}/hangup`). Exact JSON shapes are pinned in `realtime.ts` and are
  verify-against-the-live-doc (post-training-cutoff GA — see the `ponytail:` sources there).
- Env var: `OPENAI_API_KEY` (server-only). Never reaches the browser, a log line, or an
  audit row.
- Reused rails: `vaultIngest.ingestDoc` (brief → vault), `recordSpend`/`recordModelSpend`
  (metering + brief drafting), `sendCockpitMessage` (brief → plan handoff), the skill
  registry (`voice-session` + `voice-brief` prompt rows).

## Data flow

1. Pre-flight → `voiceToken.mintClientSecret()` → `POST /v1/realtime/client_secrets`
   (session config from the `voice-session` registry skill) → `{clientSecret, expiresAt}`.
2. Browser `getUserMedia` + `RTCPeerConnection` → SDP offer → `POST /v1/realtime/calls`
   (Bearer `clientSecret`) → SDP answer + `call_id` in the `Location` header.
3. Client relays `call_id` → `voice.startSession({callId})` → patches the session `active`
   and arms ONE `scheduler.runAt(startedAt + CAP_MS, forceEndSession)` watchdog.
4. During the call, `response.done` usage events → `voice.recordUsage` → `priceRealtime`
   → `recordSpend` (best-effort budget contribution; the 15-min cap is the real cost bound).
5. End: clean (User End / graceful 0:00) cancels the watchdog then stores the brief after
   review; abnormal (watchdog fires / tab close) calls `hangupCall` then auto-stores.
6. Brief markdown (composed by `buildBriefMarkdown`) → `voice.storeBrief` → `ingestDoc`
   → vault `ready`. Optional "Turn into a plan?" → `sendCockpitMessage` → review gate.

## Invariants — what must never break

- **Domain logic is pure (`packages/voice`), Convex is a thin adapter** (CLAUDE.md §1).
  Enforced by: package layout + `packages/voice` unit tests running with no Convex.
- **The 15-minute cap is a server wall-clock watchdog, armed once and never re-armed or
  paused.** A mic-drop grace window consumes cap time. Why: a movable cap can be stalled
  indefinitely by a hung client. Enforced by: `capEndsAt`/`CAP_MS` are pure + unit-tested;
  `startSession` arms exactly one timer (later `voice.test.ts`).
- **The brief BODY is vault content and keeps PII by design; session audit/telemetry/DLQ
  rows are refs/ids/counts ONLY** (CLAUDE.md §4 reconciliation). Do NOT `scanText`-strip
  the brief body. Enforced by: `ingestDoc` redacts only the vector; a static-scan test on
  the audit line (later plan, `llmRedaction.test.ts` precedent).
- **The transcript is welded onto the brief in code, never model-authored.** Enforced by:
  `buildBriefMarkdown` composes it deterministically; `brief.test.ts`.
- **The live-session + brief prompts load from the skill registry, never hardcoded**
  (CLAUDE.md §5). Enforced by: `getActiveSkill` fail-closed load at mint/draft time (later).
- **`OPENAI_API_KEY` / the ephemeral client secret never reach the browser, a log, or an
  audit row** (Pitfall 4). Enforced by: `mintClientSecret` returns only
  `{clientSecret, expiresAt}`; no audit/log carries either.
- **`priceRealtime` fails closed** — non-finite/negative token counts → `Err`, never NaN
  (so `recordSpend` cannot silently under-count). Enforced by: `cost.test.ts`.

## How to change safely

- **Realtime API shape moved (new snapshot / renamed field):** re-fetch the live OpenAI
  doc, update the constant in `realtime.ts` (bump the `ponytail:` source date), re-run
  `pnpm --filter @pikar/voice test`. Do not scatter the literal elsewhere — every consumer
  imports from `realtime.ts`.
- **New brief section:** add the field to the brief section shape AND `buildBriefMarkdown`
  AND (plan 04) the `generateObject` schema — keep field names stable (they are the schema).
  Most likely to break: the empty→"None" and fixed-order invariants → extend `brief.test.ts`.
- **Watchdog / cap change:** only through `CAP_MS`/`capEndsAt` — never re-arm on pause.
- **New backend/UI voice file:** its path prefix is likely already covered under `voice.md`
  in `watch.json`; if not, add it there (do not duplicate `llm.ts`/skills paths — those live
  under cockpit.md / skill-registry.md). Bump this playbook's "Last verified" line.

## How to verify

- `pnpm --filter @pikar/voice test` — pure brief composer, session FSM, metering, and the
  `realtime.ts` self-check (unit; no deployment).
- `pnpm --filter @pikar/cost test` — `priceRealtime` fail-closed pricing math (unit).
- `node scripts/check-playbooks.mjs` — exits 0 when this playbook is registered and all
  new voice files are covered (static scan).
- Live session round-trip, barge-in, echo cancellation, multilingual, real 15:00 hangup —
  **manual/live only** (voice is not unit-testable); carried by the phase-gate human-verify.

## Operational notes

- Env: `OPENAI_API_KEY` (server-only, same key as the rest of the LLM stack).
- Seeds: `voice-session` + `voice-brief` skill rows (later plan) — a fresh deployment needs
  them or the mint/draft fail-closed.
- Pinned shapes in `realtime.ts` are MEDIUM-confidence GA values (landed after the model
  training cutoff). If a mint/handshake/hangup starts 4xx-ing, re-fetch the live doc first.

## Known gaps & deferred work

- Realtime JSON shapes are pinned from the phase RESEARCH doc citing the live OpenAI docs
  (2026-07-20); each carries a `ponytail:` source + re-fetch upgrade path in `realtime.ts`.
- Silent tab-close leaves the abnormal-end brief up to 15 min late (watchdog is the
  authoritative backstop). `ponytail:` accepted for beta — upgrade path is a client
  heartbeat pushing a short second timer (Pitfall 3).
- Client-reported usage is trusted for metering because cost control is time-cap-only; no
  server-side usage reconciliation for beta (`ponytail:` the cap bounds worst-case spend).
