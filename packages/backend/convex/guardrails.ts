// The guard choke point (GRDL-01/03/06). Every request passes `prepare` (Task 2)
// BEFORE any model call; `preCall` re-checks mid-flight; `recordSpend` consumes
// actual spend. Governed stops RETURN a discriminated result — they NEVER throw
// (an expected rejection is not a DLQ failure; 03-RESEARCH anti-pattern 1). Only
// bugs (a missing row) throw.
//
// internalMutation/internalQuery from ./_generated/server are NOT banned by the
// import guard (telemetry.ts precedent — no allowlist entry needed). This module
// touches ctx.db, so it must stay on the default runtime (no "use node").
import {
  calculateRateLimit,
  HOUR,
  type RateLimitConfig,
  RateLimiter,
} from "@convex-dev/rate-limiter";
import { chooseModel } from "@pikar/cost";
import {
  EVAL_BUDGET_LIFETIME_MS,
  EVAL_MAX_BUDGET_CENTS,
  evalActualCents,
  evalCallCeilingCents,
} from "@pikar/cost/evalBudget";
import { goldenProviderCeilingCents, goldenTavilyBilling } from "@pikar/cost/goldenProviderBudget";
import { scanText } from "@pikar/pii";
import { clampRefundCents, type EstimateInput, estimateFolderCents } from "@pikar/vault";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { probeControl } from "./authoringProbe";
import { dispatchWorkflowLive } from "./dispatchRun";
import { contentHash } from "./lib/hash";
// The PLAIN-FUNCTION half of the ledger writer, not `ctx.runMutation`: the limiter movement and
// its ledger row must commit or fail TOGETHER (FIN-01). A second transaction could leave the
// window moved with no record, and an append-only table has no backfill to repair that.
import { ensureCoverage, recordMovement } from "./spendLedger";

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
// 25.3 (G17): the deployment-wide ceilings are read from env at module load, with the compiled
// values as the fallbacks. Under the free-beta decision these ARE the spend ceiling, and moving one
// must not need a deploy. Literal `process.env.X` reads on purpose — `env.test.ts`'s manifest scan
// sees literals only. A value that is not a positive integer is ignored, never treated as zero.
export const envCents = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
export const DEPLOYMENT_BUDGET_CENTS = envCents(process.env.DEPLOYMENT_BUDGET_CENTS, 5_000); // ≈ $50/day across ALL tenants — the hard cap.

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
export const DEPLOYMENT_MEDIA_BUDGET_CENTS = envCents(
  process.env.DEPLOYMENT_MEDIA_BUDGET_CENTS,
  10_000,
); // $100/day across ALL tenants.

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
export const DEPLOYMENT_INGEST_BUDGET_CENTS = envCents(
  process.env.DEPLOYMENT_INGEST_BUDGET_CENTS,
  25_000,
); // $250/day across ALL tenants.

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-tenant submit rate (keyed by tenantId): steady 20/hr with a small burst of 5.
  submitRequest: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  // Per-TENANT daily spend window — every call site MUST pass { key: tenantId }. A call without
  // a key silently shares one bucket across tenants, which is the bug this replaced.
  dailySpendCents: { kind: "fixed window", rate: DAILY_BUDGET_CENTS, period: 24 * HOUR },
  // Deployment-wide ceiling. KEYLESS ON PURPOSE — this is the one bucket everybody shares, and
  // it is what stops N invited beta users from multiplying the bill.
  // ponytail: the three deployment windows are UNSHARDED. One counter row per window is honest to
  // ~10k users; past that, add `shards` here (@convex-dev/rate-limiter 0.3 supports it) knowing a
  // sharded fixed window is approximate — one hot tenant can be refused at cap/shards.
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
    | {
        ok: true;
        model: string;
        safeTextHash: string;
        piiCounts: Record<string, number>;
        estCents: number;
      }
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

    // FIN-01 coverage opens HERE, before any refusal can return. Reaching this gate is what makes
    // the tenant observable; a kill-switch stop is a CONFIDENT nothing, not an unknown.
    await ensureCoverage(ctx, req.tenantId, Date.now());

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

    // FIN-01: the ESTIMATE, on the OK path only — a governed stop is not a spend, and a refusal
    // that wrote a row would make every blocked request look like committed money.
    // The correlation is DERIVED, not minted: `prepare` is genuinely re-entered (the pipeline's
    // regenerate loop), and re-estimating one request is the same estimate, not a second one.
    if (estCents > 0) {
      await recordMovement(ctx, {
        tenantId: req.tenantId,
        rail: "reasoning",
        phase: "estimated",
        amountCents: estCents,
        correlationId: `req:${requestId}:prepare`,
        createdAt: Date.now(),
        requestId,
        model,
        kind: "prepare",
      });
    }

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
// ── THE RAIL SELECTOR (15.3-03, §B3) ──────────────────────────────────────────────────
//
// `rail` and `reserved` are OPTIONAL and that is MANDATORY, not stylistic: `preCall` and
// `recordSpend` have ~15 call sites across blueprint.ts, intake.ts, llm.ts, dispatch.ts, media.ts,
// voice.ts, voiceDoc.ts and the vault modules. A required argument would ripple through every one
// of them, and `dispatch.ts:365` sizing sub-agent envelopes off `remainingDailyCents` must keep
// reading the TOKEN window — folding another rail into it would silently resize every envelope.
//
// ABSENT ⇒ EXACTLY TODAY'S BEHAVIOUR, everywhere. Only folder ingest passes `rail: "ingest"`;
// folder-less single-file uploads deliberately stay on the token rail (15.3-CONTEXT puts only
// FOLDER ingest on the $25 window).
const vRail = v.optional(v.literal("ingest"));

