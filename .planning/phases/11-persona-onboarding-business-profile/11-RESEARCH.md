# Phase 11: Persona Onboarding & Business Profile - Research

**Researched:** 2026-07-24
**Domain:** First-run onboarding + structured business-profile capture into the vault (reuse-heavy wiring, not greenfield)
**Confidence:** HIGH (all seams read at source in this repo; no external-library guesses)

> This phase is **design-locked** (11-CONTEXT.md). This document de-risks the **wiring**, not the design.
> Every finding below is a real signature/pattern read from the current tree — reuse targets, exact
> call shapes, the §4 boundary, the new doc-kind/skill introduction, and the one real gated-skill gotcha.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Flow shape:** Conversational, driven by the existing governed cockpit agent (slot-filling), NOT a
  bespoke wizard. Typed/written brief is inherent to the chat flow.
- **Trigger:** Forced first-run gate — a brand-new user is routed into onboarding and cannot reach the
  full cockpit until a business profile exists. **Resumable** — progress persists across sessions.
- **Persona detection (SC #1):** Hybrid infer + confirm. LLM infers persona (solopreneur / startup /
  SME) from the brief, then ALWAYS surfaces it for one-tap confirm/correct ("Looks like you're a
  [persona] — confirm or change"). No confidence threshold — confirmation is the default path.
  Enterprise is NOT an offered persona.
- **Intake modalities (all three ship v1):** file upload (reuse Phase 3.8 extraction), pasted text,
  spoken brief (reuse Phase 6 voice). Typed brief is inherent to the chat.
- **Profile structure — Lean core set:** name, one-line description, persona, stage, offering, target
  customer, primary goals, known constraints. Exact field names/types are Claude's discretion,
  anchored to what the Phase 12 eval engine needs.
- **Review gate before commit:** the user reviews/edits the LLM-extracted structured profile before it
  is committed and embedded. Confirm-persona happens here too.
- **Later editability:** dedicated profile page, fields editable; **saving re-embeds** (delete/replace
  the old rag entry on edit).

### Claude's Discretion
- Empty/error/loading states, microcopy, visual layout (follow `docs/design/BRAND.md` + dashboard patterns).
- Whether an uploaded file / spoken brief is ALSO retained as its own vault doc alongside the derived
  profile, or only distilled into it (default: reuse the normal ingest path so raw sources stay searchable).
- What "onboarding complete" unlocks beyond cockpit access; whether a persona-only minimal profile may proceed.
- Exact confidence/extraction prompt wording (loads from skills registry per §5 — no hardcoded prompts).

### Deferred Ideas (OUT OF SCOPE)
- Full Business Model Canvas-aligned profile schema (Lean core ships first).
- Conversational profile editing via a cockpit tool ("update my profile: ...") — edit-via-page ships v1.
- Enterprise persona.

### Locked Invariant (carried forward — NOT a decision to revisit)
- **§4 redaction boundary (SC #4):** business profiles are name-dense → NO raw profile prose in any
  audit / telemetry / DLQ row. Refs, hashes, ids, counts ONLY. Redact-then-write. Hard constraint.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ONBD-01 | Guided first-run onboarding identifies persona (solopreneur / startup / SME; enterprise deferred) | Persona inferred by a NEW ungated extraction skill (generateObject pattern, §"Persona + Profile extraction"); always surfaced for confirm (SC#1). First-run gate via a new `onboarding.status` query in the client shell (§"First-run gate"). |
| ONBD-02 | User supplies business/idea (files / pasted text / written or spoken brief) → structured profile stored + indexed in the vault | Profile stored as a `vaultDocuments` row (kind `business_profile`) via the **`persistBrief` template** and `startIngest` → embed → `searchVault` (§"Profile as a vault doc"). Intake reuses `vaultUpload`/`vaultIngestText`/`vaultExtract`/voice `persistBrief` verbatim. |

</phase_requirements>

## Summary

Phase 11 is **almost entirely a wiring exercise over shipped seams** — the ponytail-correct build reuses
five existing spines and introduces exactly **two new artifacts**: (1) a `business_profile` vault doc-kind
(zero schema migration — `kind` is `v.string()`), and (2) a new UNGATED persona+profile extraction skill
row (mirrors `voice-brief`). No new retrieval surface, no new ingest pipeline, no pinned-component bump.

The **canonical template already exists**: `voice.ts::persistBrief` inserts a `vaultDocuments` row (a
markdown brief), sets `status:"processing"`, and calls `startIngest` — which runs the durable ingest
workflow (embed → extract → `markReady`) and makes the doc retrievable through `searchVault` /
`vaultGroundHydrated`. The business profile is that pattern with `kind:"business_profile"` and the
structured profile serialized as its text. SC#2 (embed + retrieve), SC#3 (tenant isolation via
`namespace = tenantId` + `ownedDocsMeta`), and the SMOKE offline seam all come for free from this spine.

**The one real risk to flag for the planner:** the cockpit conversation engine (`cockpit-agent` skill) is
a **GATED** skill (EVAL_GATE). Teaching onboarding by editing the `cockpit-agent` body publishes a
candidate that cannot activate without a green `pnpm eval:golden` run pinning that exact version — and
risks the ~25 existing golden fixtures. The lazy + safe path keeps persona-inference/profile-extraction as
a **separate toolless `generateObject` skill** (ungated, like `voice-brief`/`inbox-digest`), invoked at the
review-gate moment, while the *conversation UI* reuses the existing cockpit chat components. This honors
the "conversational" locked decision without dragging every onboarding tweak through an eval cycle.

**Primary recommendation:** Reuse `persistBrief` + `startIngest` for the profile doc (kind
`business_profile`, `source:"agent"` → `workspace-docs` category); add ONE ungated extraction skill;
gate first-run in the client `AppShell` with a new `onboarding.status` tenantQuery; keep the gated
`cockpit-agent` body untouched.

## Standard Stack

No new dependencies. Everything is in-tree and pinned.

### Core (reuse verbatim)
| Seam | File / Symbol | Signature / shape | Use in Phase 11 |
|------|---------------|-------------------|-----------------|
| Profile doc template | `voice.ts::persistBrief` (internalMutation) | inserts `vaultDocuments` {kind, text, status:"processing"} then `startIngest` | **Copy this** for the `business_profile` doc |
| Ingest starter | `vaultIngest.ts::startIngest(ctx,{vaultDocId,tenantId,correlationId})` | helper (not a Convex fn); attaches `onComplete` failure-handling | Called by the profile-commit mutation |
| Ingest workflow | `internal.vaultIngest.ingestDoc` | preCall gate → `embedDoc` → `extractGraph` → `upsertGraph` → `recordSpend` → `markReady` | Runs automatically; nothing to write |
| Text ingest (paste) | `vault.ts::vaultIngestText` (tenantMutation) `{text,title?,source?,docId?}` → `{vaultDocId}` | hash-dedup; `docId` = late-text seam | Pasted-text intake mode |
| File ingest | `vault.ts::vaultUpload` (tenantMutation) `{storageId,filename,mimeType,size,contentHash,text?}` → `{vaultDocId}` | binaries → `pending_extraction`, auto-schedules `vaultExtract`/`vaultTranscribe` | File-upload intake mode |
| Extraction rail | `internal.vaultExtract.extractDoc` / `vaultTranscribe.transcribeDoc` → `vault.ingestExtractedText` | binary → text → `startIngest` | File/deck → text (Phase 3.8) |
| Retrieval (identity-less) | `internal.vaultGround.vaultGroundHydrated({tenantId,query})` → `{docIds,titles,chunks}` | explicit tenantId; SMOKE:: seam | Confirms profile is groundable (SC#2) |
| Retrieval (browse) | `vault.ts::vaultSearch` (tenantAction) `{query,category?}` | same `rag.search` hybrid + `ownedDocsMeta` | Profile shows up in vault browse |
| Voice brief → doc | `voice.ts::persistBrief` / `storeBrief` (session `briefRef` → `vaultDocuments`) | already produces a vault doc | Spoken-brief intake mode |
| Skill load | `internal.skills.getActiveSkill({name})` → `{body,version,skillId}` | fails closed if unseeded (§5) | Load the extraction skill body |
| Structured extraction | `llm.ts` `generateObject({model,system:skill.body,schema,prompt})` pattern (see `draftCockpit`) | returns typed object + usage | Persona inference + profile extraction |
| Tenant wrappers | `lib/functions.ts`: `tenantQuery` / `tenantMutation` / `tenantAction` | inject `ctx.tenantId` (§2) | All new Convex fns |
| Refs-only audit | `internal.audit.log({tenantId,correlationId,eventType,actor,payload})` | insert-only (§3); payload refs/hashes/counts ONLY (§4) | Any onboarding audit event |

### Supporting (patterns to copy)
| Pattern | Source | Why |
|---------|--------|-----|
| §4 refs-only audit for a name-dense op | `llm.ts` `searchVault` tool → `payload: { queryHash: await contentHash(query), resultCount }` | The exact template for keeping profile prose out of audit |
| Content-plane text is OK | `persistBrief` comment: "PII kept — content plane (§4); ingestDoc redacts only the vector" | Profile prose lives ONLY in `vaultDocuments.text` + rag chunks — both already excluded from audit/WORM |
| Structured output over a skill | `llm.ts::draftCockpit` (getActiveSkill → generateObject(schema)) | Persona+profile extractor mirrors this |
| SC2 untrusted-reference fence | `searchVault` tool `<vault_context …>` fence | If the extractor consumes an uploaded deck, fence it (ADR-006 trusted-as-own still applies) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New ungated extraction skill + untouched `cockpit-agent` | Editing the gated `cockpit-agent` body to add onboarding tools/prompt | Gated edit ⇒ publishes a CANDIDATE that needs a green `eval:golden` run pinning that version to activate, and risks the ~25 golden fixtures. **Reject** unless onboarding must drive plan-tool-state. |
| New `business_profile` kind (free string) | New table | A table is a schema change + a new retrieval surface; the free-string `kind` is zero-migration and inherits the whole ingest/search spine. **Reject the table.** |
| `source:"agent"` (→ `workspace-docs`) | A new `VaultSource`/category | `VaultSource` is a fixed union (`upload|paste|agent|google`) and `VAULT_CATEGORIES` is a fixed 6. Adding either is a migration for no benefit. **Reuse `"agent"`.** |

**Installation:** none — no packages added.

## Architecture Patterns

### Where each piece lives (§1 thin adapter)
```
packages/contracts/src/
├── skill.ts                       # + BUSINESS_PROFILE_SKILL const (NOT in GATED_SKILLS)
└── skills/businessProfile.ts      # + extraction skill body (markdown seed, §5)
packages/<domain>/src/             # PURE profile validation/serialization (§1) — testable w/o Convex
│   └── businessProfile.ts         # profile schema (Zod/plain), persona enum, serialize→markdown,
│                                  # "always-confirm" decision fn (SC#1), field validators
packages/backend/convex/
├── onboarding.ts                  # NEW thin adapter: status query, commitProfile mutation,
│                                  #   extractProfile action (generateObject), updateProfile (re-embed)
├── skills.ts                      # + businessProfileSkillBody into the seedSkills[] array
└── vault.ts / vaultIngest.ts      # UNCHANGED — reused via startIngest
apps/web/app/(app)/
├── layout.tsx                     # + first-run gate (useQuery onboarding.status → redirect)
└── dashboard/onboarding/page.tsx  # NEW conversational onboarding + review-card UI
└── dashboard/<profile>/page.tsx   # NEW editable profile page (saving re-embeds)
```

### Pattern 1: Profile as a vault doc (the `persistBrief` clone — ONBD-02)
**What:** commit the reviewed structured profile as a single `vaultDocuments` row; `startIngest` embeds it.
**When:** at the review-gate "commit" click.
**Example (shape to mirror — from `voice.ts::persistBrief`):**
```typescript
// Source: packages/backend/convex/voice.ts:299-324 (persistBrief) — the template
const text = serializeProfile(profile);              // pure §1 fn → markdown/text
const vaultDocId = await ctx.db.insert("vaultDocuments", {
  tenantId: ctx.tenantId,
  title: profile.name || "Business profile",
  kind: "business_profile",                          // NEW free-string kind — zero migration
  category: categoryFor({ source: "agent" }),        // → "workspace-docs"
  source: "agent",
  mimeType: "text/markdown",
  size: byteLen(text),
  contentHash: await contentHash(text),
  text,                                              // content plane (§4) — prose lives ONLY here
  status: "processing",
  createdAt: Date.now(),
});
await startIngest(ctx, { vaultDocId, tenantId: ctx.tenantId, correlationId: crypto.randomUUID() });
```
Retrieval, tenant-isolation, and the SMOKE seam are then inherited — nothing else to build for SC#2/#3.

### Pattern 2: Persona + profile extraction (a NEW ungated skill — ONBD-01)
**What:** one `generateObject` call over the intake text (paste / extracted file / voice brief) that returns
the Lean-core structured profile INCLUDING an inferred `persona`. Never auto-commits (SC#1: always confirm).
**Example (shape to mirror — from `llm.ts::draftCockpit`):**
```typescript
// Source: packages/backend/convex/llm.ts:280-311 (draftCockpit generateObject pattern)
const skill = await ctx.runQuery(internal.skills.getActiveSkill, { name: BUSINESS_PROFILE_SKILL });
const { object } = await generateObject({
  model: DEFAULT_MODEL.model,
  system: skill.body,               // §5 — prompt from registry, never hardcoded
  schema: profileSchema,            // includes persona enum: solopreneur | startup | sme
  prompt: intakeText,               // fence if it's an uploaded deck (ADR-006)
});
// Return `object` to the review card / client — NEVER into an audit/telemetry/DLQ payload (§4).
```
Skill is **ungated** (its output is a vault doc + a UI card, not plan tool-state — the exact `voice-brief`
rationale in `skills.ts:249-250`). Ungated ⇒ `seedSkills` publish-and-activates on a body edit; no eval cycle.

### Pattern 3: First-run gate (forced, resumable)
**What:** block cockpit access until a `business_profile` exists; resume mid-onboarding across sessions.
**Where:** `middleware.ts` is Convex-Auth cookie-only and **cannot read app data** — do NOT try to gate
there. Gate in the client `AppShell` (`app/(app)/layout.tsx`), which already wraps everything in
`<Authenticated>`. Add a `useQuery(api.onboarding.status)` → if `needsOnboarding`, redirect to
`/dashboard/onboarding`.
```typescript
// api.onboarding.status (new tenantQuery): tenant-scoped existence check — refs/booleans only (§4)
// returns { needsOnboarding: boolean, profileDocId?: Id<"vaultDocuments">, draftState?: ... }
const docs = await ctx.db.query("vaultDocuments")
  .withIndex("by_tenant", q => q.eq("tenantId", ctx.tenantId)).collect();
return { needsOnboarding: !docs.some(d => d.kind === "business_profile" && d.status !== "failed") };
```
**Resumability:** existence of the committed `business_profile` row is the completion signal. A *partial*
draft (persona confirmed but profile not committed) needs somewhere to persist — Claude's-discretion
options: (a) a lightweight `onboardingState` field/row keyed by tenant, or (b) reuse the cockpit thread
(the conversation is already persisted as agent messages via `sendCockpitMessage`). Recommend (b) for the
conversation transcript + a tiny persisted "step" marker for the gate; don't over-model.

### Anti-Patterns to Avoid
- **Editing the gated `cockpit-agent` skill body to add onboarding.** Publishes a candidate that can't
  activate without a pinned green eval run, and endangers the golden set. Keep onboarding extraction in a
  separate ungated skill.
- **A new `vaultDocuments`-parallel table or a 7th vault category.** Both are migrations that buy nothing;
  the free-string `kind` + `source:"agent"` already slot in.
- **Putting profile prose (or the extracted fields) in any audit/telemetry/DLQ payload.** SC#4 hard fail.
- **Gating in `middleware.ts` on profile existence.** It has no DB access; the eternal-spinner class of bug
  (documented in `layout.tsx:178-183`) is exactly what the client `<Authenticated>` gate avoids.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Store + embed the profile | A bespoke embed call | `startIngest` → `ingestDoc` | Gets governed preCall gate, hash-dedup, graph extract, spend recording, failure-recovery (`onIngestComplete`, `retryStuckIngests`) for free |
| Retrieve the profile | A new query surface | `searchVault` / `vaultGroundHydrated` | Tenant-scoped (`namespace=tenantId`), SMOKE seam, already wired into the cockpit tool |
| File/deck → text | An extractor | `vaultUpload` auto-schedules `vaultExtract`/`vaultTranscribe` | Phase 3.8 handles pdf/image/video + truncation honesty flag |
| Spoken brief → doc | A voice→text path | Phase 6 `persistBrief`/`storeBrief` (`briefRef`) | Already produces a groundable vault doc |
| Re-embed on edit | Manual rag delete+add | `deleteVaultDoc` (cascades rag chunks + graph) then re-`startIngest`, OR patch text + re-ingest | Cascade + orphan-GC already correct |
| Persona/profile prompt | Hardcoded string | Skills registry row (`getActiveSkill`) | §5 + gives versioning/rollback |
| Tenant isolation | Manual filters | `tenantMutation`/`tenantQuery` + `ownedDocsMeta` | §2 injects scope; cross-tenant reads drop out by construction |

**Key insight:** the profile is "just another vault doc." Every hard part (embedding, tenant scope,
retrieval, extraction rails, voice) is already a call away. The genuinely new work is small: an extraction
skill, a pure profile schema/serializer, three thin Convex adapters, and two UI pages.

## Common Pitfalls

### Pitfall 1: Gated-skill eval cycle (the top wiring risk)
**What goes wrong:** onboarding logic is added to the `cockpit-agent` body; a dev boot publishes a
candidate; it silently won't activate (EVAL_GATE) and/or the next `eval:golden` run trips the golden set.
**Why:** `cockpit-agent` ∈ `GATED_SKILLS` (`contracts/src/skill.ts:76-81`). `seedSkills` publishes gated
edits as `candidate`, and `activateSkillVersion` throws without passing evidence pinning that exact version.
**How to avoid:** keep persona/profile extraction in a **separate ungated skill**; drive the conversation
UI with the existing cockpit chat but do NOT teach it onboarding via its prompt.
**Warning signs:** you find yourself editing `packages/contracts/src/skills/cockpitAgent.ts`.

### Pitfall 2: Skill version-collision on seed (MEMORY: skill-version-collision-gotcha)
**What goes wrong:** a plan pins the extraction skill to a version that the live DB doesn't carry (optimizer
dry-runs / prior candidates occupy versions).
**Why:** `seedSkills` publishes at `maxVersion+1`; the active version carrying your body may differ from the
plan's assumption. Grounding shipped at `cockpit-agent@14`, not the planned `@13`.
**How to avoid:** verify which version carries your body in the live DB before any eval/activate; for a NEW
ungated skill the first boot seeds `v1/active` cleanly (the `rows.length===0` bootstrap path).

### Pitfall 3: Scheduler-invoked ingest throws UNAUTHENTICATED
**What goes wrong:** an extraction/async path calls the public `vaultIngestText` and hits `UNAUTHENTICATED`.
**Why:** public `tenant*` wrappers require identity; scheduler/action contexts carry none.
**How to avoid:** use the INTERNAL seam `vault.ingestExtractedText` (explicit `tenantId`) exactly as the
extraction lanes do (`vault.ts:449-470`).

### Pitfall 4: §4 leak through the review card / extraction return (SC#4)
**What goes wrong:** the extracted fields or intake prose land in an audit/telemetry/DLQ row.
**Why:** business profiles are name-dense; the extractor's output is the densest object in the flow.
**How to avoid:** the extraction return flows ONLY to the client card and the vault doc `text`. Any audit
event (`onboarding.completed`, `profile.embedded`) carries `{ vaultDocId, fieldCount, personaConfirmed }`
— refs/counts/booleans ONLY, mirroring `searchVault`'s `{queryHash,resultCount}`. Add a redaction scan test
(mirror `llmRedaction.test.ts` / `audit.test.ts`).

### Pitfall 5: Persona treated as auto-detected (SC#1)
**What goes wrong:** a high-confidence inference silently sets the persona.
**Why:** skipping the confirm step feels efficient.
**How to avoid:** the locked design has NO confidence threshold — the pure decision fn ALWAYS returns a
"present for confirm" state. Encode this in the pure `packages/*` module and unit-test that no path
auto-commits.

## Code Examples

### Refs-only audit for a name-dense op (the §4 template)
```typescript
// Source: packages/backend/convex/llm.ts:1336-1342 (searchVault tool)
await ctx.runMutation(internal.audit.log, {
  tenantId,
  correlationId: planId,
  eventType: "vault.searched",
  actor: "system",
  payload: { queryHash: await contentHash(query), resultCount: docIds.length }, // §4: refs + counts ONLY
});
```

### SMOKE:: deterministic offline retrieval (validation seam)
```typescript
// Source: packages/backend/convex/vaultGround.ts:43-55 — SMOKE:: bypasses the embedding network
// Test: ingest a business_profile doc, then:
const { docIds } = await vaultGroundHydrated(ctx, { tenantId, query: `SMOKE::${profileDocId}` });
// Cross-tenant seed drops out via ownedDocsMeta → proves SC#3 isolation with no network.
```

### New ungated skill registration
```typescript
// contracts/src/skill.ts:  export const BUSINESS_PROFILE_SKILL = "business-profile" as const;
//   (do NOT add to GATED_SKILLS)
// skills.ts seedSkills[] :  { name: BUSINESS_PROFILE_SKILL, body: businessProfileSkillBody },
// First boot → v1/active (bootstrap ungated path, skills.ts:259-267).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bespoke per-doc-type storage | One `vaultDocuments` table, free-string `kind`, one ingest workflow | Phase 5 (vault) | `business_profile` is zero-migration |
| Hardcoded prompts | Skills registry rows, versioned, EVAL_GATE on gated | Phase 8/10 | Extraction prompt must be a registry row (§5) |
| Deterministic FSM cockpit | Governed Executive Agent tool-loop (`runCockpitAgent`) | Phase 3.2.1 | Conversation reuses the agent chat; onboarding sits beside it |
| No grounding | `searchVault`/`vaultGroundHydrated` live at `cockpit-agent@14` | Phase 10 | Profile is retrievable the moment it's `ready` |

**Deprecated/outdated:** `emailIntent` FSM (gone). Assistant-token streaming is version-BLOCKED
(`@convex-dev/agent@0.6.4` peers `ai@^6`; repo pins `ai@7`) — do not attempt to stream onboarding replies.

## Open Questions

1. **Conversation engine: reuse the gated cockpit-agent thread, or a lighter dedicated onboarding chat?**
   - Known: locked decision says "driven by the existing governed cockpit agent (slot-filling)." The cockpit
     conversation is `sendCockpitMessage` → `runCockpitAgent` (gated `cockpit-agent` body, plan-row slots).
   - Unclear: whether onboarding needs the cockpit's *tools* (it doesn't — it captures a profile, it doesn't
     send email) or just its *chat surface + persistence*.
   - Recommendation: reuse the cockpit **chat UI + thread persistence** for the conversation, but perform
     persona/profile extraction via the **separate ungated skill** at the review-gate. Do NOT edit the gated
     `cockpit-agent` body. Planner should confirm this split satisfies the "slot-filling" intent.

2. **Partial-draft persistence for resumability.**
   - Known: a committed `business_profile` row = complete. The gate reads its existence.
   - Unclear: where a persona-confirmed-but-uncommitted draft lives.
   - Recommendation: reuse the cockpit thread for transcript + a minimal persisted step marker; avoid a new
     heavyweight `onboarding` table unless the planner finds it necessary.

3. **Gated vs ungated for the extraction skill.**
   - Known: `voice-brief`/`voice-session` are ungated because their output is a vault doc / free-form persona
     the gate "cannot meaningfully assert" (`skills.ts:247-250`).
   - Recommendation: **ungated** — the profile extractor's output is a vault doc + a UI card, not plan
     tool-state; it consumes the user's OWN (trusted-as-own, ADR-006) content. Revisit only if extraction is
     later wired to drive plan tool-state.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation` absent/true). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3 (`vitest@^3.2.7`) + `convex-test@0.0.54` |
| Config file | per-package (backend `vitest run`); pure `packages/*` use vitest too |
| Quick run command | `pnpm --filter @pikar/backend test` (or `pnpm --filter @pikar/<domain> test` for the pure module) |
| Full suite command | `pnpm test` (turbo run test across the monorepo) |

### Phase Requirements → Test Map
| SC / Req | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| SC#1 / ONBD-01 | Persona is ALWAYS surfaced for confirm — no path auto-commits | unit (pure) | `pnpm --filter @pikar/<domain> test -- businessProfile` | ❌ Wave 0 |
| SC#2 / ONBD-02 | Committed profile is embedded + retrievable via searchVault (SMOKE:: seam) | integration (convex-test) | `pnpm --filter @pikar/backend test -- onboarding` | ❌ Wave 0 |
| SC#3 | Tenant B's searchVault/`ownedDocsMeta` never returns tenant A's profile | integration (convex-test) | `pnpm --filter @pikar/backend test -- onboarding` | ❌ Wave 0 (assert in same file) |
| SC#4 | No onboarding audit/telemetry/DLQ payload carries profile prose — refs/hashes/counts only | scan (convex-test) | `pnpm --filter @pikar/backend test -- profileRedaction` | ❌ Wave 0 (mirror `llmRedaction.test.ts`) |
| ONBD-02 (extract) | Extraction returns the Lean-core structured object incl. persona enum (offline, mock model) | unit/integration | `pnpm --filter @pikar/backend test -- onboarding` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the quick run for the module touched (`pnpm --filter @pikar/<pkg> test`).
- **Per wave merge:** `pnpm --filter @pikar/backend test` + the pure `packages/*` module test.
- **Phase gate:** `pnpm test` green + `docs/playbooks` check green before `/gsd:verify-work`.

### The four SCs, mapped to concrete assertions
1. **Persona confirm-not-assume (SC#1):** pure decision fn returns a `{ persona, needsConfirm: true }`
   state for every inference; assert no branch yields an auto-committed persona.
2. **Embed + retrieve (SC#2):** convex-test — call the commit mutation, drive `ingestDoc` to `ready`
   (SMOKE offline seam carries no network), then `vaultGroundHydrated({tenantId, query:"SMOKE::<docId>"})`
   returns the profile doc.
3. **Tenant isolation (SC#3):** seed tenant A's profile, query as tenant B via `SMOKE::<A-docId>` →
   `ownedDocsMeta` drops it → empty result. Assert.
4. **§4 redaction boundary (SC#4):** run a full commit and scan every `audit`/`telemetry`/`deadLetters`
   row written during onboarding; assert payloads contain only refs/hashes/ids/counts/booleans — no profile
   field values, no intake prose. Mirror `llmRedaction.test.ts` + `auditImmutability.test.ts`.

### Wave 0 Gaps
- [ ] `packages/<domain>/src/businessProfile.test.ts` — pure schema + always-confirm decision (SC#1)
- [ ] `packages/backend/convex/onboarding.test.ts` — commit→ingest→retrieve + tenant isolation (SC#2/#3)
- [ ] `packages/backend/convex/profileRedaction.test.ts` — §4 audit/telemetry/DLQ scan (SC#4)
- [ ] Seed row: add `BUSINESS_PROFILE_SKILL` to `seedSkills[]` so tests boot with an active v1 body
- [ ] New skill body file `contracts/src/skills/businessProfile.ts` (extraction prompt, §5)

*(Framework install: none — vitest + convex-test already present.)*

## Sources

### Primary (HIGH confidence — read at source in this repo, 2026-07-24)
- `packages/backend/convex/voice.ts:299-324` (`persistBrief`) — the profile-doc template
- `packages/backend/convex/vault.ts` (`vaultIngestText`, `vaultUpload`, `ingestExtractedText`, `ownedDocsMeta`, `getDoc`, `markReady`, `deleteVaultDoc`)
- `packages/backend/convex/vaultIngest.ts` (`startIngest`, `ingestDoc`, `onIngestComplete`, `retryStuckIngests`)
- `packages/backend/convex/vaultGround.ts` (`vaultGroundHydrated`, `runVaultGround`, SMOKE:: seam)
- `packages/backend/convex/llm.ts` (`runCockpitAgent`, `buildCockpitTools`, `searchVault` tool, `draftCockpit` generateObject, `runAgentLoop`)
- `packages/backend/convex/skills.ts` (`seedSkills`, `loadSkill`, `activateSkillVersion` EVAL_GATE) + `packages/contracts/src/skill.ts` (`GATED_SKILLS`, `isGatedSkill`, `hasPassingEvidence`)
- `packages/backend/convex/schema.ts` (`vaultDocuments`, `skills`, `telemetry`)
- `packages/vault/src/categories.ts` (`categoryFor`, `VAULT_CATEGORIES`, `VaultSource`)
- `apps/web/middleware.ts` + `apps/web/app/(app)/layout.tsx` (auth gate structure)

### Secondary (MEDIUM — project memory / STATE)
- MEMORY: `skill-version-collision-gotcha`, `cockpit-agent-redesign`, `phase3.3-attachment-generation`
- STATE.md blockers: "Names-in-prose PII ceiling" (S1/S4 open) — directly SC#4-relevant

### Tertiary (LOW): none — no external-source claims made.

## Metadata

**Confidence breakdown:**
- Standard stack / reuse seams: HIGH — every signature read at source, in-tree, pinned.
- Architecture (profile-as-vault-doc, first-run gate, extraction skill): HIGH — direct clone of `persistBrief`/`draftCockpit`; gate structure verified against `layout.tsx`.
- Gated-skill risk: HIGH — `GATED_SKILLS` + `activateSkillVersion` EVAL_GATE read directly.
- Pitfalls: HIGH — each traced to a specific file/line or documented memory.

**Research date:** 2026-07-24
**Valid until:** ~2026-08-23 (stable in-tree seams; re-verify only if vault/skills/cockpit refactor lands).
