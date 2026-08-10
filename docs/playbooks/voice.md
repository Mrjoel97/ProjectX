# Playbook: Live Voice Sessions

> Last verified: 2026-08-10 (Plan 19-12 — the phase-19 UAT clock defect). **No voice BEHAVIOUR changed.** `PostCall`'s
> "Turn into a plan" (VOIC-04) and `AbnormalBriefBanner`'s dropped-brief handoff were two of the
> five web callers of `api.cockpit.sendCockpitMessage` that never sent `clientContext`, so the
> cockpit thread a voice brief opened arrived clockless and its FIRST turn could not stage a dated
> follow-up or a calendar event — exactly the actions a call brief produces. Both now call the
> shared `useSendCockpitMessage()` hook (`dashboard/workspace/`); same seed text, same navigation,
> same failure handling, one extra argument. Use the hook for any future voice→cockpit handoff —
> `crmCard.test.ts` fails the build on a raw `useAction(api.cockpit.sendCockpitMessage)` anywhere
> under `apps/web/app`. See `cockpit.md`'s top block for the full defect.

> Last verified: 2026-08-09 (26-07 follow-up — **both voice spend sites now name themselves in the
> ledger, and the metering one needed a discriminator that is not the session.**)
> `voice.ts`'s realtime metering uses `voice:usage:<sessionId>:<offset>` — **the cumulative token
> offset, NOT the session id alone.** One live session meters REPEATEDLY as audio flows, so a
> session-scoped correlation would have recorded only the first slice and silently dropped every
> later one, leaving the ledger far below the limiter for exactly the sessions that cost the most.
> The offset advances monotonically per metering call, so each slice gets its own row while a
> genuine replay of the same slice is still suppressed. `voiceDoc.ts`'s review draft uses
> `voicedoc:review:<sessionId>:<nonce>` with a per-execution nonce, because re-reviewing a document
> re-spends for real. Both are ACTION sites, which is why they mint rather than derive — the policy
> and the full per-site table live in `docs/playbooks/guardrails.md` §"Phase 26". A static scan in
> `guardrails.test.ts` fails the build if either site ever loses its correlation.
>
> Previously verified: 2026-08-02 (22.1-03 — ⚠ **date bumped for a BEHAVIOUR-FREE sweep; the
> subsystem below was NOT re-verified.**) The dead-directive sweep (`72dd652`) deleted one line
> — `// @ts-expect-error import.meta.glob …` — from watched test files (voice.test.ts, voiceDoc.test.ts, voiceToken.test.ts).
> It suppressed nothing: `tsconfig.json` includes `vitest.config.mts`, which pulls Vite's global
> types in, so TypeScript reported all 100 occurrences as TS2578 *unused directive*. Deletions
> only, zero additions, no assertion, invariant or product line touched anywhere. Backend
> typecheck 150 → 50; full suite 54/54.
> **Re-verified 2026-08-02** (a later session, closing the ⚠ above for THIS subsystem): voice.test.ts + voiceDoc.test.ts + voiceToken.test.ts run green under vitest as part of a 10-file, 212/212 pass. The sweep's claim of behaviour-freedom now has evidence here, not just a typecheck delta.
>
> Last verified: 2026-08-01 (22.1-02 — per-tenant budget keying). MECHANICAL for this subsystem: `voice.recordUsage` passes `ctx.tenantId` to `recordSpend`, and `voiceDoc`'s private `modelDocReview` gained a leading `tenantId` parameter supplied by `reviewDocument`, which already had it. The spend rail is now TWO windows (`guardrails.ts`): `dailySpendCents` keyed PER TENANT (`{ key: tenantId }` on every check/limit/getValue) and `deploymentSpendCents`, a deliberately KEYLESS ceiling. `prepare`/`preCall` check both — tenant first, so a tenant that is personally out is told so rather than blamed for a global pause — and `recordSpend` consumes both. Two distinct refusals now exist: `daily_budget_exhausted` (this tenant is done today) and `deployment_budget_exhausted` (everyone is paused). Realtime pricing, metering and the brief/doc-review paths are otherwise untouched — but note a voice session's spend now lands on the SPEAKER's tenant rail, so a long call can exhaust that tenant's day without touching anyone else's.
>
> PRIOR 2026-07-30 (17.1-07 — **THE CONFIRMED BUSINESS BLUEPRINT NOW SURVIVES THE
> DOC-SCOPED FILTER AS EXPLICIT STANDING CONTEXT.** `voiceDoc` prepends
> `vaultGroundHydrated.spine` before filtering retrieval arrays by `docRef`; the same number of
> document passages still receive the full `RETRIEVAL_CHAR_CAP`. See the BLPR-02 note under
> `voiceDoc.searchDocument`.)
>
> PRIOR: 2026-07-26 (14-09 — **PHASE 14 CLOSED. THE FLAGSHIP FLOW IS OWNER-VERIFIED ON A
> REAL CALL**: the agent discussed the uploaded report, a mid-call drill-in returned a grounded
> answer, and BOTH outcome paths landed — a memo saved to the vault and a gap turned into a plan
> that produced an email through the ordinary Approve gate. The §4 scans are all mutation-verified.
> Left open by decision: the tool-declaration branch (Open Question 3) and retrieval latency —
> see "Live verification — 14-09 Task 3" below. PRIOR: 14-10 — **A VOICE SESSION CAN NOW ATTACH A VAULT DOCUMENT FROM
> PRE-FLIGHT** (the document picker, once informally called `14-07`, ships here as 14-10 — `14-07`
> already names the entry-point + in-call-context work recorded below, so the picker could not reuse
> that number). Owner-reported: "I uploaded the
> document in the knowledge vault but the agent still cannot access it — it's asking me to upload
> the document in that voice session."
> ROOT CAUSE: a session only becomes doc-scoped when `startSession` receives a `docRef`, and the
> ONLY way to supply one was arriving from the vault at `/dashboard/voice?doc=<id>`. Started from
> the voice page, `docScopedPassages` returns `[]` **before it searches anything**
> (`!session.docRef` is in its first guard), so the agent had no vault reach and honestly asked for
> the document. Retrieval was NOT at fault — `vaultGroundHydrated` was run live against the owner's
> tenant and returned the document as the TOP hit, and no row in `voiceSessions` carried a `docRef`.
> FIX: `voiceDoc.pickableDocs` (tenantQuery — this tenant's READY documents newest-first as id +
> title, plus a `processingCount`, scanning `PICKER_DOC_SCAN_CAP` = 50 newest rows in the
> `vault.profileSeedDocs` shape) plus a `DocPicker` pre-flight panel (paperclip → searchable list →
> chip). **The trust boundary did NOT move:** `voice.startSession` and
> `voiceToken.mintClientSecret` each still re-validate ownership and `status: "ready"`, so the
> picker is the courtesy `startSession`'s own comment always said it would be. READY-ONLY BY
> CONSTRUCTION — offering a row the server rejects would be a lie; non-ready rows are counted, not
> listed, so a just-uploaded file does not appear to vanish. Deliberately NOT `vault.listVaultDocs`
> (whole rows including book-sized `text`, against schema.ts's 16 MiB read cap) — the `docContext`
> rule. `useVoiceSession` is UNCHANGED: `docId` is read inside `start()` and is already in that
> callback's dependency array. Ceilings (`ponytail:` in source): PRE-FLIGHT ONLY — no mid-call
> attach or swap, because `docRef` is written at row-insert and re-validated at token mint, so a
> swap means patching a live session and re-instructing the model mid-stream; and the list is a
> newest-50 scan with a client-side title filter, so a vault whose ready docs fall outside that
> window needs pagination or a title search index (a schema change). **This does NOT improve
> grounding quality** — an attached document still carries whatever text extraction produced, and
> the scanned-PDF summary defect remains open in `vault.md` "Known gaps". Spec:
> `docs/superpowers/specs/2026-07-26-voice-doc-picker-design.md`).
> Verified 2026-07-26 (14-10, real sweep, not a prediction): `packages/backend/node_modules/.bin/vitest
> run --root packages/backend --maxWorkers=1 convex/voiceDoc.test.ts` — 1 file, 29/29 GREEN (includes 6
> new `pickableDocs` cases: ready-only + newest-first projection, non-ready excluded-from-list
> but counted as processing, `failed` neither listed nor counted, an empty-text `ready` row
> refused, a no-`text`-field `ready` row refused, cross-tenant empty (BETA-05)); `pnpm --filter
> @pikar/voice test` — 5 files, 57/57 GREEN; `pnpm --filter @pikar/voice typecheck` (`tsc
> --noEmit`) — clean, zero errors; `pnpm --filter @pikar/web typecheck` (`tsc --noEmit`) —
> clean, zero errors; `pnpm --filter @pikar/web build` — GREEN, `Route (app)` still lists
> `ƒ /dashboard/voice` (Dynamic, not prerendered) — the one gate that catches a prerender/Suspense
> regression on this route, run by the final whole-plan review and re-confirmed on the fix pass;
> `node scripts/check-playbooks.mjs` — exit 0, GREEN. All six commands exited 0; nothing in this
> plan's scope is red. (The `npx vitest` invocation from a global npx cache failed to resolve
> `@edge-runtime/vm` and had to be re-run via the package-local `node_modules/.bin/vitest` binary
> instead — an environment/PATH artifact of this sandbox, not a test failure; the actual suite run is
> the one recorded above.)
> Prior: 14-09 — SC4 proven statically by EIGHT mutation-verified scans, and this playbook
> consolidated into one coherent Phase-14 record: see "Voice-doc: the consolidated
> Phase-14 record" at the end. The live-verify half is still OPEN — the `LIVE-VERIFIED` line in
> `packages/voice/src/realtime.ts` is deliberately blank until the owner runs a real call).
> Prior: 14-08 — the POST-CALL OUTCOME: the review runs once, the cited findings
> render IN PLACE via the exported `CardList` on the synthetic thread, the memo is the brief in
> document flavour (ONE vault artifact), and a gap crosses the EXISTING single Approve gate with no
> route jump). Prior: 14-07 — the ENTRY POINT + in-call context: a ready vault document offers
> "Discuss by voice", the status gate is subscription-driven, a failed document is refused with a
> reason, and the live screen names the report under discussion with a "partial" badge when only part
> of it could be read). Prior: 14-06 — the BROWSER RELAY: `/dashboard/voice?doc=<id>` opens a
> doc-scoped session and the model's `search_document` calls are answered from Convex over the
> existing `"oai-events"` channel, triggered off `response.done` with no new pinned event name).
> Prior: 14-05 — the REVIEW producer: `voiceDoc.reviewSession` turns a finished discussion into ONE
> cited `evaluations` row on the synthetic `voice-doc:<sessionId>` thread, with the citations, the gap
> routing and the honesty verdict welded in code and the model's quoted passage substring-verified
> against the report. See "The browser relay (14-06)" and "The review producer (14-05)" below.
>
> Prior: 2026-07-26 (14-04 — the doc-grounded MINT: `mintClientSecret({docId?})` bakes the
> `document-analyst` persona plus a fenced digest of that report into the ephemeral session and
> declares the one read-only retrieval tool, with a pre-written `session.update` fallback). The
> unscoped Phase-6 mint body is pinned byte-unchanged. See "The doc-grounded mint (14-04)" below.
>
> Prior: 2026-07-26 (14-03 — the doc scope becomes REAL: `startSession` accepts and
> validates an optional `docRef`, and `voiceDoc.searchDocument` answers a mid-call drill-in from
> that document alone). This is the first Phase-14 plan that changes runtime behavior; the
> no-`docRef` Phase-6 path is unchanged.
>
> Prior: 2026-07-25 (14-02 — the pure voice-doc domain: `buildDocDigest`, `shapeDocReview`,
> `composeDocMemo`, and the pinned Realtime function-call vocabulary).
>
> Prior: 2026-07-25 (14-01 — Wave-0 freeze for the voice-doc flagship). Seams, stubs and the
> `document-analyst` persona row only.

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
- `packages/voice/src/docSession.ts` — the WHOLE voice-doc discussion domain (Phase 14), pure:
  the welded literals (framework, thread prefix, char caps, `SEARCH_DOCUMENT_TOOL`, gap route +
  playbook), `buildDocDigest(doc)` (bounded + fenced mint-time document facts),
  `shapeDocReview(raw, doc)` (drops malformed findings, welds citations/route/playbook/rank, and
  decides the honesty verdict), and `composeDocMemo(turns, review, docTitle, date)` (the ONE vault
  artifact per doc session, built ON `composeBrief` so `BRIEF_HEADERS` never fork). It imports
  `./brief` and nothing else — no Convex, no network.
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
consent + the 14-10 `DocPicker`), `DocPicker.tsx` (14-10 — the pre-flight document picker:
paperclip → searchable ready-only list → chip), `LiveSession.tsx` (transcript + orb + countdown +
End confirm + text fallback + mic-lost paused banner + a11y).

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
- **The doc-review VERDICT is a code rule, not a prompt hope (Success Criterion 2).**
  `shapeDocReview` decides it in exactly one place: zero surviving findings ⇒ `gaps` are FORCED
  empty and the verdict is `insufficient` (a gap can never be fabricated out of an unread
  document); findings present with zero gaps ⇒ `healthy`; otherwise `gaps`. This is the Phase-12
  engine's rule restated. **"Healthy" can never be reached by emptiness** — the assertion must
  pair `findings.length > 0` with `gaps.length === 0` and pin `verdict === "healthy"`, because
  `gaps.length === 0` ALONE also holds on the thin-data `insufficient` verdict (the Phase-12
  anti-vacuous lesson). A finding whose `section` is outside `DOC_REVIEW_SECTIONS` or whose
  `confidence` is outside high/medium/low is DROPPED, never coerced — so a garbage section cannot
  quietly become a grounded finding and turn `insufficient` into `healthy`. Enforced by:
  `docSession.test.ts` (both branches, asserted as pairs).
