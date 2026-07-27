# 17-01 — SUMMARY

**Plan:** 17-01 (wave 1) — the Lane-K half of the Stage-1 shared-union freeze + the pure calendar domain
**Completed:** 2026-07-27
**Requirements:** ACTN-02

## How the freeze was executed

The joint Stage-1 commit was **resolved away** on 2026-07-27 (`22c7bb0` on `main`). The freeze is
**absorbed into the lanes and serialized through `main`** — the property that matters is
serialization, not single-commit-ness. Lane R landed `16-01` and merged first (`7386744`); this
lane merged `main` down (`5ec09c9`, **zero conflicts** — the freeze working as designed) and then
added its own literals on top.

## Recorded decisions (the plan requires these verbatim)

| Q | Decision | Why |
|---|---|---|
| 1. Arm literal name | **`"externalAction"`** | Names HOW a thing executes. Phases 18 (documents) and 19 (CRM) are the same mechanism — one governed external side effect driven by the retrier — so they reuse this arm instead of adding a fourth. |
| 2. All-day events | **Deferred.** Timed only. | `date` and `dateTime` are mutually exclusive and all-day cannot be derived from an epoch. |
| 3. Update / cancel | **Create-only.** | "Manage" without ETag/`If-Match`/412 handling is a data-loss path. **ACTN-02's literal text is "schedule *and manage*" — this descopes the "manage" half**, and 17-04 must record that on the traceability row so ACTN-02 is not closed as if fully built. |
| 4. `plans` fields vs a `calendarEvents` table | **Optional fields on `plans`.** | `plans` already carries optional feature-specific fields with no migration (`sendAt`, `attachments`). |
| 5. `gmailTokens` rename | **Do not rename.** | A table rename is a migration for a cosmetic gain. |
| 6. Attendees | **Out of scope, enforced by ABSENCE** — neither an `attendees` nor a `sendUpdates` key exists. | `events.insert` with attendees makes GOOGLE email them: an outbound communication with no plan, no audit, no DLQ, no PII scan. Absence beats pinning `sendUpdates: "none"`. |
| 7. Provider scope (CONTEXT D5) | **Google only.** | Reuses the existing OAuth client, consent flow, `gmailTokens` row and `freshAccessToken` — one widened scope string, zero new flows. |
| 8. Terminal-handler module | **`convex/calendarComplete.ts`** (new, non-node). | `convex/calendar.ts` must be `"use node"` (it imports `freshAccessToken`), and a `"use node"` module holds ONLY actions — an `internalMutation` in it is rejected. Mirrors the shipped `gmail.ts` ↔ `gmailAuth.ts` split. |

## Mutation-checks — all four run, RED observed, restored

The three arm-table checks are **separate on purpose**: each site fails on a *different* mutation,
and expecting one mutation to redden all three is what would make an executor report a phantom
blocker.

| # | Mutation | Observed RED | Proves |
|---|---|---|---|
| 1 | Remove `"calendar_event"` from `ACTION_TYPES` | `actionType.ts(13,90)` TS2322 (`actionTypeOf`'s widened param) **and** `actionType.ts(42,3)` TS2353 (`ARMS`) **and** `cockpit.ts(508,3)` TS2353 (`_ARM_TABLE`) | `ActionType` really is derived from `ACTION_TYPES`, and BOTH binds read it |
| 2 | Remove the `calendar_event` row from `cockpit.ts`'s `_ARM_TABLE` **only** | `cockpit.ts(508,12)` TS2741 — **and `packages/core` stayed clean (0 errors)** | The dispatcher's second bind is a real INDEPENDENT guarantee, not a copy of `ARMS` that would go green with it |
| 3 | Remove `case "externalAction":` from `executePlan`'s switch | `cockpit.ts(561,28)` TS2345 — `"externalAction"` is not assignable to `never` | The switch is exhaustive; a new arm cannot silently fall through |
| 4 | Delete the `checkAvailability` VERB entry from `cards.tsx` | `traceParity.test.ts` RED with the named message | The parity scan is not vacuous |

As the plan predicted, mutations 1 and 2 did **not** redden `assertNever` — `Arm` is an explicitly
declared union, not derived from `ARMS`. That is correct, not a defect.

## Verification

- `packages/core`: **63/63** (`calendar.test.ts` 14 new, `emailIntent.test.ts` 41, `actionType.test.ts` 8)
- `convex/traceParity.test.ts`: **2/2**, mutation-verified
- `pnpm --filter @pikar/web exec tsc --noEmit`: **exit 0** (the `cards.tsx` calendar branch compiles)
- Backend `tsc`: **52 errors, zero in production `convex/*.ts`** — exactly the documented baseline,
  unchanged by this plan. See `PARALLELIZATION.md` (`0d85975`) for why "clean" was never achievable.
- `node scripts/check-playbooks.mjs`: **exit 0**

### One PRE-EXISTING red, not from this plan

`vault.test.ts > "an unrecognized binary (zip) stays pending_extraction, nothing scheduled"` fails.
**It fails identically on `main`**, verified by running it there. Cause is Lane V's
`a390f95 feat(15.2-03): scheduleExtraction — one permissive scheduling decision, always armed`,
whose new always-armed behaviour contradicts the older Phase-3.8 assertion. **Lane V's to reconcile
— do not "fix" it from this lane.**

## Deviations from the plan

1. **`as const` + `satisfies` must stay on ONE line.** The plan's snippet wraps before `satisfies`;
   esbuild's TS parser applies ASI there and fails with *Expected ";" but found "Record"*. Both
   tables are formatted as multi-line object literals ending `} as const satisfies Record<…>` instead.
2. **`actionType.test.ts` had a Wave-0 pin** (`"the union is exactly email + memo at Wave 0"`,
   `toEqual(["email","memo"])`) that the plan did not mention. It is *designed* to fail on a
   widening ("makes widening a deliberate, visible act"), so it was updated to pin the new
   three-member set rather than deleted.
3. **The plan's separate `toHaveLength(3)` non-vacuity floor was dropped as redundant** — the exact
   `toEqual([...])` pin above it already constrains both membership and length. Ponytail: one
   assertion, not two, for the same fact.
4. **The plan's test fixture for the horizon widening does not work.** It assumes
   `"January 30 at 3pm"` parses to 30 days out; `parseSendTime` has **no month-name grammar** and
   silently resolves it to **today** at 3pm. Probed the grammar and switched both rows to
   `"in 240 hours"` (10 days), the only shipped form that reaches past the 7-day horizon.

## ⚠ Carry-forward for 17-03 — a real constraint the plan did not know

**`parseSendTime` cannot express a far-future absolute date.** `"in 240 hours"` works;
`"January 30 at 3pm"`, `"in 2 weeks"`, `"in 30 days"`, `"next month"` and `"2026-02-15 15:00"` all
either return `none` or silently resolve to today. The `horizonMs` widening is real and correct,
but it only matters for expressions the parser can already reach. **17-03's staging tool needs
another route to an epoch for a genuinely distant event** — do not assume natural language covers it.

## Environment

This worktree has `node_modules` and a `_generated/` seeded from `main`; it has **no Convex
deployment**. That was sufficient here because this plan adds no new `convex/` module. **17-02 is
the first plan that genuinely needs `npx convex dev`** (it adds `calendar.ts` and
`calendarComplete.ts`, which forces `api.d.ts` regeneration) — and it also needs owner-granted
Google OAuth consent for the widened scope.
