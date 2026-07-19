# Phase 6: Live Voice Sessions - Research

**Researched:** 2026-07-20
**Domain:** Realtime browser-direct voice (OpenAI Realtime API / WebRTC), Convex durable watchdog, brief generation + vault ingest, plan handoff
**Confidence:** HIGH on stack + all four internal seams; MEDIUM on the exact Realtime call/hangup REST field names (verify at plan time against the live doc)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (NOT open for planning to revisit)
- **15-minute hard cap** — product constraint, bounds cost, not configurable up. Enforced by a **server-side watchdog** (wall-clock).
- **Responsive web only** — no native mobile app.
- **WebRTC browser-direct + server-side watchdog + per-session token metering.**
- **Brief lands in the knowledge vault; approved plan uses the *existing* review gate** (no new pipeline).
- **Conversation feel:** open-mic VAD (hands-free), **barge-in YES** (requires echo cancellation), agent voice warm & professional, **multilingual auto-detect** (brief generated in the spoken language).
- **Live UI:** live scrolling transcript + small animated speaking orb; always-visible 15-min countdown (understated early, emphasized near cap); always-visible prominent End button that requires a **lightweight confirm**; **pre-flight** step (mic permission + mic check + one-time consent notice) before Start.
- **Approaching cap:** ~T-2min UI warns AND agent is instructed to start wrapping up; clean end at 0:00.
- **Abnormal end** (tab close / drop / crash): watchdog detects, terminates cleanly, **still generates a brief** from the conversation up to the drop. Nothing lost.
- **No session count/daily cap at beta**; prevent *parallel* sessions if cheap. **Cost control = time-cap-only** (meter + `recordModelSpend`; rely on the 15-min cap).
- **Brief review SPLIT BY END TYPE (the key reconciliation):**
  - **Clean end** → brief shown for review/edit, THEN stored+indexed in the vault.
  - **Abnormal end** → brief **auto-stored** (no one present to gate), surfaced for review next app open. **Both paths must be built.**
