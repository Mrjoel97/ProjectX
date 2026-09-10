---
phase: 30-optional-vertical-workflow-packs
plan: 03
status: partial
updated: 2026-09-10
requirements-completed: []
---

# 30-03 — Deterministic Data core and adapter

Implemented `packages/core/src/dataProfile.ts`, the bounded existing-SheetJS parser in
`packages/vault/src/dataWorkbook.ts`, and the thin owned-file adapter in
`packages/backend/convex/verticalData.ts`. No dependency or parser stack was added. The adapter
checks tenant ownership, current ready state, sealed-folder exclusion, actual storage bytes,
supported CSV/XLSX format and content hash. Operator preview saves an ordinary diagnostic Vault
artifact; it does not execute a candidate or establish candidate evaluation evidence.

The core computes observed counts, missing/invalid values, typed ranges, confidence, bounded
categories and duplicate rows. Numeric/date strings remain text instead of silent coercion.
Formula caches, unsupported workbook features, mixed semantics and truncation remain explicit.
ZIP inspection bounds input before inflation; the resulting cell projection is independently
capped. A sparse worksheet beginning beyond the parser window previously lost its truncation
evidence under `nodim:true`; the final adapter preserves `!fullref` and does not report unobserved
cells as completely inspected. No formula, macro, external link or warehouse query executes.

Created a Data canonical skill, exact source/body hash manifest, operation matrix, draft method
review and seven unevaluated outcome/adversarial scenarios. Source attribution is checked by the
shared two-way draft inventory. Numeric claims must derive from the trusted computed profile.

Verification: parser five tests and Vault typecheck passed; Data core twelve tests passed,
including actual red/restored mutations of a range statistic and row cap. Backend adapter,
isolation and recurrence checks passed together (55 tests). These local proofs do not establish
model numeric fidelity, independent method approval, authenticated UAT or activation. Native
model execution and all release requirements remain unclaimed pending those gates.
