"use node";

// Executive Agent LLM surface (AGNT-01/02/03 + GRDL-01/02/04/05) — the `route` and
// `draft` steps the pipeline (02-06) reaches through the Vercel AI Gateway.
//
// After Phase 3 this module CANNOT read raw goal text: every text read goes through
// guardrails.getSafeTextByHash (the fail-closed reader — GRDL-01/02). Prompts are
// NEVER hardcoded: both bodies load from the skills registry at runtime (CLAUDE.md §5).
//
// "use node": this module holds ONLY internalActions; every DB read goes through
// ctx.runQuery (01-07 rule — actions have no ctx.db). It stays the ONLY node module
// touched — a new node module re-triggers the TS circular-inference cliff (02-06).
//
// A bare string model id ("openai/gpt-4o-mini") routes through the Vercel AI Gateway
// when AI_GATEWAY_API_KEY is set — no provider package import (@ai-sdk/openai). The
// uncached actions carry the model in their args (guardrails.prepare chose it), fall
// back to CHEAP_MODEL on eligible failure, and are wrapped by the tenant-namespaced
// action cache (Task 2). `usage` (inputTokens/outputTokens) drives OPSG-01 telemetry.
import { ActionCache } from "@convex-dev/action-cache";
import { draftSchema } from "@pikar/contracts/drafting";
import { type RoutingDecision, parseRouting, routingSchema } from "@pikar/contracts/routing";
import { EMAIL_DRAFTER_SKILL, EXECUTIVE_ROUTER_SKILL } from "@pikar/contracts/skill";
import { isFallbackEligible } from "@pikar/core";
import { CHEAP_MODEL, DEFAULT_MODEL } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { generateObject } from "ai";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Per-call wall-clock ceiling. Retry budget lives in ONE layer: SDK maxRetries:1 on the
// primary + one CHEAP_MODEL fallback (the pipeline runs these steps with retry:false).
const CALL_TIMEOUT_MS = 45_000;

// ── Smoke seam ──────────────────────────────────────────────────────────────
// A dev-deployment smoke must drive the REAL spine deterministically and offline
// (no AI_GATEWAY_API_KEY on the local backend). The sentinel contains no PII, so it
// survives prepare's redaction verbatim and is parsed from safeText. Grammar:
//   SMOKE::route=<route>::[cache=1::][fail=primary::]
//   cache=1     — flow through preCall + the action cache (exercise the cache path)
//   fail=primary — force the primary model to throw so the real fallback path runs
// It degrades only the caller's OWN request; no cross-tenant effect.
// ponytail: content sentinel, not an env flag — keeps the seam per-request and out of
// shared deployment config. Remove once a mock-gateway smoke exists.
type Route = RoutingDecision["route"];
const SMOKE_ROUTES: readonly Route[] = ["direct_llm", "direct_tool", "sub_agent"];
type Smoke = { route: Route | "unknown"; cache: boolean; failPrimary: boolean };
function parseSmoke(text: string): Smoke | null {
  const m = text.match(/^SMOKE::route=([a-z_]+)::/);
  if (!m) return null;
  return {
    route: SMOKE_ROUTES.includes(m[1] as Route) ? (m[1] as Route) : "unknown",
    cache: text.includes("cache=1::"),
    failPrimary: text.includes("fail=primary::"),
  };
}

// Cast: the telemetry consumer reads only inputTokens/outputTokens; the SDK's
// LanguageModelUsage detail fields are irrelevant to a zero-cost smoke/cache-miss.
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as unknown as GenUsage;

// `usage` shape lifted straight from the AI SDK's own return — version-independent, and
// (paired with the handler return annotations below) keeps these actions out of the
// `internal`-graph circular inference that sibling "use node" modules push past TS's limit.
type GenUsage = Awaited<ReturnType<typeof generateObject>>["usage"];

// The redacted-text reader's shape (the ONLY text source — GRDL-01). Explicit so the
// runQuery result never resolves through the `internal` graph (guidelines §96).
type SafeRead = { safeText: string; lastInstruction: string | null };

// ── Tenant-namespaced read-through caches (GRDL-04) ──────────────────────────
// Keyed on the uncached action's args ({tenantId, safeTextHash, model, skillVersion
// [, instructionHash]}) — hash only, never text, never requestId. `name` is part of the
// key: bump the suffix to invalidate wholesale. A registry rollback changes skillVersion,
// so a cached draft can never outlive the skill body that produced it (CLAUDE.md §5).
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const routeCache = new ActionCache(components.actionCache, {
  action: internal.llm.routeUncached,
  name: "route-v1",
  ttl: SEVEN_DAYS_MS,
});
const draftCache = new ActionCache(components.actionCache, {
  action: internal.llm.draftUncached,
  name: "draft-v1",
  ttl: SEVEN_DAYS_MS,
});

