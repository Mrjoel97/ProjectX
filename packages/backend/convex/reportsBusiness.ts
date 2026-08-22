// RPRT-01 — the bounded BUSINESS and OPERATIONS read plane (plan 26-14).
//
// Two tenant queries plus the sent-mail record, all over ONE resolved window. This module adds no
// store and computes no arithmetic that `@pikar/core` already owns: `resolveDashboardWindow`,
// `createDashboardBound`, `compareSnapshots`, `completenessOver`, `percentile`, `coverageLabel`,
// `segmentFill`/`firstGap`, `BLUEPRINT_FIELDS`. What lives here is the bounded READ and nothing else.
//
// **THE RULE THIS PAGE IS BUILT AROUND: "no rows" and "nothing happened" are the same bytes and
// different facts.** A table with no rows in a window supports "0 failures" and "we were not
// watching" equally well, and only one of them is safe to render. So every windowed source pairs
// its count with a `coverageLabel` derived from the OLDEST row that tenant has — one ascending
// `.take(1)` — and a window that starts before it reports partial or unknown, never a confident
// zero. That is the same failure `finance.ts` records from the 26-10 UAT, applied to tables that
// have no `spendCoverage` row to ask.
//
// Every count is a FLOOR when its scan capped. `createDashboardBound` throws if `returned > limit`,
// so the cap idiom is `take(CAP + 1)` → slice → `partial: rows.length > CAP` (the `cash.activity`
// shape), never `take(CAP)` with a `>=` guess.
import {
  BLUEPRINT_FIELDS,
  BLUEPRINT_SEGMENTS,
  type BusinessBlueprint,
  compareSnapshots,
  completenessOver,
  coverageLabel,
  createDashboardBound,
  deserializeBlueprint,
  type EvaluationSnapshot,
  firstGap,
  percentile,
  REVIEW_THREAD_ID,
  resolveDashboardWindow,
  segmentFill,
} from "@pikar/core";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { readLiveForTenant } from "./blueprint";
import { tenantQuery } from "./lib/functions";
import { REVIEW_DECISIONS } from "./review";
import { coverageFor as spendCoverageFor } from "./spendLedger";

/** 90-day preset plus a day of slack. The SERVER owns the ceiling; a browser cannot ask for more. */
export const MAX_WINDOW_MS = 91 * 24 * 60 * 60 * 1000;

const windowArgs = {
  sinceMs: v.number(),
  untilMs: v.number(),
  browserTimeZone: v.string(),
};

function resolve(args: { sinceMs: number; untilMs: number; browserTimeZone: string }) {
  return resolveDashboardWindow({ ...args, maxSpanMs: MAX_WINDOW_MS });
}

/** `take(CAP + 1)` → the honest count plus whether it is a floor. */
function capped<T>(rows: T[], cap: number) {
  const partial = rows.length > cap;
  const counted = rows.slice(0, cap);
  return {
    counted,
    bound: createDashboardBound({
      returned: counted.length,
      limit: cap,
      nextCursor: null,
      partial,
      ...(partial ? { partialReason: "row-cap" as const } : {}),
    }),
  };
}

// ── BUSINESS ──────────────────────────────────────────────────────────────────────────

/**
 * THE EIGHT SCORECARD DOT-PATHS THE ENGINE ACTUALLY GROUNDS AND CITES.
 *
 * Deliberately NOT "every key in the Scorecard": `scorecard` is `v.any()` and carries a whole
 * carried-forward object, so a completeness figure over its key count would measure the shape of a
 * type rather than what the tenant has told us. These are the paths `runEvaluation` fills and
 * cites, so they are the only ones whose absence means "we do not know this yet".
 */
const SCORECARD_PATHS = [
  "businessName",
  "identity.niche",
  "identity.avatar",
  "identity.currentOffers",
  "financials.cac",
  "financials.ltgp",
  "financials.thirtyDayCashPerCustomer",
  "financials.customerCount",
] as const;

/** A dot-path read. Mirrors `cash.ts`'s `scorecardValue`; a third reader is what drifts. */
function pathValue(scorecard: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], scorecard);
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}

