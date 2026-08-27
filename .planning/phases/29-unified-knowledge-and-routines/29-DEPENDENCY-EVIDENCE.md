# Phase 29 — Dependency Evidence

**Audited:** 2026-08-27 · worktree `feat/29-unified-knowledge` · against `git rev-parse --short HEAD` at plan 29-01 start
**Method:** `graphify query` for navigation, then direct reads of the named spans. Every line number below
was re-read in this tree, not copied from a summary. Where a prior note disagreed with the tree, the tree wins
and the correction is called out.

**Verdict:** Phase 29 proceeds. The Phase 21 tenant-candidate seam is **landed and callable**. The Phase 28
connector rail is **not landed**; per the owner ruling recorded below that is recorded as an honest
`not_landed` source state, not a Phase-29 blocker, and no connector may be invented, stubbed or scaffolded
to satisfy plan text.

---

## 1. Phase 21 tenant-candidate seam — LANDED

The plan's dependency blocker is *"Phase 21 still writes only the ADR-003 global `skills` table"*.
**It does not.** `tenantSkills` is a real, tenant-scoped, indexed table beside the global `skills` table.

### 1.1 The table

`packages/backend/convex/schema.ts` — `tenantSkills: defineTable({...})` opens at **L282**.

Fields consumed by Phase 29 (verbatim from the tree):

| Field | Type | Why Phase 29 cares |
|---|---|---|
| `tenantId` | `v.string()` | Isolation. Written from the **authenticated wrapper context**, never from args. |
| `name` | `v.string()` | The registry row name. For packs this is `pack-<packId>` (see §1.4). |
| `version` | `v.number()` | The exact pin a customized run must name. |
| `body` | `v.string()` | Complete runtime body (base + composed adaptation). Never model- or client-supplied. |
| `authoredBody` | `v.string()` | The tenant's adaptation **alone** — what a reviewer reads, `""` on a system baseline. This is the customization payload Phase 29 renders into. |
| `status` | `"active" \| "candidate" \| "rolled_back" \| "archived"` | Activation state. |
| `author` | `"system" \| "user" \| "agent"` | Provenance. Phase 29 writes `"user"` rows only. |
| `authorUserId` | `v.optional(v.id("users"))` | Required when `author === "user"`; derived from authenticated identity. |
| `basedOnScope` / `basedOnName` / `basedOnVersion` | `"global" \| "tenant"` / string / number | **Upstream template lineage** — exactly what ROUT-01 needs for "which approved template did this come from". |
| `basedOnGlobalSkillId` / `basedOnTenantSkillId` | optional ids | The precise upstream row. |
| `rollbackEligible` | `v.boolean()` | Code-owned. A user candidate cannot mint itself one. |
| `evidence` | `v.optional(v.string())` | JSON eval evidence, read by `hasPassingTenantEvidence`. |
| `createdAt` | `v.number()` | Ordering. |

Also present and **not** Phase 29's business: `authorAgentId`, `sourceThreadId`, `sourceTurnId`,
`ownerApproval` (Phase 23 agent authorship, separately owner-gated).

**Seven indexes**, six tenant-first:

```
by_tenant                              [tenantId]
by_tenant_name_status                  [tenantId, name, status]              ← effective-load read
by_tenant_name_version                 [tenantId, name, version]             ← next-version allocation + exact-version read
by_tenant_createdAt                    [tenantId, createdAt]
by_tenant_name_rollbackEligible        [tenantId, name, rollbackEligible]
by_status_createdAt                    [status, createdAt]                   ← DELIBERATE cross-tenant OWNER review queue
by_tenant_source_turn                  [tenantId, sourceThreadId, sourceTurnId]
```

`by_status_createdAt` is the only non-tenant-first index and it is intentional: it backs
`tenantCandidatesForReview`, an `ownerQuery`. Phase 29 must not reach for it from a tenant surface.

### 1.2 The callable seams — `packages/backend/convex/skills.ts`

Every line number below was verified by `grep -n "^export const|^export function|^export async function"`
against this tree.