// Evaluation is a bounded additional constraint over the SAME reasoning rails and spend ledger.
// A persisted start + explicit expiry prevents the fixed window from ever replenishing this cap.
export const openEvalBudget = internalMutation({
  args: {
    tenantIds: v.array(v.string()),
    capCents: v.number(),
    family: v.optional(v.literal("golden")),
    authoringProbe: v.optional(v.object({ threadId: v.string(), authorizationSha256: v.string() })),
  },
  handler: async (
    ctx,
    { tenantIds, capCents, family, authoringProbe },
  ): Promise<Id<"spendEvents">> => {
    if (family === "golden") {
      try {
        if (process.env.GOLDEN_OPENROUTER_BILLING !== "standard") throw new Error();
        goldenTavilyBilling(
          process.env.GOLDEN_TAVILY_BILLING,
          process.env.GOLDEN_TAVILY_CREDIT_USD,
        );
      } catch {
        throw new Error("GOLDEN_PROVIDER_BILLING_UNVERIFIED");
      }
    }
    if (!Number.isSafeInteger(capCents) || capCents < 1 || capCents > EVAL_MAX_BUDGET_CENTS)
      throw new Error("EVAL_BUDGET_INVALID");
    if (
      tenantIds.length < 1 ||
      tenantIds.length > 64 ||
      new Set(tenantIds).size !== tenantIds.length ||
      tenantIds.some((id) =>
        authoringProbe
          ? false
          : family === "golden"
            ? !/^eval-[a-f0-9]{8}(?:-[a-z0-9-]{1,24}-a[12])?$/.test(id) ||
              id.slice(0, 13) !== tenantIds[0]?.slice(0, 13)
            : !/^packeval-[a-f0-9]{8}-[a-z0-9-]{1,64}$/.test(id),
      )
    )
      throw new Error("EVAL_TENANT_REQUIRED");
    if (authoringProbe) {
      const userId = ctx.db.normalizeId("users", tenantIds[0] ?? "");
      const user = userId ? await ctx.db.get(userId) : null;
      const plan = await ctx.db
        .query("plans")
        .withIndex("by_thread", (q) =>
          q.eq("tenantId", tenantIds[0] as string).eq("threadId", authoringProbe.threadId),
        )
        .first();
      if (
        family !== "golden" ||
        tenantIds.length !== 1 ||
        !user?.owner ||
        !plan ||
        plan.status !== "collecting" ||
        plan.kind !== undefined ||
        !/^[a-f0-9]{64}$/.test(authoringProbe.authorizationSha256)
      )
        throw new Error("AUTHORING_PROBE_REGISTRATION_INVALID");
      const previous = await ctx.db
        .query("spendEvents")
        .withIndex("by_correlation", (q) =>
          q.eq("correlationId", `authoring-probe:${authoringProbe.authorizationSha256}`),
        )
        .first();
      const sameThread = await ctx.db
        .query("spendEvents")
        .withIndex("by_probe_thread", (q) =>
          q
            .eq("tenantId", tenantIds[0] as string)
            .eq("evalAuthoringProbe.threadId", authoringProbe.threadId),
        )
        .first();
      if (previous || sameThread) throw new Error("AUTHORING_PROBE_ALREADY_REGISTERED");
    }
    const now = Date.now();
    return recordMovement(ctx, {
      tenantId: tenantIds[0] as string,
      rail: "reasoning",
      phase: "estimated",
      amountCents: capCents,
      correlationId: authoringProbe
        ? `authoring-probe:${authoringProbe.authorizationSha256}`
        : `eval:${crypto.randomUUID()}`,
      createdAt: now,
      kind: "eval_envelope",
      evalEnvelope: { tenantIds, expiresAt: now + EVAL_BUDGET_LIFETIME_MS },
      ...(authoringProbe ? { evalAuthoringProbe: authoringProbe } : {}),
    });
  },
});

async function evalEnvelopeFor(ctx: QueryCtx, budgetId: Id<"spendEvents">, tenantId?: string) {
  const envelope = await ctx.db.get(budgetId);
  if (
    !envelope?.evalEnvelope ||
    envelope.kind !== "eval_envelope" ||
    envelope.phase !== "estimated" ||
    (tenantId !== undefined && !envelope.evalEnvelope.tenantIds.includes(tenantId))
  )
    throw new Error("EVAL_BUDGET_NOT_FOUND");
  const config = {
    kind: "fixed window" as const,
    rate: envelope.amountCents,
    capacity: envelope.amountCents,
    period: EVAL_BUDGET_LIFETIME_MS,
    start: envelope.createdAt,
  };
  return { envelope, config };
}

