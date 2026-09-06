# ADR-036: Office fidelity — PDF twin in, text projection out, `.xlsx` written

- **Status**: **Accepted** — 2026-09-06. Phase 40 (Document Canvas, `DOC-01`, merged-audit gap G5).
- **Supersedes**: nothing. This is the first decision record covering document rendering and
  Office-format fidelity; before it, the fidelity bar lived only in a source header
  (`packages/vault/src/officeText.ts`) and in the 2026-08-21 consistency audit's recommendation.
- **Does NOT supersede**: ADR-001 (Convex is the data + orchestration plane, storage included),
  ADR-013 (the render worker for video), ADR-025 (nothing agent-authored enters retrieval without
  explicit promotion) — a generated workbook is an `origin: "agent"` row like any other.
- **Evidence**: `.planning/phases/40-document-canvas/40-RESEARCH.md` (measured 2026-09-06, tree
  `4b8fe5b`); `.planning/design/consistency-audit-2026-08-21.md` §"Documents in their true form";
  the four owner decisions of 2026-09-06 recorded in that research note's §6.

## Context

The system generates documents and ingests them, and until this phase it could show almost none of
them in their real form.

**What it wrote.** `DocFormat` was `pdf | html`. The PDF renderer is home-grown over pdf-lib
(`markdownToPdf`), and every agent-authored long document already stored a PDF beside its markdown
— `createDocument({form:"long"})`, the pack deliverable path, and the dashboard report pack all do
it. The SheetJS *writer* had shipped inside `@pikar/vault` since Phase 15.2 and no production code
ever called it.

**What it showed.** The browser's own viewer, in a bare `<iframe>` over a storage URL, in exactly
one place: the vault preview modal. The workspace canvas answers "No image or reel in this thread
yet" for any document, and the card that renders an agent's document showed its markdown text and
never the PDF the same turn had produced.

**What it read.** Uploaded Office files are flattened to text at ingest: DOCX through a paragraph
walk, PPTX through slide runs, and a workbook to tab-separated cells labelled `Sheet 1`, `Sheet 2`
by file number. That projection is the artifact of record for search and grounding, and it is
lossy on purpose. A spreadsheet therefore reached the reader as a `<pre>` of tabs — the one format
whose whole meaning is its shape.

Nothing in the requirements, roadmap or decision record covered any of this. Four things had to be
decided together, because each one is only defensible in the light of the others.

## Options

| Option | Rejected because |
|---|---|
| **pdf.js / react-pdf** in the browser | A dependency for what the browser already does natively, on a repo with no component library and a standing rule against adding one unasked. The shipped iframe has no fidelity argument to lose. |
| **mammoth / docx-preview / a pptx renderer** | Nothing is installed, in-browser Office rendering is heavy, and its fidelity is an argument without end — a document that renders *almost* right is worse than one honestly shown as text plus its original. |
| **A LibreOffice conversion sidecar** | Already rejected by the stack research for generation; it is a second runtime to operate, secure and pay for, and it would exist to serve two formats nobody has asked to receive. |
| **Client-side SheetJS for the grid** | ~1 MB into the browser bundle, and it contradicts the rule that keeps SheetJS out of the V8 runtime (`packages/vault/src/index.ts`: the parsers are subpath-only so they enter node actions alone). |
| **Re-parse the original workbook on demand** | Every open would re-download up to the 200 MB upload cap and re-unzip inside the action clock, with no cache. |
| **A structured grid FIELD on `vaultDocuments`** | The vault's read bound counts `vaultDocuments.text` bytes to stay under Convex's per-transaction cap. A second large blob on that row slips past a bound that cannot see it. |

## Decision

1. **The generation set is closed: `pdf | html | xlsx`.** There is no DOCX and no PPTX output, and
   no argument anywhere that could ask for one. `formatSpec` in `@pikar/core` remains the single
   place the extension and MIME literals are written, and every badge and filename derives from it.
2. **A long agent-authored document carries a PDF twin at creation.** This was already the shipped
   behaviour at three call sites; it is now a rule. Short-form content and `html` attachments get
   no twin — there is nothing a page of ad copy gains from one.
3. **An uploaded Office file is shown as its text projection plus its original.** The text stays
   the artifact of record (searchable, groundable, capped, honesty-flagged when truncated) and its
   shape is unchanged by this ADR. A **spreadsheet** additionally gets a structured grid, read from
   a separate `vaultSheets` table written at ingest: capped in rows, columns, sheets and bytes,
   carrying `totalRows` and `sheetCount` so the reader is told in words what is not shown. The grid
   is a VIEW — a missing row means "no grid", never "no document", and a failed structured read
   never fails an ingest.
4. **The PDF surface is the browser's own viewer in an un-sandboxed `<iframe>`.** A `sandbox`
   attribute disables the viewer plugin and frames nothing, so the attribute is deliberately absent
   and its absence is pinned by a test. An HTML-artifact preview, when it is built, must NOT share
   that element or its policy: HTML needs `sandbox` + `srcDoc` precisely because it is model-authored
   markup, and a PDF needs the opposite.
5. **A storage URL is minted only for a row the user is looking at.** Convex storage URLs do not
   expire, so a URL is a durable bearer capability. It may be minted for a row the user clicked, or
   for the selected created artifact of the thread open in front of them (the cockpit's inline
   PDF); it must never sit in a subscription for a row nobody is viewing. This restates the older
   "only on click" rule as the property it was protecting.
6. **No per-document fee.** A generated document costs the hosting agent turn's tokens, as the PDF
   path always has. Spreadsheets add no new money movement.

## Consequences

- The `officeText` flatten bar stops being a source comment and becomes a decision: text is the
  contract, and its exact shape (tab cells, newline rows, `Sheet N` labels) is pinned by tests that
  this ADR now explains.
- `DocFormat` is the set every label derives from — the Output card's badge, the Content shelf's
  bytes label, the attachment filename. A new format is a change here, in the tool schema, and in
  the agent's own registry body (ADR-007: a granted capability must be TAUGHT), which makes it a
  skill version and an eval-gated activation, not a code edit.
- `regenerateAttachment` now rebuilds an attachment in the format it already had. Before this it
  passed no format, so revising an html or xlsx attachment silently converted it to a PDF.
- `vaultSheets` is additive and tenant-owned: it exports and deletes with its tenant, and its row
  dies with the document it describes.
- A spreadsheet drafter is a separate registry skill rather than a wider `document-drafter`, because
  a spreadsheet's rules are the opposite of a document's (header row, plain numbers, one fact per
  cell, no prose, no formulas) and because `document-drafter` is eval-gated with no fixture that
  reaches the drafting path.
- **What would supersede this**: a tenant who needs to RECEIVE `.docx` or `.pptx` (not read one), or
  an Office viewer that costs neither a dependency nor a runtime. Either would be a new ADR.
