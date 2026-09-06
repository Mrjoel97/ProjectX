# Phase 40 — Document Canvas (G5) — RESEARCH

- **Measured**: 2026-09-06, tree `4b8fe5b` (main, Phase 39 closed). Five-agent measured pass (four seams
  + one adversarial verify) over the generation, display, ingest and decision planes; every claim below
  was read at the cited span, and the four claims the verifier refuted are corrected in §5.
- **Trigger**: merged rev-5 audit §5 Track C step 11 → 39-RESEARCH §3/§5: "40 Document Canvas — the
  08-21 audit's steps 1–2 + the Office-fidelity ADR (step 3)". The 08-21 audit's words (its §"Documents
  in their true form", line 134): **PDF inline now** (signed URL + iframe already works in the vault
  modal; give the canvas and the output card a document branch), **spreadsheets as grids** (render rows
  and columns instead of a text dump; the installed SheetJS writer unlocks real `.xlsx` deliverables),
  **DOCX/PPTX honestly** (PDF twin at creation, extracted text + original download for uploads, recorded
  in an ADR either way).
- **Status**: research only — no code. BRAND.md §§2–6, 8 read first (binding: cards not dense
  tables-on-white; *structured reports* with aligned columns and no gridlines are the intended pattern,
  "cramped spreadsheets are not"; amber is the approval gate's alone; meaning never in colour alone; no
  component library without asking; honest empty states).

## 1. What exists today, plane by plane

### 1.1 Generation (backend) — three siblings, one renderer, two formats

- `DocFormat = "pdf" | "html"`; `FORMAT` (ext + MIME) and `formatSpec()` are the ONE place the MIME
  literals live (`packages/core/src/documentGen.ts:16-24`); `buildDocFilename` derives the extension from
  it; `PLAN_ATTACHMENT_CAP_BYTES` = 8 MiB is the only size guard (`:234-266`). Pinned exactly
  `{pdf, html}` by `documentGen.test.ts:144-149`.
- The PDF renderer is home-grown `markdownToPdf` over pdf-lib 1.17.1 (Standard-14 Helvetica, US-Letter,
  dates pinned to epoch for byte-determinism) in `packages/backend/convex/llm.ts:6853-6862`; **four**
  callers — `renderAndStore` (`:2177`), `saveMarkdownDocument` (`:665`), `createDocument` long form
  (`:4090`) and `reportPack.ts:24,58` (dashboard-pages.md's file, not cockpit.md's).
- **`generateAttachment({topic, format?})`** — the email-plane deliverable. JSON-schema `enum:
  ["pdf","html"]` (`llm.ts:2694-2712`) → `renderAndStore` (`:2139-2208`): `scanText(topic)` →
  `internal.llm.draftDocument` (registry skill `document-drafter`, returns `{title, markdown}`) →
  `format === "pdf" ? markdownToPdf : TextEncoder(renderHtmlDocument)` → filename → byte cap →
  `formatSpec(format).mimeType` → `ctx.storage.store` → `plans.recordAttachments`. Render throw or
  over-cap writes `attachmentError`, and `proposePlan` refuses while it is set (`:2814-2820`).
  `regenerateAttachment` passes **no format** (`:2746`) — an html attachment regenerates as a PDF.
- **`createDocument({topic, form})`** — the vault-plane artifact: `vault.insertCreatedDoc` with
  `mimeType` LOCKED `text/markdown` and `storedMimeType: storageId ? "application/pdf" : undefined`
  (`vault.ts:1328-1336`; pinned `createdDocs.test.ts:372,412`, `reportPack.test.ts:236`). Its tool
  description promises "markdown and a PDF — never PowerPoint, Word or slides" (pinned by
  `outputCard.test.ts`). **`saveAsDocument`** (packs) → `saveMarkdownDocument`, PDF only.
- Every attachment/document row carries `mimeType` as an OPEN `v.string()` (`schema.ts:796-808`
  plans.attachments; `:1846-1857` attachments; `:1987-2007` vaultDocuments). The closed set lives only in
  core `FORMAT` + the tool enum.
