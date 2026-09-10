# Optional vertical packs

Last verified: 2026-09-10 (policy, native controls, runtime binding and controlled observation collection; release qualification remains pending).

Local evaluation preparation now materializes all 40 controlled source cases: typed Data workbook bytes,
meaningful Design PNGs, and synthetic Product/Legal/HR/Engineering text. `verticalEvalSources` binds exact
candidate/run/case/request hashes and actual owned storage metadata, refuses changed/sealed sources,
and never embeds or reads a connector. Native evaluation uses explicit fixed sources; it does not prove
retrieval. The opt-in `--collect-observations --all-candidates --no-activate --max-cost-cents N
--credit-billing-only` diagnostic requires the operator to verify non-BYOK credit billing. It reserves
one aggregate budget, archives output markdown separately from the refs-only report, checkpoints before
cleanup, and retains fixtures when accounting is unresolved. Exact paged cleanup preserves accounting
and its authority receipt until completion; frozen WORM exports refuse cleanup. CLI errors are redacted.
Observation collection still exits 2 and cannot write release evidence; no paid run was performed here.

`prepare-vertical-review.mjs` creates an offline content-plane packet only from hash-matching collected
output and exact fixture/source bytes. It uses the existing Data parser/profile and lists semantic
criteria as unresolved. Reviewer records bind explicit decisions to actual UTF-8 evidence spans;
local observation and reviewer identities remain unverified. A valid packet or record never unlocks
release. The opt-in authenticated browser control harness covers confirmation and release controls
at desktop/mobile widths; listing it is not live all-six workflow acceptance.

## Invariants

The closed set is Legal, HR, Product, Design, Engineering and Data. Each defines one stable workflow,
output/disclaimer contract, risk, human review requirement, connector block, independent disable and
exact-version rollback policy. Definitions reuse Phase 27 `PackOperation`, `PackOutput`,
`ReachablePackSource` and `WorkflowPackId`. The minimal file/Vault operation references come from the
native SOP template: `searchVault` and `saveAsDocument`, plus the shared forbidden leaf operations.
The base template is reuse of its operation contract, not evidence that a vertical body is reviewed.

Only explicit confirmed needs, valid tier evidence and at least two repeat observations can make a
released vertical relevant. Missing facts stay hidden; missing source/reviewer/playbook/data validator
stays blocked. At most two recommendations are returned, ordered by availability, bounded repeat
count and stable manifest order. All connector variants remain blocked. Tier never enters tool
resolution. The pure evidence input is trusted adapter output; it is not a public mutation payload.

Legal offers issue spotting against a confirmed playbook and requires qualified counsel. HR produces
materials with qualified human review, never employment decisions or protected-attribute inference.
Product, Design and Engineering produce cited artifact reviews; none can mutate a project, repository
or production environment. Design review is not an accessibility certification. Data requires the
deterministic CSV/XLSX validation path and cannot execute warehouse queries or notebooks.

## Implementation and exposure boundary

Phase 30-02 stores explicit needs/reviewer choices and disabled ids on `tenantProfiles`, never
duplicate version/evidence rows. `verticalPacks.configure` checks the legal playbook's Vault ref
against the caller's tenant. `discover` reads exact native names and derives release from native
provenance/eval/browser predicates. It returns at most two recommendations; today it returns none
because the executable vertical eval suite and authenticated exact-version UAT remain pending. Six bounded control
rows expose candidate ids/versions and named prerequisites, never bodies. Profile prose is never
interpreted as a vertical need. Data readiness requires an unsealed ready CSV/XLSX; the actual owned-file profile is generated before any model call.

`setDisabled` is tenant-scoped; `skills.loadEffectiveSkill` checks it before either effective-body
branch. It changes no version, evidence or artifact. `rollback` preserves the owner gate and adds
same-tenant/name checks before calling the sole activation transition. Never-active candidates are
refused; successful rollback leaves disable in force. Internal evaluation pins remain the existing
owner/test plane. The native binding and ordinary-start path now both rerun eligibility; their exact-version model and browser acceptance remains open.

`verticalPackTelemetry.record` uses the shared insert-only audit plane with typed same-tenant
candidate/artifact refs, closed event/outcome/reason/cost/latency buckets and bounded counts. It has
no prompt, filename, person, clause, URL or dataset-value field. Aggregate reads use the exact
tenant/event index, count at most 200 events, and mark truncation. Artifact and run-completion/failure
events accompany actual runtime writes. User acceptance/review event coverage still requires the
later workflow acceptance work. No live gate ran.

Check backend verticalPacks, verticalPackTelemetry, isolation, routines and skills tests, plus
backend/core typecheck. The local generated API declaration received exact typed module entries;
normal deployment codegen should regenerate it. Controls alone do not close VERT-01/02.