export const reserveEvalCall = internalMutation({
  args: {
    tenantId: v.string(),
    budgetId: v.id("spendEvents"),
    callId: v.string(),
    model: v.string(),
    outputTokens: v.number(),
    providerCall: v.optional(
      v.union(
        v.object({ kind: v.literal("chat"), model: v.string(), maxOutputTokens: v.number() }),
        v.object({
          kind: v.literal("embedding"),
          model: v.literal("openai/text-embedding-3-small"),
          inputCount: v.number(),
        }),
        v.object({ kind: v.literal("tavily-search"), depth: v.literal("basic") }),
        v.object({
          kind: v.literal("tavily-extract"),
          depth: v.literal("basic"),
          urlCount: v.number(),
        }),
      ),
    ),
  },
  handler: async (
    ctx,
    { tenantId, budgetId, callId, model, outputTokens, providerCall },
  ): Promise<Id<"spendEvents">> => {
    if (!/^[a-f0-9-]{36}$/.test(callId)) throw new Error("EVAL_CALL_ID_INVALID");
    const { envelope, config } = await evalEnvelopeFor(ctx, budgetId, tenantId);
    if (Date.now() >= (envelope.evalEnvelope?.expiresAt ?? 0))
      throw new Error("EVAL_BUDGET_EXPIRED");
    if ((await getGuardrailConfig(ctx)).killSwitch) throw new Error("EVAL_KILL_SWITCH");
    if (providerCall) {
      const expectedModel =
        providerCall.kind === "chat"
          ? providerCall.model
          : providerCall.kind === "embedding"
            ? `or/${providerCall.model}`
            : providerCall.kind;
      const expectedOutput = providerCall.kind === "chat" ? providerCall.maxOutputTokens : 0;
      if (model !== expectedModel || outputTokens !== expectedOutput)
        throw new Error("EVAL_PROVIDER_DESCRIPTOR_MISMATCH");
    }
    const amountCents = providerCall
      ? goldenProviderCeilingCents(providerCall)
      : evalCallCeilingCents(model, outputTokens);
    const correlationId = `evalcall:${callId}`;
    // Re-entry can never authorize another provider execution with a consumed reservation.
    if (
      await ctx.db
        .query("spendEvents")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .first()
    )
      throw new Error("EVAL_CALL_ALREADY_RESERVED");
    const rows = await ctx.db
      .query("spendEvents")
      .withIndex("by_eval_budget", (q) => q.eq("evalBudgetId", budgetId))
      .take(1501);
    if (rows.some((row) => row.kind === "eval_budget_closed"))
      throw new Error("EVAL_BUDGET_CLOSED");
    if (rows.some((row) => row.evalBreach)) throw new Error("EVAL_BUDGET_BREACHED");
    if (
      envelope.evalAuthoringProbe &&
      (await probeControl(ctx, budgetId)).some((row) => row.eventType === "authoring_probe.failed")
    )
      throw new Error("AUTHORING_PROBE_FAILED");
    // Each authorized call can later append an actual and a refund, even concurrently. Limit
    // CALLS, not current row count, so outstanding settlements can never overflow the status read.
    if (rows.length > 1500 || rows.filter((row) => row.phase === "reserved").length >= 500)
      throw new Error("EVAL_CALL_LIMIT");
    // Check all rails before moving any; the writes and ledger insert share this transaction.
    if (
      !(
        await rateLimiter.check(ctx, "evalBudgetCents", {
          key: String(budgetId),
          config,
          count: amountCents,
        })
      ).ok
    )
      throw new Error("EVAL_BUDGET_EXHAUSTED");
    if (
      !(await rateLimiter.check(ctx, "dailySpendCents", { key: tenantId, count: amountCents })).ok
    )
      throw new Error("EVAL_DAILY_BUDGET_EXHAUSTED");
    if (!(await rateLimiter.check(ctx, "deploymentSpendCents", { count: amountCents })).ok)
      throw new Error("EVAL_DEPLOYMENT_BUDGET_EXHAUSTED");
    await rateLimiter.limit(ctx, "evalBudgetCents", {
      key: String(budgetId),
      config,
      count: amountCents,
    });
    await rateLimiter.limit(ctx, "dailySpendCents", { key: tenantId, count: amountCents });
    await rateLimiter.limit(ctx, "deploymentSpendCents", { count: amountCents });
    return recordMovement(ctx, {
      tenantId,
      rail: "reasoning",
      phase: "reserved",
      amountCents,
      correlationId,
      model,
      kind: providerCall && providerCall.kind !== "chat" ? "eval_provider" : "eval_model",
      createdAt: Date.now(),
      evalBudgetId: budgetId,
    });
  },
});

export const settleEvalCall = internalMutation({
  args: {
    tenantId: v.string(),
    reservationId: v.id("spendEvents"),
    costUsd: v.number(),
    tavilyCredits: v.optional(v.number()),
  },
  handler: async (ctx, { tenantId, reservationId, costUsd, tavilyCredits }) => {
    const actualCents = evalActualCents(costUsd);
    const reservation = await ctx.db.get(reservationId);
    if (
      !reservation ||
      reservation.tenantId !== tenantId ||
      reservation.phase !== "reserved" ||
      !["eval_model", "eval_provider"].includes(reservation.kind ?? "") ||
      !reservation.evalBudgetId
    )
      throw new Error("EVAL_RESERVATION_NOT_FOUND");
    const { envelope, config } = await evalEnvelopeFor(ctx, reservation.evalBudgetId, tenantId);
    const siblings = await ctx.db
      .query("spendEvents")
      .withIndex("by_correlation", (q) => q.eq("correlationId", reservation.correlationId))
      .take(4);
    const settled = siblings.find((row) => row.evalActualUsd !== undefined);
    if (settled) {
      if (settled.evalActualUsd !== costUsd || settled.evalTavilyCredits !== tavilyCredits)
        throw new Error("EVAL_SETTLEMENT_MISMATCH");
      return { actualUsd: costUsd, settled: true, breached: settled.evalBreach === true };
    }
    const isTavily = ["tavily-search", "tavily-extract"].includes(reservation.model ?? "");
    if (
      isTavily
        ? tavilyCredits === undefined ||
          !Number.isFinite(tavilyCredits) ||
          tavilyCredits < 0 ||
          tavilyCredits > Number.MAX_SAFE_INTEGER
        : tavilyCredits !== undefined
    )
      throw new Error("EVAL_PROVIDER_USAGE_INVALID");
    // Preserve a known provider-contract breach in the bill. Throwing here would roll back the
    // observed actual cost. The action throws AFTER this commits; all later reservations stop.
    const breached = actualCents > reservation.amountCents;
    if (breached) {
      const debt = actualCents - reservation.amountCents;
      await rateLimiter.limit(ctx, "dailySpendCents", {
        key: tenantId,
        count: debt,
        reserve: true,
      });
      await rateLimiter.limit(ctx, "deploymentSpendCents", { count: debt, reserve: true });
      if (Date.now() < (envelope.evalEnvelope?.expiresAt ?? 0))
        await rateLimiter.limit(ctx, "evalBudgetCents", {
          key: String(reservation.evalBudgetId),
          config,
          count: debt,
          reserve: true,
        });
    }
    const refund = reservation.amountCents - actualCents;
    if (refund > 0) {
      if (Date.now() < (envelope.evalEnvelope?.expiresAt ?? 0))
        await rateLimiter.limit(ctx, "evalBudgetCents", {
          key: String(reservation.evalBudgetId),
          config,
          count: -refund,
          reserve: true,
        });
      const tenantWindow = await rateLimiter.getValue(ctx, "dailySpendCents", { key: tenantId });
      const deploymentWindow = await rateLimiter.getValue(ctx, "deploymentSpendCents");
      const tenantRefund = refundableCents(tenantWindow, refund, reservation.createdAt);
      const deploymentRefund = refundableCents(deploymentWindow, refund, reservation.createdAt);
      if (tenantRefund > 0)
        await rateLimiter.limit(ctx, "dailySpendCents", {
          key: tenantId,
          count: -tenantRefund,
          reserve: true,
        });
      if (deploymentRefund > 0)
        await rateLimiter.limit(ctx, "deploymentSpendCents", {
          count: -deploymentRefund,
          reserve: true,
        });
      // Evaluation reservation reconciliation, even when a daily enforcement window has rolled.
      await recordMovement(ctx, {
        tenantId,
        rail: "reasoning",
        phase: "refunded",
        amountCents: refund,
        correlationId: reservation.correlationId,
        model: reservation.model,
        kind: reservation.kind,
        createdAt: Date.now(),
        evalBudgetId: reservation.evalBudgetId,
        ...(actualCents === 0
          ? {
              evalActualUsd: costUsd,
              ...(tavilyCredits === undefined ? {} : { evalTavilyCredits: tavilyCredits }),
            }
          : {}),
      });
    }
    if (actualCents > 0)
      await recordMovement(ctx, {
        tenantId,
        rail: "reasoning",
        phase: "actual",
        amountCents: actualCents,
        correlationId: reservation.correlationId,
        model: reservation.model,
        kind: reservation.kind,
        createdAt: Date.now(),
        evalBudgetId: reservation.evalBudgetId,
        evalActualUsd: costUsd,
        ...(tavilyCredits === undefined ? {} : { evalTavilyCredits: tavilyCredits }),
        ...(breached ? { evalBreach: true } : {}),
      });
    return { actualUsd: costUsd, settled: true, breached };
  },
});

