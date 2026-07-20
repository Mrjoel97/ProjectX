# Phase 7: Resilience & Operations Hardening - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Source:** Owner rulings on the researcher's Open Questions (no discuss-phase; plan-now path)

<domain>
## Phase Boundary

A **completion/hardening** phase — every requirement finishes a deliberately-deferred stub that
already exists and carries its own upgrade-path comment (per 07-RESEARCH.md, each cited by file+line):
`worm.ts` (OPSG-03), the `pipeline.ts` timeout branch (REVW-03), `MAX_REGENERATE`/`decisionCounts`
(REVW-02), the cockpit driver's `finally` (AGNT-04), and the `notify` seam (OPSG-05). Reuse and
complete these seams — do NOT rebuild subsystems (ponytail §8). No pinned pre-1.0 component may be
bumped (§6). Requirements: AGNT-04, REVW-02, REVW-03, OPSG-03, OPSG-05.
</domain>

<decisions>
## Implementation Decisions (LOCKED by owner 2026-07-21)

### Audit retention (OPSG-03 / SC#4) — EXPORT ONLY, NEVER SWEEP
- Complete the WORM export (`worm.ts` + `wormCursor.ts`) to real S3 Object Lock — a pure,
  append-only backup to immutable storage. Add the one new dep `@aws-sdk/client-s3` (worm.ts is
  already `"use node"`); Object Lock needs a checksum header + an Object-Lock-enabled bucket +
  paired mode/retain-date (AWS-verified in research).
- **Do NOT delete or sweep the hot Convex `audit` table.** This honors CLAUDE.md §3 / ADR-002
  (insert-only, "nothing is ever deleted") LITERALLY — no delete path, no new ADR.
- **SC#4's "the hot audit copy is swept per the retention policy" is DESCOPED for this phase**:
  export is implemented; the hot-copy sweep/delete is DEFERRED. The hot table grows unbounded but
  reads are already guarded by the `@convex-dev/aggregate` counters (degrades slowly, never breaks).
  Add the `by_ts` index to `audit` regardless — `auditSince` currently full-scans the unbounded table.
  Planner + verifier MUST note SC#4 is partially met (export yes, sweep deferred) — not a silent gap.

### Which path to harden (REVW-02, REVW-03, AGNT-04) — BOTH PATHS
- Harden the LIVE cockpit path (the `executePlan` approve gate + the agent tool-loop that users
  actually reach today) AND complete the machinery in the RETIRED durable-workflow path
  (`pipeline.ts` / `review.ts` + the awaitEvent-timeout gate) to match the original requirement wording.
- **Fix the latent bug regardless (fail closed, not UI-hidden):** past `MAX_REGENERATE` a `regenerate`
  decision currently falls through to delivery = an UNAPPROVED SEND. The backend must reject it at the
  mutation/tool boundary (`pipeline.ts:250` + the equivalent cockpit path), never rely on the UI hiding
  a button. This is a security fix, highest priority within its plan.

### Notifications (OPSG-05) — IN-APP + EXTERNAL (email/push)
- Fire notifications for validation rejection, escalations, retry-limit breaches, timeouts, and
  dead-letter events through BOTH the existing in-app `notifications.ts` seam AND an external channel
  (email via the existing governed Gmail send; push if cheap).
- **Guard against notification loops** — a failed/dead-lettered SEND must never recursively trigger a
  "your notification failed" send. External dispatch is best-effort and must fail closed to in-app.
  Keep payloads refs/ids/counts only (§4) — no raw content in a notification.

### Thresholds (defaults — tunable ponytail knobs)
- Keep `MAX_REGENERATE = 3` (edit/reject retry cap) and the current review-inactivity / agent-timeout
  default (~`SEVEN_DAYS`, matching the Gmail Testing-mode token life). Expose as named constants; no
  owner override requested.

### Claude's Discretion
- Wave structure, file layout, exact test seams, and the shape of the external-notification adapter
  (subject/body of a failure email) are Claude's discretion, within the decisions above.
</decisions>

<specifics>
## Specific Ideas
- Five thin vertical slices, one per requirement, is the researcher's suggested plan shape.
- Pure logic must escape to `@pikar/core` (or a pure package) to be unit-testable — workflows do NOT
  run under `convex-test` (Wave-0 gap noted in research).
- S3 Object Lock is live-verify-only (MEDIUM-HIGH confidence until a real Object-Lock bucket smoke).
</specifics>

<deferred>
## Deferred Ideas
- The hot-audit-copy SWEEP/DELETE (the delete half of SC#4) — export-only this phase; a future phase
  can add a §3-reconciling retention-delete path (would need its own ADR) if the hot table size warrants.
</deferred>

---

*Phase: 07-resilience-operations-hardening*
*Context gathered: 2026-07-21 via owner rulings on researcher Open Questions*
