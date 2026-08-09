// FIN-01 Cost Console adapter — the READ side of the spend planes, plus the owner-only controls.
//
// TWO PLANES, AND THIS MODULE KEEPS THEM APART ON PURPOSE (docs/playbooks/dashboard-pages.md
// §"Finance ledger contract"):
//   • the rate limiter is ENFORCEMENT truth and answers "what is left RIGHT NOW" — a gauge of the
//     present that structurally cannot answer a question about last Tuesday;
//   • `spendEvents` is REPORTING truth and answers "what happened in this window" — a record that
//     structurally cannot tell you whether the next call will be refused.
// A projection that blends them produces a number that is neither. `summary` returns both, side by
// side and separately labelled, and never derives one from the other.
//
// THIS MODULE IS A READER. Every cap, correlation, rounding point and refund rule already lives in
// `guardrails.ts` / `media.ts` / `spendLedger.ts`; re-deriving any of them here would create a
// second, silently-drifting definition of money. Arithmetic lives in `@pikar/core` (CLAUDE.md §1).
//
// THE TENANT SURFACE EXPOSES NO DEPLOYMENT-GLOBAL STATE. `guardrails.remainingDailyCents` and its
// siblings return the MIN of the tenant window and the keyless deployment ceiling — correct for
// sizing an envelope, wrong here, because that minimum leaks the deployment's utilization to every
// tenant that can read it. The tenant rails below read the PERSONAL window only; the deployment
// ceilings are an `ownerQuery`.
import { calculateRateLimit, type RateLimitConfig } from "@convex-dev/rate-limiter";
import {
  aggregateSpend,
  createDashboardBound,
  resolveDashboardWindow,
  type SpendMovement,
  UNLANDED_RESOLVES,
} from "@pikar/core";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  DAILY_BUDGET_CENTS,
  DEPLOYMENT_BUDGET_CENTS,
  DEPLOYMENT_INGEST_BUDGET_CENTS,
  DEPLOYMENT_MEDIA_BUDGET_CENTS,
  getGuardrailConfig,
  INGEST_DAILY_BUDGET_CENTS,
  MEDIA_DAILY_BUDGET_CENTS,
  rateLimiter,
} from "./guardrails";
import { ownerMutation, ownerQuery, tenantQuery } from "./lib/functions";
import { coverageFor, listEventsFor, SPEND_EVENT_PAGE_LIMIT } from "./spendLedger";

/** 31 days: one calendar month of history, which is what the console reports. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEDGER_PAGE_LIMIT = 50;

/**
 * A per-request ceiling above the tenant's whole DAY is not a ceiling, so the maximum is derived
 * from `DAILY_BUDGET_CENTS` rather than typed as its own constant that can drift away from it.
 * The floor is a tenth of a cent — below that every model choice is refused and the control becomes
 * an accidental kill switch with no warning copy.
 */
const MIN_REQUEST_BUDGET_USD = 0.001;
const MAX_REQUEST_BUDGET_USD = DAILY_BUDGET_CENTS / 100;

type LimiterWindow = { value: number; ts: number; config: RateLimitConfig };

/**
 * One budget rail as a person can read it, ROLLED FORWARD to now.
 *
 * `getValue` returns the STORED state, not a roll-forward: its own `calculateRateLimit` call passes
 * `now = state.ts`, so a window that rolled overnight with nothing written since still reports
 * YESTERDAY'S drained value. `guardrails.refundableCents` already learned this the expensive way
 * (a live probe refunded 2900 against a capacity of 2500), and a Finance tile is the other place it
 * bites: a tenant who spent their day yesterday and has a full allowance today would be shown $0
 * left and no way to tell that from a real exhaustion. The roll-forward uses the component's OWN
 * exported `calculateRateLimit`, so a version bump moves this with it instead of desynchronising.
 *
 * `resetsAtMs` is the CURRENT window's end. It is an epoch instant labelled UTC and it is NOT
 * midnight anywhere: a fixed window with no `start` is anchored to the rail's first spend. The only
 * rails that do land on 00:00 UTC are ones nothing has ever spent from, whose stored `ts` is 0.
 */