/** The refs-and-counts projection of one evaluation row — no findings prose, no scorecard blob. */
function toSnapshot(row: Doc<"evaluations">): EvaluationSnapshot {
  return {
    threadId: row.threadId,
    framework: row.framework,
    verdict: row.verdict,
    findingCount: row.findings.length,
    gaps: row.gaps.map((g) => ({
      route: g.route,
      playbook: g.playbook,
      leverageRank: g.leverageRank,
    })),
    createdAt: row.createdAt,
  };
}

/**
 * The business card.
 *
 * **EVERY FACT HERE IS A SNAPSHOT, AND THE WINDOW IS ONLY ECHOED BACK.** `evaluations` has only
 * `by_tenant` and `by_tenant_thread`, so there is no windowed range to run — and every fact on this
 * card is about the LATEST state of the diagnosis anyway.
 *
 * A windowed `blueprint.confirmed` count WAS built here and has been REMOVED. `audit` is indexed
 * `by_tenant_ts` only, so selecting one `eventType` is a post-index `.filter()`: every audit row in
 * the range is scanned whether it matches or not, and `.take(51)` cannot short-circuit because a
 * tenant confirms a blueprint a handful of times in its life. Over this module's own 90-day ceiling
 * that walks the firehose (~90 `internal.audit.*` call sites feed it) and trips Convex's per-query
 * scan limit — so the card would throw for exactly the active tenants it was for, and never in a
 * fixture-seeded test. The honest options were a new `(tenantId, eventType, ts)` index or no card;
 * nobody asked for the series, so it is no card. Add the index if a confirm trend is ever wanted.
 *
 * **THE PAIR IS READ FROM ONE THREAD.** `by_tenant_thread` on the weekly review thread, newest two.
 * Reading the tenant's two newest rows instead would interleave the cron thread, arbitrary cockpit
 * threads and per-session voice-doc threads, and routinely diff a document review against a
 * business diagnosis. `compareSnapshots` refuses that anyway; this makes it not arise.
 */
export const business = tenantQuery({
  args: windowArgs,
  handler: async (ctx, args) => {
    const window = resolve(args);

    const [live, pair] = await Promise.all([
      readLiveForTenant(ctx, ctx.tenantId),
      ctx.db
        .query("evaluations")
        .withIndex("by_tenant_thread", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("threadId", REVIEW_THREAD_ID),
        )
        .order("desc")
        .take(2),
    ]);

    const blueprint: BusinessBlueprint | null = live ? deserializeBlueprint(live.text) : null;

    const [newer, older] = pair;
    const snapshot = newer === undefined ? null : toSnapshot(newer);
    const findings: Doc<"evaluations">["findings"] = newer?.findings ?? [];

    return {
      window,
      blueprint:
        blueprint === null
          ? { state: "not-built" as const }
          : {
              state: "live" as const,
              // A CLOSED, ORDERED key set — never Object.keys. `BusinessBlueprint` is a total
              // mapped type, so a key count reads 11/11 for a completely blank blueprint.
              facts: completenessOver(BLUEPRINT_FIELDS, (f) => blueprint[f] !== null),
              // `{filled, total}` per segment, never a percentage: `leads` has `total === 0` today,
              // and averaging per-segment percentages would divide by nothing and weight unequal
              // segments equally. One denominator or none.
              segments: BLUEPRINT_SEGMENTS.map((segment) => ({
                id: segment.id,
                label: segment.label,
                ...segmentFill(blueprint, segment),
              })),
              nextGapSegmentId: firstGap(blueprint)?.id ?? null,
            },
      evaluation:
        snapshot === null
          ? // NOT "never-run" — this read is the weekly REVIEW THREAD only, and a tenant who has
            // run the business evaluation ten times from the cockpit has none of those rows here.
            // Saying "never run" about that tenant is a false statement about their own history,
            // so the state names its population instead (must_haves: metrics name their population).
            { state: "no-review-run" as const, population: REVIEW_THREAD_ID }
          : {
              state: "run" as const,
              population: REVIEW_THREAD_ID,
              framework: snapshot.framework,
              verdict: snapshot.verdict,
              findingCount: snapshot.findingCount,
              createdAt: snapshot.createdAt,
              // The LEADING constraint, not a gap count: `diagnose()` emits at most one gap per
              // run, so "3 open gaps" is not a number this engine can produce.
              leadingConstraint:
                snapshot.gaps[0] === undefined
                  ? null
                  : {
                      route: snapshot.gaps[0].route,
                      playbook: snapshot.gaps[0].playbook,
                      leverageRank: snapshot.gaps[0].leverageRank,
                    },
              // Where the cited observations came from. `agent-relayed` is its own bucket on
              // purpose — the owner stated it and the agent wrote it down, which is neither the
              // owner's own confirmed entry nor a vault fact.
              sources: {
                vault: findings.filter((f) => f.source === "vault").length,
                userProvided: findings.filter((f) => f.source === "user-provided").length,
                agentRelayed: findings.filter((f) => f.source === "agent-relayed").length,
              },
              scorecard: completenessOver(SCORECARD_PATHS, (p) =>
                isFilled(pathValue(newer?.scorecard, p)),
              ),
              // Movement, or the reason there is none. NEVER recomputed from the gap arrays when
              // the newer run could not assess — see `compareSnapshots`.
              movement: compareSnapshots(snapshot, older ? toSnapshot(older) : null),
            },
    };
  },
});

