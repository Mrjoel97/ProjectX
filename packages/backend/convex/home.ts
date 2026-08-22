/**
 * The Command Center's two read models (HOME-01).
 *
 * CLAUDE.md §1 — a thin adapter and nothing else. Every DECISION about priority and health lives
 * in `@pikar/core`'s `home.ts`; this module only GATHERS narrow facts from surfaces that already
 * exist and hands them over. It must never decide "healthy" itself.
 *
 * TWO subscriptions, never one fat query. `summary` and `health` are separate on purpose: the
 * page holds independent `useQuery`s, so one section failing cannot blank the other. The same
 * rule holds INSIDE each query — every source read goes through `orElse` below, so a source that
 * throws degrades to its own stated "unavailable" variant while its neighbours keep their real
 * values.
 *
 * A FAILED SOURCE IS NEVER THE NUMBER 0. "We could not read this" and "there are none" are
 * different facts, and the union keeps them different all the way to the renderer.
 *
 * COMPOSED, NOT RE-DERIVED: `approvals.summary`, `content.summary`, `deadLetters.newCount`,
 * `contacts.pipelineTiles`, `gmailAuth.gmailStatus`, `approvals.listScheduled`,
 * `evaluations.byThread` and `blueprint.blueprintState` are the shipped bounded readers for these
 * facts. Re-implementing any of them here is how two surfaces come to disagree.
 *
 * ponytail: composition is `ctx.runQuery` over the PUBLIC readers rather than shared plain
 * helpers. The ceiling is one nested read per source per subscription (Convex validates args and
 * return value and runs each in its own isolate). Upgrade path if that ever costs: export a plain
 * `read*(ctx, tenantId)` from each source module — the `reportsBusiness.readBusiness` shape — and
 * call it directly. Don't take it until the read hurts; today it buys every source's caps and
 * partial flags for free, and each source stays the ONE definition of its own fact.
 */
import {
  type DashboardPartialReason,
  type HomeHealthState,
  type HomePriorityCode,
  type HomeSignal,
  REVIEW_THREAD_ID,
  rollUpHealth,
} from "@pikar/core";
import { api } from "./_generated/api";
import { tenantQuery } from "./lib/functions";

/** DELIVERED rows past this are a FLOOR (`capped: true`), never a wrong integer. */
const DELIVERED_CAP = 1_000;
/** One page of the scheduled queue is the risk probe. A DEEPER queue is `unknown`, never `ok`. */
const SCHEDULED_PROBE = 50;
/** An approval waiting longer than this is STALE — the code's own name, made a number here. */
const STALE_APPROVAL_MS = 24 * 60 * 60 * 1_000;
/** A scheduled send inside this window is imminent enough to be worth a look before it goes. */
const SEND_SOON_MS = 60 * 60 * 1_000;

/**
 * THE ONE DEGRADE SEAM. Written once and reused by every source read in this module (a try/catch
 * per source is how one of them quietly ends up returning 0 instead of "unavailable").
 *
 * It catches deliberately broadly: from here every source failure means the same thing to the page
 * — "we do not know". The CALLER supplies what not-knowing looks like for its own section, so this
 * function can never invent a number of its own.
 */