- **Citations, route, playbook and rank are welded in `shapeDocReview`; `excerpt` is the ONE
  declared exception.** The `RawDocReview` type the model fills has NO citation, route, rank or
  verdict field, so there is nothing to omit or invent. `citationDocId`/`citationTitle`/
  `source: "vault"` come from the `doc` argument; `route`/`playbook`/`leverageRank` (dense, 1-based)
  come from the module constants regardless of anything in the raw object. `citationExcerpt` is
  trimmed, whitespace-collapsed and hard-capped at `EXCERPT_CHAR_CAP`, and **the key is OMITTED
  entirely** when the raw excerpt is missing/null/empty/whitespace-only — never `""`. Provenance
  (is the quote really in the report?) is checked at the producer, where the document text is in
  hand; the pure function caps and normalizes, it never fetches. Enforced by: `docSession.test.ts`.
- **Document text reaching the `instructions` field is BOUNDED and FENCED.** `buildDocDigest`
  slices at most `DIGEST_CHAR_CAP` characters of DOCUMENT TEXT (title / truncation disclosure /
  fence / safety line are chrome and are not charged to the cap) and wraps it in
  `DIGEST_FENCE_OPEN` … `DIGEST_FENCE_CLOSE`. A fence marker planted inside the document is
  neutralized to a strictly SHORTER literal, so the fence is not escapable and neutralizing can
  never push the slice back over the cap. A truncated extraction discloses that in a plain
  sentence BEFORE the fence opens; empty/whitespace-only text says so plainly and still fences.
  **§5 boundary:** the digest emits document FACTS plus ONE safety line (a fence with no stated
  rule is not a fence) — every behavioural instruction is the `document-analyst` registry skill
  body. Enforced by: `docSession.test.ts` (cap measured on the fenced slice, not the whole string).
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
  watchdog arm/fire/cancel, parallel guard, clean/abnormal CAS, `storeBrief` ingest, `recordUsage`,
  and the four `startSession` `docRef` cases (persist · refuse non-ready · refuse cross-tenant ·
  unchanged no-`docRef` payload).
- `pnpm --filter @pikar/backend test voiceDoc` — the voice-doc module (convex-test over the
  `SMOKE::` seam, `fetch` stubbed to THROW so the offline claim is structural): the drill-in, the
  doc-scoping drop, the retrieval caps, the three never-throw bail cases, the
  `{sessionId, queryHash, resultCount}` audit shape, and the BETA-05 two-tenant assertion (which is
  anti-vacuous — it also proves the same seed IS retrievable from tenant B's own session, so the
  empty result is a tenant boundary and not a malformed fixture).
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

