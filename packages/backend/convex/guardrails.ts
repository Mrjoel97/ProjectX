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

// ── The MEDIA rail (Phase 20, D10) ────────────────────────────────────────────────────
//
// A SECOND, NAMED pair of windows. Media spend NEVER moves the token budget and the token budget
// never moves media — in either direction. ADR-011 and D10 both say the rails do not share a
// window, and `dispatch.ts`'s ENVELOPE_FRACTION takes its 25% out of the LLM rail specifically, so
// folding media in would silently shrink every sub-agent envelope by up to 20x.
//
// D10 supersedes D4: the reserved unit is the whole JOB (clips + voice + captions STT + render)
// against MEDIA_JOB_CAP_USD = $3.50, not a per-request cap. $10/day is ~2 full 60 s reels.
export const MEDIA_DAILY_BUDGET_CENTS = 1_000; // $10/day PER TENANT.
// KEYLESS, and it exists for exactly the reason DEPLOYMENT_BUDGET_CENTS does: per-tenant keying
// alone makes exposure N x $10, unbounded in N, with the manual kill switch as the only global
// stop. 10,000 keeps the SAME 10x ratio the LLM ceiling holds over its per-tenant window — one
// ratio to remember across both rails. Worst-case daily exposure is now $100 media + $50 LLM,
// across four windows that never share. DO NOT remove this as redundant.
export const DEPLOYMENT_MEDIA_BUDGET_CENTS = 10_000; // $100/day across ALL tenants.

// ── The FOLDER-INGEST rail (Phase 15.3, VALT-06) ──────────────────────────────────────
//
// A THIRD named pair, and it exists for a defect rather than for symmetry. Until 15.3-03 the whole
// vault ingest path — `vaultIngest.ingestDoc`, `vaultExtract.extractDoc`, `vaultTranscribe` —
// spent `dailySpendCents`, i.e. THE COCKPIT'S $5. So a folder upload both starved the agent the
// user relies on for actual work AND could be refused halfway by an unrelated cockpit turn. A
// half-ingested folder is worse than a refused one, because the agent then grounds on it
// confidently without knowing what is missing. Separate rails are what make both impossible.
//
// $25/day is DELIBERATELY the largest of the three per-tenant windows: a folder upload is a bursty
// one-off onboarding-shaped event, not a daily habit, and the number is calibrated to the scanned-
// PDF OCR path and to nothing else (~$0.005/page x 50 pages/doc — 15.3-RESEARCH §1.4). Accepted
// consequence, owner decision: worst-case per-tenant daily exposure rises to $40.
export const INGEST_DAILY_BUDGET_CENTS = 2_500; // $25/day PER TENANT.
// KEYLESS, for the third time and for the same reason: per-tenant keying alone makes exposure
// N x $25, unbounded in N. 25,000 holds the SAME 10x ratio both existing rails hold.
export const DEPLOYMENT_INGEST_BUDGET_CENTS = 25_000; // $250/day across ALL tenants.

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-tenant submit rate (keyed by tenantId): steady 20/hr with a small burst of 5.
  submitRequest: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  // Per-TENANT daily spend window — every call site MUST pass { key: tenantId }. A call without
  // a key silently shares one bucket across tenants, which is the bug this replaced.
  dailySpendCents: { kind: "fixed window", rate: DAILY_BUDGET_CENTS, period: 24 * HOUR },
  // Deployment-wide ceiling. KEYLESS ON PURPOSE — this is the one bucket everybody shares, and
  // it is what stops N invited beta users from multiplying the bill.
  deploymentSpendCents: { kind: "fixed window", rate: DEPLOYMENT_BUDGET_CENTS, period: 24 * HOUR },
  // The media pair, same shapes, same keying rules, DIFFERENT money. `media.reserveJob` consumes
  // both with `reserve: true` BEFORE any fal request exists.
  mediaSpendCents: { kind: "fixed window", rate: MEDIA_DAILY_BUDGET_CENTS, period: 24 * HOUR },
  deploymentMediaSpendCents: {
    kind: "fixed window",
    rate: DEPLOYMENT_MEDIA_BUDGET_CENTS,
    period: 24 * HOUR,
  },
  // The INGEST pair (15.3-03) — the media pair's shape verbatim, third distinct money.
  //
  // `maxReserved` IS DELIBERATELY UNSET ON BOTH, and it looks like an omission. `validateRequest`
  // enforces `maxReserved` ONLY on the reserve path, so leaving it unset is precisely what lets
  // `limit({ reserve: true })` take a whole-folder reservation (and issue the negative-count
  // refund) regardless of count. Setting it "for safety" breaks the reservation.
  //
  // NEITHER IS SHARDED, including the keyless deployment one. Sharding would buy OCC throughput
  // for the ~36 concurrent `recordSpend` writers the OCR fan-out produces, but it costs two things
  // this rail cannot pay: `getValue` becomes a SAMPLED APPROXIMATION (and the pre-flight card
  // promises an honest "remaining" figure), and `limit()` picks a shard AT RANDOM — so the refund
  // clamp, which reads ONE value, could credit a shard that never paid and re-open the exact money
  // bug it exists to close. 15.3-RESEARCH §1.7 says the same thing from the pre-flight side. The
  // contention is not new either: those same writers already hit the unsharded `dailySpendCents` /
  // `deploymentSpendCents` today, so moving them here is not a regression.
  // ponytail: unsharded. Ceiling — OCC retries under a wide fan-out. Upgrade path if that is ever
  // MEASURED to bite: shard these two AND stop refunding the deployment window (or replace the
  // whole refund with a real spend table, which is `media.ts:279-282`'s stated upgrade path).
  ingestSpendCents: { kind: "fixed window", rate: INGEST_DAILY_BUDGET_CENTS, period: 24 * HOUR },
  deploymentIngestSpendCents: {
    kind: "fixed window",
    rate: DEPLOYMENT_INGEST_BUDGET_CENTS,
    period: 24 * HOUR,
  },
});

