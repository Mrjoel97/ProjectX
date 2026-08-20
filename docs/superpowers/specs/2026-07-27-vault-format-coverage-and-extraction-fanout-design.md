# Vault: Universal Format Recognition + Extraction Fan-Out

> Status: IMPLEMENTED AND VERIFIED — canonical GSD Phase 15.2
> Date: 2026-07-27
> Subsystem: Knowledge Vault (`docs/playbooks/vault.md`)
> GSD phase: `15.2-vault-universal-format-recognition-and-extraction-fan-out`
> Requirements: owner-approved design contract `SC#1`–`SC#7` (no standalone `REQUIREMENTS.md` ID)
> Execution state: `verified` (`passed_with_observations`)
> Evidence: [15.2 closing summary](../../../.planning/phases/15.2-vault-universal-format-recognition-and-extraction-fan-out/15.2-08-SUMMARY.md) · [15.2 verification](../../../.planning/phases/15.2-vault-universal-format-recognition-and-extraction-fan-out/15.2-VERIFICATION.md)
> Remaining observation: a real Excel-authored date-cell rendering remains unobserved; this is non-blocking and the legacy XLS numeric extraction was live-approved.
> Phase 2 (folders, 1.5 GB uploads, folder-level comprehension) is deliberately OUT of scope —
> see [Out of scope](#out-of-scope).

## 1. Problem

The owner reported the vault "reading a document for more than ten minutes". Three distinct
defects were found; only the first is the reported one.

### 1.1 The reported defect — silent eternal pending (CONFIRMED live)

The live `vaultDocuments` row, read off the deployment on 2026-07-27:

```
created           status              mimeType                                    bytes  textChars  rag  failureReason
2026-07-26T21:33  pending_extraction  application/vnd.ms-excel.sheet.macroEnabled.12  803281   0     -    (none)
2026-07-26T18:18  ready               ...spreadsheetml.sheet                      38745   38729    Y    -
```

The file is a **macro-enabled Excel workbook (`.xlsm`)**. It was never processed — 0 characters,
no rag entry, no failure reason, ~20 hours after upload. The row directly below proves the Office
rail is healthy: a plain `.xlsx` extracted 38,729 chars and reached `ready`.

Root cause — `packages/vault/src/extractKind.ts`:

```ts
const OFFICE_MIME = new Set([...docx, ...xlsx, ...pptx]);
const OFFICE_EXT  = /\.(docx|xlsx|pptx)$/i;

export function extractionKindFor(mimeType, filename) {
  ...
  if (OFFICE_MIME.has(mimeType) || OFFICE_EXT.test(filename)) return "office";
  ...
  return null;   // ← .xlsm lands here
}
```

`extractionKindFor` returns `null`, so `vaultUpload` schedules no extraction action, and the row
parks at `pending_extraction` **permanently**. The UI renders that as a "reading…" pill forever.

Two failures, not one:

- **Surface:** the allow-list is an enumeration of MIME strings and will always be incomplete.
  This repo already carries a second bug from the same cause (playbook, 2026-07-25: Windows sends
  an empty MIME type for `.md`, so the cockpit rejected a supported file).
- **Structural:** `null` has no terminal state. *Any* unrecognized format becomes an eternal
  pending row with no error. `pending_extraction` and `extracting` have **no watchdog** — only
  `processing` got one, after the 2026-07-20 stranding incident.

### 1.2 Scanned PDFs extract a summary, not verbatim text (CONFIRMED live)

```
2026-07-26T12:54  ready  application/pdf  2161 chars
                  failureReason: extract_error: The operation was aborted due to timeout
```

2,161 characters for a 12-slide deck. Already documented in the playbook's Known gaps:
`extractPdf` sends **all pages as one file part in one call**, but the `attachment-extractor`
skill's contract is written for "a single image or document (PDF page…)". Given many pages at
once the model digests instead of transcribing, despite an explicit "extract ALL of it VERBATIM /
Never summarize" instruction. The prompt is correct; the **call shape** is the defect.

That same row also shows a third, cosmetic bug: it is `ready` but still carries the
`failureReason` from the attempt before its successful retry. A healthy document reports an error.

### 1.3 `extractGraph` has no input cap (LATENT — not the reported defect)

`vaultLlm.ts:132-139` passes the whole document as `prompt: safeText` to gpt-4o-mini (128k
context) with a 45s timeout and no truncation, while every other model call in the repo caps its
input (`PER_DOC_CHAR_CAP`, `TOTAL_CHAR_CAP`, `HISTORY_CHARS_PER_MESSAGE`, `BODY_TRUNCATE_CHARS`).

Evidence bounds the severity: a **254,345-char PDF reached `ready`**, so the extractor handles a
quarter-million characters of prose fine. The risk is at the `VAULT_EXTRACT_CHAR_CAP` (400k)
ceiling with token-dense content (tab-separated numerics run ~2–2.5 chars/token vs ~4 for prose,
so 400k chars can exceed the context window). Cheap insurance, not a headline.

### 1.4 Investigated and ruled out

`@pikar/pii` `scanText` was hypothesised as a quadratic bottleneck (the playbook records a
quadratic note from Phase 3.8 Lane 4). **Measured false** — a reproduction against the real
function: 400k chars of prose scans in **8 ms**; 112k chars of tab-joined spreadsheet rows in
**4 ms**. Not a factor. Recorded here so it is not re-investigated.

## 2. Goals

1. **`.xlsm` and every common business document format is read and understood.**
2. **No document ever parks silently again.** Every non-terminal status reaches a terminal one.
3. **Recognition is content-based**, so a correct file with a wrong or absent MIME type works.
4. **Scanned PDFs extract verbatim text**, preserving structure, within one action's limits.
5. The owner's existing stuck `.xlsm` is **retroactively recovered**, not just newly-uploadable.

### Non-goals

Promising "every file type" would be false the first time someone uploads a CAD file. The honest
guarantee is: every **document / office / text / image / A-V** format below is read; anything else
is stored, downloadable, previewable, and **fails within seconds with a plain-language reason**.

## 3. Architecture

Five changes. Each is independently shippable and independently verifiable.

### A. Content-based recognition — `packages/vault/src/sniff.ts` (NEW, pure, no dependency)

Replace MIME-string matching with magic-byte container detection.

```ts
export type Container = "zip" | "ole2" | "pdf" | "rtf" | "text" | "binary";
export function sniffContainer(bytes: Uint8Array): Container;
```

| Container | Magic | Resolves to |
|---|---|---|
| `pdf` | `%PDF` (scan first 1 KiB — leading junk is legal) | PDF rail |
| `zip` | `PK\x03\x04` / `PK\x05\x06` / `PK\x07\x08` | OOXML, ODF, EPUB — discriminated by entries (§B) |
| `ole2` | `D0 CF 11 E0 A1 B1 1A E1` | legacy `.doc` / `.xls` / `.ppt` |
| `rtf` | `{\rtf` | RTF stripper |
| `text` | valid UTF-8, ≥95% printable in first 4 KiB | pass-through |
| `binary` | none of the above | terminal `failed("unsupported_format")` |

`extractionKindFor` gains the sniffed container as an **override** ahead of the MIME/extension
checks, which remain as a fallback. Content wins over what the browser claims.

> Why this is also the *lazier* option: ~20 lines replace a list requiring perpetual maintenance,
> and it fixes `.xlsm`, `.docm`, a renamed `.xlsx`, and MIME-less Windows uploads in one change.

### B. Format coverage

**`extractOfficeText` loses its `mimeType` parameter.** It unzips once and dispatches on the
*entries it finds* — self-identifying, and every ZIP-based format is covered by construction
rather than by enumeration. This is a net simplification of the current signature.

| Marker entry | Format | Extraction |
|---|---|---|
| `word/document.xml` | DOCX, **DOCM** | existing path, unchanged |
| `xl/workbook.xml` | XLSX, **XLSM** | existing path, unchanged |
| `ppt/presentation.xml` | PPTX, **PPTM** | existing path, unchanged |
| `mimetype` = `...opendocument.text` | **ODT** | `content.xml` → `<text:p>` / `<text:h>` |
| `mimetype` = `...opendocument.spreadsheet` | **ODS** | `content.xml` → `<table:table-row>` → `<table:table-cell>` |
| `mimetype` = `...opendocument.presentation` | **ODP** | `content.xml` → `<draw:page>` → `<text:p>` |
| `META-INF/container.xml` | **EPUB** | XHTML entries, name-sorted, tag-stripped |

All ODF/EPUB walkers reuse the existing `runsOf()` + `decodeEntities()` helpers. `fflate` is
already a dependency. **No new dependency for this tier.**

| Non-ZIP format | Extraction | Dependency |
|---|---|---|
| **RTF** | strip `{\*\…}` groups + `\control` words, unescape `\'hh` | none |
| **HTML / XML** | drop `<script>`/`<style>` bodies, strip tags, decode entities | none |
| **JSON / YAML / TSV / LOG** | pass-through (added to the searchable MIME set) | none |
| **DOC, PPT** (legacy OLE2) | printable-run sweep, CP1252 + UTF-16LE, min run 4, OLE2 stream-name stop-list | none |
| **XLS, XLSB** (legacy OLE2) | SheetJS `read` → `sheet_to_csv` per sheet | **SheetJS** |

**Why `.doc`/`.ppt` need no parser but `.xls` does:** Word and PowerPoint store text *as text*, so
a printable-run sweep recovers the body. BIFF stores numbers as **binary doubles**, so a sweep
would recover column headers and silently lose every number — worse than failing, because it fails
plausibly. `.xls` therefore gets a real parser.

**SheetJS installation.** Pinned tarball from `https://cdn.sheetjs.com/` (the vendor's official
distribution channel), **not** npm `xlsx@0.18.5`, which is the last registry publish and carries
CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS). Owner-approved 2026-07-27. It
lives behind its own subpath module so it is pulled only into the node action that needs it,
preserving the existing bundle discipline (`officeText.ts` is subpath-only specifically to keep
`fflate` out of the V8 bundle).

