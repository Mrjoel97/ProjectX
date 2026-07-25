# Playbook: Live Voice Sessions

> Last verified: 2026-07-25 (14-01 — Wave-0 freeze for the voice-doc flagship). Seams + stubs only,
> no behavior change to the Phase-6 flow. See the "Voice-doc sessions (Phase 14)" section below.

> Last verified: 2026-07-20 against 06-08 (phase close) + live mint-shape fix (audio.input nesting, `value` response) + transcript-completeness fix (agent turns no longer dropped → brief gaps) + brief is now clean PLAIN TEXT (no `#`/`*`; shared `BRIEF_HEADERS`) + a VISIBLE T-2min wrap-up banner and a deferred (collision-safe) wrap-up nudge + the PostCall "Just save" / "Turn this into a plan" buttons show a busy spinner (the shared `.btn-spinner`, now `currentColor` so it shows on the light button too) + a "…" label while the store/handoff is in flight, so a click reads as working, never stuck + the plan-handoff button renamed "Turn this into a plan" → "Continue with your agent" (honesty: the cockpit agent is an EMAIL composer, so a brief with no recipient/subject correctly draws a clarifying question, not an instant plan — behavior unchanged, expectation aligned; the richer non-email "plan" is logged in `.planning/phases/06-live-voice-sessions/deferred-items.md`)
> Build history: `.planning/phases/06-live-voice-sessions/` · Related ADRs: [ADR-005](../decisions/005-live-voice-browser-direct-realtime.md) (the architecture record), ADR-004 (brief→plan is the peer-actor Approve gate), ADR-003 (voice prompts load from the skill registry)

## Purpose

Lets a user hold a live, bidirectional voice conversation with the Executive Agent
(browser-direct WebRTC over the OpenAI Realtime API), hard-capped at 15 minutes by a
server-side watchdog. When the session ends — cleanly or abnormally — a structured
PLAIN-TEXT brief (no markdown `#`/`*` — it is read in the vault and welded into the plan
seed) is generated in the spoken language, stored + indexed in the knowledge vault, and
optionally handed off into the normal plan pipeline at the existing review gate.

## Key files

Pure packages (`packages/*` — no Convex, unit-testable):

- `packages/voice/src/realtime.ts` — pinned live OpenAI Realtime API shapes: endpoint
  constants (`CLIENT_SECRETS_URL`, `CALLS_URL`, `hangupUrl(callId)`), default model
  snapshot, session-config key names, and `response.done` usage field names.
- `packages/voice/src/brief.ts` — ALL brief string logic, pure: `BRIEF_HEADERS` (the single
  shared header set), `buildBriefMarkdown(sections, transcript, language)` (server/drafted brief),
  `composeBrief(transcript, dateStr)` (client clean-end editable brief), and
  `planSeedFromBrief(brief)` (pull Decisions + Action items for the plan handoff). All emit/parse
  clean PLAIN TEXT (no `#`/`*`): headers are bare UPPERCASE labels, lists `- item`, turns
  `Speaker: text`; empty sections render "None"; transcript welded verbatim in code (never
  model-authored). Composers + parser share `BRIEF_HEADERS` so they can never drift.
- `packages/voice/src/session.ts` — session status FSM (`active → ended_clean |
  ended_abnormal`, terminal once ended) + `capEndsAt(startedAt)` / `CAP_MS` +
  `graceExpired(sinceMs, now, windowMs)` (the pure mic-recovery/silence expiry predicate,
  fail-safe on a bad clock read).
- `packages/voice/src/realtime.ts` (cont.) — `REALTIME_EVENTS` / `REALTIME_CLIENT_EVENTS`:
  the pinned data-channel event `type` names the browser client matches (transcript, orb,
  metering) and stamps (wrap-up nudge, text-turn fallback). Same re-confirm caveat as the URLs.
- `packages/voice/src/metering.ts` — `accumulateUsage()` folds `response.done` usage
  deltas into cumulative token counters.
- `packages/cost/src/cost.ts` — `priceRealtime()` + `REALTIME_PRICING` (fail-closed,
  mirrors `priceTranscription`).

Backend adapters (thin — all shipped, pre-registered in `watch.json`):

