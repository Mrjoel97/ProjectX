# Research request controls: observed failure and implementation plan

Date: 2026-09-12. Status: design only; not implemented or accepted.

This document records a bounded production diagnosis and proposed follow-up. It does not
authorize a paid evaluation, record a semantic pass, or assert that the proposed controls exist.
It contains references and timing metadata, not the user's raw request or document contents.

## Observed execution

The postdeployment acceptance run exercised release
`1127573adb2ae8982e416dfd146eb1609e44711e`. The request authorized a new draft. The finding is
therefore premature independent drafting and incorrect content, not an established lack of
authorization to create any artifact. The prompt did not independently authorize external sending.

Closed local receipt: `output/playwright/production-acceptance/research-pdf-path.json`.
Acceptance receipt: `output/playwright/production-acceptance/postdeploy-result.json`.
These ignored receipts are local observations, not permanent release evidence by themselves.

All three observed documents belong to thread `m57dytskag9wah3zjy2d63d4q18e9sg0`:

| Event | UTC, 2026-09-12 | Reference |
| --- | --- | --- |
| Root calls `dispatchResearch` | 09:00:44.779 | Root turn `4590221a-b939-4294-81b0-3918e9fb317e` |
| Root calls `createDocument` | 09:00:44.781 | Same root turn; tool calls start 2 ms apart |
| Independent PDF-backed document created | 09:00:56.927 | `qh76tt0sw6a6e4d3w8853fs58n8e8a73` |
| Researcher starts three `readPage` calls | 09:00:59.125–09:00:59.126 | Research turn `9b7cd48a-d091-4d6f-a67f-22e14b3d74d9` |
| Raw research findings persisted | 09:01:15.234 | `qh7dhv2xn4w8ghbqg4jv2xb7zx8e9djn` |
| Approved research memo saved | 09:02:32.690 | `qh7225ppx7gpkq5byy6xgzc57n8e982p` |

The independent document names root plan `p573bm94xqt94mkv299msgcby98e932n` as its source.
The raw findings and approved memo name research plan `p576mvfz76jzh4eyhv555ewacx8e9960`.
The bounded inspection found these exact documents within the newest 50 document rows and the
matching tool records within the newest 100 step rows. It is not an exhaustive account history.

The observed order establishes that the independent draft finished before the page reads.
The source path is root `createDocument` → `draftDocument` → `vault.insertCreatedDoc`.
The research specialist's read-only tool grant did not gain document-writing capability.
The two paths did not have an explicit result dependency. Tool timing alone does not identify
which particular prompt sentence caused the model's incorrect method or content.

Subsequent source tracing distinguishes this research root from a fan-out child: when the
existing media plan is non-collecting, `stageResearchPlan` inserts a new root memo. The document
tool retains the root ID pinned at turn entry as contextual lineage without changing its kind.
The newer research root then becomes the default thread view. The exact-plan browser check
after release `0c258885` recovered the preserved media row; research had not erased that media.

## Existing controls and missing contract

`llm.ts` exposes `dispatchResearch` with `{ question }`; it has no typed request-specific page
limit. `buildWebResearchTool` maintains a returned-URL set and an in-memory counter, with a
system limit of six reads. Its check and increment occur synchronously before provider awaits.
Consequently parallel calls in one tool-record lifetime share a correctly bounded counter.
The live three-read result does not demonstrate a race in that six-read counter.

That counter cannot establish compliance with a requested limit of two. It is not configurable
from trusted request state and does not survive reconstruction. The normal and evaluation
Tavily extraction branches share `readPage.execute`, providing one enforcement seam.
Existing evaluation spend accounting remains a separate monetary control; page attempts should
not be disguised as currency or treated as semantic evidence.

`parentPlanId` and `sourcePlanId` express lineage. They do not require a document to wait for
research, identify a requested deliverable, or attest support for a claim. The research workflow
already produces an approvable memo and persists raw findings; a second independent drafting
model call is not necessary to obtain the existing research draft.

## Stage 1: establish a typed request boundary

Proposed input: an explicit `maxPageReadAttempts` integer bounded by the system maximum,
including zero if the product supports search-only research. The authenticated server admits
this option and creates its immutable request-bound control before the executive model starts.
The client must not submit an arbitrary existing budget-record ID or choose another tenant.

The UX needs to show the operative numeric limit and its meaning. A value extracted by a model
from free text is a proposal, not proof that the system admitted the user's constraint.
An explicit numeric client/operator setting can supply authority; alternatively a proposed
setting can be shown for explicit acceptance. The recommended implementation is an optional
numeric request setting with the existing system maximum as its visible default. Building this
control is within the authorized repair scope; a general instruction to implement phases is
not evidence that a particular live request admitted a smaller numeric policy.

An absent typed option may retain the current system limit for compatibility, but must not be
reported as enforcing a smaller limit mentioned only in prose. Failed attempts consuming slots
should be explained as a conservative attempt limit, not a count of successfully understood pages.

## Stage 2: enforce durable reservations at the existing extraction seam

