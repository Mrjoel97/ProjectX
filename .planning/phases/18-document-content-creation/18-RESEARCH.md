# Phase 18: Document & Content Creation - Research

**Researched:** 2026-08-01
**Domain:** In-repo governed artifact creation (Convex adapter + pure `packages/core` renderer + cockpit tool registration)
**Confidence:** HIGH (every claim below re-verified against HEAD; zero external/library research was needed — this phase adds **no dependency**)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture shape — LOCKED (owner, 2026-07-31)**

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

**Storage & format**

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

**Grounding, provenance & the feedback loop**

- **Created documents are EXCLUDED from vault retrieval by default.** They are visible and
  downloadable, but vault search skips them.
- **Created documents are EXCLUDED from the blueprint "unincorporated documents" drift signal by
  default.**
- **The data model carries a promotion flag** so a document *can* later become reference material —
  but **the control that flips it is deferred to its own phase**. Phase 18's observable behaviour
  therefore equals "excluded by default"; the difference is that adding promotion later is a UI
  addition, **not a migration**.
- **The vault UI must visually distinguish agent-created from user-uploaded documents.**
- ⚠ **This implies a REAL provenance field.** There is **no `createdBy`/`origin`/`generatedBy`
  column** on `vaultDocuments` today. De-facto provenance is `(source, kind)`, both `v.string()`.
  Note `schema.ts` carries an explicit "frozen after this commit" note in that block.

**Skills (CLAUDE.md §5)**

- **A NEW `content-drafter` skill row handles short-form.**
- **`document-drafter` is REUSED UNCHANGED for long-form. Phase 18 does not edit its body.**
- **A brand-new skill row skips the eval gate** (`seedSkills` `rows.length === 0` → v1 `active`).
- 🚫 **BLOCKING — `packages/contracts/skills/cockpit-agent.md` must be edited to teach the new tool,
  and it is the contested file.** No lane edits that body while another lane holds an un-activated
  candidate for it. **Phase 18 EXECUTION is gated on Phase 16 closing. Planning is not.**

**Trigger & confirmation**

- **Explicitly asked → create directly. Agent-suggested → confirm first.**
- **Multiple artifacts per turn are allowed.**
- **The conversation shows a card with preview + download.** Do not invent a second way to display
  an artifact.
- **Spend reuses `preCall`/`recordSpend` and the kill-switch. No new limit code, no artifact-count cap.**

**Lifecycle & delivery**

- **Revisable in conversation.** **Revision REPLACES in place** — one row, latest content wins,
  patching the same `_id`. **No version history.**
- **Delivery feeds the EXISTING attachment path.** SC#2 is satisfied by the shipped path.
- **Rename/delete reuse the existing vault UI.** Do not build a parallel management UI.

### Claude's Discretion

- **Artifact type inferred vs. explicit tool argument** — owner said "you decide".
- Exact provenance field name and shape.
- How the "no PDF for short-form" branch is expressed (kind check, mime check, drafter-skill signal).
- Card layout and copy, within `docs/design/BRAND.md`.

### Deferred Ideas (OUT OF SCOPE)

- **Promote-to-reference control** — the flag lands in the data model this phase; the UI that flips
  it is its own phase.
- **Version history for revised documents** — replace-in-place ships now.
- **Branded / letterhead PDF** — still deferred.
- **Dedicated rename/delete controls on the chat card** — the existing vault UI covers it.
- **Fixed document templates** — deferred at Phase 3.3; unchanged here.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ACTN-04 | The agent can create standalone documents/content artifacts (beyond email attachments) | §Architecture Pattern 1 (the `vault.ts insertCreatedDoc` internalMutation, copying `ingestFromAttachment`), Pattern 2 (the `createDocument` cockpit tool), Pattern 3 (`origin` provenance field), Pattern 4 (structural retrieval exclusion), Pattern 5 (format parameterization + `renderHtmlDocument`), Pattern 6 (the Output card off `vaultSources`), §Registration Checklist, §Validation Architecture |
</phase_requirements>

---

## Summary

**This phase adds zero dependencies, zero tables, zero indexes, zero routes and zero action types.
Every capability it needs already exists somewhere in the repo; the work is threading one parameter,
adding one optional schema field, adding one internal mutation, one tool, one pure renderer, one
skill row, and one card.** External research (Context7 / web) returned nothing relevant because the
"standard stack" for this phase is *this codebase's own shipped machinery* — pdf-lib rendering,
`convex-test`, vitest 3.2.7, the `@convex-dev/*` pinned components. Adding a markdown or HTML
library would violate CLAUDE.md §8 and duplicate `tokenizeMarkdown`, which already parses the
drafter's markdown into a typed block list.

The three findings that most change the plan versus CONTEXT.md:

1. **The "structured spec" SC#5 asks for ALREADY EXISTS.** `DocToken[]` / `InlineRun[]`
   (`packages/core/src/documentGen.ts:15-21`) is a typed block list produced by `tokenizeMarkdown`
   from the drafter's markdown, and `markdownToPdf` already renders *from tokens, never from the
   string*. SC#5 does not need a new spec type or a new drafter output schema — it needs a second
   renderer over the same tokens plus a test that pins the escaping boundary. `document-drafter`
   stays byte-unchanged, exactly as locked.
2. **Retrieval exclusion costs ZERO filter code.** Don't call `startIngest`. A row with no
   `ragEntryId` and no graph nodes cannot be returned by `vaultGround.ts`'s `rag.search` + hop-capped
   `expand`, and `searchVault` (llm.ts:1682) routes exclusively through that engine. This is the
   `blueprint.ts:357` precedent (`status: "ready"`, no ingest). Promotion later = patch the flag +
   call the already-exported `startIngest(ctx, …)` — a UI addition, not a migration.
3. **The PDF download needs NO new UI and NO new route.** `vaultDocuments.storageId` is already an
   optional field, `PreviewModal.tsx:98` computes `canDownload = Boolean(doc.storageId)`, and
   `vault.ts:318 vaultDownloadUrl` already signs it. So **"long-form gets a PDF, short-form doesn't"
   is expressed as the structural presence/absence of `storageId`** — the branch and its entire UI
   consequence for free, with `text` staying the markdown artifact of record as locked.

**Primary recommendation:** one `format` parameter threaded through `buildDocFilename` +
`renderAndStore`; one pure `renderHtmlDocument` in `packages/core/src/documentGen.ts` rendering
`DocToken[]` with a source-scanned escape boundary; one `origin: v.optional(v.union("agent","agent_promoted"))`
field on `vaultDocuments`; one `internalMutation` in `vault.ts`; one `createDocument` tool with a
closed `form: "short"|"long"` enum; one ungated `content-drafter` skill row; one Output card off two
new optional fields on `vaultSources`. Sequence **after `17.1-10`** and **after Phase 16 closes**.

---

## Standard Stack

### Core — everything already installed and pinned

| Library | Version | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| `vitest` | 3.2.7 | The only test runner in the repo (both `packages/core` and `packages/backend`) | Two configs already exist: `packages/core/vitest.config.ts` (node) and `packages/backend/vitest.config.mts` (edge-runtime) |
| `convex-test` | (workspace-pinned) | Backend integration tests with a real in-memory Convex | `t.withIdentity({ subject })` → `ctx.tenantId`; the isolation idiom for SC#3 |
| `pdf-lib` | (pinned) | The long-form PDF renderer, wrapped by `llm.ts markdownToPdf` (:3527) | Standard-14 fonts + `toWinAnsi` sanitization already solved (documentGen.ts:120-155) |
| `ai` | 7.0.20 | `generateObject` for `draftDocument`; `tool()` + `jsonSchema()` for the cockpit tool record | Every existing tool uses this exact shape |

### Supporting — in-repo modules this phase composes