| Symbol | Line | Wrapper | What Phase 29 uses it for |
|---|---|---|---|
| `loadEffectiveSkill(ctx, tenantId, name)` | **L1133** | pure helper | **Runtime resolution.** Tenant overlay wins; the global ADR-003 `skills` row is the FALLBACK. This is the "tenant active customization → approved product template" order the research demands, already implemented. |
| `getEffectiveSkill` | **L1164** | `internalQuery` | Same resolution, callable from an action. |
| `publishUserCandidate` | **L1277** | `tenantMutation` | The user-authoring write. **Always** inserts `status: "candidate"`, `rollbackEligible: false`. There is no path from here to activation. |
| `publishAgentCandidate` | **L1388** | `internalMutation` | Phase 23. Phase 29 does not call it. |
| `inspectAgentCandidate` | **L1504** | `internalQuery` | Phase 23. Not consumed. |
| `myUserSkills` | **L1552** | `tenantQuery` | The tenant's own authoring history — the customization list surface. |
| `getTenantSkillVersion` | **L1631** | `internalQuery` | Exact-version read for a pinned run. |
| `recordTenantEvalEvidence` | **L1667** | `internalMutation` | Keys on the **exact `candidateId` row id**, because two tenants can hold the same `name` AND `version`. Phase 29 must pass the row id, never `(name, version)`. |
| `inspectTenantSkill` | **L1761** | `internalQuery` | Refs-only inspection. **Its return type has no `body` field** — do not expect to read a body through it. |
| `tenantCandidatesForReview` | **L1906** | `ownerQuery` | Owner review queue. |
| `activateTenantCandidate` | **L2005** | `ownerMutation` | Activation. **Owner-gated (`requireOwner`), not tenant-callable.** |
| `activateAgentCandidate` | **L2027** | `ownerMutation` | Phase 23. Not consumed. |
| `rollbackTenantSkill` | **L2049** | `ownerMutation` | Rollback target. Owner-gated. |