- Delivery passes MIME through verbatim: `executePlan` copies `plan.attachments` into the `attachments`
  table and every recipient's `requests.attachmentRefs` (`cockpit.ts:1255-1291`); `buildMime` writes
  `Content-Type: ${a.mimeType}; name=` per part (`gmail.ts:130-137,196-207`). **No mail change for a
  new format.** Graph refuses raw MIME > 3 MiB (`graph.ts:29-35,95-96`); Gmail has no cap of its own.
- Cost: the drafter's `generateObject` usage is never priced (`llm.ts:6339-6363`); an attachment costs
  the hosting loop's tokens only. The one non-token fee precedent is the `web_search_fee` row
  (`:4955-4970`). There is no document constant in `@pikar/cost`.
- **SheetJS 0.20.3** (CDN tarball, CVE-clean; npm 0.18.5 is not) is a RUNTIME dep of `@pikar/vault` and a
  devDependency of backend (`packages/vault/package.json:20`, `packages/backend/package.json:67`).
  Production imports it in exactly one place, `packages/vault/src/xlsText.ts` (READ path for legacy
  .xls/.xlsb); the **writer is used only by two test files to build fixtures**. `@pikar/vault`'s exports
  map is `"./*": "./src/*.ts"` (`package.json:6-9`), so a new `packages/vault/src/xlsxWrite.ts` is
  importable as `@pikar/vault/xlsxWrite` with no package.json change; `llm.ts` is `"use node"` so a
  static import there is legal (the V8 rule forbids only the barrel, `index.ts:31-35`). The
  static-import tripwire (`xlsText.test.ts:173-190`) records that 0.20.3 survived BOTH import forms — the
  static form is discipline against a future bump, not a measured breakage (that was pdf-lib).
- Skill registry facts that bind the design: `document-drafter` and `cockpit-agent` are **GATED** — a body
  edit mints a candidate that needs a passing eval (`skills.ts:770,855-866`); a **new** skill name is
  inserted at v1 `active` with no gate (`:836-846`). That asymmetry is exactly why Phase 18 added
  `content-drafter` instead of editing `document-drafter` (comment at `:766-772`). The cockpit-agent body
  says "`generateAttachment` takes a plain-language topic and adds one PDF to the plan"; the
  document-drafter body says "Keep tables to 2–4 columns so they fit the page" and "Do NOT use images,
  links, or code fences".

### 1.2 Display (web) — the PDF is one click away, the sheet is a `<pre>`

- **Workspace.** `CanvasPane` (behind "Open canvas") keys on `plans.byThread` → `plan.kind`; anything not
  `media` renders the literal "No image or reel in this thread yet…" (`MediaCanvas.tsx:2462-2474`).
  `plans.kind` is a closed union with **no document member** (`schema.ts:919-927`) and a `createDocument`
  turn writes **no plan row** (`cards.tsx:3240-3241`). `MediaCanvas.tsx` has two playbook owners
  (cockpit.md + media.md) and a source-scan pin requiring the exact substring `plan?.kind !== "media"`
  after `proposalRefusal` (`mediaCanvas.test.ts:1364-1379`).