| Module | Location | Purpose | When to Use |
|--------|----------|---------|-------------|
| `tokenizeMarkdown` / `inlineRuns` / `DocToken` | `packages/core/src/documentGen.ts:44-115` | markdown string → typed block list (**the structured spec of SC#5**) | Both renderers consume this; never re-parse markdown elsewhere |
| `buildDocFilename` / `exceedsByteCap` | `packages/core/src/documentGen.ts:161-191` | Deterministic filename + the 8 MiB plan-attachment cap | Parameterize by format (§Pattern 5) |
| `startIngest` | `packages/backend/convex/vaultIngest.ts:30-46` | The SOLE legal ingest start | **Do NOT call it this phase.** Deliberate omission = the retrieval exclusion. Do NOT edit the file (trips `vault.md`) |
| `categoryFor` / `isSearchable` | `packages/vault/src/categories.ts:30-49` | `source → category`; the searchable-MIME set | `categoryFor({ source: "agent" })` → `"workspace-docs"`, matching all four agent writers |
| `vaultDownloadUrl` | `packages/backend/convex/vault.ts:318` | `ctx.storage.getUrl(doc.storageId)` | The PDF download route — already exists, already wired into `PreviewModal` |
| `contentHash` | `packages/backend/convex/lib/hash.ts:5` | sha-256 hex | Required by the `vaultDocuments` schema |
| `scanText` (PII) | via llm.ts | Fail-closed redaction before any model call | The `renderAndStore:898-899` precedent, mandatory (§GRDL-01, CLAUDE.md §4) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `renderHtmlDocument` over `DocToken[]` | `marked` + `DOMPurify` / `sanitize-html` | **Rejected.** Two new dependencies to convert a string we ALREADY have as tokens; `marked` re-introduces exactly the "model-authored string becomes markup" path SC#5 forbids, and DOMPurify is DOM-dependent (this is a `"use node"` action / a pure package). The token list is the sanitizer. |
| `origin: v.optional(...)` field | Infer provenance from `(source, kind)` | **Rejected — verified unreliable.** 11 `db.insert("vaultDocuments")` sites; 4 write out-of-union `source` values (`web_research`, `voice`, `evaluation`); `vault.ts:126` casts a **public** `v.string()` arg `as VaultSource` unchecked, so *any* string can land in `source`; `kind` already has 8 live values and grows every phase. |
| New `createdDocs.ts` convex module | A new `internalMutation` inside `vault.ts` | **Chose `vault.ts`.** `ingestFromAttachment` (vault.ts:571-615) is the exact precedent (internal mutation inserting a vault row on another module's behalf). Zero new modules ⇒ **zero `watch.json` edits** ⇒ no `check-playbooks.mjs:125-134` "uncovered module" block. |
| New card table | Two optional fields on `vaultSources` | **Chose `vaultSources`.** PARALLELIZATION pins Phase 18 at "New tables / indexes: 0 / 0"; `vaultSources` already has `by_thread`, refs+labels, and a shipped dumb-card renderer to copy. |

**Installation:** none. `pnpm install` is not required for this phase's dependency graph.

---

## Architecture Patterns

### Recommended file map (every path already exists except the two skill files)

```
packages/core/src/
├── documentGen.ts            # + DocFormat table, ext param, renderHtmlDocument (PURE, §1)
└── documentGen.test.ts       # + the SC#5 escape tests (behavioural + structural)

packages/backend/convex/
├── schema.ts                 # + vaultDocuments.origin  |  + agentSteps.tool literal  |  + 2 vaultSources fields
├── llm.ts                    # renderAndStore(+format) | generateAttachment(+format arg) | createDocument tool
├── vault.ts                  # + insertCreatedDoc / patchCreatedDoc internalMutations
├── vaultSources.ts           # byThread gains a `role` arg
├── blueprint.ts              # :571 drift filter += origin  (+ swap :199/:571 to BLUEPRINT_KIND)
├── skills.ts                 # + content-drafter seed row
├── skills.test.ts            # + content-drafter drift row
└── createdDocs.test.ts       # NEW test file (tests need no watch.json entry)

packages/contracts/
├── skills/content-drafter.md            # NEW body
├── src/skills/contentDrafter.ts         # NEW one-line mirror (HAND-written, no generator exists)
├── src/skill.ts                         # + CONTENT_DRAFTER_SKILL const (NOT in GATED_SKILLS — see Pattern 7)
└── skills/cockpit-agent.md              # + one `##` section teaching createDocument  ← GATED, see Pitfall 1

apps/web/app/(app)/dashboard/
├── workspace/cards.tsx       # + VERB entry  |  + OutputCard component
└── vault/DocGrid.tsx         # + an "AGENT" chip beside StatusChip
```

---

### Pattern 1 — The write: a new `internalMutation` in `vault.ts`, copying `ingestFromAttachment`

**What:** the `"use node"` cockpit action cannot `ctx.db.insert`; it calls
`ctx.runMutation(internal.vault.insertCreatedDoc, {...})` — the `recordAttachments` /
`ingestFromAttachment` shape. **`startIngest` is deliberately NOT called** (Pattern 4).

**The 12-field insert is mandatory** — `size`, `contentHash`, `createdAt` are schema-REQUIRED and are
missing from CONTEXT.md's four-field quote. Copy this, not CONTEXT's summary:

```ts
// packages/backend/convex/vault.ts — mirrors ingestFromAttachment (:571-615): explicit tenantId,
// internal-only, bytes/refs in, one row out. NO startIngest (Pattern 4 — the retrieval exclusion).
export const insertCreatedDoc = internalMutation({
  args: {
    tenantId: v.string(),
    title: v.string(),
    form: v.union(v.literal("short"), v.literal("long")),
    markdown: v.string(),
    contentHash: v.string(),
    storageId: v.optional(v.id("_storage")), // the derived PDF — long-form ONLY (Pattern 7)
  },
  handler: async (ctx, { tenantId, title, form, markdown, contentHash, storageId }) => {
    return await ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: form === "long" ? "created_document" : "created_content", // free-string `kind` (onboarding.ts:486 precedent)
      category: categoryFor({ source: "agent" }),                     // → "workspace-docs", like every generated doc
      source: "agent",
      mimeType: "text/markdown",                                      // LOCKED: markdown is the artifact of record
      size: new TextEncoder().encode(markdown).length,
      contentHash,
      text: markdown,
      storageId,                                                      // absent ⇒ no Download button, for free
      origin: "agent",                                                // Pattern 3 — the provenance + promotion field
      status: "ready",                                                // blueprint.ts:357 precedent: ready WITHOUT ingest
      createdAt: Date.now(),
    });
  },
});
```

⚠ **`kind` values:** use `"created_document"` / `"created_content"`. Do **not** use `"document"` —
`smoke.ts:819 seedVoiceDocSession` already writes it.

**Revision (replace-in-place, locked):** a sibling `patchCreatedDoc` that re-reads the row, asserts
`doc.tenantId === tenantId && doc.origin === "agent"`, then `ctx.db.patch(id, { title, text, size,
contentHash, storageId })` — the `blueprint.ts:346-356 confirmBlueprint` patch branch verbatim.

**Audit (CLAUDE.md §4):** one refs-only `internal.audit.log` from the **tool**, modelled on
`research.ts:188-211` (`{ topicHash, form, vaultDocId: String(id), hasPdf: boolean }`) —
hashes/ids/enums/booleans only, never the topic or the prose.
⚠ **Do NOT add an audit call in `cockpit.ts`** — `llmRedaction.test.ts:77-107` pins that file's
audit call-site count at exactly 2.

---

### Pattern 2 — The tool: one key in `buildCockpitTools`, an EXPLICIT closed enum

**Claude's-discretion resolved: use an EXPLICIT tool argument, not inference.** Three reasons:
(i) it is assertable in a convex-test (inference is only assertable against a live model);
(ii) a *closed* JSON-Schema enum is the repo's established way to let the model steer without
letting it inject prose (`setMode` llm.ts:1157, `evaluateBusiness`'s framework enum); (iii) it
deterministically selects both the skill row and the PDF branch, which keeps the branch in code.

Exact shape contract, read off `generateAttachment` (llm.ts:1275-1298):

```ts
    createDocument: tool({
      // SPLIT literal — skills.test.ts scans convex/ for inline strings > 200 chars (§5).
      description:
        "Create a standalone document or piece of content and save it to the user's vault. " +
        "Use `long` for proposals/one-pagers/reports and `short` for posts, ad copy or headlines. " +
        "It saves only — it never sends anything.",
      inputSchema: jsonSchema<{ topic: string; form: "short" | "long" }>({
        type: "object",
        properties: {
          topic: { type: "string", description: "What to write, in plain language." },
          form: { type: "string", enum: ["short", "long"] }, // CLOSED — the setMode precedent
        },
        required: ["topic", "form"],
        additionalProperties: false,
      }),
      execute: async ({ topic, form }): Promise<string> => {
        // …scan → draft → (long: render+store PDF) → runMutation(insertCreatedDoc) → runMutation(audit.log)
        //   → runMutation(vaultSources.insert, { role: "created", … })
        return `Created "${title}" — saved to your vault${pdf ? " with a PDF download" : ""}.`;
      },
    }),
