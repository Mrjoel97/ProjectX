# Findings: media, documents and batch production

Baseline: `821c3206e47eb4cec0ebcf3d99cf943358f2910a`, inspected 2026-10-21. Statements below describe this source unless explicitly labelled historical, proposed or unverified. Local tests are not live production evidence.

## 1. Answer to the product question

Pikar has useful creation infrastructure, but it does not yet meet the requested professional production standard. Improve and extend the existing paths instead of introducing a second agent, storage system or approval engine.

| Requested outcome | What exists | What is missing |
|---|---|---|
| Downloadable Excel report | Actual `.xlsx` generation on standalone and email-attachment paths | Typed numeric/date cells, dependable calculations, designed workbook layouts, charts and richer formatting |
| Beautiful PowerPoint | PPTX upload/text extraction; PDF/HTML document generation | Any PPTX writer, presentation specification, slide designer, slide preview or editable PPTX export |
| Professional PDF report | Deterministic PDF with headings, lists, tables and a restrained palette | Rich visual composition, branded templates, chart/image placement and broad font support |
| High-quality standalone image | One generated PNG per request; saved to Vault and Content | Quality/geometry choices, reference-image/edit controls, variant-set production and comparative review |
| Finished short video | Scene-based reel with generated/stock/uploaded visuals, narration, music and burned captions | Explicit export profiles, stronger editorial and B-roll selection, brand continuity and an output-quality acceptance gate |
| Many images/videos from one brief | Single-reel asset batches and a separate written-content variant system | A complete media campaign batch with item identities, capped workers, aggregate budget, partial completion, review and collection download |
| Documents in their true form | Inline PDF, capped spreadsheet grid and original download | Office-fidelity previews and generated editable presentations; a capped grid is not an Excel renderer |

`.xlsx` is the existing modern Excel output. Legacy `.xls` and `.xlsb` are read by the upload path, but the generation format set does not offer `.xls`. A renamed CSV/PDF is not an acceptable substitute for either workbook or presentation output.

## 2. Architecture and real creation paths

The repository is a Next.js web application (`apps/web`) over Convex (`packages/backend/convex`). Framework-independent contracts, parsing, pricing and validation live in `packages/contracts`, `core`, `cost`, `vault`, `pii` and other domain packages. `apps/hubspot` serves a separate integration. No dedicated document-conversion service was found in this source architecture.

### Documents

The Executive exposes `createDocument`, `generateAttachment` and `regenerateAttachment` in `llm.ts`.

- `createDocument({topic, form})`: `long | short | sheet` selects a registry drafter. The drafter returns `{title, markdown}`. Long-form creates a PDF twin; sheet-form converts Markdown tables to XLSX. It stores a tenant-owned agent artifact and updates the conversation's Output card. It saves rather than sends.
- Attachment generation uses `renderAndStore`, whose closed format set is `pdf | html | xlsx`. Regeneration preserves the prior format using `formatForMime`.
- The Markdown tokenizer is shared by PDF, HTML and spreadsheet conversion. That is useful reuse for simple content, but is now the information bottleneck for professional workbooks and slides.
- The Content shelf reads existing Vault artifacts. Reuse opens the existing conversation/workflow; it is not a second output store.
- Created documents retain agent provenance. Retrieval promotion remains an explicit action; exporting a prettier file must not silently change whether the agent treats it as reference material.

Entry points: [document formats and tokenizer](../../../packages/core/src/documentGen.ts), [tool/drafter implementation](../../../packages/backend/convex/llm.ts), [created-artifact storage](../../../packages/backend/convex/vault.ts), [content shelf](../../../packages/backend/convex/content.ts).

### Media

The Executive stages an image proposal or dispatches the media director. Reel planning includes research/grounding and a registry-owned director that writes two concept variations and a scene deck. The user selects/edits a deck, confirms unverified claims and triggers generation. The money path estimates/reserves the job before submission, records separate asset jobs, lands owned bytes, renders a final MP4, then burns captions. Finished images/reels are saved to Vault and visible in Content.

The six scene kinds are `generated_video`, `animated_image`, `uploaded_video`, `text_card`, `stock_video`, `stock_image`. Stock and uploaded footage already supply B-roll building blocks. A scene deck is a sequence of visuals with narration; it is not a multi-track editing timeline.

Video encoding happens in an ephemeral Vercel Sandbox through the existing authenticated render route. A development-only local adapter exists. Both are implementations of the renderer boundary; Convex itself does not encode video.