// The wrapper return unions: a governed preCall stop propagates as DATA (never a throw),
// landing the pipeline in the SAME blocked terminal a prepare stop gets.
type RouteResult =
  | { blocked: "kill_switch" | "daily_budget_exhausted" }
  | { blocked: null; routing: RoutingDecision; usage: GenUsage; cacheHit: boolean };
type DraftResult =
  | { blocked: "kill_switch" | "daily_budget_exhausted" }
  | { blocked: null; subject: string; body: string; usage: GenUsage; cacheHit: boolean };

/**
 * Classify the request goal into a routing decision + step plan (AGNT-01/02). The args
 * ARE the action-cache key — hash only, NO text, NO requestId (requestId would fragment
 * the key; text would violate GRDL-02). Reads redacted text via the fail-closed reader.
 * On an eligible primary failure it retries once on CHEAP_MODEL (llm.fallback audited by
 * error NAME only); a parse fail throws a plain Error → DLQ (AGNT-03, not fallback).
 */
export const routeUncached = internalAction({
  args: {
    tenantId: v.string(),
    safeTextHash: v.string(),
    model: v.string(),
    skillVersion: v.number(),
  },
  handler: async (
    ctx,
    { tenantId, safeTextHash, model, skillVersion },
  ): Promise<{ routing: RoutingDecision; usage: GenUsage; generatedAt: number }> => {
    const { safeText }: SafeRead = await ctx.runQuery(internal.guardrails.getSafeTextByHash, {
      tenantId,
      safeTextHash,
    });

    // Uncached actions have no request correlationId — key audits on safeTextHash. The
    // llm.called row is the cache-miss oracle: a hit produces NO new row (03-RESEARCH Q1).
    const auditCalled = (m: string) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.called",
        actor: "system",
        payload: { model: m, skillVersion, stage: "route" },
      });

    const smoke = parseSmoke(safeText);
    if (smoke) {
      await auditCalled(model);
      if (smoke.route === "unknown") throw new Error("unknown_route");
      return {
        routing: { route: smoke.route, steps: [{ n: 1, description: "smoke" }], rationale: "smoke" },
        usage: ZERO_USAGE,
        generatedAt: Date.now(),
      };
    }

    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EXECUTIVE_ROUTER_SKILL,
    });

    try {
      const { object, usage } = await generateObject({
        model,
        schema: routingSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      const parsed = parseRouting(object);
      if (!parsed.ok) throw new Error(parsed.reason); // "unknown_route" — plain Error → DLQ
      await auditCalled(model);
      return { routing: parsed.value, usage, generatedAt: Date.now() };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e; // our bug / parse fail / config → DLQ
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.fallback",
        actor: "system",
        payload: { fromModel: model, toModel: CHEAP_MODEL, errorName: (e as Error)?.name ?? "unknown", stage: "route" },
      });
      const { object, usage } = await generateObject({
        model: CHEAP_MODEL,
        schema: routingSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      const parsed = parseRouting(object);
      if (!parsed.ok) throw new Error(parsed.reason);
      await auditCalled(CHEAP_MODEL);
      return { routing: parsed.value, usage, generatedAt: Date.now() };
    }
  },
});

/**
 * Draft a subject + plain-text body for the redacted goal (AGNT-02 + GRDL-02/04/05).
 * Same hash-only cache-key shape as routeUncached, plus an optional instructionHash so a
 * regenerate-with-instruction gets its own cache entry. lastInstruction comes back from
 * the fail-closed reader ALREADY scanned (plan 03-03 stores only redacted instructions).
 */
