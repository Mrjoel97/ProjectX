# Phase 18: Document & Content Creation - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning

<domain>
## Phase Boundary

The agent creates **standalone documents and content artifacts** — stored as tenant-scoped vault
assets, distinct from an outbound email attachment. Requirement **ACTN-04**.

Creation itself has **no external side effect**. Only *delivery* of a created artifact crosses the
plan → Approve gate, and it does so through the **already-shipped** email attachment path — this
phase adds no second delivery mechanism and no second gate.

**Not in this phase:** contacts/CRM (Phase 19), media generation (Phase 20), user-authored skills
(Phase 21). See `<deferred>` for capabilities raised and consciously postponed.

</domain>

<decisions>
## Implementation Decisions

### Architecture shape — LOCKED (owner, 2026-07-31)

- **Phase 18 writes IN-LOOP.** It takes **no `ACTION_TYPES` member, no arm, and no `plans.kind`
  widening.** ROADMAP:702-704 requires only that *external delivery* cross the Approve gate —
  *"creation alone has no external side effect."* A `vaultDocuments` insert has none.
- **The template is `packages/backend/convex/research.ts:133-210` (`persistFindings`)** — generated
  markdown → `vaultDocuments` row → `startIngest` → refs-only audit. No plan, no gate, no action
  type. It is shipped and un-gated; copy its shape.
- ⚠ **`packages/core/src/actionType.ts:30-32` says Phases 18 and 19 should reuse the
  `externalAction` arm. That comment is WRONG and predates this design.** `externalAction` is
  retrier-driven and `dispatchGuard.test.ts:181` pins it to *"only the Calendar retrier action and
  its non-Node terminal."* Correct the comment when touching that file.
- **Consequence:** `actionType.ts`, `cockpit.ts`'s `_ARM_TABLE`, `plans.kind`, `plans.ts`
  `patchPlan`/`resetPlan` and the `PlanCard` kind chain are **NOT Phase 18 files.** If a planner
  finds itself editing them, the design has drifted — stop and re-read this section.

### Storage & format

- **A created document is a `text/markdown` vault row with `text` present.** The **PDF is a derived
  download**, not the stored artifact. Storing `application/pdf` instead would land the row at
  `pending_extraction` and round-trip it through `vaultExtract` to recover text it was rendered
  *from* — pure waste for content we authored.
- **`vaultDocuments.kind` is `v.string()` (`schema.ts:691`) → NO new table and NO migration.**
- **Short-form content gets no PDF.** A LinkedIn post, ad headline or email copy stays markdown /
  plain text — readable and copyable straight out of the vault. PDF is for long-form, where a page
  is the natural unit.
- **Both long- and short-form land as vault rows.** One storage story for everything the agent
  creates: findable later, tenant-scoped, auditable. Short-form is simply a smaller row with no
  derived PDF.

### Grounding, provenance & the feedback loop

This is the phase's sharpest decision. Created documents land in the **same `vaultDocuments` table
the agent retrieves from for grounding**, which would otherwise close an echo-chamber loop: the
agent's own prose becomes retrieval context for its next generation, degrading grounding toward
whatever the model already believed, with nothing in the audit trail showing it.

- **Created documents are EXCLUDED from vault retrieval by default.** They are visible and
  downloadable, but vault search skips them.
- **Created documents are EXCLUDED from the blueprint "unincorporated documents" drift signal by
  default.** That signal means *"you have new business facts not yet in your Blueprint"*; an
  agent-written memo is not a new fact about the business.
- **The data model carries a promotion flag** so a document *can* later become reference material —
  but **the control that flips it is deferred to its own phase** (see `<deferred>`). Phase 18's
  observable behaviour therefore equals "excluded by default"; the difference is that adding
  promotion later is a UI addition, **not a migration**.
  > *Resolution note:* the owner selected "user opt-in per document" for retrieval and "only if
  > promoted" for drift, but also "not this phase" for the promote control. Read literally that is
  > circular — with nothing able to promote, nothing is ever retrievable or counted. The above is
  > the coherent reading, presented to and not contested by the owner.
