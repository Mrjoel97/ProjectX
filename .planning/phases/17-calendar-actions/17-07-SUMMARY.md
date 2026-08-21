# 17-07 — SUMMARY

**Status: code half was already landed; the gate ran today and CAME BACK NEGATIVE.**

## What was already done before this session

17-07's code shipped in `aaf7059` ("Microsoft Calendar read and create, behind the same Approve
gate") and `1bb1dde` ("the Graph concurrency probe exists — gated, refs-only, unrun"), both
ancestors of `c1877ce`. The phase directory had no `17-07-SUMMARY.md`, which is why the milestone
audit listed 17-07 through 17-11 as unexecuted — **absent summaries, not absent code.** Verified
2026-08-16: every `must_haves` artifact and `key_link` in the plan frontmatter resolves in source
(`microsoftCalendar.ts` 520 lines, `parseCalendarProvider` dispatch at `calendar.ts:234-261`,
closed `["google","microsoft"]` enums at `llm.ts:2392,2488`, provider-accurate card naming at
`cards.tsx:645,697`). Measured green: calendar + microsoftCalendar 87/87, core calendarManagement +
calendar 42/42, cockpit + dispatchGuard 85/85, cockpitTools 132/132, `tsc --noEmit` exit 0 in
backend/core/web, biome clean, `check-playbooks` exit 0.

The only missing artifact was `17-GRAPH-CONCURRENCY-PROBE.json`. It is now present.

## The probe ran. `supported: false`.

Owner authorised running it against their own personal MSA (`joel.feruzi@gmail.com`) rather than a
throwaway account, on `local-joel_feruzi-pikar_ai_50c69-1`, tenant `kn73kmcd…`. Captured
2026-08-16T20:35:39Z. **The calendar was left clean** — `cleanupMissing: true` means the follow-up
GET returned 404, so no probe event survives.

| Field | Value | Reading |
|---|---|---|
| `stalePatchStatus` | **412** | Graph DOES enforce `If-Match` on event **PATCH** |
| `stalePatchPreserved` | **true** | the refused PATCH wrote nothing — a real refusal, not a silent write |
| `staleDeleteStatus` | **204** | **Graph IGNORES `If-Match` on event DELETE** |
| `staleDeletePreserved` | **false** | the stale DELETE actually deleted the event |
| `supported` | **false** | gate NOT satisfied |

## What this means, precisely

**The two halves of management do not behave the same way, and the plan's single `supported` boolean
collapses that distinction.** The measured facts are:

- **Conditional UPDATE is safe.** A stale ETag PATCH is refused 412 and does not write. An atomic
  compare-and-swap for Microsoft event update is available today.
- **Conditional DELETE is NOT safe.** A stale ETag DELETE returned 204 and removed the event
  anyway. There is no optimistic-concurrency protection on delete: two racing cancels, or a cancel
  racing an edit, will destroy an event whose state the caller never saw. This is exactly the lost
  update the probe exists to prevent — it is simply on the delete path rather than the update path.

## Consequence for 17-08 — DO NOT START IT AS WRITTEN

17-08 is hard-gated on `supported === true` and that gate is NOT met. Per 17-07's own recorded
fallback, Microsoft stays **create-only**, Google keeps management, and **ACTN-02 stays pending**.

The forbidden shortcuts remain forbidden, and this result makes them more tempting, not less:
**never unconditional PATCH/DELETE, and never GET-then-compare `changeKey`** — both are
read-modify-write races wearing a seatbelt, and the 204 above proves the delete path has no
seatbelt at all.

A replacement plan has a genuinely new option the binary gate hid: **ship Microsoft governed UPDATE
only** (which the 412 + preserved pair proves is atomic) and leave cancel/delete to Google, or find
a Microsoft-DOCUMENTED atomic delete primitive. That decision is the owner's and is not made here.

## Caveats on this evidence

- One account, one run, personal-MSA (consumer) endpoint. Work/school accounts were not tested and
  Graph behaviour can differ by account type.
- The refresh-token path may have fired for the first time during this run; it was not separately
  asserted.
- `deploymentUrlHash` is the local deployment, not production.
