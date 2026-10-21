# Proposed production-quality programme

Status: proposal for owner go-ahead, not admitted GSD execution or a release request. Read [RESEARCH.md](RESEARCH.md) for the baseline and [CONTEXT.md](CONTEXT.md) for isolation.

## Product acceptance target

The user can request a grounded report, presentation, image set or video campaign in ordinary language, review the proposed work and cost where applicable, receive the actual files, inspect useful previews and revise selected outputs without repeating successful work. Beautiful means a reviewed visual result; useful means correct data, editable structure and reliable downloads.

## Proposed sequence

| Wave | Deliverable | Exit condition / decision |
|---|---|---|
| 0 — Quality examples and architecture spike | Small shared fixture pack, current-output baseline, owner's supplied video skill assessed; workbook/PPTX/preview feasibility compared | Agree quality examples and implementation dependencies; select only dependencies demonstrated necessary |
| 1 — Artifact specification and preview contracts | Typed workbook/report and presentation specifications; explicit media output/quality profiles; source/brand/version metadata | Validators reject unsupported/overlarge specs; existing basic documents still work; decide preview runtime and ADR changes |
| 2 — Rich Excel | Designed `.xlsx` reports with real cell types, deterministic supported calculations, meaningful formatting and charts as qualified | File opens in spreadsheet software, numbers behave correctly, formulas/results agree, original download and preview work |
| 3 — Editable PowerPoint | Designed `.pptx` with native slide objects, templates, images/charts, notes/source refs and preview twin | Opens as an editable presentation; all slides visually checked; title/body/chart layouts fit |
| 4 — Image quality and image sets | Placement-aware generation, qualified quality presets, controlled brand/text composition and comparative variant review | Relevant geometry/quality measured from actual files; selected variants retain brand/content and bounded cost |
| 5 — Better single-reel production | Editorial shot plan/B-roll selection, consistent render profile, branded composition, improved voice/captions and preview checks | Representative completed reels pass technical and owner visual review; costs/latency measured |
| 6 — Batch images and finished videos | Campaign manifest, child artifact tracking, capped workers, aggregate budget, partial completion, selected retries and collection export | One campaign yields multiple usable files; replay/cancel/failure do not duplicate purchases or lose completed siblings |
| 7 — Qualification and staged release | Regression, cross-tenant checks, registry candidate evaluation, hosted browser/download verification, playbooks and evidence reconciliation | Exact-source evidence and owner acceptance; release separately admitted through existing programme controls |

This order establishes single-output quality before multiplying it. Batch architecture requirements are designed in Wave 1 so image/reel work does not need a later rewrite. Documents and media have different render needs; share provenance, review, cost and storage conventions without forcing them into one universal rendering abstraction.

## Wave 0: concrete examples

Use synthetic, owned inputs, not customer confidential files:

- A monthly business report workbook with Summary, Sales, Costs, Calculations and Sources as appropriate. Include numeric amounts, percentages, dates, identifiers with leading zeros, missing values, totals and a chart. Compare both screen readability and printed/exported layout.
- An 8–10 slide business review/proposal: cover, summary, metrics, chart, comparison, process, recommendations and sources. Include a dense table, long title and representative non-ASCII text to expose layout/font limits.
- A set of campaign images with coherent branding across portrait, square and landscape placements. Include exact logo/headline overlays and one design requiring a reference asset if the chosen provider supports it.
- A 30-second and a 60-second reel from the same evidence-backed brief, mixing appropriate B-roll, controlled text, narration, music and captions. Include an uploaded-footage case and a narration pronunciation case.
- A small mixed batch, provisionally 10 images and 3 reels, for validating set behavior. This is a test scenario, not an approved spend or hardcoded product limit.

Record current outputs before changing defaults. The existing storyboard corpus is useful for routing/parser regressions, but add representative final-artifact quality examples; passing more parsers is not the new product objective.

Compare candidates on relevance, design/brand consistency, legibility, fidelity, editability, time-to-first-preview, completion time, actual spend and failure/retry behavior. Keep the same brief and supplied assets across comparisons. Record the model/provider that actually answered, not only the configured model.

## Architecture decisions to resolve from the spike

1. Supersede ADR-036's closed PPTX exclusion for the explicitly requested presentation output. Retain its ownership, original-download and provenance rules. Rich XLSX also changes its flat values-only boundary. Do not introduce DOCX implicitly.
2. Choose the minimum workbook writer that satisfies the fixture, including the exact chart and formula requirements. Test installed SheetJS first; compare ExcelJS or another justified writer only against missing capabilities. Define a bounded formula/calculation policy and cached-result verification. Do not execute arbitrary workbook macros, external links or model-written code.
3. Spike PptxGenJS or an equivalent library against editable objects and template consistency. Generation and preview conversion are separate choices: do not promise a PDF twin merely because a PPTX was written.
4. Decide whether document preview conversion needs an isolated worker. Reuse the existing render boundary's authentication, storage and temporary-file practices if useful; any new runtime must be justified and operated explicitly. A full desktop Office editor is beyond this proposal.
5. Define output profiles from measured final-file dimensions/fps, source suitability and current cost. A 1080p container does not prove native 1080p source detail. Do not assert 4K or universal aspect-ratio support without evidence.
6. Qualify any higher image quality, alternative video/voice route, reference conditioning or new asset library against current primary documentation and actual bounded probes. Do not raise existing caps automatically.
7. Consume the owner's supplied skill as design/workflow evidence. Keep production instructions in registry-owned skill bodies and rendering programs in reviewed code; do not install a second backend agent/tool framework by default.

