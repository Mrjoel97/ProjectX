# ADR-023: Microsoft calendar management is UPDATE-only, because Graph has no atomic delete

- **Status**: **Accepted** — 2026-08-17, owner decision at the 14→25 gap-closure gate
- **Recorded**: 2026-08-17, closing the 17-07 probe result
- **Requirements**: ACTN-02 (the agent can schedule and manage calendar events, Google / Microsoft)
- **Phases**: 17 (Calendar Actions) — re-cuts 17-08, which cannot execute as written
- **Relates to**: **ADR-018** (one Microsoft connection, not two) — this ADR narrows what that one
  connection is permitted to do on the calendar plane.
  `packages/backend/convex/microsoftCalendar.ts`, `packages/backend/convex/calendar.ts`,
  `packages/core/src/calendarManagement.ts`,
  `.planning/phases/17-calendar-actions/17-GRAPH-CONCURRENCY-PROBE.json`

## Context

Plan 17-08 (governed calendar update/move/cancel/delete across both providers) is hard-gated on
`17-GRAPH-CONCURRENCY-PROBE.json` returning `supported: true`. The probe ran 2026-08-16 against a
real personal MSA on the local deployment, owner-authorised, and **the calendar was left clean**
(`cleanupMissing: true` — the follow-up GET 404'd, so no probe event survived).

It returned `supported: false`. The measured fields:

| Field | Value | What it proves |
|---|---|---|
| `stalePatchStatus` | **412** | Graph **enforces** `If-Match` on event PATCH |
| `stalePatchPreserved` | **true** | the refused PATCH wrote nothing — a real refusal, not a silent write |
| `staleDeleteStatus` | **204** | Graph **ignores** `If-Match` on event DELETE |
| `staleDeletePreserved` | **false** | the stale DELETE destroyed the event anyway |

**The single `supported` boolean collapsed two different results.** Conditional UPDATE and
conditional DELETE do not behave the same way on Graph, and the gate could only report the worse of
them. Read apart, the probe says something the binary hid: an atomic compare-and-swap for Microsoft
event **update** is available today and provably refuses stale writes, while Microsoft event
**delete** has no optimistic-concurrency protection of any kind. Two racing cancels, or a cancel
racing an edit, will destroy an event whose state the caller never saw — the exact lost update the
probe exists to prevent, simply on the delete path rather than the update path.

## Decision

**Microsoft calendar management ships UPDATE-only. Cancel/delete stays Google-only.**

- Google keeps the full set: create · update · delete.
- Microsoft gets: create · update · **—**.
- ACTN-02 closes as *"management, minus Microsoft delete"* — stated in those words wherever the
  requirement is ticked. It does not close against its original unqualified wording, and no
  document may imply Microsoft cancellation exists.
- The absence is a **product surface**, not a silent hole: a Microsoft-hosted event the user asks to
  cancel must produce an explicit refusal naming the provider limitation, never a no-op, never a
  best-effort delete, and never a fallback that quietly leaves the event live on the calendar.

## Forbidden, and more tempting after this result than before

Both of the following would let 17-08 execute as originally written. Both are read-modify-write
races wearing a seatbelt, and the 204 above proves the delete path has no seatbelt at all.

1. **Unconditional PATCH/DELETE** — dropping `If-Match` to make the call "work".
2. **GET-then-compare `changeKey`** — reading the event, comparing a version marker in application
   code, then issuing the write. The gap between the read and the write is the race; moving the
   comparison client-side does not close it, it only hides it from the HTTP status.

## Consequences

- **17-08 must be re-cut before it runs.** As written it is gated on `supported === true` and would
  build a two-provider delete path the provider cannot support safely.
- 17-09, 17-10 (both `autonomous: true`) follow the re-cut 17-08 unchanged in kind, but their
  Microsoft delete branches become refusal branches.
- 17-11 (owner live gate) can no longer ask for "approved delete" on Microsoft. It asks for
  availability, approved create, approved move/update, conflict refusal, restaged update on both
  providers — and **approved delete on Google only**, plus the Microsoft delete refusal.
- `calendar_manage` remains bound to the `externalAction` arm and continues to throw until 17-09
  wires a writer. Nothing stages that plan kind today.

## Evidence caveats, carried forward honestly

The probe is **one account, one run, consumer personal-MSA endpoint**. Work/school accounts were
not tested and Graph behaviour can differ by account type — a tenant-managed account might well
enforce `If-Match` on DELETE. The refresh-token path may have fired for the first time during the
run and was not separately asserted. `deploymentUrlHash` is the local deployment, not production.

This ADR is therefore correct about **what was measured**, and deliberately conservative about what
was not: a later probe on a work/school account that shows a 412 on DELETE would justify a
superseding ADR widening Microsoft to full management. It would not justify editing this one.
