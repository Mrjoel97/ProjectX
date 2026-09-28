# Wave 6 recurrence: current-source identity and real-rail gap — 2026-09-28

**Disposition:** evidence correction and implementation handoff only. Operational recurrence remains
`defer`; the six-file candidate remains isolated under the accepted `build-for-evidence` stage. This
record does not accept D6, ROUT-02, eligibility, tenant activation, a provider call or release.
**Current-source review:** limited candidate design review at `47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW.md`; real rails and activation unreviewed

## Exact-source integrity

The hash-bound [47-22 independent review](47-22-TECHNICAL-REVIEW.md) does **not** bind the current
tree. Its recorded SHA-256 values for `schema.ts`, `model.ts` and `model.test.ts` are respectively
`ef6352a0…`, `adfefce7…` and `10c2d9f4…`; current raw-file SHA-256 values are:

| Candidate path under `packages/backend/candidate/recurrence/` | Current SHA-256 |
| --- | --- |
| `schema.ts` | `628d3d67dcdefeedd32587341ef715413a537428f6fb6ec9e1c258f61504d909` |
| `model.ts` | `164a0d6513da8ab84932fc44b9b48a1b195b27078a84334d204cb94920424f61` |
| `model.test.ts` | `87c15f701d54e950e1be9900d438e42f59203caede0eb24fb2a3e43660cc3f0f` |
| `README.md` | `6e7e76db5822a211750299f9a7b69fe47595fb48ac46fb169274b97f5cf01d68` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |

CRLF expansion of the current three differing files does not reproduce the old hashes. The
reviewed pre-commit bytes are not available in Git (`git log` shows the candidate first landed in
`6e0db5b`), so the reason for the mismatch cannot be established from the retained source. Do not
cite that prior hash-bound GO as an independent review of these current bytes. A new limited
exact-source review is recorded separately in `47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW.md`;
do not rewrite the historical review's hashes to hide the mismatch. The registered free gate
`scripts/check-recurrence-source-review.mjs --self-test` checks all six current raw-file hashes
against both this audit and the limited review. It refuses an absent historical correction or
missing/stale review identity. This guards evidence identity, not the real rail.

**2026-09-28 source amendment:** Two new adverse expectations failed on the previous candidate:
calling `closeUnknownPaidStep` after a committed paid start let the recovery sweep release both
envelope holds and clear the active run without proving whether the physical call spent money.
The method is now `markUnknownPaidStep`: it durably quarantines the start-claimed identity and
retains both holds; repeated synthetic attempts and recovery refuse redispatch and release. A
later landing with the exact step ID/token can settle through the normal terminal path. The full
candidate suite passes **35/35** and candidate TypeScript exits 0 after the fix. This is a
synthetic fail-closed repair, not authenticated provider settlement, actual money accounting or a
fresh independent review; the three current hashes above supersede this memo's earlier values.

**2026-09-28 ambiguous-throw amendment:** A new test proved that an unconfirmed
`provider_timeout` after the committed paid-start claim previously returned `retry_pending`,
allowing another physical call with a new step ID. The same risk applies to an ordinary transport
throw. The disabled model now quarantines both cases with the exact outstanding step and held
rails; a second attempt and the recovery sweep cannot redispatch or release. Bounded retry remains
testable only through `SyntheticFailure(..., true)`, an explicitly confirmed-no-effect *stub*
result, not a real provider attestation. The full candidate suite passes **36/36** and candidate
TypeScript exits 0. Production must authenticate/settle the first effect before any retry or
budget release. Current hashes above replace the prior repair's source identities; independent
current-source review remains pending.

**2026-09-28 absent-is-not-released amendment:** A red-before-green adverse control found that
`reserve` throwing before its effect and returning an `absent` lookup became `retry_pending`,
while `release` throwing before its tombstone and returning `absent` could clear the run. The
original reservation could still allocate after that lookup. The disabled reducer now quarantines
the thrown reserve even on `absent` and requires affirmative `released` tombstone evidence before
terminal release. The regression lands the original keyed reservation after the first absent
lookup, verifies no paid call or second reserve, then proves exact-key compensation and closure.
The older test's retryable expectation was unsafe and was corrected; its pause race now runs on a
separate clean fixture. Current candidate Vitest passes **37/37** and candidate TypeScript exits 0.
This is a synthetic rail contract only; the installed limiter still lacks the keyed tombstone API,
and fresh independent source review remains pending. The exact hashes above supersede the earlier
candidate revisions.

**2026-09-28 schedule-write amendment:** A red-before-green control showed that creation accepted
an invalid hour or IANA zone, and material change accepted an invalid minute. An approved invalid
row would throw in the due sweep before its cursor advanced, repeatedly blocking later rows.
Creation, change and approval now validate a safe nonnegative timestamp and resolve the rule with
the shared core scheduler before persisting. Failed changes leave the prior approved version and
rule untouched. The isolated candidate suite passes **38/38** and candidate TypeScript exits 0.
This is only candidate liveness design evidence; the current six hashes above supersede the
prior revision and require a fresh independent review.

**2026-09-28 rail-fixture accounting amendment:** Two new expectations failed on the prior
synthetic fixture: at 475/500 cents, the deployment rail refused its valid 25-cent hold because
it counted the daily hold again; a second tenant's valid daily hold was also refused because
the first tenant's holds entered the same counter. The fixture now tracks tenant-daily and
shared-deployment balances separately. A third control proves the shared deployment ceiling
still refuses a second tenant and compensates its daily hold. Candidate Vitest passes **41/41**,
candidate and backend TypeScript pass, and four focused backend guard files pass **149/149**.
Only `model.test.ts` and `README.md` candidate bytes changed; the hash table above binds them.
This corrects a synthetic test oracle, not the installed limiter, production money accounting
or the pending independent current-source review.