Phase 30-01 adds policy only: no skill bodies, seed, public discovery route, runtime dispatch, new
table or activation. The Phase 30-02 adapter composes the existing `skills`/`tenantSkills` immutable candidate,
native provenance/eval/browser evidence and rollback seams. It supplies `released` only after all
three evidence planes pass for the exact selected version. No client/model may assert release by
passing the pure helper's input directly to an execution endpoint. Closed native registry ids need
deliberate extension when vertical bodies/runtime bindings land; they are not exposed by this module.

Disable blocks effective-body loading without deleting candidate history, provenance, Vault or
Content artifacts. Rollback restores one previously active exact version through the existing
activation seam. Native row and authenticated retained-artifact tests prove these controls; later
runtime entrypoints must honor them before an end-to-end execution claim is made.

## Change and verification

Run `pnpm --filter @pikar/core test -- verticalPacks` and
`pnpm --filter @pikar/core typecheck`, then `node scripts/check-playbooks.mjs`.
The tests enumerate every reason, all tiers and workflows, exact allowed tools, excluded ids,
insufficient/malformed behavioral counts, stable ranking and independent disable. Any native SOP
operation change must keep the vertical grant at its explicitly reviewed two tools. Later plans must
add adversarial/outcome evals, real authenticated responsive UAT, provenance and retained-artifact
proof before exposure. No paid/provider operation is part of this verification.

## Excluded research domain

Bio Research has no manifest, source body, seed, discovery id or route. Re-entry requires a named
life-sciences persona, observed repeat demand, scientific validation owner, licensing/data review,
compute/sandbox controls, regulated-risk assessment and a dedicated roadmap phase.

## Deterministic Data profile core (30-03 partial)

Last verified: 2026-09-10. `profileDataset` accepts a typed workbook-cell projection with file id,
content hash, actual byte length, sheet names and a 1-based origin. It computes only observed-value
facts; numeric/date strings remain text, headers must be explicitly declared, invalid or unsafe
numeric/date values stay invalid, and mixed currency/unit columns have no combined numeric range.
Confidence is the dominant type's share of valid nonmissing sampled cells. Duplicate counts use
complete, untruncated rows only and disclose the number compared. Category cardinality becomes a
lower bound at its cap; values with truncated text never become false equal categories or duplicates.

Caps: 5 MiB source file, 1 MiB decoded sampled UTF-8 values, five sheets, 500 data rows per sheet,
30 columns, 512 characters per cell, 20 categories per column and 128 KiB output. The output cap
omits whole sheets and warns. File/formula/macro/external-link metadata is supplied by the trusted
parser adapter; the core evaluates nothing and follows no links. Formula cells use cached values
only, and missing caches are disclosed. The cap on normalized cells does not protect a parser that
has already decompressed an oversized workbook: `dataWorkbook` applies parser preflight limits first.

The existing Vault `sheetRows` preview deliberately discards types/formula metadata and is not a
valid input substitute. The subpath-only Vault `dataWorkbook` now uses pinned SheetJS and fflate
for typed CSV/XLSX input, limits and formula/link/macro metadata. CSV values remain text; no locale
or numeric coercion is performed. `verticalData.profileOwnedDataset` returns deterministic facts
for trusted callers after exact tenant/file/ready/sealed checks. `previewDataset` is owner-only
and saves a normal internal Vault artifact without calling a model. Source-backed Data candidate
draft files pin official source hashes and licensing; independent review/native eval/UAT still
gate exposure. The deterministic preview does not complete Phase 30-03 or authorize release.

Verification: `node node_modules/vitest/vitest.mjs run src/dataProfile.test.ts` and
`node ../../node_modules/typescript/bin/tsc --noEmit` from `packages/core`. Twelve fixtures cover
real statistics, mixed semantics, invalid values, cached formulas and every cap. Actual mutation
checks changed numeric max to min (failed: 12 became -4) and row cap 500 to 501 (failed: sampled
row count changed); both were restored before the final green run.

## Dormant native binding (30-08/09 local implementation)

Six generated LF body/provenance mirrors are published only by explicit `skills.seedVerticalCandidates`.
Publication reuses `publishPack`, allocates independent immutable version streams, verifies actual
body SHA against pinned provenance, and never activates a row. The seven paid pilot ids and suite
remain unchanged. Vertical activation/exposure use the deliberate closed vertical eval predicate;
prepared fixtures and scripted tests are not release evidence.

`cockpit.startVerticalPack` uses real owned threads/plans, trace lifecycle and saved conversation.
Its ordinary path and `verticalPackBinding.run` both call shared native `prepare` eligibility. Known
ids cannot bypass confirmed need, repeat observations, source/reviewer/playbook requirements, exact
version evidence, or tenant disable. Candidate previews require owner auth before thread writes;
only release/repeat prerequisites are bypassed. Every start rechecks disable before budget admission.
The bound leaf uses `runSpecialistTurn` and only `toolsForVerticalWorkflow`; no connector, dispatch,
send, skill authoring or arbitrary code capability is added. Legal receives its exact owned unsealed
playbook as reference. Data receives only the trusted owned-file deterministic profile as numeric
input. Model numeric consistency remains an unevaluated release requirement.