function railView(rail: "reasoning" | "media" | "ingest", capCents: number, window: LimiterWindow) {
  const rolled = calculateRateLimit(
    { value: window.value, ts: window.ts },
    window.config,
    Date.now(),
  );
  // Clamped to [0, cap]: every consumer reserves with `reserve: true`, so a window can go NEGATIVE,
  // and a negative "remaining" is not a figure to put in front of a person.
  const remainingCents = Math.max(0, Math.min(capCents, Math.floor(rolled.value)));
  return {
    rail,
    remainingCents,
    capCents,
    usedCents: capCents - remainingCents,
    resetsAtMs: rolled.ts + window.config.period,
    /** The ENFORCEMENT clock. Deliberately separate from the window's display timezone. */
    resetTimeZone: "UTC" as const,
  };
}

/** The reported window's movements, plus whether the row cap truncated them. */
async function readWindow(ctx: QueryCtx, tenantId: string, sinceMs: number, untilMs: number) {
  const rows = await listEventsFor(ctx, { tenantId, sinceMs, untilMs });
  const movements: SpendMovement[] = rows.map((row) => ({
    rail: row.rail,
    phase: row.phase,
    amountCents: row.amountCents,
    correlationId: row.correlationId,
    ...(row.model === undefined ? {} : { model: row.model }),
    ...(row.kind === undefined ? {} : { kind: row.kind }),
  }));
  // A window that fills the cap is UNDER-reported, and a quietly small total is the exact lie this
  // whole subsystem exists to prevent. The playbook names the vocabulary: partial + "row-cap".
  const partial = rows.length >= SPEND_EVENT_PAGE_LIMIT;
  return {
    rows,
    movements,
    bound: createDashboardBound({
      returned: rows.length,
      limit: SPEND_EVENT_PAGE_LIMIT,
      nextCursor: null,
      partial,
      ...(partial ? { partialReason: "row-cap" as const } : {}),
    }),
  };
}

const windowArgs = {
  sinceMs: v.number(),
  untilMs: v.number(),
  /** Display only. Filtering and enforcement are epoch-ms and UTC; this never reaches a query. */
  browserTimeZone: v.string(),
};

/**
 * Just the coverage start, so a page can SIZE ITS WINDOW before asking for totals.
 *
 * Without this a console has to guess a window, discover from the answer that it began before
 * instrumentation, and then either re-ask or blank every real figure it already has. The 26-10 UAT
 * hit the second: a fixed 30-day window over a tenant covered since yesterday reported the whole
 * period `unknown` while the per-day series underneath it showed real money on a covered day. One
 * uncovered day at the start must not suppress the days we did observe.
 *
 * A caller that clamps its window to this value MUST say so on the page. The unclamped path stays
 * the default and stays correct: `aggregateSpend` still answers `unknown` for a window that really
 * does reach back before coverage, and a tenant with no coverage row at all still gets
 * `not-started`. What is forbidden is a SILENT clamp, which reports a confident total for a
 * narrower period than the one the reader asked for.
 */
export const coverage = tenantQuery({
  args: {},
  handler: async (ctx) => ({ coverageStartedAt: await coverageFor(ctx, ctx.tenantId) }),
});

/**
 * Live personal rails + the tracked history for one window.
 *
 * The two halves are returned SEPARATELY and are never combined: `rails` is what the limiter will
 * enforce on the next call, `tracked` is what the ledger observed. `tracked` can be
 * `coverage: "unknown"` while `rails` is perfectly known — that is not an inconsistency, it is the
 * difference between a gauge and a record.
 */
