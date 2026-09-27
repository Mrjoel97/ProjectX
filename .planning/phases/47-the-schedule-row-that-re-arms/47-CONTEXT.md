# Phase 47: The schedule row that re-arms - Context

**Gathered:** 2026-09-24
**Status:** Ready for planning

<domain>
## Phase Boundary

G25's consuming phase ultimately needs a schedule row, per-run budget reservation and dead-letter handling. The current gate remains `defer`, and evidence collection alone does not permit a table or runtime. On 2026-09-24 the owner selected a separately reviewed `build-for-evidence` governance stage to break the implementation-before-evidence cycle. That selection permits planning an isolated, disabled candidate only after an explicit superseding governance amendment and tested checker contract; it is not `enable-safe`, production deployment, tenant activation or send authority. See `47-13-GATE-REVIEW.md` and `47-14-BUILD-FOR-EVIDENCE-CHARTER.md`.

</domain>

<decisions>
## Implementation Decisions

### Evidence and decision order
- Preserve `29-RECURRENCE-DECISION.md` as an immutable historical decision; any later `enable-safe` outcome gets a superseding artifact after all twelve matrix rows genuinely pass.
- `dst-boundary`, `oauth-expiry-reauth`, and `provider-read` require observed live traces, not simulations, source-code references, or an agent-written summary relabelled `live`.
- The existing `dstProbe.arm`/`observe` pair is the ADR-046 D9 throwaway probe: one scheduled call, armed before a real DST transition and observed firing after it, with armed and fired instants and resolved wall time. The collector must read the paired production audit rows and independently verify the crossing. The decision record also asks for spring-forward and fall-back evidence; retain the four armed probes rather than treating a test or the first easy-direction trace as sufficient for the final review.
- The real Google OAuth path must show token expiry, explicit reauthorization, and no catch-up burst. A fixture token or pre-expiry read does not qualify. `provider-read` is historically marked `pass/live`, but its old summary citation fails the current gate's collected-artifact rule; a new live, unattended provider read needs both a collector artifact and human review.
- A failed, missing, or unreachable probe stays a refusal. Do not synthesize an artifact, weaken `check-routine-gate.mjs`, or lift `defer` by renaming modules or an ADR to evade the absence guards.
- ADR-046 says the other rows pass only after implementation and tests, while the current `defer` guards forbid that implementation. Surface this bootstrap cycle for a distinct owner-reviewed governance decision; do not interpret the two missing live traces as the only blockers.
- The owner chose the general governance-order amendment (Option C): `defer` → `build-for-evidence` → `enable-safe`. Preserve the historical 29 decision. The intermediate stage must be a distinct, fail-closed checker/artifact contract, isolate a disabled candidate in development/test only, and require another owner review before any production or tenant exposure. The stage cannot change the three live-evidence standards or D1's per-run approval boundary.

### Existing authority and safety boundary
- ADR-046 D1-D9 stand: a recurring run may read and prepare, but every external write needs its own run-specific human approval; material changes are a closed structured comparison; missed runs skip rather than burst; one active run; provider refusal terminal; pause cancels and the callback re-reads state; audit is refs-only; the whole run envelope is reserved before the first paid call and released on every terminal path.
- The DST probe is not a recurrence implementation. Keep `convex/dstProbe.ts` and its `arm`/`observe` export names stable until the final already-armed call fires, because pending Convex jobs resolve those names at fire time.
- Evidence artifacts may carry identifiers, counts, timestamps and bounded outcomes, never provider tokens, message bodies or other customer content.

### Preserved post-gate design decisions
- Once `enable-safe` is genuinely accepted, use a new `routines` table referencing `savedPrompts`, not schedule state hidden in the inert saved-prompt row.
- Compute due-ness from the routine's zone and last occurrence key; do not store `nextRunAt` or introduce a self-arming chain. Reuse the existing 30-minute reliability-sweep pattern.
- Use one `ROUTINE_RUN_ENVELOPE_CENTS` constant, reserve on both existing spend rails, leave `maxReserved` unset on reserving rails, and refund unused reservation on terminal paths. Reuse `deadLetters` rather than adding a second DLQ table.
- These decisions are preserved for the later gated build. They are not authority to implement them until the separate build-for-evidence governance amendment and isolation checks are reviewed and effective.