### The `document-analyst` persona — registry-loaded and DELIBERATELY UNGATED

The persona is a versioned `skills` registry row loaded at runtime (CLAUDE.md §5), never a
hardcoded prompt, and it fails closed when unseeded (`getActiveSkill` throws `NO_ACTIVE_SKILL`).
It ships as the standard 5-file mirror: `packages/contracts/skills/document-analyst.md` (canonical),
`src/skills/documentAnalyst.ts` (derived, bundler-safe), the `DOCUMENT_ANALYST_SKILL` name const in
`src/skill.ts`, the `seedSkills` row in `convex/skills.ts`, and the `skillBodies.test.ts` drift row
that holds the `.md` and `.ts` byte-identical (LF-normalized).

**It is NOT in `GATED_SKILLS`, and that is deliberate — do not "fix" it.** Locked user decision
(2026-07-25), following the `voice-session` / `voice-brief` precedent exactly.
`packages/backend/scripts/run-eval-golden.mjs` — the runner that clears the `EVAL_GATE` — drives
`runCockpitAgent` over TEXT fixtures and hard-validates `--skill` against a closed name list. It
structurally cannot exercise a Realtime voice persona. Gating this skill would therefore deadlock it
at v1 the first time anyone edits the body, with no runner able to clear the gate. `run-eval-golden.mjs`
is byte-unchanged by Phase 14 and must stay that way.

Editing the persona: change the `.md`, regenerate the `.ts` constant from it, and let
`skillBodies.test.ts` prove they match. Because the skill is ungated, a seed publishes a new ACTIVE
version directly — `seedSkills` writes `maxVersion + 1`, so verify which version carries your body
before relying on it.


The flagship "discuss a report by voice" flow: a user picks ONE ready vault document and holds a
live session scoped to it. It reuses the whole Phase-6 spine (mint → WebRTC → watchdog → brief) and
adds a doc scope, a retrieval tool, and a persisted review. Wave 0 (14-01) landed the seams, 14-02
the pure domain, and **14-03 the first real runtime behavior** — `startSession`'s validated `docRef`
and `voiceDoc.searchDocument`. The mint body (14-04), the review producer (14-05), the browser relay
(14-06) and the UI (14-07/08) still fill in; sections below say which plan owns which.

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

**Invariant (14-03) — `startSession` is the TRUST BOUNDARY for the doc scope, and it refuses.**
`voice.startSession({callId, docRef})` validates the document BEFORE any write: the row must exist,
be **this tenant's**, be `status: "ready"`, and carry non-blank `text`. Anything else throws
`voicedoc: document not found` (missing / cross-tenant, fail-closed) or `voicedoc: document not ready`
(non-`ready` status or no extracted text). Why the server and not just the picker: 14-07's vault
"Discuss by voice" gate is a courtesy, and the locked CONTEXT decision *"never burn capped
15-minute time discussing a document the agent cannot actually see"* is only true if the server
refuses. Validation runs FIRST, before the parallel-session guard and the insert, so a rejected doc
can never leave an `active` row holding a watchdog. The thrown message is a **status, never
content** — no title, no text, no character count. The read is a direct `ctx.db.get(docRef)` +
`doc.tenantId !== ctx.tenantId` (this file's own `endSessionClean` / `abortSession` idiom), NOT
`internal.vault.getDoc`: that query returns `{text, contentHash, title}` with **no `status`**, so it
structurally cannot answer the readiness half. Enforced by: the four `docRef` cases in
`voice.test.ts` (persist + refuse-non-ready + refuse-cross-tenant + the unchanged no-`docRef` path).

The `voice.session_started` audit payload may gain **`docRef` and nothing else** — an id is a ref.
Never the title, the status, or a character count of the text (§4). Without a `docRef` the payload is
byte-identical to the Phase-6 `{sessionId}`, which `voice.test.ts` asserts exactly.

### `voiceDoc.searchDocument` — the mid-call drill-in (14-03)

`searchDocument({sessionId, query})` → `{passages: string[], found: boolean}` is the server side of
`SEARCH_DOCUMENT_TOOL`. The browser relays the model's tool call to it over the authenticated Convex
client and hands the result back on the data channel. It is a `tenantAction` (retrieval needs an
action — `rag.search` is action-only), V8 runtime, explicit `Promise<>` return type.

- **Retrieval is scoped by the SESSION ROW's `docRef` — never by a model- or client-supplied id.**
  The model supplies only the free-text `query`. The document id is read off the row (already
  ownership-and-status-validated at `startSession`), so a prompt-injected "search document X"
  has nothing to steer: there is no document parameter to poison. A session that is missing, not
  this tenant's, already ended, or carries no `docRef` yields `{passages: [], found: false}`.
  Enforced by: the doc-scoping + BETA-05 cases in `voiceDoc.test.ts`.
- **`searchDocument` NEVER throws.** Every failure — including an unexpected one — returns
  `{passages: [], found: false}`. A tool call the browser cannot answer leaves the model waiting
  with no `function_call_output`, and the user hears silence for the rest of a turn inside a capped
  15 minutes (14-RESEARCH Pitfall 5). An honest empty result is always better than a thrown relay.
- **The `voicedoc.searched` audit payload is `{sessionId, queryHash, resultCount}` and NOTHING
  else** (§4). The `queryHash` is `lib/hash.ts contentHash()` — the `gmail.ts mailbox.searched`
  precedent. The split, restated: CONTENT PLANE = the passages, which go to the model over the data
  channel and nowhere else; LOG PLANE = refs, a hash and a count. The query is the user's own words
  about their own report, and the passages ARE report content — neither may enter the audit table.
  This is the module's ONLY log-plane write: no `agentSteps` row (that table has no text field by
  construction and `llmRedaction.test.ts` scans a closed allow-list), no `telemetry`, no
  `deadLetters`. Enforced by: the payload-keys assertion in `voiceDoc.test.ts` and (14-09) a
  mutation-verified static scan; `grep -c "audit.log" voiceDoc.ts` must stay `1`.
- **Caps:** at most `RETRIEVAL_MAX_PASSAGES` (3) passages totalling at most `RETRIEVAL_CHAR_CAP`
  (1,200) characters. Realtime input tokens are re-billed on every turn, so this is a hard total,
  not a target.
- **Blueprint standing context (BLPR-02):** `vaultGroundHydrated.spine` is prepended explicitly
  before the `docIds[i] !== docRef` filter. Putting it into the retrieval arrays would make that
  filter silently discard it. A separate `documentPassageCount` preserves all three document
  passage slots, and only document passages consume the 1,200-character retrieval budget. With
  `spine: null`, the returned passages are byte-identical to the pre-17.1 result.

**Accepted realtime-cost ceiling:** the spine rides every `search_document` call, and Realtime
input tokens are re-billed on every turn. The upgrade path is moving standing business context to
the session mint in `voiceToken.ts`; that is deliberately outside Phase 17.1.

**Doc scoping is POST-HOC, and that ceiling is deliberate (Open Question 2, resolved 14-03).**
`searchDocument` calls the frozen Phase-10 `internal.vaultGround.vaultGroundHydrated`, which searches
the tenant's WHOLE vault (`namespace = tenantId` — the isolation linchpin), then drops every hit whose
`docId` is not `docRef`. Accepted failure mode: when another document dominates the top-K, this
report's best passage can fall out of the window and a legitimate drill-in returns nothing — the same
shape as the Phase-12 grounding defect fixed in `f5c279e`. Two named upgrade paths, in cost order:

1. **Raise `rag.search`'s `limit` for a doc-scoped call** and keep filtering post-hoc. One number —
   but it lives in `vaultGround.ts`, which is Phase-10-owned, so it is a contract change.
2. **A real doc-scoped rag filter.** `@convex-dev/rag` 0.7.5 **does** support one (verified
   2026-07-26 against the installed types): `new RAG(…, {filterNames})` + `rag.add({filterValues})`
   + `rag.search({filters})`. It is not usable today — `vaultRag.ts` declares no `filterNames` and
   `embedDoc` passes `vaultDocId` as `metadata`, which the package documents as *"not indexed or
   filtered or searched"*, and filters only match entries **inserted** with those values. Taking
   this path means changing the single shared RAG instance **and re-embedding every existing
   entry**: a migration, not a swap.