- **`OutputCard`** (`cards.tsx:2636-2725`) is the panel-protocol card: self-queries
  `vaultSources.byThread {role:"created"}`, shows caps label, `FORM_LABEL` badge (`DOCUMENT|POST`),
  the line "Saved to your vault. Nothing was sent." (pinned by e2e `cockpit-created-document.spec.ts:60`,
  which makes the shipped copy canonical over BRAND §5's "Synced to workspace history"), then a preview
  `<section>` that renders `MarkdownDocument` over `vaultDocText` (max-height 32rem) — **never the PDF**,
  never a download; "Open full document" opens `PreviewModal` in place. This section is the "one branch
  in one card".
- **Plan attachments** render in `PlanCard` as `<a href={signedUrl} target=_blank>` filename + size via
  `api.plans.attachmentUrls` (`cards.tsx:165-228`); no preview.
- **`PreviewModal`** (vault): `displayMime = storedMimeType ?? mimeType`; `binaryMediaKind` gives the
  native viewer to image/*, video/*, and **exactly** `application/pdf` (`previewState.ts:47-52`, pinned
  `:103` "only application/pdf gets the viewer"). The PDF branch is a bare `<iframe src={mediaUrl}>` — no
  `sandbox` attribute — 70vh with text beneath, else 100% (`PreviewModal.tsx:359-372`). `ready-text`
  renders `MarkdownDocument` only when `doc.mimeType === "text/markdown"`, else a `<pre>` with a
  1500-char excerpt and "Show full text" (`:276-307`). Download re-queries `vaultDownloadUrl` on click.
- **`vaultDownloadUrl`** = tenant check + `ctx.storage.getUrl` (`vault.ts:652-659`). Convex's own typing
  documents no expiry and no signing parameter — the URL is a **durable bearer capability**. The project
  rule in `content.ts:165-170` ("a bearer capability is never minted for a card nobody clicked, and never
  sits in a subscription") is pinned by `contentView.test.ts:385-389` (`vaultDownloadUrl` appears exactly
  once in ContentView, inside `ImageThumb`).
- **No CSP, no `headers()`, no X-Frame-Options** anywhere in `apps/web` (`next.config.ts:1-8`); nothing
  blocks an iframe to storage. The risk runs the other way: a bare `sandbox` attribute disables the
  browser's PDF plugin and renders an empty frame.
- **`MarkdownDocument.tsx`** (120 lines): h1–h3, ul, ol, pipe tables (`.markdown-table-scroll` +
  `<th scope=col>`, CSS at `globals.css:1975-2075`), paragraphs, bold. Drops links, images, code,
  italics, blockquotes, nesting. It shares `tokenizeMarkdown` with the PDF/HTML exporters
  (dashboard-pages.md forbids a second parser). No `dangerouslySetInnerHTML` in the app.
- **Mobile** is code, not BRAND: `SplitPane` shows one pane under 48rem with "Show work"/"Back to chat";
  the vault grid stacks. A 70vh iframe inside a 32rem scrolling section nests two scroll regions on a
  phone.
- No table/grid component exists (six ad-hoc `<table` sites); `apps/web` has no pdf/xlsx/markdown/
  sanitizer dependency.

### 1.3 Ingest (vault) — the original is kept, the text is the only projection

- XLSX/XLSM do **not** use SheetJS: `officeText.xlsxText` is an fflate unzip + regex walk keeping only
  cached `<v>` values, cells `\t`-joined, rows `\n`-joined, sheets labelled `Sheet N` by file number
  (`officeText.ts:69-93`). Sheet names, types, number formats, merges, rich-text runs are dropped; no
  row/sheet cap in the walker. **Exact output shape pinned**: `Sheet 1\nAlpha & Co\t42\nBeta\t3.14`
  (`officeText.test.ts:78-105`). Legacy .xls/.xlsb via SheetJS `sheet_to_csv({FS:"\t"})` and ODS via
  `content.xml` produce the **same shape** (`xlsText.ts:63-90`; `officeText.ts:203-264`).
- DOCX → `<w:t>` runs per paragraph; PPTX → `<a:t>` runs per slide + chart cached values + notes; PDF →
  unpdf text layer, else OCR fan-out ≤ 50 pages via gpt-4o-mini (`vaultExtract.ts:275-317`).
- The original bytes ARE kept (`storageId` from the browser's direct upload, `vault.ts:214-297`) and a
  **download-original path already ships** (`vaultDownloadUrl` + `PreviewControls` "Download original"
  when `hasStoredBytes`). After ingest the row's `size`/`contentHash` describe the TEXT, not the file
  (`vault.ts:1403-1423`, pinned `vault.test.ts:418-456`) — a grid header must not read `doc.size` as the
  workbook size.
- Text is capped at 400,000 chars (`VAULT_EXTRACT_CHAR_CAP`) with `extractionTruncated`; `vaultDocText`
  returns it **uncapped** (`vault.ts:579-584`). Downstream consumers (RAG, ground, digest, graph,
  classifier) treat `text` as an opaque string — nothing greps for `\t` or `Sheet N` — so a structured
  copy would be additive, but the row already holds up to 400k chars under Convex's ~1 MiB row limit and
  the 8 MiB grid read budget (`constants.ts:44,56`).
- **Workbooks are already in tenants' vaults**: the onboarding upload accepts `.xlsx`/`.pptx`
  (`onboarding/page.tsx:27-44`), the vault Dropzone rails on magic bytes, and Drive Sheets are exported as
  XLSX (`vaultDrive.ts:94-118`). A sheet grid must serve those rows, not only future deliverables. The
  cockpit composer's intake list does NOT accept xlsx (`IntakeControls.tsx:32`).

### 1.4 Decisions, requirements, hooks

- No ADR covers PDF rendering, Office viewing, Office generation, or the flatten fidelity bar (only the
  `officeText.ts:1-9` header states it). Next ADR number is **036** (`NNN-<slug>.md`; ADRs never edited
  after acceptance; conventions in `docs/README.md:42-47`).
- No `DOC-*` requirement exists. RSCH-01 (minted 2026-09-06) is the exemplar block + traceability row;
  `check-planning.mjs:110-124` requires the row to read Complete at close or the checkbox to carry
  `(open: …)`.
- Ownership (watch.json): `documentGen.ts`, `llm.ts`, `cards.tsx`, `plans.ts`, `cockpitTools.test.ts`,
  `toolRegistrySnapshot.test.ts` → **cockpit.md**; `packages/vault/`, `vault.ts`, `vaultExtract.ts`,
  `apps/web/…/vault/` → **vault.md**; `MarkdownDocument.tsx`, `content/`, `reportPack.ts` →
  **dashboard-pages.md**; `MediaCanvas.tsx` → media.md AND cockpit.md; `schema.ts` → `_unassigned` (no
  forcing function); `BRAND.md`, `globals.css`, `next.config.ts` → no owner.

## 2. Corrections to the record (verified against source)

1. 39-RESEARCH §3 "HTML has a sandboxed preview" is **false at this HEAD**: zero `srcDoc`/`sandbox=` under
   `apps/web/app`; the growth-surfaces §3.1 prescription is unimplemented; `text/html` bytes are reachable
   only as a `PlanAttachments` link.
2. 39-RESEARCH §3 "documents already have vaultDocuments rows keyed by `sourceThreadId`": the field exists
   but there is **no index** on it (`schema.ts:2149-2183`; the `by_tenant_source_turn` index at `:469`
   belongs to `tenantSkills`). The only indexed thread→doc path is `vaultSources.byThread role "created"`
   → `docIds` — which is what OutputCard already uses.
3. 08-21 audit "DOCX/PPTX preview says no inline preview, download the original": an extracted row has
   `text`, so it lands in `ready-text` and shows the flattened text; `unsupported` is only for bytes with
   no text.
4. **Two of the three halves of the "Office-fidelity ADR" are already shipped behaviour**: every
   agent-authored long document gets a PDF twin at creation (`createDocument` long, `saveMarkdownDocument`,
   `reportPack`), and uploads are viewed as extracted text + original download. The ADR records a status
   quo and closes it; its only *new* code decisions are (a) no true-form Office rendering and no Office
   generation beyond `.xlsx`, and (b) whether `createDocument({form:"short"})` / `format:"html"` also get
   a PDF twin (recommendation: no — keep).

## 3. Design — the lazy version of each step

**Step 1 — inline PDF, in `OutputCard` (not the canvas).** One new branch in the preview `<section>`
(`cards.tsx:2698-2712`) keyed on the selected created doc's `storedMimeType ?? mimeType ===
"application/pdf"`, reusing `PreviewModal`'s iframe props verbatim (no `sandbox`; 70vh → a fixed
`min(70vh, 32rem)` inside the card; single scroll owner). The card keeps the markdown text as the fallback
and "Open full document" as-is. **Why not CanvasPane:** it is keyed on a plan row that document turns do
not have and on a closed `plan.kind`; a canvas branch is a second data path for the same artifact, touches
two playbooks and a source-scan pin, and the media-only copy would need rewriting. The one open question is
**when the URL is minted** (§6 Q2) — it is a project security rule, not a UI choice.

**Step 2a — sheet grid from the text projection, in `PreviewModal` first.** A `SheetGrid` branch in the
`ready-text` switch (`PreviewModal.tsx:276-293`) for spreadsheet MIME types (xlsx/xlsm/xls/xlsb/ods — the
text shape is identical and pinned for all of them): split `doc.text` into `Sheet N` blocks → rows on
`\n` → cells on `\t` → the existing `.markdown-table-scroll` table markup (inherits the brand table CSS:
tinted header, `--rule` hairlines, horizontal scroll). Hard caps in code: rows per sheet and sheets, with an
honest line "N more rows — download the original to see them" (BRAND §5 honest states; the 1500-char
excerpt currently cuts mid-row and is replaced by the row cap for this branch). Pure function
`parseSheetText(text)` in `apps/web` (or `@pikar/core` if the card needs it too) with one test. Once a
created `.xlsx` exists (2b) the same component renders in OutputCard by the same discriminant.
`ponytail:` ceiling named in the component — no sheet names, no types, dates as serials; upgrade path is a
structured rows blob at ingest (its own cap, idempotent Retry, separate storage) when someone asks for
names/types. Not chosen now: client-side SheetJS (new 1 MB client dep, contradicts `index.ts:31-35`), or
on-demand re-parse (re-downloads up to 200 MB per open).

**Step 2b — `.xlsx` deliverable on the email plane.** `FORMAT` gains `xlsx` (the OOXML MIME literal
already used at `vaultDrive.ts:109`); `generateAttachment`'s enum becomes `["pdf","html","xlsx"]` with the
description "use xlsx when the user asks for a spreadsheet"; `renderAndStore` gains a third branch. **Rows
come from pipe tables**: `tokenizeMarkdown` already yields `{kind:"table", header, rows}` tokens
(`documentGen.ts:28-31`), so each table becomes one sheet (`aoa_to_sheet` → `book_append_sheet`, sheet
named from the nearest heading, `write({bookType:"xlsx", type:"buffer"})`) in a new
`packages/vault/src/xlsxWrite.ts` (static import, subpath, pure: markdown → bytes, one test asserting the
workbook reads back through `read()`). A draft with **no table** is a render failure → `attachmentError`
(the existing block-on-render-fail path; "ask for the columns you want"). **The drafter**: a NEW ungated
skill `spreadsheet-drafter` (Phase 18 precedent, v1 active on seed, no eval deadlock) whose body asks for
titled pipe tables and nothing else; `renderAndStore` picks it when `format === "xlsx"`. `document-drafter`
stays byte-unchanged. `regenerateAttachment` passes the original's format (one arg; `cockpitTools.test.ts:
320-350` updated). No new tool NAME → `agentSteps.tool` union, `toolRegistrySnapshot` literals and the
grant tables are untouched. No fee constant: the drafter's tokens are unpriced for PDF today and stay so
(a per-document fee is out of scope; noted in the ADR). Delivery needs nothing; the Graph 3 MiB refusal is
pre-existing and stays. e2e: a NEW SMOKE topic + `/\.xlsx$/` assertion beside the pinned `/\.pdf$/`
regex, never a widening of it. **Vault plane (`createDocument`) does NOT get xlsx** in this phase:
`insertCreatedDoc` hardcodes `storedMimeType=application/pdf`, `vaultSources.form` and `FORM_LABEL` are
closed, ContentView's `bytesLabel` would print the raw OOXML subtype — four closed sets across three
playbooks for the same capability (§6 Q1).

**Step 3 — ADR-036 "Office fidelity: PDF twin, text projection, xlsx out".** Records: generation set is
`pdf | html | xlsx` — never DOCX/PPTX (no library, no sidecar, the 08-21 stack research already rejected
LibreOffice); every long agent document carries a PDF twin (shipped); uploaded Office files are viewed as
their text projection + original download (shipped), spreadsheets as a grid of that projection with named
ceilings; the browser's own PDF viewer in an un-sandboxed iframe is the PDF surface (no pdf.js); HTML
artifacts, when previewed, must NOT share the PDF iframe's element/policy (bare `sandbox` + `srcDoc`, per
growth-surfaces §3.1 — still unbuilt, not in this phase). Consequences: the `officeText` flatten bar
becomes a recorded decision; `DocFormat` is the closed set; ContentView/OutputCard badges must derive from
it.

**Skill body for the cockpit agent.** The body sentence "adds one PDF to the plan" becomes false the moment
the enum widens. The tool schema is what the model reads for arguments, so the feature *works* without a
body change, but a body that contradicts a tool is the failure class recorded in memory
(skill-body-edits-shift-model-tool-args) and CLAUDE.md §5 makes the body the place the capability is
taught. A cockpit-agent bump means the local eval gate (46 cases, ~$0.80, the Phase 39 recipe) and a prod
activation on the owner's G19 list (§6 Q3).

## 4. Blast radius — what goes red, what the hooks demand

- **Tests that must change** (each is a pinned literal, not a bug): `documentGen.test.ts:144-149`
  (`formatSpec` exactly pdf/html → +xlsx); `cockpitTools.test.ts:249-350` (format tests, regenerate
  format); `previewState.test.ts:103` stays true (pdf is still the only *native viewer*; the grid is a
  `ready-text` sub-branch, so the pin holds by construction); `contentView.test.ts:385-389` holds if
  OutputCard, not ContentView, gains the URL query; `officeText.test.ts:78-105` untouched (we read the
  shape, we do not change it); e2e `cockpit-attachment.spec.ts` gains a case, its `/\.pdf$/` pins stay.
- **Prose that must change** in the same commit or ships stale (the Stop hook checks touch, not truth):
  `cockpit.md:5609` "`DocFormat` is `pdf | html`. No pptx path exists anywhere in the repo";
  `cockpit.md:4479-4481` CKPT-02 chain; vault.md's preview section; dashboard-pages.md's
  `MarkdownDocument`/ContentView blast note; `xlsText.ts:19-20` "writer unused in production" ponytail
  note; the `createDocument` description stays true (vault plane unchanged).
- **Playbooks per plan**: 40-01 → cockpit.md (cards.tsx) + vault.md (PreviewModal/previewState) [+
  dashboard-pages.md only if a shared parse helper lands under `dashboard/`]; 40-02 → cockpit.md
  (documentGen, llm.ts, tests) + vault.md (xlsxWrite.ts) + skill-registry.md (new skill row) +
  production-beta.md (G19 list, if the cockpit-agent body bumps). `MediaCanvas.tsx` is NOT touched (no
  media.md bump). `schema.ts` is NOT touched under the recommendation.
- **Sentinels**: `render=fail::` in an attachment topic is an ungated in-band hook (`llm.ts:2172-2174`) —
  the xlsx branch inherits it by sitting inside the same `try`; fine for tests, already recorded as the
  SMOKE-sentinel debt class. Drafter `SMOKE::` fixtures need an allow-listed tenant
  (`fixtureSeamFor`) — unit tests pair with the existing `ATTACH` topics.
- **Prod**: no fixture vars, so a live xlsx check on prod is one real drafter call; the $0 route to a real
  workbook row for the grid is a vault upload.
- **Size**: 40-01 display ≈ 1 day; 40-02 xlsx ≈ 1.5–2 days incl. the skill row and e2e; ADR + DOC-01 +
  playbooks ≈ half a day. Matches 39-RESEARCH's "3–5 days across two plans + the ADR".

## 5. Proposed split

| Plan | Scope | Files (owners) |
|---|---|---|
| **40-01 Display** | inline PDF branch in OutputCard; `SheetGrid` + `parseSheetText` with row/sheet caps in PreviewModal (all spreadsheet MIMEs); OutputCard renders the grid by the same discriminant (no created xlsx exists yet, so it is exercised by test only until 40-02) | `cards.tsx`, `PreviewModal.tsx`, `previewState.ts` (+ tests) — cockpit.md, vault.md |
| **40-02 `.xlsx` out** | `FORMAT.xlsx`, enum, `renderAndStore` branch, `xlsxWrite.ts`, `spreadsheet-drafter` skill row, regenerate keeps format, cockpitTools + documentGen tests, e2e case, optional cockpit-agent body bump through the local gate | `documentGen.ts`, `llm.ts`, `packages/vault/src/xlsxWrite.ts`, `packages/contracts/skills/spreadsheet-drafter.md` (+ constant), skills seed list — cockpit.md, vault.md, skill-registry.md |
| **40-03 Docs close** | ADR-036; `DOC-01` minted + traceability; ROADMAP/STATE per the Phase 37 hook; playbook prose named in §4 | docs only (can ride 40-02's commit) |

Requirement to mint: **`DOC-01` — Documents render in their true form where the browser can (inline PDF,
sheet grids) and the agent can deliver a real `.xlsx`; Office fidelity is a recorded decision (ADR-036),
not an accident.** One checkbox line; if the cockpit-agent bump is deferred to prod activation, the line
carries `(open: prod activation)` like the Phase 39 pattern.

## 6. Owner decisions — ANSWERED 2026-09-06

| # | Question | Owner's answer | Effect on the plans |
|---|---|---|---|
| 1 | Which plane gets `.xlsx` | **Both planes** | 40-02 widens `generateAttachment` (enum) AND `createDocument` (`form: "sheet"`); `insertCreatedDoc`/`patchCreatedDoc`/`vaultSources.form` unions + `FORM_LABEL` + ContentView `bytesLabel` change; the tool description's "never PowerPoint, Word or slides" sentence stays true and is kept |
| 2 | Eager PDF URL | **Eager for the open thread's newest created artifact only** (recommended) | 40-03: OutputCard mints `vaultDownloadUrl` for the SELECTED created doc when its bytes are a PDF — newest by default, an older one only after the user picks it (a click); the `content.ts:165-170` rule is rewritten to "never for a thread the user is not viewing" and pinned by a source-scan test |
| 3 | cockpit-agent body | **Bump through the local eval gate** (recommended) | 40-02: body v3 teaches `format: "xlsx"` and `form: "sheet"`; `seedSkills` → candidate → `pnpm eval:golden --skill cockpit-agent@<v>` → `activateSkill` locally; prod activation joins G19 |
| 4 | Grid data source | **Structured rows at ingest** | 40-01: a NEW `vaultSheets` table (one row per workbook doc, `by_doc` index) written by the extraction action from SheetJS `read` + `sheet_to_json` with hard caps (rows/cols/sheets/bytes) and `totalRows`/`sheetCount` honesty fields; a separate table, not a field, so the 8 MiB grid read budget (which counts `text` only) is untouched; idempotent on Retry (replace by docId); cascades on document removal |

The questions as asked, for the record:

1. **Which plane gets `.xlsx`?** (a) `generateAttachment` only — email-plane deliverable behind the
   existing Approve gate; zero new tool names, zero schema edits — **recommended**; (b) `createDocument`
   only (vault plane) — four closed sets across three playbooks plus a rewrite of its pinned "never
   PowerPoint, Word or slides" description; (c) both. Forcing constraint: `insertCreatedDoc` hardcodes
   `storedMimeType=application/pdf` (`vault.ts:1334`); `vaultSources.form` is `short|long`.
2. **May the inline PDF mint its storage URL eagerly?** (a) click-gated "Show PDF" (keeps the
   `content.ts:165-170` rule byte-for-byte — safe fallback); (b) **eager for the open thread's newest
   created artifact only**, with the rule rewritten to "never for a thread the user is not viewing" and
   pinned by a source-scan test — **recommended**, it is what "inline" means; (c) eager for every created
   artifact in every mounted card — not recommended (a durable bearer URL per artifact in every viewer's
   live subscription). Forcing constraint: Convex storage URLs have no expiry.
3. **Cockpit-agent body bump?** (a) **bump through the local eval gate** (~$0.80; v-next candidate on
   prod joins the G19 activation list) so the body teaches the third format — **recommended**; (b) leave
   the body, rely on the tool schema + description alone (works, but the body says "adds one PDF" and
   contradicts the tool). Either way `document-drafter` stays byte-unchanged and the new
   `spreadsheet-drafter` is ungated.
4. **Grid data source** — decided in code unless the owner objects: the text projection (§3 step 2a) with
   named ceilings; the structured-rows blob is the upgrade path, not this phase.
