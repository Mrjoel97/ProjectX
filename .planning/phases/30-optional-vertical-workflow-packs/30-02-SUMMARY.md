---
phase: 30-optional-vertical-workflow-packs
plan: 02
status: partial
requirements: [VERT-01, VERT-02]
date: 2026-09-10
---

# 30-02 — Native vertical controls and evidence-aware discovery

## 2026-09-28 derived repeat-use telemetry

The internal writer now emits a refs-only `repeat_use` audit event when a second
distinct ordinary-run artifact is recorded for the same tenant and exact native
candidate. It refuses direct writes of that derived event and excludes preview
artifacts, another version, same-artifact replay and foreign artifacts. Four
focused vertical suites pass 34/34; backend TypeScript, the six-lane/40-case
native corpus check, strict planning/playbook checks and all 34 free gates pass.
The lookup is limited to the latest 200 events and may undercount older demand.
No live tenant use, semantic evaluation, UAT, activation or release is inferred;
Plan 30-02 and VERT-01/02 remain partial/open.

Implemented tenant-scoped explicit intent/reviewer preferences, independent disable, same-tenant
owner rollback, and bounded closed telemetry. `skills` and `tenantSkills` remain the only version,
candidate, activation and rollback state. No release-proof flags, parallel registry or new ledger
were created.

`loadEffectiveSkill` checks the tenant's disabled vertical before either overlay or global fallback.
Rollback uses the existing sole activation transition and requires an exact same-tenant/name row
with native prior-active eligibility. Rollback never re-enables a disabled vertical. Existing Vault
artifacts remain readable. Ordinary users cannot invoke the evidence-exempt owner rollback.

Discovery composes the pure recommender from explicit profile selections and bounded distinct
artifact observations plus two explicitly confirmed prior owned artifact refs (historical workload bootstrap, server validated). It reuses native provenance/eval/browser evidence checks. All reserved
`vertical-{id}` names remain hidden from recommendations because executable native eval and authenticated UAT
evidence do not exist yet; neither a manually inserted active row nor unevaluated candidate can imply release.
New candidate activation remains refused by the explicit vertical eval release lock.

Telemetry uses typed candidate/artifact ids checked against tenant and vertical, closed event,
reason/outcome/cost/latency buckets, bounded counts and exact-key validation. It writes through the
existing insert-only audit choke point. Aggregates return counts over at most 200 events and mark
truncation. The bound native runtime emits actual artifact/completion/failure events; preview observations are excluded from production repeat demand.

## Remaining dependencies

- Reviewed bodies: draft canonical bodies and dormant native dispatch/grant bindings now exist.
- Exact-version current eval and authenticated multi-viewport UAT/provenance evidence.
- Authenticated acceptance of the implemented artifact picker and controls; sixteen local UI tests cover explicit consent, distinct owned artifacts, paging, preference preservation and subscription settling.
- Authenticated browser verification of the implemented tenant UI/runtime entrypoint and disable.
- Operational outcome proof and Data model-output consistency evaluation; trusted deterministic input validation is implemented.

VERT-01/02 are not declared fulfilled. These controls are tested infrastructure; no live publication,
provider spend, skill activation or runtime exposure occurred. The generated API declaration was
updated with exact module imports/types locally; normal deployment codegen should regenerate it.

## Verification

Targeted backend vertical controls, telemetry, owner isolation, recurrence-absence and skill-registry
tests; core vertical policy tests and typechecks. Final counts are reported with the enclosing audit
implementation report after the concurrent worker changes settle.

## 2026-09-27 repository-local integrity recheck

Two current-tree regressions found that workload updates dropped a previously selected legal
playbook when the optional argument was omitted, and that an exact confirmed CSV source beyond
the five-row discovery sample was invisible to a Data preview. Both failed before their repairs
and passed afterward. A third control kept the ready CSV rows but deleted their shared storage
object: `prepare` incorrectly returned `ok:true` before the repair and now refuses with
`validator-unavailable`. Deleted document rows also refuse. Discovery reads at most two confirmed
artifact IDs per six packs plus the existing five-row sample, filters tenant/status/sealed rows,
and now verifies storage metadata for Data/Design readiness without reading file bytes.

