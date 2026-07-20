# ADR-005: Live voice is browser-direct OpenAI Realtime over WebRTC, bounded by a single server wall-clock watchdog, with metering as telemetry

- **Status**: Accepted (2026-07-20 — owner-commissioned phase-close record for Phase 6 Live Voice Sessions; the architecture was built across plans 06-01..06-07 and is named here so future real-time features follow it deliberately, not by accident)
- **Recorded**: 2026-07-20 (immutable — per CLAUDE.md §9, never edited after acceptance; supersede with a new ADR if the decision changes)

## Context

Phase 6 adds a live, bidirectional voice conversation with the Executive Agent:
open-mic, barge-in, warm multilingual voice, hard-capped at 15 minutes, ending in a
structured brief that can become a governed plan. Voice is uniquely latency-critical
(sub-second round-trip), it rides a post-training-cutoff GA API (OpenAI Realtime), and
its raw medium — audio — is the highest-value PII surface the product touches.

Three forces shaped the architecture. First, **latency**: a conversational voice loop
cannot tolerate an extra media hop. Second, **cost control**: a real-time token stream
billed per second must have a bound that a hung or hostile client cannot stall. Third,
the standing house rules: domain logic stays pure and Convex stays a thin adapter
(CLAUDE.md §1), prompts load from the skill registry not source (ADR-003 / §5), the
audit plane carries refs/counts only (§4), irreversible actions cross a single human
Approve (ADR-004), and the ponytail ladder forbids a new dependency or pinned component
when a native platform feature already covers the need. This ADR records the choices
those forces produced so a later real-time feature (a second agent voice, a phone
bridge) inherits them rather than re-litigating them.

## Decision

Live voice is built as **a browser-direct OpenAI Realtime session over WebRTC, opened
with a server-minted ephemeral client secret, bounded by one server-side wall-clock
watchdog, with client-reported usage treated as telemetry and only the transcript +
brief retained**:

- **Browser-direct WebRTC to OpenAI; no media server, no new dependency, no new pinned
  component.** The browser holds a raw `RTCPeerConnection` + a single `oai-events` data
  channel and talks straight to `/v1/realtime/calls`. No LiveKit / SFU, no
  `@openai/agents-realtime` SDK — a native `RTCPeerConnection` already does it. The
  media plane is OpenAI's; we run none.
- **The browser never holds `OPENAI_API_KEY`; it holds a short-lived ephemeral client
  secret.** A server action (`voiceToken.mintClientSecret`, plain-runtime) exchanges the
  server key for a client secret that carries the registry persona and returns ONLY
  `{clientSecret, expiresAt}`. The server key rides the `Authorization` header and is
  structurally absent from the result — never returned, logged, or audited (§4, Pitfall 4).
- **The 15-minute cap is a single server-side wall-clock watchdog, armed once and never
  re-armed or paused.** `voice.startSession` arms exactly one
  `scheduler.runAt(startedAt + CAP_MS, forceEndSession)` the instant the `call_id` is
  persisted. A mic-drop grace window and a silence window **consume cap time** — the
  countdown keeps running through a pause. Why: a movable cap can be stalled
  indefinitely by a hung or malicious client; the cost bound must be server-authoritative.
- **Server force-terminate is a single actuator: the `callId` hangup.**
  `voiceToken.hangupCall` (an `internalAction`, never client-exposed) POSTs
  `/v1/realtime/calls/{callId}/hangup` with the server key. It is the ONLY server-side
  way to end a browser-direct call, and it is what the watchdog fires. A session is
  "active" only WITH a `callId` — the watchdog otherwise has nothing to target.
- **Client-reported usage is telemetry and a best-effort budget contribution, NOT the
  cost bound.** `voice.recordUsage` folds `response.done` deltas onto the spend rails
  (fail-closed on a non-finite/negative delta), but the 15-minute wall-clock cap is the
  real worst-case spend bound, so there is no server-side usage reconciliation.
- **Raw audio is discarded; only the transcript and the brief are retained.** Audio is
  never stored server-side. The two-sided transcript is assembled client-side and welded
  verbatim into the brief in code (never model-authored).
- **The brief BODY is first-class vault content and keeps PII by design; session
  audit/telemetry/DLQ rows carry refs/ids/counts ONLY.** The brief is ingested as an
  ordinary `kind:brief` / `source:voice` vault document (PII kept — `ingestDoc` redacts
  only the vector, not the body). The only log-plane crossings are `{sessionId}` +
  token-count audit rows — never the transcript, the `callId`, the client secret, or the
  brief text. This reconciles §4 (refs-only audit) with the product need for a useful
  brief: the refs-only rule governs the log/audit plane, not vault content.
