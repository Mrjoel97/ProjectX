// CASH adapter — the READ side of the business-finance plane, tenant-scoped.
//
// THIS MODULE IS A READER AND ONE WRITER. Every derivation lives in `@pikar/core`'s `cash.ts`
// (CLAUDE.md §1); re-deriving anything here would create a second, silently-drifting definition of
// the business's money — the exact drift that produced two separate selector bugs on 2026-08-09.
//
// EVERY SECTION IS ITS OWN QUERY, on purpose. A failing scorecard read must take out unit economics
// and leave solvency, activity and the whole Pikar-spend tab standing.
//
// NOTHING HERE IS LOGGED. A tenant's cash on hand, CAC and MRR are precisely what CLAUDE.md §4
// keeps out of the audit table. If you ever add an audit event to this module, log the field NAME
// and a boolean, never the value.
import {
  activityFromSends,
  CASH_INPUTS,
  type CashInputField,
  type CashInputState,
  cashInputSpec,
  createDashboardBound,
  needsConfirmation,
  validateCashInput,
} from "@pikar/core";
import type { Scorecard } from "@pikar/core/growth/index";
import { emptyScorecard } from "@pikar/core/growth/index";
import { v } from "convex/values";
import { applyScorecardAnswer, latestScorecardRow } from "./evaluations";
import { tenantMutation, tenantQuery } from "./lib/functions";

/** 31 days, matching the Cost console's reported window so the two tabs speak the same period. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
/** A bounded read. A tenant past this in one window has their count reported as a FLOOR. */
const SEND_SCAN_LIMIT = 1000;

export const activity = tenantQuery({
  args: { sinceMs: v.number(), untilMs: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.sinceMs) || !Number.isSafeInteger(args.untilMs)) {
      throw new Error("INVALID_WINDOW");
    }
    if (args.sinceMs >= args.untilMs) throw new Error("INVALID_WINDOW");
    if (args.untilMs - args.sinceMs > MAX_WINDOW_MS) throw new Error("INVALID_WINDOW");

    const rows = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("status", "sent")
          .gte("createdAt", args.sinceMs)
          .lt("createdAt", args.untilMs),
      )
      .take(SEND_SCAN_LIMIT + 1);

    // A window that fills the cap is UNDER-reported. `partial` says the count is a floor rather
    // than letting a quietly small number read as the truth (the finance.ts readWindow precedent).
    const partial = rows.length > SEND_SCAN_LIMIT;
    const counted = rows.slice(0, SEND_SCAN_LIMIT);

    return {
      activity: activityFromSends({
        sentAtMs: counted.map((row) => row.createdAt),
        sinceMs: args.sinceMs,
        nowMs: args.untilMs,
      }),
      bound: createDashboardBound({
        returned: counted.length,
        limit: SEND_SCAN_LIMIT,
        nextCursor: null,
        partial,
        ...(partial ? { partialReason: "row-cap" as const } : {}),
      }),
    };
  },
});

/** The closed field union, mirroring `CashInputField`. A widening is a deliberate edit here. */
const vCashField = v.union(
  v.literal("cashOnHand"),
  v.literal("monthlyOperatingCost"),
  v.literal("mrr"),
  v.literal("receivables"),
  v.literal("payables"),
  v.literal("cac"),
  v.literal("thirtyDayCashPerCustomer"),
  v.literal("grossProfitPerPurchase"),
  v.literal("purchasesPerLifetime"),
  v.literal("customerCount"),
  v.literal("referralPct"),
);
// Compile-time bind, both directions: a field added to `@pikar/core` but not to the validator (or
// the reverse) is a COMPILE error here rather than a silently unsaveable form row.
const _fieldToDoc: readonly (typeof vCashField.type)[] = CASH_INPUTS.map((s) => s.field);
const _docToField: readonly CashInputField[] = [] as (typeof vCashField.type)[];

