// The guard choke point (GRDL-01/03/06). Every request passes `prepare` (Task 2)
// BEFORE any model call; `preCall` re-checks mid-flight; `recordSpend` consumes
// actual spend. Governed stops RETURN a discriminated result — they NEVER throw
// (an expected rejection is not a DLQ failure; 03-RESEARCH anti-pattern 1). Only
// bugs (a missing row) throw.
//
// internalMutation/internalQuery from ./_generated/server are NOT banned by the
// import guard (telemetry.ts precedent — no allowlist entry needed). This module
// touches ctx.db, so it must stay on the default runtime (no "use node").
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { chooseModel } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { contentHash } from "./lib/hash";

// ponytail: fixed constants for the single-owner beta; per-tenant policy is the
// upgrade path (deferred per 03-RESEARCH).
export const DAILY_BUDGET_CENTS = 500; // ≈ $5/day — the ONE daily-budget knob.

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-tenant submit rate (keyed by tenantId): steady 20/hr with a small burst of 5.
  submitRequest: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  // Global daily spend window (keyless = one bucket for the whole deployment).
  dailySpendCents: { kind: "fixed window", rate: DAILY_BUDGET_CENTS, period: 24 * HOUR },
});

// Default-on-read: a missing guardrailConfig row means the kill switch is OFF
// (zero seed, no migration — Pitfall 7). budgetUsdPerRequest is the per-request cap.
const DEFAULT_CONFIG = { killSwitch: false, budgetUsdPerRequest: 0.05 };

async function getConfig(ctx: QueryCtx) {
  return (await ctx.db.query("guardrailConfig").first()) ?? DEFAULT_CONFIG;
}

/** Flip the single-row kill switch (GRDL-06). Operator:
 *  `npx convex run guardrails:setKillSwitch '{"on":true}'`. Upsert — patch the
 *  one row if present, else insert with defaults. */
export const setKillSwitch = internalMutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const row = await ctx.db.query("guardrailConfig").first();
    if (row) {
      await ctx.db.patch(row._id, { killSwitch: on, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("guardrailConfig", {
        killSwitch: on,
        budgetUsdPerRequest: DEFAULT_CONFIG.budgetUsdPerRequest,
        updatedAt: Date.now(),
      });
    }
  },
});

/** The guard mutation (GRDL-01/03). One transactional, deterministic pass every
 *  request makes BEFORE any model call. EXPECTED rejections RETURN a discriminated
 *  governed stop (never a throw — a governed stop is not a DLQ failure); only bugs
 *  (a missing row) throw. On the ok path it persists the redacted goal + its hash
 *  (content plane — the raw goal already lives on this row). */
export const prepare = internalMutation({
  args: { requestId: v.id("requests") },
  handler: async (
    ctx,
    { requestId },
  ): Promise<
    | { ok: true; model: string; safeTextHash: string; piiCounts: Record<string, number>; estCents: number }
    | {
        ok: false;
        reason:
          | "kill_switch"
          | "pii_scan_failed"
          | "cost_estimate_failed"
          | "over_budget"
          | "daily_budget_exhausted";
      }
  > => {
    const req = await ctx.db.get(requestId);
    if (!req) throw new Error("guardrails.prepare: request not found"); // bug, not a governed stop

    const cfg = await getConfig(ctx);
    if (cfg.killSwitch) return { ok: false, reason: "kill_switch" };

    // Destructure ONLY safeText + counts — the scan's raw-PII field must never
    // appear in this file (CLAUDE.md §4; the 03-04 static scan enforces it).
    const scan = scanText(req.goal);
    if (!scan.ok) return { ok: false, reason: "pii_scan_failed" };
    const { safeText, counts } = scan.value;

    const safeTextHash = await contentHash(safeText);

    const choice = chooseModel(safeText, cfg.budgetUsdPerRequest);
    if (!choice.ok) {
      return {
        ok: false,
        reason: choice.error.code === "over_budget" ? "over_budget" : "cost_estimate_failed",
      };
    }
    const { model, estCents } = choice.value;

    // Check-before: the estimated spend must fit the remaining daily window.
    const spend = await rateLimiter.check(ctx, "dailySpendCents", { count: estCents });
    if (!spend.ok) return { ok: false, reason: "daily_budget_exhausted" };

    await ctx.db.patch(requestId, { safeText, safeTextHash });
    return { ok: true, model, safeTextHash, piiCounts: counts, estCents };
  },
});