Entry points: [scene contract](../../../packages/core/src/storyboard.ts), [media tools and adapters](../../../packages/backend/convex/media.ts), [render orchestration](../../../packages/backend/convex/render/renderReel.ts), [actual assembler](../../../packages/backend/convex/render/assemble_final.sh), [hosted render route](../../../apps/web/app/api/media/render/route.ts), [director skill](../../../packages/contracts/skills/media-director.md).

## 3. Excel: real file, limited report model

### Confirmed limitations

1. `SheetSource.rows` is `string[][]`. `markdownToSheets` extracts pipe tables, and `sheetsToXlsx` passes those string arrays to SheetJS. Numeric-looking values remain string cells. The skill asks for plain numbers, but the writer does not convert their types. That weakens calculations, numeric sorting, dates and chart preparation.
2. The writer explicitly produces values without styles, widths or formulas. It does not author charts, table styling, freeze panes, print layouts or an executive summary design.
3. The drafter explicitly prohibits formulas, images and prose and asks the model to compute useful totals itself. A reporting engine should instead calculate supported totals deterministically and preserve source lineage.
4. Sheet headings become sheet names; there is no typed report schema describing units, decimals, row roles, formulas, chart ranges, input/derived cells or source references.
5. Output validation proves that a workbook opens and its rows survive. That is not proof that it behaves like a financial/operating report.

Evidence: [Markdown-to-sheet conversion](../../../packages/core/src/documentGen.ts) (`SheetSource`, `markdownToSheets`); [actual writer](../../../packages/vault/src/sheets.ts) (`sheetsToXlsx`); [spreadsheet instructions](../../../packages/contracts/skills/spreadsheet-drafter.md).

### Reading uploaded reports

Original bytes are retained. XLSX text extraction walks XML and reads cached values; it does not evaluate formulas. The text projection loses workbook styling, formulas and address/blank-cell structure. A separate `vaultSheets` projection displays named sheets as strings, capped at 200 rows, 30 columns, 10 sheets and 256 KiB JSON. These are view/storage bounds, not a claim that the underlying file has only that much data.

The grid is intentionally optional: failure to construct it must not destroy a successfully ingested document. Search and grounding primarily consume the text projection. Thus an uploaded report can be summarized without the system understanding all of its spreadsheet semantics. Cached formula results can also be absent or stale; a summary must not silently represent them as freshly recalculated.

The chat attachment picker currently advertises images/PDF/audio/text, not Office files. Office upload support in Vault/onboarding therefore does not mean a user can attach every workbook directly to the chat composer.

Evidence: [Office text extraction](../../../packages/vault/src/officeText.ts), [grid projection and caps](../../../packages/vault/src/sheets.ts), [Vault preview](../../../apps/web/app/(app)/dashboard/vault/PreviewModal.tsx), [chat picker](../../../apps/web/app/(app)/dashboard/workspace/IntakeControls.tsx).

### Recommended direction

Add a validated workbook/report object for the advanced path: explicit strings/numbers/booleans/dates, units, references, deterministic derived values, supported formulas and their cached results, report sections and a theme. Keep the simple Markdown path working for existing callers. Formulas need a defined calculation policy; merely writing `=SUM(...)` is not calculation or verification.

Start with a professional report containing Summary, Data, Calculations and Sources sheets as appropriate to the brief. Style hierarchy, widths, filters, frozen headers, number formats and print setup matter alongside charts. Preserve raw source values separately from derived results. Define how an existing uploaded workbook is transformed; do not promise arbitrary lossless round-trip editing.

