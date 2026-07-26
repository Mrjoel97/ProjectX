# Voice Pre-Flight Document Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user attach one of their READY Knowledge Vault documents to a voice session from the pre-flight screen, so an agent started outside the vault can actually see the document instead of asking the user to supply it.

**Architecture:** One new tenant-scoped Convex query (`voiceDoc.pickableDocs`) returns id + title for the tenant's ready documents plus a count of ones still processing. One new self-contained React component (`DocPicker`) renders a paperclip toggle, a searchable list, and a selected-doc chip. It fills the `docId` state `page.tsx` already owns, which flows into the existing `useVoiceSession(docId)` → `startSession({ docRef })` path unchanged. The server remains the trust boundary.

**Tech Stack:** Convex (tenant wrappers in `convex/lib/functions.ts`), convex-test + Vitest, Next.js App Router client components, inline styles on `globals.css` tokens (no component library).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-26-voice-doc-picker-design.md`.
- **CLAUDE.md §1** — pure literals live in `@pikar/voice`, never re-declared in a Convex module.
- **CLAUDE.md §2** — no raw `query`/`mutation`/`action` imports; use `tenantQuery` from `./lib/functions`.
- **`voiceDoc.ts` header rule** — every handler carries an EXPLICIT `Promise<...>` return type. An inferred return type re-triggers the `internal`-graph circular-inference cliff that collapses the generated API to `any`/`{}`.
- **Never use `vault.listVaultDocs` from the voice route** — it `.collect()`s whole rows including book-sized `text`; `schema.ts` notes a 16 MiB / 32k-doc read cap.
- **CLAUDE.md §10 / BRAND** — `globals.css` CSS variables only, never a hardcoded hex a token covers. No component library. No new icon SVGs: reuse `PaperclipIcon` from `apps/web/app/(auth)/icons.tsx` and `SearchIcon` / `XIcon` / `FileTextIcon` from `apps/web/app/(app)/dashboard/vault/icons.tsx`.
- **BRAND §6 (requirements, not suggestions)** — `--teal-600` is ~2.9:1 on white: button fills with white text only, never small teal body text. Real `<button>` elements, never nested inside another interactive element. Labelled inputs. Visible focus. Never encode meaning in colour alone.
- **CLAUDE.md §9 + Stop/SubagentStop hook** — `docs/playbooks/voice.md` watches `packages/voice/`, `packages/backend/convex/voiceDoc.ts`, `packages/backend/convex/voiceDoc.test.ts`, and `apps/web/app/(app)/dashboard/voice/`. **Every task below touches a watched path.** `scripts/check-playbooks.mjs` runs on `Stop` AND `SubagentStop`, and blesses a playbook only when it appears in the diff **cumulative since session start**. Task 1 therefore writes the `voice.md` entry alongside the code (owner ruling, 2026-07-26); once it is touched, every later task's stop re-blesses instead of blocking. Task 4 bumps that same entry with the real verification results.
- **Windows/vitest note** — convex-test files can false-red on parallel-fork teardown. Run with `--maxWorkers=1`. `convex/_generated/` must exist (`npx convex codegen`) or every convex-test in the file errors with "Could not find the `_generated` directory".
- **Do not** add mid-call attach, upload-from-disk, or any change to retrieval/grounding/`docScopedPassages`.

---

### Task 1: `pickableDocs` query + the scan-cap literal

**Files:**
- Modify: `packages/voice/src/docSession.ts` (add the constant after `EXCERPT_CHAR_CAP`, ~line 31)
- Modify: `packages/voice/src/index.ts` (add to the existing `from "./docSession"` value export list)
- Modify: `packages/backend/convex/voiceDoc.ts` (add after `docContext`, which ends ~line 591)
- Test: `packages/backend/convex/voiceDoc.test.ts` (append a new `describe` at end of file)
- Modify: `docs/playbooks/voice.md` (the §9 entry — see Step 5a; this MUST land in this task's commit)

**Interfaces:**
- Consumes: `tenantQuery` from `./lib/functions`; `Id` from `./_generated/dataModel`; the `by_tenant` index on `vaultDocuments`.
- Produces: `api.voiceDoc.pickableDocs` — no args, returns
  `{ docs: { docId: Id<"vaultDocuments">; title: string }[]; processingCount: number }`.
  Task 2 consumes this exact shape. Also exports `PICKER_DOC_SCAN_CAP: number` from `@pikar/voice`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/convex/voiceDoc.test.ts`:

```ts
// ── 14-07: pickableDocs — the pre-flight picker's list ────────────────────────────────────────
//
// The picker may only offer what `voice.startSession` will ACCEPT (ready + non-empty text);
// offering a row the server refuses would be a lie. Non-ready rows are not listed but ARE counted,
// so a just-uploaded document does not appear to have vanished — the confusion that motivated this
// feature. Like docContext, this pins the PROJECTION: a future "just return the row" simplification
// must fail loudly rather than quietly ship document text to the voice page.
describe("voiceDoc.pickableDocs (14-07 — the pre-flight picker's read)", () => {
  test("lists only READY documents with text, newest first, as id + title", async () => {
    const t = newTest();
    await seedReadyDoc(t, TENANT, REPORT_TEXT, "Older Report");
    await seedReadyDoc(t, TENANT, REPORT_TEXT, "Newer Report");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs.map((d) => d.title)).toEqual(["Newer Report", "Older Report"]);
    // The projection is exactly two keys — no `text`, no `status`, no `size`.
    expect(Object.keys(res.docs[0] ?? {}).sort()).toEqual(["docId", "title"]);
  });

  test("excludes non-ready documents from docs but counts them as processing", async () => {
    const t = newTest();
    await seedReadyDoc(t, TENANT, REPORT_TEXT, "Ready Report");
    await seedDocWithStatus(t, TENANT, "pending_extraction", "Queued Deck");
    await seedDocWithStatus(t, TENANT, "extracting", "Reading Deck");
    await seedDocWithStatus(t, TENANT, "processing", "Embedding Deck");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs.map((d) => d.title)).toEqual(["Ready Report"]);
    expect(res.processingCount).toBe(3);
  });

  test("a failed document is neither listed nor counted as processing", async () => {
    const t = newTest();
    await seedDocWithStatus(t, TENANT, "failed", "Broken Scan");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
    expect(res.processingCount).toBe(0);
  });

  test("a READY row with empty text is not offered — startSession would reject it", async () => {
    const t = newTest();
    await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Empty Ready Doc",
        kind: "upload",
        category: "business",
        source: "seam",
        mimeType: "text/markdown",
        size: 0,
        contentHash: "hash_empty_ready",
        text: "   ",
        status: "ready" as const,
        createdAt: Date.now(),
      }),
    );

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
  });

  test("another tenant's documents never appear (BETA-05)", async () => {
    const t = newTest();
    await seedReadyDoc(t, TENANT_B, REPORT_TEXT, "Tenant B Report");

    const res = await asTenant(t, TENANT).query(api.voiceDoc.pickableDocs, {});

    expect(res.docs).toEqual([]);
    expect(res.processingCount).toBe(0);
  });
});
```

Add this helper immediately after the existing `seedReadyDoc` function (which ends ~line 76):

```ts
/** Seed a vault row in a NON-ready lifecycle state — the picker must not offer these. */
function seedDocWithStatus(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  status: "pending_extraction" | "extracting" | "processing" | "failed",
  title: string,
): Promise<Id<"vaultDocuments">> {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "application/pdf",
      size: 1024,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text: "",
      status,
      createdAt: Date.now(),
    }),
  );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/Users/expert/desktop/pikar-ai/.worktrees/lane-c-voicedoc
npx vitest run --root packages/backend --maxWorkers=1 -t "pickableDocs" convex/voiceDoc.test.ts
```

Expected: FAIL. `api.voiceDoc.pickableDocs` does not exist, so the property is `undefined` and convex-test rejects the function reference.

- [ ] **Step 3: Add the scan-cap literal to `@pikar/voice`**

In `packages/voice/src/docSession.ts`, after `EXCERPT_CHAR_CAP` (~line 31):

```ts
/** Newest `vaultDocuments` rows scanned for the pre-flight picker. A bound on the READ (schema.ts
 *  notes a 16 MiB / 32k-doc cap), not a target — the picker lists only the READY subset of these.
 *  One more than `vault.profileSeedDocs`' 40, which uses the same newest-first scan shape. */
export const PICKER_DOC_SCAN_CAP = 50;
```