- **The vault UI must visually distinguish agent-created from user-uploaded documents.** A user has
  to tell at a glance what they gave the system from what it wrote.
- ⚠ **This implies a REAL provenance field.** There is **no `createdBy`/`origin`/`generatedBy`
  column** on `vaultDocuments` today. De-facto provenance is `(source, kind)`, both `v.string()`,
  and **five live writers already store values outside the nominal `VaultSource` union** (`"voice"`,
  `"evaluation"`, `"web_research"`, …) while all passing `categoryFor({source:"agent"})`. Inferring
  provenance from those strings is not reliable. Note `schema.ts` carries an explicit
  "frozen after this commit" note in that block — read it before adding the field.

### Skills (CLAUDE.md §5 — prompts are registry rows, never hardcoded)

- **A NEW `content-drafter` skill row handles short-form.** Short-form has genuinely different craft
  rules (hook, length, platform voice) than a proposal.
- **`document-drafter` is REUSED UNCHANGED for long-form. Phase 18 does not edit its body.**
- **A brand-new skill row skips the eval gate.** `seedSkills` (`skills.ts:340-350`) branches on
  `rows.length === 0` and inserts version 1 directly at `status: "active"`; the gate binds only
  *subsequent* versions of an existing skill. So `content-drafter` lands live at v1 with **no eval
  cycle and no paid run** — whereas editing `document-drafter` (which IS in `GATED_SKILLS`) would
  have minted a candidate needing a passing eval first. This is why the split is the cheap option,
  not the expensive one.
- 🚫 **BLOCKING — `packages/contracts/skills/cockpit-agent.md` must be edited to teach the new tool,
  and it is the contested file.** A tool the body does not teach is a tool that does not exist (the
  *withheld-tool pattern* — hit at RPLY-01, hit again at 16-09 for ~$0.46 of paid diagnosis).
  `cockpit-agent` is in `GATED_SKILLS` with exactly ONE candidate stream, and **Lane R holds it
  un-activated at v16**. See `.planning/PARALLELIZATION.md` § *Phases 18 + 19*: **no lane edits that
  body while another lane holds an un-activated candidate for it.** Phase 18 EXECUTION is gated on
  Phase 16 closing. Planning is not.

### Trigger & confirmation

- **Explicitly asked → create directly. Agent-suggested → confirm first.** Phase 3.3 required a
  confirm because generating meant attaching to a real email; with no external side effect, a
  confirm on an explicit instruction is friction with no safety value. The agent still never
  creates unprompted on its own judgment — that is the part of 3.3's rule that carries forward.
- **Multiple artifacts per turn are allowed** ("give me three post options"). Phase 3.3 already
  permits several generated documents per plan, so multiples are an established shape.
- **The conversation shows a card with preview + download**, mirroring the shipped Phase 3.3 plan
  card (filenames shown, real document openable before acting). Do not invent a second way to
  display an artifact.
- **Spend reuses `preCall`/`recordSpend` and the kill-switch. No new limit code, no artifact-count
  cap** — the Phase 3.3 precedent, stated there explicitly.

### Lifecycle & delivery

- **Revisable in conversation** ("make it shorter", "change the tone"), carrying forward 3.3's
  Regenerate-with-new-instructions. Unbounded by count, governed by the existing spend budget.
- **Revision REPLACES in place** — one row, latest content wins, patching the same `_id` (the
  Blueprint reconfirmation shape). **No version history.**
- **Delivery feeds the EXISTING attachment path.** "Send that one-pager to Sarah" attaches the
  artifact to a plan that crosses the **same** Approve gate email already uses. **SC#2 is satisfied
  by the shipped path** — no second delivery mechanism, no second gate to get right.
- **Rename/delete reuse the existing vault UI.** `listVaultDocs` already `.collect()`s every row
  with **no kind filter**, so created documents appear in the vault surface for free. Do not build a
  parallel management UI.

