# 47-13 ROUT-02 gate review — decision checkpoint open

Reviewed 2026-09-24 against the unchanged accepted [29 recurrence decision](../29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md), [ADR-046](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md), the current checker, each cited source below, and the available Plan 47 dossiers. This is an agent-prepared evidence review for a human governance choice, not that choice. `decision: defer` remains operative.

## Actual gate and focused checks

Each mode was invoked separately on the actual 29 decision artifact, with no pipe or fixture substitution:

| Check | Exit | Result |
| --- | ---: | --- |
| `check-routine-gate.mjs <29 decision> --matrix` | 0 | Structural matrix accepted under `defer` |
| `check-routine-gate.mjs <29 decision> --eligibility` | 1 | 14 findings: 11 missing rows; OAuth and DST also have the wrong evidence class; `provider-read` cites a summary instead of a collector artifact |
| `check-routine-gate.mjs <29 decision> --validate-decision` | 0 | Current `defer` remains valid; not permission to build |
| `check-routine-gate.mjs --self-check` | 0 | 32 positive/negative fixture cases behaved |

The focused backend run initially had 120 passing assertions in five files but exited **1** because Vitest reported an unhandled worker `onTaskUpdate` timeout. A serialized `--maxWorkers=1` rerun of the same five files exited **0**, 120/120: `dstProbe` 7, `routineDecision` 83, `routines` 9, `tenantOrders` 12 and `webForms` 9. Backend TypeScript exited 0. The core `routineSchedule` file exited 0, 19/19. This supersedes the older 4/9 inventory failure after its reviewed module updates; it does not upgrade any live evidence row. The initial runner failure is retained rather than erased by the rerun.

## Twelve-row semantic review

All current citations were inspected for relevance. The repeated `29-RESEARCH.md` citation is design advice, not seven distinct implementation artifacts. Reviewer for every judgment in this table: Codex, 2026-09-24; **human review remains outstanding**. `47-11-DST-REVIEW.md` does not yet exist. `47-12-OAUTH-REVIEW.md` now records a fail-closed offline OAuth/probe review, but no live provider or seven-day trace, so no future-clock result is inferred.

| Row | Recorded status/type | Exact cited file | Semantic finding and missing proof |
| --- | --- | --- | --- |
| `standing-approval` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Recommends preparation-only authority. ADR-046 D1 rules, but implementation and adverse-path tests are absent. |
| `material-change-reapproval` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Lists fields that void authority; no routine-state comparison, pause and reapproval tests. |
| `oauth-expiry-reauth` | missing/automated | `packages/backend/convex/gmailAuth.ts` | Contains grant/access-token lifecycle and reconnect notification logic, not a seven-day elapsed grant expiry, explicit reconnect and no-catch-up-burst trace. The collector now rejects silent access-token refresh as a substitute. Needs a real, reviewed live artifact. |
| `dst-boundary` | missing/automated | `packages/core/src/routineSchedule.test.ts` | ICU/unit cases include spring gaps, fall overlaps and Lord Howe's 30-minute shift. Plan 47-10 now proves four production probe jobs pending, not fired. Needs paired live production `armed`/`fired` audit and independent offset review after the actual transitions. |
| `provider-read` | pass/live | `.planning/phases/03.2-inbox-reading/03.2-06-SUMMARY.md` | Records the historical human-verified Gmail mailbox read and zero send. It is not a `collect-recurrence-evidence.mjs` provider-read artifact, so current eligibility rejects this citation. Needs a fresh unattended provider-read trace under the required grant/read boundary. |
| `missed-run` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Recommends skip, never burst. No implementation or elapsed missed-run proof. |
| `run-identity` | missing/automated | `packages/core/src/routineSchedule.test.ts` | Proves pure occurrence-key behavior, including repeated wall hour; no atomic durable claim. `templateVersion` can distinguish two keys on one local day and needs an explicit governed decision/test. |
| `overlap` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Recommends one active run and bounded skip; no implemented claim/overlap race test. |
| `retry` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Recommends bounded transient retries with same run ID; no implemented classifier/state machine or permanent-refusal test. |
| `cost` | missing/automated | `packages/backend/convex/guardrails.ts` | Existing per-call and evaluation budget rails are real, but not a whole unattended occurrence envelope reserved and reconciled across every terminal branch under ADR-046 D8. |
| `pause-revoke` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Recommends cancel plus callback re-read; no recurrence row, cancellation race or revoke/tombstone test. |
| `audit-notify` | missing/manual | `.planning/phases/29-unified-knowledge-and-routines/29-RESEARCH.md` | Lists closed outcomes and refs-only audit/notice expectations; no recurrence emissions or coverage across terminal outcomes. |