In `packages/voice/src/index.ts`, add `PICKER_DOC_SCAN_CAP,` to the existing value export list from `"./docSession"`, keeping alphabetical order (it goes between `EXCERPT_CHAR_CAP` and `RETRIEVAL_CHAR_CAP`).

- [ ] **Step 4: Implement the query**

In `packages/backend/convex/voiceDoc.ts`, add `PICKER_DOC_SCAN_CAP` to the existing `@pikar/voice` import block (alphabetical, after `isEnded`), then append after `docContext`:

```ts
/** Lifecycle states that mean "this document is on its way but not discussable yet". `failed` is
 *  deliberately absent: a failed document is not coming, and counting it as pending would be a lie. */
const DOC_IN_PROGRESS: ReadonlySet<string> = new Set([
  "pending_extraction",
  "extracting",
  "processing",
]);

/**
 * The pre-flight picker's list (14-07): this tenant's READY documents newest-first as id + title,
 * plus a count of the ones still being read.
 *
 * WHY IT EXISTS: a session only becomes doc-scoped when `startSession` receives a `docRef`, and
 * before the picker the ONLY way to get one was arriving from the vault with `?doc=`. A session
 * started from the voice page left `docScopedPassages` returning `[]` before it searched anything,
 * so the agent had no vault reach and asked the user to supply the document.
 *
 * READY-ONLY BY CONSTRUCTION: `voice.startSession` rejects anything that is not `status: "ready"`
 * with non-empty text, so offering any other row would be offering a click the server refuses.
 * This is a COURTESY, NOT A GATE — `startSession` and `voiceToken.mintClientSecret` each re-validate
 * ownership and readiness, and nothing the browser sends here is trusted.
 *
 * Deliberately NOT `vault.listVaultDocs`, which `.collect()`s whole rows INCLUDING `text` — the
 * voice page must never pull book-sized blobs to render a list of titles (the `docContext` rule).
 *
 * ponytail: newest-`PICKER_DOC_SCAN_CAP` scan plus a client-side title filter. A vault whose ready
 * documents fall outside that window needs pagination or a real title search index (a schema
 * change) — not built, and not needed at single-owner scale.
 */
export const pickableDocs = tenantQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    docs: { docId: Id<"vaultDocuments">; title: string }[];
    processingCount: number;
  }> => {
    const rows = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(PICKER_DOC_SCAN_CAP);

    const docs: { docId: Id<"vaultDocuments">; title: string }[] = [];
    let processingCount = 0;
    for (const row of rows) {
      if (row.status === "ready" && row.text?.trim()) docs.push({ docId: row._id, title: row.title });
      else if (DOC_IN_PROGRESS.has(row.status)) processingCount += 1;
    }
    return { docs, processingCount };
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --root packages/backend --maxWorkers=1 -t "pickableDocs" convex/voiceDoc.test.ts
```

Expected: PASS, 5 tests.

Then confirm nothing else regressed and the package builds:

```bash
npx vitest run --root packages/backend --maxWorkers=1 convex/voiceDoc.test.ts
pnpm --filter @pikar/voice test
pnpm --filter @pikar/voice typecheck
```

Expected: the voiceDoc suite green apart from any failure that was ALREADY red before this task (record the baseline first if unsure); `@pikar/voice` green and typecheck clean.

- [ ] **Step 5a: Write the playbook entry (§9 — REQUIRED IN THIS COMMIT)**

`docs/playbooks/voice.md` watches every path this task touches, and `scripts/check-playbooks.mjs`
runs on `SubagentStop`. Writing this entry now also unblocks Tasks 2–4 (the hook blesses a playbook
that appears in the cumulative since-session-start diff). Task 4 will bump it with real results.

Prepend to the `> Last verified:` line in `docs/playbooks/voice.md`, bumping its counter and
demoting the previous entry to `Prior:` exactly as that file's existing entries do:

