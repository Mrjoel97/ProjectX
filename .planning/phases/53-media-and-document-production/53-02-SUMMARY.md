---
phase: 53-media-and-document-production
plan: "02"
status: partial
date: 2026-10-21
requirements: [ARTF-01, ARTF-02, ARTF-03, ARTF-04]
requirements-completed: []
---

# 53-02 — Artifact workspace and local qualification, partial

The owner authorized the next workspace/Office/quality scope in the same isolated worktree.
This plan adds local implementation and qualification evidence to 53-01; neither plan is complete.
Phase 48/48-02 remains primary, and the 48 → 49 → 50 → 51 → 52 admission order is unchanged.

## Implemented locally

- Conversation output metadata is independently paginated across documents, root-plan/attachments,
  campaigns and scoped references. Selected resolution/download checks tenant and exact thread;
  inventory rows contain no download URLs or document bodies.
- Work/output tabs, a reopenable output browser, bounded references, unread new-output notices,
  deliberate-selection preservation, keyboard navigation and an expanded workspace reuse existing
  card/media/campaign flows. Session storage contains UI references/preferences only, partitioned by
  owner subject and thread. It is not an ownership authority or content store.
- Shared ArtifactViewer/ArtifactViewerBody provides safe text/Markdown reading, scriptless same-spec
  slide previews with controls, capped read-only worksheet views and image/video surfaces. Original
  download remains explicit. Uploaded Office without a projection has an honest original fallback.
- Actual PDF pages use exact pdfjs-dist 6.4.299 and local versioned worker/CMap/font/WASM assets copied
  before web development/build. Streamed reads stop above 32 MiB; current-page canvases are bounded,
  old tasks/readers are cancelled and a real text layer supports selection. The renderer creates no
  scripting, forms or link-annotation layer and disables XFA/annotations. Generated Markdown/PDF can
  use Reading or Original PDF. The Vault PDF branch reuses the reader. ADR-063 supersedes only the
  old plugin-iframe decision, preserving originals, tenant checks and selected-only capabilities.
- Campaign tabs are collections over existing job/approval/spend state. They do not introduce a
  second production engine. Manifest plus individual files still does not provide a ZIP archive.

## Actual delegated local evidence

The viewer lane passed 20 focused tests: 8 reading-canvas cases, 7 PDF-reader cases and 5 streamed-byte
admission cases. Existing previewState/PreviewControls add 22 passing regressions. Reader tests were
rerun after correcting cleanup to PDFDocumentLoadingTask.destroy(), the installed v6 API. These
counts are lane evidence; final controller/backend/repository checks belong to the integration
owner and must be recorded separately.

Real local Edge fixture QA rendered both pages of an actual synthetic PDF with text-layer content,
page changes, zoom/Fit, a 420-pixel pane without page-level horizontal overflow, generated reading,
slides/chart, worksheet switching and the selected original-download callback. The observed run
made no external requests and had no page errors. Screenshots/result are under
`.tmp/artifact-viewer-qa/`; the fixture has no authenticated Convex session and does not prove a
hosted original download, production authorization, or live multi-agent completion.

Microsoft PowerPoint 15.0 was found locally. Isolated automation with macros disabled opened the
generated seven-layout `.tmp/presentation-qa/specimen.pptx`, rendered seven 1280×720 PNGs, exported
`office-render.pdf`, and found one native chart and one native table. A title text edit was saved
to `office-edited.pptx`, reopened and confirmed. All seven native slide images were visually
inspected with no observed clipping/overlap. The owned application instance closed; no user
presentation was opened. `native-office-result.json` records the actual observations. Native
chart-data editing, every possible layout input, hosted download and repair-warning instrumentation
were not exercised; native successful opening alone is not a universal fidelity claim.

The native-opened original has SHA256
`388f83aba5a740bacf1359a6349d0ff8cd05c08299ece70120400c3a11ae375a`;
the static writer source at that check has SHA256
`74a559fe93ad91e5e80cf08e9b5d0ba9f479fef96061bb9ae54c06c80d11bc31`.
These pin the local specimen/check, not a committed repository revision or hosted release.

Native Excel qualification and the measured media comparison are tracked by their own lanes and
the Phase 53 quality benchmark. No paid image/video/model request, deployment, registry seed or
activation, publishing or owner artifact-quality acceptance was performed by this viewer lane.

## Integration observations added after the delegated viewer lane

The final reader has 21 focused checks (eight body, eight PDF and five byte-admission checks),
plus 22 existing preview regressions. A further existing getDocument admission assertion passed
with supported 16-million-pixel embedded-image rejection and 64-million-byte worker canvas
resize thresholds. These limits do not sandbox total worker memory. The 32 MiB input and hard
16-million-pixel current-page raster limits remain independently enforced.