**2026-09-28 counter-exhaustion amendment:** Two adverse tests failed on the prior
candidate. At `Number.MAX_SAFE_INTEGER`, pause/material-change approval versions
and a run scan ordinal advanced into an unsafe JavaScript number instead of
refusing; a sweep epoch had the same unchecked increment. One checked increment
now fences both version changes, both routine/run ordinals and both due/recovery
epochs before persistence. The controls assert unchanged routine/claim/progress
state on refusal. Candidate Vitest passes **43/43**; candidate and backend TypeScript
exit 0, and four focused backend governance suites pass **149/149**. The stage,
defer-decision, pending source-identity, strict planning and playbook gates pass.
The three changed candidate-file hashes above supersede their previous values;
fresh independent review is still pending. This is neither real sweep liveness
nor production approval fencing.

**2026-09-28 clock/attempt amendment:** Two adverse controls failed on the prior
disabled candidate: a finite negative/fractional/unsafe due-sweep clock could
advance the sweep, and a stored attempt count at `Number.MAX_SAFE_INTEGER`
could enter `running` with a rounded increment. Due sweeps and direct claims
now require nonnegative safe-integer UTC milliseconds; attempt start uses the
shared checked increment. Both refusals leave the routine/run/progress rows
unchanged. The explicit candidate suite passes **45/45** and candidate
TypeScript exits 0. The three changed candidate hashes in the table above
supersede the earlier ones; independent current-source review remains pending.
No deployed scheduler, provider, paid call or tenant activation follows.

**2026-09-28 independent-review repair:** A separate read-only reviewer found that a
resolved malformed paid callback threw in landing and that a terminal duplicate landing
returned before checking its token. Two new expectations were red on those old paths.
The candidate now quarantines a malformed return with the exact `start_claimed` step and
both holds intact: a response shape does not prove zero provider spend. It refuses
redispatch and automatic refund, and a later exact-ID/token result can settle through
normal reconciliation. Wrong-token duplicate landing refuses before replay. The
reviewer checked the corrected code and README against the six current hashes above;
the separate limited review is `47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW.md`. Explicit
candidate Vitest passes **46/46** and candidate TypeScript exits 0. This is a
candidate-only review, not a real paid-rail or D6 pass.

Current controls still have value but are narrower: the exact six source hashes above were
rechecked on 2026-09-28 and explicit candidate Vitest passed **46/46** on the current tree;
candidate TypeScript passed; `routineDecision`, `routines`, `dstProbe` and `schema` passed **149/149**;
checker self-check passed **32/32**. The actual governance modes returned matrix `0`, eligibility
`1` with **14** findings, operational `defer` decision `0`, and disabled stage `0`. `convex.json`
still points only at `packages/backend/convex`; the stage lists exactly six candidate files. A
production/app/core source search found no candidate import, and the candidate source has no
registered scheduler, cron, provider key, outbound call or send. These checks support continued
isolation, not an enable-safe or production claim.

## Real spend-rail contract is not the synthetic contract

The current candidate's `SyntheticRails` requires per-run/per-rail `reserve(key)`,
`lookup(key) -> held/released/absent/uncertain`, and `release(key)` that tombstones an absent key
against a later in-flight reserve. Its terminal path refuses to clear the active run until both
keyed releases are confirmed. The installed `@convex-dev/rate-limiter@0.3.2` client instead exposes
window `check`, `limit`, `getValue` and whole-bucket `reset`. Its `key` selects a rate-limit bucket,
not an idempotency identity for a reservation. The component mutation stores aggregate
`rateLimits` rows by name/bucket/shard; the client has no per-operation lookup or release/tombstone
method. `guardrails.ts` uses the tenant-keyed `dailySpendCents` and shared keyless
`deploymentSpendCents` fixed windows. Passing a run ID as the limiter bucket key would split the
tenant daily cap and would not preserve the existing deployment cap semantics.

Therefore the real limiter cannot simply be cast to `SyntheticRails` or used as proof of the
candidate's allocate-then-throw, release-then-throw, partial-two-rail, replay or rollover behavior.
The remaining technical design must define a durable per-run operation journal/idempotency and
reconciliation boundary **without** making a separate run bucket stand in for the shared rails;
prove atomic admission/compensation or a conservative held/uncertain stop across crashes; and test
both real windows, cross-window release, pause, retry, duplicate workers and an unknown physical
paid start. The actual component and ledger integration must be tested, not inferred from stubs.
One possible design route follows [Convex's documented component transaction semantics](https://docs.convex.dev/components/using): a single top-level mutation can atomically commit
app journal rows and nested rate-limiter component writes, while an action's separate
`runMutation` calls are **not** one transaction. This is an inference for a future
reviewed design, not a tested recurrence adapter. It would have to pin exact run/rail
identities in an app journal, preserve the tenant daily and shared deployment bucket
keys, make admission/compensation idempotent within one mutation, and refuse any
cross-window refund that credits a new window. It still cannot authenticate an unknown
physical provider effect or furnish a production reconciliation operator by itself.
Any production module/table/caller would require a separately reviewed governance transition;
ADR-050's six-file disabled stage does not grant it. D6's sweep-only amendment, live DST/OAuth/
provider observations and the separate owner release decision remain additional gates.