> **A VOICE SESSION CAN NOW ATTACH A VAULT DOCUMENT FROM PRE-FLIGHT (14-07).** Owner-reported: "I uploaded the document in the knowledge vault but the agent still cannot access it — it's asking me to upload the document in that voice session." ROOT CAUSE: a session only becomes doc-scoped when `startSession` receives a `docRef`, and the ONLY way to supply one was arriving from the vault at `/dashboard/voice?doc=<id>`. Started from the voice page, `docScopedPassages` returns `[]` **before it searches anything** (`!session.docRef` is in its first guard), so the agent had no vault reach and honestly asked for the document. Retrieval was NOT at fault — `vaultGroundHydrated` was run live against the owner's tenant and returned the document as the TOP hit, and no row in `voiceSessions` carried a `docRef`. FIX: `voiceDoc.pickableDocs` (tenantQuery — this tenant's READY documents newest-first as id + title, plus a `processingCount`, scanning `PICKER_DOC_SCAN_CAP` = 50 newest rows in the `vault.profileSeedDocs` shape) plus a `DocPicker` pre-flight panel (paperclip → searchable list → chip). **The trust boundary did NOT move:** `voice.startSession` and `voiceToken.mintClientSecret` each still re-validate ownership and `status: "ready"`, so the picker is the courtesy `startSession`'s own comment always said it would be. READY-ONLY BY CONSTRUCTION — offering a row the server rejects would be a lie; non-ready rows are counted, not listed, so a just-uploaded file does not appear to vanish. Deliberately NOT `vault.listVaultDocs` (whole rows including book-sized `text`, against schema.ts's 16 MiB read cap) — the `docContext` rule. `useVoiceSession` is UNCHANGED: `docId` is read inside `start()` and is already in that callback's dependency array. Ceilings (`ponytail:` in source): PRE-FLIGHT ONLY — no mid-call attach or swap, because `docRef` is written at row-insert and re-validated at token mint, so a swap means patching a live session and re-instructing the model mid-stream; and the list is a newest-50 scan with a client-side title filter, so a vault whose ready docs fall outside that window needs pagination or a title search index (a schema change). **This does NOT improve grounding quality** — an attached document still carries whatever text extraction produced, and the scanned-PDF summary defect remains open in `vault.md` "Known gaps". Spec: `docs/superpowers/specs/2026-07-26-voice-doc-picker-design.md`.

- [ ] **Step 6: Commit**

```bash
git add packages/voice/src/docSession.ts packages/voice/src/index.ts \
        packages/backend/convex/voiceDoc.ts packages/backend/convex/voiceDoc.test.ts \
        docs/playbooks/voice.md
git commit -m "feat(14-07): pickableDocs — the pre-flight picker's ready-doc read"
```

---

### Task 2: The `DocPicker` inline panel

**Files:**
- Create: `apps/web/app/(app)/dashboard/voice/DocPicker.tsx`

**Interfaces:**
- Consumes: `api.voiceDoc.pickableDocs` (Task 1) and the existing `api.voiceDoc.docContext`
  (`{ docId }` → `{ title, status, truncated } | null`).
- Produces: `export function DocPicker({ selectedId, onPick }: { selectedId?: string; onPick: (docId: string | undefined) => void })`. Task 3 renders exactly this.

- [ ] **Step 1: Create the component**

Create `apps/web/app/(app)/dashboard/voice/DocPicker.tsx`:

```tsx
"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PaperclipIcon } from "../../../(auth)/icons";
import { FileTextIcon, SearchIcon, XIcon } from "../vault/icons";

// 14-07 — the pre-flight document picker.
//
// A voice session only becomes doc-scoped when `startSession` receives a `docRef`. Before this
// existed the ONLY way to get one was arriving from the vault with `?doc=`, so a session started
// from this page left the agent with no vault reach at all and it correctly asked the user to
// supply the document. This closes that gap WITHOUT touching the trust boundary: the server still
// re-validates ownership and readiness in both `voiceToken.mintClientSecret` and
// `voice.startSession`. Nothing this component sends is trusted.
//
// PRE-FLIGHT ONLY. There is deliberately no mid-call attach or swap: `docRef` is written at
// row-insert in `startSession` and the id is validated again at token-mint time, so swapping
// mid-call would mean patching a live session and re-instructing the realtime model mid-stream.
//
// READY DOCUMENTS ONLY, because `startSession` refuses anything else — a row the server will reject
// must not be offered. Documents still being read are surfaced as ONE quiet count line so a
// just-uploaded file does not look like it vanished (the confusion that motivated this feature).
//
// Reads `voiceDoc.pickableDocs` (id + title) and `voiceDoc.docContext` (title of the current
// selection, which also covers the `?doc=` arrival where this component never saw the row). It does
// NOT read `vault.listVaultDocs`, which `.collect()`s whole rows including `text` — same rule
// <DocStrip> documents.
//
// BRAND: tokens only, no component library (§10). §6: real <button>s never nested inside another
// interactive element, a labelled search input, visible focus, and the selected state carries the
// word "Selected" rather than colour alone.

type DocIdArg = FunctionArgs<typeof api.voiceDoc.docContext>["docId"];

export function DocPicker({
  selectedId,
  onPick,
}: {
  selectedId?: string;
  onPick: (docId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const data = useQuery(api.voiceDoc.pickableDocs, {});
  // "skip" is the established idiom on this route (PostCall.tsx) for a query that needs an argument
  // the page may not have yet. Resolving the title through docContext rather than the list means the
  // chip is correct for a `?doc=` arrival too, where the id may sit outside the scanned window.
  const selected = useQuery(
    api.voiceDoc.docContext,
    selectedId ? { docId: selectedId as DocIdArg } : "skip",
  );

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const docs = data?.docs ?? [];
    return needle ? docs.filter((d) => d.title.toLowerCase().includes(needle)) : docs;
  }, [data, term]);

  // `undefined` = still loading. Render nothing rather than flashing an empty panel — the same rule
  // <DocStrip> follows for treating `undefined` and `null` as one "nothing to show yet" state.
  if (!data) return null;

  // A document is attached: show the chip instead of the list. "Change" reopens the picker.
  if (selectedId) {
    return (
      <div style={panelWrap}>
        <div style={chip}>
          <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--ink-soft)" }}>
            <FileTextIcon size={16} />
          </span>
          <span style={chipTitle} title={selected?.title ?? undefined}>
            {selected?.title ?? "Attached document"}
          </span>
          <button
            type="button"
            onClick={() => {
              onPick(undefined);
              setOpen(false);
            }}
            aria-label="Remove the attached document"
            style={iconBtn}
          >
            <XIcon size={14} />
          </button>
        </div>
        <p style={hintText}>The assistant can read this document during the session.</p>
      </div>
    );
  }

  return (
    <div style={panelWrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="voice-doc-picker-panel"
        style={attachBtn}
      >
        <PaperclipIcon size={16} /> Discuss a document (optional)
      </button>

      {open && (
        <div id="voice-doc-picker-panel" style={panel}>
          {data.docs.length === 0 ? (
            <p style={hintText}>
              No documents are ready yet.{" "}
              <Link href="/dashboard/vault" style={{ color: "var(--ink)", fontWeight: 600 }}>
                Open your vault
              </Link>
            </p>
          ) : (
            <>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span aria-hidden="true" style={searchIconWrap}>
                  <SearchIcon size={16} />
                </span>
                <input
                  type="search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  aria-label="Search your documents by name"
                  placeholder="Search documents…"
                  style={searchInput}
                />
              </div>

              {filtered.length === 0 ? (
                <p style={hintText}>No documents match that search.</p>
              ) : (
                <ul style={list}>
                  {filtered.map((d) => (
                    <li key={d.docId}>
                      <button
                        type="button"
                        onClick={() => {
                          onPick(d.docId);
                          setOpen(false);
                        }}
                        style={rowBtn}
                      >
                        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--ink-soft)" }}>
                          <FileTextIcon size={16} />
                        </span>
                        <span style={rowTitle} title={d.title}>
                          {d.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {data.processingCount > 0 && (
            <p style={hintText}>
              {data.processingCount === 1
                ? "1 document is still being read."
                : `${data.processingCount} documents are still being read.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const panelWrap: React.CSSProperties = {
  display: "grid",
  gap: "0.5rem",
  width: "100%",
  justifyItems: "center",
};

const panel: React.CSSProperties = {
  display: "grid",
  gap: "0.5rem",
  width: "100%",
  textAlign: "left",
  padding: "0.75rem",
  background: "var(--canvas)",
  border: "1px solid var(--rule)",
  borderRadius: "0.75rem",
};

const attachBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.55rem 1.2rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  cursor: "pointer",
  background: "var(--card)",
  color: "var(--ink)",
  fontWeight: 600,
  fontSize: "0.9rem",
};

const chip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  minWidth: 0,
  padding: "0.5rem 0.6rem",
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "0.6rem",
};

const chipTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "var(--ink)",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  padding: "0.25rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink-soft)",
  cursor: "pointer",
};

const searchIconWrap: React.CSSProperties = {
  position: "absolute",
  left: "0.6rem",
  display: "inline-flex",
  color: "var(--ink-soft)",
  pointerEvents: "none",
};

const searchInput: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.6rem 0.5rem 2rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontSize: "0.85rem",
};

const list: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "0.3rem",
  maxHeight: "12rem",
  overflowY: "auto",
};

const rowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  minWidth: 0,
  padding: "0.5rem 0.6rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  cursor: "pointer",
  textAlign: "left",
};

const rowTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "0.85rem",
};
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm --filter @pikar/web typecheck
```

Expected: clean. If `api.voiceDoc.pickableDocs` is not found, run `npx convex codegen` from `packages/backend` first — the generated API must include Task 1's query.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/dashboard/voice/DocPicker.tsx"
git commit -m "feat(14-07): the pre-flight DocPicker panel"
```

---

### Task 3: Wire the picker into PreFlight and page

**Files:**
- Modify: `apps/web/app/(app)/dashboard/voice/PreFlight.tsx` (props ~lines 20-26; render between the mic-check block ending ~line 178 and the consent notice starting ~line 180)
- Modify: `apps/web/app/(app)/dashboard/voice/page.tsx` (the `<PreFlight ... />` element, ~lines 53-58)

**Interfaces:**
- Consumes: `DocPicker` from Task 2.
- Produces: `PreFlight` gains two props — `docId?: string` and `onPickDoc: (docId: string | undefined) => void`.

- [ ] **Step 1: Add the props to `PreFlight`**

In `PreFlight.tsx`, replace the component signature:

```tsx
export function PreFlight({
  onStart,
  starting,
  error,
}: {
  onStart: () => void;
  starting: boolean;
  error: string | null;
}) {
```

with:

```tsx
export function PreFlight({
  onStart,
  starting,
  error,
  docId,
  onPickDoc,
}: {
  onStart: () => void;
  starting: boolean;
  error: string | null;
  // DOCV-01 / 14-07: the optional document under discussion. page.tsx owns this state (it is also
  // where `?doc=` is read), so the picker below only reports a choice upward — it stores nothing.
  docId?: string;
  onPickDoc: (docId: string | undefined) => void;
}) {
```

Add the import at the top of the file, after the `MicIcon` import:

```tsx
import { DocPicker } from "./DocPicker";
```

- [ ] **Step 2: Render the picker**

In `PreFlight.tsx`, immediately AFTER the mic-check `</div>` (the block that closes ~line 178) and BEFORE the `{/* One-time consent notice ... */}` comment, insert:

```tsx
      {/* 14-07: attach a vault document before spending capped time. Sits after the mic check and
          before consent so the two pre-flight decisions read in order: can we hear you, and what
          are we talking about. Optional — with no document this stays a Phase-6 general session. */}
      <DocPicker selectedId={docId} onPick={onPickDoc} />
```

- [ ] **Step 3: Pass the props from `page.tsx`**

In `page.tsx`, replace:

```tsx
        <PreFlight
          onStart={() => void voice.start()}
          starting={voice.status === "connecting"}
          error={voice.error}
        />
```

with:

```tsx
        <PreFlight
          onStart={() => void voice.start()}
          starting={voice.status === "connecting"}
          error={voice.error}
          // The SAME docId `?doc=` writes: arriving from the vault pre-selects the picker, and an
          // in-session pick fills it when the route carried none. `useVoiceSession` reads docId
          // inside start(), so a choice made before Start is picked up with no hook change.
          docId={docId}
          onPickDoc={setDocId}
        />
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @pikar/web typecheck
npx biome check "apps/web/app/(app)/dashboard/voice/DocPicker.tsx" "apps/web/app/(app)/dashboard/voice/PreFlight.tsx" "apps/web/app/(app)/dashboard/voice/page.tsx"
```

Expected: typecheck clean. For Biome, compare against the pre-change baseline — this repo's worktree has pre-existing CRLF `format` findings on untouched files, so the bar is "no NEW finding", not "zero findings".

- [ ] **Step 5: Manual check against the running app**