*Considered and rejected:* consolidating all spreadsheet handling onto SheetJS and deleting the
fflate XLSX path. It would remove code, but adds ~1 MB to a bundle that is deliberately lean, and
the existing path is shipped and tested. Revisit if the two paths ever diverge in behaviour.

### C. Never-silent failure

1. **At the `vaultUpload` chokepoint:** no resolvable extraction kind → `markFailed("unsupported_format")`
   immediately. Never left `pending_extraction`.
2. **Extraction-phase watchdog:** a scheduled sweep flips rows stuck in `pending_extraction` or
   `extracting` to `failed("extraction_stalled")`. Threshold: **15 minutes** since `createdAt` —
   comfortably above the worst legitimate run (the 480 s `CALL_TIMEOUT_MS` plus the 10-minute
   action ceiling bound any single honest attempt), so it can never kill live work. This is the
   same guarantee `onIngestComplete` gives `processing`, extended to the two statuses that never
   got one. *This is the root-cause fix; the format coverage above only reduces how often it fires.*
3. **`markReady` clears `failureReason` and `extractionTruncated`**, so a successful retry stops
   reporting a stale error (§1.2).
4. **UI:** `DocGrid` / `PreviewModal` render `unsupported_format` as plain language plus the
   remedy, reusing the existing failed-card Retry affordance shell.

