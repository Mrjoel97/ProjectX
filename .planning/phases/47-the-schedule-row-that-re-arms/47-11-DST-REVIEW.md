# Plan 47-11 DST live review — pending

## 2026-09-26 10:38 UTC pre-fire checkpoint

This is a **read-only waiting checkpoint**, not a `dst-boundary` artifact or ROUT-02 pass. The root `.env` production deploy-key entry was read only into a process-local variable. The SHA-256 of its deployment **name** (not the secret) matched the Plan 47-10 production fingerprint `9067eabf7231a8e473de213cd304fa2fe52ec444e752e5ee9947cb0d29cbd055`. The key value was not printed or stored, and the process-local variables were removed in `finally`.

`collect-recurrence-evidence.mjs --self-check` passed. The exact Auckland artifact path did not exist before the read and still does not exist. A first sandboxed collector read returned `UNREACHABLE`, exit 1, and wrote nothing; that was a network/tool result, **not** a claim that the production job was missing. The same bounded, reviewed read-only production collector then reached the target and returned exit 1 with the expected live refusal: one Pacific/Auckland `clock.dst_probe` armed row, no completed fired trace, scheduled for **2026-09-26 15:00:16.712 UTC**. It explicitly said not to re-arm and wrote no artifact. No scheduler, audit, provider, tenant, or app state was mutated. `dstProbe.test.ts` passed 7/7 offline. Current `dstProbe.ts` SHA-256 is `c265841a87574166cb5957f6e7ac68ddf54c9c96299146a4e00177829311d0c0`; preserve this file and its `arm`/`observe` exports through all four fires.

| Zone | Scheduled UTC fire from Plan 47-10 | Current review |
| --- | --- | --- |
| Pacific/Auckland | 2026-09-26 15:00:16.712 | Pre-fire: armed and waiting. Post-fire: paired audit observed and artifact written; human review pending. |
| Australia/Lord_Howe | 2026-10-03 16:30:16.712 | Future; not collected in this checkpoint. |
| Europe/Berlin | 2026-10-25 02:00:30.774 | Future; not collected in this checkpoint. |
| America/New_York | 2026-11-01 07:00:02.649 | Future; not collected in this checkpoint. |

After each actual fire, reverify the production target and inspect the paired `armed`/`fired` audit rows before running the collector with that zone's distinct output directory. If the row is absent or the target unreachable, record a refusal and do not fabricate or re-arm. The spring-forward and fall-back traces still need separate human review. Historical operational recurrence remains `defer`; this waiting record changes no governance stage or activation.

## 2026-09-26 15:01 UTC Auckland post-fire checkpoint

The same production deployment-name SHA-256 matched the Plan 47-10 fingerprint before the read. The exact Auckland output path was absent, and `dstProbe.ts` still matched SHA-256 `c265841a87574166cb5957f6e7ac68ddf54c9c96299146a4e00177829311d0c0`. The collector made one bounded production read and returned **`OBSERVED`, exit 0**, writing only [Auckland's distinct `dst-boundary.md`](../../../docs/evidence/recurrence/auckland-2026-09-26/dst-boundary.md). It was collected at `2026-09-26T15:01:33.564Z`; no duplicate collection or overwrite was attempted. Process-local production-key and target variables were removed in `finally`; no key was printed or stored.

An independent second read of `audit:recentByType` on the fingerprint-matched production deployment returned exactly two Pacific/Auckland rows under correlation `dst-probe:Pacific/Auckland:1790434816712`: one `armed` and one `fired`. Their stored instants are `2026-09-09T20:10:23.009Z` armed, `2026-09-26T15:00:16.712Z` target and `2026-09-26T15:00:16.758Z` fired, **46 ms after target**. The fired payload records `GMT+12` at arm and `GMT+13` at fire, and wall clock `2026-09-27T04:00:16`. The collector's independent local ICU witness agrees on the same `GMT+12` to `GMT+13` crossing. This is a genuine observed spring-forward audit pair, not the offline fixture or the earlier armed-only preflight.

The collector artifact and this cross-check advance **only the Auckland spring-forward technical evidence**. Human acceptance of this trace remains pending; Lord Howe (30-minute spring-forward), Berlin and New York (fall-back) have not fired yet. The four-zone review, ROUT-02, operational recurrence decision and Wave 6 remain open. Do not re-arm or enable a routine based on this single trace.

The artifact SHA-256 is `5e877f0978db756bcc563eed9d4bb00ad7b84b783fa4d18b4062bed8baf8cb13`. Collector `--self-check` still passes. A post-transition offline backend test exposed a test-harness-only clock issue: the next Auckland transition is now months away, so `convex-test` handed Node a delay beyond its 32-bit timer limit; Node shortened that delay and raced the test's cancellation. The first scoped run had 7 passing assertions but exit 1 for the resulting unhandled scheduler invariant. `dstProbe.test.ts` now parks only synthetic `setTimeout`/`clearTimeout` while its scheduled rows are inspected and canceled, restoring real timers after each test. The exact backend-scoped rerun exits **0, 7/7**, backend TypeScript exits 0, and the test file SHA-256 is `d07fac83400b9cacad6e88aa9f6a7ba5ace7cf5c7d012c0d37d8f8c502be11c0`. Production `dstProbe.ts` and both exports were not edited. A repo-root Vitest invocation also included stale `.tmp` mutation copies and is not the scoped verifier; its error result is not counted as product proof.

After the test-source edit, full Graphify refresh and Convex-edge fixup exited 0. Strict planning, playbook and diff checks exited 0; Git emitted only unrelated CRLF-conversion warnings.

The subsequent real governance read returned **matrix/eligibility/defer-decision/stage exits `0/1/0/0`**, with 14 eligibility findings. The `dst-boundary` matrix row is still `missing`/`automated`; it was deliberately not promoted from one Auckland artifact while Lord Howe, Berlin, New York and human review remain outstanding. The post-fire artifact therefore does not change the operational `defer` state.