- **A brief becomes a plan through the existing single-Approve cockpit gate — no
  voice-specific pipeline, no second gate** (ADR-004). The brief's decisions + action
  items become the opening `sendCockpitMessage` turn, landing at the same PLAN card +
  human Approve as every other plan.

## Alternatives rejected

- **A media server (LiveKit / an SFU) between the browser and the model.** Adds infra to
  run and scale, a new pinned component (§6), and a second media plane — all to relay a
  1:1 user↔agent call that browser-direct WebRTC already carries. No multi-party mixing
  is needed. Rejected by the ponytail no-new-dependency rule and by latency.
- **Server-proxied/relayed audio (audio flows through our Convex/server).** Doubles
  bandwidth, adds a hop to a latency-critical path, and puts raw audio — the highest-value
  PII surface — on our infrastructure, the exact liability we discard by design. The
  ephemeral client secret exists precisely so the browser can reach OpenAI directly.
- **The `@openai/agents-realtime` browser SDK.** A new npm dependency for what a raw
  `RTCPeerConnection` + one data channel already does, pinning us to SDK churn on a
  post-cutoff surface. The pinned event/endpoint shapes live in one module
  (`realtime.ts`) with a re-confirm path instead.
- **A movable / client-authoritative cap (pause-and-resume the timer, or trust the
  client to end).** A hung or hostile client could stall an unbounded, billed session. A
  flag or a client "please end" is a bug or an injection away from never firing; the cost
  bound must be structural and server-side. Grace windows therefore consume cap time
  rather than extend it.
- **Server-side usage reconciliation as the cost bound.** The 15-minute wall-clock cap
  already bounds worst-case spend; reconciling client-reported tokens would add a metering
  pipeline that protects nothing the cap does not already protect. Usage stays telemetry.
- **Retaining raw audio.** A large storage + PII liability with no product need — the
  transcript + brief carry all downstream value (search, plan handoff). Keeping audio
  would make the vault an audio-PII honeypot for zero gain.
- **Redacting the brief body like an audit payload (`scanText`-stripping it).** Would
  strip the very content that makes the brief useful and searchable. §4's refs-only rule
  is a log/audit-plane contract; vault content is governed by vault redaction (vector
  only), not by the audit rule.
- **A voice-specific plan pipeline / a second approval gate for voice-derived plans.**
  Two sources of truth and two governance surfaces for one outcome. ADR-004's peer-actor
  pattern already routes any actor's proposal through the single human Approve; voice
  reuses it wholesale.

## Consequences

- **Feature shape is prescribed for the next real-time capability:** mint an ephemeral
  secret server-side, open the media plane browser-direct, bound cost with a
  server-authoritative wall-clock watchdog + a single hangup actuator, keep usage as
  telemetry, retain the derived artifact (not the raw stream), and hand off through the
  existing governed gate.
- **`OPENAI_API_KEY` is server-only; the ephemeral client secret is the only credential
  the browser ever holds** — and even that is short-lived and never logged or audited.
- **The Realtime JSON shapes (mint / calls / hangup / data-channel events) are pinned
  post-cutoff at MEDIUM confidence** in `realtime.ts`, each with a `ponytail:` source +
  re-fetch path. The live human-verify (Plan 08) is their first real 200 confirmation; if
  a mint/handshake/hangup starts 4xx-ing or the transcript stops assembling, re-fetch the
  live doc before touching anything else.
- **No SFU or media infra to operate or scale** — the media plane is OpenAI's; our
  server does mint, watchdog, hangup, meter, and brief-ingest only.
- **Every abnormal end still yields a brief** (the watchdog is the authoritative
  backstop), but a silently closed tab can leave that brief up to 15 minutes late
  (`ponytail:` accepted for beta — upgrade path is a client heartbeat / `pagehide` beacon).
- **The cost bound is worst-case-15-minutes-of-Realtime per session, deterministically** —
  no reliance on client honesty for spend control.
- **Cost:** the pinned-shapes module carries maintenance risk against a churning GA API,
  and metering is intentionally approximate. Both are accepted trade-offs recorded with
  `ponytail:` upgrade paths.
- See `docs/playbooks/voice.md` for the operating contract (invariants, how to change
  safely, how to verify, operations).
