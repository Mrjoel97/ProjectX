# Playbook: Knowledge Vault & GraphRAG

> Last verified: 2026-08-03 (15.3-01 — **the vault schema is now folder-aware, and every byte of
> it is inert.** `vaultFolders` + six optional `vaultDocuments` fields + two indexes + the
> `folder_digest` origin literal landed as a PURE WIDENING: no behaviour, no backfill, no
> migration, no test result changed. See `## Phase 15.3 — vault folders` at the END of this file
> — in particular the INERT-LITERAL warning, which is the single most misreadable fact in the
> phase.)

> Last verified: 2026-08-02 (18-07 — **agent-authored documents carry provenance in the grid, and
> the vault-search ceiling on them is REAL.** Documenting shipped surface that landed WITHOUT a
> playbook bump; `check-playbooks` was green only because a foreign lane had bumped this file.)
>
> **The `AGENT` chip** (`DocGrid.tsx:101`, rendered at `:340`) is gated on `doc.origin !== undefined`
> — deliberately a PRESENCE test, not an equality test, so `agent_promoted` keeps its provenance too
> (`:88`). Teal lives in the chip FILL with the label on `--ink`, per BRAND §6 — see `cockpit.md`
> for why the in-file `ConfChip` precedent was NOT followed.
>
> ⚠ **KNOWN CEILING, annotated at the site (`DocGrid.tsx:148`): agent-CREATED documents BROWSE but
> are NOT RETRIEVABLE.** `listVaultDocs` has no kind/status/origin filter, so they appear in the grid
> for free. They will NEVER match `vault.vaultSearch` — same rag primitive — because they are
> deliberately never ingested. **That absence IS the retrieval exclusion**, not an oversight.
>
> **Do NOT close this by ingesting them.** The upgrade path, if it is ever wanted, is a ~3-line
> title-substring fallback unioned into `hitIds` right at that site. Whether to take it is an OPEN
> OWNER QUESTION parked at 18-09’s gate — ingesting agent-authored text would put model output back
> into the retrieval corpus that grounds the model, which is the loop this exclusion exists to break.
>
> Related, and the same principle one plane over: 16-09’s floor refuses to write a `web_research`
> document at all when `webSearchCalls === 0`, because a never-searched answer must not become
> retrievable. See `cockpit.md`. The `startIngest` call-site count in `vault.ts` remains the counted
> exclusion invariant at **5** — `onboarding:__seedOnboardedTenant` was written to avoid becoming a
> sixth.
>
> Last verified: 2026-08-02 (22.1-03 — ⚠ **date bumped for a BEHAVIOUR-FREE sweep; the
> subsystem below was NOT re-verified.**) The dead-directive sweep (`72dd652`) deleted one line
> — `// @ts-expect-error import.meta.glob …` — from watched test files (vaultExtract.test.ts, vaultSweep.test.ts, vaultTranscribe.test.ts).
> It suppressed nothing: `tsconfig.json` includes `vitest.config.mts`, which pulls Vite's global
> types in, so TypeScript reported all 100 occurrences as TS2578 *unused directive*. Deletions
> only, zero additions, no assertion, invariant or product line touched anywhere. Backend
> typecheck 150 → 50; full suite 54/54.
> **Re-verified 2026-08-02** (a later session, closing the ⚠ above for THIS subsystem): vaultExtract.test.ts + vaultSweep.test.ts + vaultTranscribe.test.ts run green under vitest as part of a 10-file, 212/212 pass. The sweep's claim of behaviour-freedom now has evidence here, not just a typecheck delta.
>
> Last verified: 2026-08-01 (22.1-02 — per-tenant budget keying). The spend rail is now TWO windows (`guardrails.ts`): `dailySpendCents` keyed PER TENANT (`{ key: tenantId }` on every check/limit/getValue) and `deploymentSpendCents`, a deliberately KEYLESS ceiling. `prepare`/`preCall` check both — tenant first, so a tenant that is personally out is told so rather than blamed for a global pause — and `recordSpend` consumes both. Two distinct refusals now exist: `daily_budget_exhausted` (this tenant is done today) and `deployment_budget_exhausted` (everyone is paused). For THIS subsystem: `extractDoc` → `extractPdf` → `extractHosted` now thread a `tenantId` (both were private helpers with no tenant in scope), as do `vaultIngest.ingestDoc` and `vaultTranscribe.transcribeDoc`. **15.2-06's per-page fan-out guard still stands** — its static-scan regexes in `vaultExtract.test.ts` were widened for the inserted parameter, NOT relaxed: the hosted call must still receive `pages[...]`, never the sliced whole document. `failureCopy.ts` gained a `deployment_budget_exhausted` entry mapping to the same PAUSED copy. Consequence worth knowing: a large fan-out extraction now bills ONE tenant's rail, so a big upload can exhaust that tenant's day — previously it drained everyone's.
>
> PRIOR 2026-07-30 (26) — **THE CONFIRMED BLUEPRINT IS A DELIBERATE NON-INGESTED VAULT DOCUMENT.** Phase 17.1 plan 08 writes one `business_blueprint` row directly at `ready`, patches it in place on re-confirm, and starts no ingest workflow. It is never embedded or graph-extracted; a byte-less `ready` row is outside the extraction sweep. See the Phase 17.1 section and the explicit ingest-invariant exception below.
>
> Last verified: 2026-07-30 (25) — **THE BLUEPRINT SPINE IS STANDING CONTEXT, NEVER A SEARCH
> RESULT.** Phase 17.1 plan 07 adds it as the fourth `vaultGroundHydrated` field, outside the three
> parallel retrieval arrays and outside `TOTAL_CHAR_CAP`; see `## Phase 17.1 — two-seam blueprint
> grounding` at the end of this playbook.
>
> PRIOR (24) — **THE LAST LEGACY-XLS DATE CEILING IS CLOSED WITH A REAL
> EXCEL-AUTHORED BIFF FILE.** `Zainab_Blowing_Operators_KPIs_Feb_2026.xls` has the OLE2 signature,
> 31 numeric date cells, raw serial `46232`, and Excel's
> `[$-F800]dddd\,\ mmmm\ dd\,\ yyyy` number-format record. The production `xlsText` path emitted
> *"Wednesday, July 29, 2026"* **31 times** and `46232` **zero times**, across 346,692 extracted
> characters. The prior `46067` result remains true only for the SheetJS-written test fixture,
> whose BIFF writer omits the format record. No parser change and no binary fixture were needed.
>
> PRIOR (23) — **A NEW DOCUMENT CLASS LANDS IN THE VAULT: `kind: "web_research"`,
> written by the DISPATCHER (`convex/research.ts` ← `dispatch.runResearch`), never by the specialist
> that produced the prose.** One row per successful research run, through the SOLE legal starter
> (`startIngest`), carrying the D7 freshness stamp as a stored `retrievedAt` number. The stored text
> is **provenance header → 16-03's `<research_findings …>` fence → limits footer**, and the
> zero-source *"insufficient evidence"* verdict is decided by CODE, not by the model's prose. Read
> `### Phase 16 — 16-07` for the containment boundary this class actually has (per-CHUNK containment
> is `searchVault`'s outer fence; the header and inner fence only ride the FIRST chunk) and for what
> a persist failure does and does not cost.
>
> PRIOR (22) — **THE FALSE-READY FAMILY IS CLOSED, and a KPI deck now reads the
> numbers in its CHARTS.** `officeText.ts`'s `Sheet N` / `Slide N` headers were emitted
> unconditionally, so 100%-scaffolding output was non-empty, `empty_extraction` never fired and a
> document holding nothing reported **`ready`**. `labelled()` now binds every structural header to
> its body — **no body, no label, no part** — and a text-free archive returns `""`, which the
> EXISTING `empty_extraction` guard turns into the plain-language remedy that already ships. The
> rule, found FIVE times in this phase: **never let a non-empty string stand in for "we got
> content"; the success signal is a COUNT** (`okPages` → `okSheets` → `parts.length`). Second half:
> `pptxText` now routes each slide's `_rels` to the chart / SmartArt / notes entries **already in
> the same unzip result** — an ALLOW-LIST of three part types, with `diagrams/drawingN.xml` (a
> byte-duplicate that doubles the text) and all layout/master boilerplate deliberately excluded.
> **LIVE: the owner's deck went 356 → 1,182 chars and its Entities panel went from empty to 5 nodes
> / 4 edges, including the three plant codes that exist only in the chart series names.** Details in
> `### Phase 15.2 — 15.2-08`.
>
> PRIOR (21) — **LEGACY `.xls` READS ITS NUMBERS: SheetJS is in, pinned from the
> vendor's CDN (`xlsx-0.20.3.tgz`, EXACT, no caret) and NOT npm `xlsx@0.18.5` (CVE-2023-30533,
> CVE-2024-22363 — this parses untrusted uploads).** The Pitfall-9 spike was run BEFORE the parser
> was written and it is a **GO**: rebuilt under Convex's own esbuild flags, SheetJS carries **19 real
> named exports**, while the `pdf-lib` **control still collapses to 1 (`default`)** under the same
> harness — so the probe demonstrably detects a collapse and did not see one here. **Pitfall 9 is now
> a GENERAL rule: the predictor is the absence of an `exports` map with a real ESM build, not the
> import form; offline green is NOT evidence.** `xlsText` is **subpath-only** (~1 MB into ONE node
> action) and gates on `sniffContainer` first, because SheetJS's `read()` otherwise falls back to a
> DSV guesser and turns **64 bytes of noise into a one-cell sheet of mojibake** that would clear
> `empty_extraction`. Its success signal is **`okSheets`, a COUNT** — so it is deliberately NOT a
> third instance of the `Slide N`/`Sheet N` false-ready family. **LIVE: a real legacy `.xls`
> reached `ready` with its numbers visible — OWNER APPROVED, SC#3's XLS half CLOSED** (evidence
> level: the owner's direct confirmation of the checkpoint criterion — `ready`, numbers present,
> not headings-only; **no figures were transcribed back or diffed against Excel**). **The
> date-serial ceiling was not closed by that approval; it was closed later on 2026-07-29 by a real
> Excel-authored workbook with 31 date cells. The SheetJS-written `.xls` still yields `46067`
> because its fixture writer omits the format record. The
> generalised Pitfall-9 rule now lives in `## Invariants` and the dependency-selection note in
> `## Dependencies & blast radius`, not only in the phase narrative. See
> `### Phase 15.2 — 15.2-07` at the END of this file. PRIOR (20) —
> **SCANNED PDFs ARE NOW TRANSCRIBED, NOT SUMMARISED.** The hosted
> branch sends **ONE PAGE PER CALL** (`fanOutPages`, 6 in flight, page-ordered reassembly, 60 s per
> page, 7-min budget) reusing `attachment-extractor` **unchanged** — §5 satisfied by REUSE: the
> prompt was always right, the INPUT was wrong. Live on `local-joel_feruzi-pikar_ai_50c69-1`: the
> 12-page deck went **2,161 → 7,868 chars**, `Page 1`…`Page 12`, zero `[unreadable]`, 13¢ / 12 calls,
> no OCC. **Owner APPROVED from the row data + excerpts — NOT from a browser (the `:3000` server was
> still stale).** `extractionTruncated` on long scans is now EXPECTED, not a regression. **Anyone
> collapsing this back into one whole-document call reintroduces the defect AND the offline suite
> stays green** — it proves shape, not verbatimness. See `### Phase 15.2 — 15.2-06` at the END of
> this file. PRIOR (19) — **THE LIVE GATE PAID: the stranded `.xlsm` is `ready` with
> 256,439 chars of real spreadsheet text on `local-joel_feruzi-pikar_ai_50c69-1`, and a fresh
> `.pptx` upload auto-progressed to `ready` unattended.** Owner APPROVED but **PARTIALLY OBSERVED** —
> **15.2-04's `failureCopy` is still UNVERIFIED LIVE** (the junk-file path was never run), as are
> legacy `.doc`/`.ppt`/`.xls`. **`vaultSweep:runSweep` is a COMPLETED @convex-dev/migrations
> migration and is a NO-OP on a bare invocation** — it needs `'{"reset": true}'` to see any row
> uploaded after it last finished (2026-07-18). **NEW KNOWN GAP: PPTX extracts titles only, and
> scaffolding-only output (`Slide N`/`Sheet N` headers, emitted unconditionally) reports `ready`
> instead of firing `empty_extraction` — a false-ready one layer below the scheduler; plan 15.2-08.**
> See `### Phase 15.2 — 15.2-05` at the END of this file. PRIOR (18) — **THE HONESTY PLAN, STILL OFFLINE-ONLY.** Three closes, no schema change. (1) **Stale attempt state can no longer survive into a success:** `markExtracting` clears `failureReason` + `extractionTruncated` at the START of every attempt, and `markReady` clears `failureReason` ONLY — clearing `extractionTruncated` there would erase the flag `ingestExtractedText` set on the CURRENT attempt moments earlier, i.e. it would break truncation reporting for every large document that succeeds. The locked 15.2-CONTEXT wording asked for both at `markReady`; that half is a defect and is deliberately NOT implemented. (2) **`extractGraph` has an input cap for the first time** — `GRAPH_EXTRACT_CHAR_CAP` (120k chars) applied as `capGraphText(safeText)` immediately before `generateObject`. Ordering is REDACT-then-CAP, never cap-then-redact, and the SMOKE short-circuit stays above the cap. Ceiling: a HEAD SLICE, not chunk-wise fan-out — tail entities in a very long document are missed, and nothing persists a "graph truncated" flag. (3) **`apps/web/.../vault/failureCopy.ts` is the ONE place a reason code becomes prose** — 21 codes → a plain-language title + an actionable remedy, rendered on both vault surfaces; the raw code is NEVER shown to a user (it rides in `title=` only). The hardcoded "scanned or image-only PDFs" sentence in `PreviewModal` is DELETED: it was wrong for most of 15.2-03's new vocabulary (a legacy `.xls` is not an image-only PDF). `unsupported_legacy_spreadsheet`'s remedy ("re-save as .xlsx") is what lets the SheetJS spike in 15.2-07 fail without taking SC#3 with it. Offline gates only: `@pikar/vault` 114/114 (was 108), backend `vault.test` 28/28 (was 24), `tsc --noEmit` 52 errors ALL in test files and ZERO in any non-test file (the pre-existing baseline, unchanged), `pnpm --filter web build` green, biome at the touched files' pre-existing baseline. **NOTHING LIVE WAS PROVEN — no upload was re-run, no failure card was viewed in a browser; SC#7 is still 15.2-05's gate.** See `### Phase 15.2 — 15.2-04` below. Prior: 2026-07-27 (17) — **THE WIRING PLAN: the first 15.2 plan to touch `convex/`, and still OFFLINE-ONLY.** `vault.scheduleExtraction` is now the SOLE scheduling path for all three callers (`vaultUpload`, the recovery sweep, the user's Retry button); it schedules UNCONDITIONALLY and arms `vaultSweep.watchdogStalled` at +15 min per attempt, so `pending_extraction`/`extracting` finally have the governor `processing` has had since 2026-07-20. `vaultExtract.extractDoc` dispatches on `resolveRail(bytes, ...)` — zip / legacy_doc / legacy_ppt / legacy_xls / rtf / markup / text / pdf / image — so `fail("unsupported_format")`, which has existed unreachable since 03.8-02, is REACHABLE for the first time, and a new `empty_extraction` guard stops a 0-char extraction from being stored as a ready document. `extractionKindFor` no longer appears in `vault.ts`, `vaultSweep.ts` or `vaultExtract.ts`. Offline gates only: `vaultSweep` 19/19 (was 10), `vaultExtract` 28/28 (was 16), `tsc --noEmit` with ZERO non-test errors, seven mutation checks confirmed RED before revert. **NOTHING LIVE WAS PROVEN — no upload was re-run and the owner's stranded `.xlsm` has NOT been recovered; that is plan 15.2-05 and it is a separate gate.** See `### Phase 15.2 — 15.2-03` below. Prior: 2026-07-27 (15) — **FORMAT COVERAGE, PURE LAYER ONLY — NOTHING LIVE WAS PROVEN BY THIS CHANGE EITHER.** Phase 15.2 plan 02 turned `extractOfficeText` from a MIME-dispatched three-format function into a self-identifying ZIP-ENTRY dispatcher taking ONE argument (DOCX/DOCM, XLSX/**XLSM**, PPTX/PPTM, ODT/ODS/ODP, EPUB), and added `packages/vault/src/rawText.ts` (`rtfText` / `markupText` / `oleText`) for the non-ZIP recovery formats — **with zero new dependencies; `pnpm-lock.yaml` is untouched**. **ZERO `convex/` files were touched**, so this entry asserts nothing about any deployment: no upload was re-run, no stranded row was recovered, no rail was exercised end to end. Known TRANSIENT: `vaultExtract.ts:193` still calls `extractOfficeText(bytes, meta.mimeType)` and therefore fails `@pikar/backend` typecheck until plan 15.2-03's first task — that is expected and must NOT be "fixed" by restoring an ignored second parameter. Offline gates only: `@pikar/vault` **108/108** (was 77), `tsc --noEmit` exit 0, `check-playbooks` exit 0, three mutation batches confirmed RED before revert. See `### Phase 15.2 — 15.2-02` below. Prior: 2026-07-27 (14) — **PURE RECOGNITION LAYER ONLY — NOTHING LIVE WAS PROVEN BY THIS CHANGE.** Phase 15.2 plan 01 added `packages/vault/src/sniff.ts` (`sniffContainer` / `ole2Kind` / `resolveRail`) and `schedulingRailFor` in `extractKind.ts`, with their tests. **ZERO `convex/` files were touched**, so this entry asserts nothing about any deployment: no upload was re-run, no stranded row was recovered, no extraction rail was exercised end to end. The wiring (the three `kind === null` call sites) is plan 15.2-03's; until it lands, `resolveRail` has no production caller. Offline gates only: `@pikar/vault` **77/77** (was 42), `tsc --noEmit` exit 0, `check-playbooks` exit 0. See `## Phase 15.2 — universal format recognition` below. Prior: 2026-07-26 (13) — **NO SCANNED PDF COULD EVER EXTRACT — pdf-lib was reached by a DYNAMIC import** (owner-reported: a 14.4 MB, 12-page PDF yielded nothing). The live row read `failed` / `extract_error: Cannot read properties of undefined (reading 'load')`. ROOT CAUSE: `slicePdfToPageCap` did `const { PDFDocument } = await import("pdf-lib")`. pdf-lib ships `main: cjs/index.js` with **no `exports` map**, so it resolves to its CJS build; Convex bundles node actions with esbuild `platform: "node", format: "esm", splitting: true`, and across a dynamic-import CHUNK boundary esbuild cannot synthesize a CJS module's named exports — the namespace carries ONLY `default`, so `PDFDocument` destructured to `undefined` and `.load` threw. Reproduced offline by rebuilding a probe with Convex's exact esbuild flags (read out of `convex/dist/esm/bundler/debugBundle.js`): dynamic `pdf-lib` → `undefined`, namespace key count 1; STATIC `import { PDFDocument } from "pdf-lib"` → `function`; dynamic `unpdf` → fine (unpdf is ESM-only, so its namespace has real named exports). **This is why only SCANNED PDFs broke:** `slicePdfToPageCap` sits exclusively on the hosted-OCR fallback, so text-layer PDFs (unpdf only) were always `ready` and the defect stayed invisible. It was invisible OFFLINE too — Node/vitest recover CJS named exports via `cjs-module-lexer`, so `vaultExtract.test.ts`'s page-cap test passed against a production path that could never run (the Pitfall-1 class: only the deployed run proves it). FIX: pdf-lib is now a STATIC top-level import (exactly what `llm.ts` already does for `markdownToPdf`, which works in production), documented as **Pitfall 9** in source and locked by a new static scan in `vaultExtract.test.ts` asserting no dynamic `pdf-lib` import and a static one present. Verified: the fix rebuilt under Convex's exact bundler flags parses the REAL 14.4 MB PDF (`pageCount = 12`) where the old shape threw; `vaultExtract.test.ts` 6 passed vs 5 at baseline with the SAME 10 pre-existing `_generated`-glob reds (no regression); `vaultExtract.ts` typecheck clean; biome byte-identical to baseline (3 pre-existing CRLF/style reds on both). **SECOND defect, unmasked by the first and then observed live:** with pdf-lib working the run reached the hosted call and died at `extract_error: The operation was aborted due to timeout` — `CALL_TIMEOUT_MS` was 45s, copied from intake.ts (small email attachments), which cannot cover ~19 MB of base64 on the wire plus OCR of 12 full-page images. Raised to **480s**, the identical ceiling `vaultTranscribe.ts` already adopted for a 21 MB video, still under Convex's 10-minute node-action limit. After both fixes the owner's document re-ran live to **`ready`** (extracted → embedded → graph). **THIRD defect, still OPEN (not fixed here):** the run yields only ~2.2k chars / 292 words for a 12-slide deck, and it is a SUMMARY ("Here's a breakdown…", "These slides encompass…") even though the `attachment-extractor` skill body — verified byte-identical between the repo `.md` and the seeded row, so NOT a stale-registry problem — explicitly says "extract ALL of it VERBATIM" and "Never summarize". Cause is the CALL SHAPE, not the prompt: that skill's own contract is written for "a **single** image or document (PDF page…)", and `extractPdf` hands the model ALL pages as ONE file part in ONE request, so it digests instead of transcribing. The fix is per-page fan-out (pdf-lib can already emit 1-page PDFs via `copyPages`, matching the skill's single-page contract) — deferred because it changes the cost/latency profile of every scanned upload and a 50-page `VAULT_EXTRACT_PAGE_CAP` scan cannot run 50 sequential hosted calls inside one action's 10-minute limit; it needs batching or a workflow step, not a one-liner. Prior: 2026-07-26 (12) — **A READY DOCUMENT IS NOW A VOICE-SESSION ENTRY POINT** (Phase 14, DOCV-01). `DocGrid` cards and the `PreviewModal` footer carry a "Discuss by voice" control linking to `/dashboard/voice?doc=<id>`, gated honestly on `status`: `ready` enables it; `processing`/`extracting`/`pending_extraction` render a REAL `disabled` button ("Reading…") rather than a dead-styled link, because a screen reader must not announce an actionable control that does nothing; `failed` offers **no voice action at all** and the modal explainer now says why in the user's terms plus what to do next (scanned/image-only PDFs are the usual cause). We do not open a grounded conversation the agent has nothing to ground in, and a silent degradation to "chat about it anyway" would be worse than the refusal. **THE GATE IS SUBSCRIPTION-DRIVEN AND MUST STAY THAT WAY:** `listVaultDocs` is a live Convex query returning whole rows, so the control re-renders enabled on its own the instant extraction flips the status — there is no poll, no timer and no second query, and none should be added. The control is a SIBLING of the card `<button>`, never nested inside it (nested interactive elements are invalid HTML and break keyboard order) — it reuses the failed-card Retry's absolute-positioning precedent and shares the corner, since the two statuses are mutually exclusive. Voice-side reads use `voiceDoc.docContext`, a three-field projection, NOT `listVaultDocs`: that query `.collect()`s whole rows including `text`, and the voice page has no business pulling a book-sized blob to render a title (RESEARCH Open Question 6 remains an observation — deliberately NOT fixed here). Prior: 2026-07-25 (11) — **CHUNK-PRECISE HYDRATION** (owner question: "can the vault read a 50–100 page document completely, or does it skip parts?"). It could not. `vaultGroundHydrated` hydrated every doc with `text.slice(0, PER_DOC_CHAR_CAP)` — the document's FIRST 1500 characters — discarding the passage `rag.search` had just matched. Storage and search were never the problem (the full extracted text is chunked and embedded, and search locates any passage); the loss was entirely at the final hop, so the agent effectively read ~250 words from the top of every document regardless of length. Observed: a 300-page book grounded as its COPYRIGHT PAGE. FIX (the `ponytail:` upgrade path this file already named, now taken): `runVaultGround` collects the matched `content[].text` per docId into a new `matchedByDoc` record — concatenating in score order, so several hits in ONE long doc contribute several passages — and `vaultGroundHydrated` prefers it, reserving the `getDoc` slice for graph NEIGHBOURS (no matched chunk by definition) and the `SMOKE::` seam. Char budgets are UNCHANGED (`PER_DOC_CHAR_CAP` 1500 / `TOTAL_CHAR_CAP` 8000) — the same budget now buys relevant text instead of front matter. The PUBLIC `vaultGround` shape is unchanged: its handler destructures to `{docIds, context}` so `matchedByDoc` cannot leak into the tool/fixture contract, with a new test asserting exactly those two keys (golden fixtures 25/26 and `searchVault` ride this shape). Verified live on the owner's deployment: querying "scarcity urgency bonuses guarantee naming the offer" now returns the book's actual "ENHANCING THE OFFER: BONUSES" chapter instead of its title page. `vaultGround.test.ts` 13/13; full backend 481/482 with only the pre-existing `audit.test.ts` red. Extraction ceilings are SEPARATE and unchanged — a text-layer PDF extracts ALL pages via unpdf, but a SCANNED PDF is sliced to `VAULT_EXTRACT_PAGE_CAP` (50) pages before hosted OCR, and any doc is capped at `VAULT_EXTRACT_CHAR_CAP` (400k) with the `extractionTruncated` honesty flag. Prior: 2026-07-25 (10) — NEW internal query `profileSeedDocs(tenantId)`: the tenant's own profile-shaped docs, newest first, capped at 3 and `PROFILE_SEED_CHAR_CAP` (4000) each. Exists because pure similarity retrieval cannot answer "evaluate MY business" — `rag.search` takes top-K by CHUNK, so one large reference PDF occupied every seed slot and the evaluation engine's grounding returned a single 300-page book (measured live), never the user's own profile. The evaluation engine prepends these as an AUTHORITATIVE seed; `vaultGround` itself is deliberately unchanged (it also serves `searchVault` + golden fixtures 25/26). Recognition is the `- **Persona:**` marker `serializeProfile` always writes, OR `kind === "business_profile"` — so it catches both the onboarding-committed profile AND an uploaded profile-format markdown. CHEAP BY CONSTRUCTION: the metadata pre-filter (`business_profile` kind, or `text/markdown`) keeps PDFs out, so a book's text is never loaded just to test it for the marker; only `status: "ready"` docs with text qualify. Ceiling: newest-wins, so several profile-shaped docs blend (the newest supplies each field first) — fine for one profile plus uploads, revisit if multi-business support lands. Prior: 2026-07-25 (9) — NEW internal seam `ingestFromAttachment` closes the Phase-2/Phase-5 gap: a file attached in the COCKPIT now also becomes a vault doc (owner-reported that cockpit uploads never reached the vault). An internal twin of `vaultIngestText` rather than a caller of it, for the two reasons this file already documents on `ingestExtractedText` — the public mutation throws UNAUTHENTICATED from an action (Pitfall 3), and it accepts no `storageId`. Explicit `tenantId` (the `recordScorecardAnswerInternal` precedent); no public tenantMutation is loosened. Body mirrors `vaultIngestText`: hash-dedup on `by_tenant_contentHash` → insert → `startIngest`. Row shape: `kind`/`source` = `"upload"`, real `mimeType`, `storageId` carried through so the doc stays downloadable from the vault UI, `text` = the RAW extracted text (consistent with every other vault doc — `runIntake` keeps the redacted `safeText` for the conversation). **No new `VaultSource` value was needed**: `categoryFor({ source: "upload", mimeType })` already routes documents to `my-uploads` and lets an image/video mimeType win into `images`/`videos`, so an attachment lands in the same category as the identical direct upload. Dedup means re-attaching a file already in the vault reuses that row — no duplicate, no re-embed, no second embedding spend. The caller (`intake.ts` step 8b) is fail-open; this mutation itself is unchanged in its throw behaviour. Verified: `intake.test.ts` 10/10 incl. 5 new seam tests, full backend 479/480 (only the pre-existing `audit.test.ts` red), `vault.ts` typecheck clean. Spec: `docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md`. Prior: 2026-07-25 (8) — MIME extension-fallback DE-DUPLICATED to one shared helper (owner-reported: the cockpit refused a `.md` upload). ROOT CAUSE: `File.type` is `""` for `.md` on Windows (no registered OS MIME type), and the cockpit's `AttachmentPicker.tsx` checked `MIME_ALLOWLIST.has(file.type)` on that RAW value — so a file whose type (`text/markdown`) IS allow-listed was rejected as "unsupported file type". `Dropzone.tsx` had already solved this locally with its own `resolveMime()` + `EXT_MIME` map, so the vault route worked and the cockpit did not — two copies of one rule, one of them missing. FIX: the fallback moved to `resolveMimeType(filename, browserType)` in `@pikar/core/validateSubmit` (beside the `MIME_ALLOWLIST` it must agree with, §1 pure-TS); `Dropzone.tsx` now imports it and its local `EXT_MIME`/`resolveMime` are deleted (vault behaviour byte-identical — same map, same `application/octet-stream` fallback, so `isSearchable()` still sees `text/markdown` and starts the ingest workflow), and `AttachmentPicker.tsx` resolves BEFORE the allow-list check and sends the resolved type as both the upload `Content-Type` and the stored `mimeType` (previously it stored `""` for any untyped file). An unknown extension still resolves to `application/octet-stream`, which is NOT allow-listed — the fallback widens nothing. Verified: `packages/core` 195/195 green incl. 4 new `resolveMimeType` cases (browser type wins, `.md`/`.markdown`/`.csv`/`.TXT` fallback, untyped `.md` passes the allow-list, unknown ext stays opaque and fails it); web typecheck clean. Prior: 2026-07-24 (7) — Hydrated grounding path (10-01, VGND-01): `vaultGround.ts`'s retrieval logic now lives in a shared module-level helper `runVaultGround(ctx, tenantId, query)` — the tenant is read from an EXPLICIT `tenantId` PARAMETER (not `ctx.auth`), and BOTH entry points call it: the public `vaultGround` tenantAction passes `ctx.tenantId` (its args/name/`{docIds,context}` return + SMOKE:: seam + ranking byte-for-byte unchanged — both pre-existing public tests stay green), and the NEW `vaultGroundHydrated` internalAction passes its explicit `tenantId` arg (the identity-less `internal.gmail.search`/`internal.llm.digestInbox` convention — the cockpit tool loop + eval harnesses carry no live identity, so Plan 02's `runCockpitAgent` calls it as `internal.vaultGround.vaultGroundHydrated({ tenantId, query })`). `vaultGroundHydrated` hydrates the fused docIds into three PARALLEL arrays `{ docIds, titles, chunks }`: titles via the tenant-scoped batch `internal.vault.ownedDocsMeta` (a cross-tenant/missing id drops out — VALT-03), chunk TEXT via `internal.vault.getDoc` (fail-closed cross-tenant), each slice bounded by `PER_DOC_CHAR_CAP` (1500) with a running `TOTAL_CHAR_CAP` (8000) so a large fused corpus never blows the agent-loop context. The hydrated text is returned into the tool loop ONLY — never into any audit/DLQ/telemetry payload (§4; Plan 02's `searchVault` tool owns the refs-only `vault.searched` audit). A foreign explicit `tenantId` yields empty parallel arrays (VALT-03 holds through the hydrated surface — the explicit arg is the only scope; no identity to fall back on). Ceiling (`ponytail:` in source): doc-level text, not chunk-precise — upgrade path is threading `rag.search` result `content` for the vector seeds and reserving `getDoc` for graph neighbors only. Verified: `pnpm --filter @pikar/backend vitest run vaultGround` 12/12 green (hydration parity, per-doc + total caps, cross-tenant empty via explicit tenantId, both unchanged public engine tests); `vaultGround.ts`/`vaultGround.test.ts` typecheck clean; `packages/vault/src/fusion.ts` untouched. The `internalAction` import needs no Biome allow-list change (§2's `noRestrictedImports` bans only `query`/`mutation`/`action`, not the `internal*` builders). Prior: 2026-07-20 (6) — Stranded-"processing" bug FIXED (owner-reported: a voice brief + a PDF stuck "processing" 5+ min, never finishing; an image succeeded). ROOT CAUSE: all five `ingestDoc` start sites called `workflow.start` WITHOUT an `onComplete`, so when an ingest step died (here: this session's repeated backend restarts exhausted the in-flight embed/extract retries) the workflow ended but NOTHING marked the doc — it sat at `processing` forever (only success→`markReady` or a governed stop→`markFailed` ever wrote a terminal status). Two 6-day-old brain-dumps were stranded the same way. FIX: `vaultIngest.startIngest(ctx, {...})` is now the SOLE ingest starter — it wraps `workflow.start` with `onComplete: internal.vaultIngest.onIngestComplete`, which on a failed/canceled run flips a still-`processing` doc to `failed` (idempotent; success + already-terminal untouched). All 5 sites (vault.ts ×4, voice.ts ×1) route through it, so a 6th cannot reintroduce the omission. `retryStuckIngests` re-queues stranded docs (recovered the 4 live). Verified: 4 new `onIngestComplete` tests + full vault/voice suites (32) green, backend typecheck clean, the 4 stranded docs recovered on the live deployment. Prior: 2026-07-18 (5) — Media fit + image full-screen (owner-directed): the media pane is `overflow: hidden` (a single image/video always FITS the pane — media never scrolls; text keeps `auto` because reading scrolls), and images gained a "View full screen" pill that calls the native `requestFullscreen()` on the img — the same full-view the video player's control already offers. Prior: 2026-07-18 (4) — Preview modal FIXED geometry (owner-reported: buttons cut off at the card edge, inconsistently per doc): `max-height` alone let tall content size the card past the viewport cap, and the `overflow: hidden` edge then amputated the pinned actions footer — per-doc, which read as "sometimes the buttons are missing". `.vault-preview-grid` now has an explicit `height: min(85vh, 56rem)` + `grid-template-rows: minmax(0, 1fr)` (stacked mode already bounds its two rows), so EVERY card — text, image, video, any content length — has identical geometry with the actions footer always in the same visible place. Media panes center their content (`place-items: center`) and img/video size to the definite pane height (`max-height: 100%`, `object-fit: contain`). Prior: 2026-07-18 (3) — Transcription timeout + pinned modal actions (owner-reported): a 21 MB mp4 failed with `TimeoutError` — `vaultTranscribe`'s 45s `CALL_TIMEOUT_MS` (copied from intake.ts, tuned for seconds-long mic clips) can't cover upload+transcription of a near-cap video; raised to 480s (under Convex's 10-min node-action limit). Timeout errors now map to the static reason `transcribe_timeout`. Verified live: the failed 21 MB video re-ran to `ready`. PreviewModal's detail panel restructured to fixed header / scrollable middle / PINNED actions footer — documents with many extracted entities were scrolling Download/Delete/Open-in-workspace out of sight (media docs, with few entities, kept theirs visible — the reported asymmetry). Prior: 2026-07-18 (2) — Soundless-video honesty + preview media containment (owner-reported): a second mp4 failed on whisper-1 with `AI_APICallError: The audio file could not be decoded` — byte-level mp4 box inspection proved the file has ONE track (`vide`/avc1, NO audio track), so there is nothing to transcribe. `transcribeDoc`'s catch now maps that decode error to the static reason `no_audio_track_or_undecodable` (card renders "no audio track or undecodable"); other errors stay `transcribe_failed`. PreviewModal media are now contained: img/video get `object-fit: contain` + `max-height: 62vh` (full image visible, never cropped at the card edge), and stacked mode bounds both rows (`minmax(0,1.3fr) minmax(0,1fr)`) so tall media can't push the detail panel past the card's overflow-hidden edge. Ops note: vitest false-reds (`crypto is not defined` in convex-test workers) appear under CPU saturation — kill runaway processes and re-run `--maxWorkers=1` before trusting a red. Prior: 2026-07-18 — Video transcription fix (owner-reported: a 6 MB mp4 failed): `transcribeDoc` now transcribes with `whisper-1` instead of `gpt-4o-transcribe`, which rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided`). whisper-1 demuxes the audio track; both bill at 0.006/min so the cost model is unchanged. Verified live on the shared local deployment: the failed 6 MB mp4 re-transcribed to `ready` + embedded. The terminal catch-all now `console.error`s the API error message (refs-safe) so a `transcribe_failed` is no longer a silent dead-end. `intake.ts` intentionally stays on gpt-4o-transcribe (its inputs are mic audio, which that model supports + transcribes more accurately). Prior: 2026-07-18 — Post-3.8 human-verify tuning (owner-reported during phase-close): the per-file cap became per-kind — `VAULT_FILE_CAP_BYTES` raised 8 MiB → **100 MiB** for docs/images, new `VAULT_VIDEO_CAP_BYTES` = **25 MB** for video (the transcription API's hard limit). Enforced at the `vaultUpload` chokepoint (per-kind branch, specific messages) and mirrored in `Dropzone.tsx` as a fast pre-upload guard (two local numbers + sync comment — no new web dep on the Node-oriented `@pikar/vault` barrel). `PreviewModal.tsx` no longer overlaps on narrow screens: the two-pane grid moved to `.vault-preview-grid`/`.vault-preview-main` in `globals.css` and STACKS to one column below 48rem (divider flips right→bottom border), and the extracted-text pane now shows a 1500-char snippet with a "Show full text" expander instead of dumping the whole document. Video >25 MB and large-doc extraction memory/time logged under Known gaps. Verified: `@pikar/vault` cap/category tests green, `@pikar/backend` `vault.test.ts` + `vaultTranscribe.test.ts` green (26 incl. new per-kind cap tests), web typecheck clean, biome clean on all touched files. Prior: 2026-07-18 — Phase 3.8 Wave 3 (03.8-06 integration): all four Wave-2 lanes merged to `main` and the merged whole proven green. Lane 1 (`vaultExtract.ts` — PDF text-layer-first + hosted OCR + image), Lane 2 (`packages/vault/src/officeText.ts` — DOCX/XLSX/PPTX flatten), Lane 3 (`vaultSweep.ts` backlog sweep + `retryExtraction` + the vault-route lifecycle UI + `vault.spec.ts` E2E), and Lane 4 (`vaultTranscribe.ts` — video/audio transcription rail) are now the real dispatcher end to end: `vaultUpload` → `extractDoc`/`transcribeDoc` (kind-dispatched, self-gated via preCall, scan-then-audit refs-only, char-capped) → `ingestExtractedText` seam → embed + graph. The two EXTR-H rows in `apps/web/e2e/vault.spec.ts` are now UN-skip-guarded (Wave-0 stubs are real, so the SMOKE::extract:: pdf + SMOKE::transcribe:: mp4 walks assert a clean pending_extraction → ready terminal, not the old `failed("not_implemented")` branch). Verified on merged `main`: backend vitest 317/318 (only red = pre-existing `audit.test.ts` auditCounts-unregistered, documented since Phase 2), `@pikar/vault` 42/42 (officeText 15/15), web typecheck clean, `biome lint` clean on all merged vault files, `check-playbooks` green. `_generated/` regenerated (`npx convex codegen`) so `api.d.ts` carries all four modules. Append-only singletons (STATE/ROADMAP/vault.md/deferred-items) resolved keep-both per PARALLELIZATION §"three shared singletons". Prior: 2026-07-18 — Phase 3.8 Wave 0 (03.8-01): the extraction CONTRACT landed on `main` — `vaultDocuments.status` grew `extracting` (+ `extractionTruncated` optional flag), `vaultUpload` now schedules `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` by `extractionKindFor(mimeType, filename)` for non-searchable binaries (TXT/MD/CSV path untouched), and the scheduler-safe internal seam `ingestExtractedText` + `markExtracting` + `getDocForExtraction` sit next to markReady/markFailed. `@pikar/vault` gained `extractKind.ts` (classifier + caps consts, on the barrel) and the `officeText.ts` stub (subpath-only — keeps fflate out of the V8 bundle). `unpdf@1.6.2`/`fflate@0.8.3` pinned; the lockfile, both package.jsons, `schema.ts`, `vault.ts`, and `watch.json` are FROZEN for the rest of the phase (see `## Extraction lifecycle (Phase 3.8)` + `.planning/PARALLELIZATION.md`). Prior: 2026-07-17 — overflow containment fix (user-reported): long unbroken filenames painted past the doc cards. In `DocGrid.tsx` grid (column) view the info span's cross-axis shrink-to-fit sized it to the full nowrap-title width (min-content = max-content for nowrap text), so the ellipsis never engaged — capped with `maxWidth: 100%`; `PreviewModal.tsx`'s title `h2` got `minWidth: 0` so `flex: 1` can actually shrink it and `break-word` wraps instead of pushing past the panel. Visual containment only — no data/query/status changes; web typecheck clean. Prior: 2026-07-15 — owner-directed shell fusion + glass/clay uniformity, in two passes. Pass 1 fused the route full-bleed: `(app)/layout.tsx`'s `is-bleed` match widened to `/^\/dashboard\/(workspace|vault)/`, so `<main>` drops its canvas padding and locks overflow, and `vault/page.tsx`'s root became a `.vault-surface.pane-canvas` (the workspace canvas's teal aura) with an inner `.vault-scroll` owning its own scroll (is-bleed locks `<main>`). Pass 2 gave the board pieces the actual glass-over-clay treatment (the fusion alone left the tiles flat): shared `globals.css` classes `.clay-card` (frosted translucent pane + `backdrop-filter` blur + extruded shadows — an outer drop, an inner top light edge, a soft inner bottom shade; hover-lift for `button.clay-card`), `.clay-badge` (extruded icon badge mirroring `.rail-logo`), and `.clay-dropzone` (lighter frosted panel). Applied by className to the VaultStats tiles + their icon badges, the CategoryTabs container, the DocGrid search bar + doc cards + card icon badges, and the Dropzone panel + its icon (each dropped its inline `var(--card)`/border/flat-shadow; radius + layout stay inline). The `backdrop-filter` frosts the aura, so these only read right on `.pane-canvas`. PreviewModal is intentionally left solid — it sits on a dark scrim, not the aura, so frosting would just muddy the scrim. Internal vault behavior and all `vault.spec.ts` selectors unchanged; web typecheck clean. Prior: 05-07b — LIVE browser human-verify (real user, Claude-in-Chrome): the vault route renders a 1:1 brand match; a pasted Brain Dump ingested end-to-end through the REAL pipeline (embed → graph-extract → upsert → `ready`), and the preview modal surfaced the correctly-extracted entities (Meridian Health/CareLink/Vantage Systems `org`, Alan Ford/Nina Osei `person`) + a typed `led by` relationship. The live run CAUGHT + FIXED a P0 the offline SMOKE suite could not: `vaultRag.ts` passed a spec-"v4" `openai.embedding(...)` model to RAG's ai@6 (`AI_UnsupportedModelVersionError`) — replaced with a v2 `openaiEmbeddingV2` REST adapter (+ a `vaultRedaction.test.ts` static guard). Also surfaced: ingest needs `skills:seedSkills` run against the deployment (`NO_ACTIVE_SKILL: graph-extractor` otherwise). ALSO 2026-07-27 (16-01, Lane R — concurrent phase, keep-both merge): Phase-16 Wave-0 freeze — the web_research document class, vaultDocuments.retrievedAt, and the ADR-006 trust-assumption change (a web-derived doc is NOT the user own corpus). PREVIOUSLY: 2026-07-26 (13) — **NO SCANNED PDF COULD EVER EXTRACT — pdf-lib was reached by a DYNAMIC import** (owner-reported: a 14.4 MB, 12-page PDF yielded nothing). The live row read `failed` / `extract_error: Cannot read properties of undefined (reading 'load')`. ROOT CAUSE: `slicePdfToPageCap` did `const { PDFDocument } = await import("pdf-lib")`. pdf-lib ships `main: cjs/index.js` with **no `exports` map**, so it resolves to its CJS build; Convex bundles node actions with esbuild `platform: "node", format: "esm", splitting: true`, and across a dynamic-import CHUNK boundary esbuild cannot synthesize a CJS module's named exports — the namespace carries ONLY `default`, so `PDFDocument` destructured to `undefined` and `.load` threw. Reproduced offline by rebuilding a probe with Convex's exact esbuild flags (read out of `convex/dist/esm/bundler/debugBundle.js`): dynamic `pdf-lib` → `undefined`, namespace key count 1; STATIC `import { PDFDocument } from "pdf-lib"` → `function`; dynamic `unpdf` → fine (unpdf is ESM-only, so its namespace has real named exports). **This is why only SCANNED PDFs broke:** `slicePdfToPageCap` sits exclusively on the hosted-OCR fallback, so text-layer PDFs (unpdf only) were always `ready` and the defect stayed invisible. It was invisible OFFLINE too — Node/vitest recover CJS named exports via `cjs-module-lexer`, so `vaultExtract.test.ts`'s page-cap test passed against a production path that could never run (the Pitfall-1 class: only the deployed run proves it). FIX: pdf-lib is now a STATIC top-level import (exactly what `llm.ts` already does for `markdownToPdf`, which works in production), documented as **Pitfall 9** in source and locked by a new static scan in `vaultExtract.test.ts` asserting no dynamic `pdf-lib` import and a static one present. Verified: the fix rebuilt under Convex's exact bundler flags parses the REAL 14.4 MB PDF (`pageCount = 12`) where the old shape threw; `vaultExtract.test.ts` 6 passed vs 5 at baseline with the SAME 10 pre-existing `_generated`-glob reds (no regression); `vaultExtract.ts` typecheck clean; biome byte-identical to baseline (3 pre-existing CRLF/style reds on both). **SECOND defect, unmasked by the first and then observed live:** with pdf-lib working the run reached the hosted call and died at `extract_error: The operation was aborted due to timeout` — `CALL_TIMEOUT_MS` was 45s, copied from intake.ts (small email attachments), which cannot cover ~19 MB of base64 on the wire plus OCR of 12 full-page images. Raised to **480s**, the identical ceiling `vaultTranscribe.ts` already adopted for a 21 MB video, still under Convex's 10-minute node-action limit. After both fixes the owner's document re-ran live to **`ready`** (extracted → embedded → graph). **THIRD defect, still OPEN (not fixed here):** the run yields only ~2.2k chars / 292 words for a 12-slide deck, and it is a SUMMARY ("Here's a breakdown…", "These slides encompass…") even though the `attachment-extractor` skill body — verified byte-identical between the repo `.md` and the seeded row, so NOT a stale-registry problem — explicitly says "extract ALL of it VERBATIM" and "Never summarize". Cause is the CALL SHAPE, not the prompt: that skill's own contract is written for "a **single** image or document (PDF page…)", and `extractPdf` hands the model ALL pages as ONE file part in ONE request, so it digests instead of transcribing. The fix is per-page fan-out (pdf-lib can already emit 1-page PDFs via `copyPages`, matching the skill's single-page contract) — deferred because it changes the cost/latency profile of every scanned upload and a 50-page `VAULT_EXTRACT_PAGE_CAP` scan cannot run 50 sequential hosted calls inside one action's 10-minute limit; it needs batching or a workflow step, not a one-liner. Prior: 2026-07-26 (12) — **A READY DOCUMENT IS NOW A VOICE-SESSION ENTRY POINT** (Phase 14, DOCV-01). `DocGrid` cards and the `PreviewModal` footer carry a "Discuss by voice" control linking to `/dashboard/voice?doc=<id>`, gated honestly on `status`: `ready` enables it; `processing`/`extracting`/`pending_extraction` render a REAL `disabled` button ("Reading…") rather than a dead-styled link, because a screen reader must not announce an actionable control that does nothing; `failed` offers **no voice action at all** and the modal explainer now says why in the user's terms plus what to do next (scanned/image-only PDFs are the usual cause). We do not open a grounded conversation the agent has nothing to ground in, and a silent degradation to "chat about it anyway" would be worse than the refusal. **THE GATE IS SUBSCRIPTION-DRIVEN AND MUST STAY THAT WAY:** `listVaultDocs` is a live Convex query returning whole rows, so the control re-renders enabled on its own the instant extraction flips the status — there is no poll, no timer and no second query, and none should be added. The control is a SIBLING of the card `<button>`, never nested inside it (nested interactive elements are invalid HTML and break keyboard order) — it reuses the failed-card Retry's absolute-positioning precedent and shares the corner, since the two statuses are mutually exclusive. Voice-side reads use `voiceDoc.docContext`, a three-field projection, NOT `listVaultDocs`: that query `.collect()`s whole rows including `text`, and the voice page has no business pulling a book-sized blob to render a title (RESEARCH Open Question 6 remains an observation — deliberately NOT fixed here). Prior: 2026-07-25 (11) — **CHUNK-PRECISE HYDRATION** (owner question: "can the vault read a 50–100 page document completely, or does it skip parts?"). It could not. `vaultGroundHydrated` hydrated every doc with `text.slice(0, PER_DOC_CHAR_CAP)` — the document's FIRST 1500 characters — discarding the passage `rag.search` had just matched. Storage and search were never the problem (the full extracted text is chunked and embedded, and search locates any passage); the loss was entirely at the final hop, so the agent effectively read ~250 words from the top of every document regardless of length. Observed: a 300-page book grounded as its COPYRIGHT PAGE. FIX (the `ponytail:` upgrade path this file already named, now taken): `runVaultGround` collects the matched `content[].text` per docId into a new `matchedByDoc` record — concatenating in score order, so several hits in ONE long doc contribute several passages — and `vaultGroundHydrated` prefers it, reserving the `getDoc` slice for graph NEIGHBOURS (no matched chunk by definition) and the `SMOKE::` seam. Char budgets are UNCHANGED (`PER_DOC_CHAR_CAP` 1500 / `TOTAL_CHAR_CAP` 8000) — the same budget now buys relevant text instead of front matter. The PUBLIC `vaultGround` shape is unchanged: its handler destructures to `{docIds, context}` so `matchedByDoc` cannot leak into the tool/fixture contract, with a new test asserting exactly those two keys (golden fixtures 25/26 and `searchVault` ride this shape). Verified live on the owner's deployment: querying "scarcity urgency bonuses guarantee naming the offer" now returns the book's actual "ENHANCING THE OFFER: BONUSES" chapter instead of its title page. `vaultGround.test.ts` 13/13; full backend 481/482 with only the pre-existing `audit.test.ts` red. Extraction ceilings are SEPARATE and unchanged — a text-layer PDF extracts ALL pages via unpdf, but a SCANNED PDF is sliced to `VAULT_EXTRACT_PAGE_CAP` (50) pages before hosted OCR, and any doc is capped at `VAULT_EXTRACT_CHAR_CAP` (400k) with the `extractionTruncated` honesty flag. Prior: 2026-07-25 (10) — NEW internal query `profileSeedDocs(tenantId)`: the tenant's own profile-shaped docs, newest first, capped at 3 and `PROFILE_SEED_CHAR_CAP` (4000) each. Exists because pure similarity retrieval cannot answer "evaluate MY business" — `rag.search` takes top-K by CHUNK, so one large reference PDF occupied every seed slot and the evaluation engine's grounding returned a single 300-page book (measured live), never the user's own profile. The evaluation engine prepends these as an AUTHORITATIVE seed; `vaultGround` itself is deliberately unchanged (it also serves `searchVault` + golden fixtures 25/26). Recognition is the `- **Persona:**` marker `serializeProfile` always writes, OR `kind === "business_profile"` — so it catches both the onboarding-committed profile AND an uploaded profile-format markdown. CHEAP BY CONSTRUCTION: the metadata pre-filter (`business_profile` kind, or `text/markdown`) keeps PDFs out, so a book's text is never loaded just to test it for the marker; only `status: "ready"` docs with text qualify. Ceiling: newest-wins, so several profile-shaped docs blend (the newest supplies each field first) — fine for one profile plus uploads, revisit if multi-business support lands. Prior: 2026-07-25 (9) — NEW internal seam `ingestFromAttachment` closes the Phase-2/Phase-5 gap: a file attached in the COCKPIT now also becomes a vault doc (owner-reported that cockpit uploads never reached the vault). An internal twin of `vaultIngestText` rather than a caller of it, for the two reasons this file already documents on `ingestExtractedText` — the public mutation throws UNAUTHENTICATED from an action (Pitfall 3), and it accepts no `storageId`. Explicit `tenantId` (the `recordScorecardAnswerInternal` precedent); no public tenantMutation is loosened. Body mirrors `vaultIngestText`: hash-dedup on `by_tenant_contentHash` → insert → `startIngest`. Row shape: `kind`/`source` = `"upload"`, real `mimeType`, `storageId` carried through so the doc stays downloadable from the vault UI, `text` = the RAW extracted text (consistent with every other vault doc — `runIntake` keeps the redacted `safeText` for the conversation). **No new `VaultSource` value was needed**: `categoryFor({ source: "upload", mimeType })` already routes documents to `my-uploads` and lets an image/video mimeType win into `images`/`videos`, so an attachment lands in the same category as the identical direct upload. Dedup means re-attaching a file already in the vault reuses that row — no duplicate, no re-embed, no second embedding spend. The caller (`intake.ts` step 8b) is fail-open; this mutation itself is unchanged in its throw behaviour. Verified: `intake.test.ts` 10/10 incl. 5 new seam tests, full backend 479/480 (only the pre-existing `audit.test.ts` red), `vault.ts` typecheck clean. Spec: `docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md`. Prior: 2026-07-25 (8) — MIME extension-fallback DE-DUPLICATED to one shared helper (owner-reported: the cockpit refused a `.md` upload). ROOT CAUSE: `File.type` is `""` for `.md` on Windows (no registered OS MIME type), and the cockpit's `AttachmentPicker.tsx` checked `MIME_ALLOWLIST.has(file.type)` on that RAW value — so a file whose type (`text/markdown`) IS allow-listed was rejected as "unsupported file type". `Dropzone.tsx` had already solved this locally with its own `resolveMime()` + `EXT_MIME` map, so the vault route worked and the cockpit did not — two copies of one rule, one of them missing. FIX: the fallback moved to `resolveMimeType(filename, browserType)` in `@pikar/core/validateSubmit` (beside the `MIME_ALLOWLIST` it must agree with, §1 pure-TS); `Dropzone.tsx` now imports it and its local `EXT_MIME`/`resolveMime` are deleted (vault behaviour byte-identical — same map, same `application/octet-stream` fallback, so `isSearchable()` still sees `text/markdown` and starts the ingest workflow), and `AttachmentPicker.tsx` resolves BEFORE the allow-list check and sends the resolved type as both the upload `Content-Type` and the stored `mimeType` (previously it stored `""` for any untyped file). An unknown extension still resolves to `application/octet-stream`, which is NOT allow-listed — the fallback widens nothing. Verified: `packages/core` 195/195 green incl. 4 new `resolveMimeType` cases (browser type wins, `.md`/`.markdown`/`.csv`/`.TXT` fallback, untyped `.md` passes the allow-list, unknown ext stays opaque and fails it); web typecheck clean. Prior: 2026-07-24 (7) — Hydrated grounding path (10-01, VGND-01): `vaultGround.ts`'s retrieval logic now lives in a shared module-level helper `runVaultGround(ctx, tenantId, query)` — the tenant is read from an EXPLICIT `tenantId` PARAMETER (not `ctx.auth`), and BOTH entry points call it: the public `vaultGround` tenantAction passes `ctx.tenantId` (its args/name/`{docIds,context}` return + SMOKE:: seam + ranking byte-for-byte unchanged — both pre-existing public tests stay green), and the NEW `vaultGroundHydrated` internalAction passes its explicit `tenantId` arg (the identity-less `internal.gmail.search`/`internal.llm.digestInbox` convention — the cockpit tool loop + eval harnesses carry no live identity, so Plan 02's `runCockpitAgent` calls it as `internal.vaultGround.vaultGroundHydrated({ tenantId, query })`). `vaultGroundHydrated` hydrates the fused docIds into three PARALLEL arrays `{ docIds, titles, chunks }`: titles via the tenant-scoped batch `internal.vault.ownedDocsMeta` (a cross-tenant/missing id drops out — VALT-03), chunk TEXT via `internal.vault.getDoc` (fail-closed cross-tenant), each slice bounded by `PER_DOC_CHAR_CAP` (1500) with a running `TOTAL_CHAR_CAP` (8000) so a large fused corpus never blows the agent-loop context. The hydrated text is returned into the tool loop ONLY — never into any audit/DLQ/telemetry payload (§4; Plan 02's `searchVault` tool owns the refs-only `vault.searched` audit). A foreign explicit `tenantId` yields empty parallel arrays (VALT-03 holds through the hydrated surface — the explicit arg is the only scope; no identity to fall back on). Ceiling (`ponytail:` in source): doc-level text, not chunk-precise — upgrade path is threading `rag.search` result `content` for the vector seeds and reserving `getDoc` for graph neighbors only. Verified: `pnpm --filter @pikar/backend vitest run vaultGround` 12/12 green (hydration parity, per-doc + total caps, cross-tenant empty via explicit tenantId, both unchanged public engine tests); `vaultGround.ts`/`vaultGround.test.ts` typecheck clean; `packages/vault/src/fusion.ts` untouched. The `internalAction` import needs no Biome allow-list change (§2's `noRestrictedImports` bans only `query`/`mutation`/`action`, not the `internal*` builders). Prior: 2026-07-20 (6) — Stranded-"processing" bug FIXED (owner-reported: a voice brief + a PDF stuck "processing" 5+ min, never finishing; an image succeeded). ROOT CAUSE: all five `ingestDoc` start sites called `workflow.start` WITHOUT an `onComplete`, so when an ingest step died (here: this session's repeated backend restarts exhausted the in-flight embed/extract retries) the workflow ended but NOTHING marked the doc — it sat at `processing` forever (only success→`markReady` or a governed stop→`markFailed` ever wrote a terminal status). Two 6-day-old brain-dumps were stranded the same way. FIX: `vaultIngest.startIngest(ctx, {...})` is now the SOLE ingest starter — it wraps `workflow.start` with `onComplete: internal.vaultIngest.onIngestComplete`, which on a failed/canceled run flips a still-`processing` doc to `failed` (idempotent; success + already-terminal untouched). All 5 sites (vault.ts ×4, voice.ts ×1) route through it, so a 6th cannot reintroduce the omission. `retryStuckIngests` re-queues stranded docs (recovered the 4 live). Verified: 4 new `onIngestComplete` tests + full vault/voice suites (32) green, backend typecheck clean, the 4 stranded docs recovered on the live deployment. Prior: 2026-07-18 (5) — Media fit + image full-screen (owner-directed): the media pane is `overflow: hidden` (a single image/video always FITS the pane — media never scrolls; text keeps `auto` because reading scrolls), and images gained a "View full screen" pill that calls the native `requestFullscreen()` on the img — the same full-view the video player's control already offers. Prior: 2026-07-18 (4) — Preview modal FIXED geometry (owner-reported: buttons cut off at the card edge, inconsistently per doc): `max-height` alone let tall content size the card past the viewport cap, and the `overflow: hidden` edge then amputated the pinned actions footer — per-doc, which read as "sometimes the buttons are missing". `.vault-preview-grid` now has an explicit `height: min(85vh, 56rem)` + `grid-template-rows: minmax(0, 1fr)` (stacked mode already bounds its two rows), so EVERY card — text, image, video, any content length — has identical geometry with the actions footer always in the same visible place. Media panes center their content (`place-items: center`) and img/video size to the definite pane height (`max-height: 100%`, `object-fit: contain`). Prior: 2026-07-18 (3) — Transcription timeout + pinned modal actions (owner-reported): a 21 MB mp4 failed with `TimeoutError` — `vaultTranscribe`'s 45s `CALL_TIMEOUT_MS` (copied from intake.ts, tuned for seconds-long mic clips) can't cover upload+transcription of a near-cap video; raised to 480s (under Convex's 10-min node-action limit). Timeout errors now map to the static reason `transcribe_timeout`. Verified live: the failed 21 MB video re-ran to `ready`. PreviewModal's detail panel restructured to fixed header / scrollable middle / PINNED actions footer — documents with many extracted entities were scrolling Download/Delete/Open-in-workspace out of sight (media docs, with few entities, kept theirs visible — the reported asymmetry). Prior: 2026-07-18 (2) — Soundless-video honesty + preview media containment (owner-reported): a second mp4 failed on whisper-1 with `AI_APICallError: The audio file could not be decoded` — byte-level mp4 box inspection proved the file has ONE track (`vide`/avc1, NO audio track), so there is nothing to transcribe. `transcribeDoc`'s catch now maps that decode error to the static reason `no_audio_track_or_undecodable` (card renders "no audio track or undecodable"); other errors stay `transcribe_failed`. PreviewModal media are now contained: img/video get `object-fit: contain` + `max-height: 62vh` (full image visible, never cropped at the card edge), and stacked mode bounds both rows (`minmax(0,1.3fr) minmax(0,1fr)`) so tall media can't push the detail panel past the card's overflow-hidden edge. Ops note: vitest false-reds (`crypto is not defined` in convex-test workers) appear under CPU saturation — kill runaway processes and re-run `--maxWorkers=1` before trusting a red. Prior: 2026-07-18 — Video transcription fix (owner-reported: a 6 MB mp4 failed): `transcribeDoc` now transcribes with `whisper-1` instead of `gpt-4o-transcribe`, which rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided`). whisper-1 demuxes the audio track; both bill at 0.006/min so the cost model is unchanged. Verified live on the shared local deployment: the failed 6 MB mp4 re-transcribed to `ready` + embedded. The terminal catch-all now `console.error`s the API error message (refs-safe) so a `transcribe_failed` is no longer a silent dead-end. `intake.ts` intentionally stays on gpt-4o-transcribe (its inputs are mic audio, which that model supports + transcribes more accurately). Prior: 2026-07-18 — Post-3.8 human-verify tuning (owner-reported during phase-close): the per-file cap became per-kind — `VAULT_FILE_CAP_BYTES` raised 8 MiB → **100 MiB** for docs/images, new `VAULT_VIDEO_CAP_BYTES` = **25 MB** for video (the transcription API's hard limit). Enforced at the `vaultUpload` chokepoint (per-kind branch, specific messages) and mirrored in `Dropzone.tsx` as a fast pre-upload guard (two local numbers + sync comment — no new web dep on the Node-oriented `@pikar/vault` barrel). `PreviewModal.tsx` no longer overlaps on narrow screens: the two-pane grid moved to `.vault-preview-grid`/`.vault-preview-main` in `globals.css` and STACKS to one column below 48rem (divider flips right→bottom border), and the extracted-text pane now shows a 1500-char snippet with a "Show full text" expander instead of dumping the whole document. Video >25 MB and large-doc extraction memory/time logged under Known gaps. Verified: `@pikar/vault` cap/category tests green, `@pikar/backend` `vault.test.ts` + `vaultTranscribe.test.ts` green (26 incl. new per-kind cap tests), web typecheck clean, biome clean on all touched files. Prior: 2026-07-18 — Phase 3.8 Wave 3 (03.8-06 integration): all four Wave-2 lanes merged to `main` and the merged whole proven green. Lane 1 (`vaultExtract.ts` — PDF text-layer-first + hosted OCR + image), Lane 2 (`packages/vault/src/officeText.ts` — DOCX/XLSX/PPTX flatten), Lane 3 (`vaultSweep.ts` backlog sweep + `retryExtraction` + the vault-route lifecycle UI + `vault.spec.ts` E2E), and Lane 4 (`vaultTranscribe.ts` — video/audio transcription rail) are now the real dispatcher end to end: `vaultUpload` → `extractDoc`/`transcribeDoc` (kind-dispatched, self-gated via preCall, scan-then-audit refs-only, char-capped) → `ingestExtractedText` seam → embed + graph. The two EXTR-H rows in `apps/web/e2e/vault.spec.ts` are now UN-skip-guarded (Wave-0 stubs are real, so the SMOKE::extract:: pdf + SMOKE::transcribe:: mp4 walks assert a clean pending_extraction → ready terminal, not the old `failed("not_implemented")` branch). Verified on merged `main`: backend vitest 317/318 (only red = pre-existing `audit.test.ts` auditCounts-unregistered, documented since Phase 2), `@pikar/vault` 42/42 (officeText 15/15), web typecheck clean, `biome lint` clean on all merged vault files, `check-playbooks` green. `_generated/` regenerated (`npx convex codegen`) so `api.d.ts` carries all four modules. Append-only singletons (STATE/ROADMAP/vault.md/deferred-items) resolved keep-both per PARALLELIZATION §"three shared singletons". Prior: 2026-07-18 — Phase 3.8 Wave 0 (03.8-01): the extraction CONTRACT landed on `main` — `vaultDocuments.status` grew `extracting` (+ `extractionTruncated` optional flag), `vaultUpload` now schedules `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` by `extractionKindFor(mimeType, filename)` for non-searchable binaries (TXT/MD/CSV path untouched), and the scheduler-safe internal seam `ingestExtractedText` + `markExtracting` + `getDocForExtraction` sit next to markReady/markFailed. `@pikar/vault` gained `extractKind.ts` (classifier + caps consts, on the barrel) and the `officeText.ts` stub (subpath-only — keeps fflate out of the V8 bundle). `unpdf@1.6.2`/`fflate@0.8.3` pinned; the lockfile, both package.jsons, `schema.ts`, `vault.ts`, and `watch.json` are FROZEN for the rest of the phase (see `## Extraction lifecycle (Phase 3.8)` + `.planning/PARALLELIZATION.md`). Prior: 2026-07-17 — overflow containment fix (user-reported): long unbroken filenames painted past the doc cards. In `DocGrid.tsx` grid (column) view the info span's cross-axis shrink-to-fit sized it to the full nowrap-title width (min-content = max-content for nowrap text), so the ellipsis never engaged — capped with `maxWidth: 100%`; `PreviewModal.tsx`'s title `h2` got `minWidth: 0` so `flex: 1` can actually shrink it and `break-word` wraps instead of pushing past the panel. Visual containment only — no data/query/status changes; web typecheck clean. Prior: 2026-07-15 — owner-directed shell fusion + glass/clay uniformity, in two passes. Pass 1 fused the route full-bleed: `(app)/layout.tsx`'s `is-bleed` match widened to `/^\/dashboard\/(workspace|vault)/`, so `<main>` drops its canvas padding and locks overflow, and `vault/page.tsx`'s root became a `.vault-surface.pane-canvas` (the workspace canvas's teal aura) with an inner `.vault-scroll` owning its own scroll (is-bleed locks `<main>`). Pass 2 gave the board pieces the actual glass-over-clay treatment (the fusion alone left the tiles flat): shared `globals.css` classes `.clay-card` (frosted translucent pane + `backdrop-filter` blur + extruded shadows — an outer drop, an inner top light edge, a soft inner bottom shade; hover-lift for `button.clay-card`), `.clay-badge` (extruded icon badge mirroring `.rail-logo`), and `.clay-dropzone` (lighter frosted panel). Applied by className to the VaultStats tiles + their icon badges, the CategoryTabs container, the DocGrid search bar + doc cards + card icon badges, and the Dropzone panel + its icon (each dropped its inline `var(--card)`/border/flat-shadow; radius + layout stay inline). The `backdrop-filter` frosts the aura, so these only read right on `.pane-canvas`. PreviewModal is intentionally left solid — it sits on a dark scrim, not the aura, so frosting would just muddy the scrim. Internal vault behavior and all `vault.spec.ts` selectors unchanged; web typecheck clean. Prior: 05-07b — LIVE browser human-verify (real user, Claude-in-Chrome): the vault route renders a 1:1 brand match; a pasted Brain Dump ingested end-to-end through the REAL pipeline (embed → graph-extract → upsert → `ready`), and the preview modal surfaced the correctly-extracted entities (Meridian Health/CareLink/Vantage Systems `org`, Alan Ford/Nina Osei `person`) + a typed `led by` relationship. The live run CAUGHT + FIXED a P0 the offline SMOKE suite could not: `vaultRag.ts` passed a spec-"v4" `openai.embedding(...)` model to RAG's ai@6 (`AI_UnsupportedModelVersionError`) — replaced with a v2 `openaiEmbeddingV2` REST adapter (+ a `vaultRedaction.test.ts` static guard). Also surfaced: ingest needs `skills:seedSkills` run against the deployment (`NO_ACTIVE_SKILL: graph-extractor` otherwise).
>
> Prior: 05-07 — phase close (VALT-01/03/04): the Playwright vault E2E (`apps/web/e2e/vault.spec.ts` — honest-zero → paste a `SMOKE::graph::` Brain Dump → processing→ready reactively → search → preview with entity chips → delete → empty, over the OFFLINE SMOKE:: ingest, Playwright-discovered + type-loads) and the live `smoke:vault` gate (`packages/backend/scripts/run-smoke-vault.mjs` + `packages/backend/convex/vaultSmoke.ts`: seed 2 briefs sharing an entity with a REAL `rag.add` embed → poll ready → assert live hybrid `rag.search` returns the seed → assert `vaultGround`'s live path merges the graph neighbor reached via the shared entity → assert no raw brief text in any audit/deadLetters row §4; a try/finally purge). The human-verify against `brand-024242`/`brand-024258` is the phase gate. `vaultSmoke.ts` is a smoke-only internal helper (explicit `tenantId` — the CLI carries no identity); its live run is the runnable check (no colocated convex-test — the rag/workflow components don't run under it).
> Prior: 05-06 — the Knowledge Vault UI route landed (VALT-04): `apps/web/app/(app)/dashboard/vault/` — `page.tsx` (headline + teal Refresh + Loading pill + lifted category/selected state), `VaultStats.tsx` (4 tiles), `CategoryTabs.tsx` (the 6 tabs), `Dropzone.tsx` (generateUploadUrl→vaultUpload + Brain-Dump paste→vaultIngestText), `DocGrid.tsx` (search via `vaultSearch` + N ITEMS + grid/list), and `PreviewModal.tsx` (in-place Esc/X modal: text/image/video preview + metadata + this-doc `docEntities` chips/edges + on-demand `vaultDownloadUrl` browser download + `deleteVaultDoc` reactive-remove + Open-in-workspace link). A signed download/media URL is rendered into `<img>`/`<video>`/`<a>` ONLY, never logged (§4). Nav entry added in `(app)/layout.tsx`; tokens only (globals.css)
> Prior: 05-05 — the READ plane landed: `vaultGround.ts` (`vaultGround` tenantAction — `rag.search` hybrid seeds → map entries to docIds → hop-capped `expand` → `fuse`, `namespace=tenantId` + tenant-scoped expand isolation, `SMOKE::<docId,…>` offline seam via `ownedDocsMeta`) and the `vault.ts` read surfaces (`listVaultDocs`/`vaultStats`/`vaultDownloadUrl` bearer-capability guard/`docEntities`/`vaultSearch` — the same `rag.search` hybrid primitive post-filtered to a category), covered by `vaultGround.test.ts`
> Prior: 05-04 — the durable ingest spine: `vault.ts` (tenant `vaultIngestText`/`vaultUpload` hash-dedup + accept-but-defer + `deleteVaultDoc` cascade/orphan-GC; internal `getDoc`/`markReady`/`markFailed`), `vaultIngest.ts` (`workflow.define` store→embed→extract→upsertGraph→recordSpend→ready with a `preCall` gate), and `vaultRag.embedDoc` (rag.add + hash dedup + `SMOKE::` bypass), covered by `vault.test.ts` + the `vaultRedaction.test.ts` §4 static scan
> Prior: 05-03 — the graph plane: `vaultLlm.ts` (V8 `extractGraph` — redact-then-extract + registry prompt + `SMOKE::graph::` seam) and `vaultGraph.ts` (`upsertGraph` cross-doc dedup + degree; `expand` hop-capped tenant-scoped BFS over `bfsNeighbors`)
> Build history: `.planning/phases/05-knowledge-vault-graphrag/` · Related ADRs: [001](../decisions/001-convex-data-orchestration-plane.md), [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

A per-user **Knowledge Vault** with **GraphRAG** grounding (VALT-01..04). Briefs/documents are
stored, embedded, and entity/relationship-extracted at ingestion; requests can be grounded via
**hybrid vector + hop-capped graph retrieval** scoped to the requesting user; and the user can
browse, preview, search, and download their own vault contents through the committed brand UI
(`docs/design/brand/brand-024242.png` / `brand-024258.png`). Built on the installed
`@convex-dev/rag@0.7.5` (vector + hybrid search) + `@convex-dev/workflow` durable ingest + a
bespoke Convex graph plane (`graphNodes`/`graphEdges`), with domain logic in the pure-TS
`@pikar/vault` package.

## Key files

Pure packages:
- `packages/vault/src/normalize.ts` — `normalizeName` (case/whitespace collapse → cross-doc dedup key).
- `packages/vault/src/categories.ts` — `categoryFor(source, mimeType)` (→ one of 6 vault categories), `isSearchable(mimeType)` (Phase-5 searchable set TXT/MD/CSV), `VAULT_CATEGORIES` (the fixed-6 runtime tuple → the `vaultStats.categories` count + UI tabs).
- `packages/vault/src/traversal.ts` — `bfsNeighbors(adjacency, seeds, hopCap)` (pure hop-capped BFS, no Convex import).
- `packages/vault/src/fusion.ts` — `fuse(...)` vector-seed + graph-expand merge/dedupe/rank.
- `packages/vault/src/constants.ts` — `VAULT_FILE_CAP_BYTES` (100 MiB, docs/images), `VAULT_VIDEO_CAP_BYTES` (25 MB, the transcription-API ceiling), `GRAPH_HOP_CAP` (= 2).
- `packages/vault/src/index.ts` — re-exports the package surface.

Backend adapters (thin):
- `packages/backend/convex/vaultRag.ts` — the single `rag` construction site (05-02).
- `packages/backend/convex/vaultGraph.ts` — `upsertGraph` (cross-doc dedup on `(tenantId, type, normalizedName)` + degree bookkeeping) + `expand` (hop-capped tenant-scoped BFS delegating to `@pikar/vault` `bfsNeighbors`).
- `packages/backend/convex/vaultLlm.ts` — the DEFAULT-runtime (V8) `extractGraph` (NEVER a second `"use node"` module): registry prompt, `scanText` fail-closed BEFORE the model call, `generateObject` → `{nodes,edges,costUsd}`, `SMOKE::graph::` offline seam. Holds a temporary `getDocText` reader; `internal.vault.getDoc` (05-04) is the canonical richer reader the embed step uses.
- `packages/backend/convex/vaultRag.embedDoc` (05-04) — the ingest embed step: reads the doc via `internal.vault.getDoc`, `scanText` fail-closed BEFORE `rag.add`, hash-dedups on `(namespace=tenantId, key=contentHash)`, `SMOKE::` bypass (no network). Returns `{entryId, costUsd}`.
- `packages/backend/convex/vault.ts` (05-04/05-05) — the tenant ingest mutations (`vaultIngestText` paste/late-text seam + `vaultUpload` accept-but-defer, both hash-dedup), `deleteVaultDoc` cascade (row + rag chunks + graphEdges, orphan-node GC), the internal lifecycle (`getDoc`/`markReady`/`markFailed`), and (05-05) the READ plane: `listVaultDocs`/`vaultStats` (cheap, no vectors), `vaultDownloadUrl` (owner-only signed URL, bearer capability, never logged §4), `docEntities` (owner-guarded per-doc nodes/edges), `vaultSearch` (the `rag.search` hybrid primitive post-filtered to a category), and `ownedDocsMeta` (the tenant-scope resolve seam shared by grounding + search). Starts ingest ONLY via `vaultIngest.startIngest` (never a bare `workflow.start`).
- `packages/backend/convex/vaultIngest.ts` (05-04; failure-handling 2026-07-20) — `ingestDoc = workflow.define(...)`: `preCall` gate (governed stop → `markFailed`, never a DLQ throw) → `embedDoc` → `extractGraph` → `upsertGraph` → `recordSpend` → `markReady`. Plus `startIngest` (the SOLE ingest starter — `workflow.start` + the `onComplete`), `onIngestComplete` (failed/canceled run → `markFailed`, so a dead run can never strand the doc at `processing`), and `retryStuckIngests` (re-queue stranded docs).
- `packages/backend/convex/vaultGround.ts` (05-05) — the standalone grounding action `vaultGround({query})`: `rag.search` hybrid seeds → map entries to `vaultDocuments` ids → hop-capped `internal.vaultGraph.expand` → `fuse` merge/dedupe/rank → one context block. `namespace=tenantId` + tenant-scoped expand = a different tenant's corpus never enters. `SMOKE::<docId,…>` offline seam resolves seeds through the tenant-scoped `ownedDocsMeta` (no embedding call). Cockpit/pipeline call-site DEFERRED (Lane A).

Phase gate (05-07):
- `apps/web/e2e/vault.spec.ts` — the Playwright browse/search/preview/delete loop (VALT-04) over the offline `SMOKE::graph::` ingest (paste → processing→ready → entity chips → delete). Under the shared e2e harness (also cockpit.md's watch); the live green run may defer to `/gsd:verify-work` (auth-harness precedent).
- `packages/backend/scripts/run-smoke-vault.mjs` + `packages/backend/convex/vaultSmoke.ts` — the live-deployment gate (VALT-01/03): REAL embed + hybrid `rag.search` + `vaultGround` graph-neighbor merge for tenant "smoke", refs-only §4 scan, failure-proof purge. Internal-only (the CLI has no identity), so every helper takes `tenantId` explicitly.

Frontend (05-06):
- `apps/web/app/(app)/dashboard/vault/` — the Knowledge Vault route + components (match the brand screenshots 1:1): `page.tsx` (composition + lifted category/selected state, Refresh re-subscribes via a `nonce` key), `VaultStats.tsx`, `CategoryTabs.tsx`, `Dropzone.tsx` (upload + Brain-Dump paste), `DocGrid.tsx` (search + N ITEMS + grid/list; exports `VaultDoc`/`fmtSize`), `PreviewModal.tsx` (in-place preview + `docEntities` + on-demand download + reactive delete), `icons.tsx` (inline SVGs, no icon library).

## Dependencies & blast radius

Run `graphify query "vault"` for the current subgraph. Couplings graphify cannot see:
- `@convex-dev/rag@0.7.5` (pinned, §6) — `namespace = tenantId` per-user isolation (VALT-03).
- `@convex-dev/workflow@0.4.4` (pinned, §6) — durable `store → embed → extract → ready` ingest.
- `convex/lib/functions.ts` tenant wrappers (§2), `convex/lib/hash.ts` `contentHash` dedup, `convex/guardrails.ts` + `@convex-dev/rate-limiter` + `packages/cost` (governance), `packages/pii` `scanText` (redaction).
- The `graph-extractor` registry skill (§5) — versioned skill row, no hardcoded prompt.
- `xlsx` (SheetJS) **pinned to the vendor CDN tarball** `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, EXACT, no caret (§6). **NOT npm `xlsx@0.18.5`** — the last registry publish carries CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS), and this code parses untrusted uploads. Subpath-only (`@pikar/vault/xlsText`) so ~1 MB enters ONE node action. Also a DEV-only dep of `@pikar/backend` for test fixtures; nothing in production imports it from there.
- **Adding a dependency to a node action?** Check its `package.json` for an `exports` map + a real ESM build FIRST — see the STATIC-import invariant below. That one fact predicts whether it will silently break in the deployed bundle while every test stays green.

## Data flow

1. Ingest mutation writes a `vaultDocuments` row `status:'processing'` + stores text (raw content lives ONLY here + rag chunks — the tenant-scoped content plane, NOT the §4 honeypot).
2. `@convex-dev/workflow` runs `store → embed → extract → ready`: `pii.scanText` (fail-closed) → embed `safeText` via rag → `vaultLlm` graph-extractor emits typed entities/relationships → upsert `graphNodes`/`graphEdges`.
3. Grounding: `vaultGround({query})` → rag vector search (top-K seed chunks) → map to graph nodes → `bfsNeighbors` hop-capped expansion → `fuse` merge/dedupe/rank → one grounding context block.
4. Delete cascades: remove the row + rag chunks + `graphEdges` with `sourceDocId = doc`; nodes whose `degree` hits 0 are garbage-collected.

## Extraction lifecycle (Phase 3.8)

Binary uploads (PDF/image/Office/video/audio) get their text extracted server-side and fed into
the SAME ingest workflow TXT uploads ride. The Wave-0 contract (03.8-01) fixed these rules:

- **Status walk:** `pending_extraction → extracting → processing → ready | failed(+failureReason)`.
  The row stays `pending_extraction` at insert; the extraction ACTION flips it to `extracting`
  via `markExtracting` when work actually starts (honest pill). `processing` onward is the
  existing embed→graph half, unchanged.
- **The seam invariant:** an extraction action produces TEXT and calls
  `internal.vault.ingestExtractedText({docId, tenantId, text, truncated})` — it NEVER writes
  embeddings, rag entries, or graph rows itself. The seam patches text/hash/size, flips to
  `processing`, and starts `internal.vaultIngest.ingestDoc` (mirrors the public `vaultIngestText`
  docId path; internal because scheduler-invoked actions have no identity). Fail-closed tenant
  guard. Stores RAW extracted text (consistent with TXT uploads — the content plane holds the
  user's own data; downstream model paths re-scan).
- **Caps (from `@pikar/vault` `extractKind.ts`):** `VAULT_EXTRACT_CHAR_CAP = 400_000` chars
  stored via the seam (under Convex's ~1 MiB doc cap — pass `truncated: true` when it bites,
  which sets `extractionTruncated` for the UI's honesty note); `VAULT_EXTRACT_PAGE_CAP = 50`
  pages sent hosted for scanned PDFs; `MIN_CHARS_PER_PAGE = 25` garbage-text-layer threshold;
  `TRANSCRIBABLE_CONTAINER_MIME` = the containers the transcription endpoint accepts (NOT
  `video/quicktime` — unsupported containers `markFailed("unsupported_video_container")`).
- **Redact-then-audit ordering (§4):** `scanText` runs on the extracted output FAIL-CLOSED
  BEFORE any audit write (the intake.ts ordering); audit payloads carry refs/ids/counts ONLY
  (`vaultDocId`, `kind`, `path`, `piiCounts`, `charCount`, `truncated`) — never text.
- **Governance:** every extraction action opens with `internal.guardrails.preCall` (kill switch +
  daily budget); a governed stop is a RETURN + `markFailed(reason)`, never a throw/DLQ.
- **Bytes via storage, never args:** actions load bytes with `ctx.storage.get(storageId)`
  (resolved via `getDocForExtraction`) — node-action args cap at 5 MiB, vault files go up to
  100 MiB (video 25 MB), so bytes MUST travel through storage, never mutation/action args.

### Lane ownership (Phase 3.8)

Four parallel Wave-2 worktree lanes fill the Wave-0 stubs. Each lane appends its build notes
ONLY inside its own subsection below (keeps the Stop hook satisfied per-lane with no cross-lane
merge conflicts). See `.planning/PARALLELIZATION.md` for the branch/ownership table.

#### Lane 1 — PDF + images (`convex/vaultExtract.ts` + test)

SHIPPED (03.8-02, 2026-07-18). `extractDoc` is the real dispatcher: preCall gate (governed
stop = RETURN + `markFailed(reason)`) → `markExtracting` → bytes via `ctx.storage.get` →
`SMOKE::extract::` sniff (intake grammar; `PII_POISON::` routes scanText's own Err branch) →
dispatch by `extractionKindFor`: pdf = unpdf text-layer first (free, `path: "text_layer"`),
hosted gpt-4o-mini fallback when the `MIN_CHARS_PER_PAGE` garbage heuristic trips (sliced to
`VAULT_EXTRACT_PAGE_CAP` via pdf-lib `copyPages` first); image = hosted with the real
mediaType (extractVisual shape verbatim, attachment-extractor skill, priceUsage→recordSpend);
office = `@pikar/vault/officeText` subpath (its throw → `office_parse_failed` — Lane 2's merge
needs zero Lane-1 changes) → scanText FAIL-CLOSED before any audit write → refs/counts-only
audit (`vault.extracted` / `vault.extraction_failed`) → `VAULT_EXTRACT_CHAR_CAP` truncation →
`ingestExtractedText` seam (raw post-gate text). Whole body try/caught → `extract_error:` reason.

Lane-1 gotchas locked in by `vaultExtract.test.ts` (static scans + convex-test):
- **`Promise.withResolvers` polyfill sits before any unpdf usage** (Pitfall 1 — Convex node
  actions default to Node 20; only the deployed smoke can surface this).
- **pdf.js detaches the buffer it is handed** — `getDocumentProxy(bytes.slice())`, never the
  original, or the hosted-fallback slice reads a zeroed buffer (caught offline).
- **Pitfall 9 — pdf-lib MUST be a STATIC import; a dynamic one silently yields `undefined`.**
  pdf-lib has no `exports` map (`main: cjs/index.js`), and Convex bundles node actions with
  esbuild `format: "esm", splitting: true`, which cannot synthesize a CJS module's named exports
  across a dynamic-import chunk — the namespace is `{ default }` only. Node/vitest hide this via
  `cjs-module-lexer`, so it is a DEPLOY-ONLY failure. `unpdf` may stay dynamic (ESM-only).
  Locked by the `pdf-lib is a STATIC import` static scan in `vaultExtract.test.ts`.
- Tests run under **fake timers** (the seam's `workflow.start` otherwise retry-loops against
  vitest's torn-down module runner for minutes on Windows) and use word-shaped truncation
  filler (a 400k unbroken alphanumeric run makes the pii email regex backtrack O(n²)).
- Hosted-branch selection is observed offline via the unseeded registry's fail-closed
  `NO_ACTIVE_SKILL` (no model call is ever attempted in tests).

#### Lane 2 — Office parsers (`packages/vault/src/officeText.ts` + test)

Wave-0 stub in place (throws `office_parse_not_implemented`). Lane 2 replaces the body: fflate
`unzipSync` + attribute-tolerant XML text-walk for DOCX/XLSX/PPTX (entity decode, sharedStrings
indirection, numeric slide sort). Pure TS, zero Convex edits, NOT on the index barrel.

**Landed (03.8-03, 2026-07-18):** `extractOfficeText(bytes, mimeType)` is real — one
`unzipSync` + one attribute-tolerant regex text-walk (`<tag ...>...</tag>`, Pitfall 7) shared by
all three formats; entities decoded (5 named + numeric dec/hex). DOCX: `word/document.xml`,
runs joined per `</w:p>` paragraph, newline-separated. XLSX: optional `xl/sharedStrings.xml`
`<t>` index, `t="s"` cells resolved / literal `<v>` kept, tab-joined rows, `Sheet N` headers,
numeric filename sort (sheet2 < sheet10). PPTX: `ppt/slides/slide*.xml` numeric sort, `Slide N`
headers, `<a:t>` runs newline-joined. Every failure throws `office_parse_failed: ...` (not a
zip / missing part / unrecognized mime) — the Lane-1 dispatcher converts to
`markFailed("office_parse_failed")`. Deterministic (asserted per format). All fixtures built
in-test with `zipSync`/`strToU8` — no binary fixtures in repo. Verify:
`pnpm --filter @pikar/vault test` + `tsc -p . --noEmit` (strict-index clean). Known ceiling
(`ponytail:` comment in source): a rich-text `<si>` with multiple runs indexes as multiple
sharedStrings entries; per-`<si>` grouping is the upgrade if real workbooks surface it.

#### Lane 3 — Sweep + UI + E2E (`convex/vaultSweep*.ts` + `apps/web/.../dashboard/vault/` + `apps/web/e2e/vault.spec.ts`)

No stub (new files are Lane 3's to create): migrations-based backlog sweep + `retryExtraction`
tenantMutation; DocGrid/PreviewModal `extracting` pill + Retry + truncation note; offline E2E.

LANDED (03.8-04, 2026-07-18): `vaultSweep.ts` — `sweepPendingExtraction`
(`migrations.define` over `vaultDocuments`: `pending_extraction` + `storageId` + recognized
`extractionKindFor(mimeType, title)` → kind-dispatched `scheduler.runAfter` onto the frozen
stub names; each scheduled action self-gates via `preCall`, so the sweep needs no separate
rate-limit config), `runSweep` operator one-shot (`npx convex run vaultSweep:runSweep` — the
production run is 03.8-06's job post-merge), and `retryExtraction` (tenantMutation: owner +
`failed|pending_extraction` + storageId + kind guards, clears `failureReason` +
`extractionTruncated`, re-schedules by kind, refs-only `{ok}` return). `vaultSweep.test.ts`
(10 cases) drives the migration directly in its documented one-batch mode
(`{cursor: null, oneBatchOnly: true}` — no component round-trip) and asserts scheduled names
off `_scheduled_functions`. UI: `DocGrid` gained the `extracting` chip + a failed-card Retry
rendered as a SIBLING button in a relative wrapper (never nested inside the card button —
invalid HTML); `PreviewModal` gained the failed panel (human-readable `failureReason` +
Retry) + the `extractionTruncated` honesty note (calm, no amber — §2) + extracting preview
copy; `page.tsx` resolves the LIVE row for the modal so a panel Retry flips reactively;
`Dropzone` copy is honest again (PPTX searchable; images/videos extracted + searchable).
`vault.spec.ts` gained the two EXTR-H SMOKE:: upload rows (`SMOKE::extract::` pdf +
`SMOKE::transcribe::` mp4, sentinel bytes chaining into the `SMOKE::graph::` ingest seam)
with a self-cleaning skip-guard while the Wave-0 stubs return `not_implemented` — remove the
guard at 03.8-06 integration.

#### Lane 4 — Video transcription (`convex/vaultTranscribe.ts` + test)

Wave-0 stub in place (`transcribeDoc` → `markFailed("not_implemented")`). Lane 4 replaces the
body: preCall → markExtracting → load bytes → SMOKE::transcribe:: sniff →
`TRANSCRIBABLE_CONTAINER_MIME` check (honest failure on e.g. `.mov`) → `experimental_transcribe`
(intake shape, duration-priced spend) → scan gate → refs-only audit → seam. No skill, no dep.

**Built (03.8-05, 2026-07-18):** `transcribeDoc` is live — the full spine above, structured as
one `internalAction` with a terminal catch-all (`markFailed("transcribe_failed")`, static
refs-only reason). Invariants proven offline by `vaultTranscribe.test.ts` (6 sentinel tests, no
video fixtures): the `SMOKE::transcribe::` walk to `processing` via `ingestExtractedText`;
`audio/*` rides the same spine; `VAULT_EXTRACT_CHAR_CAP` truncation with `truncated: true`
through the seam; mime-only `video/quicktime` rejection (`unsupported_video_container`) before
any byte/API work; kill switch as a RETURN (`failed`/`kill_switch`, no throw); `scanText` Err →
`pii_scan_failed` + exactly ONE refs-only `vault.extraction_failed` audit row. Success audit
`vault.extracted` carries `{ vaultDocId, kind: "video", durationSeconds, charCount, truncated }`
— counts only, needle-scanned in-test for transcript absence (§4). The transcription call is a
COPY of intake.ts's `transcribeAudio` shape (never an import — §96 "use node" rule). Duration
ceiling is deliberate (`ponytail:` comment): the 25 MB video cap (`VAULT_VIDEO_CAP_BYTES`) sits at
the API's 25 MB limit and is enforced at upload, so every video that enters fits the API; audio
extraction/chunking is the upgrade path for >25 MB video. Known shared-code ceiling found during this lane:
`@pikar/pii` `scanText` is quadratic on long UNBROKEN uniform character runs (~6 min at 400k
chars; natural-language text of the same size scans in ~10ms) — logged in the phase's
`deferred-items.md`, not fixed here (out of lane).

## Phase 15.2 — universal format recognition

One container section for the phase. Each plan appends ONLY its own `### Phase 15.2 — 15.2-0N`
subsection below and bumps `Last verified`; nobody rewrites another plan's subsection. On merge
conflict, keep both (`.planning/PARALLELIZATION.md` § Lane V).

### Phase 15.2 — 15.2-01 (pure recognition layer)

Landed 2026-07-27: `packages/vault/src/sniff.ts` + `schedulingRailFor` in `extractKind.ts`, plus
their tests and the Lane V ownership contract. **No `convex/` file was touched, so this plan proves
nothing about a live deployment** — it is the offline half of SC#1 and the first half of SC#4.

Invariants this establishes (trust this file over the plans):

- **Recognition is CONTENT-FIRST.** `resolveRail(bytes, mimeType, filename?)` reads the bytes; the
  MIME/extension answer from `extractionKindFor` survives only as the FALLBACK behind it. A wrong,
  renamed or ABSENT MIME type no longer decides anything on its own — an `.xlsx` renamed
  `budget.dat` with an empty MIME resolves to the zip rail, and an OLE2 blob is told apart
  (doc/ppt/xls) from its own UTF-16LE directory stream names. The sniff is an OVERRIDE, not a
  replacement: `image/webp` bytes the magic table does not enumerate still reach the image rail
  through the fallback.
- **The scheduling decision is TOTAL.** `schedulingRailFor` cannot answer "nothing" — its return
  type is `"transcribe" | "extract"`, pinned by a property test over ~20 assorted MIME strings. The
  `kind === null → don't schedule` branch is the root cause of the 2026-07-26 `.xlsm` stranding
  (~20 h at `pending_extraction`, 0 chars, no `failureReason`), and it is gone BY CONSTRUCTION
  rather than by patching the reported call site. RESEARCH §3 lists all three sites that carried it:
  `vault.vaultUpload`, `vaultSweep.sweepPendingExtraction`, and `vaultSweep.retryExtraction` — the
  last being the user's Retry button, where a press produced nothing observable.
- **Why the sniff is NOT at the scheduling gate.** `ctx.storage.get` is ACTION-ONLY (queries and
  mutations get `getUrl`/`getMetadata`), so a magic-byte sniff physically cannot run inside
  `vaultUpload` or a migration mutation. Recorded here so nobody "improves" the design by moving
  the sniff back to the gate, where it cannot work. We schedule permissively and let the ONE place
  that can read bytes decide.
- **Why client-side sniffing is NOT the authority.** `Dropzone.tsx` holds the real `File` and could
  sniff it, but that is untrusted input at a trust boundary. Acceptable only as a fast pre-upload
  error message, mirroring the duplicated size caps at `Dropzone.tsx:25-26` — never as the decision.

Ponytail ceilings taken (both named in source):

- **OLE2 discrimination is an 8 KiB needle scan**, not a real CFB directory walk. Upgrade path:
  parse the FAT/DIFAT if a real file ever hides its directory past 8 KiB.
- **JSON / YAML / TSV / LOG ride the `"text"` rail** instead of widening the searchable-MIME
  allow-list, which is DUPLICATED (`packages/vault/src/categories.ts:24` and the vault
  `Dropzone.tsx:28`). Widening two allow-lists while this phase deletes a third is the wrong
  direction; the `"text"` rail gives the same user-visible outcome at the cost of one $0, no-model
  extraction action per upload. Upgrade path: widen both sets if that round-trip ever shows up as
  latency the user notices.

`sniff.ts` is dep-free (no `fflate`, no `node:*`) and is therefore re-exported from the
`@pikar/vault` index barrel — unlike `officeText.ts`, which stays subpath-only for V8-bundle
hygiene. Verify with `pnpm --filter @pikar/vault test` + `typecheck`.

### Phase 15.2 — 15.2-02 (format coverage, pure layer)

Landed 2026-07-27: `extractOfficeText` rewritten as a ZIP-entry dispatcher, plus the new dep-free
`packages/vault/src/rawText.ts`. **No `convex/` file was touched, so — exactly as with 15.2-01 —
this plan proves NOTHING about a live deployment.** It is the offline half of SC#2 and the
dependency-free half of SC#3. No dependency was added; `pnpm-lock.yaml` is untouched.

Invariants this establishes (trust this file over the plans):

- **`extractOfficeText` takes ONE argument.** It unzips once and dispatches on the MARKER ENTRY it
  finds. Adding `mimeType` back is a REGRESSION: it reintroduces the enumeration that lost the
  owner's `.xlsm`. Note what that file actually needed — **no new parser, only routing**. An
  `.xlsm` is byte-structurally an `.xlsx`: same ZIP, same entries, same walker. That is why the
  defect looked far larger than it was, and why entry dispatch makes coverage true BY CONSTRUCTION
  rather than by a list that is always one format behind.
- **The marker-entry table**, checked in this order (OOXML markers FIRST — an archive carrying both
  a `word/document.xml` and an ODF `mimetype` resolves deterministically to DOCX, and is pinned by
  a test):

  | Marker entry | Format |
  |---|---|
  | `word/document.xml` | DOCX / DOCM |
  | `xl/workbook.xml` | XLSX / **XLSM** |
  | `ppt/presentation.xml` | PPTX / PPTM |
  | `mimetype` starting `application/vnd.oasis.opendocument.` | ODT / ODS / ODP |
  | `META-INF/container.xml` | EPUB |

  No marker at all throws `office_parse_failed: unrecognized zip` — the message names the ZIP, not a
  mime type, because there is no longer a mime type to name.
- **The barrel rule is about DEPENDENCIES, not about which file it is.** A module that imports
  `fflate` or `node:*` is subpath-only, to keep those out of the V8 Convex bundle; a dep-free module
  is barrel-safe. Today that means `officeText.ts` stays subpath-only (`@pikar/vault/officeText`)
  while `sniff.ts` and `rawText.ts` are on the barrel. Any NEW parser module follows whichever side
  of that rule its dependencies put it on.
- **`oleText` THROWS rather than returning `""`.** An empty extraction that "succeeds" becomes a
  `ready` document with 0 chars — a plausible failure, which is worse than a failure, and is the
  exact silent-plausible class this phase exists to remove. `rtfText` throws on the same condition
  for the same reason. This is the same reasoning that rejects a printable-text sweep for BIFF.
- **`decodeEntities` now lives ONLY in `rawText.ts`**; `officeText.ts` imports it from there. One
  entity decoder, three callers — a future entity fix lands in exactly one place. The ODF and EPUB
  walkers likewise REUSE `runsOf` / `markupText` rather than adding a second XML walker.
- **The OLE2 stop-list is matched on the WHOLE run, never as a substring.** A substring rule would
  delete any sentence containing the word "Data". The `0x05` prefix on the two SummaryInformation
  streams is not a printable byte, so those runs already surface as the bare name and match exactly.
- **`TextDecoder("windows-1252")` is constructed LAZILY**, never at module scope. `rawText.ts` is on
  the barrel, and that constructor throws `RangeError` on a runtime built without full ICU; a throw
  at import time would take down every module that touches the barrel, whereas a throw inside
  `rtfText`/`oleText` is one honest `failed` document.

Ponytail ceilings taken (both named in source):

- **Legacy DOC/PPT is a printable-run SWEEP**, deliberately imperfect — no field codes, no table
  structure, no reading-order guarantee, and a UTF-16LE character outside Latin-1 is skipped. A
  downstream LLM structures the text; we are not round-tripping the file. Upgrade path if fidelity
  complaints surface: `word-extractor` for DOC, SheetJS for PPT/XLS (plan 15.2-07's spike).
- **EPUB reads its `(x)html` entries in ENTRY-NAME sorted order**, not OPF spine order — a book
  whose files are not lexicographically ordered reads out of order. Upgrade path: parse
  `content.opf`'s `<spine>`. Sorting (rather than trusting object key order) is what makes the
  output deterministic, and there is a test for that.

Verify with `pnpm --filter @pikar/vault test` + `typecheck`.

### Phase 15.2 — 15.2-03 (permissive scheduling + in-action dispatch)

Landed 2026-07-27: the first plan of this phase to touch `convex/`. `vault.scheduleExtraction`,
`vaultSweep.watchdogStalled`, and a rail-driven dispatch inside `vaultExtract.extractDoc`. This is
what gives 15.2-01's `resolveRail` and 15.2-02's parsers a production caller.

Invariants this establishes (trust this file over the plans):

- **`vault.scheduleExtraction` is the ONLY way an extraction is scheduled.** Three callers:
  `vaultUpload`, `vaultSweep.sweepPendingExtraction` (the recovery sweep) and
  `vaultSweep.retryExtraction` (the user's Retry button). It ALWAYS schedules and it ALWAYS arms a
  watchdog. **A fourth caller that schedules `extractDoc` directly reopens the defect** — route it
  through the helper, exactly as `vaultIngest.startIngest` is the sole ingest starter.
  Two things it deliberately does NOT do: it does not SNIFF (`ctx.storage.get` is action-only, so a
  mutation physically cannot see the bytes), and it does not decide SUPPORTABILITY (that decision
  belongs to the one runtime that can read bytes, and its refusal is terminal).
- **Every non-terminal status has exactly ONE governor, and they cannot fight:**

  | Status | Governor | Armed by |
  |---|---|---|
  | `pending_extraction` | `vaultSweep.watchdogStalled` at +15 min | `scheduleExtraction`, per attempt |
  | `extracting` | `vaultSweep.watchdogStalled` at +15 min | the same scheduled call |
  | `processing` | `vaultIngest.onIngestComplete` | `startIngest`'s `onComplete` (the 2026-07-20 stranding fix) |
  | `ready` / `failed` | terminal — nothing may re-flip them | — |

  `watchdogStalled` NEVER touches `processing` (two governors on one status is how you get a flip
  war) and NEVER overwrites an existing `failureReason` — a watchdog firing one second after a
  success, or after an honest `unsupported_format`, changes nothing. Its guard is the
  `onIngestComplete` guard, and it writes through `internal.vault.markFailed` so the terminal
  failure write stays in one place.
- **The watchdog is a SCHEDULED FUNCTION, not a cron.** There is no "status began at" field:
  `createdAt` is UPLOAD time, so a `createdAt`-based cutoff would kill a Retry on a 20-hour-old row
  on its very first tick. Per-attempt scheduling is correct where a table scan is not, needs no
  schema change, and is a native Convex durability feature rather than new code.
  `EXTRACTION_WATCHDOG_MS` is 15 min — above any honest attempt (the 480 s per-call ceiling and
  Convex's 10-minute node-action limit both bound one run), so it can never kill live work.
- **The rail is resolved from the BYTES, inside the action** — `resolveRail(bytes, mimeType, title)`
  after `ctx.storage.get`. `extractionKindFor` no longer appears in `vaultExtract.ts` at all, and a
  static scan enforces that: a byte-sniffed rail and a MIME guess disagreeing is how "it works
  except when it doesn't" gets built. The SMOKE short-circuit stays AHEAD of the dispatch
  (`vaultSmoke.ts` depends on it) — also pinned by a static scan.
- **A sniffed image with a wrong or EMPTY MIME is sent with a real `mediaType`.** Otherwise SC#1
  would "work" right up to the point the model call was silently malformed.
- **The failure-reason vocabulary now visible to a user**, and what each one means:

  | Reason | Meaning |
  |---|---|
  | `unsupported_format` | the bytes are not something any rail can read |
  | `unsupported_legacy_spreadsheet` | legacy BIFF `.xls`; remedy: re-save as `.xlsx` (SheetJS pending in 15.2-07) |
  | `office_parse_failed` | a ZIP-based office document that would not flatten |
  | `legacy_parse_failed` | an OLE2 DOC/PPT the printable-run sweep could not read |
  | `raw_parse_failed` | RTF that would not parse |
  | `empty_extraction` | the extraction succeeded and recovered ZERO characters |
  | `extraction_stalled` | still non-terminal 15 minutes after its attempt was scheduled |

- **`empty_extraction` exists on purpose.** A `ready` row with 0 chars is a PLAUSIBLE failure — the
  agent then grounds confidently on nothing — which is worse than a failure. Same reasoning as
  `oleText` throwing instead of returning `""`. Do not "fix" it by storing the empty string.
- **The corrected reading of the spec's "terminal `failed` at the `vaultUpload` chokepoint".** The
  INVARIANT holds exactly as written — an unresolvable format is terminal `failed`, never a silent
  `pending_extraction`. Its LOCATION is the action, not the chokepoint, because `ctx.storage.get`
  is action-only. This is recorded here so a future reader does not file it as a deviation.

Two test fixtures were content-LIES that content-first recognition exposed, and were corrected
rather than worked around: the PNG fixture wrote `\x89` in a JS string, which the Blob encodes as
UTF-8 `0xC2 0x89` — decodable text, not a PNG — and printable `SMOKE::extract::` bytes honestly
sniff as the `text` rail, so the audit `kind` on those rows reads `"text"`. The audit payload keeps
its `kind` KEY (existing readers unaffected) and now carries the rail: a label, refs/counts only,
never document text (§4).

**NOT YET PROVEN.** Everything above is offline-green only. This subsystem has two consecutive
incidents on record — Pitfall 9 (dynamic `pdf-lib`), then the 480 s timeout — where a green suite
sat on top of a production path that could never run. The `.xlsm` recovery is verified in plan
15.2-05 against the real deployment; nothing in this subsection should be read as live-verified
until that subsection exists.

Verify with `pnpm --filter @pikar/backend test vaultSweep -- --maxWorkers=1`,
`pnpm --filter @pikar/backend test vaultExtract -- --maxWorkers=1`, and
`grep -c "extractionKindFor" packages/backend/convex/vault.ts packages/backend/convex/vaultSweep.ts packages/backend/convex/vaultExtract.ts`
(expect 0 for all three).

### Phase 15.2 — 15.2-04 (staleness, the graph cap, failure copy)

Landed 2026-07-27. Three honesty gaps that are not about parsing. Offline-green only.

**Where stale attempt state is cleared — and why NOT elsewhere.**

| Mutation | Clears | Why there |
|---|---|---|
| `vault.markExtracting` | `failureReason` **and** `extractionTruncated` | runs at the START of every attempt (`vaultExtract.ts:165`, before any parsing). A new attempt has neither a failure nor a truncation yet. |
| `vault.markReady` | `failureReason` **ONLY** | the backstop for the seam that never passes through `markExtracting` |

**THE TRAP, written down so nobody "restores" it.** The locked 15.2-CONTEXT decision reads
*"`markReady` clears `failureReason` + `extractionTruncated`"*. Clearing `extractionTruncated` at
`markReady` is a **defect** and is deliberately not implemented: `internal.vault.ingestExtractedText`
(`vault.ts:552`) writes that flag on the CURRENT attempt, moments before the ingest workflow reaches
`markReady`, so clearing it there erases a TRUE truncation flag on every successful large-document
ingest — and `extractionTruncated` is the only thing telling a downstream consumer that the grounded
text is a head slice. A regression test pins it: a doc whose current attempt truncated reaches
`ready` with `extractionTruncated` still `true`.

`markReady` keeps its half rather than relying on `markExtracting` alone because the late-text
`docId` seam in `vaultIngestText` reaches `processing` → `markReady` **without** passing through
`markExtracting`; a previously-failed doc rescued that way would otherwise keep its old reason.

**`extractGraph` is capped — `GRAPH_EXTRACT_CHAR_CAP` = 120_000 chars (`@pikar/vault` barrel).**
Before this, it was the ONE uncapped model call in the repo: `VAULT_EXTRACT_CHAR_CAP` (400k) bounds
what is STORED, and all of it was SENT. A test asserts `GRAPH_EXTRACT_CHAR_CAP <
VAULT_EXTRACT_CHAR_CAP` — the relationship is the point; lower the extraction cap below the graph cap
and the graph cap becomes dead code.

- **Ordering is REDACT-then-CAP, never cap-then-redact.** `scanText` must see the WHOLE document, or
  PII in the tail escapes both the scan and the audit counts. `capGraphText` is applied to
  `safeText`, after the fail-closed scan.
- **The SMOKE short-circuit stays ABOVE the cap**, so the offline fixture path is unaffected.
- `ponytail:` ceiling — a HEAD SLICE, not chunk-wise fan-out. Entities appearing only in the tail of
  a very long document are missed, and **nothing persists a "graph truncated" flag** (no schema
  change was permitted this phase). Upgrade path: chunk-wise extraction with node/edge union across
  chunks, deferred until entity recall is observed to suffer.

**`apps/web/app/(app)/dashboard/vault/failureCopy.ts` is the ONE place a reason code becomes prose.**
Reason codes stay refs-only labels in `convex/` (§4); the user-facing wording lives in the surface
that renders it. Two callers — `DocGrid`'s failed card (title only, one truncated line, rendered as
card TEXT so the screen reader keeps the filename in the accessible name) and `PreviewModal`'s
failure block (title + remedy). **The raw code is never shown to a user** — it rides in a `title=`
attribute as a debugging affordance only. `PreviewModal`'s hardcoded "scanned or image-only PDFs"
sentence is DELETED; it was wrong for most of 15.2-03's vocabulary. The DOCV-01 clause that a failed
document offers no voice action is unrelated to the reason and survives verbatim.

**If you add a `fail("...")` anywhere in `vaultExtract` / `vaultTranscribe` / `vaultIngest` /
`vaultSweep`, you owe a row here** — otherwise the user reads the generic fallback.

| Reason | User-facing title |
|---|---|
| `unsupported_format` | We couldn't recognise this file's format. |
| `unsupported_legacy_spreadsheet` | This is a legacy Excel workbook (.xls). |
| `unsupported_video_container` | We can't transcribe this video format. |
| `no_audio_track_or_undecodable` | This recording has no audio we could transcribe. |
| `transcribe_timeout` | Transcribing this recording took too long, so we stopped. |
| `transcribe_failed` | We couldn't transcribe this recording. |
| `not_implemented` (legacy rows) | This file type wasn't supported when you uploaded it. |
| `empty_extraction` | We opened this file but found no readable text. |
| `extraction_stalled` | Reading this file took too long, so we stopped. |
| `office_parse_failed` / `legacy_parse_failed` / `raw_parse_failed` | We couldn't read inside this file. |
| `pii_scan_failed` | We stopped before storing this file's contents. |
| `kill_switch` / `daily_budget_exhausted` | Processing is paused right now. |
| `no_stored_bytes` / `missing_blob` / `missing_bytes` | The uploaded file couldn't be found. |
| `ingest_failed` / `ingest_canceled` | Something went wrong while indexing this file. |
| `extract_error: …`, unknown, absent | We couldn't read this file. (the generic row) |

`unsupported_legacy_spreadsheet`'s remedy — *"Open it in Excel and re-save as .xlsx, then upload it
again"* — is what makes the **SheetJS spike in 15.2-07 OPTIONAL**. If that plan never lands, this is
what the user sees, and it is actionable.

**NOT YET PROVEN.** Everything above is offline-green only: no upload was re-run and no failure card
has been viewed in a browser. `pnpm --filter web build` proves it compiles, not that it reads well.

Verify with `pnpm --filter @pikar/vault test`,
`pnpm --filter @pikar/backend test vault.test -- --maxWorkers=1`, and `pnpm --filter web build`.

## Invariants — what must never break

- **Domain logic in `@pikar/vault`, thin `convex/vault*` adapters (§1)** — the pure package has ZERO Convex imports; enforced by the colocated `packages/vault` tests running with no backend.
- **`namespace = tenantId` per-user isolation (VALT-03)** — every rag `add/search/delete` is namespaced by the tenant; reads/writes go through the `tenantQuery/tenantMutation/tenantAction` wrappers.
- **rag runtime split** — `rag.add/search/delete` are ACTION-only; `addAsync/deleteAsync/list/getEntry/findEntryByContentHash` are mutation/query-safe.
- **The graph-extractor lives in a DEFAULT-runtime (V8) `vaultLlm.ts`** — NEVER a second `"use node"` module.
- **Redact-then-extract (§4)** — the extractor receives `safeText`; graph/audit/deadLetter payloads carry refs + hashes + counts ONLY. Raw text lives ONLY in `vaultDocuments.text` + rag chunks.
- **Cross-doc dedup** — same entity across docs upserts to ONE node on `(tenantId, type, normalizedName)` via `normalizeName`, so the graph actually connects documents.
- **Hop cap = 2 (`GRAPH_HOP_CAP`)** — `bfsNeighbors` never expands past the cap; enforced by `traversal.test.ts`.
- **Pinned `rag`/`workflow` versions must not be bumped (§6)** — pre-1.0 API churn.
- **Every package reached from a `"use node"` action is a STATIC top-level import (Pitfall 9, generalised 2026-07-27).** Never `await import(...)`. Convex bundles node actions with esbuild `platform:"node", format:"esm", splitting:true`, and across a **dynamic-import chunk boundary** esbuild cannot synthesise a CJS module's named exports — the namespace carries only `default`. **THE DISCRIMINATOR IS THE PACKAGE MANIFEST, NOT THE IMPORT FORM:** a package with **no `exports` map and no real ESM build** collapses (`pdf-lib` → 1 key, `PDFDocument` undefined, live defect 2026-07-26); one shipping `"exports": { ".": { "import": "./x.mjs" } }` survives both forms (`unpdf`; `xlsx` 0.20.3 → 19 named exports either way, measured). **So: before adding ANY dependency to a node action, read its `package.json` for an `exports` map + ESM build — that single fact predicts the failure.** **A GREEN OFFLINE SUITE IS NOT EVIDENCE** — Node and vitest recover CJS named exports via `cjs-module-lexer`, so the broken production path is invisible in the suite (proven on demand: making the SheetJS import dynamic turns the scan red while **all 10 behaviour tests stay green**). Verify by rebuilding a probe with Convex's own flags from `convex/dist/esm/bundler/debugBundle.js` **and include a known-collapsing control**, or by a deployed run. Enforced by two static scans: `pdf-lib` in `vaultExtract.test.ts`, SheetJS in `xlsText.test.ts`.
- **An ingest run can NEVER strand a doc at `processing`.** `ingestDoc` writes a terminal status only on success (`markReady`) or a governed stop (`markFailed`); a DEAD run (step retries exhausted, backend interruption) writes neither. So every ingest MUST start via `vaultIngest.startIngest`, which attaches `onComplete: onIngestComplete` — a failed/canceled run flips a still-`processing` doc to `failed` (idempotent; success + already-terminal untouched). A bare `workflow.start(ingestDoc)` is the bug (five sites once did it → infinite "processing" spinners). Enforced by: the 4 `onIngestComplete` cases in `vault.test.ts`; recover any historical strands with `retryStuckIngests`.
- **The confirmed `business_blueprint` is explicitly NOT an ingest run.** `confirmBlueprint`
  writes the content-plane row directly at `status: "ready"` and deliberately starts no workflow,
  so the “every ingest starts through `vaultIngest.startIngest`” invariant remains intact. The
  Blueprint is neither embedded nor graph-extracted: retrieval cannot duplicate the standing
  spine, and the document cannot feed its own entities back into the next rebuild's degree ranking.
  `vaultSweep.sweepPendingExtraction` touches only `pending_extraction` rows that carry a
  `storageId`; the Blueprint is `ready` and byte-less, so it is never swept.

## How to change safely

- **New graph traversal / fusion behavior** → change `@pikar/vault`, add a colocated test, keep it Convex-free. The Convex `vaultGraph.expand` query builds the adjacency and calls `bfsNeighbors`; `vaultGround` calls `fuse`.
- **New category / searchable format** → edit `categories.ts` + its test; do NOT scatter category strings into adapters.
- **New ingest step** → add a durable workflow step; keep the redact-before-LLM ordering.
- **Schema change** → new tables / optional fields, no migration (prior-phase discipline).

## How to verify

- `pnpm --filter @pikar/vault test` — pure-domain tests (normalize, categories, traversal, fusion).
- `pnpm --filter @pikar/vault typecheck` — clean.
- `pnpm --filter @pikar/backend test vault vaultGround` — the Convex adapter tests: ingest/dedup/cascade + the read plane (grounding fusion, hop-cap, cross-tenant isolation, browse/stats/download-guard/docEntities/category-search). Windows note: convex-test files crash on parallel-fork teardown ("Cannot set properties of undefined (setting 'exit')") → false red; each file passes run alone.
- `pnpm --filter @pikar/backend test vaultExtract -- --maxWorkers=1` — the extraction dispatcher: rail dispatch, the per-page fan-out's SHAPE (batch width, page order, per-page isolation, the deadline), and the static scans (pdf-lib static import; the hosted branch not sending the whole document as one call). **Green here does NOT mean scanned PDFs are transcribed** — see the hosted-path check below.
- **The hosted (scanned-PDF) path is LIVE-ONLY.** The offline suite proves batching shape, and shape stays green when the model digests instead of transcribing. To verify it for real: re-extract a scanned PDF on a running deployment (`npx convex run internal.vaultExtract.extractDoc '{"vaultDocId":"…","tenantId":"…"}'` from `packages/backend`) and read the stored text — it must carry `Page 1`…`Page N` headers and **read like the document**, not like a description of it. `internal.vault.getDoc` returns the text without dumping the 20 MB `vaultDocuments` table.
- `pnpm --filter @pikar/backend smoke:vault` — the live-deployment gate (VALT-01/03): REAL embed + hybrid search + `vaultGround` graph-neighbor merge on a running `convex dev` deployment (needs its OPENAI_API_KEY).
- `pnpm --filter @pikar/web exec playwright test vault --list` — the vault E2E is Playwright-discovered + type-loads; a full green run needs the running local stack + the auth harness (may defer to verify-work).

## Operational notes

- Embedding model `text-embedding-3-small` @ 1536 dims (under Convex's 2048 cap).
- **RAG needs a v2-spec embedding model.** `@convex-dev/rag@0.7.5` bundles ai@6, whose `embedMany` accepts ONLY an `EmbeddingModelV2` (`specificationVersion: "v2"`). The backend's `@ai-sdk/openai@4` produces a spec-**"v4"** model (correct for ai@7 / `llm.ts`), which RAG REJECTS at ingest time with `AI_UnsupportedModelVersionError` — a runtime skew a `as unknown as` type-cast silences but does NOT fix. `vaultRag.ts` therefore hands RAG a hand-rolled v2 adapter (`openaiEmbeddingV2`) that calls OpenAI's `/v1/embeddings` REST API directly. NEVER pass `openai.embedding(...)` straight into the RAG constructor (guarded by the `vaultRedaction.test.ts` v2-spec static scan). Drop the adapter when the pinned RAG realigns to ai@7 (§6).
- Ingest requires the `graph-extractor` skill SEEDED in the deployment (`skills:seedSkills`) — an unseeded deployment fails the extract step with `NO_ACTIVE_SKILL: graph-extractor` (a seeding step, not a code defect; runs at boot).
- **Video transcription uses `whisper-1`, NOT `gpt-4o-transcribe`.** gpt-4o-transcribe rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided` — it wants audio-only input); whisper-1 demuxes the audio track from mp4/webm/mpeg. Both bill at `TRANSCRIPTION_PRICING` (0.006/min). `intake.ts` (voice/mic audio — webm/wav) stays on gpt-4o-transcribe on purpose: its inputs are audio, where gpt-4o-transcribe is both supported and more accurate. The `transcribeDoc` terminal catch-all `console.error`s the API error message (refs-safe) so a `transcribe_failed` is diagnosable in the function log; the `failureReason`/audit stay refs-only (§4).
- Per-file cap is per-kind: `VAULT_FILE_CAP_BYTES` (100 MiB) for docs/images, `VAULT_VIDEO_CAP_BYTES`
  (25 MB) for video (the transcription-API ceiling). Enforced at the `vaultUpload` chokepoint AND
  mirrored client-side in `Dropzone.tsx` for a fast pre-upload message. No per-tenant total quota
  this phase (single-owner beta).
- Phase-5 wires TXT/MD/CSV + Brain Dumps end-to-end; PDF/DOCX/XLSX/PPTX/Images are accept-but-defer (stored + `pending extraction`), their text arriving via the `vaultIngestText` seam when Phase 4 lands.

## Known gaps & deferred work

- The `vaultGround` cockpit/pipeline call-site is deferred (Lane A integration phase).
- **Video > 25 MB** is rejected at upload (the transcription API's hard 25 MB limit). Supporting
  larger video needs an audio-extract/compress (or chunk) step before transcription — deferred.
- **Scanned/image-only PDFs extract a SUMMARY, not verbatim text** (~2.2k chars for a 12-slide
  deck, measured live 2026-07-26). `extractPdf` sends the WHOLE PDF as one file part in one
  gpt-4o-mini call, but the `attachment-extractor` skill's contract is written for "a single image
  or document (PDF page…)" — given 12 pages at once the model digests instead of transcribing,
  despite the prompt's explicit "extract ALL of it VERBATIM" / "Never summarize". The prompt and the
  seeded registry row are correct and byte-identical; the CALL SHAPE is the defect. Upgrade path:
  per-page fan-out (pdf-lib `copyPages` already emits 1-page PDFs, which is exactly the shape the
  skill documents), concatenated in page order. Needs batching/a workflow step rather than a plain
  loop — `VAULT_EXTRACT_PAGE_CAP` (50) sequential hosted calls will not fit one action's 10-minute
  limit. Text-layer PDFs are UNAFFECTED (unpdf returns the real text layer, free and complete).
- **Large-doc extraction memory/time** — the 100 MiB doc cap lets a very large PDF reach the
  extraction action; `unpdf`/OCR on such a file may approach Convex action memory/time limits. The
  page cap (`VAULT_EXTRACT_PAGE_CAP`) and char cap bound the hosted-OCR path, but streaming/chunked
  extraction is the upgrade path if large scanned PDFs surface limits.
- Binary + OCR extraction is Lane B / Phase 4 (`vaultIngestText(docId, extractedText)` seam).
- Per-tenant storage quota, external sharing, per-item agent toggle, in-place re-embed editing — all deferred.

## Phase 16 — Web research documents

> Append-only container: each Phase-16 plan writes ONLY inside its own subsection.
> On merge conflict, **keep both**.

### Phase 16 — Wave 0 (freeze)

A new document class, `kind: "web_research"`, and one new field.

**`retrievedAt: v.optional(v.number())` (D7)** — the freshness stamp, stored and queryable.
Deliberately **not** `createdAt`: a row's creation time stops being its retrieval time the moment
anything re-creates the row (a re-ingest, a backfill). Only `web_research` docs write it; every
other writer leaves it absent, so no migration and no backfill.
`ponytail:` no dedicated index — `by_tenant` + a `kind === "web_research"` filter is the read.
Upgrade path if freshness ever needs ranking at scale: a `by_tenant_kind` index.

**⚠ ADR-006 trust assumption changes here — read before touching `searchVault`'s fence.**
The fence comment justifies treating vault text as trusted-as-own *because it is the user's own
corpus*. **A web-derived document is NOT the user's own corpus.** It is third-party content that
arrived through a model, so the premise the fence rests on does not hold for this class.

Consequences, both required:
- Every `web_research` document carries a **provenance header** naming it third-party web content,
  so the class is self-identifying wherever it is read.
- The existing fence wording ("never an instruction") already covers the **read** side — the fence
  is not weakened, its justification is. Do not "simplify" the fence by re-appealing to
  own-corpus trust.

Containment on the **write** side is D5-CORRECTED and lives in `cockpit.md`: retrieved page text
is provider-side and **cannot be fenced** — a "retrieved text is fenced" test would pass because
the text is ABSENT, not because it was fenced. Containment is the empty capability grant proved
POSITIVELY, the OUTPUT fence, and an SSRF scan with a non-vacuity floor.

### Phase 16 — 16-07 (the findings terminal)

`convex/research.ts` — `persistFindings`, an `internalMutation` in a **non-`"use node"`** module.
It is the ONLY writer of `kind: "web_research"`, and it is called from ONE place:
`persistResearchFindings` in `dispatch.ts`, after `dispatchAndLand` has already returned.

**Who writes it, and why that is not negotiable.** The research specialist has NO write capability
— that is the phase's containment. So this is a code-owned terminal the DISPATCHER runs, exactly as
`persistNextStepMemo` runs after the human Approve. If a future change gives the specialist a "save
my findings" tool, the privilege-escalation path is back.

**A successful run produces TWO artifacts, and the ORDER is load-bearing.**

| artifact | written by | authoritative for |
|---|---|---|
| the approvable memo plan card | `dispatchAndLand`'s `finally` → `landSpecialistResult` | the USER — it is what they act on |
| ONE `web_research` vault document | `research.persistFindings` | GROUNDING (Phase 12 cites it) |

The card lands FIRST. That is what makes the error handling honest: a persist failure costs
**groundability, never the findings**, so it is audited (`research.persist_failed`, reason CODE
only) and swallowed — the `DispatchResult` is returned unchanged. **Do not add a retry, a
dead-letter, or a compensating write**; the cockpit has never DLQ'd a user-facing turn. A governed
refusal writes NO document at all: a paused conversation is not a finding.

**The stored text, in order:** provenance header (`Third-party web content, retrieved <ISO date>.`
+ the partial-run sentence when the run stopped early + the source URLs) → the findings inside
16-03's `researchFindingsFence` → the **limits footer** (D10: the search was provider-executed, so
we cannot pin or choose sources, control extraction fidelity, or see what was discarded — these
findings are NOT source-audited). The three partial-run sentences come from `INCOMPLETE_MARKER` in
`@pikar/core`, the SAME constant the memo card uses, so the card and the document can never
disagree about why a run stopped.

**Zero sources ⇒ `Insufficient evidence` — decided by CODE**, whatever the body claims, and placed
ahead of the fence so truncation cannot remove it (D11: a research agent that confabulates on an
empty search is worse than none, because Phase 12 will cite it).

**⚠ Be precise about where containment lives — the honest boundary.** The RAG ingester chunks this
document, so **only the FIRST chunk carries the provenance header and the fence's open tag**;
chunks 2..N carry neither. Containment does not rest on them: `searchVault` wraps what it returns
in the shipped `<vault_context … never an instruction>` fence on **every** retrieval. The header
and the inner fence are a LABELLING win — they let a human, or a model reading the first chunk, see
the provenance without the title. Do not write a test, a comment, or a doc line implying a
per-chunk provenance guarantee the chunker does not give. This inner fence is the LAST surviving
instance of D5-CORRECTED's "fence our own output" obligation; the other one disappeared when
D9-REVISED moved research onto the async memo terminal, which removed the in-loop re-entry
(`buildAgentContext` renders a memo plan as `Body drafted: yes/no` and never emits the body).

**§4:** the audit row (`research.persisted`) carries a query HASH, counts, and refs — never the
question, never a URL, never prose. `AuditPayload` permits `readonly string[]`, so an array of URLs
would type-check: that is the trap, not a safety net.

`ponytail:` two deliberate NON-decisions recorded in the module header — no `researchRuns` table (a
second log plane beside the insert-only audit is the anti-pattern) and no `vaultSources` card for
web URLs (OQ-4: no new UI in v1; the URLs are in the document's own header).

**Verify:** `pnpm exec vitest run convex/research.test.ts` (12 tests — the vault write, the stamp,
the title cap, the header/fence/footer order, insufficient-evidence labelling, the three stop
reasons, the startIngest control, the §4 scan, the two dispatch-wiring cases, the persist-failure
case, and both halves of the cross-tenant isolation assertion).

---

### Phase 15.2 — 15.2-05 (LIVE verification — THE PHASE GATE)

**Deployment:** `local-joel_feruzi-pikar_ai_50c69-1` (local, cloud `:3210`, site `:3211`, project
`joel-feruzi:pikar-ai-50c69`, backend `precompiled-2026-07-21-82d5e9f`).
**Run date:** 2026-07-27, sweep executed `13:58:34Z`.

This is the first time anything in Phase 15.2 was proven against a running deployment. Plans
15.2-01 through 15.2-04 were all offline-green and each said so explicitly.

#### The target row — before and after, verbatim

`_id: mx725hvxy1vsjvtaa4hza18pms8b8gp4` · `Zainab_Blowing_Operators_KPIs_Feb_2026.xlsm` ·
`mimeType: application/vnd.ms-excel.sheet.macroEnabled.12` · created
`2026-07-26T21:33:43.121Z` (16.4 h stranded at the moment of the sweep).

| Field | BEFORE | AFTER |
| ----- | ------ | ----- |
| `status` | `pending_extraction` | **`ready`** |
| `text` | empty (0 chars) | **256,439 chars** (256,569 UTF-8 bytes) |
| `failureReason` | **absent** — the silent park | absent |
| `size` | `803281` | `256569` |
| `contentHash` | `e0a2d8bf…f75dcc` | `a8cd427e…97d913` |
| `ragEntryId` | empty | populated (`j97dq2n5rz…`) |
| `storageId` | `kg25zcy00acer8rt6gnwk55ph98b8d80` | **unchanged** |

**The extraction is substantive, not plausible.** 46 `Sheet N` markers, 3,084 lines, 2,313
numeric-bearing lines, and real cell values — `Zan Aqua 1.5 Ltr *6 → 80000 / 4800 /
16.666666666666668 / 600000`, with `#DIV/0!` spreadsheet error strings preserved verbatim. Headers
AND numbers survived; this is the shape SC#3's XLS half is warned about failing (headers alone ⇒
the parser silently degraded) and it is NOT that shape.

**`size` and `contentHash` change on every successful extraction, and this is PRE-EXISTING, not a
15.2 regression.** `vault.ts:632-633` (`ingestExtractedText`) writes `size: byteLen(text)` and
`contentHash: await contentHash(text)` — after ingest, `size` describes the EXTRACTED TEXT, not the
uploaded file. Consequence worth knowing: **the 803,281-byte fingerprint that identifies this row in
every Phase-15.2 planning document no longer matches the row.** Search by `_id` or `title`, and do
not conclude the row was deleted. Hash-dedup is keyed on the text hash by design (`by_tenant_contentHash`).

**No collateral damage.** A full row-by-row diff of `vaultDocuments` before vs after
(55 rows before, 55 after) shows **exactly one changed row** — the target. No row created, none
lost, no other `status` / `failureReason` / `size` altered.

#### ⚠ THE GATE'S OWN COMMAND IS A NO-OP — read this before trusting a sweep

`npx convex run vaultSweep:runSweep` **did nothing** on first invocation:

```
{ "Status": "Migration already done.", "lastFinished": "2026-07-18T03:35:23.430Z", "processed": 12 }
```

`runSweep` is `migrations.runner(internal.vaultSweep.sweepPendingExtraction)` — a
`@convex-dev/migrations` migration that records completion and **refuses to re-run**. It last
finished **2026-07-18**; the `.xlsm` was uploaded **2026-07-26**, eight days later, so it was never
in that run's cursor range and a bare `runSweep` will never look at it again. The recovery required
the argument the component's own output advertises as `toStartOver`:

```
npx convex run vaultSweep:runSweep '{"reset": true}'
→ { "Status": "Migration was started and finished in one batch.", "processed": 55 }
```

`reset: true` sets the cursor to null and re-scans the whole table. That is **safe here by
construction**: `migrateOne` early-returns unless `status === "pending_extraction" && storageId`,
so a full re-scan schedules extraction for exactly the rows that are stuck and touches nothing else
(observed: 55 processed, 1 changed).

**Operational rule going forward:** the documented one-shot `npx convex run vaultSweep:runSweep` in
`vaultSweep.ts`'s header comment is only correct the FIRST time. Any later backlog recovery must
pass `'{"reset": true}'`, or it will report success having done nothing — a silent no-op, which is
the same class of failure this entire phase exists to delete. The header comment in `vaultSweep.ts`
still shows the bare form.

#### Environment — the deployment was DOWN and had to be recovered first

The deployment was not running when this plan started, and this cost the first part of the run:

- Nothing listening on `:3210`/`:3211`; **no `convex-local-backend` process at all**.
- Three orphaned convex CLI processes from the previous day, all idle (0.00 s CPU delta over 12 s):
  a `dev --once --configure existing` hung since `21:51` (18 min after the `.xlsm` was uploaded, and
  the likely cause of the outage — cf. the untracked `.env.local.bak-before-configure` /
  `.bak-pre-repair` files), plus a `convex dev` that had burned **860 s of CPU** against a dead
  backend — the retry-storm signature, already burnt out.
- Recovery (owner-approved): kill exactly those three PIDs, verify the ports are free and nothing
  respawns, then **one** `convex dev --run skills:seedSkills` from `packages/backend`.
- **Seeding in the same push is not optional.** The ingest workflow's graph-extract step loads
  `graph-extractor` from the skill registry and fails closed with `NO_ACTIVE_SKILL` when unseeded,
  which would land the row at `failed` for a reason with nothing to do with extraction. Push
  reported `Convex functions ready! (36.14s)` with no bundler or type error before anything was read
  as a result.

Catch-up noise on restart, benign and recorded so it is not misread next time: `crons:purge` timed
out on system operations, and two `vault:deleteVaultDoc` calls threw `UNAUTHENTICATED`.

#### Still UNPROVEN after this plan — do not read the gate as broader than it is

- **SC#5 (verbatim scanned-PDF output) — UNPROVEN.** Plan 15.2-06 owns it. The 12-page deck is row
  `mx78ake083gn575pg43sw9j66x8b86eb`, still `ready` at **2,191 chars** carrying a stale
  `extract_error: The operation was aborted due to timeout`. (It is `ready` WITH a `failureReason`
  because 15.2-04's staleness fix only clears on the NEXT attempt — pre-existing rows keep theirs.)
- **SC#3's XLS half — UNPROVEN.** Plan 15.2-07 owns it. Legacy `.xls` still refuses with
  `unsupported_legacy_spreadsheet`, which is the honest interim answer, not a bug.
- This gate proves the **recovery** path (sweep over a stranded row). The **fresh-upload** path
  (`vaultUpload`) and the junk-file failure path are UI-only and are recorded below.

#### UI half — owner verdict: APPROVED, but only PARTIALLY OBSERVED

The owner approved the checkpoint. **Not every step was run, and the unrun ones are listed here
rather than rounded up into the approval.**

**OBSERVED — PASSED.** The owner uploaded a **`.pptx`** (the ZIP-family auto-progression test). It
**auto-progressed to `ready` with no button pressed**, and the preview rendered extracted text plus
the "No entities extracted for this document." empty state. This is the **first live confirmation of
the 15.2-01/02/03 spine on a NEW upload rather than a recovered row** — permissive scheduling and
byte-sniff rail dispatch working end to end on a format that was never in the old three-entry MIME
allow-list. That is a distinct proof from the sweep and is worth keeping separate.

**NOT OBSERVED — explicitly unverified live, do not read the approval as covering these:**

- **The `.xlsm` preview PANE contents were not reported.** The row-level 256,439-char result above
  stands on its own evidence; the **UI render** of it does not.
- **The junk-file → plain-English `failed` + remedy path was NOT run. 15.2-04's `failureCopy`
  remains UNVERIFIED LIVE.** No failure card has been viewed in a browser at any point in this
  phase. Compounding this: the `:3000` server is `next start` launched `2026-07-26 21:35:06` while
  `.next` was rebuilt `2026-07-27 16:22:39` — a process predating its own build, the Phase-14 trap
  recorded in `voice.md`. **Unless that process was restarted, even a later casual glance at that
  surface may be reading a stale bundle.** Restart before believing any vault-UI symptom.
- **Legacy `.doc`/`.ppt` (step 6) and legacy `.xls` (step 7) were not run.**

#### ⚠ KNOWN GAP — PPTX extracts TITLES ONLY, and scaffolding-only output reports `ready`

The owner's `.pptx` upload surfaced a real defect. **It is NOT a Wave-5 regression** — the
scheduling and dispatch spine did its job; the defect is one layer down, in the parser.

Row `mx7a40n7460cj3d1ww97bms6wd8bb9zg` (`Rejection Review- Mar 2026.pptx`), `status: ready`,
`ragEntryId` populated (full ingest including `extractGraph` + `upsertGraph` ran), **`size: 356` —
that is the ENTIRE extracted text**:

```
Slide 1\n-March 2026\nMonthly Rejection Overview\n\nSlide 2\nMonthly Rejection Overview- March 2026\n\nSlide 3\nTrend 2026…
```

**Root cause:** `pptxText` (`packages/vault/src/officeText.ts:70-76`) reads `<a:t>` runs from
`ppt/slides/slideN.xml` and nothing else. The deck's actual KPI content lives in
`ppt/charts/chart*.xml`, embedded worksheets and images — **entries already present in the same
`unzipSync` result, never opened.** The entity graph came back empty because it was handed 356 chars
of headings, not because the graph plane is broken. Do not go debugging `extractGraph` for this.

**The trap, and why it belongs in this playbook:** line 74 emits the `` `Slide ${n}` `` header
**UNCONDITIONALLY**, so a deck with zero extractable runs still produces non-empty text,
**`empty_extraction` never fires, and the row reports `ready`.** That is a **false-ready of exactly
the family this phase exists to delete** — the honesty gap was closed at the scheduler (15.2-03) and
is **still open one layer down, in the parsers**. `xlsxText` has the same shape at **line 65**
(`` `Sheet ${n}` `` emitted unconditionally), so the gap is a family, not a single site: any
scaffolding-only output passes the `empty_extraction` guard because the scaffolding itself is text.

**Disposition (owner):** new scope, sequenced as plan **15.2-08 after 15.2-07**, covering BOTH
halves — (a) walk chart / diagram / notes text, and (b) make scaffolding-only output fail honestly
instead of reporting `ready`. **Not fixed here by design**; a verification plan does not smuggle in
an edit.

---

### Phase 15.2 — 15.2-06 (per-page fan-out: scanned PDFs are TRANSCRIBED, not summarised)

**THE INVARIANT: the hosted branch sends ONE PAGE PER CALL.** `extractHosted`'s signature is
**unchanged** and is reused per page; the `attachment-extractor` skill row is **unchanged**. §5 is
satisfied by **REUSE**, not by a new prompt — the prompt was always right ("extract ALL of it
VERBATIM", "Never summarize"); the **input** was wrong. Its contract is written for *a single image
or document (PDF page…)*, so handing it a 12-page deck as one file part asked it to do something the
prompt never promised, and it did the reasonable thing: it digested.

**Anyone "optimising" this back into a single whole-document call reintroduces the defect — and the
offline suite will stay GREEN, because it proves batching *shape*, not verbatimness.** That is what
the static scan *"the hosted branch no longer sends the WHOLE DOCUMENT as one call"* in
`vaultExtract.test.ts` exists to stop.

#### The four constants, and why each number is what it is

| Constant | Value | Why |
| -------- | ----- | --- |
| `PAGE_BATCH_SIZE` | 6 | A bounded fan-out, not a throughput knob. Each page is its own hosted call **and** its own `recordSpend` write against **one keyless `dailySpendCents` window** (`guardrails.ts:166-173`), so the batch width is also the **OCC-contention width**. 6, not 50. |
| `PAGE_TIMEOUT_MS` | 60 s | `CALL_TIMEOUT_MS` (480 s) is **PER CALL** and was tuned for ONE whole-document call. Under fan-out every page would inherit all 480 s, letting **one stuck page eat the entire 10-minute action ceiling**. ~10 s/page is the measured norm — 60 s is 6× headroom. |
| `FANOUT_BUDGET_MS` | 420 s | The whole fan-out's wall-clock budget, under Convex's 10-min node-action limit with room for the surrounding scan/audit/seam work. Checked **before each batch**; expiry returns `truncated`. |
| `VAULT_EXTRACT_PAGE_CAP` | 50 | Unchanged and **still binding** — `pdfPages` applies it, so the cap survives the fan-out. |

`fanOutPages` reassembles into a **pre-sized array indexed BY PAGE**, so ordering is *structural*
rather than a sort someone has to remember. A failing or timed-out page contributes an
**`[unreadable]` marker, never a throw** (§4 — no SDK string, no parser string, no document
content). **`okPages` is the success signal, NOT the text being non-empty:** a document made
entirely of markers is non-empty, so `empty_extraction` would never fire on it — that is the same
false-ready family as the `Slide N`/`Sheet N` gap above. `okPages === 0` throws
`hosted_extract_failed` into `extractDoc`'s existing outer catch.

#### `recordSpend` fan-out — RESOLVED BY OBSERVATION (closes RESEARCH §11 item 4)

N spend writes where there was 1, against one keyless rate-limit window. It **cannot under-count**
(`reserve: true` lets the window go negative) and it **cannot throw** (the return value is ignored),
so the only exposure was OCC-retry latency at the batch width. **Observed live: 12 pages, 2 batches
of 6, zero OCC/write-conflict errors, zero new `deadLetters` rows, 77 s wall clock. Spend delta 13
cents** (`remainingDailyCents` 440 → 427, ≈1.08¢/page). Not assumed — measured.

#### `ponytail:` ceilings (named, not built)

- **`Promise.race`, not a threaded `AbortSignal`.** `extractHosted`'s contract is reused UNCHANGED
  and owns its own 480 s `abortSignal`, so a raced-out page's request **lingers in the background**
  — it just stops *blocking* the batch, and `FANOUT_BUDGET_MS` bounds the whole fan-out regardless.
  Upgrade path: thread an optional `timeoutMs` through `extractHosted` (one optional parameter;
  every existing call site unchanged).
- **Batching inside ONE action, not a durable workflow.** Beyond the page cap this needs a workflow
  or the already-installed `@convex-dev/workpool`.

#### ⚠ `extractionTruncated` will now start appearing on long scans — EXPECTED, not a regression

A verbatim 50-page transcription is **far** more likely to reach `VAULT_EXTRACT_CHAR_CAP` (400k)
than a summary ever was. 15.2-04 made sure the flag survives into `ready`. Do not "fix" it.

#### Live result — 2026-07-27, `local-joel_feruzi-pikar_ai_50c69-1`

Row `mx78ake083gn575pg43sw9j66x8b86eb` — `The_AI_Executive_OS.pdf`, 12 pages, no text layer.

| | BEFORE | AFTER |
| --- | --- | --- |
| `charCount` (audit) | **2,161** | **7,868** (3.64×) |
| shape | one whole-document call → a digest | 12 per-page calls → `Page 1`…`Page 12` |
| `[unreadable]` markers | n/a | **0** |
| per-page chars | n/a | 344–986, evenly distributed |
| `status` | `ready` (stale `extract_error: … aborted due to timeout`) | `ready` |
| spend | 1 call | 13¢ / 12 calls, no OCC |

Content is **verbatim, not descriptive**: slide copy, a reproduced comparison table, and specific
figures preserved (`$53.2B`, `44.9% CAGR`, `2,136 commits`, `www.pikar-ai.com`). No digest tell
("Here's a breakdown…", "The document discusses…") appears anywhere in the 7,868 characters.

**OWNER VERDICT: ✅ APPROVED — "the text reads as transcription, not summary."** SC#5's substance is
**CLOSED** on the owner's own reading. (The block above was written BEFORE the blocking checkpoint,
marked PENDING, on the 15.2-05 precedent — a session limit cut 15.2-04 mid-task, and a verification
living only in a chat transcript did not happen.)

**Exactly what the verdict rests on, stated so nobody reads it as broader than it is:** the owner
read the **Page 3 and Page 11 excerpts** plus the character-count / page-header / no-digest-tells
evidence above, and judged it transcription. **The verdict was given from the recorded row data and
those excerpts, NOT from a browser session** — at verdict time the `:3000` server was still the
stale `next start` (PID 14512, launched 2026-07-26 21:35:06, against a `.next` built 2026-07-27
16:22:39), the same staleness 15.2-05 reported. **No vault-UI check happened here.** The preview
pane's rendering of a fanned-out scan remains unobserved, exactly as `failureCopy` does.

Two properties of the new hosted path to carry forward:

- **`extractionTruncated` is now EXPECTED on long scans.** A verbatim 50-page transcription is far
  likelier to hit the 400k `VAULT_EXTRACT_CHAR_CAP` than a summary was. **That is not a regression.**
- **13¢ across 12 calls is the new per-scan cost shape** (≈1.08¢/page), replacing one call per
  document. A 50-page scan is ~50 calls. The daily budget (`DAILY_BUDGET_CENTS` 500) is unchanged
  and still the ceiling.

---

### Phase 15.2 — 15.2-07 (legacy XLS / SheetJS)

**SPIKE RESULT: GO — and the live round trip is CLOSED.** SheetJS survives a bundle built with
Convex's exact esbuild flags, the `.xls` rail now runs the real parser instead of 15.2-03's honest
refusal, and **a real legacy `.xls` uploaded to the deployment reached `ready` with its numbers
visible. OWNER VERDICT: APPROVED. SC#3's XLS half is CLOSED.**

**Exactly what that verdict rests on, stated so nobody reads it as broader than it is:** the owner
confirmed the checkpoint's stated criterion directly — the file reached `ready` and the preview
showed **numbers, not headings-only**. **No individual figures were transcribed back to me and no
cell values were diffed against Excel**, and no failure reason was reported. The claim this
supports is "the round trip works and did not degrade to header recovery" — not "every value was
verified correct".

(The rest of this block was written BEFORE the blocking checkpoint, marked PENDING, on the
15.2-05/06 precedent: a verification living only in a chat transcript did not happen.)

#### The pinned dependency, and why NOT npm

```
xlsx: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

**EXACT, no caret (§6), and doubly so because it is not a registry package.** The vendor's own CDN
is the only supported channel. **npm `xlsx@0.18.5` — the last registry publish — is NOT an option
to "just try first":** CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS). This code
parses **untrusted uploads**, so the registry version is disqualified on input, not on preference.
Treat it like the other pinned pre-1.0 components: do not bump casually.

#### The spike, with the numbers — reusable for ANY future dependency in a node action

The single fact that predicts the hazard is the installed package's own manifest:

| Package | `main` | `exports` map | ESM build |
| --- | --- | --- | --- |
| `pdf-lib` (the 2026-07-26 defect) | `cjs/index.js` | **NONE** | none |
| `xlsx` 0.20.3 | `xlsx.js` | **YES** — `"import": "./xlsx.mjs"` | **yes** |

Rebuilt with Convex's flags read out of `convex/dist/esm/bundler/debugBundle.js` (`innerEsbuild`)
and the `platform: "node"` call site in `cli/lib/config.js` — `bundle, platform:"node",
format:"esm", target:"esnext", conditions:["convex","module"], splitting:true, treeShaking,
minifySyntax, minifyIdentifiers, keepNames`, no `convex.json` so no external-package allow-list.
esbuild 0.27.0. **Observed namespace keys:**

| Probe | Chunks | Namespace keys | Result |
| --- | --- | --- | --- |
| SheetJS **STATIC** import | 1 | **19** — `CFB, SSF, default, parse_xlscfb, parse_zip, read, readFile, readFileSync, set_cptable, set_fs, stream, utils, write, …` | `typeof read === "function"`, `typeof utils.sheet_to_csv === "function"` PASS |
| SheetJS **dynamic** `await import()` | 3 | **19** — also survives | PASS |
| **CONTROL** `pdf-lib` dynamic | 3 | **1** — `default` only | `typeof PDFDocument === "undefined"` FAIL |

**The control is the point.** Without it, "SheetJS was fine" is indistinguishable from "the probe
cannot see a collapse". The pdf-lib control still collapses under the identical harness, so the
SheetJS result is a measurement rather than a reassurance.

#### Pitfall 9 restated as a GENERAL rule (it is not a pdf-lib quirk)

> **Any package reached from a Convex node action must be a STATIC top-level import.** The
> predictor of collapse is **the absence of an `exports` map with a real ESM build**, not the
> import form: a CJS-only package crossing a dynamic-import chunk boundary loses its named exports
> because esbuild cannot synthesise them there. **Offline green is NOT evidence** — Node and vitest
> recover CJS named exports via `cjs-module-lexer`, so the broken production path is invisible in
> the suite. Only a deployed run, or a rebuild under Convex's own flags, proves it.

SheetJS is the **`unpdf` case** (real ESM, survives both forms), not the `pdf-lib` case. The static
import is used anyway: it is the shape that was actually proven, it costs nothing, and a version
bump could drop the ESM build without a single test going red. **Two static scans now lock this
rule** — `pdf-lib` in `vaultExtract.test.ts` and SheetJS in `xlsText.test.ts`. The xlsText scan
strips comments before matching, because that file deliberately spells out the banned form.

#### Why a text sweep was NEVER an option for BIFF

Legacy `.xls` stores numbers as **binary doubles**. A printable-run sweep (`oleText`) recovers the
column headers and **silently loses every value** — a spreadsheet that reads as a document with no
data in it. That is a *plausible* failure, which is worse than a failure, and is the exact shape
this phase exists to delete. **`oleText` must never be pointed at `.xls`.** `xlsText.test.ts`'s
headline case is named *"numbers survive — the exact thing a text sweep silently loses"* precisely
so the distinction stays visible.

#### Shape of the code

- **`packages/vault/src/xlsText.ts` is SUBPATH-ONLY** (`@pikar/vault/xlsText`), never on the barrel
  — the `officeText.ts` rule, for ~1 MB instead of a few KB. It enters exactly one node action.
  The barrel's NOTE comment now states the rule where someone would otherwise add the export.
- **REJECTED, do not re-propose:** consolidating all spreadsheet handling onto SheetJS and deleting
  the `fflate` XLSX path. It removes code but adds ~1 MB to a deliberately lean bundle, and the
  fflate path is shipped and tested.
- **TRUST-BOUNDARY GUARD — a measured hazard, not a defensive flourish.** SheetJS's `read()` falls
  back to a **DSV/plain-text guesser** for unrecognised bytes, so **64 bytes of noise come back as a
  workbook holding one cell of mojibake** — non-empty, so it would clear `empty_extraction` and be
  stored as a `ready` document. `xlsText` therefore gates on `sniffContainer(bytes)` (dep-free,
  already on the barrel — reuse, not new code) and accepts only `ole2` or `zip`.
- **The success signal is `okSheets`, a COUNT** — the 15.2-06 `okPages` rule. The `Sheet N` header
  is emitted **only for a sheet that actually yielded content**, so **this file is deliberately NOT
  a third instance of the `Slide N`/`Sheet N` false-ready family** (`officeText.ts:65` and `:74`
  emit theirs unconditionally — still open, plan 15.2-08).
- Throws `xls_parse_failed: <reason>` — **our string, never SheetJS's** (§4). Never returns `""`.

#### ponytail ceilings, all MEASURED against 0.20.3

- **DATES:** in a **SheetJS-written** `.xls` a date surfaces as the Excel **serial** (`46067`), not
  `2/14/26`, because its BIFF8 *writer* emits no date number-format record; **`cellDates: true` does
  not change it** (measured). The same workbook as `.xlsb`/`.xlsx` renders the date. **CLOSED
  2026-07-29 on a real Excel-authored `.xls`:** 31 numeric date cells stored raw serial `46232`
  plus Excel's `[$-F800]dddd\,\ mmmm\ dd\,\ yyyy` format record; `xlsText` emitted
  *"Wednesday, July 29, 2026"* 31 times and the raw serial zero times. If another real file reports
  serial dates, the upgrade path is a per-cell `t === "d"` walk instead of `sheet_to_csv`.
- **FORMULAE:** the cached **value** appears, not the formula string; the `.xls` round-trip drops
  the formula entirely.
- **MERGED CELLS:** value once, blanks for the spanned cells (`sheet_to_csv` default).
- **XLSB:** supported by SheetJS's writer, so it is covered by a real fixture rather than a guess.
- **No cell/sheet cap** — `VAULT_EXTRACT_CHAR_CAP` downstream is what bounds a huge workbook.

#### Two honest terminal endings on the XLS rail, one earlier than you would guess

| Input | Reason | Why |
| --- | --- | --- |
| OLE2 with a `Workbook` stream but no BIFF content | `xls_parse_failed` | reaches the parser, which throws |
| A real `.xls` **truncated in half** | **`unsupported_format`** | halving removes the CFB **directory sector**, so `ole2Kind` can no longer find `Workbook` and the **dispatcher refuses one rail earlier** — `xlsText` is never called |

Both are terminal and both are pinned. **Do not "fix" the second reason to the one that reads
better** — it describes what actually happens.

`unsupported_legacy_spreadsheet` is no longer produced by this rail. **Its `failureCopy` row STAYS**
— historical rows still carry the code, and deleting the row would render them as a raw code.

#### What was proven live, and what was not

Deployment `local-joel_feruzi-pikar_ai_50c69-1`, 2026-07-27.

- **Watch-mode freshness PROVED, not assumed:** touch probe on `vaultExtract.ts` gave **2.984 s CPU
  vs 0.000 s idle**. `npx convex dev --once` **refuses while the local backend holds `:3210`** ("A
  local backend is still running on port 3210") — so an explicit one-shot push verdict is
  unavailable without stopping the owner's `convex dev`, which was not done unilaterally.
- **THE DEPLOYED MODULE LOADS WITH SHEETJS IN IT.** A throwaway row was created on a throwaway
  tenant (`vaultSmoke:insertBrief`, tenant `smoke-15207`, no `storageId`), then
  `vaultExtract:extractDoc` was invoked **on the deployment**: it returned cleanly and drove the
  spine to a terminal `failed` (`no_stored_bytes` — the only branch reachable without a
  `storageId`). **A bundle that could not carry SheetJS would have failed at module load**, which is
  the failure mode a static top-level import has. Row purged afterwards; **$0**, no model call, no
  owner data touched.
- **THE ROUND TRIP: PROVEN.** A real legacy `.xls` uploaded to `/dashboard/vault` reached `ready`
  with its **numbers** present in the preview — **owner-APPROVED**. The offline suite proved the
  parser and the probe proved the import; **only this upload proved the two compose.** Evidence
  level: the owner's direct confirmation against the checkpoint criterion (reached `ready`, numbers
  present, not headings-only). **No figures were transcribed back and nothing was diffed against
  Excel** — so "the numbers are there" is proven; "every number is correct" is not claimed.
- **POST-PLAN CLOSURE, 2026-07-29:** a real Excel-authored `.xls` containing 31 numeric date cells
  was measured through the production `xlsText` function. Raw BIFF value `46232` plus the stored
  date format rendered as *"Wednesday, July 29, 2026"* 31 times; the raw serial appeared zero
  times. This closes the evidence gap without a parser change.

#### Gates

`@pikar/vault` **125/125** (was 114), `vaultExtract` **47/47** (was 41), backend `test vault`
**121/121** (was 115), `@pikar/vault` tsc exit 0, backend tsc **52 errors, ALL in `*.test.ts`,
ZERO non-test** (baseline held exactly), biome at the pre-existing 2 findings.

**Three mutation-checks, each confirmed applied and each reverted green:**

| Mutation | Result |
| --- | --- |
| SheetJS import made dynamic | **1 RED (the scan) — and ALL 10 behaviour tests stayed GREEN**, i.e. Pitfall 9 reproduced on demand |
| `sniffContainer` container guard removed | **1 RED** (64 bytes of noise came back as mojibake) |
| `Sheet N` header emitted unconditionally | **2 RED** (the no-header case and the empty-workbook throw) |

**`xlsx` is also a DEV-only dependency of `@pikar/backend`** so the convex-test fixture can be
written by SheetJS rather than committed as a binary — it does not resolve there otherwise, the
same arrangement that keeps `fflate` out of the V8 bundle. **Nothing in production imports `xlsx`
from `@pikar/backend`**; the only production path is `@pikar/vault/xlsText`.

---

### Phase 15.2 — 15.2-08 (the false-ready FAMILY, and the entries already in the archive)

#### INVARIANT — never let a non-empty string stand in for "we got content"

**This bug shape was found FIVE times in one phase.** A structural header (`Sheet 3`, `Slide 7`,
`Page 12`) is **SCAFFOLDING**. Emitted unconditionally it makes an empty extraction *non-empty*, so
`vaultExtract.ts`'s `empty_extraction` guard never fires and a document holding nothing readable
reports **`ready`** — a plausible failure, which is worse than a failure.

**The rule outlives the two sites it was found at.** The success signal is a **COUNT of parts that
yielded content**, never the truthiness of the joined string:

| Where | Signal |
| --- | --- |
| `vaultExtract.ts` per-page PDF fan-out (15.2-06) | `okPages` |
| `xlsText.ts` legacy BIFF (15.2-07) | `okSheets` |
| `officeText.ts` XLSX + PPTX (15.2-08) | `labelled()` returning `null`, then `parts.length` |

`labelled(label, body)` returns `null` for a blank body: **no body, no label, no part.** `trim()` is
the TEST, never a rewrite — the body is emitted exactly as it came in, so a part whose first row is
blank still renders that blank row and every pre-existing expectation stayed byte-identical.
**Anyone adding a new walker starts from the count.** A static scan in `officeText.test.ts` asserts
that every `Sheet ${n}` / `Slide ${n}` literal in the file is an argument to `labelled(`.

#### INVARIANT — `""`, not a throw, and the two endings must not be merged

A text-free ZIP office document returns `""`. It does **not** throw.

- The archive **parsed fine**, so `office_parse_failed` ("the archive is broken") would be a lie
  about a perfectly valid chart-only or password-protected deck.
- `vaultExtract.ts:392` already turns `""` into **`empty_extraction`**, which is accurate and
  already carries user-facing copy: *"We opened this file but found no readable text."* + a remedy.
  A throw here would be a **second failure mechanism** for a case the existing one already
  describes correctly (the 15.2-06 rung-2 decision).

**Do not merge these two:** *no worksheets / no slides at all* is a **broken archive** and THROWS;
*worksheets / slides with nothing in them* is an **empty document** and returns `""`. Different
facts, different endings. Both are pinned by tests.

#### INVARIANT — the PPTX entry list, positive AND negative

`pptxText` is **routing, not parsing**: every part it reads is already in the same `unzipSync`
result it holds. Attachment is via `ppt/slides/_rels/slideN.xml.rels` (`Target="../charts/chart1.xml"`,
a leading `../` resolving to `ppt/`), so a chart's values land under the slide that shows them.

**READ (an ALLOW-LIST of exactly three content part types):**

| Entry | Walker |
| --- | --- |
| `ppt/slides/slideN.xml` | `<a:t>` runs, minus `<a:fld>` blocks |
| `ppt/charts/chartN.xml` | `<a:t>` title runs, then ONE tab-joined line per `<c:ser>` of its `<c:v>` values |
| `ppt/diagrams/dataN.xml` | `<a:t>` runs (SmartArt) |
| `ppt/notesSlides/notesSlideN.xml` | `<a:t>` runs, minus `<a:fld>` |

**NEVER READ, and each for a measured reason:**

- **`ppt/diagrams/drawingN.xml`** — a **byte-duplicate** of `dataN.xml`, and BOTH are referenced
  from the same slide's rels. Reading it doubles every SmartArt phrase. Matched as
  `^ppt/diagrams/data\d+\.xml$`, never `diagrams/*`. Pinned by a test that asserts a **COUNT**
  (`text.split("Agenda:").length - 1 === 1`) — `toContain` passes on duplicated text.
- **`ppt/slideLayouts/*`, `slideMasters/*`, `notesMasters/*`, `handoutMasters/*`** — boilerplate.
  Measured on the owner's deck: **15 such parts holding ~110 runs**, so a naive "read every `<a:t>`
  in the archive" would inject *"Click to edit Master title style"* and the deck title ~22 times and
  bury the real content. A rels file points at plenty of scaffolding, which is exactly why the
  dispatch is an allow-list and not "whatever the `Target` says".

`<a:fld>` blocks (slide-number / date / footer FIELDS) are stripped everywhere. Measured: a field is
the **entire** `<a:t>` content of all three of this deck's notes slides. A `Set` of consumed paths
emits a twice-referenced part once, and an **orphan sweep** emits any chart/diagram no slide
references as its own part labelled by entry path — so a rels file that fails to parse degrades to
"the numbers are present but unattached", never back to titles-only.

#### The measured ceilings, each with its upgrade path

- **PICTURE-ONLY SLIDES ARE UNREADABLE BY ANY TEXT WALKER.** Slides 6 and 7 of the owner's deck are
  image exports (`image1.png`, two `.wmf`); they yield a title run and nothing else. **This is a
  ceiling, not coverage.** Upgrade path: render the slide and route it through the hosted OCR rail
  15.2-06 built — a different rail with a real per-page cost.
- **CACHED CHART VALUES ARE EMITTED VERBATIM.** Categories come back as Excel **date serials**
  (`46023 / 46054 / 46082` = the Jan/Feb/Mar 2026 month ends) and percentages as full-precision
  floats (`4.7100000000000003E-2`, displayed as 4.71%). This matches the SheetJS-written fixture's
  `46067`, not the now-proven Excel-authored BIFF path, because the chart cache does not carry the
  workbook cell's usable formatting. Upgrade path: read `<c:formatCode>` and apply it.
  **Observed asymmetry: only the chart whose categories
  are a `<c:numCache>` shows serials — the two charts whose categories are a `<c:strCache>` came
  back as `Jan-26 / Feb-26 / Mar-26`.**
- **EMBEDDED WORKSHEETS ARE OUT OF SCOPE BY MEASUREMENT, NOT OMISSION.** This deck has **no
  `ppt/embeddings/` directory at all**; its charts declare `externalData` pointing at a `file:///`
  path on the AUTHOR'S machine, so the cached `<c:v>` values are the complete numeric truth inside
  the archive. If a deck ever surfaces `ppt/embeddings/*.xlsx` the upgrade is one line — recurse
  `extractOfficeText` on that entry, since it is a self-identifying ZIP. **An `externalData` target
  must NEVER be dereferenced: it is an attacker-controlled path/URL in an untrusted upload.**

#### Live result — 2026-07-27, `local-joel_feruzi-pikar_ai_50c69-1`

Row `mx7a40n7460cj3d1ww97bms6wd8bb9zg` — `Rejection Review- Mar 2026.pptx`, re-extracted from its
stored bytes via `internal.vaultExtract.extractDoc` (**$0** — the pure `zip` rail; only the re-embed
costs, and `remainingDailyCents` read **499** after).

| | BEFORE | AFTER |
| --- | --- | --- |
| audit `charCount` | **356** | **1,182** (3.3×) |
| Slide 2 | title only | Objective + Agenda block, **once** |
| Slide 3/4/5 | title only | `Rej %` + `ZBIJ / ZBBW / ZBFL` × `Jan-26 / Feb-26 / Mar-26` with values |
| Slide 6/7 | title only | title only — **the picture-export ceiling, unchanged** |
| `Click to edit` | n/a | **0 occurrences** |
| `status` | `ready` | `ready` |
| `graphEdges` for this doc | the Entities panel read *"No entities extracted"* | **4 edges, 5 nodes** — `Monthly Rejection Overview` (topic, degree 4), `March 2026` (date), and **`ZBIJ` / `ZBBW` / `ZBFL`** |

The three plant codes are entities **only because the chart series names now reach the extractor** —
they exist nowhere in the 356-char titles-only text. The graph plane was never broken; the parser
had starved it.

**Deployment freshness was PROVED before the run, not assumed:** a touch probe on
`packages/vault/src/officeText.ts` moved the `convex dev` watcher (PID 14684) **1.97 s CPU vs
0.000 s idle**. Worth carrying forward — this is the first time the watcher was shown to react to a
file **outside `packages/backend/convex/`**, i.e. `packages/vault` edits do reach the deployment.

The live text is **byte-identical** to the offline one-shot measurement against the same file on
disk, and the stored 356-char BEFORE text matched the offline slide-only runs byte for byte, which
is what identifies the row as that file.

**OWNER VERDICT: APPROVED.** The owner approved the complete blocking checkpoint as presented:
the rejection figures appeared under Slides 3/4/5, the Objective/Agenda block appeared once, the
Entities & Relationships panel was no longer empty, and the titles-only ceiling on picture-export
Slides 6/7 was accepted. The `pikar-false-ready-probe.pptx` upload landed as **failed** and rendered
*"We opened this file but found no readable text."* with the expected plain-language remedy and no
raw reason code.

**Evidence level:** the owner's response was `Approved` to the complete presented checkpoint. No
individual figure values were transcribed back, and the remedy's exact words were not separately
quoted. This closes the browser round trip and confirms that `failureCopy` rendered; it does not
claim a value-by-value comparison against the source deck.

---

## Phase 17.1 — two-seam blueprint grounding

The confirmed Business Blueprint is standing business context, not a retrieval hit. It reaches
agents through two explicit seams:

1. The cockpit turn prompt carries it on every turn, whether or not the model calls `searchVault`.
2. `vaultGroundHydrated` returns `{docIds, titles, chunks, spine}` and the evaluation and voice-doc
   consumers read `spine` explicitly.

The fourth field is load-bearing. Putting the blueprint at entry 0 of the parallel retrieval arrays
would make `searchVault`'s `docIds.length === 0` no-match branch unreachable, inflate every
`vault.searched.resultCount`, and render a "Business blueprint" source chip on every search.
`spine` is therefore fetched only after the retrieval hydration loop and is budgeted outside
`TOTAL_CHAR_CAP`; retrieval retains the full 8,000-character budget. No confirmed blueprint or any
blueprint read failure yields `spine: null` while the three retrieval arrays stay unchanged.

The Blueprint document is neither embedded nor graph-extracted. It can never appear as a
`rag.search` hit, cannot be duplicated by retrieval plus the standing seam, and cannot feed its own
entities back into `graphNodes` to inflate the degree ranking used by the next rebuild.

**Phase 17.1 Pitfall 9 — the Blueprint appears in the user's vault UI.** `listVaultDocs` has no
kind filter, and `categoryFor({ source: "agent" })` places this row in `workspace-docs`. The card is
therefore previewable and user-deletable through the normal vault cascade. This is intentional and
matches the committed profile document. Deletion leaves `tenantProfiles.blueprintDocId` dangling;
`liveForTenant` already treats a missing target as no live Blueprint and fails open to `null`, so
the cockpit, evaluation, voice, and profile reads continue rather than crashing.

Verify with `pnpm --filter @pikar/backend test vaultGround --maxWorkers=1`. The BLPR-02 cases compare
all three arrays and their total character count before and after confirmation, retain a full-object
empty-result equality including `spine: null`, pin cross-tenant null behavior, and keep the public
`vaultGround` action at exactly `{context, docIds}`.

`searchVault` needed **no source change** for this design. Its existing `docIds.length === 0`,
`vault.searched.resultCount`, and `vaultSources` card logic continue to see retrieval hits only.
`searchVaultSpine.test.ts` drives the real tool through `internal.llm.__invokeCockpitTool` and pins
the honest Blueprint-bearing no-match at count 0 plus a matched card containing only the actual
retrieval document. Those tests are intended to fail if anyone later "simplifies" the Blueprint
back into the parallel arrays; the required mutation proof moves it there temporarily and confirms
that the no-match, count, budget, full-object shape, and array-invariance guards all turn red.

## Phase 15.3 — vault folders

One container section for the phase. Each plan appends ONLY its own `### 15.3-0N` subsection
below and bumps `Last verified`; nobody rewrites another plan's subsection. On merge conflict,
keep both. Same append-only shared-singleton rule as `## Phase 15.2` above.

### 15.3-01 — schema

Every schema change the phase needs, landed in ONE plan before any behaviour, so no later wave
edits `schema.ts` and no two plans can race on the repo's highest-collision file. Every addition
is a new table or an optional field, so this is a **pure widening**: it ships and sits inert, with
zero backfill, zero migration and no test result changed.

**`vaultFolders`** (`schema.ts`, directly after `vaultDocuments`) — tenant-scoped folder row:
`source` (`upload` | `drive`), `status`, the `memberCount`/`terminalCount`/`failedCount` counters,
`reservedCents`/`spentCents`/`reservedAt`, the `digestDocId`/`digestSourceDocIds`/`digestBuiltAt`
trio, and a `by_tenant` index. A NEW TABLE needs no migration (the `convex-migration-helper` skill
lists it under *When Not to Use*).

**There is no `cancelled` status, deliberately.** Cancel DELETES the row. The seal is read THROUGH
the folder row, so a folder merely *marked* cancelled would keep its members sealed forever —
inverting the locked decision that cancelled documents become groundable immediately. The
consequence, which is also deliberate: members keep a dangling `folderId` that resolves to nothing,
so **every folder read must treat an unresolvable id as "no folder"** (a lenient join), never as a
missing one. Deleting the row is also what keeps cancel migration-free — actively clearing
`folderId` on 400 rows does not fit one mutation, because a patch rewrites the whole document,
`text` blob included.

**The widening on `vaultDocuments`** — `folderId`, `docType`, `identityLine`, `identityUserSet`,
`driveFileId`, `driveModifiedTime`, all `v.optional`. **`folderId` ABSENT ⇒ folder-less ⇒ exactly
today's behaviour** for every row that exists: no shipped read changes, nothing is backfilled.
`docType` is a `v.union` and NOT `v.string()` on purpose — `category` next door is `v.string()` and
the table's own comment records that 4 of 11 insert sites already store out-of-union values; every
future member costing a schema edit IS the point. `identityUserSet: true` means the user typed the
identity and **no code path may ever overwrite it** (the label feeds the digest and grounding, so a
wrong guess left standing is a permanent lie in the grounding corpus); there is deliberately no
`docTypeSource` union, because one boolean is the whole decision.

**⚠ THE INERT-LITERAL WARNING — the single most misreadable fact in this phase.** The `origin`
union gained `folder_digest`, and **it excludes nothing and includes nothing.** There is ZERO
`origin` predicate anywhere in retrieval: the `origin: "agent"` exclusion is the ABSENT
`startIngest` call (`vault.ts:627-634`), not a filter. **A digest is groundable ONLY because its
insert calls `startIngest`.** Forget that call and the digest is silently ungroundable while every
test asserting `origin === "folder_digest"` still passes — so **the observable check is
`ragEntryId != null`, never the literal.** Do NOT add an origin-based filter anywhere; the literal
is provenance only. The one consumer, `patchCreatedDoc`'s `doc.origin !== "agent"` guard
(`vault.ts:723`), already refuses non-`"agent"` and therefore correctly makes a digest
un-revisable — that is right as it stands, do not "fix" it.

**`by_tenant_folder` read discipline.** The index serves BOTH the drill-in listing and the digest's
stale set-difference (there is no `by_tenant_folder_status`: completion is counted on the folder
row, never by a status query). **NEVER `.collect()` on it.** Rows carry `text` up to 400k chars, so
~40 max-size rows exhaust the 16 MiB per-transaction read cap — the same defect class that already
breaks `listVaultDocs`/`vaultStats` at folder scale. Use a bounded `.take()` and project `text`
away; `ownedDocsMeta` (`vault.ts:438`) is the shipped refs-only precedent. `by_tenant_driveFileId`
is the Drive re-import primary key, added here for the same reason: so no later wave touches this
file.

`watch.json` gained `vaultFolders.ts`, `vaultDigest.ts` and `vaultDrive.ts` under this playbook in
wave 1 — a plan blocked at its own Stop hook cannot commit, and doing it once here keeps every
later plan off a shared file.

Verify with `npx convex codegen` + `npx tsc --noEmit -p tsconfig.json` from `packages/backend`
(errors must stay confined to `convex/*.test.ts`, zero in `schema.ts`), and by confirming there is
still no `origin` predicate in any retrieval path.
