import { SEND_TIME_HORIZON_MS } from "./emailIntent";

/**
 * WHERE a plan acts — the other half of the fact `sendAt` already carries (ADR-039 D4, ADR-042).
 *
 * THIS FILE IS CANONICAL. `schema.ts`'s `plans.channel` union is a MIRROR of it, and the two-way
 * compile bind lives in `convex/plans.ts` beside the `Doc<"plans">` it binds to — per CLAUDE.md §1
 * (domain logic in `packages/*`, `convex/` is a thin adapter), and because `schema.ts`'s closed
 * unions are a DECLARATION site rather than an enforcement layer: a missing literal throws inside
 * the Convex SDK where the error is swallowed, which this repo has been bitten by (`agentSteps.tool`).
 *
 * TWO MEMBERS FROM DAY ONE, deliberately. A one-member union is scaffolding that cannot be got
 * wrong, and the `satisfies Record<Channel, ChannelSpec>` bind below only starts catching anything
 * at two.
 */
export const CHANNELS = ["email", "vault"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * ABSENCE is legal on the TABLE and illegal in a BATCH.
 *
 * Every `plans` row written before Phase 43 has no `channel`, and those rows are emails — so the
 * column stays optional and there is no migration and no backfill (the `sendAt`/`mailProvider`
 * precedent). But ADR-042 supersedes ADR-039 D2: a batch stager must pass `channel` EXPLICITLY.
 *
 * The reason is the whole of ADR-042. `armFor("memo")` is `"inline"`, and the inline arm's memo
 * terminal returns BEFORE the email arm, the gmail check, the horizon cap and the scheduler — so a
 * `kind: "memo"` row structurally CANNOT reach the email terminal. Under a default, a batch row
 * would have been accepted into the queue as an email and then silently filed a vault document.
 * A default is what let a row inherit a terminal nobody chose for it.
 */
export const LEGACY_CHANNEL: Channel = "email";

/**
 * A DISCRIMINATED union rather than a flat record: a channel that cannot be scheduled structurally
 * cannot carry a horizon, so there is no fictional number sitting next to `schedulable: false`
 * waiting to be kept in sync with nothing.
 */
export type ChannelSpec = { schedulable: true; horizonMs: number } | { schedulable: false };

/**
 * `satisfies Record<Channel, ChannelSpec>` — adding a member to `CHANNELS` without deciding its
 * spec is a COMPILE error here. That is the entire reason the enum ships with two members.
 *
 * WHY `vault` IS NOT SCHEDULABLE YET — a fact about code, not a preference, and it expires on a
 * known commit. `armFor("memo")` is `"inline"` (`actionType.ts`), and the inline arm
 * (`convex/cockpit.ts`) contains no `ctx.scheduler` call and never reads `plan.sendAt`; the only
 * arm site sits inside the `workflow` (email) block, below `case "workflow": break;`. So a `sendAt`
 * on a vault-bound row would be accepted and then silently dropped at Approve — ADR-039 D3's exact
 * prohibition. Plan 43-06 lands the memo arm and flips this to `true` IN THE SAME COMMIT as the arm
 * (ADR-042 D3: the flip and the arm must not be separable). Until then the refusal below is live
 * and reachable, which is what keeps D3 from being prose.
 */
export const CHANNEL_SPECS = {
  // The horizon is the Gmail token's life, not a policy — see `emailIntent.ts`.
  email: { schedulable: true, horizonMs: SEND_TIME_HORIZON_MS },
  vault: { schedulable: false },
} as const satisfies Record<Channel, ChannelSpec>;

/** ONE predicate, so the two `sendAt` write sites in `plans.ts` cannot drift apart. */
export const isSchedulable = (c: Channel): boolean => CHANNEL_SPECS[c].schedulable;

/**
 * Trust boundary. `undefined`/`null` is a legacy row and resolves to `LEGACY_CHANNEL`; anything
 * else THROWS rather than falling back.
 *
 * The throw is the point. `parseCalendarProvider` does the same, and here a silent fallback to
 * `"email"` on an unrecognised value would publish a vault-intended piece into a real person's
 * inbox — the loudest possible version of this failure, reached by the quietest possible bug.
 */
export const parseChannel = (raw: string | undefined | null): Channel => {
  if (raw === undefined || raw === null) return LEGACY_CHANNEL;
  if ((CHANNELS as readonly string[]).includes(raw)) return raw as Channel;
  throw new Error(`CHANNEL_UNKNOWN:${raw}`);
};
