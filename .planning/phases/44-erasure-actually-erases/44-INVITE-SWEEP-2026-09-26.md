# ADR-045 D2 production invite sweep — 2026-09-26

**Result:** The one-time `tenantDelete:sweepOrphanedInviteIdentities` operation reached `done: true` on the verified production Convex deployment. It scanned two `betaInvites` rows and cleared zero identity links. This is the historical-invite D4 cleanup only, not WORM activation or a conclusion about the separate `billingEvents` bridge.

Before the mutation, a production-key-scoped inline **read-only** query returned only aggregate fields: the known Auckland DST-probe arm correlation was present, four `clock.dst_probe` audit rows were found, and the first 100-invite page contained two rows, zero redemptions pointing to a missing `users` row, and `done: true`. No invite address, subject, code, provider response or deploy key was emitted. A prior sandbox attempt failed at network `EACCES` before reaching production and made no change; the reviewed network path returned this bounded preflight.

Immediately before the sweep, a second read-only query on the same process-local production deploy key required that exact Auckland correlation to be present. Only after that positive target check did the CLI invoke the already-deployed internal mutation with `{"limit":100}` and **without** `--push` or a deployment change. The parsed terminal result was:

```json
{"scanned":2,"cleared":0,"done":true}
```

The key existed only in the child process environment and was removed in `finally`; no key value was logged or written. No row was cleared on this run, no email or external message was sent, and no `WORM_BUCKET` setting or archive export was touched. The function is paged and idempotent; `done: true` means no follow-on page is needed for this invocation.

ADR-044 T2 is **not** globally satisfied: ADR-045 explicitly leaves the `billingEvents` ↔ Stripe identity bridge undecided. T1–T4 and the seven-year retention/real Object Lock decision must be reviewed separately before WORM can be armed. The Auckland DST fire remains scheduled for 2026-09-26 15:00:16.712 UTC and was not armed or observed by this sweep.