- `packages/backend/convex/voice.ts` — the session engine (06-05): tenant-wrapped
  `startSession`/`recordUsage`/`endSessionClean`; internal `forceEndSession` (the watchdog
  actuator) + `storeBrief`/`persistBrief`/`markEndedClean`/`markEndedAbnormal`/`getActiveSession`.
  Arms the ONE watchdog, runs the clean/abnormal CAS transitions, meters, and ingests the brief.
  `abortSession` (06-06) is the thin tenant-guarded client gateway that schedules
  `forceEndSession` (the browser cannot call an internalAction) — the mic-loss / silence
  fall-through route; it re-uses the abnormal path, it does not add a second one.
- `packages/backend/convex/voiceToken.ts` — plain-runtime `action` minting the ephemeral
  client secret + `hangupCall`; reads `OPENAI_API_KEY` from env, never returns it.

Frontend (06-06): `apps/web/app/(app)/dashboard/voice/` — the `/dashboard/voice` route
(nav entry in `layout.tsx`) as a phase machine (`page.tsx`): pre-flight → live → post-call
(the post-call summary is Plan 07's seam). `useVoiceSession.ts` owns the WebRTC lifecycle
(mint → getUserMedia → RTCPeerConnection + `oai-events` data channel → `/realtime/calls`
handshake → relay `call_id` → `startSession`), assembles the two-sided transcript, forwards
throttled `response.done` usage, drives the countdown + T-2min wrap-up, and runs the
mic-loss pause/recover + silence expiry. `PreFlight.tsx` (mic permission + level meter +
consent), `LiveSession.tsx` (transcript + orb + countdown + End confirm + text fallback +
mic-lost paused banner + a11y).

Post-call surface (06-07): `PostCall.tsx` — the always-available screen both end types land on:
the brief text (composed client-side from the transcript via `composeBrief` in `@pikar/voice`, no
model — plan-05's clean-end contract) in an editable textarea, "Just save" →
`voice.endSessionClean({editedMarkdown})`, and the VOIC-04 "Turn this into a plan?" ask →
`cockpit.sendCockpitMessage(planSeedFromBrief(md))` (`planSeedFromBrief` also lives in `@pikar/voice`,
shared with `AbnormalBriefBanner`) →
`/dashboard/workspace?thread=<id>` (the EXISTING PLAN card + single Approve — no new pipeline, no new
gate). `AbnormalBriefBanner.tsx` (mounted app-wide in `(app)/layout.tsx`) — on next app open surfaces
the newest auto-stored voice brief the user has NOT yet reviewed (client-side seen-set in
localStorage; PostCall marks a just-reviewed brief seen via the `vaultDocId` `endSessionClean`
returns), reusing `vault.listVaultDocs` (no new backend). `workspace/page.tsx` reads `?thread=<id>` on
mount (client-only, the connect-gmail precedent) to re-open the handoff thread at the Approve gate.

## Dependencies & blast radius

Run `graphify query "voice"` for the current subgraph. Couplings graphify cannot see:

- Runtime contract: `voice.startSession` must persist the `call_id` (from the
  `/v1/realtime/calls` `Location` header) BEFORE the session is "active" — the watchdog
  force-terminate has nothing to target otherwise.
- External service: OpenAI Realtime API (GA `/v1/realtime/client_secrets` + `/calls` +
  `/calls/{id}/hangup`). Exact JSON shapes are pinned in `realtime.ts` and are
  verify-against-the-live-doc (post-training-cutoff GA — see the `ponytail:` sources there).
  **LIVE-VERIFIED 2026-07-20** (first real mint): the `client_secrets` body nests
  `turn_detection` + `transcription` under `session.audio.input` (a top-level
  `session.turn_detection` 400s "unknown parameter"), and the 200 returns the ephemeral
  secret as top-level `value` (an `ek_…` string), not `client_secret`. `voiceToken.ts` is
  the single reader of both shapes. The `/calls` SDP handshake + hangup remain pin-only
  (confirmed on the live walk-through).
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
6. Brief plain text (server: `buildBriefMarkdown`; client clean-end: `composeBrief`) →
   `voice.storeBrief` → `ingestDoc` → vault `ready`. Optional "Turn into a plan?" →
   `planSeedFromBrief` → `sendCockpitMessage` → review gate.

## Invariants — what must never break

- **Domain logic is pure (`packages/voice`), Convex is a thin adapter** (CLAUDE.md §1).
  Enforced by: package layout + `packages/voice` unit tests running with no Convex.
- **The 15-minute cap is a server wall-clock watchdog, armed once and never re-armed or
  paused.** A mic-drop grace window consumes cap time. Why: a movable cap can be stalled
  indefinitely by a hung client. Enforced by: `capEndsAt`/`CAP_MS` are pure + unit-tested;
  `startSession` arms exactly one timer (`voice.test.ts` — one `ctx.scheduler.runAt(` grep-proven).
  Recorded as the cost-bound decision in ADR-005.
- **Mic-loss pauses and recovers, but the pause consumes cap time and NEVER re-arms the
  watchdog.** On mic loss (track `ended` / getUserMedia failure / permission revoke) the client
  hook enters `paused` and shows "mic lost — reconnect to continue"; `reconnect()` re-acquires
  the mic and `replaceTrack`s it into the existing sender (no re-handshake). A mic that has not
  recovered within `MIC_GRACE_MS`, or continued silence past `SILENCE_MS`, falls through to
  `voice.abortSession` → the EXISTING `forceEndSession` abnormal path (a brief is still
  generated). `remainingMs` keeps counting down through the pause (RESEARCH Open Question 1 —
  cap stays wall-clock). Both timers are one decision: the pure, fail-safe `graceExpired`
  predicate (never ends on a non-finite/negative clock read). Enforced by: `graceExpired` is
  pure + unit-tested (`session.test.ts`); the real mic-loss recovery UX is the Plan-08 live
  phase-gate (voice is not unit-testable).
- **The brief BODY is vault content and keeps PII by design; session audit/telemetry/DLQ
  rows are refs/ids/counts ONLY** (CLAUDE.md §4 reconciliation). Do NOT `scanText`-strip
  the brief body. Enforced by: `ingestDoc` redacts only the vector; the mutation-checked
  `voice.ts session audit payloads are refs/counts-only` static scan in `llmRedaction.test.ts`
  (the `voice.session_started`/`session_ended` payloads carry `{sessionId}` + token counts
  only — never the transcript, the `callId`-as-secret, the client secret, or the brief text).
- **Exactly ONE session is active per tenant (parallel guard) and it is "active" only WITH a
  callId** (Pitfall 1). `startSession` force-ends any prior active session (cancel its timer +
  schedule its abnormal end) before opening a new one. Enforced by: `getActiveSession`
  (`by_tenant_status`) + the parallel-guard test in `voice.test.ts`.
- **A clean end cancels the watchdog ONLY under a status CAS; the CAS no-ops on the 0:00 fire
  race.** `scheduler.cancel` throws on an already-fired id (the `cockpit.cancelScheduledPlan`
  Pitfall), so `markEndedClean`/`markEndedAbnormal` flip only from `active` and never
  double-cancel. Enforced by: the CAS + fire-race tests in `voice.test.ts` (fake timers).
- **Every abnormal end (watchdog fire / gone tab) force-terminates the call AND always yields a
  brief.** `forceEndSession` CAS-marks `ended_abnormal`, calls `hangupCall` (a failed hangup is
  swallowed refs-only — it must not block the brief), then auto-stores. A gone-tab end with no
  captured transcript stores a fixed placeholder (never a model call over an empty transcript).
  `storeBrief` is idempotent on `briefRef`. Enforced by: the `forceEndSession`/`storeBrief`
  tests in `voice.test.ts`.
- **Metering is telemetry + a best-effort budget contribution, NOT the cost bound** (RESEARCH
  Pattern 4). `recordUsage` folds `response.done` deltas into cumulative counters and prices the
  DELTA onto `recordSpend`; the 15-min wall-clock cap is the real bound, so there is no
  server-side usage reconciliation. It fails CLOSED — a non-finite/negative delta patches no
  counter and records no spend. Enforced by: the `recordUsage` fail-closed test in `voice.test.ts`.
- **The transcript is welded onto the brief in code, never model-authored.** Enforced by:
  `buildBriefMarkdown` composes it deterministically; `brief.test.ts`.
- **A brief is CLEAN PLAIN TEXT — no markdown `#` or `*`.** It is read as-is in the vault and
  welded into the plan seed, so markdown syntax is noise both places. Headers are bare UPPERCASE
  labels, lists `- item`, turns `Speaker: text`. The two composers (`buildBriefMarkdown` server,
  `composeBrief` client) and the parser (`planSeedFromBrief`) ALL key off the ONE `BRIEF_HEADERS`
  set, so a composer and the parser can never disagree on a header. Enforced by: `brief.test.ts`
  asserts no `[#*]` in either composer's output and a compose→parse round-trip (both flavors).
- **The T-2min wrap-up is warned THREE ways, the visible one deterministic.** At `nearingCap`
  (`remainingMs ≤ WRAP_UP_MS`, i.e. 2 min before `CAP_MS`): the countdown restyles, `LiveSession`
  shows a VISIBLE teal-accent banner (aria-hidden — the SR announcement is the a11y path, so no
  double-announce), and the agent gets a one-time verbal nudge. The nudge is a `response.create`
  and is DEFERRED while a response is in flight (`responseActiveRef`) — sent mid-response it
  silently 400s and never speaks; the next 1s tick fires it in the gap. Note: at a 15-min cap this
  only fires 13 min in — untestable in a short call without temporarily lowering `CAP_MS`. The
  banner + defer are the imperative/UI legs (live-verify only); no unit test.
- **Both end types converge on ONE stored brief and ONE review→convert surface.** A clean end
  reviews→stores here; a dropped end auto-stored server-side and is surfaced by the banner — both
  render the same review + "Turn into a plan" affordance, and the plan handoff is the SAME
  `sendCockpitMessage` → PLAN/Approve pipeline (no voice-specific plan pipeline, no second gate). The
  brief→plan message never sends anything — it lands at the existing single Approve. Enforced by:
  `apps/web/e2e/voice.spec.ts` (offline, seeded stored brief) asserts the dropped brief surfaces, the
  handoff navigates to `/workspace?thread=<id>`, and NO REPORT card exists pre-Approve; the live
  audio round-trip + the real Approve→send stay the plan-08 human-verify.
- **The clean-end review store persists even after the end-CAS already flipped.** The client calls
  End (flips `ended_clean`, cancels the watchdog promptly — no abnormal fire during review), THEN the
  review screen stores the edited markdown; that second `endSessionClean`'s `markEndedClean` no-ops
  but `persistBrief` still runs (idempotent on `briefRef`). A bare end with no markdown keeps the
  original CAS no-op. Enforced by: `voice.test.ts` (the clean-end + clean-after-abnormal cases).
- **The dropped-session banner surfaces ONLY unreviewed briefs.** A clean-end brief is marked seen
  (localStorage) the instant PostCall stores it, so only auto-stored (dropped) briefs remain unseen
  and surface. Losing the seen-set (private mode) degrades to re-surfacing, never to losing a brief.
- **The live-session + brief prompts load from the skill registry, never hardcoded**
  (CLAUDE.md §5, ADR-003). Enforced by: `getActiveSkill` fail-closed load at mint/draft time
  (`voiceToken.mintClientSecret` for the persona, `llm.draftVoiceBrief` for the brief — both
  fail-closed if unseeded; `voiceToken.test.ts` / `voiceBriefDraft.test.ts`).
- **`OPENAI_API_KEY` / the ephemeral client secret never reach the browser, a log, or an
  audit row** (Pitfall 4). Enforced by: `mintClientSecret` returns only
  `{clientSecret, expiresAt}`; no audit/log carries either.
- **`priceRealtime` fails closed** — non-finite/negative token counts → `Err`, never NaN
  (so `recordSpend` cannot silently under-count). Enforced by: `cost.test.ts`.
- **`voiceToken.ts` is PLAIN-runtime (no `"use node"`).** Mint + hangup are just `fetch` to
  `api.openai.com`; a second `"use node"` module re-trips the TS circular-inference cliff
  `llm.ts` warns about. Enforced by: no `"use node"` pragma in the file (static grep) +
  `voiceToken.test.ts` running the actions under the default V8 runtime.
- **`mintClientSecret` returns ONLY `{clientSecret, expiresAt}` and injects the registry
  persona.** `OPENAI_API_KEY` reads from env, rides the `Authorization` header, and is
  structurally absent from the result — never returned, logged, or audited (Pitfall 4). The
  `instructions` are the active `voice-session` skill body (fail-closed if unseeded, §5).
  Enforced by: the no-key-leak + fail-closed assertions in `voiceToken.test.ts`.
- **`hangupCall` is the ONLY server-side force-terminate** — an `internalAction` (never
  client-exposed) POSTing `/v1/realtime/calls/{callId}/hangup` with the server key; 200 =
  ended, a non-200 throws with the STATUS only (refs-only, §4). It is the VOIC-02 watchdog's
  actuator. Enforced by: `voiceToken.test.ts` (targets the hangup path, 200 success, non-200 throw).
- **The agent transcript must be COMPLETE — the brief is composed from it verbatim, so a
  dropped turn is a brief gap.** In `useVoiceSession.onEvent` (LIVE-VERIFIED 2026-07-20):
  `response.output_audio_transcript.done` is authoritative — it finalizes the streamed turn OR,
  when no `.delta` created one, appends a final turn from its full `transcript` (never dropped);
  and `response.done` resets the open-agent-turn ref so a missed `.done` (barge-in / cancel)
  cannot bleed the next response's deltas into the prior bubble. Follow-up: extract a pure
  transcript reducer + unit test (currently verified by live walk-through only).

## How to change safely

- **Realtime API shape moved (new snapshot / renamed field):** re-fetch the live OpenAI
  doc, update the constant in `realtime.ts` (bump the `ponytail:` source date), re-run
  `pnpm --filter @pikar/voice test`. Do not scatter the literal elsewhere — every consumer
  imports from `realtime.ts`.
- **New brief section:** add the field to the brief section shape AND `buildBriefMarkdown`
  AND (plan 04) the `generateObject` schema — keep field names stable (they are the schema).
  Add its header to `BRIEF_HEADERS` (the shared set the parser uses to find section boundaries).
  Most likely to break: the empty→"None", no-markdown, and fixed-order invariants → extend
  `brief.test.ts`. Never reintroduce `#`/`*` into a composer — the brief is plain text by contract.
- **Watchdog / cap change:** only through `CAP_MS`/`capEndsAt` — never re-arm on pause.
- **New backend/UI voice file:** its path prefix is likely already covered under `voice.md`
  in `watch.json`; if not, add it there (do not duplicate `llm.ts`/skills paths — those live
  under cockpit.md / skill-registry.md). Bump this playbook's "Last verified" line.

## How to verify

- `pnpm --filter @pikar/voice test` — pure brief composer, session FSM, metering, and the
  `realtime.ts` self-check (unit; no deployment).
- `pnpm --filter @pikar/cost test` — `priceRealtime` fail-closed pricing math (unit).
- `pnpm --filter @pikar/backend test voice` — the session engine (convex-test + fake timers):
  watchdog arm/fire/cancel, parallel guard, clean/abnormal CAS, `storeBrief` ingest, `recordUsage`.
- `pnpm --filter @pikar/backend test llmRedaction` — the refs/counts-only session-audit static scan.
- `pnpm --filter @pikar/web test:e2e -- voice` — the offline post-call e2e: a seeded stored brief
  (`smoke:seedVoiceBrief`) surfaces in the banner, "Turn into a plan" routes through
  `sendCockpitMessage` to `/workspace?thread=<id>`, and nothing sends pre-Approve. Needs the live
  local stack + a Gmail-connected E2E user; where the harness lacks it, authored-and-documented per
  prior phases (the seeder itself is validated against the dev deployment).
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

## Voice-doc sessions (Phase 14, DOCV-01)

The flagship "discuss a report by voice" flow: a user picks ONE ready vault document and holds a
live session scoped to it. It reuses the whole Phase-6 spine (mint → WebRTC → watchdog → brief) and
adds a doc scope, a retrieval tool, and a persisted review. **Wave 0 (plan 14-01) landed the seams
only** — the sections below describe contracts that exist on disk now; the behavior fills in across
plans 14-02 … 14-09.

### The `document-review` framework literal

`evaluations.framework` is widened with `"document-review"` (schema.ts). The literal is deliberately
HUMAN-READABLE and is not a free choice: `evaluations.ts buildMemo` prints
`Diagnosed on the **${row.framework}** framework` as user-visible prose inside an approvable memo, so
a slug like `docrev` would leak into the product. It is DELIBERATELY absent from `FRAMEWORK_SKILL` —
an unmapped literal is what keeps `runEvaluation` from ever treating a doc review as a business
evaluation.

**Invariant (14-01, approved deviation):** `runEvaluation`'s `framework` arg is explicitly PINNED to
the four business frameworks rather than derived from `evalFields`. `evalFields.framework` feeds two
signatures — `insertEvaluation`'s write surface (which SHOULD widen for free, and is how a voice-doc
row is persisted) and `runEvaluation`'s entrypoint (which must NOT). Do not "simplify" that pin back
to `evalFields.framework`; it is what refuses a doc-review row at the validator boundary.
`proactiveReview.ts` correspondingly never carries a `document-review` framework into the weekly
business review.

### `voiceSessions.docRef`

The ONE report under discussion, `v.optional(v.id("vaultDocuments"))`. Optional so existing rows need
no migration; **no index** — it is read through the existing `ctx.db.get(sessionId)`. One document per
session is the product decision, not a limitation to route around.

### The synthetic `voice-doc:<sessionId>` thread

A voice session has no cockpit thread, but an `evaluations` row needs one. `voiceDocThreadId()`
(`@pikar/voice`) derives it deterministically from the session id, so PostCall, `actOnGap` and
`byThread` all compute the same id with **no extra column**. Never store it as a second field — a
stored copy can drift from the derivation.

### Citations: document-level always, quoted passage where available

`evaluations.findings[].citationExcerpt` (`v.optional(v.string())`) is the persisted half of the
LOCKED citation decision. `optional` is load-bearing: an **absent excerpt is a valid, non-degraded
state** — never an error, never an empty string — and the render path branches on presence, so a
quote-less finding must render exactly as it does today.

The value is capped at `EXCERPT_CHAR_CAP` (300) and **substring-verified against the document text**
before it is written — never trusted raw from a model. Citations, verdict, route, playbook and rank
are all welded in code; `excerpt` is the ONE field the model contributes to, which is why its
provenance check exists.

**Content-plane / log-plane line (§4).** An excerpt IS report content. It is legal in
`evaluations.findings[]`, in the memo body, and on the post-call card. It is ILLEGAL in every
`audit` / `deadLetters` / `telemetry` `payload:` and in every `agentSteps` row. There is no third
state: if something needs to log "which finding", it logs an index or a count, never the quote.
Plan 14-09 pins this with a mutation-verified static scan.

### Char budgets (`packages/voice/src/docSession.ts`)

`DIGEST_CHAR_CAP` (6,000) bounds the report text baked into the mint-time instructions.
gpt-realtime is a 32k window and **instructions are re-billed as input on every turn**, so the digest
is a hard cap, not a target — depth comes from the retrieval tool instead. That hybrid split (small
always-present digest + on-demand retrieval) is the design, not a compromise. `RETRIEVAL_CHAR_CAP`
(1,200) and `RETRIEVAL_MAX_PASSAGES` (3) bound each drill-in.

### `search_document` tool shape

`SEARCH_DOCUMENT_TOOL` is the **FLAT** Realtime shape — `{type, name, description, parameters}` — NOT
the Chat-Completions `{type, function:{...}}` nesting, which 400s the mint. Its `parameters` are
STRICT-legal: every key in `properties` also appears in `required`, and `additionalProperties` is
`false`. `docSession.test.ts` asserts both, including the absence of a `function` key.

### Gap routing is code-owned

`DOC_GAP_ROUTE` / `DOC_GAP_PLAYBOOK` are welded constants. `buildMemo` prints them as user-visible
prose in an approvable memo, so the MODEL never chooses them — the same discipline as citations.
`ponytail:` one route until Phase 15 dispatch exists; upgrade path is a route map keyed on the
finding section once real specialists are dispatchable.

### File ownership + how to verify

`packages/backend/convex/voiceDoc.ts` is the lane-owned module (V8 runtime, **no `"use node"`** —
`vaultLlm.ts:2-7` records the TS circular-inference cliff a second node module re-triggers; every
handler carries an explicit `Promise<>` return type). It and `voiceDoc.test.ts` and
`apps/web/e2e/voice-doc.spec.ts` are registered under this playbook in `watch.json` — note
`packages/backend/convex/voice.ts` does NOT prefix-match `voiceDoc.ts`, so the explicit entries are
required. `voice-doc.spec.ts` also falls under `cockpit.md`'s `apps/web/e2e/` prefix, so a change
there touches both playbooks.

Verify with `pnpm --filter @pikar/voice test`, `pnpm --filter @pikar/backend test voiceDoc`, and
`node scripts/check-playbooks.mjs check`. The SC3 e2e is seeded offline by
`smoke:seedVoiceDocSession`, which deliberately seeds TWO findings — one WITH a `citationExcerpt`
(a verbatim substring of the seeded report text) and one WITHOUT — so both render paths are
exercised. Keep the seeded excerpt in sync with the seeded text or the fixture stops representing a
legal row. The live drill-in, the spoken "no gaps" and the real memo-vs-plan choice are
**manual-only** (14-VALIDATION.md).