- **Plan permission (VOIC-04)** asked on the **post-call summary screen** ("Turn this into a plan?" / "Just save") — works identically for clean and dropped sessions.
- **Approved plan handoff** → creates a plan and **jumps the user into that plan in the cockpit/workspace at the normal review gate** (same single-Approve flow; reuse the pipeline entirely).
- **Brief shape:** decisions + action items first, supporting narrative below. Fixed multi-section structure, empty sections marked "None". Suggested sections: Summary, Decisions, Action items, Open questions, Discussion (narrative), Transcript. **Full turn-by-turn transcript kept** (text-only).
- **Consent:** one-time pre-flight notice ("This conversation is transcribed and saved to your vault") before Start.
- **Audio retention:** **discard raw audio** — only transcript + brief persist. Realtime audio streams through, never stored.
- **PII handling:** the brief/transcript is **first-class vault content** and CAN contain PII (do NOT redact PII out of the brief itself). **Audit/telemetry/DLQ rows stay refs/counts-only** (convention #4).
- **Isolation:** standard tenant scoping via the existing wrapper — no voice-specific access controls.
- **Mic drop / permission revoked mid-session:** pause + warn + allow recovery within a grace window; only if it does not recover → abnormal-end + brief. Reconcile with the wall-clock cap.
- **Prolonged silence:** agent gently checks in once/twice; continued silence eventually ends the session + brief.
- **Accessibility:** text-input fallback during a voice session (type a turn, agent replies by voice + transcript); FULL keyboard operability + screen-reader announcements for state changes. Non-negotiable per BRAND.

### Claude's Discretion
- Exact WebRTC stack / signaling and whether to use OpenAI Realtime API (OpenAI is already the LLM provider via `@ai-sdk/openai` + `OPENAI_API_KEY`).
- The specific realtime voice id (within "warm & professional").
- Watchdog implementation (Convex scheduled function / durable timer vs action-retrier) and how "clean termination on tab close" is detected server-side.
- Orb/waveform visual design, transcript styling, error-copy wording (within BRAND).
- Grace-window durations (mic recovery, silence check-in) and exact T-2min warning styling.

### Deferred Ideas (OUT OF SCOPE)
- By-voice "turn this into a plan?" ask at end-of-call (nice-to-have fast-follow; the summary screen is the required path).
- Persisting raw audio for playback (discard audio for beta).
- Multi-language brief *translation* (vs generation in the spoken language).
- Session sharing / multi-party voice / scheduled voice sessions (separate capabilities, own phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VOIC-01 | Live bidirectional voice conversation with the Executive Agent (WebRTC realtime) + End-session button | OpenAI Realtime API browser-direct WebRTC + ephemeral client-secret mint (§Standard Stack, Pattern 1). Client `RTCPeerConnection` + mic track; server never sees `OPENAI_API_KEY` in the browser. End button = clean-end path (§Pattern 3). |
| VOIC-02 | Server-side watchdog hard-caps sessions at 15 min + terminates cleanly + per-session token metering | Convex `scheduler.runAt(startedAt+15min, forceEndSession)` durable timer (review.ts / cockpit.ts precedent, §Pattern 2). Force-terminate via `POST /v1/realtime/calls/{call_id}/hangup` with `OPENAI_API_KEY` (server-addressable, §Pattern 2). Metering via `response.done` usage events → new `priceRealtime()` → `recordSpend` (§Pattern 4). |
| VOIC-03 | Ended session → detailed structured markdown brief, stored + indexed in the vault | New gated `voice-brief` skill + `draftVoiceBrief` internalAction mirroring `digestInbox`/`draftDocument` (§Pattern 5). Brief = "just another vault document" → reuse `vaultIngest.ingestDoc` verbatim (§Pattern 6). Both clean-end (review→store) and abnormal-end (auto-store) paths. |
| VOIC-04 | At session end, agent asks permission to convert brief → plan; approved plan enters the normal pipeline with the review gate | Reuse `cockpit.sendCockpitMessage` — seed a cockpit thread with the brief's Decisions/Action-items as the opening turn → Executive Agent drafts a PLAN card → existing single-Approve review gate (§Pattern 7). No new pipeline. |
</phase_requirements>

## Summary

The four requirements are satisfied by **OpenAI's Realtime API alone, browser-direct over WebRTC**, with **zero new backend dependencies** and **no new pinned pre-1.0 Convex component**. OpenAI is already the provider (`@ai-sdk/openai` + `OPENAI_API_KEY`); the Realtime API is a REST + WebRTC surface reachable with the same key. A managed provider (LiveKit) is unnecessary and would add auth surface, a second vendor, and a new dep for no gain — it is explicitly *not* recommended.

The decisive fact for VOIC-02: a WebRTC realtime call is **server-addressable**. When the browser POSTs its SDP offer to `POST /v1/realtime/calls`, OpenAI returns a **`call_id` in the `Location` header**. The Convex backend stores that `call_id` and can **force-terminate the media session server-side** with `POST /v1/realtime/calls/{call_id}/hangup` (Bearer `OPENAI_API_KEY`) — independent of the browser. This is what makes a Convex durable watchdog able to enforce the 15-minute wall-clock cap even on a hung/gone tab, and it is why OpenAI Realtime "cleanly force-terminates" the way the locked constraint requires.

Every other seam already exists in the repo and is reused verbatim: the **durable watchdog** copies the `scheduler.runAt` + cancellable `scheduledFunctionId` pattern from deferred-send (`cockpit.ts`) and the review-timeout (`review.ts`); **metering** rides `recordSpend`/`recordModelSpend`; the **brief** is generated by a new gated skill + a toolless `generateObject` action mirroring `digestInbox`, then ingested as an ordinary vault document through `vaultIngest.ingestDoc`; the **brief→plan handoff** re-enters the cockpit via `sendCockpitMessage` and lands at the unchanged single-Approve gate. New surface is small: one `voiceSessions` table, one plain-runtime mint/hangup action, one node brief-drafting action, two thin adapter mutations, one pure-TS brief module, two skill rows, and the `/dashboard/voice` UI.

**Primary recommendation:** Build on OpenAI Realtime API (`gpt-realtime-2.1`) browser-direct WebRTC with an ephemeral client secret minted server-side; arm one non-re-armed `scheduler.runAt` watchdog at `startedAt+15min` that force-hangs-up via `call_id` and always generates a brief; reuse the vault-ingest and cockpit-plan pipelines wholesale.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| OpenAI Realtime API | `gpt-realtime-2.1` (GA; `-mini` for cheaper) | Bidirectional speech-to-speech, VAD, barge-in, multilingual, transcription | Already the provider; one `OPENAI_API_KEY`; browser-direct WebRTC needs no media server |
| Browser WebRTC (`RTCPeerConnection`, `getUserMedia`) | Native platform | Peer connection + mic capture + echo cancellation | Native — no lib. `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})` gives the echo cancellation barge-in requires |
| Convex `scheduler` (`runAt`/`cancel`) | pinned (in-repo) | Durable 15-min watchdog timer, cancellable on clean end | Exact precedent: `cockpit.ts` deferred-send, `review.ts` timeout |
| `@convex-dev/workflow` (`ingestDoc`) | pinned (in-repo) | Brief → embed → extract → ready | Reused verbatim — a brief is "just another vault document" |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ai-sdk/openai` + `ai` (`generateObject`) | in-repo pinned | The toolless `draftVoiceBrief` structuring call | Mirror `digestInbox`/`draftDocument` — fail-closed skill load, DEFAULT→CHEAP fallback, `recordModelSpend` |
| `navigator.sendBeacon` / `pagehide` | Native | Best-effort prompt abnormal-end signal on graceful tab-close | Enhancement only; the watchdog is the authoritative backstop |
| `@pikar/cost` (new `priceRealtime`) | in-repo | Map realtime audio/text token counts → USD for `recordSpend` | Realtime pricing differs from chat — new pricing table entry |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| OpenAI Realtime browser-direct | **LiveKit** (managed realtime) | Adds a second vendor, its own auth/token surface, a client SDK dep, and a media server — for barge-in/echo/multilingual that OpenAI already does. **Rejected** (ponytail: no new dep, no new pinned component). |
| Raw `RTCPeerConnection` client | `@openai/agents-realtime` (client SDK) | The SDK wraps event parsing + interruption handling (~saves client glue). But it is a **new client dependency**; raw WebRTC is ~60 lines. **Recommend raw WebRTC**; adopt the SDK only if event/transcript handling proves heavy in the live-verify (name it a ponytail escape hatch, not the default). |
| A separate summarization model | Reuse `DEFAULT_MODEL`/`CHEAP_MODEL` via `draftVoiceBrief` | None — same governed spend rails, same fallback, same registry-skill discipline. |

**Installation:** No new npm packages required for the backend. (Client is native WebRTC; if the team later chooses the SDK escape hatch, that is a `apps/web` dep only — never a pinned Convex component under CLAUDE.md #6.)

**Verify at plan time (MEDIUM confidence — post-cutoff API):** the exact request/response JSON for `POST /v1/realtime/client_secrets` and `POST /v1/realtime/calls`, and the `hangup` path, against `https://developers.openai.com/api/docs/guides/realtime` and the Calls API reference. Models moved to `gpt-realtime-2.1`/`-mini` on 2026-07-06 (past training cutoff) — confirm the current default snapshot name.

## Architecture Patterns

### Recommended Module Layout (CLAUDE.md #1 — domain in `packages/*`, `convex/` thin)

```
packages/voice/ (or fold into packages/core)   # PURE TS, no Convex
├── brief.ts          # buildBriefMarkdown(transcript, sections) → fixed-section md, empty→"None"
├── session.ts        # status FSM (active|wrapping|ended_clean|ended_abnormal); capEndsAt(startedAt)
└── metering.ts       # accumulateUsage() helper (audio in/out/text token tallies)

packages/cost/src/cost.ts        # + priceRealtime(inAudioTok,outAudioTok,textTok) + REALTIME_PRICING

packages/backend/convex/
├── voice.ts          # DEFAULT runtime (NOT "use node") — tenant-wrapped mutations/queries:
│                     #   startSession, recordUsage, endSessionClean, forceEndSession (watchdog),
│                     #   storeBrief, getActiveSession (parallel-session guard)
├── voiceToken.ts     # DEFAULT-runtime action(): mintClientSecret() + hangupCall() — global fetch
│                     #   to OpenAI; reads OPENAI_API_KEY from env; NEVER returns the key to client
├── llm.ts            # + draftVoiceBrief internalAction (node — llm.ts is the ONLY node module)
apps/web/app/(app)/dashboard/voice/   # pre-flight → live session → post-call summary UI
```

Rationale for `voiceToken.ts` being a **plain `action`, not `"use node"`:** minting the ephemeral secret and calling hangup are just `fetch` to `api.openai.com`, which works in Convex's default V8 runtime (same as `gmail.ts`'s `fetch` calls, which are only `"use node"` for MIME/crypto reasons). Keeping it out of the node runtime avoids re-triggering the TS circular-inference cliff that `llm.ts`'s header comment warns is caused by a *second* `"use node"` module. `draftVoiceBrief` must live **inside `llm.ts`** for the same reason (it is a `generateObject` call and llm.ts is the sole node module).

### Pattern 1: Ephemeral client-secret mint + browser WebRTC handshake (VOIC-01)
**What:** The browser never holds `OPENAI_API_KEY`. It calls a Convex action that mints a short-lived client secret (session config baked in from a registry skill), then does the SDP handshake directly with OpenAI.
**When:** Pre-flight "Start session".
**Flow (verify exact shapes at plan time):**
```
1. Client → Convex action voiceToken.mintClientSecret()
   Convex → POST https://api.openai.com/v1/realtime/client_secrets
     Authorization: Bearer OPENAI_API_KEY
     body: { session: { type:"realtime", model:"gpt-realtime-2.1",
                        instructions: <voice-session skill.body>,   // CLAUDE.md #5, not hardcoded
                        audio: { output: { voice:"<warm voice id>" } },
                        turn_detection: { type:"semantic_vad", ... }, // barge-in
                        input_audio_transcription: { model:"whisper-1"/"gpt-4o-transcribe" } } }
   Convex returns to client: { clientSecret, expiresAt }   // NEVER the API key
2. Client getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
   pc = new RTCPeerConnection(); pc.addTrack(mic); dc = pc.createDataChannel("oai-events")
   offer = await pc.createOffer(); await pc.setLocalDescription(offer)
3. Client → POST https://api.openai.com/v1/realtime/calls   (Authorization: Bearer <clientSecret>)
     body: <offer.sdp>
   → response SDP answer + **call_id in the Location header**
4. Client relays call_id → Convex voice.startSession({callId}) → arms the watchdog (Pattern 2)
```
**Key insight:** the `call_id` from step 3's `Location` header is the linchpin — it is what lets the *server* end the session (Pattern 2). The client must post it back immediately after the handshake.

### Pattern 2: Durable watchdog + server force-terminate (VOIC-02)
**What:** One durable timer armed once at session start; it force-ends the OpenAI call and always generates a brief. Clean end cancels it. Copies the deferred-send/review-timeout precedent exactly.
**When:** Armed in `voice.startSession` after `call_id` is known.
```
startSession:  endsAt = startedAt + 15*60*1000
               fnId = await ctx.scheduler.runAt(endsAt, internal.voice.forceEndSession, {sessionId})
               patch session { status:"active", callId, watchdogFnId: fnId, startedAt, endsAt }

endSessionClean (User End / T-0 graceful):     // review.sendDecision precedent
               if session.watchdogFnId: await ctx.scheduler.cancel(session.watchdogFnId)
               patch { status:"ended_clean" };  then brief path (Pattern 6, review→store)

forceEndSession (watchdog fires OR client beacon):
               if session.status not active/wrapping: return   // CAS idempotent (cockpit.cancelScheduledPlan precedent)
               await ctx.runAction(internal.voiceToken.hangupCall, {callId})   // POST /v1/realtime/calls/{id}/hangup
               patch { status:"ended_abnormal" };  then brief path (auto-store)
```
- **Force-terminate:** `voiceToken.hangupCall` → `POST https://api.openai.com/v1/realtime/calls/{call_id}/hangup`, `Authorization: Bearer OPENAI_API_KEY`, expects `200`. Confirmed to work for WebRTC sessions.
- **Cancellable-timer safety:** guard `scheduler.cancel` behind a status CAS exactly like `cockpit.cancelScheduledPlan` (RESEARCH Pitfall 1 there: `cancel` throws on an already-fired id).

### Pattern 3: End-session button (VOIC-01) + T-2min wrap-up
**What:** Prominent always-visible End → lightweight confirm ("End session & generate brief?") → `endSessionClean`. Around T-2min the UI emphasizes the countdown AND the client sends a data-channel instruction so the agent wraps up (`response.create` with a wrap-up instruction, or a session update). The clean end at 0:00 is the *graceful* path even though the watchdog is the hard backstop — a graceful close yields a better brief.

### Pattern 4: Per-session token metering (VOIC-02)
**What:** Realtime usage is reported per-response in the **`response.done`** server event (`usage` with input/output token counts, split into text and audio tokens). Browser-direct means the *client* sees these events; it forwards cumulative counts to Convex, which prices them onto the existing daily-spend rails.
```
Client on each response.done (throttled): voice.recordUsage({sessionId, inAudioTok, outAudioTok, textTok})
  Convex: patch session counters (cumulative)
          priced = priceRealtime(inAudioTok, outAudioTok, textTok)   // new @pikar/cost fn
          if priced.ok: recordSpend({costUsd: priced.value delta})    // same kill-switch/budget window
```
- **Pricing table (verified 2026-07, MEDIUM — reconfirm):** `gpt-realtime-2.1` audio in **$32/1M**, audio out **$64/1M**, text in **$4/1M**, text out **$24/1M**, cached audio in **~$0.40/1M**. `-mini` audio **$10 / $20**. Conversion: ~1 audio input token per 100ms (~600/min), ~1 output token per 50ms (~1200/min). Cost accrues when a Response is created.
- **Trust boundary (flag):** client-reported usage is acceptable **because CONTEXT locks cost control to time-cap-only** — metering here is OPSG-01 telemetry + a best-effort budget contribution, not the enforcement mechanism. The 15-min wall-clock cap is the real cost bound. Note this explicitly; do not build server-side usage reconciliation for beta (ponytail: the cap already bounds worst-case spend).

### Pattern 5: Brief generation (VOIC-03) — mirror `digestInbox`
**What:** A new **gated `voice-brief` skill** (the brief-structuring prompt, from the registry — CLAUDE.md #5) + a toolless `draftVoiceBrief` `internalAction` in `llm.ts` that runs `generateObject` over the kept transcript to fill the fixed sections.
```
draftVoiceBrief(transcript, language):   // verbatim digestInbox/draftDocument shape
  skill = getActiveSkill("voice-brief")  // fail-closed (NO_ACTIVE_SKILL) — no hardcoded prompt
  SMOKE:: short-circuit → deterministic offline brief (the E2E path)
  generateObject({ model: DEFAULT_MODEL, schema: briefSchema, system: skill.body,
                   prompt: <transcript>, abortSignal: timeout, maxRetries:1 })
    → fallback CHEAP_MODEL on isFallbackEligible; BOTH recordModelSpend'd
  briefSchema = { summary, decisions[], actionItems[], openQuestions[], discussion }  // strict-mode-legal
```
- The model fills the *narrative* sections; **the full turn-by-turn transcript is welded on in code** (like `joinDigest` welds code-owned fields), and empty sections render "None". `packages/voice/brief.ts::buildBriefMarkdown` composes the final markdown deterministically (pure, unit-testable).
- **Brief generated in the spoken language:** pass the session `language` (from `input_audio_transcription` auto-detect) so the skill responds in-language.

### Pattern 6: Brief → vault (VOIC-03) — reuse `ingestDoc` verbatim
**What:** The brief markdown becomes an ordinary `vaultDocuments` row and rides `vaultIngest.ingestDoc`.
```
voice.storeBrief(sessionId, markdown):    // mirrors vault.ts create (lines 152-172), TEXT-first (no storageId)
  hash = contentHash(markdown)
  vaultDocId = insert vaultDocuments { tenantId, title:"Voice brief — <date>", kind:"brief",
       category: categoryFor(...), source:"voice", mimeType:"text/markdown", size, contentHash:hash,
       text: markdown, status:"processing", createdAt }
  workflow.start(internal.vaultIngest.ingestDoc, {vaultDocId, tenantId, correlationId})
  patch session { briefRef: vaultDocId }
```
- **PII (CLAUDE.md #4 reconciliation):** the brief `text` is **content plane** — it carries PII by design, exactly like any uploaded vault doc. `ingestDoc`'s embed step already redacts *for the vector*; the raw `text` stays intact. **Do NOT scanText-strip the brief body.** Only the session's audit/telemetry rows are refs/counts-only.
- **Clean end:** show markdown in the summary screen for review/edit → user confirms → `storeBrief` with the (possibly edited) markdown.
- **Abnormal end:** `forceEndSession` calls `storeBrief` directly (auto-store); the doc is surfaced for review on next app open (the brief row already exists in the vault, searchable).

### Pattern 7: Brief → plan handoff (VOIC-04) — reuse `sendCockpitMessage`
**What:** The post-call summary "Turn this into a plan?" seeds a cockpit thread with the brief's Decisions/Action-items as the opening user turn; the Executive Agent drafts a PLAN card; the user lands at the **unchanged single-Approve review gate**.
```
On "Turn into a plan":
  { threadId } = await sendCockpitMessage({ text: <Decisions + Action items from the brief>, clientContext })
  navigate → /workspace?thread=<threadId>       // lands at the existing PLAN card + Approve
```
- `sendCockpitMessage` is a `tenantAction({threadId?, text, clientContext?}) → {threadId}`; first turn creates the thread + its single `plans` row. No new pipeline, no new gate — VOIC-04's "enters the normal request pipeline (with the review gate)" is satisfied by construction.
- Works identically for clean and dropped sessions because it starts from the *stored brief*, not live session state.

### Anti-Patterns to Avoid
- **Re-arming the watchdog on pause.** Do not move `endsAt` when the mic drops. One timer, armed once, never re-armed (see Open Question 1). A movable cap can be stalled indefinitely.
- **Trusting the client for structural facts.** `call_id`, usage counts, and transcript come from the browser — fine for content/metering, but the *cap* and *termination* are server-owned (watchdog + hangup). Never let the client extend the cap.
- **Redacting the brief body.** The brief is vault content; stripping names/companies makes a strategy brief useless (CONTEXT explicit). Redaction applies only to audit/DLQ/telemetry.
- **A second `"use node"` module.** Put `draftVoiceBrief` in `llm.ts`; keep `voiceToken.ts` in the default runtime. (llm.ts header warns a sibling node module re-triggers the TS circular-inference cliff.)
- **Hardcoding the voice system prompt.** The live-session instructions load from a registry skill row (CLAUDE.md #5), injected into the ephemeral secret at mint.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Media transport / echo cancel / VAD / barge-in | A WebSocket audio relay, custom VAD, a media server | OpenAI Realtime WebRTC + `getUserMedia` echo-cancellation + `semantic_vad` | Native + provider; a relay also forces audio through your server (breaks "discard audio") |
| Durable 15-min timer | `setTimeout` in an action, a polling loop | `ctx.scheduler.runAt` + cancellable `scheduledFunctionId` | Survives redeploys/crashes; exact in-repo precedent |
| Server-side session kill | Waiting for the client to close | `POST /v1/realtime/calls/{call_id}/hangup` | The only way to end a browser-direct session the server doesn't hold |
| Brief embedding/indexing | A voice-specific vault path | `vaultIngest.ingestDoc` | A brief is just a vault document; VALT pipeline already does embed+extract+ready |
| Plan creation + review gate | A voice-specific plan pipeline | `sendCockpitMessage` → existing PLAN/Approve | CONTEXT locks "reuse the existing pipeline entirely" |
| Cost tracking | A new spend ledger | `priceRealtime` → `recordSpend` | Same kill-switch/daily-budget window as every other call |

**Key insight:** Phase 6's *only* genuinely new engineering is the WebRTC glue + the watchdog wiring. Everything downstream of "session ended" (brief, vault, plan, cost) is existing rails.

## Common Pitfalls

### Pitfall 1: `call_id` never reaches the server → watchdog can't force-terminate
**What goes wrong:** The browser completes the SDP handshake but doesn't relay the `Location`-header `call_id`; the watchdog fires but `hangupCall` has nothing to target, so an abnormal session bills until OpenAI's own session limit.
**How to avoid:** `startSession` is only "active" once `callId` is persisted. Arm the watchdog *inside* `startSession`, after `callId` is stored. If the handshake fails before that, no session row → no orphaned timer.
**Warning sign:** a `voiceSessions` row with `status:"active"` and a null `callId`.

### Pitfall 2: `scheduler.cancel` throws on an already-fired watchdog
**What goes wrong:** Clean-end races the 0:00 watchdog fire; `cancel` on a committed scheduled id throws (documented in `cockpit.cancelScheduledPlan`).
**How to avoid:** CAS on status — `endSessionClean` only proceeds/cancels if `status` is still `active`/`wrapping`; `forceEndSession` no-ops if already ended. Exactly the `review.sendDecision` / `cancelScheduledPlan` guard.

### Pitfall 3: Silent tab-close leaves the brief up to 15 min late
**What goes wrong:** A closed laptop lid / network drop gives no `pagehide`; the brief only generates when the watchdog fires (≤15 min later).
**How to avoid:** Accept it for beta — CONTEXT says the abnormal-end brief is "surfaced next time the user opens the app," so ≤15-min latency loses nothing. Add best-effort `pagehide`+`sendBeacon → forceEndSession` for prompt graceful-close, but the **watchdog is the authoritative guarantee**. Ponytail: skip a heartbeat/short-timer scheme unless live-verify shows the latency unacceptable (upgrade path: a client heartbeat pushing a short second timer forward).

### Pitfall 4: Ephemeral secret or `OPENAI_API_KEY` leaking to the client
**What goes wrong:** Returning the API key (not the client secret) to the browser, or logging the secret.
**How to avoid:** `mintClientSecret` returns **only** `{clientSecret, expiresAt}`. The key stays in Convex env. The secret is short-lived and single-session. Never audit either (refs/counts only — a `voice.session_started` audit carries `{sessionId}` + counts, never the secret/callId-as-secret).

### Pitfall 5: Brief drafting model call not governed like the rest
**What goes wrong:** `draftVoiceBrief` skips `preCall`/`recordModelSpend`, or hardcodes the prompt.
**How to avoid:** Copy `digestInbox`/`draftDocument` line-for-line: fail-closed `getActiveSkill`, SMOKE:: offline seam, DEFAULT→CHEAP fallback, both branches `recordModelSpend`'d.

### Pitfall 6: Parallel sessions double-billing
**What goes wrong:** User opens two tabs; two live sessions bill concurrently.
**How to avoid (ponytail, cheap):** `startSession` checks `getActiveSession(tenantId)`; if one is active, force-end it first (or refuse). CONTEXT: "prevent parallel sessions if cheap, but no daily/count cap."

## Code Examples

### Watchdog arm + cancel (verified in-repo precedent)
```typescript
// Arm (voice.startSession) — cockpit.ts:512 / review.ts:63 precedent
const watchdogFnId = await ctx.scheduler.runAt(
  startedAt + 15 * 60 * 1000,
  internal.voice.forceEndSession,
  { sessionId },
);
// Cancel on clean end (voice.endSessionClean) — review.sendDecision / cancelScheduledPlan precedent
if (session.status === "active" || session.status === "wrapping") {
  if (session.watchdogFnId) await ctx.scheduler.cancel(session.watchdogFnId);
  await ctx.db.patch(sessionId, { status: "ended_clean" });
}
```

### Brief → vault (mirror vault.ts:152–172, text-first)
```typescript
const vaultDocId = await ctx.db.insert("vaultDocuments", {
  tenantId, title: `Voice brief — ${new Date().toISOString().slice(0,10)}`,
  kind: "brief", category: categoryFor({ source: "voice", mimeType: "text/markdown" }),
  source: "voice", mimeType: "text/markdown", size: markdown.length,
  contentHash: await contentHash(markdown), text: markdown,      // content plane — PII kept
  status: "processing", createdAt: Date.now(),
});
await workflow.start(ctx, internal.vaultIngest.ingestDoc, { vaultDocId, tenantId, correlationId: crypto.randomUUID() });
```

### Realtime pricing (new @pikar/cost entry — reconfirm rates at plan time)
```typescript
export const REALTIME_PRICING = {                    // per-MTok, gpt-realtime-2.1 (verify 2026-07)
  audioInPerMTok: 32, audioOutPerMTok: 64, textInPerMTok: 4, textOutPerMTok: 24,
};
export function priceRealtime(inAudioTok: number, outAudioTok: number, textInTok: number, textOutTok: number): Result<number, CostError> {
  for (const n of [inAudioTok, outAudioTok, textInTok, textOutTok])
    if (!Number.isFinite(n) || n < 0) return err({ code: "over_budget" });   // fail-closed like priceTranscription
  const p = REALTIME_PRICING;
  return ok((inAudioTok*p.audioInPerMTok + outAudioTok*p.audioOutPerMTok
           + textInTok*p.textInPerMTok + textOutTok*p.textOutPerMTok) / 1_000_000);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `gpt-4o-realtime-preview` + beta header | `gpt-realtime-2.1` / `-mini`, GA `/v1/realtime` (no beta header) | 2026-07-06 (past cutoff) | Use GA endpoints; drop beta header; confirm current default snapshot |
| Ephemeral token via `/v1/realtime/sessions` | `POST /v1/realtime/client_secrets` | GA | Verify exact body shape at plan time |
| WebSocket-only realtime | WebRTC browser-direct + server `call_id` addressability (`/v1/realtime/calls`, `.../hangup`) | GA | Enables the server-side force-terminate that VOIC-02 needs |

**Deprecated/outdated:** the `OpenAI-Beta: realtime=v1` header and `/v1/realtime/sessions` mint path — superseded by GA `client_secrets` + `calls`. My training-data knowledge of model names is stale (pre-`2.1`); treat all exact Realtime JSON shapes as **verify-at-plan-time**.

## Open Questions

1. **Pause/resume vs the wall-clock cap — RESOLVED (recommendation).** The 15-min cap **stays wall-clock**; a mic-drop grace window **consumes cap time**. The watchdog is armed once at `startedAt+15min` and is **never re-armed or paused**. A client-side pause is pure UX (session shows "mic lost — reconnect"); it does not touch `endsAt`. Tradeoff to document: a 2-min mic outage eats 2 min of the 15. This is the ponytail choice — one durable timer that cannot be stalled indefinitely by a stalled client. (Matches CONTEXT's own recommended resolution.)
2. **Exact Realtime JSON shapes.** `client_secrets` request/response, `calls` handshake, `hangup` path, and the `response.done` usage field names are **MEDIUM confidence** (post-cutoff GA). Recommendation: the plan's Wave 0 fetches the live doc and pins the shapes in a `packages/voice` constants file before the client glue is written.
3. **Voice-session skill gating.** The live-session system prompt is a registry skill (CLAUDE.md #5). The 3.6 eval gate asserts on *cockpit tool-state* — it cannot meaningfully eval a free-form voice persona. Recommendation: seed `voice-session` **ungated** (bootstrap v1 activates when `rows.length===0`, like other skills), and treat `voice-brief` as gated only if its output feeds tool-state (it does not — it's a document). Flag for the planner to decide; do not block the phase on an eval harness that doesn't fit voice.
4. **Transcript source.** Prefer OpenAI's `input_audio_transcription` (user side) + the assistant's own output text events for the kept transcript, assembled client-side and posted to `voice.recordTurn`. This avoids a second Whisper pass. Confirm both transcript streams are available on the data channel at plan time; `vaultTranscribe`/`whisper-1` is the fallback only if needed (it is not expected to be).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + `convex-test` (backend), Playwright (web e2e) — matches every prior phase |
| Config file | `packages/backend` vitest; `apps/web/e2e` Playwright |
| Quick run command | `pnpm --filter @pikar/backend test` (or `--filter @pikar/voice test` for the pure module) |
| Full suite command | `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/web test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VOIC-01 | Mint returns `{clientSecret,expiresAt}` and NEVER the API key; request body carries the registry skill instructions | unit (mock `fetch`) | `pnpm --filter @pikar/backend test voiceToken` | ❌ Wave 0 |
| VOIC-01 | Live bidirectional audio, barge-in, echo cancel, multilingual | **manual/live** | human live-verify checkpoint (phase gate) | n/a |
| VOIC-02 | Watchdog armed at `startedAt+15min`; `forceEndSession` sets `ended_abnormal` + calls hangup + stores brief | unit (fake timers) | `pnpm --filter @pikar/backend test voice` | ❌ Wave 0 |
| VOIC-02 | Clean end cancels the watchdog; CAS no-op on the fire race | unit | `pnpm --filter @pikar/backend test voice` | ❌ Wave 0 |
| VOIC-02 | `priceRealtime` maps token counts → USD, fail-closed on non-finite | unit | `pnpm --filter @pikar/cost test` | ❌ Wave 0 |
| VOIC-02 | Real hangup actually terminates the OpenAI call | **manual/live** | human live-verify (watch a session force-end at 15:00) | n/a |
| VOIC-03 | `buildBriefMarkdown` → fixed sections, empty→"None", transcript welded in code | unit (pure) | `pnpm --filter @pikar/voice test brief` | ❌ Wave 0 |
| VOIC-03 | `draftVoiceBrief` SMOKE:: offline path drives brief → `ingestDoc` → vault `ready` | unit (convex-test) | `pnpm --filter @pikar/backend test voice` | ❌ Wave 0 |
| VOIC-03 | Abnormal-end auto-stores the brief; clean-end stores after review | unit | `pnpm --filter @pikar/backend test voice` | ❌ Wave 0 |
| VOIC-03 | Session audit/telemetry rows are refs/counts-only (no transcript/secret) | unit (static-scan, `llmRedaction.test.ts` precedent) | `pnpm --filter @pikar/backend test llmRedaction` | ❌ Wave 0 |
| VOIC-04 | Brief→plan seeds a cockpit thread and lands a proposable plan at the review gate | unit + e2e | `pnpm --filter @pikar/backend test voice` / Playwright | ❌ Wave 0 |
| VOIC-04 | Real in-app: approve the voice-derived plan → normal governed send | **manual/live** | human live-verify (phase gate) | n/a |

**Deterministically asserted:** token-mint request/response shape + no-key-leak, watchdog arm/fire/cancel + CAS, realtime pricing math, brief markdown structure, brief→vault ingest via SMOKE, brief→plan handoff creating a proposable plan, refs-only audit. **Manual/live only (voice is not unit-testable):** actual audio round-trip, barge-in feel, echo cancellation, multilingual auto-detect, the real hangup terminating a live call, the orb/countdown UX — these carry the phase-gate human-verify (the RPLY-01 precedent: the live gate no unit can substitute for).

### Sampling Rate
- **Per task commit:** `pnpm --filter @pikar/backend test <touched>` (+ `@pikar/voice`/`@pikar/cost` for pure modules)
- **Per wave merge:** full backend suite green (document the known pre-existing `audit.test.ts auditCounts` red as a non-regression)
- **Phase gate:** full suite green + the live human-verify walk-through before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/voice/brief.ts` + `brief.test.ts` — `buildBriefMarkdown` fixture (VOIC-03)
- [ ] `packages/voice/session.ts` — status FSM + `capEndsAt` (VOIC-02)
- [ ] `packages/cost/src/cost.ts` `priceRealtime` + `cost.test.ts` cases (VOIC-02)
- [ ] `packages/backend/convex/voice.ts` + `voice.test.ts` — watchdog arm/fire/cancel, storeBrief, parallel guard (convex-test, fake timers)
- [ ] `packages/backend/convex/voiceToken.ts` + test — mint (mock fetch) + hangup, no-key-leak
- [ ] `llm.ts` `draftVoiceBrief` + SMOKE:: seam (mirror `digestInbox` offline path)
- [ ] `voiceSessions` table in `schema.ts` (new table → no migration)
- [ ] `voice-session` + `voice-brief` skill rows seeded (CLAUDE.md #5)
- [ ] Static-scan extension in `llmRedaction.test.ts` for the session audit refs-only line
- [ ] Realtime JSON shapes pinned from the live OpenAI doc (Open Question 2)

## Sources

### Primary (HIGH confidence)
- In-repo: `packages/backend/convex/llm.ts` (recordModelSpend, CALL_TIMEOUT_MS, digestInbox/draftDocument/draftCockpit shape, buildCockpitTools), `vaultTranscribe.ts` (whisper-1 transcribe + priceTranscription), `vaultIngest.ts` (ingestDoc workflow), `vault.ts` (createDoc → ingestDoc, text-first path), `cockpit.ts` (scheduler.runAt deferred-send + cancel CAS + sendCockpitMessage), `review.ts` (armTimeout/fireTimeout/sendDecision cancel precedent), `gmailAuth.ts` / `gmail.ts` (server-side token mint + fetch-in-action seam), `schema.ts` (plans/vaultDocuments/briefings shapes), `packages/cost/src/cost.ts` (priceUsage/priceTranscription fail-closed pattern)
- `docs/playbooks/` (cockpit, agent-runtime, skill-registry, vault) — subsystem invariants
- `.planning/phases/06-live-voice-sessions/06-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence — post-cutoff, verify exact shapes at plan time)
- OpenAI Realtime guide — https://developers.openai.com/api/docs/guides/realtime (client_secrets mint, calls handshake, turn_detection/semantic_vad, input_audio_transcription, response.done usage)
- OpenAI Calls API — Hang up: https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup (`POST /v1/realtime/calls/{call_id}/hangup`, WebRTC `call_id` from the `Location` header)
- Realtime pricing — https://developers.openai.com/api/docs/pricing ; https://tokenmix.ai/blog/openai-realtime-voice-api-2026-cost-latency (audio $32/$64 per MTok, mini $10/$20, token/min conversion)
- gpt-realtime-2.1 release — https://www.marktechpost.com/2026/07/06/openai-gpt-realtime-2-1-mini-reasoning-realtime-api/

## Metadata

**Confidence breakdown:**
- Standard stack (OpenAI Realtime, no LiveKit, no new dep): HIGH — provider already in use; server-side hangup confirmed
- Internal seams (watchdog, brief, vault ingest, plan handoff, metering): HIGH — all are in-repo precedents read directly
- Exact Realtime JSON field names / current model snapshot / pricing: MEDIUM — GA changes landed after the training cutoff; pin from the live doc in Wave 0

**Research date:** 2026-07-20
**Valid until:** ~2026-08-05 for the Realtime API surface (fast-moving; reconfirm shapes if planning slips); in-repo seams stable.