The workspace/browser matrix exercised 30 scenarios at 390, 768 and 1440 pixels using actual
components with mocked Convex data and local synthetic SVG/MP4 content. Tab close/reopen,
manual selection during new arrivals, worksheet/slide changes, batch image/video navigation,
failed children and production view switching passed. No external requests, automatic generation,
page errors or page-level horizontal overflow were observed. Real MP4 playback exceeded 0.3
seconds with readyState 4 at each width. It found a portrait-video layout defect; constrained
grid/video sizing fixed it, and the rerun confirmed fitted video bounds and visible controls at
all widths. Screenshots, geometry and scenario results are in `.tmp/workspace-tabs-qa/`.

Microsoft Excel 15.0 opened the original synthetic XLSX in an isolated owned instance with macros
disabled and external-link updates off. CalculateFullRebuild preserved the 42,700,000 revenue,
16,100,000 profit and 37.704918% margin. Editing the July revenue from 12,000,000 to 13,000,000
recalculated totals to 43,700,000/17,100,000 and 39.130435%, then the input was restored.
The native column chart had three expected data points. Numeric, date, boolean and leading-zero
identifier cells survived; formula-error and overflow scans passed. All four exported PDF pages
(monthly table, quarter totals, sources and chart) were visually inspected without observed
clipping or broken charts. `native-excel-checks.json` records the unchanged original and closed
owned process; `native-excel-report.pdf` and page PNGs are under `.tmp/office-qa/`.

The new core/key/review and existing Vault-surface selection passed 24 tests. All 22 registered
free gates passed; exact evaluator source/manifest revision is
`2026-09-11.budgeted-evaluator.2b99f65eb3aad5d674d03fa0fbebff78822bb48e86044d295d9443f14ac4eb28`,
with the same 46-case corpus/hash. No historical paid receipt was rewritten. Planning, playbook
coverage and whitespace checks passed after the authorization note was included. Formatting
reported no errors (existing stylesheet specificity warnings remain).

The full frontend run observed 1,211 passing checks and two existing skips across 84 files,
with one stale assertion that all formats must refuse PowerPoint. That assertion was corrected
to require actual PDF, XLSX and PPTX success receipts, and all 11 checks in its file passed.
A later targeted controller rerun hit a host-contention timeout, despite the earlier four checks
passing; final rerun results are recorded below rather than treating the timeout as green.
The final annotation-only backend inventory rerun similarly reached seven passes before its
60-second case timeout; the prior 24 inventory/campaign checks passed. The host has 8 GB RAM
and concurrent unrelated work; only this worktree's build was stopped to serialize final checks.

Graphify CLI remains unavailable. Convex graph fixup completed with no additional edges/table
nodes and reported unresolved references. This is not a refreshed AST graph.

### Serialized recovery checks

After stopping only this worktree's overlapping build, the final backend typecheck passed.
The unchanged controller/PDF reader selection then passed all 12 checks with normal timeouts,
and all eight backend inventory cases passed, including the case that had timed out. No timeout
was raised and no assertion was weakened. The corrected format-receipt file passed all 11 checks;
the tab-state file passed all eight. The earlier full frontend run's sole behavioral assertion
failure is therefore resolved; its two existing skipped tests remain skipped.

The production build then ran alone against committed source `bdd71ecd2c5505b8e3e3bd691f59c100f67f98a2`
and exited zero, including TypeScript, page data, static generation and final optimization. The
exact PDF.js local assets synchronized successfully. It used GOMAXPROCS=2 and a 2048 MiB Node heap
limit to avoid overlapping memory-heavy checks on the 8 GB host. The final backend typecheck and
frontend build/typecheck are green. No product source changed after this validation; this final
documentation update does not alter the evaluator identity.

## Remaining acceptance

1. Exercise authenticated hosted multi-chat isolation, restored references, new-result arrivals,
   selected downloads, deleted/foreign references, keyboard/expanded focus and responsive layouts.
2. Preserve current Office originals and qualify representative layout/chart/data edits in the
   intended applications. Local synthetic results narrow this gap; they do not close ARTF-01/02.
3. Qualify current registry candidates through existing admission/activation rules before release.
4. Obtain separately authorized representative image and 30/60-second reel outputs with measured
   fidelity, B-roll/captions/audio/pacing/credits and owner review; a policy/fixture is not that run.
5. Retain hosted campaign recovery, uncertain outcomes, selected retries, lifecycle/erasure and
   complete collection-download gaps from 53-01. ARTF-01..04 and Phase 53 remain open, 0/2 complete.
