---
phase: 30-optional-vertical-workflow-packs
plan: 03
status: partial
updated: 2026-09-10
requirements-completed: []
---

# 30-03 — Deterministic Data core and adapter

## 2026-09-28 final-write source-state correction

The Data operator preview used separate action reads and a generic Vault insert.
A source could become non-ready, sealed, repointed, retyped or lose its blob
after profiling but before the artifact write. A test using that exact two-step
ordering failed on the old insert validator, then passed after an optional
source check was added to the final `insertCreatedDoc` mutation and the preview
passed its prepared storage/MIME identity. The final mutation checks tenant,
ready state, exact storage and MIME, stored-byte presence and current folder
seal before inserting. Existing created-document callers omit the check and
retain their behavior. This is local source integrity only; native semantic
evaluation, authenticated UAT and activation remain open.

The focused Data/created-document/native-binding/discovery selection passes
**42/42** after a structural action-to-final-write wiring guard was added;
backend TypeScript passes. The shared Vault source edit retired the
old golden evaluator revision and its dependent web-recipe hash. The code-owned
golden revision, manifest, web-recipe hash and generated native vertical
revision were refreshed from current bytes; regeneration did not run a model
or mint evidence. All **34** free gates then passed. The shared Phase 49
71-file set was independently requalified by its serialized **21/21-plane**
local aggregate on digest
`c64396efd1c966a69ec429bb9bf27562197a561be6403290a551353ffafa6e91`;
this renews the overlapping public-runtime layer only. The Data candidate
still has no semantic model verdict, authenticated pack UAT or activation.

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