// ── OPERATIONS ────────────────────────────────────────────────────────────────────────

const TELEMETRY_CAP = 2_000;
const DLQ_CAP = 100;
const FEEDBACK_CAP = 1_000;
const SEND_CAP = 1_000;
const STEP_CAP = 400;

/**
 * THE GATE DECISION LITERALS, SOURCED FROM THE VALIDATOR'S OWN UNION.
 *
 * `opsSignals.ts` shipped a hand-typed copy of this list containing `"edit"` — a key NOTHING
 * writes — while the real literal is `"edit_text"`. The consequence was not a missing feature: the
 * `/ops` card rendered a permanent `edit: 0` as truth AND silently discarded every real
 * edit-with-changes decision, because it only summed keys present in its own list.
 *
 * `REVIEW_DECISIONS` is `reviewDecisionValidator.members.map(m => m.value)` — the union itself, not
 * a transcription of it. Both readers import it, so a fifth literal reaches both cards or neither.
 */
const DECISION_KEYS: readonly string[] = REVIEW_DECISIONS;

/**
 * The tools whose latency is worth reporting.
 *
 * A CLOSED, NAMED SUBSET because `agentSteps` is indexed `by_tenant_tool_startedAt` — `tool` is
 * eq'd before the time range, so "all agent activity in this window" costs one query per tool
 * literal (there are ~40). Naming six makes the population honest AND the read cheap, and widening
 * it is a deliberate edit rather than a silent fan-out. The population string ships with the number.
 */
const TIMED_TOOLS = [
  "draftBody",
  "proposePlan",
  "searchVault",
  "evaluateBusiness",
  "briefInbox",
  "generateAttachment",
] as const;

/** The oldest row a tenant has in a source — the honest floor for "were we watching?". */
async function earliestAt<T extends { createdAt: number }>(rows: T[]): Promise<number | null> {
  return rows[0]?.createdAt ?? null;
}