The focused controls, native binding and telemetry selection passed 22/22 on the changed source;
backend TypeScript, source formatting, all 30 registered free gates and strict planning/playbook
checks passed. Graphify and Convex-edge refresh completed after the source edits. This adds
repository-local integrity proof only. The plan remains **partial**: exact-version semantic
evaluation, authenticated browser control/UAT, complete outcome-event coverage and release
evidence are not supplied by these regressions; VERT-01/02 and Phase 30 remain open.

## 2026-09-27 recommendation-observation follow-up

Discovery now withholds a global native recommendation if a tenant overlay is active, matching
the ordinary start path's release boundary. The profile card makes best-effort shown and Start
selection observations; the server recomputes current recommendations, binds each event to the
exact active native candidate, requires a recent matching impression before acceptance, and
deduplicates repeated impressions in the bounded 200-event window for 30 minutes. Local tests
use an isolated synthetic qualified candidate only. These are exposure and user-selection
signals, not proof of runtime quality, outcome acceptance, live qualification, or activation.
Review-decision coverage and authenticated browser UAT remain open; status stays **partial**.

## 2026-09-27 review-event provenance guard

The internal telemetry writer now requires each review approval/edit/reject observation to
reference an owned artifact with a bounded prior creation event for the same native candidate
and vertical. Missing, foreign and wrong-candidate origins refuse; the focused telemetry suite
passes 3/3 and backend TypeScript passes. This prevents an ungrounded review event but does not
prove a person reviewed or edited output, supply a tenant review UI, or advance live UAT.

## 2026-09-28 preview/prod review-origin separation

A new negative control showed that a preview-created artifact could ground a non-preview
`review_approved` event (and vice versa) because the origin check ignored `preview`. The writer
now requires the prior creation observation and review event to agree on preview status.
Both mismatches refuse; matching preview and ordinary-run observations remain permitted.
The focused vertical selection passes 24/24, backend TypeScript and repository lint pass.
This is a local telemetry-provenance repair only. No authenticated human review UI,
actual edit/reject/approval decision, native paid evaluation, UAT, or activation is proven;
Plan 30-02 and the VERT requirements remain partial/open.

## 2026-09-28 authenticated artifact decision path

The existing workspace Output card now offers accept/needs-changes only when an authenticated
tenant's selected ready artifact has one unambiguous ordinary-run `artifact_created` origin
for the exact native candidate within the bounded audit window. The browser supplies only
the artifact ID and closed decision; the server derives candidate/vertical identity. Missing,
foreign, preview, ambiguous and contradictory decisions refuse; same-decision retries are
idempotent. One user-actor refs-only event records the decision, while system-actor synthetic
review observations no longer contribute to review counts. The artifact and candidate remain
unchanged. Local backend and DOM controls pass; the actual edit path, authenticated browser
acceptance, semantic evaluation and pack activation remain open. Plan 30-02 remains partial.

The focused backend vertical selection passes **27/27** and tenant-isolation suite **61/61**;
the uncontended full web suite passes **70 files, 1,067 tests, two existing skips**. Backend/web
TypeScript, lint, all 32 free gates, strict planning/playbook and graph/Convex-edge refresh pass.
An earlier concurrent full-web run had one 5-second local media sandbox timeout; that test
passed **10/10** alone and in the uncontended full run. These local controls do not replace
an authenticated deployed browser review or actual native model evaluation.

## 2026-09-28 in-place rewrite provenance repair

The created-document replacement seam now advances an optional private Vault revision,
and the authenticated vertical artifact decision refuses a document rewritten after its
original creation event. A separate public late-text ingest path previously accepted any
owned `docId`, including a ready agent artifact; a red-then-green regression now restricts
it to pending non-agent uploads. Five focused backend test files pass **80/80**. This is
integrity hardening only: model-driven rewrites are not human edits, `review_edited` is
unimplemented, and native semantic evaluation, deployed browser UAT and activation remain
open. The commerce owner's late-paid/unavailable-stock policy is separately recorded in
Plan 50-06 owner inputs; it does not imply a refund, alternative-fulfilment or notice runtime.
The first exact-head CI passed typecheck/lint but stopped at the golden evaluator's
source-derived revision gate. The code-owned golden/manifest revision and the dependent
web-recipe implementation pin were refreshed from current sources; both self-checks and
all 32 local free gates pass. This retires old evaluator evidence, not requalification.
The next exact-head CI passed those gates and found the source-derived native vertical
evaluator revision stale in the full backend suite. Its generator refreshed only that
revision for the unchanged six-lane/40-case corpus; the exact corpus check and four
focused tests pass. No semantic verdict was minted by regeneration.
The uncontended local `pnpm test` then passed all 11 package test tasks, including
backend **182 files/4,617 tests** and web **70 files/1,067 tests** (two existing skips).