export const draftUncached = internalAction({
  args: {
    tenantId: v.string(),
    safeTextHash: v.string(),
    model: v.string(),
    skillVersion: v.number(),
    instructionHash: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { tenantId, safeTextHash, model, skillVersion, instructionHash },
  ): Promise<{ subject: string; body: string; usage: GenUsage; generatedAt: number }> => {
    const { safeText, lastInstruction }: SafeRead = await ctx.runQuery(
      internal.guardrails.getSafeTextByHash,
      { tenantId, safeTextHash },
    );

    const auditCalled = (m: string) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.called",
        actor: "system",
        payload: { model: m, skillVersion, stage: "draft" },
      });

    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EMAIL_DRAFTER_SKILL,
    });
    const smoke = parseSmoke(safeText);
    const prompt =
      lastInstruction && instructionHash ? `${safeText}\n\nRevision instruction: ${lastInstruction}` : safeText;

    try {
      if (smoke) {
        // failPrimary throws INTO the real catch so isFallbackEligible classifies it.
        if (smoke.failPrimary) throw new DOMException("smoke: forced primary failure", "TimeoutError");
        await auditCalled(model);
        return { subject: "Smoke Subject", body: `Smoke draft for ${safeTextHash}`, usage: ZERO_USAGE, generatedAt: Date.now() };
      }
      const { object, usage } = await generateObject({
        model,
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      await auditCalled(model);
      return { subject: object.subject, body: object.body, usage, generatedAt: Date.now() };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e;
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: safeTextHash,
        eventType: "llm.fallback",
        actor: "system",
        payload: { fromModel: model, toModel: CHEAP_MODEL, errorName: (e as Error)?.name ?? "unknown", stage: "draft" },
      });
      // Sentinel short-circuits the fallback to a fixed draft (no model call).
      if (smoke) return { subject: "Smoke Fallback Subject", body: "smoke fallback", usage: ZERO_USAGE, generatedAt: Date.now() };
      const { object, usage } = await generateObject({
        model: CHEAP_MODEL,
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      await auditCalled(CHEAP_MODEL);
      return { subject: object.subject, body: object.body, usage, generatedAt: Date.now() };
    }
  },
});

/**
 * Cockpit body draft (DECISION #2 — the LLM is used ONLY for the body wording).
 * Lives INSIDE llm.ts because it is the ONLY "use node" module (RESEARCH §6 — a second
 * node module re-triggers the TS circular-inference cliff). Unlike draftUncached it takes
 * ALREADY-REDACTED text directly ({ tenantId, safeText, safeTextHash }) instead of a
 * requests-row hash: the guided chat has no per-turn requests row (RESEARCH-agent §6).
 *
 * REDACTION CONTRACT: the CALLER (plan 07) scans the body-intent via guardrails.prepare/
 * scanText and passes `safeText` — no raw PII reaches the model or any log (GRDL-01/02,
 * CLAUDE.md §4). The drafter body loads from the registry (no hardcoded prompt — §5).
 * SMOKE:: short-circuits to a deterministic offline draft (no model call — the E2E path);
 * else DEFAULT_MODEL → CHEAP_MODEL fallback. Returns { subject, body } only — the
 * recipient is never model-derived (drafting.ts).
 */