export const operations = tenantQuery({
  args: windowArgs,
  handler: async (ctx, args) => {
    const window = resolve(args);

    const telemetryQuery = (order: "asc" | "desc" | "range") =>
      ctx.db
        .query("telemetry")
        .withIndex("by_tenant_created", (q) =>
          order === "range"
            ? q
                .eq("tenantId", ctx.tenantId)
                .gte("createdAt", window.sinceMs)
                .lt("createdAt", window.untilMs)
            : q.eq("tenantId", ctx.tenantId),
        );

    const [
      terminals,
      oldestTelemetry,
      sends,
      oldestSend,
      dlq,
      feedbackRows,
      oldestFeedback,
      spendStartedAt,
    ] = await Promise.all([
      telemetryQuery("range").take(TELEMETRY_CAP + 1),
      telemetryQuery("asc").order("asc").take(1),
      ctx.db
        .query("requests")
        .withIndex("by_tenant_status_createdAt", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            .eq("status", "sent")
            .gte("createdAt", window.sinceMs)
            .lt("createdAt", window.untilMs),
        )
        .take(SEND_CAP + 1),
      // THE FLOOR IS THE OLDEST REQUEST OF ANY STATUS, NOT THE OLDEST SENT ONE. `status` is
      // mutated in place along the pipeline, so eq'ing "sent" here would make the coverage floor a
      // fact about SUCCESSES rather than about the source — and a tenant with 90 days of drafted,
      // rejected or expired requests and zero deliveries would be told "we were not watching" when
      // the truth is "we were watching and nothing was sent". That is the exact conflation the
      // whole module exists to refuse. The windowed COUNT above stays filtered to sent.
      // `by_tenant` (not `by_tenant_status_createdAt`): this table has no tenant+createdAt index,
      // and ascending index order within the tenant is oldest-first, which is the floor we want.
      ctx.db
        .query("requests")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .order("asc")
        .take(1),
      // POINT IN TIME, not windowed: `deadLetters` has no (tenantId, createdAt) index, and adding
      // one for a card nobody asked for is speculative. "Open right now" is a true statement about
      // now; it is deliberately NOT labelled as belonging to the window.
      ctx.db
        .query("deadLetters")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "new"))
        .take(DLQ_CAP + 1),
      ctx.db
        .query("feedback")
        .withIndex("by_tenant_createdAt", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            .gte("createdAt", window.sinceMs)
            .lt("createdAt", window.untilMs),
        )
        .take(FEEDBACK_CAP + 1),
      ctx.db
        .query("feedback")
        .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
        .order("asc")
        .take(1),
      spendCoverageFor(ctx, ctx.tenantId),
    ]);

    // PER-TOOL, NEWEST-FIRST, AND CAPPED BY THE FILE'S OWN IDIOM. Two things this read got wrong
    // when it was `.take(STEP_CAP)` on the default ascending index order:
    //   1. it kept the OLDEST 400 rows per tool, so a busy tenant's p95 described the first days of
    //      a 90-day window and a late regression was invisible; and
    //   2. `take(CAP)` cannot tell "exactly 400 rows" from "400 of 5,000", so the truncation never
    //      reached the payload — `percentile`'s `excluded` counts only values it was HANDED, and
    //      can never disclose rows the query never returned.
    // `capped()` is applied PER TOOL (the flat array can legitimately reach 6 × 400) and the six
    // partial flags are OR'd into one bound that ships beside the number.
    const perTool = await Promise.all(
      TIMED_TOOLS.map((tool) =>
        ctx.db
          .query("agentSteps")
          .withIndex("by_tenant_tool_startedAt", (q) =>
            q
              .eq("tenantId", ctx.tenantId)
              .eq("tool", tool)
              .gte("startedAt", window.sinceMs)
              .lt("startedAt", window.untilMs),
          )
          .order("desc")
          .take(STEP_CAP + 1),
      ),
    );
    const stepPages = perTool.map((rows) => capped(rows, STEP_CAP));
    const steps = stepPages.flatMap((page) => page.counted);
    const stepsTruncated = stepPages.some((page) => page.bound.partial);

    const terminal = capped(terminals, TELEMETRY_CAP);
    const sent = capped(sends, SEND_CAP);
    const open = capped(dlq, DLQ_CAP);
    const rated = capped(feedbackRows, FEEDBACK_CAP);

    // Gate decisions, summed over the CORRECTED key set. A decision literal outside the set is
    // counted as `other` rather than dropped, because a silent drop is exactly the shipped defect
    // this constant exists to stop repeating.
    const decisions: Record<string, number> = {};
    let otherDecisions = 0;
    for (const row of terminal.counted) {
      for (const [key, count] of Object.entries(row.decisionCounts ?? {})) {
        if (typeof count !== "number") continue;
        if (DECISION_KEYS.includes(key)) {
          decisions[key] = (decisions[key] ?? 0) + count;
        } else {
          otherDecisions += count;
        }
      }
    }

    const outcomes: Record<string, number> = {};
    for (const row of terminal.counted) {
      outcomes[row.reviewOutcome] = (outcomes[row.reviewOutcome] ?? 0) + 1;
    }

    return {
      window,
      delivery: {
        // The SENT-MAIL record's headline. RPRT-01 took ownership of it from CONT-01 on 2026-08-22:
        // delivery is a record of what happened, and a sent message cannot be "reused" without
        // re-sending it — the one thing the Content lane forbids.
        sentCount: sent.counted.length,
        bound: sent.bound,
        coverage: coverageLabel({
          sinceMs: window.sinceMs,
          untilMs: window.untilMs,
          earliestRowAtMs: await earliestAt(oldestSend),
        }),
      },
      review: {
        terminals: terminal.counted.length,
        outcomes,
        decisions,
        // Named, not hidden: a decision literal this build does not know about still moves a
        // number, and the reader can see that it did.
        otherDecisions,
        bound: terminal.bound,
        coverage: coverageLabel({
          sinceMs: window.sinceMs,
          untilMs: window.untilMs,
          earliestRowAtMs: await earliestAt(oldestTelemetry),
        }),
      },
      latency: {
        ...percentile({
          // NOT `telemetry.durationMs`: the delivery terminal writes `durationMs: 0` and
          // `usages: []` outright, so a cockpit-only tenant would get a confident and flattering
          // 0 ms. Agent steps carry a real measured duration, and `percentile` drops the
          // unmeasured ones by name.
          values: steps.map((step) => step.durationMs),
          p: 0.95,
          population: `p95 over ${TIMED_TOOLS.length} timed tools`,
        }),
        // A p95 over a truncated sample is the newest `STEP_CAP` per tool, not the window. Said
        // out loud rather than left to look complete.
        truncated: stepsTruncated,
      },
      deadLetters: {
        openNow: open.counted.length,
        bound: open.bound,
        // Deliberately absent: a windowed dead-letter count. See the read above.
        windowed: false as const,
      },
      feedback: {
        rated: rated.counted.length,
        positive: rated.counted.filter((row) => row.rating === "up").length,
        negative: rated.counted.filter((row) => row.rating === "down").length,
        bound: rated.bound,
        coverage: coverageLabel({
          sinceMs: window.sinceMs,
          untilMs: window.untilMs,
          earliestRowAtMs: await earliestAt(oldestFeedback),
        }),
      },
      // Reasoning cost is NOT summed here. It belongs to the append-only ledger with its own
      // coverage start (`finance.summary`), and a second sum over a different source is how two
      // surfaces come to disagree about what the tenant spent. What this page reports is whether
      // the window is inside coverage at all, so the card can link out honestly.
      spend: {
        coverage: coverageLabel({
          sinceMs: window.sinceMs,
          untilMs: window.untilMs,
          earliestRowAtMs: null,
          coverageStartedAtMs: spendStartedAt,
        }),
        readAt: "/dashboard/finance?tab=spend" as const,
      },
    };
  },
});