### Claude's Discretion

- **Artifact type inferred vs. explicit tool argument** — owner said "you decide". Inference from
  the request reads naturally and matches every other cockpit tool; an explicit argument is easier
  to assert in tests. Planner's call.
- Exact provenance field name and shape.
- How the "no PDF for short-form" branch is expressed (kind check, mime check, drafter-skill
  signal).
- Card layout and copy, within `docs/design/BRAND.md`.

</decisions>

<specifics>
## Specific Ideas

- **"Distinct from an outbound email attachment" is the whole point of the phase.** Phase 3.3 built
  document generation *in service of email*; a document existed only as a plan attachment and
  vanished with the plan. Phase 18 makes the artifact a first-class thing the user owns, which is
  why the vault row — not the plan row — is the primary home.
- The echo-chamber concern drove the retrieval decision: the user should be able to tell what they
  gave the system from what it wrote, and the system should not quietly learn from itself.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`packages/backend/convex/research.ts:133-210` (`persistFindings`)** — THE template. Generated
  markdown → `ctx.db.insert("vaultDocuments", {kind, category: categoryFor({source:"agent"}),
  mimeType:"text/markdown", text, status:"processing"})` → `startIngest` → refs-only
  `research.persisted` audit at :188-207. Shipped, un-gated, no plan, no action type.
- **`packages/backend/convex/llm.ts:890-951` (`renderAndStore`)** — the shipped producer chain:
  PII scan (fail-closed) → `internal.llm.draftDocument` → `markdownToPdf` → filename → cap check →
  store, returning a **ref, never bytes**. Phase 18 reuses the drafting and rendering halves.
- **`packages/core/src/documentGen.ts`** — `buildDocFilename`, `exceedsByteCap`,
  `PLAN_ATTACHMENT_CAP_BYTES` (8 MiB). ⚠ That 8 MiB is a *plan-attachment* cap; the vault's is
  `VAULT_FILE_CAP_BYTES` = 100 MB (`vault.ts:170-174`). **Decide, don't inherit.**
- **`packages/backend/convex/vaultIngest.ts:30-46` (`startIngest`)** — typed `MutationCtx`, the SOLE
  legal ingest start. **Call it; do not edit it** (editing trips `vault.md`). This is why the write
  must be a new `internalMutation` invoked via `ctx.runMutation` from the `"use node"` action,
  mirroring `recordAttachments`.
- **`packages/vault/src/categories.ts`** — `VaultSource` :21, `categoryFor` :30-44,
  `isSearchable`/`SEARCHABLE_MIME` :24, :47-49 (note `application/pdf` is NOT in it).
- **`packages/backend/convex/vault.ts:270+` (`listVaultDocs`)** — `.collect()`s every row with no
  kind filter, so created documents surface in the vault UI at zero cost.

### Established Patterns