export const evalBudgetStatus = internalQuery({
  args: { budgetId: v.id("spendEvents") },
  handler: async (ctx, { budgetId }) => {
    const { envelope, config } = await evalEnvelopeFor(ctx, budgetId);
    const rows = await ctx.db
      .query("spendEvents")
      .withIndex("by_eval_budget", (q) => q.eq("evalBudgetId", budgetId))
      .take(1502);
    if (rows.length > 1501) throw new Error("EVAL_LEDGER_LIMIT");
    const reserved = rows.filter((row) => row.phase === "reserved");
    const settled = rows.filter((row) => row.evalActualUsd !== undefined);
    const settledIds = new Set(settled.map((row) => row.correlationId));
    const outstanding = reserved.filter((row) => !settledIds.has(row.correlationId));
    const expired = Date.now() >= (envelope.evalEnvelope?.expiresAt ?? 0);
    const window = await rateLimiter.getValue(ctx, "evalBudgetCents", {
      key: String(budgetId),
      config,
    });
    return {
      budgetId,
      closed: rows.some((row) => row.kind === "eval_budget_closed"),
      capCents: envelope.amountCents,
      expired,
      breached: rows.some((row) => row.evalBreach === true),
      remainingCents: expired ? 0 : Math.max(0, Math.floor(window.value)),
      actualUsd: settled.reduce((sum, row) => sum + (row.evalActualUsd ?? 0), 0),
      callCount: reserved.length,
      settledCount: settled.length,
      unsettledCount: outstanding.length,
      unresolvedCents: outstanding.reduce((sum, row) => sum + row.amountCents, 0),
    };
  },
});