```

Invariants this shape carries (all verified at HEAD):
- `execute` **always** returns `Promise<string>` — a plain sentence the model reads back. Never a
  URL, never bytes, never a raw id.
- A rejection is a **returned string**, never a throw out of the governed loop.
- **The tool records NO step row.** Step recording is central in `runAgentLoop`'s SDK callbacks
  (llm.ts:2208-2222 / :2223-2235). A new tool needs only the schema literal + the VERB entry.
- **Spend:** nothing to add. The loop's `preCall`/`recordSpend` already govern the turn (the
  `renderAndStore` ponytail comment at llm.ts:887-892 says so explicitly).

---

### Pattern 3 — Provenance: ONE optional field carrying both provenance and the deferred promotion bit

```ts
  // packages/backend/convex/schema.ts, inside vaultDocuments — Phase-18 (ACTN-04).
  // ABSENT ⇒ user-supplied (every row that exists today; ZERO backfill). "agent" ⇒ agent-authored,
  // excluded from retrieval + blueprint drift. "agent_promoted" ⇒ the user promoted it to reference
  // material. BOTH literals are declared NOW so the deferred promote control is a patch + a button,
  // never a schema change. One optional line, by the same rule as `retrievedAt` above (:707-716).
  // Why not (source, kind): `source` is v.string() and vault.ts:126 casts a PUBLIC arg to it
  // unchecked, four writers already store out-of-union values, and `kind` grows every phase.
  origin: v.optional(v.union(v.literal("agent"), v.literal("agent_promoted"))),
```

| Consumer | Predicate |
|---|---|
| Vault UI badge (`DocGrid.tsx`) | `doc.origin !== undefined` → render an "AGENT" chip beside `StatusChip` |
| Blueprint drift (`blueprint.ts:571`) | `doc.origin !== "agent"` (a **promoted** doc counts — exactly the locked "only if promoted") |
| Retrieval | *no predicate* — structural (Pattern 4) |
| Deferred promote control | `ctx.db.patch(id, { origin: "agent_promoted" })` + `startIngest(ctx, …)` |

**Migration: NONE.** Optional field, no backfill, no index.
⚠ `schema.ts` is watched by **no** playbook — the Stop hook will not prompt you. Track it manually.

---

### Pattern 4 — Retrieval exclusion is STRUCTURAL: don't ingest

**Do not write a retrieval filter.** The single grounding engine is `vaultGround.ts runVaultGround`
(:33-100): `rag.search({ namespace: tenantId, … })` joined back to docs via
`entry.metadata.vaultDocId`, then a hop-capped graph `expand`. A row with **no rag entry and no
graph nodes** is unreachable by both halves. `searchVault` (llm.ts:1682-1760) is the only cockpit
caller and routes exclusively through `internal.vaultGround.vaultGroundHydrated`.

The precedent is in-repo and exact: `blueprint.ts:357 confirmBlueprint` inserts at
`status: "ready"` and never calls `startIngest`.

**Consequences to state in the plan (all desired except the last):**
- ✅ visible in the browse grid — `listVaultDocs` (vault.ts:270-279) `.collect()`s the tenant
  partition with **no kind/status/origin filter**, so created docs appear for free under
  `category: "workspace-docs"`.
- ✅ downloadable — `PreviewModal` reads `doc.text` and `doc.storageId`.
- ✅ not groundable, not graph-extracted, no embedding spend.
- ⚠️ **also invisible to the vault UI's search box** (`vault.vaultSearch`, the same rag primitive,
  DocGrid.tsx:55). This is an honest cost of the structural approach. **Recommendation:** accept for
  beta with a `ponytail:` comment naming the upgrade path (a title-substring fallback in
  `DocGrid`'s filter, ~3 lines). Raise it with the owner rather than silently shipping it.

---

### Pattern 5 — Format parameterization: the concrete minimal diff (SC#4)

**Step A — `packages/core/src/documentGen.ts`: one table, one optional param.**

```ts
/** The output formats renderAndStore can emit. `pdf` is the Phase-3.3 default — callers that omit
 *  `format` are byte-identical to today. */
export type DocFormat = "pdf" | "html";

const FORMAT: Record<DocFormat, { ext: string; mimeType: string }> = {
  pdf: { ext: "pdf", mimeType: "application/pdf" },
  html: { ext: "html", mimeType: "text/html" },
};

