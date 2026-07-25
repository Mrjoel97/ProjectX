# Phase 14: Flagship Voice-Doc Workflow - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The flagship experience, end to end: a user uploads a report, it is ingested and embedded in
the knowledge vault, they hold a **live voice conversation grounded in that specific document**
(interrupt, drill in, redirect), the agent surfaces **insights / patterns / gaps each carrying a
vault citation** — honestly saying "no gaps" when the document reveals none — and **after** the
discussion the user chooses the outcome: a **memo** or a **gap-bridging plan**, with any resulting
action crossing the normal plan → Approve gate. No report content leaks into audit / telemetry /
step rows (refs + counts only).

Requirement: **DOCV-01**.

**This is an INTEGRATION phase.** Every dependency is already built and shipped:
Phase 6 (live voice sessions), Phase 10 (`searchVault` grounding), Phase 12 (the
evaluation/gap engine), Phase 3.8 + 5 (report ingestion, extraction, embedding, graph).
Phase 14 wires them into one flow — it does not build a new engine.

**Out of scope (own phases / already deferred):**
- Sub-agent dispatch and the generalized action executor → Phase 15 (DISP-01 / ACTN-01).
- Growth-OS **specialist execution** (offer-architect / money-model-designer / lead-engine
  actually building the fix) → acting phases 15+. The gap-bridging plan is Phase 12's
  next-step-memo shape, not specialist execution.
- Web / market-fact claims → Phase 16. The discussion is vault-grounded only.
- Multi-document comparison, session sharing, multi-party voice, scheduled voice sessions.

</domain>

<lane_constraints>
## Lane C constraints (from `.planning/PARALLELIZATION.md`, Phases 14+15 contract)

These are **contract, not preference** — a plan that violates one is a contract change, not a
code change.

- **`convex/llm.ts` — ZERO edits.** Lane A owns it exclusively after Wave 0. This phase's
  retrieval tool must therefore live **outside** `buildCockpitTools` (it is a Realtime-session
  tool relayed by the browser, not a cockpit-loop tool — see Grounding below). This is
  compatible by construction, but the planner must not "just add it to `buildCockpitTools`".
- **`convex/deliverApprovedPlan.ts` / executor files — ZERO edits.** Lane B owns them.
- **`convex/schema.ts` — Wave-0-owned.** Every field/table this phase needs must be
  **declared during planning** so it lands in the Stage-1 freeze commit on `main`. See
  `<wave_0_declarations>` below — that list is a deliverable of this planning pass.
- **`convex/skills.ts` seeding — Lane A only this phase.** Lane C needs a new gated skill row
  (the document-analyst persona). **The planner must flag this as a cross-lane coordination
  item**: either the row is seeded in the Wave-0 commit, or Lane C coordinates with Lane A.
  Version collisions are silent and real (`seedSkills` writes `maxVersion + 1`).
- **Owns freely:** `convex/voice.ts`, the new voice-doc module(s),
  `apps/web/app/(app)/dashboard/voice/*`, read-only use of `convex/evaluations.ts`.

</lane_constraints>

<decisions>
## Implementation Decisions

### Entry point & document scoping

- **Entry is the vault page.** A **ready** document in `/dashboard/vault` gets a
  **"Discuss by voice"** action (on the doc card and/or in `PreviewModal`) that launches a voice
  session scoped to it. No new upload surface — the existing vault upload + `DocGrid` + status
  chrome is the front door. Rejected: a doc-picker inside the voice pre-flight (duplicates upload
  UI, makes the user wait on ingestion inside pre-flight) and cockpit-chat launch (route jump).
- **Exactly ONE report per session.** SC #1 says "that specific document" — the session is scoped
  to a single `vaultDocuments` row. Keeps citations unambiguous and grounding honest.
  Rejected: one-primary-plus-vault-backdrop (blurs the requirement) and multi-doc selection.
- **Not-ready docs are BLOCKED with a live wait state.** While status is
  `processing` / `extracting` / `pending_extraction`, the action is disabled with
  "Still reading your document…" and **enables itself when status flips to `ready`** — Convex
  subscriptions make this live for free. Rationale: never burn capped 15-minute time discussing a
  document the agent cannot actually see.