### Claude's Discretion
- Choose the smallest read-only checks, evidence-file layout, and verification commands consistent with the existing collector, gate and playbook. Design the intermediate stage to fail closed without changing the current `defer` result; do not infer a live result or stage activation from a green self-check.

</decisions>

<specifics>
## Specific Ideas

- Four probes were armed on production on 2026-09-09 and confirmed pending: Pacific/Auckland (2026-09-26T15:00:16Z, spring forward), Australia/Lord_Howe (2026-10-03T16:30:16Z, 30-minute spring forward), Europe/Berlin (2026-10-25T02:00:30Z, fall back), and America/New_York (2026-11-01T07:00:02Z, fall back). These are pending observations, not collected evidence.
- A 2026-09-24 production read from this shell refused `UNREACHABLE` because the backend environment lacks a valid linked deployment. The historical arming record must not be described as a current pending-state check.
- The original OAuth collector measured silent access-token refresh, which is insufficient for the required explicit reconnect. It now refuses that path; a new end-to-end refs-only trace is still needed.
- The actual gate on 2026-09-24 returned `--matrix` 0, `--eligibility` 1 (14 problems, including the obsolete provider-read citation), and `--validate-decision` 0. This is the baseline, not a forecast after evidence collection.
- The owner wants the nine Closure Programme stages labeled Waves 0-8 finished without loose ends. Pikar-AI's provisional name is `pikar-ai`; registered legal details remain pending. Neither changes the recurrence evidence standard.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/backend/convex/dstProbe.ts`: already-deployed, one-shot scheduler probe writing `clock.dst_probe` armed/fired audit rows.
- `packages/backend/scripts/collect-recurrence-evidence.mjs`: refuses without a real observation and writes a structured artifact only after a successful collector result; also has provider-read and OAuth probes.
- `packages/backend/scripts/check-routine-gate.mjs`: matrix, eligibility, and decision validation with live-artifact checks and defer absence checks.
- `packages/backend/convex/gmailAuth.ts` and `gmailTokens.ts`: existing OAuth expiry/refresh paths; provider evidence must exercise the real app path.

### Established Patterns
- `docs/playbooks/knowledge-search-routines.md` records the four production armings, their fire times, the stable-name warning, and the collector command.
- `packages/backend/convex/routines.test.ts` pins the whole Convex module inventory and scheduling call sites. Preserve its fail-closed signal; convert it to a shape proof only after the governance gate opens for implementation.
- The `audit` rows, not short-retention `_scheduled_functions` rows, are the durable DST evidence pair.

### Integration Points
- Collect artifacts under `docs/evidence/recurrence/` only when the existing collector reports `OBSERVED`; cite the exact resulting file in a superseding decision review.
- Run gate `--matrix`, `--eligibility`, and `--validate-decision` against the actual decision artifact. An eligible parser result does not replace human review of the cited traces.
- Production OAuth evidence requires a real merchant/user-controlled Google grant and elapsed expiry/reauth; the current fixture rows cannot satisfy it.

</code_context>

<deferred>
## Deferred Ideas

- Public UI, tenant activation, production deployment and external sends remain deferred until a valid `enable-safe` supersession and separate release decision. A non-exposed schedule/run candidate may be built only inside the separately reviewed `build-for-evidence` stage; until that amendment is effective, no implementation is permitted and the pinned manual rerun remains the product behaviour.
- Remove the throwaway DST probe and its closed-inventory entries only after the last armed transition has fired and its evidence is safely collected.

</deferred>

---

*Phase: 47-the-schedule-row-that-re-arms*
*Context gathered: 2026-09-24*