The smallest native mechanism is a small Convex request-control record with an atomic mutation,
not a second scheduler or general research-history subsystem. Proposed fields are tenant,
root-request reference, immutable limit, bounded claimed-attempt IDs, expiry and closed state.
Use a tenant/root-request index and transactional lookup/insertion to prevent concurrent creation
of separate allowances. All research children of the same admitted request share its reference.

Immediately before either `/extract` egress branch, the tool calls an internal claim mutation.
It checks tenant ownership, request identity, lifetime, closure, remaining capacity and duplicate
attempt identity in the same transaction. Keep the existing returned-URL restriction and local
counter as additional limits. The durable control is authoritative across actions and restarts.

An already-claimed attempt must not authorize another provider call on replay. A transport-ambiguous
claim fails closed; an extraction failure retains consumption. Neither a fallback model, another
child dispatch, a reconstructed tool record nor a formatting retry may reset the allowance.
This deliberately favors fewer completed reads over exceeding the admitted number of attempts.
It does not pretend to make provider egress and a database transaction one atomic operation.

Expiration must refuse further claims, not refill the allowance. Existing token-bucket or fixed-window
rate limits are not a substitute for a request lifetime ceiling if they can replenish. Preserve the
existing no-automatic-retry rule on paid workflow actions.

Likely implementation surfaces, to confirm while coding:

- `cockpit.ts` and its authenticated request UI: typed admission and visible effective policy.
- `schema.ts` and one narrow research-control adapter: indexed request state and atomic claims.
- `lib/toolContextArgs.ts`, `lib/dispatchShared.ts`, `dispatch.ts`, `dispatchRun.ts` and `llm.ts`:
  propagation of the trusted server-created reference through every entry and child path.
- `buildWebResearchTool` in `llm.ts`: the shared pre-extraction enforcement point.
- Tenant export/deletion and evaluation cleanup: account for the new control state without deleting
  immutable audit history or stranding controls indefinitely.

A schema/control-state addition must satisfy repository conventions and lifecycle checks. Naming
and retention are routine implementation decisions; no table or API has been added by this plan.

## Stage 3: bind research-derived deliverables

The smallest behavioral improvement is an exact-version executive skill candidate that uses the
existing research memo when the requested deliverable is that draft. Candidate evaluation must
include the observed premature-parallel-draft failure and legitimate unrelated parallel work.
Do not prohibit `createDocument` merely because research is running somewhere in the thread.

If a separate research-derived file is required, introduce a typed dependency on the research plan
or its completed artifact. Validate same tenant, intended request, successful completion, expected
artifact kind, and exact source reference/hash before materializing the dependent document. Preserve
source attribution and unverified-claim labels. Do not silently substitute a different recent document
or draft from the question alone while the dependency is pending.

Prefer deterministic materialization of the existing research output where the requested format
allows it. If a second model transformation is required, it needs its own bounded evaluation and
spend handling. Dependency retries should reuse the same completed source and avoid duplicate
documents. Deletion, cancellation, stale source hashes and incomplete research must produce explicit
refusal or waiting states. A new research completion cannot retroactively validate an earlier PDF.

The current code has no requested-deliverable dependency that can simply be switched on. The
recommended default is to use the existing memo for a research draft, creating a separate file
only when the requested format requires it. Implementing the contract is distinct from obtaining
the exact-version semantic evidence required to activate a changed executive skill.

## Verification and evidence requirements

Before any paid acceptance rerun, offline tests should establish:

1. Three concurrent extraction attempts against limit two cause at most two provider calls.
2. Ordinary and evaluation extraction both claim the same admitted request allowance.
3. Tool reconstruction, fallback and multiple child research dispatches cannot reset capacity.
4. Duplicate/ambiguous claim responses do not authorize repeated egress; failed extraction retains
   its consumed slot; closure and expiration never refill it.
5. Foreign-tenant, foreign-request, malformed, missing and expired references fail closed.
6. Explicit zero-read mode makes no extraction calls; absent-option compatibility remains honest.
7. Native authenticated entry, durable workflow arguments and all affected tool contexts preserve
   the same admitted reference. The model cannot enlarge the cap through tool parameters.
8. Dependent drafts wait for the exact completed research artifact; wrong tenant/type/hash,
   deletion and cancellation refuse; repeated materialization does not create duplicate outputs.
9. Unrelated explicitly requested parallel drafting remains possible.
10. Tenant deletion/export and synthetic evaluation cleanup handle control-state lifecycle correctly.

Regenerate native Convex bindings after adding a module and update isolation/module inventories
and affected playbooks. Extend both evaluator inventories with every new production dependency:
`packages/backend/scripts/goldenEvaluatorIdentity.mjs` and
`packages/backend/scripts/vertical-eval-corpus.mjs`. Regenerate their derived revisions only after
source freeze. Changed execution paths invalidate old exact-version evaluator evidence.

Tests prove the admitted typed contract, not correct interpretation of arbitrary natural language.
Final live acceptance must separately observe the displayed effective policy, actual extraction
attempts, correct deliverable dependency, requested content, source-reference labels and absence
of external sends. Preserve failed evidence honestly. No semantic pass or phase completion is
claimed by this design document.
