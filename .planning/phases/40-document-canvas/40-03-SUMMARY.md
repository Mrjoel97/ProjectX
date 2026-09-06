---
phase: 40-document-canvas
plan: 03
status: complete
completed: 2026-09-06
commits: [see the phase-close commit — feat(40-03) / docs(40)]
requirements-completed: [DOC-01]
requirements-pending: []
---

# 40-03 — The PDF shows up where the work is, and the Office decision is written down

**Measured before (2026-09-06, tree `4b8fe5b`).** `OutputCard` self-queried the created-artifact row
and rendered its **markdown text**, never the PDF the same turn had produced; the only way to the
document was "Open full document" → the vault modal. The workspace canvas keys on a plan row and a
closed `plan.kind` with no document member, and a `createDocument` turn writes no plan row at all.
`content.ts` carried the project rule that a storage URL "is never minted for a card nobody clicked,
and never sits in a subscription", pinned for the Content shelf by `contentView.test.ts`.

**Owner decision (2026-09-06):** eager for the open thread's newest created artifact only.

**What changed.**
- **Inline PDF in `OutputCard`** (`cards.tsx`, not the canvas — the canvas is keyed on a plan row
  document turns do not have, is owned by two playbooks, and its copy is media-only). One branch in
  the preview section: when the SELECTED created document's bytes are a PDF, the browser's own
  viewer in a bare `<iframe>` at `min(70vh, 32rem)` — **one** scroll region, so a phone under 48rem
  does not nest two. The markdown text remains the fallback and "Open full document" is unchanged.
- **`vaultDocText` also returns `storedMimeType`** (metadata, riding the existing subscription for
  the same reason `status` does) so the card can tell a PDF twin from a markdown-only artifact
  without a second query.
- **The bearer-URL rule, restated once** in `content.ts` and pinned in `outputCard.test.ts`: a URL
  is minted only for a row the user is LOOKING AT — a card they clicked, or the selected created
  artifact of the thread open in front of them — and never sits in a subscription for a row nobody
  is viewing. "Only on click" was the shape; this is the property. The query is gated on **both**
  the selected id and the bytes being a PDF, so a shelf of documents still subscribes to none.
  Convex storage URLs have no expiry (`getUrl` takes no parameter), which is why where a URL is
  minted is a security property and not a rendering detail.
- **ADR-036 accepted** — "Office fidelity: PDF twin in, text projection out, `.xlsx` written". Six
  numbered decisions: the closed generation set `pdf | html | xlsx`; a PDF twin for every long agent
  document; uploads as text projection + original download, spreadsheets additionally as the capped
  `vaultSheets` grid; the un-sandboxed iframe as the PDF surface (a `sandbox` attribute disables the
  viewer plugin and frames nothing — pinned by a test, and an HTML preview must never share that
  element or policy); the bearer-URL rule; and no per-document fee. Five rejected options are named
  with the constraint that killed each: pdf.js, mammoth/docx-preview, a LibreOffice sidecar,
  client-side SheetJS, a structured field on `vaultDocuments`.
- **Close:** `DOC-01` minted + traceability row; ROADMAP Phase 40 block and `| 40. … | 3/3 |` row;
  STATE (one frontmatter block, counters, closes table, next = Phase 41).

**Verified.** `outputCard` 11/11 — the three new tests are source scans, the right shape here for
the same reason the shelf uses one: they forbid the FAILURE (a URL for a row nobody is viewing)
rather than the feature. They pin that `vaultDownloadUrl` appears exactly once in `cards.tsx` and
inside `OutputCard`, that the query is gated on both halves, and that the frame carries no
`sandbox` and one scroll bound. Writing that last test reproduced the lesson it encodes: the first
version matched the word "sandbox" in its own explanatory comment and went red on correct code, so
it now strips comments before scanning — the `xlsText` discipline, one app over. Web 888 green,
`tsc` clean in both apps, `biome --diagnostic-level=error` clean.

**Deliberately not done.** A document branch in `CanvasPane`/`MediaCanvas.tsx`; mobile work beyond
the single scroll owner; BRAND §5's specified "Synced to workspace history" subline, which the
shipped card contradicts with "Saved to your vault. Nothing was sent." — the e2e pins the shipped
copy, so it is canonical today and the discrepancy is flagged rather than changed (BRAND.md has no
playbook owner).