- **Failed docs are REFUSED with an honest reason.** `status: "failed"` (or no extractable text)
  → no voice action offered, and the vault card explains why ("couldn't read this file — try a
  text-based PDF"). Never open a grounded conversation the agent cannot ground.

### Grounding — how the report reaches the live agent

**Context the planner needs:** the Phase 6 session is **browser-direct**. `voiceToken.ts`
`mintClientSecret` bakes `instructions: skill.body` into the ephemeral client secret, and
`useVoiceSession.ts` handles only transcript/audio data-channel events. There is **no
function-call relay today**, and Phase 10's `searchVault` lives inside `llm.ts`'s cockpit loop,
which this lane may not touch. Both halves below are therefore new wiring in Lane C's own files.

- **HYBRID: bounded pre-load + a realtime retrieval tool.**
  1. A **bounded digest / opening slice** of the document is baked into the session instructions
     at mint time → the agent is fluent from the first second and can open intelligently.
  2. A **Realtime function tool** is registered in the same `session` config `voiceToken.ts`
     already builds, and the browser relays `response.function_call_arguments.done` →
     a Convex action → `conversation.item.create` with the output. This is what makes
     SC #1's "**drill in**" real rather than "discuss whatever fit in the cap".
  - Rejected: pre-load-only (a long report truncates; drill-in is capped at what was loaded) and
    retrieval-only (the agent starts cold and burns capped time fetching).
  - **Architecturally this stays inside Lane C**: the tool is a Realtime-session tool relayed by
    the browser to a new voice-doc Convex module — it is NOT a `buildCockpitTools` entry, so
    `llm.ts` is untouched.

- **Citations: document-level always, plus a quoted passage where available.** Every
  insight / pattern / gap carries the vault document citation unconditionally (cheap, always
  correct, guarantees SC #2 is met even when the retrieval layer yields no locator), and shows a
  **quoted passage from the report** whenever the agent can produce one. Rejected: locator-only
  (needs chunk locators that may not exist) and quote-only (no guaranteed floor).

- **Opening move: proactive summary, then hand over.** The agent opens by briefly summarizing
  what it read and naming **2–3 things it noticed**, then invites steering ("where do you want to
  start?"). This demonstrates grounding immediately — the flagship moment — and gives the user
  something concrete to **interrupt and redirect**, which is literally SC #1. Rejected: a bare
  greeting (undersells the grounding) and a full findings walkthrough (a monologue against a
  15-minute cap).

- **Its own gated skill row: a "document analyst" persona.** A new versioned `skills` row (§5)
  tuned for grounded document discussion — citation discipline, honest "the report doesn't say
  that", gap surfacing, the truncation disclosure below. The Phase 6 `voice-session` persona is
  **left unchanged**, so a Phase 14 prompt change cannot regress Phase 6. Rides the Phase-3.6
  eval gate (seed candidate → `pnpm eval:golden` → activate). **See the Lane A seeding
  coordination note above.**

- **Truncated extraction is disclosed UP FRONT.** When `vaultDocuments.extractionTruncated` is
  set, the agent's opening acknowledges it ("I've read the first portion of this…") **and** the
  doc context strip carries a "partial" badge. The user calibrates trust *before* spending 15
  capped minutes, not after.

### Surfacing insights / patterns / gaps

- **Raised live by voice, consolidated after.** The agent surfaces what it notices **during** the
  conversation — that is what makes it a discussion rather than a report-out, and it lets the user
  push back on a finding in the moment. The post-call screen then consolidates everything into a
  reviewable, cited list. Rejected: silent collection (the user can't challenge a finding while
  talking) and live-only (15 minutes of speech is a poor way to review a cited findings list).

- **Live UI = Phase 6 layout + a document context strip.** Keep `LiveSession.tsx`'s transcript +
  speaking orb + countdown, and add a **slim strip naming the document under discussion** (title,
  click → the existing vault `PreviewModal`; carries the "partial" badge when truncated). No live
  insights panel — it would compete with the transcript for attention during a voice call and
  double the live UI to build and test.

- **Findings persist in the EXISTING `evaluations` table.** Widen the closed
  `evaluations.framework` union with a document-review literal and write
  `findings` / `gaps` / `notEnoughData` / `verdict` there. This inherits, for one schema union
  widening: per-finding `citationDocId` + `citationTitle` + confidence, leverage-ranked gaps with
  `reason` / `proofMetric`, the honest `verdict: "healthy"` path, `actOnGap` → proposed PLAN →
  Approve, and the existing tenant-isolation test. **Biggest reuse win in the phase.** Rejected: a
  dedicated voice-doc findings table (re-implements the card, the gap→plan spine and the isolation
  test) and brief-markdown-only (leaves `actOnGap` nothing structured to act on, which SC #3
  needs).
  - **`evaluations.threadId` is required and a voice session has no chat thread** → the session
    uses a **synthetic thread id** so the row stays well-formed and reusable. Planner must define
    it (deterministic from the voice session id is the obvious shape).

- **Honest "no gaps" is said aloud AND shown affirmatively.** The agent says so in conversation,
  and the post-call screen renders Phase 12's affirmative healthy-verdict treatment with the cited
  **strengths** it did find. The spoken version is what makes it feel honest; the card makes it a
  real outcome rather than an empty result. This is SC #2's honesty clause and needs a
  **healthy-document golden fixture** at the eval gate.

### The outcome choice — memo vs gap-bridging plan

- **The choice is made on the post-call screen** (`PostCall.tsx`), alongside the existing brief
  review. Phase 6 chose this surface deliberately because it works identically for a **clean end
  AND a dropped call** — a session that drops at minute 12 still reaches an outcome. SC #3's
  "after the discussion" is satisfied literally. Rejected: by-voice-only (a dropped or timed-out
  call never reaches the question; Phase 6 already rejected this as the required path). A by-voice
  ask that *pre-selects* the on-screen answer remains a nice-to-have, not a requirement.

- **The memo IS the brief, document-flavored — ONE vault artifact per session.** Rather than
  producing a Phase 6 brief *and* a separate memo, a voice-doc session produces a single vault
  document: the Phase 6 brief structure extended with the cited insights / patterns / gaps.
  "Memo" is what that outcome is called here. Reuses `persistBrief` / `storeBrief` and — critically
  — the **abnormal-end path for free**. Rejected: two artifacts (the user can't tell which is
  which) and memo-replaces-brief (inconsistent vault record between the two outcome paths).

- **The memo needs NO Approve gate; the plan does.** Writing a document into the user's own vault
  is not an outward-facing action — it is exactly what Phase 6 already does with a brief, ungated.
  The plan → Approve gate applies to the **gap-bridging plan** and anything it executes. This keeps
  the gate meaningful rather than ceremonial. (The Phase 6 clean-end brief **review/edit** step
  still applies — that is a human checkpoint, not a plan gate.)

- **Gap-bridging plans are per-gap, user-selected.** The post-call findings list shows the gaps and
  the user **taps the ones worth acting on** — Phase 12's "Act on this" → proposed PLAN idiom,
  reused wholesale via `actOnGap`. Keeps the user deciding (SC #3) and avoids a plan padded with
  gaps they don't care about. Rejected: one bundled all-gaps plan (unequal gaps behind one
  approve/reject) and propose-all-then-trim (needs plan-editing UI that may not exist).

- **Findings render on the post-call screen**, not as a workspace card — one screen, one decision
  point, no route jump at the flagship flow's most important moment. Rejected: workspace-card-only
  and dual-surface (both fragment the flow; the cross-surface thread wiring is the expensive part).

### Cost, metering & accessibility

- **Cost control stays time-cap-only** — Phase 6's decision carries forward **unchanged**. The
  15-minute wall-clock cap bounds how many retrieval calls are physically possible, and retrieval
  embedding cost is small next to realtime audio tokens. No per-session retrieval-call cap, no
  separate cost cutoff, no new metering wiring. (Existing `recordUsage` audio/text token metering
  is untouched.)
- **The Phase 6 text-input fallback carries into the doc session unchanged** — same transport,
  same transcript. Dropping it would regress an explicit Phase 6 accessibility commitment.
  Keyboard + screen-reader coverage of the new post-call findings / gap-selection UI follows the
  `docs/design/BRAND.md` rules as normal (non-negotiable-quality baseline, not a special ask).

### Governance invariants (locked — carried forward, not decisions to revisit)

- **§4 refs-only.** The report's text, quoted passages, insight prose and citation **titles** are
  **content plane** — they reach the loop, the UI, the `evaluations` row and the vault memo, and
  **never** an `audit` / `telemetry` / `agentSteps` payload. Audit rows for the retrieval tool
  carry a query **hash** + a result **count** (the exact `searchVault` split from Phase 10). This
  is SC #4 and it is testable statically — mirror `llmRedaction.test.ts`'s approach.
- **§5 skills registry.** The document-analyst persona is a versioned DB `skills` row loaded at
  runtime, never a hardcoded prompt. Fail-closed when unseeded (`getActiveSkill` throws
  `NO_ACTIVE_SKILL`) — the same discipline `voiceToken.ts:44` already uses.
- **§1 thin adapter.** Doc-discussion domain logic (digest budgeting, citation assembly, findings
  shaping) belongs in `packages/voice` / `packages/*`; `convex/` orchestrates.
- **§2 tenant wrappers.** All session/doc/findings reads+writes go through
  `convex/lib/functions.ts`. `namespace = ctx.tenantId` on retrieval, as `vaultGround` already does.
- **BETA-05.** A cross-tenant isolation assertion ships for this surface: tenant A's voice-doc
  session can never retrieve or cite tenant B's document.
- **`OPENAI_API_KEY` never leaves Convex.** The browser gets an ephemeral secret only
  (Phase 6 Pitfall 4). The retrieval relay must not become a new key-exposure path.

### Claude's Discretion

- The pre-load digest budget (how much of the report is baked in at mint) and the retrieval
  tool's chunk/char budget per call.
- Whether the retrieval tool reuses `vaultGround` scoped to one `docId` or reads
  `vaultDocuments.text` directly — and how the doc-scoping filter is expressed.
- The exact synthetic `threadId` derivation for the voice-doc `evaluations` row.
- The document-review `framework` literal's name and whether findings reuse Phase 12's `section`
  taxonomy or a document-shaped one.
- Which eval-gate golden fixtures ship (a grounded drill-in turn and a **healthy / no-gaps
  document** fixture are the two SC-critical ones) and the exact skill body wording.
- Doc context strip visual design, "partial" badge styling, post-call findings layout, microcopy,
  loading/empty/error states — per `docs/design/BRAND.md` and the existing card patterns.
- Whether the by-voice end-of-call ask (pre-selecting the on-screen choice) ships now or is
  deferred.

</decisions>

<wave_0_declarations>
## Schema / seam declarations for the Stage-1 Wave-0 freeze commit

`convex/schema.ts` is frozen to the Wave-0 commit on `main`. **The planner MUST produce this list
explicitly** — anything missed here becomes a cross-lane contract change mid-execution.

Known needs from the decisions above (planner to confirm and complete):

1. **`evaluations.framework`** — widen the closed `v.union` with a document-review literal.
   *(Note: the union is closed today — `swot` / `lean` / `bmc` / `growth-os`.)*
2. **`voiceSessions`** — a field scoping a session to its document (e.g. an optional
   `docRef: v.optional(v.id("vaultDocuments"))`), optional so existing rows need no migration.
3. Any field needed to link the session's `evaluations` row back to the session (or the synthetic
   `threadId` convention that makes a field unnecessary).
4. **Empty stub file(s)** for the new voice-doc Convex module Lane C will own.
5. **`convex/skills.ts`** — the document-analyst skill row (Lane A owns seeding this phase;
   coordinate or land it in Wave 0).
6. **`docs/playbooks/watch.json`** — register the new module paths so the Stop hook can protect
   them (Wave-0-owned by precedent).

</wave_0_declarations>

<specifics>
## Specific Ideas

- The flagship moment is the **opening**: the agent has clearly read the report and says something
  specific and non-obvious about it within the first fifteen seconds, and the user can cut it off
  mid-sentence to redirect. If that lands, the phase lands.
- "Drill in" must be *real* — the user should be able to say "what does it say about churn in
  Q3?" and get a passage the agent did not have loaded when the call started.
- Honesty is the through-line and it appears in four places, deliberately: refuse a failed doc,
  disclose a truncated read, say "the report doesn't say that" mid-conversation, and give an
  affirmative "no gaps" rather than manufacturing one to look useful.
- **One artifact per session.** A user who has a voice conversation about a report should find
  exactly one new thing in their vault afterwards, not two overlapping ones.
- The post-call screen is the load-bearing surface (Phase 6's property): brief review, cited
  findings, the memo-vs-plan choice and the gap taps all live there, so a call that drops at
  minute 12 still reaches a real outcome.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets — voice (Phase 6, shipped)
- `packages/backend/convex/voice.ts` — session lifecycle: `startSession`, `endSessionClean`,
  `abortSession`, `forceEndSession` (watchdog), `recordUsage`, `persistBrief`, `storeBrief`.
  **Lane C owns this file.** Doc-scoping hangs off `startSession`.
- `packages/backend/convex/voiceToken.ts` — `mintClientSecret` (bakes the registry persona into
  the ephemeral secret; the `session` config object is where a `tools` array would be added) and
  `hangupCall` (the watchdog's actuator). **The single seam where the doc pre-load lands.**
- `packages/voice/src/*` — pure domain: `brief.ts` (`BRIEF_HEADERS`, `buildBriefMarkdown`,
  `composeBrief`, `planSeedFromBrief`), `session.ts` (`CAP_MS`, `capEndsAt`, `canTransition`),
  `metering.ts` (`accumulateUsage`), `realtime.ts` (`REALTIME_EVENTS`, `REALTIME_CLIENT_EVENTS`,
  `SESSION_CONFIG_KEYS`, `readUsage`, `DEFAULT_REALTIME_MODEL`, `TURN_DETECTION_TYPE`).
  §1 says the doc-discussion domain logic joins these, not `convex/`.
- `apps/web/app/(app)/dashboard/voice/` — `page.tsx` (preflight → live → postcall phase machine),
  `PreFlight.tsx`, `LiveSession.tsx`, `PostCall.tsx`, `AbnormalBriefBanner.tsx`,
  `useVoiceSession.ts` (the data-channel event switch — **where the tool-call relay is added**).
- `packages/backend/convex/schema.ts` `voiceSessions` — status union, `callId`, `endsAt`,
  `watchdogFnId`, the four token counters, `briefRef`.
- **ADR-005** — "Live voice is browser-direct OpenAI Realtime over WebRTC, bounded by a single
  server wall-clock watchdog, with metering as telemetry." Read before changing the transport.

### Reusable Assets — grounding & findings (Phases 10 & 12, shipped)
- `packages/backend/convex/vaultGround.ts` — hybrid retrieval → doc-id map → hop-capped
  tenant-scoped graph expand → fuse, with a `SMOKE::` offline seam (deterministic tests with no
  `OPENAI_API_KEY`). The doc-scoped retrieval tool should reuse this, not rebuild it.
- `packages/backend/convex/vaultRag.ts` (`rag.search`, `namespace = ctx.tenantId`),
  `packages/backend/convex/vaultGraph.ts` (`expand`), `packages/vault/src/index.ts` (`fuse`,
  `GRAPH_HOP_CAP`).
- `packages/backend/convex/evaluations.ts` — **read-only for this lane**: `insertEvaluation`,
  `runEvaluation`, `actOnGap` (gap → proposed PLAN → Approve), `persistNextStepMemo`, `byThread`,
  `lastForThread`. The `actOnGap` spine is what SC #3 reuses.
- `packages/backend/convex/schema.ts` `evaluations` — `findings[]` (label / section /
  `citationDocId` / `citationTitle` / confidence / source), `gaps[]` (label / `leverageRank` /
  route / playbook / `citationDocId` / reason / proofMetric), `notEnoughData[]`, `verdict`
  (`gaps` | `healthy` | `insufficient`). **Already the exact shape SC #2 needs.**
- `packages/backend/convex/plans.ts` — the plan lifecycle
  (`collecting → proposed → approved → …`). The gap-bridging plan enters here.

### Reusable Assets — vault & ingestion (Phases 3.8 / 5, shipped)
- `packages/backend/convex/vaultIngest.ts`, `vault.ts`, `vaultExtract.ts`, `vaultTranscribe.ts` —
  the store → extract → embed → `ready` pipeline the uploaded report already flows through.
  Phase 14 **consumes** this; it does not extend it.
- `packages/backend/convex/schema.ts` `vaultDocuments` — `status` union (`processing` /
  `ready` / `failed` / `pending_extraction` / `extracting`) drives the entry-point gating;
  `extractionTruncated` drives the partial-read disclosure; `text` holds the extracted content.
- `apps/web/app/(app)/dashboard/vault/` — `page.tsx`, `DocGrid`, `PreviewModal`. The
  "Discuss by voice" action and the doc context strip's click-through both land here.

### Established Patterns
- **Registry personas, fail-closed** — `voiceToken.ts:44` reads the active skill and throws when
  unseeded. The document-analyst persona follows this exactly; no hardcoded fallback prompt.
- **labels-to-loop / refs-to-audit split** (`listInbox`, `searchVault`, `evaluateBusiness`) —
  titles, quotes and findings reach the loop/UI; only hashes/ids/counts reach audit.
- **`agentSteps` has no text field by construction** — §4 is enforced by the *absence* of a place
  to put prose. Any voice-doc activity step inherits that constraint.
- **`SMOKE::` offline seam** — `vaultGround` bypasses the embedding network for deterministic
  tests. The retrieval-tool tests ride it.
- **Eval gate (Phase 3.6)** — a new gated skill activates only through a recorded passing
  `pnpm eval:golden`; `GATED_SKILLS` lives in `packages/contracts/src/skill.ts`.
- **Two-tenant isolation assertion per new surface** (BETA-05) — the `by_tenant` /
  `by_tenant_thread` indexes make it cheap.

### Integration Points
- Vault doc card / `PreviewModal` → "Discuss by voice" → `/dashboard/voice` scoped to a `docId`.
- `voiceToken.ts` `mintClientSecret` → doc digest into `instructions` + a `tools` array in the
  `session` config.
- `useVoiceSession.ts` data-channel switch → a new `response.function_call_arguments.done` case →
  a Convex voice-doc retrieval action → `conversation.item.create` back onto the channel.
- Session end → `evaluations` row (synthetic threadId) + the doc-flavored brief/memo via
  `persistBrief` / `storeBrief`.
- `PostCall.tsx` → cited findings list + memo-vs-plan choice + per-gap "Act on this" →
  `evaluations.actOnGap` → `plans.ts` proposed PLAN → existing Approve gate.
- **New gated skill** → `packages/contracts/src/skill.ts` `GATED_SKILLS` + a `skills.ts` seed row
  (**Lane A coordination**) + golden fixtures for `pnpm eval:golden`.

</code_context>

<deferred>
## Deferred Ideas

- **By-voice end-of-call ask** ("memo or plan?") pre-selecting the on-screen choice — a
  nice-to-have fast-follow; the post-call screen is the required path (same call Phase 6 made).
- **Live insights side panel** during the call — considered and rejected for attention/cost
  reasons; revisit if the post-call consolidation proves insufficient.
- **Multi-document discussion** (compare two reports, or a primary doc against the whole vault) —
  a real capability, its own phase. Phase 14 is deliberately one report.
- **A workspace EVALUATION card for voice-doc findings** (revisitable in chat alongside business
  evaluations) — needs cross-surface thread wiring; the post-call screen is the flagship path.
- **Per-session retrieval-call cap / retrieval cost metering** — considered; time-cap-only carries
  forward. Revisit only if live verification shows the agent looping on retrieval.
- **Specialist execution of a gap-bridging plan** (offer-architect etc. actually building the fix)
  — acting phases 15+. The plan produces Phase 12's concrete next-step memo shape.
- **Web / market-fact enrichment of the discussion** — Phase 16.

</deferred>

## Open Questions for Research

- **Realtime function calling over the browser-direct data channel** — confirm the exact
  `session.tools` shape accepted by `client_secrets` for `gpt-realtime-2.1`, the
  `response.function_call_arguments.done` event shape, and the `conversation.item.create`
  function-output round trip. Phase 6's live-verification notes in `voiceToken.ts:28-31` and
  `:57-58` are a standing warning that the pre-live guess about this API's shape was wrong twice —
  **verify against a real call, don't infer**.
- **Instruction-size budget for the pre-loaded digest** — how much document text can be baked into
  `instructions` at mint without a 400, and what that implies for the digest strategy (summary vs
  head slice vs structured outline).
- **Whether the retrieval tool should call `vaultGround` scoped to one `docId` or read
  `vaultDocuments.text` directly** — `vaultGround` gives chunk-level hits and the `SMOKE::` seam;
  direct text is simpler for a single known doc. Weigh against the 16 MiB read cap on
  book-sized `text` blobs.
- **Realtime tool-call cost/latency inside a 15-minute cap** — how long a relayed retrieval round
  trip takes in practice, and whether the agent needs an instruction to cover the pause verbally.
- **Whether widening `evaluations.framework` disturbs Phase 12/13 readers** — `runEvaluation`,
  the EVALUATION card, and the BEVL-03 cron all read this table; a new literal must not make a
  voice-doc row appear in a business-review surface.
- **Prompt-injection ceiling** — Phase 10 marked "a hostile uploaded doc carrying instructions" as
  an accepted ceiling with a `ponytail:` upgrade path. A pre-loaded digest sitting in the *system
  instructions* of a voice session is a materially stronger version of that exposure than a tool
  return. Research should confirm the ceiling is still acceptable here and mark it the same way.

---

*Phase: 14-flagship-voice-doc-workflow*
*Context gathered: 2026-07-25*