/** A dot-path read over the Scorecard. Mirrors `evaluations.ts`'s `getPath` on the write side. */
function scorecardValue(scorecard: Scorecard, path: string): number | null {
  const value = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], scorecard);
  return typeof value === "number" ? value : null;
}

export const inputs = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ inputs: CashInputState[] }> => {
    const now = Date.now();
    const rows = await ctx.db
      .query("financeInputs")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const byField = new Map(rows.map((row) => [row.field, row]));
    const evaluation = await latestScorecardRow(ctx.db, ctx.tenantId);
    const scorecard = (evaluation?.scorecard as Scorecard | undefined) ?? emptyScorecard;

    return {
      inputs: CASH_INPUTS.map((spec): CashInputState => {
        if (spec.store === "financeInputs") {
          const row = byField.get(spec.field as (typeof rows)[number]["field"]);
          const value = row?.valueUsd ?? null;
          const statedAt = row?.statedAt ?? null;
          return {
            field: spec.field,
            value,
            statedAt,
            stale: needsConfirmation(value, statedAt, now),
          };
        }
        const value = spec.path === undefined ? null : scorecardValue(scorecard, spec.path);
        // `userProvidedAt` is a dot-path → epoch-ms map, stamped by `applyScorecardAnswer` and
        // carried forward UNCHANGED across every re-evaluation (`runEvaluation`) — unlike the
        // evaluation ROW's own `createdAt`, which is fresh on every carry-forward and is never a
        // field's stated time. A legacy row can hold a real value with no recorded stated time
        // (this field predates `userProvidedAt`, or a carried row's writer never stamped it);
        // `needsConfirmation` (the SAME predicate the `financeInputs` branch above and `cash.ts`'s
        // `statedFigure` both call — one definition, not three) treats that as needing confirmation,
        // never as fresh, and never fabricates a date.
        const statedAt =
          value === null ? null : (evaluation?.userProvidedAt?.[spec.path as string] ?? null);
        return {
          field: spec.field,
          value,
          statedAt,
          stale: needsConfirmation(value, statedAt, now),
        };
      }),
    };
  },
});

/**
 * ONE writer, routing by field to the store that owns the value.
 *
 * The Hormozi inputs go to the SCORECARD through `applyScorecardAnswer` — the same function
 * `recordScorecardAnswer` and the cockpit tool use, so a number entered in the panel and a number
 * given in conversation land in the same place and carry forward the same way. The finance-ops
 * inputs go to `financeInputs`. Nothing is written twice.
 *
 * The value is validated HERE and not only in the form: a form is a convenience, and this mutation
 * is the trust boundary. Nothing about it is logged (CLAUDE.md §4) — the value IS the sensitive part.
 */
export const saveInput = tenantMutation({
  args: { field: vCashField, value: v.number() },
  handler: async (ctx, { field, value }): Promise<{ saved: true }> => {
    const check = validateCashInput(field, value);
    if (!check.ok) throw new Error(`INVALID_INPUT: ${check.reason}`);
    const spec = cashInputSpec(field);

    if (spec.store === "scorecard") {
      if (spec.path === undefined) throw new Error("INVALID_INPUT: no scorecard path");
      const existing = await latestScorecardRow(ctx.db, ctx.tenantId);
      // No evaluation yet: seed under a stable, non-conversational thread id so the panel's answers
      // survive into the tenant's first real evaluation (the applyScorecardAnswer carrier path).
      await applyScorecardAnswer(
        ctx.db,
        ctx.tenantId,
        existing?.threadId ?? "finance-panel",
        spec.path,
        value,
      );
      return { saved: true };
    }

    const row = await ctx.db
      .query("financeInputs")
      .withIndex("by_tenant_field", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("field", field as "cashOnHand"),
      )
      .unique();
    const write = { valueUsd: value, statedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, write);
    else
      await ctx.db.insert("financeInputs", {
        tenantId: ctx.tenantId,
        field: field as "cashOnHand",
        ...write,
      });
    return { saved: true };
  },
});
