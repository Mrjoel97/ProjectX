# Wave 6 recurrence: current-source identity and real-rail gap — 2026-09-28

**Disposition:** evidence correction and implementation handoff only. Operational recurrence remains
`defer`; the six-file candidate remains isolated under the accepted `build-for-evidence` stage. This
record does not accept D6, ROUT-02, eligibility, tenant activation, a provider call or release.
**Current-source review:** pending

## Exact-source integrity

The hash-bound [47-22 independent review](47-22-TECHNICAL-REVIEW.md) does **not** bind the current
tree. Its recorded SHA-256 values for `schema.ts`, `model.ts` and `model.test.ts` are respectively
`ef6352a0…`, `adfefce7…` and `10c2d9f4…`; current raw-file SHA-256 values are:

| Candidate path under `packages/backend/candidate/recurrence/` | Current SHA-256 |
| --- | --- |
| `schema.ts` | `628d3d67dcdefeedd32587341ef715413a537428f6fb6ec9e1c258f61504d909` |
| `model.ts` | `99bc5ad58ba2a2e6d6289dc9cf0d28f4f7f6702c5211523e9fb41b9dc8e4e2ff` |
| `model.test.ts` | `f0b385c42b5985f1ab970ed23b58dd60c242d5ae5be6331f1dd7b910711111c8` |
| `README.md` | `e7e497c95aa67b9887145eee9cae84cdb757733c2e0d6edde5d34a958858a04e` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |

CRLF expansion of the current three differing files does not reproduce the old hashes. The
reviewed pre-commit bytes are not available in Git (`git log` shows the candidate first landed in
`6e0db5b`), so the reason for the mismatch cannot be established from the retained source. Do not
cite that prior hash-bound GO as an independent review of these current bytes. This finding changes
the next action: obtain a new exact-source independent review before treating the candidate as
reviewed design evidence. Do not rewrite the historical review's hashes to hide the mismatch.
The registered free gate `scripts/check-recurrence-source-review.mjs --self-test` now exercises
negative controls and checks all six current raw-file hashes against this pending audit on every
CI run. It refuses an absent correction, a missing or stale audit hash, or a review identity that
contradicts the pending classification. This guards the evidence identity; it is not the missing
independent review.

**2026-09-28 source amendment:** Two new adverse expectations failed on the previous candidate:
calling `closeUnknownPaidStep` after a committed paid start let the recovery sweep release both
envelope holds and clear the active run without proving whether the physical call spent money.
The method is now `markUnknownPaidStep`: it durably quarantines the start-claimed identity and
retains both holds; repeated synthetic attempts and recovery refuse redispatch and release. A
later landing with the exact step ID/token can settle through the normal terminal path. The full
candidate suite passes **35/35** and candidate TypeScript exits 0 after the fix. This is a
synthetic fail-closed repair, not authenticated provider settlement, actual money accounting or a
fresh independent review; the three current hashes above supersede this memo's earlier values.

Current controls still have value but are narrower: explicit candidate Vitest passed **35/35**;
candidate TypeScript passed; `routineDecision`, `routines` and `dstProbe` passed **108/108**;
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
Any production module/table/caller would require a separately reviewed governance transition;
ADR-050's six-file disabled stage does not grant it. D6's sweep-only amendment, live DST/OAuth/
provider observations and the separate owner release decision remain additional gates.
