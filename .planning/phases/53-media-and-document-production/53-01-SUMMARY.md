---
phase: 53-media-and-document-production
plan: "01"
status: partial
date: 2026-10-21
requirements: [ARTF-01, ARTF-02, ARTF-03, ARTF-04]
requirements-completed: []
---

# 53-01 — Partial offline implementation

Subsequent scope is tracked in [53-02-SUMMARY.md](53-02-SUMMARY.md): per-chat artifact tabs,
the local actual-page PDF reader and native Office qualification. Its PowerPoint 15.0 render and
saved/reopened title edit supersede the initial "no Office converter found" observation below;
historical lane counts and initial gaps remain as recorded. Neither plan is complete.

The owner approved implementation and multiple agents after reviewing the discovery packet. Work
is isolated on `codex/media-documents-discovery-20261021`, based on
`821c3206e47eb4cec0ebcf3d99cf943358f2910a`. This records work in progress, not a completed plan,
deployed feature, active registry version or paid output-quality acceptance.

## Implemented locally

- Rich XLSX: bounded typed reports, conservative legacy-table conversion, deterministic supported
  calculations, source metadata, themed formatting, filters/frozen headings/print settings and one
  native column/line chart. Existing attachment and standalone spreadsheet paths now use
  the rich writer. The original simple SheetJS helper remains. An actual ExcelJS apostrophe bug in
  print defined names was reproduced and narrowly repaired in the export archive.
- Editable PPTX: bounded seven-layout specification, native object/table/chart/notes writer,
  `presentation-drafter` source/mirror, additive MIME/form support, tenant-owned preview projection
  and labelled scriptless layout preview. This is not an Office renderer or PDF slide conversion.
- Media campaigns: tenant-owned proposal/item tracking, exact-review approval hash and aggregate
  reservation using existing child rails. One running or reconciliation-required campaign per
  tenant admits at most two active deliverables. The cap is 15 items. Campaign creation, all director
  schedules and a normalized request/spec creation key now commit atomically; exact replay reuses
  the same campaign without rescheduling directors. Partial/reconciliation states, selected disclosed
  retries, cancellation, individual downloads and JSON manifest/credits remain explicit. Private
  plans are excluded before bounded ordinary-root and approval queries. The Executive scans title,
  labels, prompts and briefs before persistence/scheduling, and refuses controlled evaluation modes.
- Optional Office previews: generated XLSX bytes are re-read through the existing 200-row/30-column/
  10-sheet/256KiB grid projection. Preview failures leave the original artifact, audit and Output
  card intact; oversized 128 KiB PPTX preview specs are skipped with truthful download/preview copy.
  Both upserts carry expectedStorageId guards, and document patches clear previous sidecars so a
  late old preview cannot replace the current original. These are local race/failure protections.
- Current cost policy: campaign maxima match the existing job-estimate policy: upward whole-cent
  rounding on the complete batch estimate (chooseMediaBatch uses max(1, ceil(estUsd×100))). No new
  cheaper floor-based policy or provider ceiling is introduced. Parent reserved maxima are not
  provider actuals; existing daily/deployment rails and uncertain-outcome semantics still apply.
- Media quality: the assembler now fixes the portrait container at 720×1280 / 30 fps, uses Lanczos
  scaling and a common 15360 track timescale, then copies normalized H.264 streams at concatenation
  instead of adding a redundant picture encode. This is an export consistency/compression fix,
  not native 720p source-detail or overall visual-quality proof. Source B-roll selection changes
  and the supplied Taste Skill reference are reviewed separately. Taste Skill is frontend-design
  guidance, not a video-generation provider. Final image/reel quality and paid comparisons remain
  unqualified.

## Actual lane evidence, before final integration

| Lane | Reported local result | Scope |
|---|---|---|
| XLSX core/writer | 23 core + 6 writer tests passed | Real bytes reopened with SheetJS and ExcelJS; types, calculations, style/freeze/filter/print/source metadata and chart parts/ranges/caches. No Office visual review. |
| Presentation core/writer | 23 core + 5 writer tests reported passed | Bounded layout/spec and native file/package checks. No PowerPoint opening/editing or rendered-slide acceptance. |
| Media campaign core/backend | 4 core + 7 backend tests initially reported passed | Initial offline queue/admission/status/isolation scenarios; final expanded root counts must be recorded separately. No hosted provider or real campaign purchase. |
| Production artifact callers | 13 integration cases reported passed by the presentation lane (42 cases in its combined focused writer/render run) | Real local XLSX/PPTX bytes and replacement ownership; injected optional-preview failures preserve one artifact/card/audit and one draft; a 201-data-row XLSX retains all original rows while its preview remains capped. No paid/hosted/native Office acceptance. |