/** Terminal append-only closure; races with new reservations serialize on the same budget index. */
export const closeEvalBudget = internalMutation({
  args: { budgetId: v.id("spendEvents") },
  handler: async (ctx, { budgetId }) => {
    const { envelope } = await evalEnvelopeFor(ctx, budgetId);
    const rows = await ctx.db
      .query("spendEvents")
      .withIndex("by_eval_budget", (q) => q.eq("evalBudgetId", budgetId))
      .take(1502);
    if (rows.length > 1501) throw new Error("EVAL_LEDGER_LIMIT");
    if (rows.some((row) => row.kind === "eval_budget_closed")) return { budgetId, closed: true };
    const settled = new Set(
      rows.filter((row) => row.evalActualUsd !== undefined).map((row) => row.correlationId),
    );
    if (
      rows.some(
        (row) => row.evalBreach || (row.phase === "reserved" && !settled.has(row.correlationId)),
      )
    )
      throw new Error("EVAL_BUDGET_NOT_SETTLED");
    // Golden runs own isolated tenants. A settled ledger alone does not prove completion:
    // a queued dispatch/variant or ingest step may not have reserved its first call yet.
    // Read the durable tenant state in this closing transaction so staging cannot race it.
    // Vertical fixed-source runs retain their separate receipt-driven closure protocol.
    if (envelope.evalAuthoringProbe) {
      const control = await probeControl(ctx, budgetId);
      const started = control.filter((row) => row.eventType === "authoring_probe.started");
      const finished = control.filter(
        (row) =>
          row.eventType === "authoring_probe.finished" ||
          row.eventType === "authoring_probe.failed",
      );
      if (
        started.some((row) => !finished.some((done) => done.payload.turnId === row.payload.turnId))
      )
        throw new Error("AUTHORING_PROBE_TURN_UNRESOLVED");
    }
    if (envelope.evalAuthoringProbe) {
      const probeThreadId = envelope.evalAuthoringProbe.threadId;
      const plans = await ctx.db
        .query("plans")
        .withIndex("by_thread", (q) =>
          q.eq("tenantId", envelope.tenantId).eq("threadId", probeThreadId),
        )
        .take(33);
      if (plans.length > 32) throw new Error("AUTHORING_PROBE_GRAPH_LIMIT");
      for (const plan of plans)
        if (
          (plan.kind === "memo" && plan.status === "collecting") ||
          (plan.workflowId && (await dispatchWorkflowLive(ctx, plan.workflowId)) !== false)
        )
          throw new Error("AUTHORING_PROBE_GRAPH_NOT_SETTLED");
    }
    if (envelope.tenantId.startsWith("eval-")) {
      const evaluation = envelope.evalEnvelope;
      if (!evaluation) throw new Error("EVAL_BUDGET_NOT_FOUND");
      let planCount = 0;
      let docCount = 0;
      for (const tenantId of evaluation.tenantIds) {
        const plans = await ctx.db
          .query("plans")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .take(257 - planCount);
        planCount += plans.length;
        if (planCount > 256) throw new Error("GOLDEN_GRAPH_SCAN_LIMIT");
        for (const plan of plans) {
          if (plan.kind === "memo" && plan.status === "collecting")
            throw new Error("GOLDEN_GRAPH_NOT_SETTLED");
          if (plan.workflowId && (await dispatchWorkflowLive(ctx, plan.workflowId)) !== false)
            throw new Error("GOLDEN_GRAPH_NOT_SETTLED");
        }
        // Vault documents may contain large text; keep the entire run below 32 reads.
        const docs = await ctx.db
          .query("vaultDocuments")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .take(33 - docCount);
        docCount += docs.length;
        if (docCount > 32) throw new Error("GOLDEN_GRAPH_SCAN_LIMIT");
        if (docs.some((doc) => doc.evalBudgetId === budgetId && doc.status !== "ready"))
          throw new Error("GOLDEN_GRAPH_NOT_SETTLED");
      }
    }
    await ctx.db.insert("spendEvents", {
      tenantId: envelope.tenantId,
      rail: "reasoning",
      phase: "adjustment",
      amountCents: 0,
      correlationId: `evalclosed:${budgetId}`,
      kind: "eval_budget_closed",
      evalBudgetId: budgetId,
      createdAt: Date.now(),
    });
    return { budgetId, closed: true };
  },
});

export const preCall = internalMutation({
  args: { tenantId: v.string(), rail: vRail, reserved: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { tenantId, rail, reserved },
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: "kill_switch" | "daily_budget_exhausted" | "deployment_budget_exhausted";
      }
  > => {
    // FIN-01: the gate itself is the moment we start watching this tenant (see ensureCoverage).
    await ensureCoverage(ctx, tenantId, Date.now());
    const cfg = await getGuardrailConfig(ctx);
    if (cfg.killSwitch) return { ok: false, reason: "kill_switch" };

    // RESERVED FOLDER WORK CHECKS THE KILL SWITCH ONLY, and this is the whole "a folder can never
    // be refused halfway" guarantee. The money was already taken by `reserveFolder`, so checking
    // the ingest window here would refuse the run precisely when its OWN reservation drove that
    // window to 0. The kill switch still binds because an all-stop is an all-stop.
    if (rail === "ingest" && reserved === true) return { ok: true };

    // Unreserved ingest work (nothing routes here today — a future Drive probe would) still pays
    // the normal two-window check, just on the ingest pair. The reason CODES are shared with the
    // token rail on purpose: they mean the same thing to the caller, and minting parallel codes
    // would widen three call sites' explicit return unions for no behavioural gain.
    const [tenantRail, deploymentRail] =
      rail === "ingest"
        ? (["ingestSpendCents", "deploymentIngestSpendCents"] as const)
        : (["dailySpendCents", "deploymentSpendCents"] as const);

    // `count: 1` asks "is there ANY budget left", not "can I afford this call" — the real spend
    // is consumed after the fact by recordSpend. Both rails must still have room.
    const spend = await rateLimiter.check(ctx, tenantRail, { key: tenantId, count: 1 });
    if (!spend.ok) return { ok: false, reason: "daily_budget_exhausted" };
    const deployment = await rateLimiter.check(ctx, deploymentRail, { count: 1 });
    if (!deployment.ok) return { ok: false, reason: "deployment_budget_exhausted" };
    return { ok: true };
  },
});

/** Consume ACTUAL model spend against the global daily window (GRDL-03). The spend
 *  already happened, so `reserve: true` drives the window negative rather than
 *  under-counting — the NEXT prepare/preCall check then fails closed. Zero-cost
 *  runs (ZERO_USAGE smoke) skip, so they never drain the budget. */