Artifacts use `saveMarkdownDocument`. Actual artifact/completion/failure events use typed global or
tenant candidate refs in the existing audit plane, with closed cost/latency buckets and preview
markers. Preview artifacts cannot inflate production repeat demand. Useful outcomes require a real
nonempty retrieved excerpt or a successful deterministic profile; absent/failed/empty grounding is
partial. A useful document workflow also requires a persisted artifact; a grounded reply without a save remains partial. No source/model prose enters telemetry. Discovery uses at most five owned ready unsealed
source rows and marks audit-history truncation; false-negative availability at this bound is safe.

Verification: native publication/hash/idempotence, exact candidate runtime, owner/tenant/no-spend
refusals, empty-grounding detection and existing skill/isolation/recurrence tests. No live seed,
activation, provider evaluation or browser release evidence was executed.

## Profile surface and evaluation preparation

The existing Business shape panel mounts at most two recommendations from `discover`, isolated by
an error boundary. It does no local scoring. Blocked prerequisites have no start action; ordinary
starts pass no preview version. A successful typed thread result opens the existing workspace;
unknown transport outcomes tell the user to check it before retrying. Disable and restore share
the same server preference. Four SSR and four DOM interaction tests cover these local controls;
they do not stand in for authenticated responsive UAT.

`run-eval-vertical.mjs --fixtures-only` validates six candidate hashes/versions and forty compiled
source cases without backend calls; it remains registered in the free-gate inventory. Explicit
observation collection uses the controlled native source, reservation and mechanical qualification
paths described above. A full refs-only takeover manifest is checkpointed before any mutation;
unknown remote operation outcomes retain all remaining case state even if accounting looks settled.
`hasPassingVerticalEvalEvidence` and the original full-release command remain closed pending measured
semantic assertions and reviewed evidence. The current foundation and specific remaining gates are
recorded in `.planning/phases/30-optional-vertical-workflow-packs/30-08-EVAL-PREPARATION.md`.

### Explicit historical workload confirmation

`configure.confirmWorkload` accepts one vertical and exactly two distinct artifact ids per call.
Both must currently belong to the authenticated tenant, be ready and outside sealed folders, and
the vertical must be among the explicitly confirmed needs. It stores those refs with a server
timestamp under existing profile preferences, replacing only that vertical's prior confirmation.
These are historical workload observations, so later artifact deletion does not rewrite history.
Discovery combines distinct confirmed refs with actual non-preview runtime artifacts. It separately
requires currently available sources and every release gate; confirmation cannot release a pack.
Preview output is never automatically credited as production workload. The profile now has a
collapsed workload-confirmation form, independent of recommendations. It requires two distinct
examples and explicit renewed consent when an example changes, preserves existing needs/reviewer/
playbook preferences, and displays the saved confirmation. `workloadSources` uses native pages of
five ready rows, excludes sealed folders, and returns only owned ids/titles; an empty filtered page
can still have a next cursor. Current source discovery conservatively inspects five full rows
to bound read bytes; a relevant source outside that sample can remain unavailable.

### Observed evaluation execution and Design input

`verticalPackBinding.evaluateCase` binds a provisioned case hash, candidate version/body hash,
owned plan/thread and source refs before execution. Fixed-source evaluation hydrates only those
owned text documents through the ordinary `searchVault` tool; it does not evaluate RAG selection.
Actual reads emit document ids and chunk hashes. The normal save tool persists a real artifact.
Internal results distinguish scripted/model execution, configured/actual model, measured tool
attempt/result counts, truncation, input/body/artifact hashes and grounding kind. They are
observations, not semantic scores or release evidence. Ungranted tool names are counted without
retaining model-authored strings. Exact source/candidate state is rechecked after execution.

Data and Design use exact provisioned source ids and byte hashes during evaluation, rather than
choosing any currently ready document. A changed or unavailable fixture aborts the case. Design
requires owned ready unsealed PNG/JPEG input, at most 1 MiB, supplied as actual image bytes to the
existing model loop. Both discovery and start require visual-source readiness. MIME/container
checks and `owned_image_input` facts establish supplied bytes, not successful decoding, visual
correctness, measured contrast or accessibility conformance. Model behavior still needs real UAT.

Evaluation calls use the existing spend-event/rate-limiter plane to reserve a conservative provider
request ceiling before each low-level call, including fallback steps. Unknown cost retains its
hold; known provider-contract breaches persist actual spend and close the budget. The runner must
reject unsettled or breached budgets. The cap covers the documented provider billing contract;
unsupported separate BYOK billing must not be represented as zero or an all-in economic guarantee.
No paid evaluation or activation was performed during local scripted verification.
