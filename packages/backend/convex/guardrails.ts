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

// TWO spend rails, and the difference between them is the whole point (22.1-02).
//
// `DAILY_BUDGET_CENTS` is what ONE TENANT may spend per day. It was keyless until 22.1-02 —
// i.e. it capped the deployment, so one tenant's agent loop drained everyone else's day and
// every other tenant saw governed refusals it could not explain. That is a blocking bug for
// Phase 25 multi-user, and keying it by tenantId is the fix.
//
// `DEPLOYMENT_BUDGET_CENTS` exists because that fix alone trades a noisy-neighbour bug for a
// cost bug: per-tenant keying makes exposure N × DAILY_BUDGET_CENTS, unbounded in N, with the
// manual all-or-nothing kill switch as the only global stop. So the ceiling stays — deliberately
// KEYLESS — and both windows are checked and consumed. The tighter one wins. Owner decision,
// 2026-08-01.
export const DAILY_BUDGET_CENTS = 500; // ≈ $5/day PER TENANT.
export const DEPLOYMENT_BUDGET_CENTS = 5_000; // ≈ $50/day across ALL tenants — the hard cap.

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-tenant submit rate (keyed by tenantId): steady 20/hr with a small burst of 5.
  submitRequest: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  // Per-TENANT daily spend window — every call site MUST pass { key: tenantId }. A call without
  // a key silently shares one bucket across tenants, which is the bug this replaced.
  dailySpendCents: { kind: "fixed window", rate: DAILY_BUDGET_CENTS, period: 24 * HOUR },
  // Deployment-wide ceiling. KEYLESS ON PURPOSE — this is the one bucket everybody shares, and
  // it is what stops N invited beta users from multiplying the bill.
  deploymentSpendCents: { kind: "fixed window", rate: DEPLOYMENT_BUDGET_CENTS, period: 24 * HOUR },
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
          | "daily_budget_exhausted"
          | "deployment_budget_exhausted";
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

    // Check-before: the estimated spend must fit BOTH remaining windows — this tenant's own day
    // and the deployment ceiling. Tenant first, so a tenant that is personally out is told so
    // rather than being blamed for a global pause. `req.tenantId` is already on the row; that is
    // why `prepare` needs no new argument.
    const spend = await rateLimiter.check(ctx, "dailySpendCents", {
      key: req.tenantId,
      count: estCents,
    });
    if (!spend.ok) return { ok: false, reason: "daily_budget_exhausted" };
    const deployment = await rateLimiter.check(ctx, "deploymentSpendCents", { count: estCents });
    if (!deployment.ok) return { ok: false, reason: "deployment_budget_exhausted" };

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
  args: { tenantId: v.string() },
  handler: async (
    ctx,
    { tenantId },
  ): Promise<
    | { ok: true }
    | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" | "deployment_budget_exhausted" }
  > => {
    const cfg = await getConfig(ctx);
    if (cfg.killSwitch) return { ok: false, reason: "kill_switch" };
    // `count: 1` asks "is there ANY budget left", not "can I afford this call" — the real spend
    // is consumed after the fact by recordSpend. Both rails must still have room.
    const spend = await rateLimiter.check(ctx, "dailySpendCents", { key: tenantId, count: 1 });
    if (!spend.ok) return { ok: false, reason: "daily_budget_exhausted" };
    const deployment = await rateLimiter.check(ctx, "deploymentSpendCents", { count: 1 });
    if (!deployment.ok) return { ok: false, reason: "deployment_budget_exhausted" };
    return { ok: true };
  },
});

/** Consume ACTUAL model spend against the global daily window (GRDL-03). The spend
 *  already happened, so `reserve: true` drives the window negative rather than
 *  under-counting — the NEXT prepare/preCall check then fails closed. Zero-cost
 *  runs (ZERO_USAGE smoke) skip, so they never drain the budget. */
export const recordSpend = internalMutation({
  args: { tenantId: v.string(), costUsd: v.number() },
  handler: async (ctx, { tenantId, costUsd }) => {
    const cents = Math.ceil(costUsd * 100);
    if (cents <= 0) return;
    // BOTH rails, always. Consuming only one would let the other be drained without seeing it —
    // the tenant window would stop policing real spend, or the ceiling would never bind.
    await rateLimiter.limit(ctx, "dailySpendCents", { key: tenantId, count: cents, reserve: true });
    await rateLimiter.limit(ctx, "deploymentSpendCents", { count: cents, reserve: true });
  },
});

/**
 * The READABLE half of the daily-spend rail (Phase-15 DISP-01, Wave 0 — this file is FROZEN
 * after this commit). `getValue` reads utilization WITHOUT consuming tokens.
 * Clamped: recordSpend uses `reserve: true` so the window goes NEGATIVE rather than
 * under-counting, and a negative envelope is not an envelope — it would refuse everything.
 * The explicit `Promise<number>` return type is mandatory: an inferred return type collapses
 * the generated API to `any` (13-01 shipped 90 `apps/web` errors that way).
 *
 * 22.1-02: this now returns the TIGHTER of the two rails — a sub-agent envelope must not be sized
 * off a tenant's personal allowance when the deployment ceiling is what will actually refuse it.
 * Each rail is clamped to >= 0 BEFORE the min: `recordSpend` uses `reserve: true`, so either can
 * go negative, and a negative deployment rail would otherwise zero every tenant's envelope.
 */
export const remainingDailyCents = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<number> => {
    const tenant = Math.max(0, (await rateLimiter.getValue(ctx, "dailySpendCents", { key: tenantId })).value);
    const deployment = Math.max(0, (await rateLimiter.getValue(ctx, "deploymentSpendCents")).value);
    return Math.min(tenant, deployment);
  },
});