/** ext + MIME for a format — the ONE place either literal is written. */
export const formatSpec = (f: DocFormat): { ext: string; mimeType: string } => FORMAT[f];
```

then, inside the existing `buildDocFilename` (:161-180) — signature gains a **4th optional** param,
so both shipped call sites are untouched:

```ts
export function buildDocFilename(
  topic: string,
  date: string,
  existing: readonly string[] = [],
  format: DocFormat = "pdf",            // NEW, defaulted
): string {
  const { ext } = FORMAT[format];
  …
  let name = `${base}.${ext}`;          // was :173  `${base}.pdf`
  …
    name = `${base}-${n}.${ext}`;       // was :176  `${base}-${n}.pdf`  ⚠ NOT :177 (that is `n++`)
```
Also update the docstring at `:159` — it currently asserts *"Always ends in `.pdf`."*

**Step B — `packages/backend/convex/llm.ts`: four lines inside `renderAndStore`.**
Anchor on the symbol `const renderAndStore = async (` (**:893**, body ends **:954**) — CONTEXT's
`890-951` lands on the doc comment.

| Site | Today | After |
|---|---|---|
| `:893-897` signature | `(topic, existing, replaceIndex)` | `+ format: DocFormat = "pdf"` |
| `:925` | `bytes = await markdownToPdf(draft.title, draft.markdown);` | `bytes = format === "pdf" ? await markdownToPdf(draft.title, draft.markdown) : new TextEncoder().encode(renderHtmlDocument(draft.title, draft.markdown));` |
| `:934-938` | `buildDocFilename(topic, today, others.map(a => a.filename))` | `…, format)` |
| `:947-949` + `:950-953` | `"application/pdf"` ×2 | `formatSpec(format).mimeType` ×2 (hoist to a local `const { mimeType } = formatSpec(format)`) |

**Untouched by construction:** `generateAttachment` (:1275-1298) and `regenerateAttachment`
(:1300-1329) pass three args; the default keeps Phase 3.3 byte-identical. The PII scan, the
`render=fail::` SMOKE seam, `setError`'s block-on-render-fail, the 8 MiB `exceedsByteCap` check and
the ref-only return are all **shared** by both formats — which is precisely what SC#4 asks for.

**Step C — reach the second format.** Add `format: { type: "string", enum: ["pdf","html"] }` as an
**optional** property on `generateAttachment`'s `inputSchema` and pass it through. No new tool, no
new step literal, no new VERB entry, no new schema union member.
**`gmail.ts` needs zero changes** — `buildMime` emits `Content-Type: ${a.mimeType}` generically
(gmail.ts:131), so an HTML part rides the existing MIME builder.

**Two ceilings, don't confuse them:** `PLAN_ATTACHMENT_CAP_BYTES` = **8 MiB**
(`packages/core/src/documentGen.ts:183`, total across a plan's attachments, what `renderAndStore`
enforces) vs `VAULT_FILE_CAP_BYTES` = **100 MiB** (`packages/vault/src/constants.ts:2`, enforced at
`vault.ts:170-174`, mirrored client-side in `Dropzone.tsx`). CONTEXT's "`vault.ts:170-174` defines"
is wrong — that is the *enforcement*, the constant lives in `packages/vault`.

---

### Pattern 6 — The spec → markup boundary (SC#5)

**The structured spec type already exists and needs no change:**

```ts
// packages/core/src/documentGen.ts:15-21 — SHIPPED
export type DocToken =
  | { kind: "h1" | "h2" | "h3" | "bullet" | "para"; text: string }
  | { kind: "ordered"; text: string; num: number }
  | { kind: "table"; header: string[]; rows: string[][] };
export type InlineRun = { text: string; bold: boolean };
```

`draftDocument` (llm.ts:3029-3088) returns `{ title, markdown }` via `generateObject` — a
**model-authored string**. `tokenizeMarkdown` (:44-115) turns it into `DocToken[]`; `inlineRuns`
(:96-115) resolves `**bold**` and *strips every other inline marker*. `markdownToPdf` already draws
from tokens. **The boundary is: string → `tokenizeMarkdown` → `DocToken[]` → renderer.** The new
HTML renderer sits on the same boundary; `document-drafter` stays byte-unchanged, as locked.

**The renderer lives in `packages/core/src/documentGen.ts`** (pure, no Convex/pdf-lib import —
CLAUDE.md §1; already watched by `cockpit.md`):

```ts
/** HTML-escape. There is NO escaper anywhere in this repo (verified) and no dependency is
 *  warranted for five replacements. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const HTML_STYLE = `…code-owned, no interpolation…`;

/**
 * A self-contained HTML page rendered from the drafter's markdown. THE SC#5 BOUNDARY: this
 * function is the ONLY producer of stored HTML bytes, it renders from `tokenizeMarkdown`'s
 * DocToken[] (never from the raw string), and EVERY value that came from the model passes through
 * `esc()`. CONVENTION (asserted by documentGen.test.ts): inside this function, a template
 * interpolation is either an `esc(...)` call or a local whose name ends in `Html` (already-rendered,
 * already-escaped markup). A future edit that interpolates a raw model string turns that test RED.
 */
export function renderHtmlDocument(title: string, markdown: string): string {
  const tokens = tokenizeMarkdown(markdown);
  const runsHtml = (t: string) =>
    inlineRuns(t).map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join("");
  const bodyHtml = tokens.map(/* switch on token.kind → fixed tags + runsHtml/esc */).join("\n");
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
         `<title>${esc(title)}</title><style>${HTML_STYLE}</style></head>` +
         `<body><h1>${esc(title)}</h1>\n${bodyHtml}\n</body></html>\n`;
}
```

**Test file: `packages/core/src/documentGen.test.ts`** (exists; vitest, `describe`/`it`, 130 lines).
Two assertions — the behavioural one proves it, the structural one *keeps* it proved:

```ts
// (a) BEHAVIOURAL — hostile model prose renders as TEXT in every token slot.
it("renders hostile model prose as text, never as markup", () => {
  const X = `<script>alert(1)</script><img src=x onerror="alert(1)">`;
  const md = `# ${X}\n\n${X}\n\n- ${X}\n\n1. ${X}\n\n| ${X} |\n|---|\n| ${X} |`;
  const html = renderHtmlDocument(X, md);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/onerror/i);
  expect(html).not.toMatch(/<img/i);
  // Non-vacuity floor (house rule): prove the hostile string REACHED every slot, escaped —
  // title + h1 + para + bullet + ordered + table-header + table-cell.
  expect((html.match(/&lt;script&gt;/g) ?? []).length).toBeGreaterThanOrEqual(7);
});

// (b) STRUCTURAL — "enforced by a TEST, not by prompt instruction". A future edit that
// interpolates a raw model string into markup fails here even if it happens to be harmless today.
it("no model-authored string reaches markup: every interpolation in renderHtmlDocument is escaped", () => {
  const src = readFileSync(new URL("./documentGen.ts", import.meta.url), "utf8");
  const start = src.indexOf("export function renderHtmlDocument(");
  expect(start).toBeGreaterThan(-1);                       // anchor floor
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const interps = [...body.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]!.trim());
  expect(interps.length).toBeGreaterThanOrEqual(4);        // non-vacuity floor
  const raw = interps.filter((x) => !/^esc\(/.test(x) && !/Html$/.test(x) && !/^HTML_[A-Z]+$/.test(x));
  expect(raw, `raw interpolations in renderHtmlDocument (escape them or name them *Html): ${raw.join(", ")}`)
    .toEqual([]);
});
```

⚠ `import { readFileSync } from "node:fs"` is fine in `packages/core` (its vitest config is **node**).
In `packages/backend` it is **not** — that suite runs `edge-runtime`; a backend source-scan test
needs the `// @vitest-environment node` pragma (`traceParity.test.ts:1`, `cockpitTools.test.ts:1`).

Optional third guard (belt-and-braces, `packages/backend/convex/cockpitTools.test.ts`, node pragma):
assert `renderAndStore`'s html branch reads `renderHtmlDocument(draft.title, draft.markdown)` and
that the file contains no `encode(draft.markdown)` — pinning that the tool cannot bypass the renderer.

---

### Pattern 7 — Short-form vs long-form: three agreeing structural signals

| Signal | short | long |
|---|---|---|
| Tool arg | `form: "short"` | `form: "long"` |
| Skill row | `CONTENT_DRAFTER_SKILL` (**new**, v1) | `DOCUMENT_DRAFTER_SKILL` (**unchanged**, locked) |
| `vaultDocuments.kind` | `"created_content"` | `"created_document"` |
| **`storageId`** | **absent** | **present** (the derived PDF) |

**"No PDF for short-form" is expressed as the structural absence of `storageId`** — not a flag, not
a mime check. This is the ponytail answer because the entire UI consequence is already built:
`PreviewModal.tsx:98 canDownload = Boolean(doc.storageId)` ⇒ short-form renders no Download button,
long-form's button hits the shipped `vault.vaultDownloadUrl` (`vault.ts:318`). **Zero new UI, zero
new route, zero new query.** `mimeType` stays `text/markdown` for both, as locked, so the row is
previewable and the text is the artifact of record.

Long-form flow: draft → `markdownToPdf(draft.title, draft.markdown)` → `ctx.storage.store(new
Blob([bytes], { type: "application/pdf" }))` → pass `storageId` to `insertCreatedDoc`. (Reuse
`renderAndStore` only if it is refactored out of its closure — see Pitfall 6; the two-line direct
call is cheaper.)

