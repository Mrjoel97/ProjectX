# Phase 6: Live Voice Sessions - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A live bidirectional voice conversation with the Executive Agent (WebRTC, browser-direct)
that safely becomes a durable, vault-stored markdown **brief** and — with the user's
permission at session end — an **executable plan** that enters the normal request pipeline
at the existing review gate. The session is isolated from the durable pipeline,
cost-metered, and hard-capped at 15 minutes by a server-side watchdog.

Requirements: **VOIC-01** (live bidirectional voice + End-session), **VOIC-02** (server
watchdog 15-min hard cap + clean termination on drop + per-session token metering),
**VOIC-03** (ended session → detailed structured markdown brief, stored + indexed in the
vault), **VOIC-04** (agent asks permission to convert brief → plan; approved plan enters
the normal pipeline with the review gate).

**Locked constraints (from ROADMAP / non-negotiables — NOT open for discussion):**
- 15-minute hard cap is a product constraint (bounds cost; not configurable up).
- Responsive web only — no native mobile app.
- WebRTC browser-direct + server-side watchdog + per-session token metering.
- Brief lands in the knowledge vault; approved plan uses the *existing* review gate.

**Out of scope (its own capability / phase):** anything beyond the four VOIC requirements —
e.g. session sharing, multi-party calls, voice cloning, scheduled voice sessions.
</domain>

<decisions>
## Implementation Decisions

### Conversation feel
- **Turn-taking:** open-mic with voice-activity detection (VAD) — hands-free, phone-call feel.
- **Barge-in:** YES — the user can interrupt the agent mid-utterance and it stops and listens.
  Requires echo cancellation so the agent's own audio doesn't self-trigger the cutoff.
- **Agent voice:** warm & professional (calm advisor / strategy-partner tone; matches BRAND's
  grounded, non-hype voice).
- **Language:** multilingual auto-detect — the realtime model handles whatever the user speaks;
  the brief is generated in the spoken language.

### Live session UI
- **Main visual:** live scrolling transcript of both sides + a small animated speaking orb
  showing who's talking (reuse ChatPane bubble patterns where sensible).
- **Countdown:** an always-visible 15-min countdown timer (never a surprise), understated
  early and emphasized as it nears the cap.
- **End-session button:** always-visible and prominent, but ending requires a lightweight
  confirm ("End session & generate brief?") to prevent a mis-tap losing a long conversation.
- **Pre-flight:** a short pre-call step — request mic permission + confirm the mic works +
  the one-time consent notice (below) — then "Start session". Prevents burning capped time on
  a dead mic.

### 15-minute cap + abnormal end
- **Approaching the cap:** around **T-2min** the UI warns AND the agent is instructed to start
  wrapping up (summarize, ask any final things), then a clean end at 0:00 — a graceful close
  yields a better brief.
- **Abnormal end (tab close / network drop / crash):** the **server watchdog** detects the
  dropped session, terminates cleanly, and **still generates a brief** from the conversation up
  to the drop (VOIC-02/03). Nothing is lost.
- **Session limit:** none at beta — the user can start another session immediately. Cost is
  bounded per-session by the 15-min cap + metering. (Planner: prevent *parallel* sessions if
  cheap, but no daily/count cap.)
- **Cost control:** **time-cap-only** — meter and `recordModelSpend` per session; rely on the
  15-min cap to bound worst-case cost. No separate per-session cost cutoff for beta.

### Brief + plan handoff
- **Brief review — SPLIT BY END TYPE (the key reconciliation):**
  - **Clean end** (user pressed End, or the T-0 graceful close): the brief is shown for the
    user to **review/edit**, THEN stored + indexed in the vault.
  - **Abnormal end** (watchdog-detected drop — user is gone): the brief is **auto-stored** to
    the vault (no one is present to gate it), and surfaced for review next time the user opens
    the app. This keeps VOIC-03 true for dropped sessions without losing the review preference
    for normal ones. **Both paths must be built.**