The matrix parser checks shape, evidence class and selected file identities; it does not certify that a cited file proves its row. In particular, one historical mailbox-read summary is credible history but not a current collector-produced `provider-read` observation.

## The dependency cycle

[ADR-046 § “What must be true before the gate is asked again”](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md) says D1–D8 manual rows move to `pass` **when implemented and tested**, not upon accepting the ADR; D9 separately requires a real fired DST transition. [The accepted 29 decision §6–7](../29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md) keeps `defer`, forbids the recurrence table/runtime/ADR, and requires twelve passing rows for `enable-safe`. The checker enforces `defer` absence and rejects an ineligible `enable-safe`. Consequently, even successful DST, OAuth and provider-read traces would leave the seven unimplemented manual rows and other implementation rows red. The current rules cannot reach an implementation-valid `enable-safe` merely by waiting. This is a governance-order conflict, not a reason to relabel evidence or bypass the checker.

## Bounded owner choices — owner selection recorded below

| Choice | New authority/artifact required | Test and stop/rollback boundary | Still forbidden |
| --- | --- | --- | --- |
| A. Retain `defer` and manual reruns | Record an owner checkpoint retaining the existing 29 decision; continue separate live dossiers and manual actions. No new implementation authority. | Re-run gate and live collector checks at each genuine observation. Stop on missing grant/trace; no code rollback because no recurrence build starts. | Scheduled tenant routines, unattended preparation, external sends and false `pass/live` labels. |
| B. One-off staged implementation/evidence exception | A separate owner-approved governance artifact must name exact non-exposed prototype files, tenants, time window, spending ceiling and expiry; amend the governing absence rule explicitly before any conflicting code, without pretending `defer` itself permits it. Require a second owner review before exposure. | Tests for isolation, single claim, no send, pause race, cost reservation/release, audit and cleanup; fail/expire the exception back to `defer` and remove the isolated prototype if its exit criteria fail. Live rows remain live-only. | Public UI, general tenant arming, provider writes, and `enable-safe` until independent eligibility and owner review. |
| C. General governance-order amendment | A new reviewed decision and checker contract defining an explicit `build-for-evidence` stage separate from `enable-safe`, with the historical 29 record immutable. The stage must specify what code is allowed, what remains off, and which rows need post-build proof. | Mutation-test both stage boundaries, `defer` absence, fail-closed eligibility and rollback to `defer`; require all twelve substantively reviewed rows plus live traces before exposure. | Treating the intermediate stage as launch approval, weakening live evidence, or unattended external writes. |

**Owner selection, 2026-09-24:** Choice C, the reviewed `build-for-evidence` governance stage. The owner answered the specific choice with “Yes—build-for-evidence stage (recommended).” This selects the governance-order solution, **not** `enable-safe`, production deployment, tenant activation, a provider call, or an external send. The current 29 `decision: defer` is still the only executable gate status. The bounded stage charter is [47-14-BUILD-FOR-EVIDENCE-CHARTER.md](47-14-BUILD-FOR-EVIDENCE-CHARTER.md); it states the proposed checker and isolation contract to review before any conflicting runtime code. No recurrence implementation, new ADR, gate alteration, external call or decision-record edit occurred in Plan 47-13.