## Batch production design

The proposed campaign flow is:

1. Brief and sources → campaign item matrix (concept, hook, audience, format, duration/placement, brand refs).
2. Preview of proposed items and total maximum cost → human generation approval.
3. Aggregate admission plus existing per-item, tenant and deployment rails → bounded queue of independent image/reel jobs.
4. Per-item planning/generation/render/validation terminals → campaign progress with complete/partial/failed/cancelled counts.
5. Contact-sheet and video review → retain, reject or regenerate selected items.
6. Owned individual downloads and a collection with a manifest/credits. Social publication remains a separate approved workflow.

Reuse existing plan parent/child lineage and media job machinery where the spike confirms their fit. A campaign ID and item identity may need additive metadata; do not equate the existing one-reel `batchId` with a whole campaign. The existing `MAX_FAN_OUT` is a written-specialist bound, not the new render concurrency setting.

Required behavior:

- Show requested/admitted/completed counts. If only part fits today's budget, make the partial admission explicit before generation.
- Reserve/admit the aggregate maximum without giving every child the parent's entire allowance. Preserve per-job rounding/reconciliation semantics and avoid counting parent+child estimates twice.
- Bound active provider submissions and sandbox renders separately; one expensive render should not starve the whole tenant.
- Persist claim identities and recovery state. Replayed callbacks or worker restarts must not repurchase completed items. Unknown paid-submission outcomes need reconciliation, not blind retry.
- Retry only selected failures; disclose additional paid generation. Preserve successful siblings and their source/spec versions.
- Cancellation prevents new starts; accurately report already submitted items that cannot be cancelled upstream. Never advertise a refund before settlement.
- Share a brand spec and selected reference assets across derivatives. Detect repeated stock assets and near-identical variants; allow deliberate reuse where the brief asks for it.
- Keep partial downloads available. A collection includes only real completed artifacts and states omissions rather than inserting placeholders labelled complete.

## Acceptance matrix for implementation

| Capability | Required proof |
|---|---|
| XLSX format and semantics | Re-open actual downloaded bytes; numeric cells are numeric, dates/currencies/percentages have correct formats, IDs retain leading zeros, supported formulas and totals match independent calculations |
| Workbook design | Render every populated sheet/print region; inspect widths, headers, filters, freezes, chart labels, units, clipping and missing-data treatment |
| PPTX format and editability | Open actual PPTX in presentation software; edit text and chart data; verify slide count, masters, notes, images and references; no repair warning |
| Presentation design | Render every slide; verify no clipped/overlapping text, legible hierarchy, consistent theme and correct chart data/source mapping |
| PDF/report quality | Check page boundaries, wide tables, images/charts, page numbers where required and selected font/Unicode coverage |
| Images | Inspect each output at intended placement; validate actual dimensions, subject correctness, controlled text/logo, consistency and provenance |
| Reels | Decode entire MP4; validate measured profile/duration/audio/captions, then watch for B-roll relevance, pacing, repeated shots, continuity, legibility and clear ending |
| Batch reliability | Partial failure, exhausted budget, crash/restart, duplicate callback, stale edit, selected retry and cancellation preserve exactly the correct artifacts and purchases |
| Product flow | Real authenticated browser request → preview/review → stored artifact → click download → parse downloaded bytes; local mocks are labelled separately |
| Isolation | Foreign tenant artifact/source/manifest refs refuse; failed conversion does not leak files or replace the existing good artifact |
| Cost and governance | No paid submit before admission; actual provider/model identity and settlement recorded; generation approval does not publish |

Visual thresholds and preferred examples should be agreed in Wave 0. The owner should approve a representative finished workbook, slide deck, image set and video set before these become the defaults. Do not claim quality from source scans, file extensions or technical render success alone.

## Coordination with ongoing work

Keep working from this isolated branch. Before implementation, fetch current `main` and inspect changed ownership against the active qualification lane, online-presence work, social connections and relevant open PR diffs. In particular, `llm.ts`, `schema.ts`, `vault.ts`, `cards.tsx`, skill seeds/mirrors, lockfile and generated API are shared.

Use one implementation owner for each shared file in a wave. Keep domain specs/validators pure TypeScript in existing packages. Update the responsible playbook in the same implementation commit and add a new immutable ADR when changing an accepted decision. Reconcile only relevant stale requirement/playbook statements against evidence; preserve historical receipts and existing open phase dispositions.

After approval, allocate GSD phase IDs from the then-current roadmap, write concrete PLAN files with dependencies and `must_haves`, and define source-bound verification before execution. The current managed-service programme controls admission; choose where this programme enters it explicitly. This discovery does not reorder phases, activate skills, approve paid comparisons or authorize deployment.