export const recordSpend = internalMutation({
  args: {
    tenantId: v.string(),
    costUsd: v.number(),
    rail: vRail,
    // FIN-01, ALL OPTIONAL — this mutation has ~15 call sites and a required argument would ripple
    // through every one of them (the same reasoning that made `rail` optional, five lines up).
    //
    // ABSENT `correlationId` ⇒ a per-execution nonce, and that is the SAFE default here rather
    // than a gap. Every one of these callers is an ACTION: re-entering it re-runs the model call,
    // so the second charge is real money and MUST get its own row. A correlation derived from refs
    // would collapse a retry, a fallback model or a per-page fan-out into one row — the ledger
    // would then sit BELOW the limiter, which is the unrecoverable direction (a duplicate is
    // findable by reconciling against the limiter; a missing movement is indistinguishable from
    // money never spent). A caller that is genuinely REPLAYABLE — a journaled workflow step, a
    // webhook landing — passes its own stable correlation and gets replay suppression.
    correlationId: v.optional(v.string()),
    model: v.optional(v.string()),
    kind: v.optional(v.string()),
    requestId: v.optional(v.id("requests")),
    planId: v.optional(v.id("plans")),
    folderId: v.optional(v.id("vaultFolders")),
  },
  handler: async (ctx, { tenantId, costUsd, rail, ...ref }) => {
    const cents = Math.ceil(costUsd * 100);
    if (cents <= 0) return;
    // The rail selector applies HERE regardless of `reserved`: folder work skips the ingest CHECK
    // (it is pre-paid) but its actual spend must still MOVE the ingest window, or the reservation
    // would be released against a window that never recorded what the folder really cost.
    const [tenantRail, deploymentRail] =
      rail === "ingest"
        ? (["ingestSpendCents", "deploymentIngestSpendCents"] as const)
        : (["dailySpendCents", "deploymentSpendCents"] as const);
    // BOTH rails, always. Consuming only one would let the other be drained without seeing it —
    // the tenant window would stop policing real spend, or the ceiling would never bind.
    await rateLimiter.limit(ctx, tenantRail, { key: tenantId, count: cents, reserve: true });
    await rateLimiter.limit(ctx, deploymentRail, { count: cents, reserve: true });

    // SAME TRANSACTION, SAME `cents`. The two planes are arithmetically incapable of disagreeing
    // about the amount because there is one variable and one commit — a re-derived `Math.round`
    // here would drift below the limiter on every sub-cent call and, at 0, be refused outright.
    await recordMovement(ctx, {
      tenantId,
      rail: rail === "ingest" ? "ingest" : "reasoning",
      phase: "actual",
      amountCents: cents,
      correlationId: ref.correlationId ?? `auto:${crypto.randomUUID()}`,
      createdAt: Date.now(),
      requestId: ref.requestId,
      planId: ref.planId,
      folderId: ref.folderId,
      model: ref.model,
      kind: ref.kind,
    });
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
    const tenant = Math.max(
      0,
      (await rateLimiter.getValue(ctx, "dailySpendCents", { key: tenantId })).value,
    );
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
export async function mediaRemainingCentsInner(ctx: QueryCtx, tenantId: string): Promise<number> {
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

// ── RESERVE / SETTLE: the whole-folder budget wall (VALT-06) ───────────────────────────
//
// THE INVARIANT, in one sentence: estimate and reserve for the WHOLE folder before the first
// cent, or refuse the folder intact. A half-ingested folder is worse than a refused one.

/** Every way a folder can be refused BEFORE a cent moves. Distinct codes because they send the
 *  user to distinct levers: pause the operator, drop files, or wait for tomorrow. */
export type FolderReserveRefusal =
  | "kill_switch"
  | "over_folder_cap"
  | "over_deployment_cap"
  | "ingest_daily_exhausted"
  | "deployment_ingest_exhausted";

/**
 * REFS, IDS AND COUNTS ONLY — no filenames, no mime types, no text. The refusal is meant to be
 * written straight into `audit.log` as-is (CLAUDE.md §3/§4), and it is also the payload the locked
 * refusal copy interpolates: *"this folder needs ~$3.40; you have $1.10 left today."*
 */
export type FolderReserveResult =
  | {
      ok: true;
      estCents: number;
      remainingCents: number;
      reservedAt: number;
      fileCount: number;
      totalBytes: number;
    }
  | {
      ok: false;
      reason: FolderReserveRefusal;
      estCents: number;
      remainingCents: number;
      shortfallCents: number;
      fileCount: number;
      totalBytes: number;
    };

/** The manifest a reservation is derived FROM. Deliberately mirrors `EstimateInput` and nothing
 *  else — a filename would be content in an audit payload, and a client-supplied cost would be a
 *  number the client controls. */
export const vFileManifest = v.array(
  v.object({
    size: v.number(),
    mimeType: v.string(),
    pages: v.optional(v.number()),
    hasTextLayer: v.optional(v.boolean()),
    durationSec: v.optional(v.number()),
  }),
);

/**
 * Reserve a WHOLE folder. Returns a governed refusal — it NEVER throws for an expected stop.
 *
 * `media.reserveJobInner`'s ORDER, clone for clone, because every step of it is load-bearing:
 *
 *  1. Kill switch first (the component-free branch).
 *  2. **Re-derive `estCents` from the manifest.** The pre-flight card computed a number too; that
 *     number is a CARD, never an input. Trusting it would make the budget wall client-side.
 *  3. **The ceiling comparison PRECEDES every limiter call.** `check()` does not return
 *     `{ok:false}` above capacity — `validateRequest` THROWS `Rate limit ingestSpendCents count
 *     3000 exceeds 2500`. Without this ordering the locked plain-language refusal is a stack trace.
 *     `media.ts` never hits this only because `MEDIA_JOB_CAP_USD` sits below its own window.
 *  4. **CHECK BOTH WINDOWS, THEN CONSUME BOTH, IN THIS ONE MUTATION** — which is ONE serializable
 *     transaction. Split the check from the limit and two concurrent folders both pass a check
 *     against a window neither has consumed yet.
 *
 * Plain function first (the `reserveJobInner` split) so plan 15.3-04's folder-create mutation can
 * take the reservation in the SAME transaction as the `vaultFolders` insert — a Convex mutation
 * cannot `runMutation`, and a reservation in a different transaction from the row that records it
 * is a reservation that can leak.
 *
 * THE CALLER MUST PERSIST `reservedAt` ON THE FOLDER ROW. `settleFolder` refuses to refund without
 * it (see there) — forgetting it costs the tenant money rather than manufacturing it, which is the
 * direction this rail always fails in.
 */
export async function reserveFolderInner(
  ctx: MutationCtx,
  // `folderId` is OPTIONAL and is used ONLY for the ledger row's correlation and typed ref. Absent
  // ⇒ no ledger row, the `vRail` convention in this file — a reservation whose folder we cannot
  // name is one settle can never match, and an unmatchable reserved row would sit as permanent
  // phantom `unlanded` money on the Finance page.
  a: { tenantId: string; files: EstimateInput[]; folderId?: Id<"vaultFolders"> },
): Promise<FolderReserveResult> {
  const fileCount = a.files.length;
  const totalBytes = a.files.reduce((s, f) => s + Math.max(0, f.size), 0);

  // FIN-01: watching starts at the gate, not at the money (see ensureCoverage).
  await ensureCoverage(ctx, a.tenantId, Date.now());

  const cfg = await getGuardrailConfig(ctx);
  // estCents/remainingCents are 0 here because the kill switch stops BEFORE pricing. The reason
  // discriminates, and kill-switch copy never names a figure.
  if (cfg.killSwitch) {
    return {
      ok: false,
      reason: "kill_switch",
      estCents: 0,
      remainingCents: 0,
      shortfallCents: 0,
      fileCount,
      totalBytes,
    };
  }

  const { estCents } = estimateFolderCents(a.files);
  const remainingCents = await ingestRemainingCentsInner(ctx, a.tenantId);
  const shortfallCents = Math.max(0, estCents - remainingCents);
  const refuse = (reason: FolderReserveRefusal): FolderReserveResult => ({
    ok: false,
    reason,
    estCents,
    remainingCents,
    shortfallCents,
    fileCount,
    totalBytes,
  });

  // 3. THE CEILINGS, BEFORE THE LIMITER. The deployment branch looks unreachable while
  //    INGEST_DAILY_BUDGET_CENTS < DEPLOYMENT_INGEST_BUDGET_CENTS — it is not: it is what keeps
  //    the refusal governed if the two constants are ever edited out of that relationship.
  if (estCents > INGEST_DAILY_BUDGET_CENTS) return refuse("over_folder_cap");
  if (estCents > DEPLOYMENT_INGEST_BUDGET_CENTS) return refuse("over_deployment_cap");

  // 4. Tenant FIRST, so a tenant that is personally out is told so rather than blamed for a global
  //    pause (the `prepare` / `reserveJobInner` ordering, verbatim).
  const tenantWindow = await rateLimiter.check(ctx, "ingestSpendCents", {
    key: a.tenantId,
    count: estCents,
  });
  if (!tenantWindow.ok) return refuse("ingest_daily_exhausted");
  const deploymentWindow = await rateLimiter.check(ctx, "deploymentIngestSpendCents", {
    count: estCents,
  });
  if (!deploymentWindow.ok) return refuse("deployment_ingest_exhausted");

  await rateLimiter.limit(ctx, "ingestSpendCents", {
    key: a.tenantId,
    count: estCents,
    reserve: true,
  });
  await rateLimiter.limit(ctx, "deploymentIngestSpendCents", { count: estCents, reserve: true });

  // ONE instant, used for BOTH the returned stamp and the correlation. `settleFolder` rebuilds
  // this exact string from `folder.reservedAt` to find its own reservation, so a second
  // `Date.now()` here would silently orphan every refund.
  const reservedAt = Date.now();
  if (a.folderId !== undefined && estCents > 0) {
    await recordMovement(ctx, {
      tenantId: a.tenantId,
      rail: "ingest",
      phase: "reserved",
      amountCents: estCents,
      correlationId: `f:${a.folderId}:${reservedAt}`,
      createdAt: reservedAt,
      folderId: a.folderId,
      kind: "folder_reserve",
    });
  }

  return { ok: true, estCents, remainingCents, reservedAt, fileCount, totalBytes };
}

/** The `internalMutation` face of `reserveFolderInner`, for tests and for any caller that is not
 *  already inside a mutation. 15.3-04's folder-create path calls the Inner directly. */
export const reserveFolder = internalMutation({
  args: {
    tenantId: v.string(),
    files: vFileManifest,
    folderId: v.optional(v.id("vaultFolders")),
  },
  handler: async (ctx, a): Promise<FolderReserveResult> => reserveFolderInner(ctx, a),
});

/**
 * How many cents may be credited back into ONE window, given what `getValue` reports.
 *
 * ⚠ `getValue` returns the STORED state, NOT a roll-forward: with a single shard its
 * `calculateRateLimit` call passes `now = state.ts`, so `elapsedWindows` is 0 and both `value` and
 * `ts` are as of the last WRITE. A window that rolled overnight with nothing written since still
 * reports yesterday's drained value and yesterday's window start. Refunding against that number is
 * exactly how the live probe produced **2900 against a capacity of 2500**.
 *
 * So the roll-forward is done here, with the component's OWN exported `calculateRateLimit` rather
 * than a reimplementation — a version bump that changes the arithmetic then changes this guard too
 * instead of silently desynchronising from it. `rolled.ts` is the CURRENT window's start.
 *
 * TWO guards, and both are needed:
 *  - **Rollover skip:** a reservation taken in an earlier window is refunded into a window that
 *    never paid. The clamp alone does NOT cover this — after a roll the window refills to capacity
 *    and then someone else spends, which re-opens exactly `theirSpend` cents of headroom for us.
 *  - **Clamp:** `max(0, min(unspent, capacity - value))`, because `calculateRateLimit` applies the
 *    capacity clamp BEFORE subtracting the count, so a credit can otherwise exceed capacity.
 *
 * ponytail: `Date.now()` here is not the same instant the component reads inside `limit()`. A
 * reservation settled in the microseconds either side of a 24h boundary can therefore still be
 * off by one window — bounded by `unspent` and vanishingly rare. Upgrade path is a real spend
 * table, which is what removes the whole negative-count mechanism.
 */
function refundableCents(
  window: { value: number; ts: number; config: RateLimitConfig },
  unspentCents: number,
  reservedAt: number,
): number {
  const { config } = window;
  const rolled = calculateRateLimit({ value: window.value, ts: window.ts }, config, Date.now());
  if (reservedAt < rolled.ts) return 0; // the window rolled since the reservation — refund nothing
  return clampRefundCents(unspentCents, rolled.value, config.capacity ?? config.rate);
}

/**
 * Release a folder's reservation. **THE ONE PLACE a reservation is ever released** — folder
 * completion and cancel both land here, because two release mechanisms is two places to get the
 * clamp wrong. Cancel must call this BEFORE it deletes the `vaultFolders` row (15.3-CONTEXT §B13).
 *
 * IDEMPOTENT BY CAS: `reservedCents` is read and cleared in this same transaction, so a re-entered
 * workflow `onComplete` (which can and does happen) is a no-op the second time. The mutation check
 * for that guard is in `guardrails.test.ts`.
 *
 * ponytail: **THE REFUND IS A NEGATIVE `count`, WHICH IS ARITHMETIC AND NOT AN API.**
 * `@convex-dev/rate-limiter@0.3.2` has no release/refund/credit call; `count` is an unvalidated
 * `v.float64()` and `value = min(...) - count`, so a negative count credits the window. EXACT-pinned
 * and pre-1.0 (CLAUDE.md §6) — a bump can silently stop refunds, which is why `guardrails.test.ts`
 * drives the real component. The upgrade path is a real spend table, not a better credit call.
 *
 * **`media.ts:279-282` deliberately decided the OPPOSITE on its own rail, and that is not a bug.**
 * Media over-reserves by CENTS (every line is bounded by `MEDIA_JOB_CAP_USD` = $3.50), so the drift
 * is immaterial and a ledger would not pay for itself. Ingest over-reserves by DOLLARS, because the
 * estimator cannot see page counts before the bytes land and must price every unprobed PDF as a
 * 50-page scan. Refusing to refund THAT would charge a tenant $25 for a $2 folder.
 */
export const settleFolder = internalMutation({
  args: { folderId: v.id("vaultFolders") },
  handler: async (
    ctx,
    { folderId },
  ): Promise<{ refundedCents: number; deploymentRefundedCents: number; reason: string }> => {
    const none = (reason: string) => ({ refundedCents: 0, deploymentRefundedCents: 0, reason });

    const folder = await ctx.db.get(folderId);
    if (!folder) return none("no_folder"); // cancel already deleted the row — nothing to release
    if (folder.reservedCents <= 0) return none("already_settled"); // THE CAS
    // No stamp ⇒ we cannot prove WHICH window this reservation paid into, and a refund into the
    // wrong one is free budget. Fail closed: the tenant keeps the charge, nobody mints money.
    if (folder.reservedAt === undefined) {
      await ctx.db.patch(folderId, { reservedCents: 0 });
      return none("no_reserved_at");
    }

    const unspent = folder.reservedCents;
    const tenantWindow = await rateLimiter.getValue(ctx, "ingestSpendCents", {
      key: folder.tenantId,
    });
    const refundedCents = refundableCents(tenantWindow, unspent, folder.reservedAt);
    if (refundedCents > 0) {
      await rateLimiter.limit(ctx, "ingestSpendCents", {
        key: folder.tenantId,
        count: -refundedCents,
        reserve: true,
      });
      // INSIDE the `> 0` branch, deliberately. `validateSpendMovement` rejects `amountCents <= 0`,
      // and this runs inside `tryComplete`'s transaction — a zero row would fail FOLDER COMPLETION
      // for an accounting reason. Recording nothing is also the honest answer: nothing came back.
      // The correlation is rebuilt from the SAME `reservedAt` the reservation was stamped with, so
      // a re-entered settle finds the stored row instead of writing a second refund. The CAS above
      // protects the MONEY; this correlation protects the RECORD.
      await recordMovement(ctx, {
        tenantId: folder.tenantId,
        rail: "ingest",
        phase: "refunded",
        amountCents: refundedCents,
        correlationId: `f:${folderId}:${folder.reservedAt}`,
        createdAt: Date.now(),
        folderId,
        kind: "folder_settle",
      });
    }

    // The deployment window rolls on its OWN randomised offset, so it gets its own read, its own
    // rollover check and its own clamp — never the tenant window's numbers.
    //
    // THE DEPLOYMENT REFUND IS DELIBERATELY NOT LEDGERED. `spendEvents` is a PER-TENANT statement,
    // and this credit is not this tenant's money coming back — the two clamps return DIFFERENT
    // amounts, so a second tenant-scoped row would tell a tenant that ~800¢ returned on a 400¢
    // credit and drive `unlanded` to a false zero. The reserve side already carries this asymmetry:
    // both windows are debited, one row is written. The deployment figure keeps the observability
    // it already has — this function's return value and `ingestRemainingCents`.
    const deploymentWindow = await rateLimiter.getValue(ctx, "deploymentIngestSpendCents");
    const deploymentRefundedCents = refundableCents(deploymentWindow, unspent, folder.reservedAt);
    if (deploymentRefundedCents > 0) {
      await rateLimiter.limit(ctx, "deploymentIngestSpendCents", {
        count: -deploymentRefundedCents,
        reserve: true,
      });
    }

    await ctx.db.patch(folderId, { reservedCents: 0 });
    // TWO success reasons, because `unlanded` money says the money is STUCK but not WHY. A rolled
    // window is the one settle that returns nothing while everything worked exactly as designed;
    // without a distinct reason it is indistinguishable from a clamp that happened to hit zero.
    // ponytail: a returned string — the caller (`tryComplete`) currently drops it. Upgrade path is
    // one refs-only `audit.log` row on this branch when the Finance page needs to explain it (§4).
    return {
      refundedCents,
      deploymentRefundedCents,
      reason: refundedCents > 0 ? "settled" : "settled_window_rolled",
    };
  },
});
