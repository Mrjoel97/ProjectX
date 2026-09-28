# Wave 6 D8 — installed spend rail versus terminal release

**Recorded:** 2026-09-28. **Disposition:** design blocker, not a candidate or release verdict.
Operational recurrence remains `defer`; no production module, table, provider call, send, or tenant route is authorized by this note.

## Source-bound finding

- [ADR-046 D8](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md) requires a whole-run reservation before the first paid call and release on every terminal path. The accepted [ADR-050 stage](../../../docs/decisions/050-recurrence-build-for-evidence.md) permits only the six isolated candidate files, not a production adapter.
- `guardrails.ts` configures `dailySpendCents` per tenant and `deploymentSpendCents` without a key, both as 24-hour fixed windows. Changing the bucket key to a run ID would destroy those existing caps.
- The installed `@convex-dev/rate-limiter@0.3.2` exposes bucket `check`, `limit`, `getValue`, and whole-bucket `reset`, not keyed reserve/lookup/release/tombstones. Its component `getValue` calculates at the latest stored timestamp, not the present time; a stale stored value is not a safe refund balance. Fixed-window starts may be randomized on the first write if no start is configured. `limit` returns admission status, not a durable per-run/window identity.
- Existing folder settlement in `guardrails.ts` credits by calling `limit` with a **negative count** after rolling the stored window forward and comparing the reservation timestamp. Its own source calls that arithmetic, not a component release API, and documents a remaining cross-boundary instant race. This mechanism is not proof of D8's exact-once per-run release.
- The [47-25 test](47-25-LIMITER-COMPONENT-PROBE-REVIEW.md) proves that tenant and shared limiter debits plus an app journal can commit or roll back in one `convex-test` mutation. It does **not** prove terminal release after a separate paid action, duplicate reconciliation, rollover, or an unknown physical effect.

## Required design decision before a production adapter

The adapter must preserve the tenant and shared cap keys and give every run/rail debit a durable operation identity. It needs an exact-once terminal settlement operation, including already-rolled windows and ambiguous provider outcomes, with a test that every D5 terminal class releases its reservation without minting new-window capacity. A two-rail partial result and a crash between paid effect and landing must stop conservatively and remain operator-reconcilable. App journal and component writes must be in the same top-level mutation where they are claimed atomic.

Three tempting shortcuts do **not** satisfy that contract: use a run ID as a limiter bucket; treat `getValue` as a live balance and issue an unconditional negative count; or mark a journal row `released` while leaving the actual limiter debit held and call that D8 release. A separate custom ledger could be considered, but it must still account for all existing callers of the shared deployment window; a private recurrence-only cap cannot substitute for it.

**Next proof:** a separately reviewed adapter design should specify reservation identity, original window identity, debit/settlement state transitions and operator reconciliation, then fail-first test release/rollover/duplicate/unknown-effect paths against the installed component. If exact terminal release cannot be proved with the pinned component, obtain an explicit governance amendment or a reviewed rail migration; do not silently weaken D8. Production code and activation still require a separate stage transition, all real evidence rows and owner release decision.
