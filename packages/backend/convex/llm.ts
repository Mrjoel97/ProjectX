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
import { draftSchema } from "@pikar/contracts/drafting";
import { type RoutingDecision, parseRouting, routingSchema } from "@pikar/contracts/routing";
import { EMAIL_DRAFTER_SKILL, EXECUTIVE_ROUTER_SKILL } from "@pikar/contracts/skill";
import { isFallbackEligible } from "@pikar/core";
import { CHEAP_MODEL } from "@pikar/cost";
import { generateObject } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
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