**The `content-drafter` skill — the 5-file mirror** (PARALLELIZATION singleton rule #2):

1. `packages/contracts/skills/content-drafter.md` — the body (hook, length, platform voice).
2. `packages/contracts/src/skills/contentDrafter.ts` — the derived one-line escaped literal.
   **There is NO generator script** (verified: none in `scripts/`, none in any `package.json`).
   Hand-write it.
3. `packages/contracts/src/skill.ts` — `export const CONTENT_DRAFTER_SKILL = "content-drafter";`
4. `packages/backend/convex/skills.ts` — append `{ name: CONTENT_DRAFTER_SKILL, body: contentDrafterSkillBody }`
   to the `seeds` array (~:320). `seedSkills` `rows.length === 0` (skills.ts:335-343) inserts
   **version 1 at `status: "active"`** → live with no eval cycle and **no paid run**.
5. `packages/backend/convex/skills.test.ts` — add `["content-drafter.md", contentDrafterSkillBody]`
   to the `test.each` drift table (~:731-742). ⚠ **This is the backend package**, not
   `packages/contracts/src/skills/skillBodies.test.ts` (whose 13-entry table contains neither
   `cockpit-agent` nor `document-drafter` — CONTEXT.md misattributes this guard).

**Do NOT add `CONTENT_DRAFTER_SKILL` to `GATED_SKILLS`.** `run-eval-golden.mjs`'s `SKILL_NAMES` is
**derived** from `GATED_SKILLS` (:70-74), so gating makes it pinnable — but there is **no golden
fixture that reaches `createDocument`**, so the first body edit would mint a candidate that no eval
run can certify. That is the exact deadlock recorded for `business-blueprint` in `skill.ts:155-159`.
Copy that comment's rationale into the new const. Revisit when a fixture exists.

---

### Pattern 8 — The Output card (SC#6): reuse `vaultSources`, zero new tables

`SourceCard` (`cards.tsx:1251-1285`) is the shipped template: a self-querying dumb renderer over a
per-thread content-plane row, returning `null` when the turn produced nothing.

**Two optional fields on `vaultSources` (schema.ts:345-352):**

```ts
    // Phase-18 (ACTN-04): this table now carries TWO card kinds. ABSENT ⇒ a grounding SOURCE row
    // (every row that exists today, zero backfill); "created" ⇒ the Output card for artifacts the
    // agent authored this turn. Same refs+labels discipline: titles/snippet are labels-to-UI and
    // NEVER reach an audit payload (§4 — this module writes no log-plane row).
    role: v.optional(v.literal("created")),
    snippet: v.optional(v.string()), // first ~240 chars of the artifact — the card's rendered preview
```

`vaultSources.byThread` gains `role: v.optional(v.literal("created"))` and filters on it
(`.order("desc").take(20)` then `.find(r => r.role === role)`, with a `ponytail:` comment naming the
cap). Two `useQuery` call sites in `cards.tsx`: the existing `SourceCard` passes nothing, the new
`OutputCard` passes `{ role: "created" }`.

**BRAND conformance (`docs/design/BRAND.md:101-102`):** titled card, an UPPERCASE type badge pill
(`DOCUMENT` / `POST`), a subline, and the rendered artifact (the snippet), on the `--card` sheet
with tracked-caps labels (BRAND §3/§4). **Never amber** — `--held` belongs to the approval gate
alone (§2). Reuse `briefingSheet` / `capsTeal` / `traceText` from `cards.tsx`. Download links to
`/dashboard/vault` (the `SourceCard:1274-1280` context-sanctioned click-through; inline
`PreviewModal` is the same deferred upgrade already recorded there).

**Vault-grid badge:** an "AGENT" chip beside `StatusChip` in `DocGrid.tsx:66-80`, gated on
`doc.origin !== undefined`. Label text carries the meaning, never colour alone (BRAND §6).

---

### Pattern 9 — Blueprint drift exclusion, and the playbook cost of it

Exact site — `packages/backend/convex/blueprint.ts:571` inside `unincorporatedFor` (:553-572):

```ts
  const docIds = ready
    .filter((doc) => doc.kind !== BLUEPRINT_KIND && doc.origin !== "agent" && !sourceSet.has(doc._id))
    .map((doc) => doc._id);
```

Three corrections to CONTEXT.md, verified at HEAD:
- The predicate has **two** exclusions today, not one — `kind !== "business_blueprint"` **and**
  `!sourceSet.has(doc._id)` (docs already cited as blueprint sources).
- **A shared constant DOES exist**: `const BLUEPRINT_KIND = "business_blueprint";` at
  `blueprint.ts:81`, already used at :346 and :360. The file is *inconsistent*, not constant-less.
  The lazy fix is swapping the two inline literals (**:199** and **:571**) to `BLUEPRINT_KIND` in
  the same edit — do **not** introduce a new constant.
- The read is `.take(DRIFT_SCAN_CAP)` with `DRIFT_SCAN_CAP = 100` (:42), so the count **saturates at
  100**. A drift assertion in a Phase-18 test is only meaningful below 100 `ready` docs.

`origin !== "agent"` (not `=== undefined`) is deliberate: a **promoted** doc counts as drift, which
is exactly the locked "only if promoted".

⚠ **Playbook cost:** `blueprint.ts` is watched by **`onboarding.md`** (watch.json), which belongs to
Lane 17.1. Editing it forces an `onboarding.md` update, and STATE.md's shared-tree rule forbids
bumping a foreign playbook's `Last verified`. **Sequence Phase 18 after `17.1-10`, then make the
one-line edit and append a `### Phase 18` subsection without bumping `Last verified`.** Not making
the edit is not an option — a created doc lands at `status: "ready"` and inflates the very number
`17.1-10`'s gate exists to read.

---

### Anti-Patterns to Avoid

- **Adding a `sites` table, a public route, an `ACTION_TYPES` member, or a `plans.kind` value.**
  Explicitly out of scope (locked). If you are editing `actionType.ts`, `cockpit.ts`'s `_ARM_TABLE`,
  `plans.ts patchPlan/resetPlan` or the `PlanCard` kind chain, the design has drifted.
- **Storing `application/pdf` as the vault row's `mimeType`.** `isSearchable("application/pdf")` is
  false, so `vaultUpload` lands such rows at `pending_extraction` and schedules `vaultExtract` to
  recover text we authored. Verified in code at vault.ts:196-216 — this is not a style preference.
- **Adding a text/label/detail field to `agentSteps`** to describe the created artifact. That
  re-opens the §4 hole the closed union closed (`traceParity.test.ts:17-18` says so in the file).
- **Writing `agentSteps.count` from the tool.** Declared and deliberately unwritten
  (schema.ts:527-531); parsing a count out of a tool's return string is forbidden (§4).
- **Editing `vaultIngest.ts`** to add a "skip ingest" flag. Don't call `startIngest` — that is the
  whole mechanism. Editing the file trips `vault.md` for no gain.
- **Adding `marked`, `sanitize-html`, `DOMPurify`, `remark` or any markdown/HTML dependency.**
- **Bumping `traceParity.test.ts`'s `>= 22` floor** (:57-58). It is a non-vacuity floor, not a count.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| markdown → structured blocks | a second parser / `marked` | `tokenizeMarkdown` (documentGen.ts:44) | Handles headings, bullets, ordered, GFM pipe tables, paragraph joining; already unit-tested |
| inline emphasis | a regex in the renderer | `inlineRuns` (documentGen.ts:96) | Also *strips* stray `*`/`` ` ``/`_` so raw syntax never reaches the page |
| PDF rendering | anything | `markdownToPdf` (llm.ts:3527) + `toWinAnsi` | Standard-14 WinAnsi encoding failures are the #1 pdf-lib throw; already sanitize-or-drop |
| Filename safety / collisions | ad-hoc slug + counter | `buildDocFilename` (documentGen.ts:161) | LLM-free, deterministic, collision-suffixed |
| Size guarding | a new constant | `exceedsByteCap` / `PLAN_ATTACHMENT_CAP_BYTES` | 8 MiB plan-attachment total; distinct from the 100 MiB vault cap |
| Signed download URL / a download route | a Next route handler | `vault.vaultDownloadUrl` (vault.ts:318) + `PreviewModal` | Already wired, already tenant-guarded |
| Retrieval exclusion | a filter in `vaultGround` | *not calling* `startIngest` | No rag entry ⇒ unreachable by both search halves |
| Per-thread card plumbing | a new table + query + component | `vaultSources` + `SourceCard` (cards.tsx:1251) | Same refs+labels shape, `by_thread` index exists |
| Spend limiting for the new tool | any new budget code | the loop's `preCall`/`recordSpend` | Explicitly locked; `renderAndStore`'s own comment says so |
| Cross-module vault insert | a new convex module | a new `internalMutation` in `vault.ts` | `ingestFromAttachment` (vault.ts:571-615) is the precedent; avoids a `watch.json` edit |

**Key insight:** ROADMAP SC#4 words this phase as a *parameterization*, not a feature build.
`packages/core/src/documentGen.ts`, `documentDraft.test.ts` and the `DOCUMENT_DRAFTER_SKILL` entry
in `GATED_SKILLS` all already exist at HEAD. Half the machinery is shipped; the plan's job is to
thread one parameter and add one governed write path — not to build a document subsystem.

---

## Common Pitfalls

### Pitfall 1 — The gated `cockpit-agent` candidate stream (EXECUTION BLOCKER)
**What goes wrong:** a Phase-18 edit to `packages/contracts/skills/cockpit-agent.md` while Lane R
holds an un-activated candidate mints a candidate carrying **both lanes' prose**; whichever lane
evals next certifies instructions it never tested. A correctness failure *inside the skill registry*,
not a merge conflict.
**Why it happens:** `seedSkills` compares the file body against the **NEWEST** row (skills.ts:352-355)
and mints `maxVersion + 1` on any difference.
**How to avoid:** Phase 18 **execution** waits for Phase 16 to close. **Verify against the LIVE
Convex `skills` table** (`name = "cockpit-agent"`, any `status: "candidate"`) — **not** `git status`:
`cockpit-agent.md` is **CLEAN at HEAD** (last touched by `68afb7b`), so the contested state is
invisible in the working tree. `cockpit-agent@15` is active and Phase 16's gate has run **twice, both
RED** ($0.4376 spent, nothing activated).
**Warning signs:** a plan step that says "edit cockpit-agent.md" with no preceding live-DB check.

### Pitfall 2 — The swallowed step-insert (bitten TWICE, and there are TWO live instances right now)
**What goes wrong:** a tool whose name is not a literal in `agentSteps.tool` (schema.ts:461-521)
makes `internal.agentSteps.record` throw **inside** the AI-SDK `onToolExecutionStart` callback
(llm.ts:2208-2222), which swallows it. **No trace row in prod; every offline test green.**
**Why it happens:** `StepTool` is `Doc<"agentSteps">["tool"]` (llm.ts:1987) — the `as StepTool` cast
turns a missing literal into a *runtime* validator throw.
**How to avoid:** add the literal in the same commit as the tool key. Note `schema.ts` is watched by
**no** playbook, so the Stop hook will not prompt you.
**⚠ Pre-existing:** `resetPlan` (llm.ts:1171) and `recordScorecardAnswer` (llm.ts:1810) are live
tools with **no** schema literal — they are silently trace-less today. `traceParity.test.ts` cannot
see this (it compares schema↔VERB, never schema↔llm.ts tool keys). **Decide deliberately** whether
Phase 18 fixes them; doing so is a union widening + two VERB entries in the same freeze-sensitive
block, not a free ride.
**Warning signs:** green tests + a live turn whose workspace trace is missing a row.

### Pitfall 3 — `pnpm typecheck` lies, AND the baseline is 150, not 52
**What goes wrong:** CONTEXT.md and PARALLELIZATION.md both state a **52-error** baseline. **It is
150** — measured at HEAD on 2026-08-01 with
`pnpm exec turbo run typecheck --filter=@pikar/backend --force` → `150`. Independently corroborated
by STATE.md's Lane-O row ("back to the exact 150 baseline"). A "≤52 errors" gate fails on arrival
with 98 pre-existing foreign errors.
**Why it happens:** `turbo.json:13-15` declares `typecheck` with no `inputs`; the real hole is that
`**/_generated/` is **gitignored**, so generated-API changes are invisible to the task hash — and
nearly every backend type error is generated-API-shaped. (Right now the cache cannot serve a stale
pass at all, because the task **fails** and turbo does not cache failures.)
**How to avoid:** **re-measure with `--force` immediately before starting** (Lane O / Phase 22.1 are
actively moving it — 22.1 explicitly targets the shared `tsconfig`), and gate on
**delta == 0 vs. the freshly measured number**, plus **zero errors in a production `convex/*.ts`
file**. All 150 are in 41 `convex/*.test.ts` files; zero are in production source.

### Pitfall 4 — Playbooks: four are forced, and the changed-set is the whole working tree
**What goes wrong:** `check-playbooks.mjs:55-63` builds its changed-set from `git diff` over the
**whole working tree plus untracked files**, not the session's own. At the time of this research
`apps/web/app/(app)/connect-gmail/page.tsx` and `packages/backend/convex/gmailAuth.ts` were dirty
from a foreign lane — both on `cockpit.md`'s watch list — so the hook will demand `cockpit.md` for
work Phase 18 did not do. The `.git/claude-playbooks-ack.json` escape is **shared, not
session-keyed**, and re-arms whenever a foreign lane saves.
**Phase 18's forced playbooks** (all four already cover every path; **no `watch.json` edit needed**
if you follow Pattern 1's "no new convex module" rule):

| Playbook | Triggered by |
|---|---|
| `cockpit.md` | `llm.ts`, `cards.tsx`, `documentGen.ts`, `vaultSources.ts`, `traceParity.test.ts`, `plans.ts` |
| `skill-registry.md` | `contracts/skills/*`, `contracts/src/skills/*`, `contracts/src/skill.ts`, `skills.ts` |
| `vault.md` | `vault.ts`, `packages/vault/`, `apps/web/.../dashboard/vault/` |
| `onboarding.md` | `blueprint.ts` (Pattern 9) |

**How to avoid:** append inside your own `### Phase 18` subsection; **never bump a foreign
playbook's `Last verified`.** ⚠ If you *do* add a new module under `packages/`, `check-playbooks.mjs:125-134`
**blocks the turn** until it is registered in `watch.json`.

### Pitfall 5 — `vault.test.ts` contains a literal NUL byte
**What goes wrong:** ripgrep/Grep classify it as binary and skip it **silently** — a verification
grep "confirms" whatever it hoped to find by returning nothing.
**How to avoid:** `grep -a`, `sed`, or the Read tool for that file.

### Pitfall 6 — `renderAndStore` is a closure, not an exported function
**What goes wrong:** a plan that assumes the new tool can "just call `renderAndStore`" for the vault
path. It is an inner closure (llm.ts:893) capturing `tenantId`, `planId`, `skillVersions` and `ctx`
from `buildCockpitTools`; it also writes `plans.recordAttachments` on failure, which is wrong for a
vault artifact.
**How to avoid:** the `createDocument` tool is a **sibling** closure in the same builder, reusing
`scanText` → `internal.llm.draftDocument` → `markdownToPdf` directly. Do not refactor
`renderAndStore` out of the closure — that is a large diff in the file this repo's contracts exist
to protect.

### Pitfall 7 — ROADMAP.md contradicts the locked decision
**What goes wrong:** `ROADMAP.md:704` says `actionType.ts` "already pre-commits Phase 18 to the
existing `externalAction` arm **and that pre-commitment stands**." CONTEXT.md and
PARALLELIZATION.md:110-126 (the owner decision, 2026-07-31) say the opposite: **no arm, no action
type**. The owner decision is the tiebreaker.
**How to avoid:** correct `ROADMAP.md:702-712` in the same commit, or the next planner re-derives the
wrong arm from it. Note ROADMAP also has `actionType.ts`'s range off by one (it is **:30-32**) and
`documentGen.ts`'s second `.pdf` off by one (it is **:176**, not `:177`, which is `n++`).

### Pitfall 8 — Line-number drift in CONTEXT.md
Anchor on **symbols**, never on the ranges quoted in CONTEXT.md. Verified corrections:
`renderAndStore` is **:893-954** (not 890-951); `documentGen.ts` `.pdf` literals at **:173/:176**
(not :173/:177); `persistFindings` is **:134-214** with the insert at **:167-180** and the audit at
**:188-211**; the tool record is **:1015-:1965** (not 1012-1975); `VAULT_FILE_CAP_BYTES` is defined
in **`packages/vault/src/constants.ts:2`** (vault.ts:170-174 is enforcement); `text/html` is
`sniff.ts:125` (not :124); the `MAX_INLINE_STRING = 200` scan and the cockpit-agent byte-identity
guard both live in **`packages/backend/convex/skills.test.ts`**.

---

## Code Examples

### Ingesting nothing on purpose (the retrieval exclusion)
```ts
// packages/backend/convex/blueprint.ts:346-369 — SHIPPED precedent: a vault row at status "ready"
// that deliberately skips ingest/embedding/graph extraction. There is NO startIngest call in this
// function. Phase 18's insertCreatedDoc copies exactly this omission.
docId = await ctx.db.insert("vaultDocuments", {
  tenantId: ctx.tenantId, title: BLUEPRINT_TITLE, kind: BLUEPRINT_KIND,
  category: categoryFor({ source: "agent" }), source: "agent", mimeType: "text/markdown",
  size, contentHash: hash, text, status: "ready", createdAt: Date.now(),
});
```

### A tenant-scoped per-thread card (the SC#6 template)
```ts
// packages/backend/convex/vaultSources.ts — internal writer, tenantQuery reader, NO log-plane row.
export const insert = internalMutation({
  args: { tenantId: v.string(), threadId: v.string(), docIds: v.array(v.id("vaultDocuments")),
          titles: v.array(v.string()), count: v.number(), createdAt: v.number() },
  handler: async (ctx, args) => await ctx.db.insert("vaultSources", args),
});
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<Doc<"vaultSources"> | null> =>
    await ctx.db.query("vaultSources")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc").first(),
});
```

### The refs-only audit shape (CLAUDE.md §4)
```ts
// packages/backend/convex/research.ts:188-211 — hashes/counts/enums/ids ONLY.
await ctx.runMutation(internal.audit.log, {
  tenantId, correlationId: planId, eventType: "document.created", actor: "system",
  payload: { topicHash: await contentHash(topic), form, vaultDocId: String(vaultDocId), hasPdf },
});
```

---

## State of the Art

| Old approach | Current approach | When changed | Impact on this phase |
|---|---|---|---|
| `stableTenant` test helper | plain string subjects: `t.withIdentity({ subject: "tenant_a" })` | Lane O `22-01` (`d62c46c`) | Copying an isolation test from an older commit imports a deleted symbol. `vaultGround.test.ts:21-23`'s `asTenant` is the current idiom |
| "typecheck baseline is 52" | **150**, measured 2026-08-01 | between 2026-07-27 and now | Gate on the freshly measured delta |
| "Phase 16 blocked on `OPENAI_API_KEY`" (STATE.md) | key IS provisioned; the gate ran **twice, both RED** ($0.4376) | PARALLELIZATION.md:66-84 | Phase 18's execution unblock is 2 failed evals (~$0.83–$1.06 to retry), not a credential |
| "no shared blueprint-kind constant" (CONTEXT) | `BLUEPRINT_KIND` exists at `blueprint.ts:81` | pre-HEAD | Reuse it; do not introduce a new one |
| "5 writers store out-of-union `source`" (CONTEXT) | **4** of **11** insert sites, 3 distinct values | verified at HEAD | The pattern is real; the fix direction is a *new* discriminator, not repairing `source` |

**Deprecated/outdated in this area:**
- `dispatchGuard.test.ts:95` citations in `actionType.ts:26` and `cockpit.ts:560-561` — the actual
  `tenantMutation` pin is at **:222-229**. Verify any `file:NN` in this subsystem before trusting it.
- `packages/contracts/src/skills/skillBodies.test.ts` as the cockpit-agent drift guard — it is not.

---

## Open Questions

1. **The vault UI search box will not find created documents.**
   - *What we know:* `vault.vaultSearch` is the same rag primitive as grounding; no rag entry ⇒ no hit.
   - *What's unclear:* whether the owner reads "excluded from vault retrieval" as covering the
     user's own manual search of their own vault, or only the agent's automatic grounding.
   - *Recommendation:* accept for beta (created docs remain browsable and previewable in the grid),
     ship a `ponytail:` comment naming the ~3-line title-substring fallback in `DocGrid`, and put
     the question to the owner during planning. **Do not** solve it by ingesting.

2. **Do the two trace-less tools (`resetPlan`, `recordScorecardAnswer`) get fixed here?**
   - *What we know:* both are live and missing from `agentSteps.tool`; the fix is 2 literals + 2 VERB
     entries in the exact block Phase 18 already edits.
   - *What's unclear:* whether widening the union for foreign tools inside a gated freeze block is
     welcome scope.
   - *Recommendation:* fix them, in a clearly separated task with its own `ponytail:` note, because
     the marginal cost while already in both files is ~4 lines and the alternative is leaving a
     known-silent bug. Flag for owner assent rather than deciding unilaterally.

3. **Multiple artifacts per turn + one card row.** Multiples are locked as allowed;
   `vaultSources.byThread` returns the *latest* row. Recommendation: the tool writes **one** row per
   turn carrying all N `docIds`/`titles` (the existing `count` field already means "N") — not one row
   per artifact. Verify against the intended UX during planning.

4. **`content-drafter` gating revisit.** Ungated is correct today (no fixture can reach it). If a
   later phase adds a golden fixture for `createDocument`, gating becomes free and should be done.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **vitest 3.2.7** (two configs: `packages/core/vitest.config.ts` → node; `packages/backend/vitest.config.mts` → **edge-runtime** + `convex-test`) |
| Config files | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.mts`, `apps/web` Playwright for e2e |
| Quick run (core) | `pnpm --filter @pikar/core test` |
| Quick run (one backend file) | `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts` |
| Full suite | `pnpm test` (turbo, all packages) |
| Typecheck | `pnpm exec turbo run typecheck --filter=@pikar/backend --force` — **baseline 150, measured 2026-08-01. Re-measure at start; gate on delta.** |
| E2E | `pnpm test:e2e` (Playwright, `apps/web/e2e/`) |

⚠ **`node:fs` is unavailable in the backend suite** (edge-runtime). A backend source-scan test needs
`// @vitest-environment node` on line 1 (`traceParity.test.ts:1` precedent). `packages/core` is node
already — put source-scan tests there when possible.

### Phase Requirements → Test Map

| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|--------------|
| **SC1** | Creation writes a tenant-scoped `vaultDocuments` row with `text` markdown + `origin:"agent"`; the tool returns a sentence, never bytes/URL/raw id | convex-test integration | `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts` | ❌ Wave 0 |
| **SC1b** | The stored row is **not** ingested: no `ragEntryId`, no `graphNodes` for it, `vaultGround` returns it never | convex-test integration | same file | ❌ Wave 0 |
| **SC2** | Creation has no external side effect; delivery crosses the shipped Approve gate | source-scan + existing pins | `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts convex/cockpitTools.test.ts` | ✅ `dispatchGuard.test.ts:222-252` pins `executePlan` as a `tenantMutation`; **ADD** a scan asserting the `createDocument` body contains no `gmail`, no `workflow.start`, no `internal.cockpit.*` |
| **SC3** | Tenant isolation on the created artifact (snippet below) | convex-test integration | `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts` | ❌ Wave 0 |
| **SC3b** | Audit/telemetry carry refs only | source-scan (existing) | `pnpm --filter @pikar/backend exec vitest run convex/llmRedaction.test.ts` | ✅ exists — **do not change `cockpit.ts`'s audit call-site count (pinned at 2, :77-107)** |
| **SC4** | `format` threads through: `.html` filename, `text/html` blob, same PII→drafter→cap→store chain | unit + convex-test | `pnpm --filter @pikar/core test` + `pnpm --filter @pikar/backend exec vitest run convex/documentDraft.test.ts` | ✅ `documentGen.test.ts`, `documentDraft.test.ts` — **extend both** |
| **SC4b** | Phase-3.3 attachment callers are byte-identical (default `pdf`) | unit | `pnpm --filter @pikar/core test` | ✅ `documentGen.test.ts` — existing `buildDocFilename` cases must pass **unchanged** |
| **SC5** | A model-authored string never becomes markup — behavioural + structural | unit | `pnpm --filter @pikar/core test` | ✅ `packages/core/src/documentGen.test.ts` — **add the two tests in Pattern 6** |
| **SC6** | The artifact is SEEN in the Output card | e2e (`data-testid`) + **manual UAT** | `pnpm test:e2e` | ⚠ partial — `apps/web/e2e/` exists; the BRAND-conformance judgement is human |
| **REG** | The new tool literal has a VERB and vice-versa | unit (existing, automatic) | `pnpm --filter @pikar/backend exec vitest run convex/traceParity.test.ts` | ✅ exists — no edit needed |
| **REG2** | `cockpit-agent.md` ↔ `cockpitAgent.ts:8` byte-identity; `content-drafter` drift row | unit | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts` | ✅ exists — **add the `content-drafter` row** |

**Provable by automated test:** SC1, SC1b, SC2, SC3, SC3b, SC4, SC4b, SC5, plus all registration guards.
**Requires human UAT:**
- **SC6** — that the Output card *looks* like BRAND §5's Output card (title, UPPERCASE type badge,
  subline, rendered artifact) and reads well. An e2e can assert the testid exists; it cannot assert
  the design.
- **The trace row actually appearing in a live turn.** This is structurally unprovable offline: the
  missing-literal failure mode throws *inside a swallowed SDK callback*, so every offline test is
  green either way (Pitfall 2). `traceParity.test.ts` is the best automated proxy and it only covers
  schema↔VERB. **One live turn with the workspace trace open is mandatory before the phase closes.**
- **The withheld-tool check** — that the *active* `cockpit-agent` body actually mentions
  `createDocument` and the model calls it. Offline tests cannot see the live `skills` row.

### Tenant-isolation assertion for SC#3 — COPYABLE, compiles at HEAD

`stableTenant` is **deleted**. This uses plain string subjects, matching `vaultGround.test.ts:21-23`.

```ts
// packages/backend/convex/createdDocs.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const asTenant = (t: ReturnType<typeof convexTest>, tenantId: string) =>
  t.withIdentity({ subject: tenantId }); // requireTenant takes the subject before "|"

test("a created artifact is invisible to another tenant", async () => {
  const t = convexTest(schema, modules);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "A's one-pager",
    form: "long",
    markdown: "# A\n\nprivate",
    contentHash: "hash_a",
  });

  const a = await asTenant(t, "tenant_a").query(api.vault.listVaultDocs, {});
  const b = await asTenant(t, "tenant_b").query(api.vault.listVaultDocs, {});

  expect(a.map((d) => d._id)).toContain(docId);
  expect(b.map((d) => d._id)).not.toContain(docId);

  // The provenance + exclusion contract, asserted on the row itself.
  const row = a.find((d) => d._id === docId)!;
  expect(row.origin).toBe("agent");
  expect(row.mimeType).toBe("text/markdown");
  expect(row.status).toBe("ready");
  expect(row.ragEntryId).toBeUndefined();   // never ingested ⇒ never retrievable
  expect(row.storageId).toBeDefined();      // long-form ⇒ a derived PDF ⇒ a Download button
});
```

Companion (same file) for the drift exclusion, which needs `< 100` ready docs to be meaningful
(`DRIFT_SCAN_CAP`):

```ts
test("a created artifact does not inflate the blueprint drift count", async () => {
  const t = convexTest(schema, modules);
  const before = await t.query(internal.blueprint.unincorporatedCountForTenant, { tenantId: "tenant_a" });
  await t.mutation(internal.vault.insertCreatedDoc, { /* …as above… */ });
  const after = await t.query(internal.blueprint.unincorporatedCountForTenant, { tenantId: "tenant_a" });
  expect(after).toBe(before);
});
```

### Sampling Rate

- **Per task commit:** `pnpm --filter @pikar/core test` (fast, <5s) **+** the one backend file the
  task touched (`… exec vitest run convex/<file>.test.ts`).
- **Per wave merge:** `pnpm test` **+** `pnpm exec turbo run typecheck --filter=@pikar/backend --force`
  (assert **delta == 0** vs. the number measured at phase start, and **zero** errors in a production
  `convex/*.ts` file) **+** `node scripts/check-playbooks.mjs`.
- **Phase gate (before `/gsd:verify-work`):** full suite green + typecheck delta 0 + **one live
  cockpit turn** ("write me a one-pager on X" and "give me three LinkedIn post options") verifying:
  the trace row renders with the new VERB, the Output card appears, the vault grid shows the AGENT
  chip, the long-form Download works, the short-form has no Download button, and
  `npx convex data audit` shows a refs-only `document.created` row.

### Wave 0 Gaps

- [ ] `packages/backend/convex/createdDocs.test.ts` — covers SC1, SC1b, SC3, drift exclusion (NEW file; tests need no `watch.json` entry)
- [ ] `packages/core/src/documentGen.test.ts` — **extend**: `renderHtmlDocument` escape tests (SC5) + `buildDocFilename(…, "html")` (SC4)
- [ ] `packages/backend/convex/documentDraft.test.ts` — **extend**: `renderAndStore` html branch (SC4), driven offline by the existing `SMOKE::` / `render=fail::` seams
- [ ] `packages/backend/convex/cockpitTools.test.ts` — **extend**: the SC2 no-external-side-effect scan (needs `// @vitest-environment node` if it does a source read; the file already carries it)
- [ ] `packages/backend/convex/skills.test.ts` — **extend**: the `content-drafter` drift row
- [ ] `apps/web/e2e/` — a `data-testid="output-card"` assertion (SC6 partial; the visual is manual)
- [ ] Framework install: **none** — vitest, convex-test and Playwright are all present.

---

## Sources

### Primary (HIGH confidence — read at HEAD, 2026-08-01)
- `packages/backend/convex/llm.ts` — `renderAndStore` :893-954, `generateAttachment` :1275-1298, `searchVault` :1682-1760, `draftDocument` :3029-3088, `markdownToPdf` :3527, tool record :1015-1965, step callbacks :2208-2235
- `packages/core/src/documentGen.ts` (full) + `documentGen.test.ts` (head)
- `packages/backend/convex/schema.ts` — `agentSteps.tool` :461-521, `vaultSources` :345-352, `vaultDocuments` :688-733
- `packages/backend/convex/vault.ts` — caps :170-174, `vaultUpload` :156-216, `listVaultDocs` :270-279, `vaultDownloadUrl` :318, `ingestFromAttachment` :571-615
- `packages/backend/convex/vaultGround.ts` :1-100, `vaultIngest.ts` :1-60, `vaultSources.ts` (full), `blueprint.ts` :190-210/:340-370/:545-590
- `packages/backend/convex/skills.ts` :320-360, `skills.test.ts` :720-760, `traceParity.test.ts` (full), `vaultGround.test.ts` :1-50
- `packages/contracts/src/skill.ts` :150-200; `packages/vault/src/categories.ts` (full)
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — `VERB` :1139-1177, `SourceCard` :1251-1285
- `apps/web/app/(app)/dashboard/vault/` — `DocGrid.tsx` :1-80, `PreviewModal.tsx` (greps), `page.tsx`
- `docs/design/BRAND.md` :85-120; `docs/playbooks/watch.json`; `.planning/config.json`
- Measured: `pnpm exec turbo run typecheck --filter=@pikar/backend --force` → **150 errors**, 2026-08-01
- `.planning/phases/18-document-content-creation/18-CONTEXT.md` (owner-locked decisions)
- `.planning/PARALLELIZATION.md` § *Phases 18 + 19*; `.planning/REQUIREMENTS.md` (ACTN-04)
- The pre-verified adversarial ground-truth block supplied with this task

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — Lane-O 150-baseline corroboration. ⚠ Its Phase-16 "no `OPENAI_API_KEY`" line is **stale** (PARALLELIZATION.md:66-84 refutes it)
- `.planning/ROADMAP.md:702-712` — richest SC spec, but **:704 contradicts the locked no-arm decision** and carries two off-by-one line citations

### Tertiary (LOW confidence)
- None. No WebSearch or Context7 lookup was performed: this phase adds no dependency, and every
  technical question resolved against in-repo source. Recorded honestly rather than padded.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new dependencies; every module read at HEAD
- Format parameterization (must-resolve 1): **HIGH** — exact sites verified, both shipped callers proven unaffected by the default
- Spec→markup boundary (must-resolve 2): **HIGH** on the spec type and renderer location (they exist / CLAUDE.md §1 is unambiguous); **MEDIUM** on the *structural* test's naming convention (`*Html`) — it is a convention guard, which is why it is paired with the behavioural hostile-input test
- Provenance field (must-resolve 3): **HIGH** — 11-site insert census verified; migration-free by the shipped `retrievedAt` precedent
- Retrieval + drift exclusion (must-resolve 4): **HIGH** on the mechanism and the exact sites; the vault-UI-search consequence is flagged as Open Question 1
- Short-form/long-form + skills (must-resolve 5): **HIGH** — `seedSkills` v1 path, `SKILL_NAMES` derivation and `PreviewModal`'s `canDownload` all read at HEAD
- Registration completeness (must-resolve 6): **HIGH** — every surface enumerated and the two live silent-failure instances found
- Pitfalls: **HIGH** — every one is either code-documented in-file or measured
- Card shape (Pattern 8): **MEDIUM** — explicitly Claude's discretion; the `vaultSources` reuse is the zero-new-table answer but the two optional fields deserve owner assent

**Research date:** 2026-08-01
**Valid until:** ~2026-08-08 — short deliberately. Three sibling lanes (O/22.1, R/16, 17.1) are
actively moving `schema.ts`, `llm.ts`, `blueprint.ts`, the shared `tsconfig` and the typecheck
baseline. **Re-verify the typecheck number and the live `cockpit-agent` candidate status on the day
execution starts.**