Explicitly **not** a cache. Cost control for voice is time-cap-only by decision (ADR-005), so a
digest/retrieval cache would add a store to maintain for no bound the 15-minute wall clock does not
already give.

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

### The pure domain surface (14-02) — what each function owns

Three functions in `docSession.ts` carry the whole doc flow's domain logic. Every later plan
imports them from `@pikar/voice`; none of them may be re-derived in `convex/`.

- **`buildDocDigest({title, text, truncated})` → the mint-time document block.** Composition order
  is load-bearing: title → truncation disclosure (only when truncated) → `DIGEST_FENCE_OPEN` →
  the capped, marker-neutralized slice → `DIGEST_FENCE_CLOSE` → the one safety line. See the
  bounded-and-fenced invariant above.
- **`shapeDocReview(raw, {id, title})` → the persisted `evaluations` row.** Drops the malformed,
  welds the citations/route/playbook/rank, decides the verdict. See the two invariants above.
- **`composeDocMemo(turns, review, docTitle, date)` → the ONE vault artifact per doc session.**
  The memo IS the brief, document-flavored: it is built ON `composeBrief(turns, date)`, then the
  review fills the three headers the client brief leaves unused — `SUMMARY` (the verdict sentence),
  `DISCUSSION` (each finding as `- <label> [<citationTitle>]`, with the quoted passage on its own
  indented line in plain quotation marks ONLY when present), `OPEN QUESTIONS` (what could not be
  grounded) — with the gaps beneath under a plain `GAPS` label. Do NOT write a second brief
  builder and do NOT add `GAPS` to `BRIEF_HEADERS`: that set is what `planSeedFromBrief` uses to
  find section boundaries in BOTH brief flavors, so widening it changes how existing briefs parse.
  Plain text only (no `#`/`*`) — a memo is read in the vault, not rendered.

### Tool declaration: an OPEN branch, recorded not guessed (14-02)

