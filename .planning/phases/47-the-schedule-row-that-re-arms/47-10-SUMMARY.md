# 47-10 summary — production target restored, probes still waiting

On 2026-09-24 the production deployment identity was independently matched and two bounded, read-only Convex inline queries succeeded. Four historical `clock.dst_probe` armings were freshly visible, with four exact-time scheduled jobs still `pending`; there were no `fired` audit rows. The prior unlinked-target `UNREACHABLE` attempt remains a recorded failed attempt, not a claim that the probes disappeared. Exact refs, times, target fingerprint, command boundary and counts are in `47-10-TARGET-CHECK.md`.

Collector self-check and current `defer` decision validation each exited 0. Plan 47-10's target-access checkpoint is complete. Live DST evidence, the remaining Phase 47 plans, ROUT-02 and the recurrence implementation remain open. No production state or credential file was modified.
