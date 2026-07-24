# Phase 11: Persona Onboarding & Business Profile - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A guided first-run onboarding that (a) identifies the user's persona
(solopreneur / startup / SME — enterprise is out of scope, and a low-confidence
detection confirms with the user rather than silently assuming), and (b) captures
their business/idea via files, pasted text, or a written/spoken brief into a
**structured business profile** document that is stored and embedded in the vault,
retrievable via `searchVault`. The profile is tenant-scoped and unreachable by any
other user.

Requirements: **ONBD-01** (persona detection), **ONBD-02** (business intake →
structured, indexed profile).

Downstream: the Phase 12 evaluation engine and the Phase 14 flagship voice-doc
workflow read this profile as their grounded substrate. Those capabilities are NOT
in this phase — Phase 11 only produces the profile and the onboarding that captures it.

</domain>

<decisions>
## Implementation Decisions

### Onboarding flow shape
- **Conversational**, driven by the existing governed cockpit agent (slot-filling),
  NOT a bespoke multi-step wizard. Reuses the Phase 3.2.1 agent-driven cockpit and
  matches the "speak/type a goal" product identity. The typed/written brief is
  inherent to this chat flow.

### Trigger & resumability
- **Forced first-run gate:** a brand-new user is routed into onboarding and cannot
  reach the full cockpit until a business profile exists (Phase 12 eval + Phase 14
  flagship depend on it).
- **Resumable:** progress persists — the user can leave and come back rather than
  being forced to finish in one sitting.

### Persona detection & confirmation (SC #1)
- **Hybrid: infer + confirm.** The LLM infers persona (solopreneur / startup / SME)
  from the business brief the user already provides, then presents its guess for
  one-tap confirm/correct.
- **Always show the detected persona for confirmation** — every detection surfaces
  as "Looks like you're a [persona] — confirm or change." Confirmation is the default
  path, so there is NO confidence threshold to tune; this satisfies SC #1's
  confirm-rather-than-assume requirement by construction.
- Enterprise is not an offered/selectable persona (out of scope).

### Intake modalities (v1 — all three ship)
- **File upload** — reuse Phase 3.8 extraction (deck / one-pager / existing doc → text).
- **Pasted text** — paste a business description into the chat.
- **Spoken brief** — reuse Phase 6 live-voice → brief → profile.
- (Written/typed brief is inherent to the conversational flow, not a separate mode.)

### Business profile structure — Lean core set
- A compact, fixed field set (not full Business Model Canvas): **name, one-line
  description, persona, stage, offering, target customer, primary goals, known
  constraints.** Enough to ground the Phase 12 eval frameworks (SWOT / Lean / BMC)
  without over-specifying early. Exact field names/types are Claude's discretion,
  anchored to what the eval engine needs.

### Review gate before commit
- **Yes — the user reviews and edits the LLM-extracted structured profile before it
  is committed and embedded.** No silently-wrong profile grounds everything downstream.
  This is also the natural moment to confirm the detected persona.

### Later editability
- **Dedicated profile page** where fields are editable; **saving re-embeds** the
  profile doc so grounding stays current (delete/replace the old rag entry on edit).

### Claude's Discretion
- Empty/error/loading states, exact microcopy, and visual layout (follow
  `docs/design/BRAND.md` and existing dashboard patterns).
- Whether an uploaded file / spoken brief is ALSO retained as its own vault doc
  alongside the derived profile, or only distilled into it (default toward reusing
  the normal ingest path so raw sources remain searchable, but planner may decide).
- What "onboarding complete" unlocks beyond cockpit access, and whether a
  persona-only minimal profile may proceed.
- Exact confidence/extraction prompt wording (loads from the skills registry per
  CLAUDE.md §5 — no hardcoded prompts).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`vaultDocuments` table** (`packages/backend/convex/schema.ts`): `kind` is a free
  `v.string()`, so a new `business_profile` kind slots in with **zero schema
  migration** (same as `brief` / `upload` / `brain_dump`). Already tenant-scoped
  (`tenantId` + `by_tenant` index) → SC #3 isolation comes from this seam.
- **Vault ingest → embed pipeline** (`vaultIngest.ts` / `ingestDoc` / `embedDoc`):
  the path that stores + embeds a doc and sets `ragEntryId` / `status`. The profile
  reuses this to become groundable.
- **`searchVault` / `vaultGround.ts`**: tenant-scoped retrieval (`namespace =
  ctx.tenantId`). Once the profile is embedded here it's retrievable per SC #2, and
  isolation per SC #3 is inherited. Has a `SMOKE::<docIds>` offline seam for
  deterministic no-network tests.
- **Phase 3.8 extraction** (`vaultExtract.ts` / `vaultTranscribe.ts`): file/binary →
  text for the file-upload intake mode.
- **Phase 6 voice** (`voice.ts`, `voiceToken.ts`, `apps/web/.../voice`): live-voice
  session → brief (`briefRef` → `vaultDocuments`) for the spoken-brief intake mode.
- **Cockpit agent** (`cockpit.ts`, `packages/contracts/src/skills/cockpitAgent.ts`):
  the governed slot-filling conversational agent to drive onboarding as a conversation.
- **Vault dashboard UI** (`apps/web/app/(app)/dashboard/vault/*`: `DocGrid`,
  `PreviewModal`, `Dropzone`, `CategoryTabs`): patterns/components for the profile page.

### Established Patterns
- **§1 thin adapter:** domain logic in `packages/*`; `convex/` orchestrates. Profile
  parsing/validation should be a pure package function, testable without Convex.
- **§2 tenant wrappers:** use `tenantQuery`/`tenantMutation`/`tenantAction` from
  `lib/functions.ts`, never raw generated server functions.
- **§5 skills registry:** the persona-inference / profile-extraction prompt is a
  versioned `skills` row, not hardcoded source.

### Integration Points
- First-run routing: gate the `(app)/dashboard` cockpit entry on "profile exists?"
  → redirect new users into onboarding; resumable state persisted.
- New `business_profile` doc-kind flows through the same ingest → embed → `searchVault`
  spine; no new retrieval surface needed.

</code_context>

<specifics>
## Specific Ideas

- Persona confirm reads like "Looks like you're a [solopreneur] — confirm or change."
- The review gate should feel like confirming a filled-in structured card, not
  re-typing — the LLM pre-fills, the user corrects.

</specifics>

<deferred>
## Deferred Ideas

- Full Business Model Canvas-aligned profile schema — deferred; Lean core set ships
  first, richer framework mapping can come with the Phase 12 eval engine if needed.
- Conversational profile editing ("update my profile: ...") via a cockpit tool —
  deferred; edit-via-profile-page ships in v1.
- Enterprise persona — explicitly out of scope for this milestone.

</deferred>

---

## Locked Invariant (carried forward — NOT a decision to revisit)

- **§4 redaction boundary (SC #4):** business profiles are name-dense, so NO raw
  profile prose lands in any audit / telemetry / DLQ row — refs, hashes, ids, and
  counts ONLY. Redact-then-write. This is a hard constraint every plan must honor.

---

*Phase: 11-persona-onboarding-business-profile*
*Context gathered: 2026-07-24*