const SENT_MAIL_PAGE = 50;

/**
 * The sent-mail record itself — one bounded page of delivered messages.
 *
 * **DELIVERY IS PROVEN BY THE AUDIT ROW, NOT BY A MESSAGE ID.** The Microsoft arm returns 202 with
 * an empty body and deliberately records no provider message id, so a report that infers "not
 * delivered" from a missing id marks every Graph send as undelivered — which `plans.reportForPlan`
 * did until this plan corrected it. Existence of a `gmail.sent` OR `graph.sent` row is the proof;
 * whether an id came back is reported separately as `messageIdPresent`, because that is a fact
 * about the provider's response shape and not about delivery.
 *
 * Refs and counts only: the recipient address is a tenant-owned identifier and rides the row, but
 * `goal`, `draft`, `editedBody` and `safeText` never cross this boundary.
 */
export const sentMail = tenantQuery({
  args: { ...windowArgs, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const window = resolve(args);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? SENT_MAIL_PAGE), 1), SENT_MAIL_PAGE);
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("status", "sent")
          .gte("createdAt", window.sinceMs)
          .lt("createdAt", window.untilMs),
      )
      .order("desc")
      .take(limit + 1);
    const page = capped(rows, limit);

    const items = await Promise.all(
      page.counted.map(async (row) => {
        const proof = await ctx.db
          .query("audit")
          .withIndex("by_correlation", (q) => q.eq("correlationId", row.correlationId))
          .filter((q) =>
            q.or(
              q.eq(q.field("eventType"), "gmail.sent"),
              q.eq(q.field("eventType"), "graph.sent"),
            ),
          )
          .first();
        const messageId = (proof?.payload as { messageId?: string } | undefined)?.messageId;
        return {
          requestId: row._id,
          planId: row.planId ?? null,
          recipient: row.recipient,
          createdAt: row.createdAt,
          provider: row.mailProvider ?? ("google" as const),
          delivered: proof !== null,
          // A present-but-empty id is the Graph arm refusing to invent one — reported as absent
          // rather than as an empty string nobody can look up.
          messageIdPresent: typeof messageId === "string" && messageId.length > 0,
        };
      }),
    );

    return { window, items, bound: page.bound };
  },
});