These are delegated lane observations on working-tree source, not immutable final-SHA or
consolidated repository gate receipts. The integration owner must record its actual results
separately. Host resource exhaustion occurred during parallel verification; avoid concurrent broad
typechecks and browser processes. Do not call a check green merely because it was launched.


## Concrete synthetic XLSX sample

The existing application reportFromSheets/reportToXlsx exported .tmp/office-qa/report-example.xlsx
(15,141 bytes; SHA256 ecff457430afd4b8514616cb72c7892fcfaf010f431de1fce8a6847b2a7cda51).
All values are labelled synthetic; no customer/provider data or paid call was used. The same bytes
were reopened independently with SheetJS and ExcelJS. Assertions verify typed amounts/dates/booleans,
leading-zero account IDs, profit/margin/total formulas and their independently expected cached
values, source metadata, header styling, numeric formats, freezes/filter/print settings, native
chart ranges/cache/relationships and absence of macro/external-link parts. The local check report
is .tmp/office-qa/report-example-checks.json. Quarterly revenue is TZS 42,700,000, costs 26,600,000,
profit 16,100,000 and operating margin 37.704918%. No native Office recalculation, editability or
visual review was performed; this sample is structural/local output evidence only.

## Final offline integration review

The three delegated lanes are integrated on the isolated branch. Actual working-tree checks:

- All 63 core test files passed: 1,698 cases. All 16 Vault test files passed: 201 cases.
- Backend regression selection passed 822 cases across nine files; the campaign lane passed 16,
  production artifact/native PPTX/assembler checks passed 43, and the real seven-second FFmpeg
  fixture passed separately. These are focused selections, not the entire backend suite.
- Frontend content/campaign checks passed 30 cases. The optimized web production build passed.
- Final backend and frontend typechecks passed. The campaign tool tests include the SDK's
  required execution context and passed again after that test-only typing correction.
- All 22 registered free gates passed after the current evaluator revision/manifest refresh.
  The 46-case corpus/hash is unchanged; earlier paid receipts remain historical and unchanged.
- Campaign browser QA exercised four synthetic states at 390/768/1440 pixels (12 cases).
  Taste Skill app inspection reported zero failures and one justified warning for Pikar's
  required uppercase brand labels. The component used mocked Convex data; this is not hosted QA.
- Runtime formatting checks reported no errors. Final planning, playbook coverage, whitespace
  and exact evaluator fingerprint checks passed. No production registry seed was executed.

The Graphify executable is unavailable, so a fresh AST graph could not be generated. The existing
Convex graph fixup ran successfully (two additional call edges and the two new table nodes), but
reported unresolved new module references; do not describe the full graph as regenerated.

## Open acceptance and next work

1. Review the isolated implementation and its remaining release gates. Static API inventory and
   tenant lifecycle classification were updated; live development code generation and authenticated
   hosted download/erasure-fence acceptance remain unperformed.
2. Optional-preview failure, capped grids, stale-storage guards, foreign-tenant refusal and replacement
   cleanup have offline regression coverage; retain these checks through hosted qualification.
3. Extend the actual native Office observations in 53-02 to representative chart/data edits and
   intended application behavior. PowerPoint 15.0 opened/rendered the seven-layout sample and
   preserved a title edit through save/reopen; chart-data editing and instrumented repair-warning
   checks were not exercised. Native Excel qualification is recorded by its lane. HTML previews
   alone cannot close this acceptance gate.
4. Qualify the exact new registry version before any reviewed seed/activation. The presentation
   drafter is currently a non-gated builtin, whose ordinary first seed can auto-activate; no seed
   or activation was performed by this implementation scope.
5. Qualify a representative image set and 30/60-second B-roll reels with actual output measurements,
   credits, captions/audio/pacing and owner review under a separately approved paid scope.
6. Exercise hosted queue recovery, uncertain paid submissions, duplicate callbacks, selective retry,
   cancellation and partial downloads. A JSON manifest with individual files does not satisfy the
   proposed single collection/archive download target.
7. ARTF-01..04 remain open; no phase closure or release qualification is claimed. Phases 48–52 keep
   their current admission order and historical evidence.