Recovery of the owner's stuck row rides `vaultSweep.sweepPendingExtraction`, which re-dispatches
`pending_extraction` rows with a now-recognized kind. No new migration.

### D. Per-page fan-out for scanned PDFs

`extractPdf`'s hosted-OCR branch slices to 1-page PDFs with `pdf-lib` `copyPages` (already used
for the page cap, already a **static** import per Pitfall 9) and extracts pages in
**bounded-concurrency batches** of ~6, sequential across batches, reassembled in page order.

This matches the `attachment-extractor` skill's documented single-page contract, so it needs **no
new skill row and no prompt change** (§5 satisfied by reuse). Text-layer PDFs are untouched —
`unpdf` already returns the complete text layer, free.

Budget: at ~10 s/page and a batch size of 6, the 50-page `VAULT_EXTRACT_PAGE_CAP` completes in 9
batches ≈ 90 s, well inside the 480 s `CALL_TIMEOUT_MS` and the 10-minute action ceiling. Per-page spend is summed and
recorded through the existing `priceUsage` → `recordSpend` path.

> `ponytail:` batching inside one action, not a workflow — 50 pages fit. Beyond the page cap this
> needs a durable workflow or the (already-installed) `@convex-dev/workpool`. Named, not built.

### E. `extractGraph` cap

Cap the extractor prompt at a new `GRAPH_EXTRACT_CHAR_CAP` (~120k chars ≈ 30k tokens), well
inside the 128k window for token-dense content.

> `ponytail:` head slice, not chunk-wise fan-out. Entities in the tail of a very long document are
> missed. Upgrade path is chunk-wise extraction with node/edge union — deferred until entity
> recall is actually observed to suffer, since the 254k-char row shows current behaviour works.

## 4. Data model

**No schema change. No migration.** `failureReason` already exists; `unsupported_format` is a new
value in an unconstrained string field. The `status` union is unchanged — "stored but unreadable"
is `failed` + reason, not a new state.