export const summary = tenantQuery({
  args: windowArgs,
  handler: async (ctx, args) => {
    const window = resolveDashboardWindow({
      sinceMs: args.sinceMs,
      untilMs: args.untilMs,
      maxSpanMs: MAX_WINDOW_MS,
      browserTimeZone: args.browserTimeZone,
    });

    const [reasoning, media, ingest] = await Promise.all([
      rateLimiter.getValue(ctx, "dailySpendCents", { key: ctx.tenantId }),
      rateLimiter.getValue(ctx, "mediaSpendCents", { key: ctx.tenantId }),
      rateLimiter.getValue(ctx, "ingestSpendCents", { key: ctx.tenantId }),
    ]);

    const coverageStartedAt = await coverageFor(ctx, ctx.tenantId);
    const { movements, bound } = await readWindow(
      ctx,
      ctx.tenantId,
      window.sinceMs,
      window.untilMs,
    );

    return {
      window,
      rails: [
        railView("reasoning", DAILY_BUDGET_CENTS, reasoning),
        railView("media", MEDIA_DAILY_BUDGET_CENTS, media),
        railView("ingest", INGEST_DAILY_BUDGET_CENTS, ingest),
      ],
      coverageStartedAt,
      // The window is passed through UNCLAMPED so `aggregateSpend` can say `window-precedes-
      // coverage`. Clamping it to the coverage start instead would turn an unknown stretch into a
      // silently shorter window that reports a confident, wrong total.
      tracked: aggregateSpend({
        movements,
        windowSinceMs: window.sinceMs,
        ...(coverageStartedAt === null ? {} : { coverageStartedAt }),
      }),
      /** Per rail, whether `unlanded` money can still resolve. Media's cannot — it never refunds. */
      unlandedResolves: UNLANDED_RESOLVES,
      bound,
    };
  },
});

/**
 * The same window, bucketed into UTC days.
 *
 * Each bucket is aggregated by the SAME `aggregateSpend` the totals use, so a bucket that starts
 * before coverage reports `unknown` on its own rather than inheriting the window's verdict — a
 * chart whose first bars are guesses is worse than one with a labelled gap.
 */
export const spendSeries = tenantQuery({
  args: windowArgs,
  handler: async (ctx, args) => {
    const window = resolveDashboardWindow({
      sinceMs: args.sinceMs,
      untilMs: args.untilMs,
      maxSpanMs: MAX_WINDOW_MS,
      browserTimeZone: args.browserTimeZone,
    });
    const coverageStartedAt = await coverageFor(ctx, ctx.tenantId);
    const { rows, movements, bound } = await readWindow(
      ctx,
      ctx.tenantId,
      window.sinceMs,
      window.untilMs,
    );

    // Buckets are aligned to the epoch, so every bucket boundary is a real 00:00 UTC.
    const firstBucket = Math.floor(window.sinceMs / DAY_MS) * DAY_MS;
    const buckets = [];
    for (let startMs = firstBucket; startMs < window.untilMs; startMs += DAY_MS) {
      const endMs = startMs + DAY_MS;
      const inBucket = movements.filter((_, index) => {
        const createdAt = rows[index]?.createdAt ?? -1;
        return createdAt >= startMs && createdAt < endMs;
      });
      buckets.push({
        startMs,
        endMs,
        ...aggregateSpend({
          movements: inBucket,
          // The bucket's own start, clamped up to the window: a bucket the window only partly
          // covers must not claim coverage of the hours before it.
          windowSinceMs: Math.max(startMs, window.sinceMs),
          ...(coverageStartedAt === null ? {} : { coverageStartedAt }),
        }),
      });
    }

    return { window, coverageStartedAt, buckets, bound };
  },
});

/**
 * The media job ledger, newest first.
 *
 * Convex's own cursor pagination is what makes equal `createdAt` values safe: the index cursor
 * carries the document id, so a page boundary that lands in the middle of a timestamp tie neither
 * repeats nor drops a row. A hand-rolled `createdAt` cursor cannot do that.
 */