`realtime.ts` gained `REALTIME_FUNCTION_CALL` (the `function_call` /
`function_call_output` / `name` / `call_id` / `arguments` item names read out of
`response.done`'s `response.output[]`), `SESSION_TOOL_KEYS` and `TOOL_CHOICE_AUTO`. **No new
event name was added** — the relay triggers off the EXISTING `responseDone: "response.done"`,
which this repo has already live-verified for metering, so a rename breaks in one place.

Directly above them sits a dated decision-record block that is deliberately **blank until
live-verify**: the TypeScript `client_secrets` reference lists `tools`/`tool_choice` on
`RealtimeSessionCreateRequest` and the REST reference for the same endpoint does not, and
`voiceToken.ts` has been wrong about this body TWICE. Plan 14-04 implements mint-time first and
falls back to a `session.update` over the data channel on a 400. **Whoever runs the live verify
fills in the `LIVE-VERIFIED ____-__-__:` line with the branch the API actually accepted** — that
line is the record, exactly as Phase 6 did for the `audio.input` nesting. Do not delete it and do
not fill it in from a doc page.

### `search_document` tool shape

`SEARCH_DOCUMENT_TOOL` is the **FLAT** Realtime shape — `{type, name, description, parameters}` — NOT
the Chat-Completions `{type, function:{...}}` nesting, which 400s the mint. Its `parameters` are
STRICT-legal: every key in `properties` also appears in `required`, and `additionalProperties` is
`false`. `docSession.test.ts` asserts both, including the absence of a `function` key.

### The doc-grounded mint (14-04) — `voiceToken.mintClientSecret({ docId? })`

The mint is where a voice session becomes *about a report*. It is also the **first** trust boundary
in wall-clock order: the browser mints BEFORE it has a session row (`useVoiceSession.ts:269` →
handshake → `voice.startSession`), so the mint validates the document itself and does not lean on
`startSession`'s check.

**Persona — registry-loaded, fail-closed, both branches (§5).** `docId` present ⇒
`DOCUMENT_ANALYST_SKILL`; absent ⇒ `VOICE_SESSION_SKILL`, byte-unchanged from Phase 6. Both go
through `internal.skills.getActiveSkill`, which throws `NO_ACTIVE_SKILL` when the persona has no
active row — there is **no hardcoded fallback prompt**, and no request leaves Convex when the
registry cannot answer. Because the two personas are separate rows, a Phase-14 prompt change
cannot regress the Phase-6 live-session behavior.

**Digest.** `instructions` = the persona body, a blank line, then `buildDocDigest(...)`. The digest
is already capped (`DIGEST_CHAR_CAP` on the document slice), fenced and truncation-disclosing in
`@pikar/voice` — **do not re-slice, re-fence, or add a behavioural line at the mint.** Every rule
the analyst follows is the registry body. The document row is read through a module-local
`voiceToken.docForMint` internalQuery, NOT `internal.vault.getDoc`: that query returns
`{text, contentHash, title}` with no `status` and no `extractionTruncated`, so it cannot answer
either the readiness check or the truncation disclosure (the same wrong premise 14-03 hit at
`startSession`). `docForMint` returns `null` for missing/cross-tenant so the mint owns the thrown
message, and the two boundaries speak with one voice: `voicedoc: document not found` /
`voicedoc: document not ready` — a STATUS, never content.

**The instruction budget is a real constraint, not a style note.** `gpt-realtime-2.1` is a 32k
window / 4,096 max output and `instructions` are re-billed as input on EVERY turn. Depth is
supposed to come from `search_document`. `voiceToken.test.ts` pins
`instructions.length < personaBody.length + DIGEST_CHAR_CAP + 500`, so a future digest change
cannot silently blow the budget.

**One tool, read-only — this is the tool-SET containment.** A doc-scoped body carries exactly
`tools: [SEARCH_DOCUMENT_TOOL]` and `tool_choice: "auto"` (keys via `SESSION_TOOL_KEYS`). No write,
no send, no plan mutation is reachable from a voice session at all, so an instruction planted in
the report **has nothing to actuate**. That matters more here than anywhere else in the repo: the
digest sits in the SYSTEM `instructions` field, a materially stronger exposure than ADR-006's
tool-RETURN case. Three containments and no fourth — the fence + its one safety line, this tool
set, and the human Approve gate on anything the post-call flow proposes. The `ponytail:` block in
`voiceToken.ts` names the upgrade path (move the digest out of `instructions` into a first
`conversation.item.create` user-role message, at the cost of first-second fluency).

**Open Question 3 — both branches ship, the answer is still blank.** The mint POSTs WITH `tools`
first (server-owned, and it races nothing — the tools exist before the data channel opens). On a
**400** — and only 400 — it re-POSTs the identical body minus `tools`/`tool_choice` and returns
`toolsAtMint: false`; any other non-OK status throws on the first attempt as before. This is a
SHAPE fallback, not a retry policy. `toolsAtMint` is the ONE deliberate extension to the Phase-6
`{clientSecret, expiresAt}` return contract — **transport control, not a secret and not document
content**; it is trivially `true` on an unscoped mint (nothing was declared, so the browser's
branch stays a single `if (!toolsAtMint)`). 14-06's relay sends
`{type:"session.update", session:{tools, tool_choice}}` over the data channel when it is false.
**The accepted branch is still NOT live-verified** — fill in the dated
`LIVE-VERIFIED ____-__-__:` line in `packages/voice/src/realtime.ts` at 14-09's live verify, from
the API's actual behavior, never from a doc page.

**What never leaves.** `OPENAI_API_KEY` is structurally absent from the return value, from every
thrown message (`mintClientSecret: <status>`) and from every log line. Nothing in this path writes
an audit row. `voiceToken.test.ts` asserts the exact key set and searches the serialized result for
the fake key.

Verify with `pnpm --filter @pikar/backend test voiceToken` (12 tests: persona, digest, flat tool
shape, the 400 fallback, the 500 throw, both refusals, fail-closed, and the unscoped Phase-6 body
pinned to no-`tools`-key).

### The review producer (14-05) — `voiceDoc.reviewSession` / `voiceDoc.reviewDocument`

This is where a finished discussion becomes a durable artifact. `reviewSession({sessionId,
transcript})` is the tenant-scoped entry the post-call screen calls; it validates ownership
(fail-closed, `voicedoc: session not found`) and delegates to the `internalAction`
`reviewDocument({tenantId, sessionId, transcript})`, which carries an EXPLICIT `tenantId` so it is
also callable from a context with no live identity. One shared implementation, the Phase-12
`applyScorecardAnswer` precedent — the write path cannot drift between callers.

**The findings row is an `evaluations` row — the existing table, unchanged.** `framework:
"document-review"` (14-01's one union widening) is what makes the whole downstream surface
inherited rather than rebuilt: per-finding citations, the affirmative healthy banner,
leverage-ranked gaps, "Act on this" → a proposed memo plan → the single Approve gate, and the
two-tenant isolation test all already exist and already work on this row. The row lands through the
UNMODIFIED `internal.evaluations.insertEvaluation`, whose arg validator is derived from
`schema.tables.evaluations.validator.fields` — **`evaluations.ts` gets zero edits, ever, for this
flow.** `scorecard: {}` and `userProvided: []` are passed because a document review has no Growth-OS
Scorecard and no user-provided figures; `delta` stays absent (that is the Phase-13 weekly-review
concept). The thread is the synthetic `voice-doc:<sessionId>` id documented above.

**STANDING TRAP — never route a document review through `runEvaluation`.** 14-01 pinned that
engine's `framework` arg to the four business frameworks, and `FRAMEWORK_SKILL` is a hand-written
`Record<Framework, …>` with no document-review entry, so an unmapped literal yields `undefined` and
`getActiveSkill(undefined)` throws mid-run. `voiceDoc.ts` deliberately names no entry point of that
engine at all, which makes the rule greppable: `grep -n "runEvaluation" convex/voiceDoc.ts` must
return nothing.

**The verdict rule is an INVARIANT, not a prompt** (`shapeDocReview`, 14-02):

- zero grounded findings ⇒ `verdict: "insufficient"` **and** `gaps` FORCE-CLEARED — a report the
  agent could not ground can never produce a fabricated gap, no matter what the model returned;
- findings and zero gaps ⇒ `verdict: "healthy"` — an affirmative "it holds up", not an empty result;
- otherwise ⇒ `verdict: "gaps"`.

**Any future assertion about this MUST use the anti-vacuous pairing** (the Phase-12
`28-healthy-no-gaps` lesson): `gaps.length === 0` alone ALSO passes on the thin-data `insufficient`
verdict, so a healthy assertion must pin `verdict === "healthy"` **and** `findings.length > 0`
**and** `gaps.length === 0` in the same test, and the no-fabricated-gap assertion must pin
`verdict === "insufficient"` **and** `gaps.length === 0` against a fixture that DOES offer gaps.
Both are in `voiceDoc.test.ts`, and the no-fabricated-gap one was mutation-verified (removing the
force-clear turns it red).

**Citations, route, playbook and rank are WELDED IN CODE.** The `jsonSchema` handed to
`generateObject` has no `citationDocId`, `citationTitle`, `verdict`, `route`, `playbook` or
`leverageRank` key — the model has nothing to omit or invent, which is what makes "every finding
cites the report" structural rather than prompted. The schema's type parameter is `RawDocReview`
(the pure 14-02 type), so a citation field cannot be added here without changing the domain type.
It is STRICT-mode legal: every key in each `properties` object also appears in that object's
`required` array (`required` is written AFTER `properties` so `llmRedaction.test.ts`'s scan pairs
them non-vacuously) and `additionalProperties: false` everywhere.

**`excerpt` is the ONE deliberate exception, and it is verified.** Only the model knows which
sentence it was talking about, so the quote TEXT — and only the quote text — comes from the model,
declared nullable-and-required (`type: ["string","null"]`, listed in `required`). Before shaping,
`withVerifiedExcerpts` whitespace-normalizes and lowercases both the excerpt and `doc.text` and
keeps the excerpt only when the document really contains it. **It drops the EXCERPT, never the
finding** — the doc-level citation floor still holds and an absent excerpt is a valid, non-degraded
state. `ponytail:` accepted ceiling — a substring test cannot tell that a genuine quote came from a
different part of the same document than the finding is about, and it rejects a legitimate quote
whose whitespace or hyphenation the extractor mangled; the upgrade path is a locator (chunk id +
offset) from `searchDocument`, which needs the chunk-level filter Open Question 2 tracks.

**§4 — the excerpt is report content and is BANNED from the log plane.** `voiceDoc.ts` has exactly
TWO `audit.log` call sites and no other log-plane write: `voicedoc.searched`
(`{sessionId, queryHash, resultCount}`) and `voicedoc.reviewed`
(`{sessionId, findingCount, gapCount, verdict}`) — refs, counts and a closed enum. No finding
label, no `citationExcerpt`, no passage, no transcript turn, not even the document title. No
`agentSteps`, no `telemetry`, no `deadLetters`. `reviewDocument` itself returns
`{findingCount, gapCount, verdict}` and nothing else, so prose cannot escape through the return
value either. 14-09 pins all of this with a mutation-verified static scan over this file.

**Idempotence is a READ-GUARD, not a patch.** `evaluations` is append-only, so `reviewSession`
reads `internal.evaluations.lastForThread` first and returns the existing row's counts when one
exists. The post-call screen re-mounts (a refresh, a dropped call resumed) and the user must see ONE
consolidated list, not three. `reviewSession` also returns `threadId` so the caller points
`CardList` at it without re-deriving the thread convention.

**Persona and offline seam.** The `document-analyst` body loads from the registry as the
`generateObject` `system` prompt (§5, fail-closed); the review prompt is the speaker-labelled
transcript plus the SAME `buildDocDigest(...)` block the agent saw at the mint, so the review reads
exactly what was discussed and inherits the fence and the cap. A first transcript turn beginning
`SMOKE::docreview::<healthy|gaps|empty>` returns a deterministic fixture with **no model call**,
which is what lets the entire retrieval → findings → row → `actOnGap` path run offline with no
`OPENAI_API_KEY`. The `gaps` fixture deliberately carries three findings — one whose excerpt is
lifted verbatim out of the seeded document, one with `excerpt: null`, one whose excerpt is nowhere
in the document — so all three excerpt states are covered offline. A live call's priced usage is
charged through `internal.guardrails.recordSpend` (the `intake.ts` idiom), so a review cannot spend
off-budget.

Verify with `pnpm --filter @pikar/backend test voiceDoc` (18 tests) and
`node scripts/check-playbooks.mjs check`.

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

### The browser relay (14-06) — `useVoiceSession(docId?)` and `?doc=`

**Entry contract.** `/dashboard/voice?doc=<vaultDocId>` opens a session about ONE report. No `?doc=`
⇒ the Phase-6 general session, byte-identical: no new branch, no new event, no extra send.

**One param reader, by design.** `page.tsx` reads `?doc=` ONCE and threads it as a prop to
`useVoiceSession`, `<LiveSession>` and `<PostCall>`. Neither child may re-read it — a second reader
is a second place to get the trust story wrong, and (if it used `useSearchParams`) a second Suspense
boundary to forget.

**`window.location.search`, NOT `useSearchParams` — deliberate.** This follows the established repo
idiom (`workspace/page.tsx`'s `?thread=` handoff, and connect-gmail before it). Next.js's App Router
requires a `<Suspense>` boundary around `useSearchParams`, and without one the page either errors at
prerender or SILENTLY deopts to client-side rendering — a failure `tsc`/`typecheck` cannot see at
all. Reading in a mount effect removes that failure class instead of guarding against it. Safe here
because `?doc=` is only needed when the user presses Start, many frames after mount. Plan 14-06's
own artifact list asked for `Suspense`; that was written against an assumption about
`workspace/page.tsx` that the file does not match. **If you ever switch to `useSearchParams`, you
must add the boundary AND re-run `pnpm --filter @pikar/web build`** — `/dashboard/voice` should stay
`ƒ (Dynamic)` in the build output.

**The retrieval relay triggers off `response.done`.** Not
`response.function_call_arguments.done`. Two reasons, both about confidence rather than elegance:
`response.done` is already live-verified in this repo, and the OpenAI guides state it carries the
complete `function_call` item. The `.delta`/`.done` argument-streaming events sit in exactly the
MEDIUM-confidence class `packages/voice/src/realtime.ts` warns about, and their field list was never
verified. Adding zero new pinned event names was the point.

**Placement inside the case matters.** The relay runs AFTER `responseActiveRef.current = false`.
That is what makes the trailing `response.create` legal — sent mid-response it silently 400s
("conversation already has an active response"), the exact failure that once swallowed the T-2min
wrap-up nudge.

**ALWAYS send a `function_call_output`, even on failure.** A tool call with no output leaves the
model waiting and the user hearing silence for the remainder of a capped 15 minutes. The failure
payload is an honest `{passages: [], found: false, error: "unavailable"}`. Never let a relay throw
into the void.

**Only the query crosses.** The document id is never sent from the browser.
`voiceDoc.searchDocument` reads `docRef` off the server session row, so nothing the model says can
widen the scope or select a different document. The `?doc=` string itself is untrusted and is
re-validated (ownership + `status: "ready"`) by BOTH `mintClientSecret` and `startSession`.

**No `docId &&` guard on the relay loop.** A Phase-6 session declares no tools, so
`response.output[]` can never hold a `function_call` item — the loop is already a no-op there. A
condition would instead silently disable any tool added later.

**Open Question 3's contingency is live.** When `mintClientSecret` reports `toolsAtMint: false` (it
re-POSTed without the tool array after a 400), the browser declares the tool over the data channel
via `REALTIME_CLIENT_EVENTS.updateSession`. It is attached to the channel's `open` event, NOT sent
immediately and NOT on a timeout: `createDataChannel` returns before the channel opens, and `send`
silently drops a closed-channel write, so a naive immediate send would lose the declaration with no
error anywhere. Which branch the API actually accepts gets recorded, with a date, on the
`LIVE-VERIFIED` line in `packages/voice/src/realtime.ts` during 14-09's live verify.

**No Realtime literal lives in `apps/web`.** Every event name, tool shape and session key resolves
through `@pikar/voice`. `apps/web` has NO unit runner (Playwright only), so a rename there is
uncatchable locally — `packages/voice/src/docSession.test.ts` pins the outbound vocabulary
(`conversation.item.create`, `response.create`, `session.update`, `call_id`, `arguments`) precisely
because that is the only place a test can see it.

**How to verify.** `pnpm --filter @pikar/web typecheck` (fast signal) then
`pnpm --filter @pikar/web build` (the real gate — see the Pitfall-6 note above), plus
`pnpm --filter @pikar/voice test` for the pinned vocabulary. The relay's REAL proof is the
human-verify row in 14-09: a live call where the user asks something the digest cannot answer and
the agent comes back grounded. There is deliberately no faked automated proof of a tool round trip.

### The entry point and the in-call context (14-07)

**The vault IS the PRIMARY entry point — by decision.** A ready document in `DocGrid` (and in
`PreviewModal`'s footer) links to `/dashboard/voice?doc=<id>`. 14-10 later added the pre-flight
`DocPicker` as an ADDITIVE second entry point — a ready-only courtesy for a session started from
`/dashboard/voice` directly, not a gate and not a replacement for the vault path (see "The
pre-flight picker (14-10)" below). **There is still no upload surface anywhere in the voice
session** — that part of the original decision holds; the picker only lists documents that were
already uploaded and extracted through the vault.

**The status gate is the phase's first honesty moment.** `ready` → enabled.
`processing`/`extracting`/`pending_extraction` → a **real `disabled` button**, never a `Link` with
`pointer-events: none` (a screen reader would announce an actionable control that silently does
nothing). `failed` → **no voice action anywhere**, plus copy in the modal explaining the likely cause
and the next step. Two reasons this matters beyond politeness: never open a grounded conversation the
agent cannot ground, and never burn capped 15-minute session time on a document still being read.

**The gate is subscription-driven. Do not add a poll.** `vault.listVaultDocs` is a live Convex query
returning whole rows including `status`, so the control re-renders enabled on its own the moment
extraction finishes. No timer, no second query, no refresh button. This is stated in a source comment
too, because it looks like something that needs "making live" and does not.

**Sibling, not nested.** The document card is itself a `<button>`, so the Discuss control is an
absolutely-positioned sibling in the card's relative wrapper — the same trick the failed-card Retry
already used. Nested interactive elements are invalid HTML and destroy keyboard order. Both controls
share the corner because their statuses are mutually exclusive, and a shared `discussPillStyle()`
keeps the enabled and disabled variants in the identical spot so the control does not jump under the
user when the status flips mid-look.

**`voiceDoc.docContext` — why a fourth doc read exists.** It projects exactly
`{title, status, truncated}`. It does NOT reuse `listVaultDocs`, which `.collect()`s whole rows
including `text`: rendering a title through that would pull a book-sized blob onto the voice page.
A test pins the returned key set to exactly `[status, title, truncated]` and asserts the absence of a
`text` key, so a future "just return the row" simplification fails loudly. It is fail-closed
cross-tenant by returning `null`, not by throwing — a throw distinguishes "exists but not yours" from
"no such document", which is an ownership oracle (BETA-05).

**`DocStrip` renders nothing for both `undefined` and `null`.** Loading and not-your-document are
deliberately indistinguishable in the UI: a "not found" message would confirm the id exists, and a
loading flash during a live call is noise at the worst possible moment.

**The "partial" badge is the visual half of one honesty moment, not the whole of it.** The agent also
says it aloud in its opening turn. Keep both: audio scrolls past, a badge persists for the whole
call. It uses `--ink-soft` on a ruled chip rather than teal text — BRAND §6, `--teal-600` is ~2.9:1
on white and is for button fills with white text — and it carries the literal word "partial" so the
meaning is never colour-only.

**No live insights panel.** Explicitly deferred in `14-CONTEXT.md`. Insights land on the post-call
screen, after the discussion, where the user decides what to do with them. `DocStrip` is a context
strip, not the seed of an in-call dashboard.

**The strip links to `/dashboard/vault`, not a hoisted `PreviewModal`.** That modal owns
download/delete/retry and a doc-entities subscription; putting destructive actions one mis-tap away
from an in-progress voice conversation is the wrong trade. The smaller diff is also the safer product.

**How to verify.** `pnpm --filter @pikar/backend test voiceDoc` (the `docContext` projection +
fail-closed behaviour), then `pnpm --filter @pikar/web typecheck` and
`pnpm --filter @pikar/web build`. The three status states and the partial badge are **visually**
confirmed in 14-09's human-verify row — no automated claim is made about how they look.

### The post-call outcome (14-08) — where the user decides

**One expensive call, run once.** `PostCall` fires `voiceDoc.reviewSession` from a `useRef` guard, not
from a dependency array. `reviewSession` is also idempotent per session server-side (it returns the
existing row rather than patching it), so this is belt-and-braces — deliberately, because it is the
only model call on the page and a double-fire would be paid for twice.

**A failed review must never cost the user their conversation.** On error the screen falls back to the
plain brief, says so in the `aria-live` status, and the save path stays open. The memo is the
artifact; the findings are the bonus.

**The memo IS the brief, document-flavoured.** Seeded from `composeDocMemo` once the row lands, then
stored through the SAME `endSessionClean` → `briefRef` spine Phase 6 uses. That is what makes "exactly
ONE new thing in the vault" true for free, including on the abnormal path — the idempotence is
**inherited, not re-implemented**. Do not add a second write and do not call `persistBrief` directly.
Pinned by two `voice.test.ts` cases (repeat store, and the abnormal end).

**The re-seed is guarded.** `memoSeededRef` means the editor is re-seeded ONCE. After that the
textarea belongs to the user, and a late subscription tick must not clobber an edit in progress.

**The findings render IN PLACE, via the exported `CardList`.** One component delivers the cited
findings, the affirmative healthy banner, each gap's wired "Act on this", and the memo `PlanCard` with
the single Approve. No new card idiom, no second query (it holds the same `evaluations.byThread`
subscription `PostCall` reads for the memo, so Convex dedupes it), and **no route jump**.

**NEVER route a voice-doc thread to the workspace.** `PostCall`'s doc branch has no "Continue with
your agent" button, and nothing may add one. That button calls `sendCockpitMessage` and pushes
`/dashboard/workspace?thread=<id>`; on this branch the thread is the SYNTHETIC
`voice-doc:<sessionId>`, which is not a Convex Agent thread, so a composer there would throw
(Pitfall 7). The gap → `actOnGap` → `proposed` plan → Approve path already reaches the real pipeline
without leaving the screen. `voice-doc.spec.ts` drives that workspace URL as a **test harness only**
and carries a comment saying so.

**One footer action on the doc branch.** Acting on a gap already lives inside the card, so a second
footer control would give the user two controls for one decision.

**What `actOnGap` actually does on a second tap** — worth knowing before "fixing" it: a second tap on
a still-`proposed` plan SUCCEEDS by recycling the row, which is correct (changing your mind about
which gap to act on should restage the memo). `plan_busy` is only for a plan that is mid-flight or
delivered. The invariant to protect is that there is never a SECOND `plans` row, because
`plans.byThread` is a `.unique()` read and a duplicate makes every later read THROW.

**Fixture discipline.** `smoke:seedVoiceDocSession` seeds two findings — one WITH a
`citationExcerpt`, one WITHOUT — so the e2e covers both render paths. Its `section` values must come
from `DOC_REVIEW_SECTIONS` (`insight | pattern | strength | risk`): 14-01 originally seeded
`section: "findings"`, which `shapeDocReview` **drops**, so the fixture described a row production
can never emit and the spec would have passed against an impossible shape. **A fixture that is not a
legal row is not a fixture.** Keep the seeded excerpt a verbatim substring of the seeded text, too —
the producer substring-verifies it.

### The pre-flight picker (14-10)

**An ADDITIVE second entry point, not a replacement.** The vault (`DocGrid` / `PreviewModal` →
`/dashboard/voice?doc=<id>`) remains the PRIMARY way in. Before 14-10, a session started directly
from `/dashboard/voice` had no way to name a document at all and left the agent with no vault
reach. `DocPicker.tsx` closes that gap with a paperclip toggle → searchable ready-only list → chip,
threaded through `page.tsx`'s existing `docId` state (the same state `?doc=` already writes), so
`useVoiceSession` needed NO change. **Still no upload surface anywhere in the voice session** — the
picker only lists documents already uploaded and extracted through the vault.

**READY-ONLY BY CONSTRUCTION, and a COURTESY, NOT A GATE.** `voiceDoc.pickableDocs` (tenantQuery)
lists only this tenant's `status: "ready"` documents with non-blank text, newest-first, scanning the
newest `PICKER_DOC_SCAN_CAP` (50) rows; non-ready rows are counted (`processingCount`), never
listed, so a just-uploaded file does not appear to vanish. Offering any other row would be offering
a click `voice.startSession` refuses. **The trust boundary did not move**: `startSession` and
`voiceToken.mintClientSecret` each still re-validate ownership and `status: "ready"` from scratch —
nothing the picker sends is trusted, and nothing here may become client-side validation that implies
otherwise. Deliberately NOT `vault.listVaultDocs` (whole rows including `text`) — the same
`docContext` projection rule 14-07 established.

**The chip must never assert a readiness it never checked.** `DocPicker` resolves the current
selection through `voiceDoc.docContext` (title + status + truncated) rather than trusting the list,
because a `?doc=` arrival can name a document the component never saw in `pickableDocs` — a
cross-tenant/deleted id (`docContext` → `null`) or a document still being read
(`status !== "ready"`). The chip renders nothing while the query is loading, an honest
"unavailable"/"still being read" message in those two cases, and the ordinary "the assistant can
read this document" sentence ONLY once `status === "ready"`. This was a real bug in the first cut
(the chip showed the ready sentence unconditionally off `title` alone) — keep the `status` branch
whenever this component changes.

**Focus is moved by hand across the list↔chip swap.** Picking a row unmounts the focused row
`<button>`; clearing the chip unmounts its focused ✕. Both would otherwise drop a keyboard user onto
`<body>` (BRAND §6). `DocPicker` records the intended focus target at click time in a ref and an
effect with no dependency array retries every render until that target exists in the DOM (the chip
can take an extra render tick to mount once `docContext` resolves) — a `useRef` + `.focus()`, no new
dependency.

**Ceiling — voice briefs and doc-review memos fill the picker too.** `voice.persistBrief` inserts
one `Voice brief — <date>` `vaultDocuments` row (`kind: "brief"`) per session, and 14-08's memo is
stored through that SAME write path, so both become `ready` and are listed by `pickableDocs` —
newest-first, meaning right at the top, with near-identical date-only titles — and they occupy
slots in the `PICKER_DOC_SCAN_CAP` = 50 scan window, so a real upload can scroll out of "the 50
newest documents" sooner than that number implies. **No `kind` filter was added** — excluding
briefs/memos from the picker is a spec change, not a bug fix, and was explicitly out of scope here.
Upgrade path if this becomes a real problem: filter `row.kind !== "brief"` in `pickableDocs`'s scan
loop (`voiceDoc.ts`).

**How to verify.** `pnpm --filter @pikar/backend test voiceDoc` (the six `pickableDocs` cases:
ready-only + newest-first, non-ready excluded-but-counted, `failed` neither listed nor counted, an
empty-text ready row refused, a no-text-field ready row refused, cross-tenant empty), then
`pnpm --filter @pikar/web typecheck` and `pnpm --filter @pikar/web build` (`/dashboard/voice` must
stay `ƒ (Dynamic)`). The chip's three states (loading/unavailable/not-ready/ready) and the focus
moves are **visual/keyboard checks, manual-only** — no automated claim is made about how they look
or where focus lands.

---

## Voice-doc: the consolidated Phase-14 record (14-09)

Six plans appended to this file as they landed. This section is the coherent version — the
invariants, the traps, how to verify, and the accepted ceilings. The per-plan sections above remain
as the build history; **this is the part to read before changing anything.**

### What it is

A user opens `/dashboard/voice?doc=<vaultDocId>` from a ready vault report and holds a live voice
conversation grounded in that one document. Afterwards they get cited insights / patterns / gaps and
choose an outcome: save a memo, or turn a gap into a plan that crosses the normal Approve gate.

### The entry contract

- The **vault is the PRIMARY entry point**; the 14-10 pre-flight `DocPicker` is an ADDITIVE second
  one — ready-only, a courtesy and never a gate (`startSession` / `mintClientSecret` still
  re-validate). **There is still no upload surface anywhere in the voice session.** See "The
  pre-flight picker (14-10)" below.
- `ready` → enabled. `processing` / `extracting` / `pending_extraction` → a **real `disabled`
  button**, never a dead-styled link. `failed` → **no voice action at all**, with copy saying why and
  what to do next.
- The gate is **subscription-driven**: `listVaultDocs` is a live query, so the control enables itself
  when the status flips. **No poll, no timer, no second query — and none should be added.**
- The `?doc=` value is read **once**, in `page.tsx`, via `window.location.search` in a mount effect
  (not `useSearchParams`), and threaded as a prop to `useVoiceSession`, `<LiveSession>` and
  `<PostCall>`. Neither child may add a second reader.

### Grounding is HYBRID, and both halves are load-bearing

1. **A bounded, fenced digest at mint time** (`buildDocDigest`, `DIGEST_CHAR_CAP`) — so the agent's
   very first sentence is specific to the report rather than a generic greeting.
2. **ONE read-only relayed retrieval tool** (`search_document` → `voiceDoc.searchDocument`) — so a
   question the digest cannot answer is answered from the document instead of guessed.

Neither alone is sufficient: the digest cannot hold a long report, and a cold tool-only session opens
with nothing to say. Budget against a **32k context / 4,096 max output** window for
`gpt-realtime-2.1`.

### §4 — the log plane, quoted verbatim

The module makes **exactly two** log-plane writes, and the count is pinned by a test:

```
voicedoc.searched  payload: { sessionId, queryHash, resultCount }
voicedoc.reviewed  payload: { sessionId, findingCount, gapCount, verdict }
```

`queryHash` and `resultCount` are derived **outside** the payload literal (the `gmail.ts:279`
`mailbox.searched` shape) so the literal contains only bare refs and counts and the static scan needs
no carve-out. **The retrieval relay writes no `agentSteps` row** — that table has no text field by
construction, and its closed allow-list scan already lives in `llmRedaction.test.ts`. No `telemetry`,
no `deadLetters`.

**`citationExcerpt` is the most dangerous identifier in the phase.** It is verbatim report content:
legal in the `evaluations` row, legal on screen, and **illegal in every `payload:` object and every
`agentSteps` row**. Eight mutation-verified scans hold this line, including one over the three UI
components that read it.

### The honesty invariants

- Zero grounded findings ⇒ `verdict: "insufficient"` and gaps **force-cleared**. The engine cannot
  report a gap it has no evidence for.
- Findings present and no gaps ⇒ `verdict: "healthy"`, stated affirmatively and in **document**
  language ("no gaps in this report"), never business language ("your business is solid here").
- **Any future assertion must keep the anti-vacuous pairing:** `verdict === "healthy"` **AND**
  `findings.length > 0` **AND** `gaps.length === 0`. `gapCount === 0` alone also passes on the
  thin-data `insufficient` verdict, so on its own it proves nothing (the Phase-12
  `28-healthy-no-gaps` lesson).

### Welded in code — what the model may never author

`citationDocId`, `citationTitle`, `route`, `playbook`, `leverageRank` and `verdict` are all set by
`shapeDocReview` in pure code. The model output schema **has no such field**, which is Success
Criterion 2 by construction rather than by instruction — a test asserts their absence.

**The ONE model-authored citation input is `excerpt`** (the locked "quoted passage where available"
half): only whoever read the passage can quote it. It is capped at `EXCERPT_CHAR_CAP`,
whitespace-normalised **substring-verified against the document text** (on failure the *excerpt* is
dropped, never the finding), optional by design, and rendered only when present. A test asserts its
**presence** in the schema so a "tighten the schema" cleanup cannot silently delete half a locked
decision.

### The persona is UNGATED, by decision

The `document-analyst` skill row is seeded **ungated** (owner decision, 2026-07-25), following the
`voice-session` / `voice-brief` precedent. **Do not "fix" this by adding it to `GATED_SKILLS`.** The
reason is structural: `run-eval-golden.mjs` validates `--skill` against a closed `SKILL_NAMES` list
and drives `runCockpitAgent` over text fixtures — it **cannot** exercise a Realtime voice persona, so
gating it would create a permanent activation deadlock the first time the body is edited. SC #2's
honesty proof lives instead in the code-level verdict rule, the `voiceDoc.test.ts` fixtures, and the
live human-verify.

### Standing traps

- **Never call `runEvaluation` with `document-review`.** Its validator is deliberately pinned to the
  four business frameworks and must not be re-derived from `evalFields.framework` — a doc-review row
  has no rubric skill and no `diagnose()` path.
- **Never route a voice-doc synthetic thread to the workspace composer.** `voice-doc:<sessionId>` is
  not a Convex Agent thread: reads degrade gracefully, but `sendCockpitMessage` would throw. The e2e
  drives that URL as a **test harness only**; no navigation entry point to it may ever be added.
- **Never add a second `"use node"` Convex module.** `llm.ts` is the one, and a second re-triggers the
  TypeScript circular-inference cliff that collapses the generated API to `any`. Every handler here
  carries an explicit `Promise<...>` return type for the same reason.
- **Never widen `BRIEF_HEADERS`** to include the memo's `GAPS` label — that set is what
  `planSeedFromBrief` uses to find section boundaries in both existing brief flavours.

### Accepted ceilings, each with its upgrade path

- **Doc-scoped retrieval is post-hoc filtered.** `vaultGroundHydrated` searches the whole tenant vault
  and non-matching docs are dropped after the fact, so a report's best passage can fall out of the
  top-K when another document dominates. Upgrade, in cost order: (1) raise `rag.search`'s `limit` for
  the doc-scoped call — one number, but it lives in Phase-10-frozen `vaultGround.ts`; (2) a real
  per-entry filter, which `@convex-dev/rag` 0.7.5 **does** support (`filterNames` / `filterValues` /
  `filters`, verified against the installed types) but which is unusable today because `vaultRag.ts`
  declares no `filterNames` and `embedDoc` passes `vaultDocId` as unindexed `metadata` — adopting it
  means changing the shared RAG instance **and re-embedding every entry**. A migration, not a swap.
- **Prompt injection via the digest.** The digest sits in the **system** `instructions` field, a
  stronger exposure than ADR-006's tool-return case. Containment is the **tool set**: exactly one
  read-only tool, so an instruction planted in a report has nothing to actuate. Upgrade path: move the
  digest into a first `conversation.item.create` user-role message, at the cost of first-second
  fluency.
- **`listVaultDocs` returns whole rows including `text`** (`vault.ts:230` `.collect()`), which gets
  heavy once reports are book-sized. Pre-existing and **deliberately not fixed in this lane** — an
  observation only. This is why the voice page reads `voiceDoc.docContext` (a three-field projection)
  instead.
- **Cost control is time-cap-only** (ADR-005). There is no retrieval cache by decision; the 15-minute
  wall-clock watchdog is the bound.

### How to verify

**Automated:** `pnpm --filter @pikar/backend test voiceDoc` (doc scope, retrieval, SC2 honesty,
BETA-05) · `test voice` (one artifact per session) · `test gapAction` (gap → proposed memo → Approve
gate intact, zero `requests` rows) · `test voiceToken` (mint body, fail-closed persona) ·
`test llmRedaction` (the eight §4 scans) · `pnpm --filter @pikar/voice test` (the pure domain and the
pinned Realtime vocabulary) · `pnpm --filter @pikar/web typecheck` **then**
`pnpm --filter @pikar/web build` — the build is the only gate that catches a prerender/Suspense
regression, and `/dashboard/voice` must stay `ƒ (Dynamic)`.

**Manual-only, and honestly so:** the live drill-in, interrupt/redirect, the spoken "no gaps", the
truncation disclosure, the real memo-vs-plan choice, and which tool-declaration branch the API
accepts. `apps/web/e2e/voice.spec.ts` is deliberately offline and the golden runner cannot drive a
voice persona, so these are human-verify rows in `14-VALIDATION.md` — never faked as automated.

### Operations

- The persona and every prompt load from the `skills` registry and **fail closed** when unseeded: an
  unseeded deployment refuses to mint rather than falling back to a hardcoded prompt. If a live
  session errors immediately, check `getActiveSkill("document-analyst")` first.
- The 15-minute cap is a **server-side watchdog** armed against the `call_id` at `startSession`. It is
  never re-armed or extended — a mic-loss grace period and a silence fall-through both consume cap
  time.
- Retrieval round-trip latency inside the cap is **unmeasured** in-repo; the live-verify step records
  it. If it is slow, the knob is a larger pre-load digest, not a cache.
  **Still unmeasured after the 14-09 live-verify (2026-07-26).** The owner confirmed the drill-in
  returns a grounded answer on a real call but did not time it, so there is no number to record —
  and an invented one would be worse than none. It has never been observed as a *problem*, which is
  weak evidence it is acceptable, not evidence it is fast. Measure it the first time someone reports
  the call feeling slow, before reaching for the digest knob.

### Live verification — 14-09 Task 3 (owner, 2026-07-26)

Run ONCE on integrated `main`, per `PARALLELIZATION.md` Stage 3. **Owner-confirmed working:**

- the agent discussed the uploaded report itself (the flagship opening, grounded in that document);
- a mid-call **drill-in** returned a grounded answer — which is what proves the `search_document`
  relay reached the model and was called;
- **both outcome paths**: the memo saved as a markdown artifact in the vault, AND a gap turned into
  a plan that produced an email through the ordinary Approve gate.

That is SC1, SC2 and SC3 exercised against a real call, a real model and real duplex audio.

**Not captured, deliberately left open:** which tool-declaration branch the API accepted
(Open Question 3 — see the long note at `packages/voice/src/realtime.ts:107`; `toolsAtMint` is
returned to the browser and never persisted, so it cannot be recovered after the session) and the
retrieval latency above. Neither blocks the phase; both are one line of instrumentation away
whenever the next session runs.

**A trap this verification exposed, worth more than the checklist itself:** the first live attempt
produced a *generic assistant* with no persona and no vault reach, which read exactly like a
grounding failure. It was not. `pnpm start` serves a **frozen production build** — the running
bundle had been compiled 4h14m BEFORE the first Phase-14 commit, so no picker, no `?doc=`, no
`docId` at the mint, and therefore no document scope. **Rebuild (`pnpm build`) before any voice
UAT, and check the build timestamp against `git log` before believing a UI-level symptom.**