## 5. Verification

Following the existing convention: **no binary fixtures in the repo** — every fixture is built
in-test.

| Change | Check |
|---|---|
| A — sniff | `packages/vault` unit: one case per container magic; a `.xlsx` renamed `.dat` resolves correctly; an empty-MIME upload resolves correctly |
| B — ZIP formats | fixtures via `fflate` `zipSync` (the precedent Lane 2 set); one determinism assertion per format |
| B — legacy XLS | fixture written **by SheetJS itself** (`XLSX.write(wb, {bookType:'xls'})`), asserting numbers survive — the specific failure a text sweep would cause |
| B — legacy DOC/PPT | synthesized OLE2 byte buffer in-test |
| C — never-silent | convex-test: unrecognized upload reaches `failed` **without** passing through `pending_extraction`; watchdog flips a stale `extracting` row; `markReady` clears `failureReason` |
| D — fan-out | offline: page count → batch count/order; reassembly is page-ordered. Hosted branch observed via the unseeded registry's fail-closed `NO_ACTIVE_SKILL` (existing precedent — no model call in tests) |
| E — cap | over-cap input is truncated before `generateObject` |
| **Live gate** | Re-run `vaultSweep:runSweep` on the owner's deployment; **the stuck `.xlsm` reaches `ready` with non-zero `textChars`.** This is the phase gate — offline green does not close this phase (Pitfall-1 class: only the deployed run proves it). |

Windows note (playbook): convex-test files false-red on parallel-fork teardown; re-run
`--maxWorkers=1` before trusting a red.

## 6. Definition of done

- `docs/playbooks/vault.md` updated in the same commit, `Last verified` bumped (§9).
- New `packages/vault/src/sniff.ts` covered by `watch.json`'s existing `packages/vault/` prefix — no
  registration needed.
- SheetJS pinned exactly, no `^` (§6 discipline for a non-registry dependency).
- Live sweep run and its result recorded in the playbook.

## 7. Coordination — Phases 16 and 17 are live

Per `.planning/PARALLELIZATION.md`, Lane R (16 — research) and Lane K (17 — calendar) are running
in worktrees. **Lane R stores web research in the vault**, so `vault.ts` is a plausible overlap.
Files this spec touches: `packages/vault/*`, `vaultExtract.ts`, `vaultSweep.ts`, `vault.ts`
(upload chokepoint), `vaultLlm.ts`, the vault UI.

This work must be an **explicitly contracted third lane or an inserted phase after 16/17 land** —
not an improvised parallel session. The shared-singleton discipline (`STATE.md`, `ROADMAP.md`,
`vault.md`) applies. Decision required before implementation begins.

## 8. Out of scope

Deferred to **Phase 2 — Vault Folders & Folder-Level Comprehension**, which builds on the fan-out
orchestration this spec creates:

- User-created folders (`vaultFolders` table + optional `folderId` — new table, new optional
  field, no migration), with add / remove / replace.
- Folder upload at 1–1.5 GB with a per-kind file cap raise to 200 MB. **Sequenced after this spec**
  because the current per-file ceiling is bounded by what one action can hold in memory (a known
  gap in the playbook at the *current* 100 MiB cap); the fan-out is what makes the raise safe.
  Video stays at 25 MB — an external transcription-API limit, not our choice.
- Document identity classification (a `.xlsm` recognised as "2025 P&L", not just "a spreadsheet").
- Folder-level synthesis. The lazy shape: the folder digest **is itself a vault document**, so it
  embeds, graph-extracts, and grounds through machinery that already exists.
- Folder-scoped UI drill-in reusing `PreviewModal`.
- Google Docs / Sheets / Slides via the Drive export API — a distinct rail (no bytes to upload).
  The `google-docs` category and `source: "google"` already exist as the seam.
- Per-folder budget estimate and reservation before upload. **Important:** every ingest opens with
  `guardrails.preCall`, which enforces a daily budget. A large folder can trip it mid-run, leaving
  half the documents `failed` — and a half-ingested folder is worse than a refused one, because
  the agent grounds confidently on the half it got.

### An SLO correction to carry into Phase 2

"1.5 GB understood in 5 minutes" is not achievable and the bottleneck is not agents: 1.5 GB across
a typical 25 Mbps business uplink is **~8 minutes of byte transfer before any processing starts**.
The target must be **time-to-first-useful, not time-to-complete** — the folder becomes queryable
progressively as documents turn `ready`, with an honest N-of-M surface. That is both achievable
and the better product.