export const mediaLedger = tenantQuery({
  args: { sinceMs: v.number(), untilMs: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.sinceMs) || !Number.isSafeInteger(args.untilMs)) {
      throw new Error("INVALID_WINDOW");
    }
    if (args.sinceMs >= args.untilMs) throw new Error("INVALID_WINDOW");
    const limit = Math.max(
      1,
      Math.min(LEDGER_PAGE_LIMIT, Math.floor(args.paginationOpts.numItems)),
    );

    const page = await ctx.db
      .query("spendEvents")
      .withIndex("by_tenant_rail_createdAt", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("rail", "media")
          .gte("createdAt", args.sinceMs)
          .lt("createdAt", args.untilMs),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: limit });

    const nextCursor = page.isDone ? null : page.continueCursor;
    const items = page.page.map((row) => ({
      id: row._id,
      createdAt: row.createdAt,
      phase: row.phase,
      amountCents: row.amountCents,
      currency: "USD" as const,
      correlationId: row.correlationId,
      mediaJobId: row.mediaJobId ?? null,
      model: row.model ?? null,
      kind: row.kind ?? null,
    }));

    return {
      items,
      nextCursor,
      /** Media over-reservation is PERMANENT — this rail has no refund path. Never call it pending. */
      unlandedResolves: UNLANDED_RESOLVES.media,
      bound: createDashboardBound({
        returned: items.length,
        limit,
        nextCursor,
        partial: nextCursor !== null,
        ...(nextCursor === null ? {} : { partialReason: "row-cap" as const }),
      }),
    };
  },
});

// ── OWNER-ONLY: the deployment plane ──────────────────────────────────────────────────
//
// Everything below is `ownerQuery`/`ownerMutation`, so a non-owner is rejected by the wrapper
// BEFORE the handler reads or writes anything. Hiding these controls in the UI is presentation;
// this is the trust boundary (lib/functions.ts).

/**
 * The three KEYLESS deployment ceilings, each read on its own.
 *
 * They are separate rails with separate money and separate randomised window offsets — a single
 * "global budget" number would be the sum of three things that refuse independently, and would be
 * wrong the moment one of them is the binding constraint.
 */
export const globalRails = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const [reasoning, media, ingest] = await Promise.all([
      rateLimiter.getValue(ctx, "deploymentSpendCents"),
      rateLimiter.getValue(ctx, "deploymentMediaSpendCents"),
      rateLimiter.getValue(ctx, "deploymentIngestSpendCents"),
    ]);
    return {
      rails: [
        railView("reasoning", DEPLOYMENT_BUDGET_CENTS, reasoning),
        railView("media", DEPLOYMENT_MEDIA_BUDGET_CENTS, media),
        railView("ingest", DEPLOYMENT_INGEST_BUDGET_CENTS, ingest),
      ],
    };
  },
});

/**
 * The stored control state, read through the SAME default-on-read `getGuardrailConfig` the
 * enforcement paths use. A separate reader here would let the console show a switch as OFF that
 * the guard reads as ON.
 *
 * `requiresConfirmation` is code-owned rather than a UI decision: all three controls change what
 * the whole deployment is allowed to spend, and the console must not be able to ship a one-click
 * version of that by forgetting a prop.
 */
export const controls = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const cfg = await getGuardrailConfig(ctx);
    const row = await ctx.db.query("guardrailConfig").first();
    return {
      masterKillSwitch: { on: cfg.killSwitch, requiresConfirmation: true as const },
      mediaKillSwitch: { on: cfg.mediaKillSwitch ?? false, requiresConfirmation: true as const },
      budgetUsdPerRequest: {
        usd: cfg.budgetUsdPerRequest,
        minUsd: MIN_REQUEST_BUDGET_USD,
        maxUsd: MAX_REQUEST_BUDGET_USD,
        requiresConfirmation: true as const,
      },
      /** Null means no row was ever written and every value above is the built-in default. */
      updatedAt: row?.updatedAt ?? null,
      /** A row has never existed: the state is the default, not something an operator chose. */
      stored: row !== null,
    };
  },
});