- **Plan permission (VOIC-04):** asked on the **post-call summary screen** ("Turn this into a
  plan?" / "Just save") — the reliable path that works identically for clean and dropped
  sessions. A by-voice ask at end-of-call is a *nice-to-have* only if it doesn't compromise the
  screen fallback.
- **Approved plan handoff:** converting the brief creates a plan and **jumps the user into that
  plan in the cockpit/workspace at the normal review gate** — the same single-Approve flow as
  every other plan (reuse the existing pipeline entirely).
- **Brief shape:** **decisions + action items first**, supporting narrative below.

### Consent & privacy
- **Consent notice:** a one-time notice on the pre-flight screen — "This conversation is
  transcribed and saved to your vault" — shown before Start (no mid-call friction).
- **Audio retention:** **discard raw audio** — only the transcript + brief are persisted.
  Realtime audio streams through and is never stored (smallest PII footprint).
- **PII handling:** the brief/transcript is **first-class vault document content** (it CAN
  contain PII spoken aloud — that is the nature of a vault doc, like any uploaded document).
  **Audit/telemetry/DLQ rows about the session stay refs/counts-only** (convention #4). This
  matches the existing vault-content vs audit-metadata split — do NOT redact PII out of the
  brief itself (a strategy brief with names/companies stripped is far less useful).
- **Isolation:** standard tenant scoping via the existing wrapper (`tenantId` injection) — no
  voice-specific access controls.

### Mic failure & silence (mid-session)
- **Mic drop / permission revoked / device disconnect:** **pause + warn + allow recovery** —
  the session pauses, shows "mic lost — reconnect to continue", and if the mic returns within a
  grace window, resume; only if it does not recover does it fall through to abnormal-end + brief.
  ⚠️ Planner/researcher: reconcile a client-side pause with the **server watchdog's wall-clock
  15-min cap** — the pause is a UX grace window, not a way to extend total session wall-time
  past the server cap. See Open Questions.
- **Prolonged silence:** the agent gently checks in ("Still there?") once or twice; continued
  silence eventually ends the session + brief (protects capped time from dead air).

### Accessibility
- **Text-input fallback during a voice session:** YES — a text box lets the user type a turn;
  the agent responds by voice + transcript. (Adds scope; the user explicitly wants it as an
  accessibility win.)
- **Keyboard + screen reader:** FULL — Start/End/confirm all keyboard-operable; screen-reader
  announcements for state changes (session started, who's speaking, 2-min warning, ended).
  Per BRAND accessibility rules — a non-negotiable-quality basic.

### Brief detail
- **Length:** thorough multi-section (the requirement says "detailed structured markdown").
- **Sections:** fixed structure, empty sections marked "None" — predictable for the vault and
  the plan-conversion step. Suggested sections: Summary, Decisions, Action items, Open
  questions, Discussion (narrative), Transcript.
- **Transcript:** the full turn-by-turn transcript is kept with the brief (text-only; audio
  already discarded) — cheap insurance against summary gaps.

### Claude's Discretion
- Exact WebRTC stack / signaling and whether to use OpenAI Realtime API (research decides —
  OpenAI is already the LLM provider via `@ai-sdk/openai` + `OPENAI_API_KEY`).
- The specific realtime voice id (within "warm & professional").
- Watchdog implementation (Convex scheduled function / durable timer vs action-retrier) and
  how "clean termination on tab close" is detected server-side.
- Orb/waveform visual design, transcript styling, error-copy wording (within BRAND).
- Grace-window durations (mic recovery, silence check-in) and exact T-2min warning styling.
</decisions>

<specifics>
## Specific Ideas

- "Phone-call feel" — open-mic VAD + barge-in + a warm advisor voice; the user wants it to feel
  like a real bidirectional conversation, not walkie-talkie push-to-talk.
- The post-call summary screen is the load-bearing, always-available surface — both the brief
  review AND the "turn into a plan?" ask live there so a dropped call degrades gracefully.
- Nothing spoken should be silently lost: brief on abnormal end, transcript kept alongside the
  brief, silence/mic-drop handled rather than crashing.
</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Transcription:** `packages/backend/convex/vaultTranscribe.ts` (whisper-1) and
  `intake.ts` / `intakeDb.ts` (INTK-03 voice dictation → transcribe → pipeline) — existing
  audio-to-text path and provider wiring to reuse for the offline/brief transcription seam.
- **Cost metering:** `recordModelSpend()` and the `CALL_TIMEOUT_MS` abort pattern in
  `packages/backend/convex/llm.ts` — the per-session token metering (VOIC-02) rides this seam.
- **Vault ingest (brief destination, VOIC-03):** `vaultIngest.ts`, `vault.ts`, `rag.add`,
  `vaultGraph.ts` — the store→embed→extract→ready ingest pipeline the brief lands in and is
  indexed by (same path Phase 5 built; a brief is "just another vault document").
- **Plan pipeline + review gate (VOIC-04):** `cockpit.ts` / `plans.ts` — an approved brief→plan
  enters the existing plan → single-Approve → governed fan-out flow. No new pipeline.
- **Chat UI patterns:** `apps/web/app/(app)/dashboard/workspace/ChatPane.tsx`,
  `IntakeControls.tsx` — bubble/transcript patterns and the composer to draw the live-transcript
  view from.

### Established Patterns
- **Thin adapter rule (CLAUDE.md #1):** voice/session domain logic belongs in `packages/*`;
  `convex/` stays a thin adapter. WebRTC/realtime orchestration lives behind that seam.
- **Tenant-scoped wrappers (CLAUDE.md #2):** all session/brief reads+writes go through
  `convex/lib/functions.ts` wrappers (tenantId injection) — the isolation decision above.
- **Audit is insert-only + refs-only (CLAUDE.md #3/#4):** session/brief audit rows carry
  refs/ids/counts, never raw transcript/PII. Redact-then-write.
- **Skills from the registry (CLAUDE.md #5):** the Executive Agent's live-voice system prompt is
  a versioned `skills` row, not hardcoded — and if gated, activation rides the Phase 3.6 eval gate.
- **Watchdog precedent:** the deferred-send scheduler (Phase 3.5, `SEND_TIME_HORIZON_MS` +
  `scheduler.runAt`) and the review-timeout scheduled-event race (Phase 7 territory) are prior
  art for a server-side durable timer that fires independently of the client.

### Integration Points
- New `/dashboard/voice` (or similar) route + nav entry (mirror the Phase 5 vault route add).
- Brief → vault via the existing ingest seam; brief → plan via the existing cockpit plan create.
- Realtime session needs a short-lived client token minted server-side (never expose
  `OPENAI_API_KEY` to the browser) — a new thin action, analogous to the Gmail OAuth token seam.
</code_context>

<deferred>
## Deferred Ideas

- By-voice "turn this into a plan?" ask at end-of-call — nice-to-have fast-follow; the post-call
  summary screen is the required path.
- Persisting raw audio for playback — explicitly out (discard audio for beta); revisit only if a
  playback need emerges.
- Multi-language brief *translation* (vs generation in the spoken language) — future.
- Session sharing / multi-party voice / scheduled voice sessions — separate capabilities, own phase.
</deferred>

## Open Questions for Research

- **Pause/resume vs the server watchdog:** the mic-drop "pause + recover" grace window is
  client-side UX, but the 15-min hard cap is a server wall-clock. Research must define whether the
  server cap pauses too (and how, without letting a session run indefinitely by stalling) or
  whether the grace window simply consumes cap time. Recommend: cap stays wall-clock; grace window
  consumes it; document the tradeoff.
- **WebRTC stack:** OpenAI Realtime API (browser-direct with an ephemeral token) vs a
  managed realtime provider (e.g. LiveKit) — pick per cost, barge-in/echo-cancellation support,
  multilingual support, and how cleanly the server watchdog can force-terminate.
- **Clean termination on tab close:** how the server detects a dropped WebRTC session promptly
  (data-channel heartbeat, provider webhook, or watchdog timeout) to trigger the abnormal-end brief.
- **Per-session token metering for a streaming realtime call:** how usage is reported by the
  chosen provider and mapped onto `recordModelSpend` (realtime pricing differs from chat completions).

---

*Phase: 06-live-voice-sessions*
*Context gathered: 2026-07-19*