export const draftCockpit = internalAction({
  args: { tenantId: v.string(), safeText: v.string(), safeTextHash: v.string() },
  handler: async (
    ctx,
    { safeText, safeTextHash },
  ): Promise<{ subject: string; body: string }> => {
    // Load the drafter FIRST (no hardcoded prompt — CLAUDE.md §5); fails closed
    // (throws NO_ACTIVE_SKILL) when unseeded, so a hardcoded fallback can never sneak in.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: EMAIL_DRAFTER_SKILL },
    );
    const smoke = parseSmoke(safeText);

    // ponytail: no audit/telemetry here. draftCockpit has no thread/correlationId (only the
    // safeTextHash) — the CALLER (plan 07) owns the conversation's correlation and records
    // llm.called/cost with it. Writing nothing keeps the draft path redaction-safe by
    // construction (nothing raw can leak to a log because it emits no log). Add a usage
    // return + caller-side telemetry when plan 07 needs OPSG-01 counts for chat drafts.
    try {
      if (smoke) {
        // failPrimary throws INTO the catch so the real fallback path runs; else offline draft.
        if (smoke.failPrimary) throw new DOMException("smoke: forced primary failure", "TimeoutError");
        return { subject: "Smoke Subject", body: `Smoke draft for ${safeTextHash}` };
      }
      const { object } = await generateObject({
        model: DEFAULT_MODEL,
        schema: draftSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      return { subject: object.subject, body: object.body };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e;
      if (smoke) return { subject: "Smoke Fallback Subject", body: "smoke fallback" };
      const { object } = await generateObject({
        model: CHEAP_MODEL,
        schema: draftSchema,
        system: skill.body,
        prompt: safeText,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      return { subject: object.subject, body: object.body };
    }
  },
});

// ── Pipeline-facing wrappers (the only route/draft the pipeline calls) ────────
// Each: read redacted text → sentinel-first short-circuit → preCall governed gate →
// cache fetch → timestamp-inferred hit flag.

/**
 * Route wrapper (AGNT-01/02 + GRDL-03/04). Sentinel-first (Pitfall 5): a default
 * SMOKE sentinel short-circuits BEFORE preCall + cache, so a drained dev budget or a
 * stale cache entry can never break smoke:pipeline. Otherwise preCall gates, then the
 * cache fetch keys on {tenantId, safeTextHash, model, skillVersion}.
 */
export const route = internalAction({
  args: {
    tenantId: v.string(),
    requestId: v.id("requests"),
    safeTextHash: v.string(),
    model: v.string(),
  },
  handler: async (ctx, { tenantId, safeTextHash, model }): Promise<RouteResult> => {
    const { safeText }: SafeRead = await ctx.runQuery(internal.guardrails.getSafeTextByHash, {
      tenantId,
      safeTextHash,
    });
    const smoke = parseSmoke(safeText);
    if (smoke && !smoke.cache) {
      if (smoke.route === "unknown") throw new Error("unknown_route");
      return {
        blocked: null,
        routing: { route: smoke.route, steps: [{ n: 1, description: "smoke" }], rationale: "smoke" },
        usage: ZERO_USAGE,
        cacheHit: false,
      };
    }

    const skill: { version: number } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EXECUTIVE_ROUTER_SKILL,
    });
    const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
      await ctx.runMutation(internal.guardrails.preCall, {});
    if (!pre.ok) return { blocked: pre.reason };

    const tStart = Date.now();
    const value: { routing: RoutingDecision; usage: GenUsage; generatedAt: number } =
      await routeCache.fetch(ctx, { tenantId, safeTextHash, model, skillVersion: skill.version });
    // An entry created before this fetch began was served from cache; a miss generates
    // DURING the fetch so generatedAt > tStart.
    // ponytail: timestamp inference — swap to the component's native hit signal if the
    // installed .d.ts ever exposes one (0.3.1 does not).
    const cacheHit = value.generatedAt < tStart;
    return { blocked: null, routing: value.routing, usage: value.usage, cacheHit };
  },
});

/**
 * Draft wrapper (AGNT-02 + GRDL-02/04). Same shape plus an optional regenerate
 * instruction (scanned fail-closed, persisted, hashed into the cache key) and `force`
 * to bypass the cache on regenerate (an identical-args fetch would hand back the exact
 * draft the user just asked to change — Pitfall 2).
 */
export const draft = internalAction({
  args: {
    tenantId: v.string(),
    requestId: v.id("requests"),
    safeTextHash: v.string(),
    model: v.string(),
    instruction: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { tenantId, requestId, safeTextHash, model, instruction, force }): Promise<DraftResult> => {
    const { safeText }: SafeRead = await ctx.runQuery(internal.guardrails.getSafeTextByHash, {
      tenantId,
      safeTextHash,
    });
    const smoke = parseSmoke(safeText);
    if (smoke && !smoke.cache) {
      return { blocked: null, subject: "Smoke Subject", body: `Smoke draft for ${safeTextHash}`, usage: ZERO_USAGE, cacheHit: false };
    }

    const skill: { version: number } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EMAIL_DRAFTER_SKILL,
    });
    const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
      await ctx.runMutation(internal.guardrails.preCall, {});
    if (!pre.ok) return { blocked: pre.reason };

    const args: {
      tenantId: string;
      safeTextHash: string;
      model: string;
      skillVersion: number;
      instructionHash?: string;
    } = { tenantId, safeTextHash, model, skillVersion: skill.version };
    if (instruction) {
      const scan = scanText(instruction);
      if (!scan.ok) throw new Error("guardrails: instruction_scan_failed"); // fail closed, content-free
      const safeInstruction = scan.value.safeText;
      args.instructionHash = createHash("sha256").update(safeInstruction).digest("hex");
      await ctx.runMutation(internal.guardrails.saveInstruction, { requestId, safeInstruction });
    }

    const tStart = Date.now();
    const value: { subject: string; body: string; usage: GenUsage; generatedAt: number } =
      await draftCache.fetch(ctx, args, force ? { force: true } : undefined);
    const cacheHit = value.generatedAt < tStart;
    return { blocked: null, subject: value.subject, body: value.body, usage: value.usage, cacheHit };
  },
});