async function orElse<T, F>(read: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

const UNAVAILABLE = { unavailable: true } as const;

export type HomeSummary = {
  approvals:
    | { awaitingCount: number; capped: boolean; oldestWaitingAt: number | null }
    | { unavailable: true };
  content: { total: number; capped: boolean } | { unavailable: true };
  delivered: { count: number; capped: boolean } | { unavailable: true };
  deadLetters: { newCount: number } | { unavailable: true };
  pipeline:
    | {
        status: "ready";
        needingAttention: number;
        followUpsDue: number;
        consentOnRecord: number;
        suppressed: number;
      }
    | {
        status: "partial";
        reason: DashboardPartialReason;
        needingAttention: number;
        followUpsDue: number;
        consentOnRecord: number;
        suppressed: number;
      }
    | { status: "unavailable" }
    | { status: "error" };
};

export const summary = tenantQuery({
  args: {},
  handler: async (ctx): Promise<HomeSummary> => {
    const [approvals, content, delivered, deadLetters, pipeline] = await Promise.all([
      orElse(async () => {
        const s = await ctx.runQuery(api.approvals.summary, {});
        // `awaitingCountCapped` is carried across, never dropped: 100 with the cap bit set means
        // "at least 100", and losing the bit turns a floor into a claimed total.
        return {
          awaitingCount: s.awaitingCount,
          capped: s.awaitingCountCapped,
          oldestWaitingAt: s.oldestWaitingAt,
        };
      }, UNAVAILABLE),
      orElse(async () => {
        const s = await ctx.runQuery(api.content.summary, {});
        return { total: s.total.count, capped: s.total.capped };
      }, UNAVAILABLE),
      orElse(async () => {
        /**
         * DELIVERED — THE ONE DEFINITION ON THIS PAGE: a `requests` row whose `status === "sent"`.
         *
         * WHICH ROWS COUNT: every row of the `requests` table, BOTH lanes, one row per recipient.
         * The legacy/pipeline lane inserts its row at submit (`requests.ts`) and `pipeline.ts`
         * flips it to `sent`; the cockpit lane inserts ONE row per recipient (`cockpit.ts`) and
         * `plans.recordDeliveryTerminal` flips it. Both lanes land in this one index.
         *
         * WHY THE LEGACY/COCKPIT DOUBLE COUNT CANNOT HAPPEN: this is a single read of a single
         * table, and nothing is summed onto it. The other two counters over the same event —
         * `telemetry.reviewOutcome === "sent"` (both lanes) and `plans.sentCount` (cockpit only) —
         * are deliberately NOT read here. Adding either double-counts: telemetry doubles
         * everything, and `plans.sentCount` doubles cockpit sends while counting legacy sends once,
         * which is the dangerous one because the result comes out biased rather than obviously
         * wrong. `recordDeliveryTerminal` is idempotent (a row already `sent|failed|blocked` is
         * never re-flipped), so a delivery retry cannot inflate this either.
         *
         * ALL-TIME, no window: `home.summary` takes no window args by contract, and windowing here
         * would make this number disagree with the same fact on Reports for no gain.
         */
        const rows = await ctx.db
          .query("requests")
          .withIndex("by_tenant_status_createdAt", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("status", "sent"),
          )
          .take(DELIVERED_CAP + 1);
        return { count: Math.min(rows.length, DELIVERED_CAP), capped: rows.length > DELIVERED_CAP };
      }, UNAVAILABLE),
      orElse(
        async () => ({ newCount: await ctx.runQuery(api.deadLetters.newCount, {}) }),
        UNAVAILABLE,
      ),
      orElse(
        async () => {
          const tiles = await ctx.runQuery(api.contacts.pipelineTiles, {});
          // The narrow Pipeline summary and NOTHING else: four counts plus the source's own
          // coverage bit. No opportunities, no stages, no value, no contact rows.
          if (typeof tiles?.needingAttention !== "number")
            return { status: "unavailable" as const };
          const counts = {
            needingAttention: tiles.needingAttention,
            followUpsDue: tiles.followUpsDue,
            consentOnRecord: tiles.consentOnRecord,
            suppressed: tiles.suppressed,
          };
          // `partial: "row-cap"` means the four counts are a FLOOR. It survives composition as
          // `status: "partial"` plus the reason, because a floor rendered as a total is a wrong
          // number — and a Pipeline that could not be read is `"error"`, never four zeros.
          return tiles.partial === null
            ? { status: "ready" as const, ...counts }
            : { status: "partial" as const, reason: tiles.partial, ...counts };
        },
        { status: "error" as const },
      ),
    ]);
    return { approvals, content, delivered, deadLetters, pipeline };
  },
});

/** A source that could not answer reports UNKNOWN for its code — never `ok`, never a zero count. */
const unknownSignal = (code: HomePriorityCode): HomeSignal => ({ code, state: "unknown" });

export type HomeHealth = { state: HomeHealthState; signals: HomeSignal[] };

/**
 * The six required health signals, gathered as NARROW CODE-OWNED FACTS — a state, a count, a
 * timestamp. No row text, no model prose, no subject line may enter a `HomeSignal`; the copy the
 * page renders is `HOME_PRIORITY_COPY`, keyed by the code.
 *
 * THE VERDICT IS `rollUpHealth`'S, NEVER THIS MODULE'S. That is the whole point of the split: a
 * source that throws becomes `state: "unknown"` here, and core's lattice then refuses to say
 * "healthy" over an incomplete set.
 */
export const health = tenantQuery({
  args: {},
  handler: async (ctx): Promise<HomeHealth> => {
    const now = Date.now();
    const signals = await Promise.all([
      orElse(async () => {
        const status = await ctx.runQuery(api.gmailAuth.gmailStatus, {});
        // ponytail: `connected` is the whole signal — `gmailStatus` carries no reauth or
        // expiring-soon flag today (`expiresAt` is the ACCESS token, which refreshes itself).
        // Upgrade path: surface the sweep's `isExpiringSoon` / an `awaiting_reauth` probe from
        // gmailAuth and widen the signal THERE, not here.
        return {
          code: "connection-failure" as const,
          state: status.connected ? ("ok" as const) : ("triggered" as const),
        };
      }, unknownSignal("connection-failure")),
      orElse(async () => {
        const newCount = await ctx.runQuery(api.deadLetters.newCount, {});
        return {
          code: "unresolved-dead-letters" as const,
          state: newCount > 0 ? ("triggered" as const) : ("ok" as const),
          count: newCount,
        };
      }, unknownSignal("unresolved-dead-letters")),
      orElse(async () => {
        const s = await ctx.runQuery(api.approvals.summary, {});
        // STALE, not merely waiting: an approval answered the same day is normal operation, and a
        // health surface that calls that "degraded" teaches the owner to ignore it.
        const stale = s.oldestWaitingAt !== null && now - s.oldestWaitingAt > STALE_APPROVAL_MS;
        return {
          code: "stale-approval" as const,
          state: stale ? ("triggered" as const) : ("ok" as const),
          // `awaitingCountCapped` means 100 is a FLOOR, and `HomeSignal` has no cap bit to carry
          // it — so the count is DROPPED rather than shipped as exact. The sibling read above says
          // it plainly: losing the bit turns a floor into a claimed total, and the two
          // subscriptions on this page must not report the same fact with and without its marker.
          // `at` stays either way: `oldestWaitingAt` is its own unbounded `.order("asc").first()`.
          ...(s.awaitingCountCapped ? {} : { count: s.awaitingCount }),
          at: s.oldestWaitingAt,
        };
      }, unknownSignal("stale-approval")),
      orElse(async () => {
        const page = await ctx.runQuery(api.approvals.listScheduled, {
          paginationOpts: { numItems: SCHEDULED_PROBE, cursor: null },
        });
        // Two risks, one code: a send with NO confirmed time (`legacy-unknown`) and a send that is
        // already imminent. Both mean "look at this before it goes".
        const risky = page.items.filter(
          (item) =>
            item.scheduleState === "legacy-unknown" ||
            (item.scheduledAt !== null && item.scheduledAt <= now + SEND_SOON_MS),
        );
        // A CAPPED READ CAN NEVER REPORT "ok". The probe is one page ordered by newest-CREATED,
        // not by send time, so a risky send can sit past it — "none in these 50" is not "none".
        // Fail closed to `unknown` (the rule `rollUpHealth` applies upstream), and drop the
        // evidence, which is only a floor once the page is bounded: `state` was the lie, `count`
        // would be the next one. `nextCursor` is what `listScheduled` already returns for this.
        if (page.nextCursor !== null)
          return risky.length > 0
            ? { code: "scheduled-risk" as const, state: "triggered" as const }
            : unknownSignal("scheduled-risk");
        const earliest = risky.reduce<number | null>(
          (min, item) =>
            item.scheduledAt === null || (min !== null && min <= item.scheduledAt)
              ? min
              : item.scheduledAt,
          null,
        );
        return {
          code: "scheduled-risk" as const,
          state: risky.length > 0 ? ("triggered" as const) : ("ok" as const),
          count: risky.length,
          at: earliest,
        };
      }, unknownSignal("scheduled-risk")),
      orElse(async () => {
        const row = await ctx.runQuery(api.evaluations.byThread, { threadId: REVIEW_THREAD_ID });
        // NO ROW IS NOT HEALTH. A tenant who has never run the business review has no diagnosis,
        // and "no failing gate" is a claim that read cannot support. Same for the engine's own
        // `insufficient` verdict — it exists precisely to say "not enough data to judge".
        if (row === null) return unknownSignal("diagnostic-blocker");
        return {
          code: "diagnostic-blocker" as const,
          state:
            row.verdict === "gaps"
              ? ("triggered" as const)
              : row.verdict === "healthy"
                ? ("ok" as const)
                : ("unknown" as const),
          count: row.gaps.length,
          at: row.createdAt,
        };
      }, unknownSignal("diagnostic-blocker")),
      orElse(async () => {
        const state = await ctx.runQuery(api.blueprint.blueprintState, {});
        // A `null` blueprint and a blueprint with a blank `bindingConstraint` are the SAME fact
        // for this signal: nothing here is ranked against the owner's real bottleneck. Only
        // whether the FIELD is filled crosses over — never its text.
        return {
          code: "binding-constraint" as const,
          state:
            state.live !== null && state.live.bindingConstraint !== null
              ? ("ok" as const)
              : ("triggered" as const),
        };
      }, unknownSignal("binding-constraint")),
    ]);
    return { state: rollUpHealth(signals), signals };
  },
});
