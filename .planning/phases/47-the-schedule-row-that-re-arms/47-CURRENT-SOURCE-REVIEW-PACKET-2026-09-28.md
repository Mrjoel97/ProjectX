# Wave 6 disabled recurrence candidate — independent current-source review packet

**Status:** awaiting a reviewer independent of the candidate implementer. This packet requests a
GO/NO-GO on the **current isolated synthetic design only**. It is not a review verdict, D6 pass,
ROUT-02 completion, `enable-safe` decision, deployment, tenant activation, provider/paid call or
external-send authority. Operational recurrence remains `defer`.

## Exact review target

Review the six files under `packages/backend/candidate/recurrence/` at the exact hashes below.
Recompute SHA-256 from raw local bytes before reading the tests as evidence; stop and rebaseline
if any identity differs. The packet may have later prose-only commits without changing these bytes.

| File | SHA-256 |
| --- | --- |
| `schema.ts` | `628d3d67dcdefeedd32587341ef715413a537428f6fb6ec9e1c258f61504d909` |
| `model.ts` | `7bd28255330933ac7741e138915cb621e982c684bd867b6a4a9d0d30a8212145` |
| `model.test.ts` | `287855c39518760053e6042187aa0e8f06f2f00773e1c444b63400c0ea5baffb` |
| `README.md` | `7892c0048ba36de799ff2c9f6f9f69ea0a2380a7edbe14a98793a31db7a8fd18` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |

The [47-22 technical GO](47-22-TECHNICAL-REVIEW.md) is historical: all four of its source/test
hashes differ from this tree. [47-23](47-23-CURRENT-SOURCE-AND-REAL-RAIL-AUDIT.md) records the
current-source correction, two unknown-paid repairs, the absent-rail/tombstone repair, and the
installed limiter mismatch. Do not carry forward the old GO without inspecting these bytes.

## Review method and adverse questions

1. Read accepted ADR-046 D1–D9, ADR-050's six-file/disabled boundary, ADR-051's conditional
   sweep-only D6 invariant, ADR-052's evidence wording, the accepted stage artifact and historical
   `defer` decision. Decide whether any candidate path violates those boundaries; no source scan
   alone proves reachability.
2. Trace tenant/status/version and occurrence identity from due selection through atomic claim,
   reservation admission, paid-step admission/start/landing, recovery and external-action
   admission. Inspect both pause-first and admission-first orders, duplicate workers, retry,
   restart, DST fold/gap/deleted date, backlog/watermark and no-burst behavior. Challenge invalid
   schedule writes: creation, material edit and approval must reject bad time/zone/rule before a
   stored row can repeatedly throw ahead of the due-sweep cursor.
3. Challenge ambiguous physical effects. A lost paid start, timeout or generic throw must retain
   the exact step and both holds without a second physical call. A thrown `reserve` followed by
   `absent` is **not** confirmed no effect; a terminal `release` needs a `released` tombstone, not
   merely an `absent` lookup. Check the test's late-arriving original reservation and the
   corrected former retry expectation. Confirm an exact later landing cannot bypass the current
   approval fence or create an actionable plan after pause.
4. Inspect the real integration boundary separately. The injected `SyntheticRails` protocol is
   **not** implemented by `@convex-dev/rate-limiter@0.3.2`; its bucket `key` is not a per-run
   reservation identity, and `guardrails.ts` uses tenant-keyed daily and shared keyless deployment
   windows. Challenge the synthetic fixture's tenant-daily versus shared-deployment balances at
   exact ceilings as well as its keyed tombstone behavior. A synthetic GO must name this gap,
   not claim real atomic reserve/refund, provider-result authentication or recovery liveness.
   No production rail, table or caller may be added under
   this review packet.
5. Verify isolation: the exact six stage-listed files stay outside `convex.json`'s production
   functions root and app/core imports, with no registered scheduler/cron, tenant-callable arm,
   provider credential, `fetch`, external write or send. The independent `dstProbe` jobs are not
   routine callbacks. Review refs-only audit/dead-letter fields and the per-run human approval
   boundary as design evidence only.

Reproduction from repository root, with no provider call or spend:

```powershell
pnpm --filter @pikar/backend test -- --config candidate/recurrence/vitest.config.mts
& .\packages\backend\node_modules\.bin\tsc.CMD --project packages/backend/candidate/recurrence/tsconfig.json --noEmit
node scripts/check-recurrence-source-review.mjs --self-test
node scripts/check-recurrence-source-review.mjs
node packages/backend/scripts/check-routine-gate.mjs .planning/phases/47-the-schedule-row-that-re-arms/47-14-STAGE-DECISION.md --validate-stage
```

At this packet's source identity, the candidate suite passed **41/41**, candidate TypeScript,
source-review self-test/real check and stage validation exited 0. The real governance modes were
re-run on 2026-09-28: matrix/eligibility/historical-defer/stage exits `0/1/0/0`, with **14**
eligibility findings. These are author-side reproduction results, not independent review.

## Required review output

Record reviewer identity/date, recomputed six hashes, commands actually run and results, code
paths inspected, concrete findings and an explicit **GO or NO-GO for isolated synthetic design**.
If GO, list real-rail, deployed bounded sweep/recovery, actual approval integration, three live
traces, D6 and release evidence as still missing. If NO-GO, name each exact source/test defect and
leave the candidate pending. Either verdict must preserve operational `defer` and the stage's
2026-12-31 expiry; neither may relabel automated evidence `live` or change a matrix row. A later
candidate byte change invalidates the verdict's source binding and requires fresh review.
