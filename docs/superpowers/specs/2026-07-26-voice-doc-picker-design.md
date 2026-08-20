# Attach a vault document from the voice pre-flight screen

- **Date:** 2026-07-26
- **Status:** Implemented and verified in canonical GSD Phase 14
- **GSD phase:** `14-flagship-voice-doc-workflow`
- **Requirements:** `DOCV-01`
- **Execution state:** `verified`
- **Canonical evidence:** [Phase 14 verification](../../../.planning/phases/14-flagship-voice-doc-workflow/14-VERIFICATION.md) · [Phase 14 closing summary](../../../.planning/phases/14-flagship-voice-doc-workflow/14-09-SUMMARY.md) · [voice playbook implementation/gate record](../../playbooks/voice.md#the-pre-flight-picker-14-10)
- **Numbering reconciliation:** This spec and its implementation plan called the picker `14-07`, but canonical GSD `14-07` already names the separate vault-entry/in-call-context work ([14-07 summary](../../../.planning/phases/14-flagship-voice-doc-workflow/14-07-SUMMARY.md)). The shipped picker is therefore recorded retroactively as `14-10` in the voice playbook; no standalone `14-10-PLAN.md` or `14-10-SUMMARY.md` exists, so Phase 14 verification is the status authority.
- **Related:** CLAUDE.md §1 (pure literals in packages), §2 (tenant wrappers), §9 (playbooks),
  §10 (BRAND), playbooks `docs/playbooks/voice.md` + `docs/playbooks/vault.md`, Phase 14 DOCV-01

## Problem

Owner report: *"I uploaded the document in the knowledge vault … but the agent still cannot access
the document. So it's asking me to upload the document in that particular voice session."*

Verified end to end. The retrieval engine is **not** at fault:

- `vaultGroundHydrated` was run live against the owner's tenant and returned the document's chunk as
  the **top hit**. Storage, embedding and search all work.
- The `voiceSessions` table carries **no `docRef` on any row**, including the session started ~1.7 h
  after the document reached `ready`.

**Root cause.** A voice session only becomes doc-scoped via `/dashboard/voice?doc=<vaultDocId>` —
the "Discuss by voice" control on a vault card or preview. Start from the voice page directly and
`voiceDoc.docScopedPassages` returns `[]` *before it searches anything*:

```ts
if (!session || session.tenantId !== tenantId || isEnded(session.status) || !session.docRef) {
  return [];
}
```

So the agent has zero vault reach and honestly says it cannot see the document. There is **no
picker, attach, or upload control anywhere in the voice route** (`ls` of the route shows
`AbnormalBriefBanner`, `DocStrip`, `LiveSession`, `PostCall`, `PreFlight`, `page`,
`useVoiceSession` — none of them offers one).

This is an anticipated gap, not a regression. `voice.startSession` already reads:

> *DOCV-01: … This is the TRUST BOUNDARY for that scope — 14-07's document picker is a courtesy, not a gate.*

The picker was never built.

## Decisions (owner-approved)

| Question | Decision |
|---|---|
| Upload a new file, or pick an existing one? | **Pick from the vault.** The document is already stored, `ready`, and retrievable — re-uploading would re-run extraction for no gain. |
| When can the user attach? | **Pre-flight only.** No mid-call attach or swap. |
| Which documents are listed? | **Ready documents only, plus a search box.** |
| Unready documents | Not listed as rows, but surfaced as **one quiet count line** ("2 documents still being read") so a just-uploaded file does not appear to vanish. |
| UI shape | **Inline panel** inside `PreFlight` — no modal, no focus trap. |

Rationale for pre-flight-only: `docRef` is written at row-insert in `startSession`, and the doc id
is *also* validated at token-mint time. Swapping mid-call would mean patching a live session row,
re-validating it, and re-instructing the realtime model mid-stream — materially more risk on a
time-capped call, for a case the owner does not currently have.

## Design

### Trust boundary is unchanged

`voice.startSession` and `voiceToken.mintClientSecret` each re-validate tenant ownership and
`status: "ready"`, throwing `voicedoc: document not found` / `voicedoc: document not ready`. The
picker only fills a value the server still checks. **No server-side validation is relaxed.**

### Data flow

```
page.tsx  ──docId state (already exists, from ?doc=)──┐
   │  onPickDoc(id | undefined)                       │
   ▼                                                  ▼
PreFlight ──▶ DocPicker ──useQuery(voiceDoc.pickableDocs)──▶ ready docs
                  │ select
                  └──▶ setDocId ──▶ useVoiceSession(docId) ──▶ start()
                                      └─ mintClientSecret + startSession({docRef})
```

`?doc=` from the vault remains the primary entry point; this is purely additive. Retrieval,
grounding, `docScopedPassages` and the live call are untouched.

`useVoiceSession` needs **no change**: `docId` is read inside `start()` (lines 340 and 418) and is
already in that callback's dependency array (line 424), so a document chosen before Start is picked
up correctly.

### Server surface — one new query

`voiceDoc.pickableDocs` — a `tenantQuery` in this lane's own module, deliberately **not** in
`vault.ts` (Phase-10-owned; keeping the change inside `voiceDoc.ts` avoids a shared-file edit).

Returns:

```ts
{ docs: { docId: string; title: string }[]; processingCount: number }
```

Implementation mirrors the existing `profileSeedDocs` precedent in `vault.ts`: `by_tenant` index →
`.order("desc")` → `.take(PICKER_DOC_SCAN_CAP)` → keep rows with `status === "ready"` and non-empty
`text` → project to id + title. `processingCount` counts the non-ready rows in the **same pass** —
no second query.

`PICKER_DOC_SCAN_CAP = 50` is a **pure literal and therefore lives in `@pikar/voice`'s
`docSession.ts`**, alongside `RETRIEVAL_CHAR_CAP` / `RETRIEVAL_MAX_PASSAGES` — the `voiceDoc.ts`
header rule is explicit: *"the pure literals … live in `@pikar/voice`'s `docSession.ts`. Do not
re-declare one here."* (CLAUDE.md §1.) 50 is one more than `profileSeedDocs`' 40 for the same
newest-first scan shape; it bounds the read against the 16 MiB cap.

It must **not** use `listVaultDocs`, which `.collect()`s whole rows including book-sized `text`;
`schema.ts` flags a 16 MiB / 32k-doc read cap, and `DocStrip` already documents that rule.

An explicit `Promise<…>` return type is required (the `voiceDoc.ts` header rule — inferred return
types on this module re-trigger the `internal`-graph circular-inference cliff).

`ponytail:` ceiling — the list scans the 50 newest documents and filters client-side. A vault whose
ready documents fall outside that window would need pagination or a real title search index (a
schema change). Note it in source; do not build it now.

### Components

| File | Change |
|---|---|
| `apps/web/app/(app)/dashboard/voice/DocPicker.tsx` | **new** — inline panel: search input, ready-doc rows, quiet count line |
| `apps/web/app/(app)/dashboard/voice/PreFlight.tsx` | accepts `docId` + `onPickDoc`; renders the paperclip toggle and the selected-doc chip |
| `apps/web/app/(app)/dashboard/voice/page.tsx` | threads its existing `docId` / `setDocId` into `PreFlight` |

No new SVGs: reuse `PaperclipIcon` (`(auth)/icons.tsx`), and `SearchIcon` / `XIcon` /
`FileTextIcon` (vault `icons.tsx`). No new dependency, no component library (§10 rule 3).
BRAND §5 already names "attach 📎" as an established composer idiom, so this is not a new pattern.

Search is a client-side case-insensitive `title` substring filter over the already-fetched capped
list. `vaultDocuments` has no search index on `title` and adding one is a schema change.

### Error handling & edge cases

| Case | Behaviour |
|---|---|
| No ready documents | Honest empty state ("No documents ready yet") + link to the vault. No fake rows (BRAND §5 "honest zeros"). |
| Search matches nothing | "No documents match" |
| Query still loading | Render nothing. `undefined` and `null` are treated identically, per `DocStrip`'s documented rule. |
| Document stops being `ready` between pick and Start | Server throws; `PreFlight` already renders `voice.error`. Existing path — no new handling. |
| Cross-tenant / missing id | `pickableDocs` is tenant-scoped; `startSession` fails closed regardless. |

### Accessibility (§6 — requirements, not suggestions)

- The paperclip is a real `<button>` with `aria-expanded` + `aria-controls` and an accessible label
  ("Choose a document to discuss") — an icon-only control must not be unlabelled.
- List rows are real `<button>`s and are **never nested inside another interactive element** — the
  vault playbook records this exact bug (invalid HTML, broken keyboard order).
- The search input has an associated label.
- Visible focus states throughout; selected state carries **text**, not colour alone.
- `--teal-600` is ~2.9:1 on white — button fills with white text only, never small teal body text.

## Testing

- `pickableDocs`: colocated convex-test — ready-only filtering, non-ready excluded from `docs` but
  counted in `processingCount`, cross-tenant returns empty.
- The title filter is a one-line `.includes()` — trivial by the ponytail rule, no test.
- `pnpm --filter @pikar/web typecheck` clean; `biome check` clean on touched files.
- `docs/playbooks/voice.md` updated in the same change, with `vault.md` touched only if the watch
  rules require it (§9 — the Stop hook blocks finishing with watched paths changed and the playbook
  untouched).

## Explicitly out of scope

- **Mid-call attach or swap.**
- **Upload-from-disk in the voice session.**
- Any change to retrieval, grounding, or `docScopedPassages`.
- **The thin-OCR extraction defect.** A 12-slide scanned deck currently extracts ~2.2k chars as a
  *summary* rather than verbatim text, because `extractPdf` sends every page as one file part in one
  call while the `attachment-extractor` skill's contract is written for a single page. Tracked in
  `vault.md` "Known gaps". A document attached through this picker still carries whatever text
  extraction produced — **this feature does not improve grounding quality.**