/** The ONLY way model code reads a request's redacted text (GRDL-01). Throws
 *  (fail-closed) when the row is missing or safeText was never written — a model
 *  call structurally cannot obtain raw goal text. The message carries NO content. */
export const getSafeTextByHash = internalQuery({
  args: { tenantId: v.string(), safeTextHash: v.string() },
  handler: async (
    ctx,
    { tenantId, safeTextHash },
  ): Promise<{ safeText: string; lastInstruction: string | null }> => {
    const row = await ctx.db
      .query("requests")
      .withIndex("by_tenant_safeTextHash", (q) =>
        q.eq("tenantId", tenantId).eq("safeTextHash", safeTextHash),
      )
      .first();
    if (!row || row.safeText === undefined) {
      throw new Error("guardrails: safeText missing — redaction must precede any model call");
    }
    return { safeText: row.safeText, lastInstruction: row.lastInstruction ?? null };
  },
});

/** Persist the latest ALREADY-SCANNED regenerate instruction (content plane — the
 *  raw goal + safeText already live on this row). The draft wrapper scans the raw
 *  instruction and hands the redacted text here so draftUncached can recover it by
 *  hash-deterministic row lookup (getSafeTextByHash.lastInstruction). */
export const saveInstruction = internalMutation({
  args: { requestId: v.id("requests"), safeInstruction: v.string() },
  handler: async (ctx, { requestId, safeInstruction }) => {
    await ctx.db.patch(requestId, { lastInstruction: safeInstruction });
  },
});

/** Mid-flight re-check (GRDL-03/06): kill switch FIRST (component-free branch),
 *  then the global daily-spend window. Governed stops RETURN — SAME contract as
 *  `prepare`, NEVER a throw: the llm wrapper propagates `{ ok: false }` and the
 *  pipeline routes the stop into the SAME `blocked` terminal a prepare stop gets
 *  (never a `failed` DLQ entry). */
export const preCall = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" }> => {
    const cfg = await getConfig(ctx);
    if (cfg.killSwitch) return { ok: false, reason: "kill_switch" };
    const spend = await rateLimiter.check(ctx, "dailySpendCents", { count: 1 });
    if (!spend.ok) return { ok: false, reason: "daily_budget_exhausted" };
    return { ok: true };
  },
});

/** Consume ACTUAL model spend against the global daily window (GRDL-03). The spend
 *  already happened, so `reserve: true` drives the window negative rather than
 *  under-counting — the NEXT prepare/preCall check then fails closed. Zero-cost
 *  runs (ZERO_USAGE smoke) skip, so they never drain the budget. */
export const recordSpend = internalMutation({
  args: { costUsd: v.number() },
  handler: async (ctx, { costUsd }) => {
    const cents = Math.ceil(costUsd * 100);
    if (cents <= 0) return;
    await rateLimiter.limit(ctx, "dailySpendCents", { count: cents, reserve: true });
  },
});

/**
 * The READABLE half of the daily-spend rail (Phase-15 DISP-01, Wave 0 — this file is FROZEN
 * after this commit). `getValue` reads utilization WITHOUT consuming tokens.
 * Clamped: recordSpend uses `reserve: true` so the window goes NEGATIVE rather than
 * under-counting, and a negative envelope is not an envelope — it would refuse everything.
 * The explicit `Promise<number>` return type is mandatory: an inferred return type collapses
 * the generated API to `any` (13-01 shipped 90 `apps/web` errors that way).
 * ponytail: this is the DEPLOYMENT's remaining budget, not the tenant's — `dailySpendCents`
 * is a KEYLESS window (:23-28), matching the "fixed constants for the single-owner beta;
 * per-tenant policy is the upgrade path" comment already at :19-20. Keying the limit by
 * tenantId is the upgrade path and is NOT required by any Phase-15 success criterion.
 */
export const remainingDailyCents = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> =>
    Math.max(0, (await rateLimiter.getValue(ctx, "dailySpendCents")).value),
});