- **Isolation assertions (SC#3)** — shapes to copy: `vault.test.ts:305-317, :411-437, :478-486,
  :487-494` (helpers at :39) and `vaultGround.test.ts:21-45` (`asTenant`/`seedDoc`), :147-157,
  :233-245, :304-337.
  ⚠ **`vault.test.ts` contains a literal NUL byte around offset 5982** — ripgrep/Grep treat it as
  binary and skip it *silently*. Use `grep -a`.
- **Refs-only audit (CLAUDE.md §4)** — `research.persisted` at `research.ts:188-207` is the model.
  ⚠ **Do NOT add an audit call in `cockpit.ts`**: it emits exactly two events (`plan.canceled` :719,
  `plan.rescheduled` :768) and `llmRedaction.test.ts:77-107` **pins that call-site count at exactly
  2**. Audit from the terminal instead (the `calendarComplete.ts:73` precedent).
- **Never-ingested vault document** — `blueprint.ts` shows the precedent for a vault row that
  deliberately skips ingest/embedding/graph extraction, if the retrieval exclusion is implemented
  that way.

### Integration Points

- `packages/backend/convex/schema.ts` `tool: v.union(` (**:462-522**, 26 literals) — one new tool
  literal. ⚠ `schema.ts:486-492` records the failure mode **in the file**: a step insert for an
  unlisted tool **throws inside an AI-SDK callback that swallows it** — no trace row in prod, every
  offline test green. Bitten twice already (`searchVault`, `evaluateBusiness`).
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` `VERB` map (**:1139-1177**) — one entry.
  `traceParity.test.ts:61-81` asserts **set equality both ways**. Its floor at :57-58 is `>= 22`
  against 26/26 — **do not bump it.**
- `packages/backend/convex/llm.ts` `buildCockpitTools` (**:726**), tool record **:1012-~1975** — one
  new tool key.
- `packages/contracts/skills/cockpit-agent.md` + its generated mirror
  `packages/contracts/src/skills/cockpitAgent.ts` (**one string literal on ONE line, :8** —
  `skillBodies.test.ts` asserts byte-identity).

### Environment cautions

- **`pnpm typecheck` LIES.** Turbo's `typecheck` task declares no `inputs`, so its cache restores a
  stale pass without running `tsc`. Always
  `pnpm exec turbo run typecheck --filter=@pikar/backend --force`. Real baseline: **52 errors, ALL
  in `convex/*.test.ts`, ZERO in production convex source.** **Gate on the DELTA**, never absolute
  clean.
- **`stableTenant` was DELETED** by Lane O's landed `22-01` (`d62c46c`). It was the tenant-isolation
  test idiom at the previous HEAD. Write tests with plain string subjects
  (`t.withIdentity({ subject: "tenant_a" })`). `ctx.tenantId` itself is unchanged; **nothing in
  ACTN-04 is owner-gated, so no new wrapper is needed.**
- **`importGuard.test.ts` needs no registration** for a new convex module — its
  `import.meta.glob("./**/*.ts", { eager: true })` auto-scans.
- **`docs/playbooks/cockpit.md` is contested three ways** (dirty from Lane R, claimed by the unrun
  `17.1-10`, forced for Phase 18). `check-playbooks.mjs:55-63` builds its changed-set from the
  **whole working tree plus untracked files**, not the session's own. Append inside a
  `### Phase 18` subsection; **never bump a foreign playbook's `Last verified`.**

### Sequencing interlocks (full detail in `.planning/PARALLELIZATION.md`)

1. **Execution is gated on Phase 16 closing** — the `cockpit-agent` candidate stream (above).
2. **`17.1-10`'s live gate is unrun and a Phase-18 artifact would corrupt what it measures.**
   `blueprint.ts:566-573` counts every `ready` tenant doc except `kind === "business_blueprint"` as
   drift. **Either sequence 18 after `17.1-10`, or carry the filter fix in 18** — there is **no
   shared constant**; the string is inline at `blueprint.ts:199` and `:571`. The
   exclude-from-drift decision above makes this Phase 18's problem either way.
3. **Lane O's blocking human checkpoints** (`22-01-PLAN.md:231`, `22-03-PLAN.md:122-123`) must not
   overlap a sibling lane editing deployed source.

</code_context>

<deferred>
## Deferred Ideas

- **Promote-to-reference control** — the flag lands in the data model this phase; the UI that flips
  it (making a created document groundable and drift-counting) is its own phase. Deliberate: it
  reopens the retrieval-quality question and deserves its own discussion.
- **Version history for revised documents** — replace-in-place ships now. History is a
  storage-and-UI subsystem that would dominate this phase.
- **Branded / letterhead PDF** — already deferred from Phase 3.3; still deferred.
- **Dedicated rename/delete controls on the chat card** — the existing vault UI covers it.
- **Fixed document templates** — deferred at Phase 3.3 in favour of one general-purpose drafter;
  unchanged here.

</deferred>

---

*Phase: 18-document-content-creation*
*Context gathered: 2026-07-31*