**Trust contract Phase 29 inherits:** activation and rollback are `ownerMutation`. A tenant can author
a candidate and can never activate it. Phase 29's ROUT-01 "activation remains eval-gated" requirement is
therefore satisfied by the *existing* seam — Phase 29 adds no second activation path (research §"Don't
Hand-Roll": *"A second skill activation path or candidate status flip"*).

### 1.3 The authoring bounds — `packages/contracts/src/skill.ts`

| Symbol | Line | Contract |
|---|---|---|
| `USER_AUTHORABLE_SKILLS` | **L290** | A **closed three-name allowlist**: `offer-architect`, `money-model-designer`, `lead-engine` (via `OFFER_ARCHITECT_SKILL` L113 / `MONEY_MODEL_DESIGNER_SKILL` L116 / `LEAD_ENGINE_SKILL` L119). |
| `USER_AUTHORABLE_SKILL_METADATA` | L303 | Per-skill display metadata. |
| `isUserAuthorableSkill` | L322 | The predicate. |
| `USER_SKILL_ADAPTATION_MAX_BYTES` | **L405** | `4000` — UTF-8 **bytes**, not characters. |
| `USER_SKILL_ADAPTATION_SECTION` | **L408** | `"## Tenant-authored business adaptation"` — the fixed marker. |
| `composeUserSkillBody(baseBody, authoredBody)` | **L429** | Composes **server-side**. Refuses empty-after-trim (`USER_SKILL_ADAPTATION_REQUIRED` L411) and over-cap (`USER_SKILL_ADAPTATION_TOO_LARGE` L414). |
| `hasPassingTenantEvidence` | **L540** | Requires `tenantTarget` to match **all** of `{candidateId, registryTenantId, name, version}`. **Fails closed** on absent/unparseable. |

**Consequence for Phase 29 ROUT-01:** the existing seam is a *free-body* adaptation appended under a fixed
marker. Phase 29's job (plan 29-05) is to put a **validated field schema in front of** that body and render
it deterministically — not to replace `composeUserSkillBody`, and not to widen
`USER_AUTHORABLE_SKILLS` unilaterally. Widening the allowlist to cover the six workflow packs is a
29-05 decision with its own eval consequences, and it is called out here so it is not discovered late.

### 1.4 The pack half — `packages/core/src/workflowPacks.ts` + `packages/backend/convex/skills.ts`

| Symbol | File / line | Contract |
|---|---|---|
| `WORKFLOW_PACK_IDS` | core L30 | Closed set of 6: `business-pulse`, `campaign-plan`, `customer-complaint`, `sales-call-prep`, `process-sop`, `brand-review`. |
| `WORKFLOW_PACK_SKILL_NAMES` | core L676 | Derived `pack-<id>` — the registry row name. Never hand-typed. |
| `resolveWorkflowPack` | core L577 | Uses `Object.hasOwn`, so `"__proto__"` is refused, not resolved. |
| `toolsForWorkflowPack` | core L590 | **Static** tool allow-list per pack. A pack with a static list is a LEAF agent. |
| `packPreflight` | core L645 | Resolves per-source `SourceState` **in code, before the model call**. Fail-closed: an unreported source is `"unavailable"`. |
| `SourceState` | core **L599** | Already exported as `"available" \| "partial" \| "unavailable"`. **Name collision hazard** — see §5. |
| `PACK_SOURCE_LABEL` | core L85 | Code-owned user-facing source names. |
| `MISSING_SOURCE_UNLOCK` | core L106 | The "what would unlock it" half of the honest-partial contract. |
| `PACK_SOURCE_PROBE_STATES` | core L615 | Which states each source can actually produce. Guards the eval corpus against unproducible fixtures. |
| `PackProvenance` / `hasValidPackProvenance` | core L740 / L789 | Upstream commit + `bodySha256` pin. |
| `PackBrowserEvidence` / `hasPassingPackBrowserEvidence` | core L721 / L759 | The second, independent browser gate. |
| `publishPackCandidate` | skills.ts L902 | `internalMutation`. |
| `deactivatePack` | skills.ts L1039 | `ownerMutation`. |
| `recordPackBrowserEvidence` | skills.ts L1062 | `internalMutation`. |

### 1.5 The version-pin rail — already end to end

`tenantSkillIds?: Record<string, Id<"tenantSkills">>` threads an **exact candidate row id** (validated as
`v.id("tenantSkills")`, never a bare string) through the whole runtime:

- `packages/backend/convex/dispatch.ts` **L234** (type) / **L257** (validator) / L684, L1246, L1386, L1410, L1461 (threaded at every handoff)
- `packages/backend/convex/llm.ts` **L1840** (signature) / L1953, L2007 (threaded)
- `packages/backend/convex/evaluations.ts` **L921** (signature) / L996 / **L1027** (validator) / L1031

`dispatch.test.ts` L2594–2671 already carries the "drop `tenantSkillIds` at one handoff → the fallback body
is used" mutation witness.

**Phase 29 therefore does not build a pin rail.** The genuinely new half is only the pack `templateId` +
customization field values + source preferences that travel *beside* the version pin.

### 1.6 ADR-003 status

`docs/decisions/003-skill-registry-for-prompts.md` is **Accepted and NOT superseded**. Its
*"Skills are global (no `tenantId`)"* line describes the `skills` table, which is still true.
`tenantSkills` is an **additive overlay** beside it, and `loadEffectiveSkill` (§1.2) is the resolution
order that makes the two coexist. Phase 29 consumes the overlay. **Phase 29 does not add `tenantId` to
the global `skills` table** — pitfall 6 in `29-RESEARCH.md`.

---

## 2. Phase 28 connector projections — NOT LANDED

### 2.1 What is actually in the tree

Landed:

- `scripts/check-phase28-readiness.mjs` + `docs/connectors/phase28-readiness.md` (28-17 readiness gate)
- 28-18 lane ownership entries in `docs/playbooks/watch.json` (`revenue-connectors.md`,
  `connector-hubspot.md`, `connector-quickbooks.md`, `connector-stripe.md`, `connector-paypal.md`,
  `revenue-crm.md`, `revenue-finance.md`)
- `packages/revenue` — **contracts only**: `src/contracts.ts`, `src/contracts.test.ts`, `src/index.ts`,
  `vitest.config.ts`. Verified by `find packages/revenue -type f -name "*.ts"`.

### 2.2 What is absent — measured, not assumed

| Claim | Command run | Result |
|---|---|---|
| No connector table in the schema | `grep -n "connections\|hubspot\|quickbooks\|connector" packages/backend/convex/schema.ts` | **1 hit**, and it is a prose comment at L2231 (*"connector-backed Cash surface…"*). Zero `defineTable`. |
| No credential-encryption primitive | `grep -rn "createCipheriv\|aes-256" packages/ --include=*.ts` | **zero matches** |
| No connector Convex modules | `ls packages/backend/convex/ \| grep -i "connector\|hubspot\|quickbooks\|stripe\|paypal\|revenue"` | **zero files** |
| No CRM/support projections | same | **zero** |
| No revenue skill bodies | `packages/revenue/src` listing | contracts only |

### 2.3 Owner ruling (2026-08-27) — binding

> **Do not hard-fail 29-01 on the Phase 28 half.** Record CRM/support projections as genuinely
> `not_landed` in this file and proceed. The search rail is built on Vault + Drive + Gmail, which ARE
> landed. Criterion 1 only ever promised *"available"* adapters, and 29-03 Task 2 already defines the
> `not_landed` state for exactly this case. Do not invent, stub, mock or scaffold a connector to satisfy
> the plan text.

**Applied.** `crm` and `support` are registered in the Phase 29 source enum with the permanent, honest
state `unavailable / not_landed`. That is *not* an empty successful result and *not* a stub adapter — it
is the difference the whole KNOW-01 honest-gap requirement exists to express.

### 2.4 What Phase 29 may reuse from `packages/revenue/src/contracts.ts`

Not by import (that would couple `@pikar/core` to `@pikar/revenue` for a naming convenience), but as the
**established repo pattern** Phase 29's pure contracts mirror:

- `SOURCE_AUTHORITIES` L38 — code-owned authority classes, *not* model-supplied.
- `SourceRef` L76 + `validateSourceRef` L84 — refs/ids/kinds only; a `CONTENT_SHAPED` regex
  (`/["'‘’“”\n\r\t]/`) rejects a ref that is actually content. Phase 29 copies this idea, not the file.
- `CAPS` L54 + `REF_CHAR_CAP` L68 — bounds owned by *this* repo, never a provider cursor.
- `Projection<T>` L119 + `validateProjection` L124 — the three-and-only-three read outcomes
  (`ready` / `partial` / `unavailable`), where `partial` carries what is missing and is **not** a soft
  `ready`. Phase 29's `KnowledgeSourceState` is the same shape in a different domain.

---

## 3. Landed source rails Phase 29 DOES consume

### 3.1 Vault — `packages/backend/convex/vaultGround.ts`

`vaultGroundHydrated` (**L172**, `internalAction`, explicit `tenantId` arg) returns:

```ts
{ docIds: string[]; titles: string[]; origins: string[]; chunks: string[]; spine: string | null }
```

Four **parallel arrays** plus a separate `spine`. Bounds, all already code-owned:
`PER_DOC_CHAR_CAP = 1500` (L29), `TOTAL_CHAR_CAP = 8000` (L30), `rag.search` limit 8 / threshold 0.2,
`GRAPH_HOP_CAP` from `@pikar/vault`. Tenant isolation is `namespace = tenantId` plus
`internal.vault.ownedDocsMeta`, which **silently drops foreign ids** (the isolation seam) — and the
`SMOKE::<docId,…>` sentinel is the offline test seam.

**Correction to a prior note:** `vaultGroundHydrated` has **five** production call sites, not three:

- `blueprint.ts` **L540**
- `evaluations.ts` **L295**
- `llm.ts` **L3873** (the `searchVault` cockpit tool)
- `voiceDoc.ts` **L75**
- `blueprint.ts` L180 passes it as an injected function (production passes it verbatim; tests inject)

`spine` is deliberately **not** entry 0 of the arrays, so it can never fabricate a result, a count or a
citation. `searchVaultSpine.test.ts` guards this. **Phase 29 must keep `spine` out of evidence.**

**Source-attribution format to reuse (do NOT invent a parallel one):**
the content-plane row is `vaultSources` (`schema.ts` **L1047**):
`tenantId`, `threadId`, `docIds: v.array(v.id("vaultDocuments"))`, `titles: v.array(v.string())`,
`count: v.number()`, optional `role`/`snippet`/`form`, `createdAt`; indexes `by_tenant`,
`by_thread [tenantId, threadId]`. Its own comments state the discipline verbatim:
*"doc titles = labels-to-UI (§4: never reach the audit payload)"*. Phase 29's search citations are the
same shape one plane over: **stable refs + parallel labels on the content plane, counts only in audit.**

`origins` (26-11) is **labelling only** — `"agent_promoted"` means the agent wrote it and the owner
promoted it, so a citation must not read as the owner's own word. **No caller may filter retrieval on it.**
Phase 29 citations must carry it through.

### 3.2 Drive — `packages/backend/convex/vaultDrive.ts`

`findInDrive` (**L540**, `tenantAction`) is the bounded read-only search: *"returns metadata, never bytes,
and performs no import, reservation, export, landing or ingest work."*

`DriveSearchResult` (**L417**):

```ts
| { ok: false; reason: "not_connected" | "reauth" | "refresh_failed" | "drive_error" }
| { ok: true; hits: DriveSearchHit[] }
```

That reason set is a **direct donor** for Phase 29's `KnowledgeSourceState` unavailable reasons.
Token/scope ordering is: token row → `DRIVE_READONLY_SCOPE` check → `freshAccessToken` → provider call.
`escapeDriveQueryLiteral` (**L423**) escapes into Drive's single-quoted query-language literal —
URL encoding does *not* protect that boundary because Drive decodes `q` before parsing it.

`importDriveFolder` (L623) and the landing/export path (L937–L1132) are **out of scope**: Phase 29 reads,
never imports.

### 3.3 Gmail — `packages/backend/convex/gmail.ts`

**Correction to a prior note:** there are **four** GET-only read verbs, not five:
`search` (**L354**), `listInbox` (**L513**), `fetchInboxBodies` (**L609**), `getReplyTarget` (**L679**).
`send` (L242) is the one write and is not consumed. `prepareGovernedMessage` (L182) is write-prep.

`freshAccessToken` (**L33**) is *the one* token-refresh root and **never throws** — a dead token is a
governed `{ ok: false, reason: "not_connected" | "refresh_failed" }`, not a retriable failure.

**BINDING CAVEAT, carried forward to 29-03:** the toolless firewall enforced by the mutation-checked
static source scans in `llmRedaction.test.ts` is **BODY-scoped, not CONTENT-scoped**. Sender display names
and subject lines are *deliberately* admitted into the tool-bearing loop today. That is the known boundary;
Phase 29 must not silently widen it, and must not assume it is narrower than it is.

`gmail.search` is a **correspondent/contact resolver**, not a knowledge search. 29-03 needs a new
read-only knowledge query — pitfall 5 in `29-RESEARCH.md`.

### 3.4 The toolless-LLM + budget-gate shape Phase 29 copies

Canonical: `packages/backend/convex/blueprint.ts` `deriveCandidates` (`internalAction`, opens **L271**),
in exactly the order Phase 29 needs:

1. `runId = crypto.randomUUID()` (**L285**)
2. fail-closed registry load — `ctx.runQuery(internal.skills.getActiveSkill, { name })` (**L287**)
3. `const gate = await ctx.runMutation(internal.guardrails.preCall, { tenantId }); if (!gate.ok) return { ok: false, reason: gate.reason }` (**L291**)
4. `scanText` redaction → SMOKE short-circuit
5. `generateObject({ model: resolveModel(DEFAULT_MODEL), schema, system: skill.body, prompt: safePrompt, abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS), maxRetries: 1 })` (**L302**)
6. `priceUsage(DEFAULT_MODEL, usage)` (**L310**)
7. `internal.guardrails.recordSpend` with `correlationId: \`blueprint:derive:${runId}\`` (**L312**)

> **Correction to the inherited note:** it gave `L261-321 / L286 / L310` for the open, the registry load
> and `recordSpend`. The tree says **L271 / L287 / L312**. `preCall` L291 and `generateObject` L302 were
> exact. Verified by `grep -n "deriveCandidates\|crypto.randomUUID\|getActiveSkill\|guardrails.preCall\|generateObject(\|priceUsage(\|guardrails.recordSpend" packages/backend/convex/blueprint.ts`.

Same shape at `vaultDigest.ts` **L335**, `vaultExtract.ts` **L344**, `intake.ts` **L173** (all three
`guardrails.preCall` sites confirmed by grep) — **four** existing instances. It returns the governed stop
as **data, not a throw**.

`priceUsage` and `DEFAULT_MODEL` come from the shared `@pikar/cost` package and
`internal.guardrails.recordSpend` is reachable from any module, so **Phase 29's toolless planner/synthesizer
does not need to live inside `llm.ts`** and does not need `llm.ts`'s private `recordModelSpend`.

### 3.5 The manual-pin rail that already exists

`savedPrompts` (`schema.ts` **L364–L374**) + `packages/backend/convex/savedPrompts.ts`
(`SAVED_PROMPT_MAX_BYTES = 4000`, `SAVED_PROMPT_LIST_LIMIT = 20`, `SAVED_PROMPT_TITLE_MAX = 80`,
`normalizePromptText`, `derivePromptTitle`, `save`, `list`, `remove`) + the PinnedPrompts UI at
`apps/web/app/(app)/dashboard/workspace/page.tsx` L189 with `runPinned` L383.

Run is *"an ordinary fresh cockpit turn through the existing governed send path"* — which is exactly
ROUT-02's *"never replays an old plan"* requirement, **already satisfied**.

Phase 29's addition is **lineage only**. See `29-01-SUMMARY.md` §Task 3 for the extend-vs-new-table
decision and its recorded reasoning.

### 3.6 Constraints Phase 29 must design around

- `telemetry.ts` `writeTerminal` (**L44**) is hard-bound to `requestId: v.id("requests")` and throws
  `telemetry: no request for ${requestId}` (**L59**). **Do not loosen it.** Search telemetry needs its own
  refs/counts-only event, not an overload of the terminal request row (research §Telemetry agrees).
- `contacts.ts` is the **only** person store. There is no second CRM.
- A pack with a static tool allow-list is a **LEAF** agent: `runAgentLoop` sets `grantDispatch` only when
  `toolNames === undefined`.
- **ADR numbering: 013 is TAKEN** (`docs/decisions/013-the-render-worker.md`). The highest existing is
  **026** (`026-veo-31-lite-succeeds-sora-2.md`). **The next free ADR number is 027.** Any plan text
  naming 013 for routine governance is wrong.

---

## 4. Recurrence — correctly ABSENT, and must stay so

`packages/backend/convex/schema.ts` **L359** carries the verbatim comment:

> There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp,
> execution-history table, canvas or DSL.

`savedPrompts.ts` repeats it in its own header, and two source scans enforce it:

- `packages/backend/convex/savedPrompts.test.ts` (~L361) — bans `ctx.scheduler`, `ctx.runMutation`,
  `ctx.runAction`, `cronJobs`, `cron`, `schedule`, `recurrence`, `nextRunAt`, `trigger`, `routines`,
  `db.query("plans")`, `db.query("agentSteps")`, `audit.log`, `deadLetters` from `savedPrompts.ts`.
- `apps/web/app/(app)/dashboard/workspace/pinnedPrompts.test.ts` (~L278) — bans `cron`, `schedule`,
  `recurrence`, `routine`, `trigger`, `nextRunAt`, `setInterval`, `setTimeout`, `api.savedPrompts.run`,
  `scheduler` from `page.tsx` and `ChatPane.tsx`, and pins the *only* three `api.savedPrompts.*` calls
  to `["list", "remove", "save"]`.

Neither scan reads `schema.ts`. Plan 29-01 Task 3 therefore adds the **schema-level** structural absence
test that was missing, so the L359 comment is enforced rather than merely asserted.

---

## 5. Explicit exclusions

Recorded because the plan demands they be named, not merely omitted:

| Excluded | Why |
|---|---|
| **Global-only `skills` rows as tenant data** | ADR-003 rows are global product code. Phase 29 consumes `tenantSkills` through `loadEffectiveSkill`; it never adds `tenantId` to `skills`. Pitfall 6. |
| **Generic MCP / connector marketplace / tenant-supplied adapter** | 29-CONTEXT `<deferred>`: *"Arbitrary connector installation or user-supplied MCP servers."* The source registry is a closed code-owned enum. |
| **Unlanded Phase 28 CRM/support sources** | §2. `not_landed`, never a stubbed adapter and never an empty successful result. |
| **Any recurrence storage** | §4. Deferred behind the 29-11 decision gate. |
| **`spine` as search evidence** | §3.1. It is not a result and must not alter counts, no-match behaviour or citations. |
| **Reusing `gmail.search` for knowledge questions** | §3.3. Different privacy/hydration needs. |
| **`llm.ts` as the home of the new toolless calls** | §3.4. `guardrails.recordSpend` and `@pikar/cost` are module-agnostic; `llm.ts` is already the repo's largest file. |
| **A second activation path or candidate status flip** | §1.2. `activateTenantCandidate` is the one `ownerMutation`. |
| **A second person/CRM store** | §3.6. `contacts.ts` is the only one. |
| **The name `SourceState` in Phase 29 pure contracts** | `packages/core/src/workflowPacks.ts` **L599** already exports it and `packages/core/src/index.ts` re-exports with `export *`. Phase 29 uses `KnowledgeSourceState` / `KnowledgeSourceStatus` to avoid a silent collision. |

---

## 6. Spot-checks performed for this audit

Every one of these was run in this worktree; the numbers are what came back.

| Check | Command | Result |
|---|---|---|
| `tenantSkills` table + `savedPrompts` + L359 comment | `grep -n "tenantSkills\|savedPrompts:\|deliberately NO" packages/backend/convex/schema.ts` | L282 / L364 / L359 — **all three confirmed** |
| Every `skills.ts` export line | `grep -n "^export const \|^export function \|^export async function " packages/backend/convex/skills.ts` | **all 13 Phase-21 line numbers in §1.2 confirmed exactly** |
| `contracts/src/skill.ts` symbols | same grep | L290 / L405 / L408 / L429 / L540 — **confirmed exactly** |
| Phase 28 connector absence | four commands in §2.2 | **confirmed absent** |
| `vaultGroundHydrated` callers | `grep -rn "vaultGroundHydrated" packages/backend/convex/*.ts` | **five** production sites — prior note said three, **corrected** |
| Gmail read verbs | `grep -n "^export const \|^export function \|^export async function " packages/backend/convex/gmail.ts` | **four** GET verbs — prior note said five, **corrected** |
| `tenantSkillIds` pin rail | `grep -n "tenantSkillIds" packages/backend/convex/*.ts` | dispatch L234/L257, llm L1840, evaluations L921/L1027 — **confirmed** |
| `telemetry.writeTerminal` binding | `grep -n "writeTerminal\|no request for" packages/backend/convex/telemetry.ts` | L44 / L59 — **confirmed** |
| ADR numbering | `ls docs/decisions/` | 013 taken, 026 highest, **027 is next free** |
| `blueprint.deriveCandidates` toolless shape | `grep -n "deriveCandidates\|crypto.randomUUID\|getActiveSkill\|guardrails.preCall\|generateObject(\|priceUsage(\|guardrails.recordSpend" packages/backend/convex/blueprint.ts` | L271/L285/L287/L291/L302/L310/L312 — **three inherited numbers corrected** |
| Other `preCall` sites | `grep -n "guardrails.preCall" packages/backend/convex/{vaultDigest,vaultExtract,intake}.ts` | L335 / L344 / L173 — **confirmed exactly** |
| `SourceState` collision | `grep -n "SourceState" packages/core/src/workflowPacks.ts` | **L599 — real collision, avoided** |

**Four corrections were made to the inherited notes**: the `vaultGroundHydrated` caller count (3 -> 5),
the Gmail read-verb count (5 -> 4), and three drifted `blueprint.ts` line numbers (L261->L271,
L286->L287, L310->L312 for `recordSpend`). None changes a design decision; all are recorded here rather
than silently absorbed.