## 2026-09-28 authenticated human edit path

The Output card can now edit the selected owned vertical artifact. The server checks its
ordinary-run candidate provenance and unchanged original content, re-renders PDF or XLSX
bytes where needed, then atomically persists the text/bytes and a refs-only user
`review_edited` outcome. A stale or no-op edit cannot inflate the count; model rewrites
are not treated as human edits. Focused backend and DOM tests cover text, PDF, workbook,
foreign/stale/no-op and review terminal behavior. Deployed browser UAT, semantic
evaluation, activation and pack release remain open; Plan 30-02 is still partial.
The full local suite subsequently passed all 11 package tasks, including backend
**182 files/4,622 tests** and web **70 files/1,067 tests** (two existing skips).
The new Convex module was also admitted to the closed recurrence absence inventory
after its no-scheduler posture was checked; that suite passes 9/9 and operational
recurrence remains `defer`.
All 12 workspace typecheck tasks, repository lint, all 32 free gates, strict
planning/playbook checks and Graphify/Convex-edge refresh passed locally.
Follow-up integrity repair moved superseded PDF/workbook deletion into the same
Convex mutation as the text swap and user outcome. A failure injected after the
patch proves rollback retains the original text/blob and creates no user outcome;
the staged replacement blob is removed by the action. The focused review suite
passes 9/9. Rendered authenticated browser evidence remains open because no local
web/Convex listener is currently running; no production target was substituted.
An ambiguous save-response regression then failed on the Output card's claim that the
original artifact was unchanged after every generic error. The UI now asks the reviewer
to reopen and verify the persisted result, since a lost response may follow a committed
edit. The focused DOM suite passes 6/6 and web TypeScript exits 0. This is honest
failure messaging, not browser UAT or a guarantee that the save committed.
An isolated production-build/loopback Convex stack subsequently supported an actual
authenticated Chromium CLI walkthrough. A synthetic invited tenant opened the Output
card for an ordinary product artifact, observed the no-op Save disabled, edited and
saved the long-form document, then reloaded. The browser retained the edited status and
inline PDF; an independent tenant-bound server readback matched the edited text hash,
PDF storage presence and exactly one `review_edited` audit outcome. The stack's isolated
audit check passed and its exact owned temporary root was removed. This closes the
previously absent *local positive browser path* only; hosted/deployed tenant UAT,
other negative browser paths, semantic qualification and activation remain open.
An independent second disposable authenticated browser run covered the short-content
and spreadsheet branches. Short content saved and survived server readback with its
edited hash, no stored bytes and one `review_edited` outcome. A table-free spreadsheet
edit displayed the specific refusal; server readback retained the original hash and
zero edit outcomes. A valid Markdown table then saved, survived reload in the Output
card and produced one outcome; the replacement download had XLSX MIME and 16,137
ZIP-signature bytes. The sheet fixture's *initial* stored bytes were a synthetic
placeholder, so this does not prove original-workbook parsing or cell-level workbook
semantics. The second stack's audit check and owned-root removal passed. Hosted UAT,
the remaining refusal matrix and semantic/candidate gates remain open.
A third fresh disposable browser run clicked the app's **Download original** control
after a synthetic spreadsheet edit. The actual downloaded XLSX parsed to one sheet
with `Item | Value` and `Browser Edited | 7`; SHA-256
`8903621f230361e31d9d17ede123e1d9816512969aba02cc64036e074bd311a1`.
Its isolated audit and exact-root cleanup passed. This closes the local
browser-download cell-content observation, not hosted UAT, original-workbook
validity, semantic quality or candidate activation.