// Default-on-read: a missing guardrailConfig row means the kill switch is OFF
// (zero seed, no migration — Pitfall 7). budgetUsdPerRequest is the per-request cap.
// `mediaKillSwitch` is v.optional in the schema, so a row written before Phase 20 also reads OFF.
const DEFAULT_CONFIG = { killSwitch: false, budgetUsdPerRequest: 0.05, mediaKillSwitch: false };

/** Exported for `media.ts`, which must read BOTH switches inside its own reservation transaction
 *  (plan 20-04). Exported rather than duplicated: two config readers is two places to forget a
 *  switch. `media.reserveJob` is deliberately NOT here — a guard module inserting `mediaJobs` rows
 *  would be the wrong layering. */
export async function getGuardrailConfig(ctx: QueryCtx) {
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

/** Flip the MEDIA-only kill switch (MEDIA-01). Operator:
 *  `npx convex run guardrails:setMediaKillSwitch '{"on":true}'`. Same upsert as `setKillSwitch`.
 *
 *  The two switches are INDEPENDENT — flipping this one must not pause the email cockpit, and
 *  flipping the global one must not be the only way to pause paid generation. That independence is
 *  the point of a separate rail. But `media.reserveJob` checks BOTH: an all-stop is an all-stop. */
export const setMediaKillSwitch = internalMutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const row = await ctx.db.query("guardrailConfig").first();
    if (row) {
      await ctx.db.patch(row._id, { mediaKillSwitch: on, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("guardrailConfig", {
        killSwitch: DEFAULT_CONFIG.killSwitch,
        budgetUsdPerRequest: DEFAULT_CONFIG.budgetUsdPerRequest,
        mediaKillSwitch: on,
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

    const cfg = await getGuardrailConfig(ctx);
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
    const cfg = await getGuardrailConfig(ctx);
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

/**
 * The readable half of the MEDIA rail (MEDIA-01) — `remainingDailyCents`'s shape verbatim, over
 * the media pair. Reads without consuming.
 *
 * Each rail is clamped to >= 0 BEFORE the min for the same reason the LLM one is: `reserveJob`
 * consumes with `reserve: true`, so either window can go negative, and a negative deployment rail
 * would otherwise zero every tenant's remaining media budget.
 *
 * Explicit `Promise<number>` return type is mandatory — an inferred one collapses the generated
 * API to `any` (13-01 shipped 90 `apps/web` errors that way).
 */
/** The plain-function face, so a `tenantQuery` can read it — a Convex query cannot `runQuery`, and
 *  plan 20-09's `jobEstimate` must show today's remaining budget beside the estimate. The
 *  `reserveJobInner` / `reserveJob` split, for the same reason. */
export async function mediaRemainingCentsInner(
  ctx: QueryCtx,
  tenantId: string,
): Promise<number> {
  const tenant = Math.max(
    0,
    (await rateLimiter.getValue(ctx, "mediaSpendCents", { key: tenantId })).value,
  );
  const deployment = Math.max(
    0,
    (await rateLimiter.getValue(ctx, "deploymentMediaSpendCents")).value,
  );
  return Math.min(tenant, deployment);
}

export const mediaRemainingCents = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<number> =>
    await mediaRemainingCentsInner(ctx, tenantId),
});

/**
 * The readable half of the INGEST rail (VALT-06) — `mediaRemainingCentsInner`'s shape verbatim
 * over the ingest pair, and split into a plain function for the SAME reason: plan 15.3-07's
 * pre-flight card must show today's remaining folder budget beside the estimate, it reads it from
 * a `tenantQuery`, and a Convex query cannot `runQuery`.
 *
 * This is also the number the locked refusal copy interpolates — *"this folder needs ~$3.40; you
 * have $1.10 left today"* — so it must be HONEST, which is the other half of why neither ingest
 * window is sharded (a sharded `getValue` is a sample, not a figure you can put in a sentence).
 *
 * Each rail is clamped to >= 0 BEFORE the min: `recordSpend`/`reserveFolder` consume with
 * `reserve: true`, so either window can go negative, and a negative deployment rail would
 * otherwise zero every tenant's remaining ingest budget.
 */
export async function ingestRemainingCentsInner(ctx: QueryCtx, tenantId: string): Promise<number> {
  const tenant = Math.max(
    0,
    (await rateLimiter.getValue(ctx, "ingestSpendCents", { key: tenantId })).value,
  );
  const deployment = Math.max(
    0,
    (await rateLimiter.getValue(ctx, "deploymentIngestSpendCents")).value,
  );
  return Math.min(tenant, deployment);
}

/** Operator: `npx convex run guardrails:ingestRemainingCents '{"tenantId":"…"}'` — the ONE way to
 *  observe the cross-window refund, which no offline test can prove (see docs/playbooks/guardrails.md). */
export const ingestRemainingCents = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<number> =>
    await ingestRemainingCentsInner(ctx, tenantId),
});