/**
 * The single upsert for every control, so the row can never be created with one field set and the
 * others missing. Merges over the EFFECTIVE config (`getGuardrailConfig`), which is what makes the
 * insert branch write the same defaults the read path would have returned.
 */
async function patchControls(
  ctx: MutationCtx,
  patch: { killSwitch?: boolean; mediaKillSwitch?: boolean; budgetUsdPerRequest?: number },
): Promise<void> {
  const cfg = await getGuardrailConfig(ctx);
  const row = await ctx.db.query("guardrailConfig").first();
  const next = {
    killSwitch: cfg.killSwitch,
    budgetUsdPerRequest: cfg.budgetUsdPerRequest,
    mediaKillSwitch: cfg.mediaKillSwitch ?? false,
    ...patch,
    updatedAt: Date.now(),
  };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("guardrailConfig", next);
}

/**
 * One audit row per ACCEPTED change, and none for a no-op.
 *
 * A no-op writes nothing on purpose (the `owner.bootstrapOwner` precedent): an event for a
 * transition that did not happen makes the log lie about when the deployment actually changed.
 * The payload is booleans, numbers and a code-owned control name — no identity, no email, no
 * session, nothing a person typed (CLAUDE.md §4).
 */
async function auditControl(
  ctx: MutationCtx,
  tenantId: string,
  control: string,
  from: boolean | number,
  to: boolean | number,
): Promise<void> {
  await ctx.runMutation(internal.audit.log, {
    tenantId,
    correlationId: `finance-control:${control}:${Date.now()}`,
    eventType: "finance.control.changed",
    actor: "owner",
    payload: { control, from, to },
  });
}

export const setMasterKillSwitch = ownerMutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const before = await getGuardrailConfig(ctx);
    const changed = before.killSwitch !== on;
    if (changed) {
      await patchControls(ctx, { killSwitch: on });
      await auditControl(ctx, ctx.tenantId, "master_kill_switch", before.killSwitch, on);
    }
    // The EFFECTIVE stored state, re-read. Echoing the argument back would report success for a
    // write that a concurrent transaction overwrote.
    const after = await getGuardrailConfig(ctx);
    return { changed, on: after.killSwitch };
  },
});

export const setMediaKillSwitch = ownerMutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const before = await getGuardrailConfig(ctx);
    const wasOn = before.mediaKillSwitch ?? false;
    const changed = wasOn !== on;
    if (changed) {
      await patchControls(ctx, { mediaKillSwitch: on });
      await auditControl(ctx, ctx.tenantId, "media_kill_switch", wasOn, on);
    }
    const after = await getGuardrailConfig(ctx);
    return { changed, on: after.mediaKillSwitch ?? false };
  },
});

export const setPerRequestBudget = ownerMutation({
  args: { budgetUsd: v.number() },
  handler: async (ctx, { budgetUsd }) => {
    // Trust-boundary validation, not laziness territory: this number is the ONLY thing standing
    // between one request and the whole day's allowance, and `chooseModel` compares against it
    // without re-checking. A NaN would make every comparison false and silently disable the cap.
    if (!Number.isFinite(budgetUsd)) throw new Error("INVALID_BUDGET");
    if (budgetUsd < MIN_REQUEST_BUDGET_USD || budgetUsd > MAX_REQUEST_BUDGET_USD) {
      throw new Error("INVALID_BUDGET");
    }
    // Tenth-of-a-cent granularity, normalized before storage so the stored value and the value the
    // owner sees are the same number.
    const budget = Math.round(budgetUsd * 1000) / 1000;

    const before = await getGuardrailConfig(ctx);
    const changed = before.budgetUsdPerRequest !== budget;
    if (changed) {
      await patchControls(ctx, { budgetUsdPerRequest: budget });
      await auditControl(
        ctx,
        ctx.tenantId,
        "per_request_budget_usd",
        before.budgetUsdPerRequest,
        budget,
      );
    }
    const after = await getGuardrailConfig(ctx);
    return { changed, budgetUsd: after.budgetUsdPerRequest };
  },
});