Open `/dashboard/voice` with no `?doc=`. Expected: a "Discuss a document (optional)" paperclip button below the mic check. Click it — the panel lists ready documents with a search box. Pick one — the panel collapses to a chip naming the document, with an ✕ that clears it. Tab through: the paperclip, the search field, and every row must take visible focus, and the ✕ must announce "Remove the attached document".

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/dashboard/voice/PreFlight.tsx" "apps/web/app/(app)/dashboard/voice/page.tsx"
git commit -m "feat(14-07): wire the document picker into voice pre-flight"
```

---

### Task 4: Verification sweep + playbook verified-line bump

**Files:**
- Modify: `docs/playbooks/voice.md` (bump the entry Task 1 wrote with the REAL verification results)

- [ ] **Step 1: Bump the playbook entry with real results**

Task 1 already wrote the 14-07 entry. Do NOT write a second entry. Append the actual verification
evidence to the END of that entry's prose, in this file's established style — real numbers from
Step 2, not predictions. Example shape (replace every number with what you actually observed):

> Verified: `voiceDoc.test.ts` N/N green (5 new `pickableDocs` cases: ready-only projection, non-ready counted not listed, `failed` neither, empty-text row refused, cross-tenant empty); `@pikar/voice` N/N green + typecheck clean; web typecheck clean; `check-playbooks` green.

If any suite is red, say so plainly in the entry and in your report — a playbook line claiming green
against a red suite is worse than no line at all.

- [ ] **Step 2: Full verification sweep**

```bash
cd /c/Users/expert/desktop/pikar-ai/.worktrees/lane-c-voicedoc
npx vitest run --root packages/backend --maxWorkers=1 convex/voiceDoc.test.ts
pnpm --filter @pikar/voice test
pnpm --filter @pikar/voice typecheck
pnpm --filter @pikar/web typecheck
node scripts/check-playbooks.mjs
```

Expected: voiceDoc suite green except any test that was already red before Task 1; `@pikar/voice` green; both typechecks clean; `check-playbooks` green.

- [ ] **Step 3: Refresh the knowledge graph (CLAUDE.md graphify rule)**

```bash
graphify update .
node scripts/extract-convex-edges.mjs
```

- [ ] **Step 4: Commit**

```bash
git add docs/playbooks/voice.md graphify-out
git commit -m "docs(14-07): bump the voice playbook with the picker's verification results"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Pick from vault, not upload | Tasks 1–2 (query returns existing docs; no upload path anywhere) |
| Pre-flight only | Task 3 (rendered only in `PreFlight`) |
| Ready docs only + search box | Task 1 (`status === "ready" && text?.trim()`), Task 2 (search input) |
| Quiet count of processing docs | Task 1 (`processingCount`), Task 2 (count line) |
| Inline panel, no modal | Task 2 |
| `PICKER_DOC_SCAN_CAP = 50` in `@pikar/voice` | Task 1 Step 3 |
| Query in `voiceDoc.ts`, not `vault.ts` | Task 1 Step 4 |
| Explicit `Promise<...>` return type | Task 1 Step 4 |
| Never use `listVaultDocs` | Task 1 Step 4 (uses `by_tenant` + projection) |
| Reuse existing icons, no new dependency | Task 2 Step 1 |
| Error/empty/loading states | Task 2 Step 1 (all four branches) |
| Accessibility (§6) | Task 2 Step 1, Task 3 Step 5 |
| Trust boundary unchanged | No task modifies `startSession` or `mintClientSecret` |
| Tests: ready-only, processingCount, cross-tenant | Task 1 Step 1 (5 tests) |
| Playbook updated (§9) | Task 1 (writes the entry — also unblocks the SubagentStop hook) + Task 4 (bumps it with real results) |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step carries literal code. Test bodies are real assertions, not "write tests for the above".

**Type consistency:** `pickableDocs` returns `{ docs: { docId; title }[]; processingCount }` in Task 1 and is consumed with exactly those names in Task 2 (`data.docs`, `d.docId`, `d.title`, `data.processingCount`). `DocPicker`'s props are `{ selectedId, onPick }` in Task 2 and rendered as `selectedId={docId} onPick={onPickDoc}` in Task 3. `PreFlight`'s new props are `docId` / `onPickDoc` in Task 3 Step 1 and passed under those names in Step 3. `PICKER_DOC_SCAN_CAP` is defined in Task 1 Step 3 and used in Step 4.
