---
phase: 14-flagship-voice-doc-workflow
plan: 06
subsystem: voice-doc
tags: [wave-6, browser, webrtc, tool-relay, route-param, lane-c]
requires:
  - phase: 14-02
    provides: "REALTIME_FUNCTION_CALL, SEARCH_DOCUMENT_TOOL, SESSION_TOOL_KEYS, TOOL_CHOICE_AUTO — the pinned relay vocabulary"
  - phase: 14-03
    provides: "api.voiceDoc.searchDocument — the action the relay calls; startSession's docRef arg"
  - phase: 14-04
    provides: "mintClientSecret({docId?}) -> {clientSecret, expiresAt, toolsAtMint} — the flag the contingency branches on"
provides:
  - "useVoiceSession(docId?) — doc-scoped mint + startSession({docRef}) + the response.done retrieval relay"
  - "REALTIME_CLIENT_EVENTS.updateSession — the session.update event name, added to @pikar/voice"
  - "?doc= read ONCE in page.tsx and threaded to useVoiceSession, LiveSession and PostCall"
  - "docId prop on <LiveSession> (14-07's DocStrip seam) and <PostCall> (14-08's outcome seam)"
affects:
  - "14-07 (consumes the LiveSession docId prop; must NOT add a second param reader)"
  - "14-08 (consumes the PostCall docId prop; must NOT add a second param reader)"
  - "14-09 (live verify: fills realtime.ts's LIVE-VERIFIED line with the accepted tool-declaration branch; the default: branch now logs unhandled function_call* events to support that)"
tech-stack:
  added: []
  patterns:
    - "trigger off an already-live-verified event rather than pinning a new one — response.done over response.function_call_arguments.done"
    - "event-driven send, never a timeout: session.update rides the data channel's `open` event because `send` silently drops a closed-channel write"
    - "always-answer relay: a function_call_output is emitted even on failure, so a turn can never hang in silence"
    - "single route-param reader threaded as props — one place to get the trust story right, one place to get Suspense right"
key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/voice/useVoiceSession.ts
    - apps/web/app/(app)/dashboard/voice/page.tsx
    - apps/web/app/(app)/dashboard/voice/LiveSession.tsx
    - apps/web/app/(app)/dashboard/voice/PostCall.tsx
    - packages/voice/src/realtime.ts
    - packages/voice/src/docSession.test.ts
    - docs/playbooks/voice.md
key-decisions:
  - "Open Question 4 settled on `response.done`: already live-verified in this repo and documented to carry the complete function_call item, so the relay pins ZERO new event names"
  - "the relay sits AFTER `responseActiveRef.current = false` in the same case — that ordering is what makes the trailing response.create legal instead of a silent 400"
  - "no `docId &&` guard on the relay loop: a Phase-6 session declares no tools so output[] can never hold a function_call item; a condition would silently disable a future tool"
  - "`window.location.search` in a mount effect instead of `useSearchParams` + Suspense — the repo's twice-used precedent, and it removes the Pitfall-6 class rather than guarding it"
  - "`session.update` was added to @pikar/voice rather than hardcoded in apps/web, because the plan's guardrail is that no Realtime literal lives in the web app"
---

# Plan 14-06 Summary — the browser relay

**Wave:** 6 · **Tasks:** 3/3 · **Commits:** 2

Closes SC #1's drill-in loop. Both ends already existed — the mint declares the tool (14-04), the
Convex action answers it (14-03) — so this plan is the relay between them plus the route param that
scopes the session. `/dashboard/voice?doc=<id>` now opens a grounded session with a working tool
path.

## Commits

| Commit | Tasks | What |
|--------|-------|------|
| `4922a86` | 1, 2 | doc-scoped connect, `session.update` contingency, the `response.done` relay, pinned outbound vocabulary |
| `e0feb2c` | 3 | `?doc=` read once in `page.tsx`, threaded to both children, playbook |

## Gates

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/voice test` | **57/57** (was 56) |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `pnpm --filter @pikar/web build` | **succeeds**; `/dashboard/voice` stays `ƒ (Dynamic)` |
| `pnpm test` (whole monorepo) | **892/892, zero failures** — backend 526/526, core 195, voice 57, vault 42, extraction 28, cost 22, contracts 14, pii 8 |
| new npm dependencies | **none** (`@openai/agents-realtime` still rejected, ADR-005) |
| hardcoded Realtime literals in `apps/web` | **none** — all resolve through `@pikar/voice` |

## Deviations

### 1. `window.location.search` instead of `useSearchParams` + `<Suspense>`

The plan required `page.tsx` to contain `"Suspense"` **and** to *"copy the exact idiom
`workspace/page.tsx:177-183` already uses — do not invent a second pattern."* Those two instructions
conflict: that idiom deliberately avoids `useSearchParams`, and says so in its own comment
(*"avoids the useSearchParams Suspense boundary for a redirect-only value, the connect-gmail
precedent"*). The planner asserted what the referenced code did without checking it — the same
failure mode as the `internal.vault.getDoc` premise that cost 14-03, 14-04 and 14-05.

Followed the real precedent. This **removes** the Pitfall-6 failure class (a missing boundary either
errors at prerender or silently deopts the whole page to client-side rendering, and `typecheck`
cannot see either) rather than guarding against it. Safe here because `?doc=` is only needed when the
user presses Start, many frames after mount.

Verified with the strict gate regardless: `pnpm --filter @pikar/web build` succeeds and
`/dashboard/voice` remains `ƒ (Dynamic)` in the route table — no prerender error, no CSR deopt. The
reasoning is recorded in `voice.md` so nobody "modernises" it back without also adding the boundary
and re-running the build.

**Net effect on the must_haves:** the `contains: "Suspense"` artifact assertion is unmet by design.
Every behavioural truth in the plan is met.

### 2. `REALTIME_CLIENT_EVENTS.updateSession` added to `@pikar/voice`

The contingency needs the `"session.update"` event name, which did not exist in the vocabulary
module. The plan's own guardrail forbids a Realtime literal in `apps/web`, so it was added to
`packages/voice/src/realtime.ts` (outside this plan's declared `files_modified`, inside Lane C) and
pinned in `docSession.test.ts`.

## Notes for later waves

- **`<LiveSession>` and `<PostCall>` now accept `docId?: string`.** 14-07 and 14-08 consume the prop;
  neither may add a second `?doc=` reader — a second reader is a second place to get the trust story
  and the boundary wrong.
- **The `default:` diagnostic branch now logs unhandled `function_call*` events.** That is 14-09's
  live-verify instrumentation: if a tool call never reaches the relay, the name OpenAI actually sent
  appears in the console under `"[voice]"`.
- **The relay has no automated proof of a real round trip, on purpose.** `apps/web` has no unit
  runner; the honest proof is 14-09's human-verify row.
- `DOCV-01` deliberately left **Pending**.