Spike the installed SheetJS against that concrete fixture before adding a dependency. For richer styling, ExcelJS is a candidate, not a selected dependency. Its official README documents workbook styles, tables, validations and formula values; it does not make every advanced Excel feature automatic. A chart/dashboard requirement must be tested explicitly, including whether charts are editable or rendered images. SheetJS supports formula serialization but its Community Edition is not a calculation engine. See [ExcelJS documentation](https://github.com/exceljs/exceljs#readme) and [SheetJS formula documentation](https://docs.sheetjs.com/docs/csf/features/formulae/), checked 2026-10-21.

## 4. PowerPoint and PDF

PPTX generation is absent by design. `DocFormat` is closed, the tool description explicitly says it never creates PowerPoint/Word/slides, and accepted ADR-036 excludes PPTX/DOCX. Asking the existing document tool for slides cannot produce a real presentation. Uploaded PPTX text/chart-cache/notes extraction is a different capability; picture-only slides are not semantically read by that text walker.

This owner request supplies the missing product demand named in ADR-036's supersession condition. After go-ahead, record a new ADR superseding the relevant Office-output decisions, without rewriting accepted history or introducing DOCX unless requested.

The PDF renderer already provides clean basic typography and tables. It uses fixed US Letter pages, Helvetica Standard-14 fonts and WinAnsi sanitization. There are no general image/chart/template composition primitives. This is appropriate for simple memos, but it is not a presentation layout engine or broad multilingual design system.

Recommended presentation flow: grounded outline → validated slide specification → code-owned template/layout selection → editable text/shapes/charts/images → actual `.pptx` → rendered slide previews/PDF twin → visual QA → owned download. An image pasted onto every slide does not meet the requested editable presentation bar. Preview fidelity and file editability need separate checks.

PptxGenJS is a practical Node/TypeScript candidate to spike: its official documentation describes slide objects, charts, images and masters. It does not remove the need for layout constraints, overflow detection or a separate preview/conversion mechanism. No library is installed or selected in this discovery. See [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) and its [chart API](https://gitbrent.github.io/PptxGenJS/docs/api-charts.html), checked 2026-10-21.

Evidence: [ADR-036](../../../docs/decisions/036-office-fidelity-pdf-twin-text-projection-xlsx-out.md), [PDF implementation](../../../packages/backend/convex/lib/markdownPdf.ts), [formats](../../../packages/core/src/documentGen.ts), `createDocument` in [llm.ts](../../../packages/backend/convex/llm.ts).

## 5. Images and video: why quality has a ceiling

| Finding from source | Consequence | Proposed response |
|---|---|---|
| Image submission pins `quality: "low"`, size `1024x1536`, `n: 1` | One economical portrait image, without a user-selected quality or placement profile | Price and validate explicit quality/geometry profiles; compare outputs before selecting defaults |
| Live video default is `x-ai/grok-imagine-video` at `720p` | Current generated inputs do not establish native 1080p detail | Qualify provider/resolution candidates against the same scenes; no silent upscale claim |
| Assembler starts at 720×1280/30fps, then inherits dimensions/fps from the first video scene | Output geometry depends on input order; the director's 1080×1920 wording is not a guarantee | A priced, explicit render profile independent of the first clip |
| Generated stills are 2:3, while the reel is generally 9:16 | Crop/reframe can remove useful content | Placement-specific framing and safe areas with truthful previews |
| Stock search fetches 15 results; picker takes first usable asset, preferring portrait and a rendition near 1280px tall | Availability/duration is checked, not semantic match, subject continuity or editorial quality | Candidate previews, relevance review/ranking, deduplication and replacement controls |
| Maximum generated video is 12 seconds per reservation; reel targets are 15/30/60 seconds | Strong pressure toward stock, stills and cards, especially in a 60-second reel | Keep cost-efficient defaults; qualify an explicitly costed premium policy if justified |
| Basic sequential scene contract, Ken Burns stills, text cards and concatenation | Limited visual layering, transitions, motion typography and branded composition | Add only the primitives the agreed quality fixtures require |
| One pinned narration model/voice (`gpt-audio-mini`, `nova`) plus verbatim check | Good provenance guard, limited delivery choice and cross-scene performance control | Compare voice continuity and pronunciation; preserve exact-script verification |
| Technical render gates check duration, decode, audio timing and sidecar validity | A technically valid reel can still be visually weak | Add editorial and visual acceptance gates over rendered samples |

These findings explain constraints, not a measured verdict on the owner's particular clip. No production media was downloaded or visually adjudicated in this pass.

### B-roll is an editorial workflow

Stock/upload support already exists. The missing quality layer is planning which supporting shot proves or illustrates each spoken idea, choosing appropriate footage, controlling repetition, maintaining style and timing cutaways against a continuous narration. A useful shot specification should include purpose, subject/action, framing, intended placement, source candidate, trim range and safe text areas. Keep the first implementation bounded; a full general-purpose video editor is not necessary.

Reuse the existing clean-take caption timing, no-overlapping-speech rule, loudness handling, attribution and owned-byte storage. Improve caption hierarchy/safe areas, branded title/end frames, motion choices and pacing from the supplied skill and agreed examples. Do not substitute a new model for editorial work.

### Images need a set-aware design process

The adapter has text-to-image controls, not a complete product for source-image editing, masks or reference-conditioned brand/product consistency. Add reference workflows only after proving the selected provider's actual interface and cost. Exact logos, charts and readable text should generally be composited from controlled assets/text rather than entrusted to image generation. Build aspect-ratio variants from a composition spec, not blind crops of one file.

### Budgets and model choice

Current source constants include a $3.50 whole-media-job cap and a $10/day tenant media window, plus an independent deployment ceiling. These are configured policy in this tree, not current quotes or measured live balances. The image reservation was calibrated for the existing low-quality geometry; increasing quality without changing the estimator and reconciliation is unsafe accounting.

The earlier storyboard bake-off measured parser-valid two-deck responses and timeout behavior, not final-video aesthetics. Its winner does not prove the best director for a higher quality brief. Provider/model capabilities, pricing, terms and quotas must be rechecked during the spike. This report makes no claim that a historical provider price remains current.

Evidence: [submit body](../../../packages/backend/convex/media.ts) (`buildSubmitBody`, `fetchStock`), [stock selection](../../../packages/core/src/stockSelection.ts), [prices/defaults](../../../packages/cost/src/media.ts), [daily rail](../../../packages/backend/convex/guardrails.ts), [assembler](../../../packages/backend/convex/render/assemble_final.sh), [prior bake-off](../../phases/33.2-storyboard-authoring-moves-to-a-measured-model-pin/33.2-BAKEOFF.md).

## 6. Batch production: distinct layers

### What already works

1. A media `batchId` groups the pictures, voice takes, captions and music needed for ONE reel. Reservation, claim/landing idempotency, terminalization and selective scene retry already exist.
2. Provider image submission requests `n: 1`; there is no campaign-level image-set request in this tool surface.
3. `createVariants` → `startContentBatch` produces versions of a WRITTEN piece. Its form set is `long | short | sheet`; up to `MAX_FAN_OUT = 15` children are narrowed further by budget. A parent presents one approval card and the existing Vault channel handles immediate/scheduled filing.
4. `runVariant` returns drafted Markdown through `landSpecialistResult`; it does not call image generation, video generation or the reel renderer. In particular, accepting `sheet` here is not proof of a collection of separately downloadable styled XLSX files.
5. Same-thread successive images are allowed. `stageImagePlan` removed the historical lifetime prohibition and refuses in-flight overlap. A stale playbook passage still says a second image requires another conversation; the source is authoritative for this finding.

Therefore, existing batching is valuable infrastructure, but it does not implement “make 20 brand images and 5 finished reels for this campaign.” Raising `MAX_FAN_OUT`, changing `n`, or looping the current one-plan canvas is not a complete solution.

Evidence: [variant tool](../../../packages/backend/convex/llm.ts) (`createVariants`, `runVariant`), [batch minter](../../../packages/backend/convex/dispatchRun.ts) (`startContentBatch`), [worker bound](../../../packages/backend/convex/lib/dispatchShared.ts), [image staging](../../../packages/backend/convex/plans.ts) (`stageImagePlan`), [Phase 43 record](../../phases/43-batch-content-and-the-content-queue/43-SUMMARY.md).

### Proposed product contract

Support three explicit requests: an image set, a video set, or a mixed campaign. Example: one campaign brief yields a matrix of hooks/audiences/concepts, selected image placements and three reel concepts. The user reviews the proposed items, quality, quantities and aggregate maximum cost before paid generation.

Each item needs its own stable identity, specification hash/version, status, spend and artifact references, with a campaign parent for totals and progress. Reuse plan ancestry and current media jobs where they fit; introduce only the minimum metadata needed for campaign membership and recovery. One item's failure must not discard completed siblings or claim the entire campaign succeeded.

Start with bounded concurrency measured against actual provider and sandbox quotas, not 15 simultaneous renders. Admit work against an aggregate campaign ceiling and the existing tenant/deployment rails. Retries need idempotent claims and separate cost disclosure; an ambiguous paid submission must not be blindly repeated. Cancellation stops new work and reports any already submitted work accurately.

Review in a contact sheet/storyboard/video list; approve or reject individual items, request replacement for selected failures, preserve completed outputs and expose actual total spend. A collection download should include assets plus a manifest with filenames, concepts, source/licence credits and source/report references where relevant. Campaign derivatives must share an explicit brand specification; consistent prompts alone do not guarantee consistent subjects.

Generation and external publication are separate events. ADR-046's exact-content human review remains in force for publishing, and the existing managed social-service programme owns its Buffer/Zernio integration. A bulk generation approval is not blanket future-post consent.

## 7. GSD and playbook reconciliation

Reviewed `CLAUDE.md`, `.planning/config.json`, PROJECT, STATE, REQUIREMENTS, ROADMAP, the managed-services programme, the merged system audit, Phase 18/20/20.2/33/33.1/33.2/40/43 records and relevant cockpit/media/vault/dashboard/guardrails/registry ownership.

| Record | What it actually establishes |
|---|---|
| Phase 18, 8/10 | Document creation implemented; 18-09 live/documentation gate and 18-10 blueprint drift exclusion remain open; ACTN-04 not fully closed |
| Phase 20, 17/20 | Much of the media pipeline exists; original supported live/candidate clearance chain remains open |
| Phase 33, 10/10 | Guided intake, concept alternatives, canvas/failure/citation UX completed under its scope |
| Phase 33.1, 5/6 | Provider migration implemented; 33.1-06 end-to-end acceptance remains open in the roadmap |
| Phase 33.2, 3/3 | Historical storyboard model selection and owner-observed reel; not a present quality benchmark |
| Phase 40, 3/3 | PDF display, basic XLSX writer and capped grid accepted; does not promise professional Excel/PPTX |
| Phase 43 summary | Written-content batching implemented; it does not claim media campaign rendering |
| Current STATE/programme | Qualification remains partial; planning can proceed alongside it, but shared-boundary/service implementation follows the approved order |

The documentation is rich but contains historical contradictions. Examples: MEDIA-01 still mentions fal and a September no-reel statement after later OpenRouter work; parts of media.md describe uniform blocks/Wan while the current contract is variable scenes/Grok; a second-image restriction was removed in code; REQUIREMENTS carries an older Phase 23 count than STATE. These need scoped reconciliation during implementation, not silent rewriting of historical evidence or a discovery-time declaration that all old gates passed.

Graphify CLI was attempted first as required by CLAUDE.md, but is not available on PATH. The committed graph was used to locate relevant modules, then focused source reads verified behavior. The graph is a navigation aid and may lag extracted helpers; it is not runtime evidence. No graph refresh is necessary for this documentation-only change.

An open draft, [PR #36](https://github.com/Mrjoel97/ProjectX/pull/36), was inspected as overlap context. It describes artifact review/edit and broad closure changes on `step0-evidence-integrity`; the connector reported it open/draft/unmerged and not mergeable at observation. Its different base and large scope mean its narrative cannot be treated as the checked-out main baseline. Coordinate any future Output-card/Vault/review changes against the actual current diff before implementation; do not import that branch wholesale.

## 8. Change ownership and preservation

| Surface | Existing owner / implication |
|---|---|
| Media contract/pricing/adapters/canvas/renderer | `media.md`; corresponding pricing/guardrail and cockpit owners where watched paths overlap |
| Document tools / Output card | `cockpit.md`; very shared `llm.ts` and `cards.tsx` require one implementation owner per wave |
| Workbook parser/writer / ingest / preview / retention | `vault.md` |
| Content shelf and shared Markdown display | `dashboard-pages.md` |
| Drafter/director bodies, seeds, activation | `skill-registry.md`, existing skill mirrors and evaluation controls |
| Schema, lockfile, generated API, global planning | Shared integration files; coordinate explicitly, additive changes only where possible |
| Managed social publication/reporting | Current programme and Buffer/Zernio playbooks; generation work must not bypass their admission rules |

Keep tenant checks, source refs/hashes, refs-only audit payloads, explicit artifact provenance, bounded reads, truthful unavailable/partial states, cost-before-submit and replacement-before-old-byte-deletion. Keep prompts in versioned registry rows; a supplied skill is not a licence to execute arbitrary model-authored rendering code.

## 9. Decision requested after this packet

Approve a scoped production-quality programme comprising rich Excel, editable PowerPoint, media quality and batch images/videos. Begin with the fixture/architecture spike in the proposed plan, incorporate the supplied video skill, then choose implementation phases and any programme-order change explicitly. Quality presets, provider choices, preview runtime, licensed assets, paid comparison budget and release remain concrete decisions to resolve from those results.
