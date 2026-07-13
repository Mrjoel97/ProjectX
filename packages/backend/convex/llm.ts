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
// Model ids ("openai/gpt-4o-mini") are pricing/audit keys; `resolveModel` maps each to a
// direct-OpenAI LanguageModel via @ai-sdk/openai (reads OPENAI_API_KEY from the deployment
// env). The Vercel AI Gateway is NOT used — BYOK there is gated behind paid Vercel credits,
// a double charge on top of the OpenAI key we already pay for (decision 2026-07-13). The
// uncached actions carry the model id in their args (guardrails.prepare chose it), fall back
// to CHEAP_MODEL on eligible failure, and are wrapped by the tenant-namespaced action cache
// (Task 2). `usage` (inputTokens/outputTokens) drives OPSG-01 telemetry.
import { openai } from "@ai-sdk/openai";
import { ActionCache } from "@convex-dev/action-cache";
import { draftSchema } from "@pikar/contracts/drafting";
import { type RoutingDecision, parseRouting, routingSchema } from "@pikar/contracts/routing";
import { COCKPIT_AGENT_SKILL, EMAIL_DRAFTER_SKILL, EXECUTIVE_ROUTER_SKILL } from "@pikar/contracts/skill";
import {
  type RecipientEdit,
  applyRecipientEdit,
  buildRecipientView,
  isFallbackEligible,
  rankCandidates,
} from "@pikar/core";
import { CHEAP_MODEL, DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { type LanguageModel, generateObject, generateText, jsonSchema, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import { components, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { contentHash } from "./lib/hash";

// Per-call wall-clock ceiling. Retry budget lives in ONE layer: SDK maxRetries:1 on the
// primary + one CHEAP_MODEL fallback (the pipeline runs these steps with retry:false).
const CALL_TIMEOUT_MS = 45_000;

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel.
// The `openai/` prefix is the gateway namespace; the @ai-sdk/openai provider wants the bare
// name and reads OPENAI_API_KEY from the deployment env. Pricing/audit keep the full id.
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

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
        model: resolveModel(model),
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
        model: resolveModel(CHEAP_MODEL),
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
        model: resolveModel(model),
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
        model: resolveModel(CHEAP_MODEL),
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
  args: {
    tenantId: v.string(),
    safeText: v.string(),
    safeTextHash: v.string(),
    // The RESOLVED display name ONLY (SC3) — for a personalized greeting. NEVER a header hint
    // (lastSubject/lastDateMs/count): those must not reach the LLM (llmRedaction static scan).
    greetingName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { safeText, safeTextHash, greetingName },
  ): Promise<{ subject: string; body: string }> => {
    // Load the drafter FIRST (no hardcoded prompt — CLAUDE.md §5); fails closed
    // (throws NO_ACTIVE_SKILL) when unseeded, so a hardcoded fallback can never sneak in.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: EMAIL_DRAFTER_SKILL },
    );
    const smoke = parseSmoke(safeText);
    // Prepend the greeting instruction (name only) so the body opens "Hi <name>,".
    const prompt = greetingName ? `Open the email body with the greeting "Hi ${greetingName},".\n\n${safeText}` : safeText;

    // ponytail: no audit/telemetry here. draftCockpit has no thread/correlationId (only the
    // safeTextHash) — the CALLER (plan 07) owns the conversation's correlation and records
    // llm.called/cost with it. Writing nothing keeps the draft path redaction-safe by
    // construction (nothing raw can leak to a log because it emits no log). Add a usage
    // return + caller-side telemetry when plan 07 needs OPSG-01 counts for chat drafts.
    try {
      if (smoke) {
        // failPrimary throws INTO the catch so the real fallback path runs; else offline draft.
        if (smoke.failPrimary) throw new DOMException("smoke: forced primary failure", "TimeoutError");
        // Honor the greeting offline too (SC3) so the resolution E2E can prove "Hi <name>," without a model.
        const greeting = greetingName ? `Hi ${greetingName},\n\n` : "";
        return { subject: "Smoke Subject", body: `${greeting}Smoke draft for ${safeTextHash}` };
      }
      const { object } = await generateObject({
        model: resolveModel(DEFAULT_MODEL),
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      return { subject: object.subject, body: object.body };
    } catch (e) {
      if (!isFallbackEligible(e)) throw e;
      if (smoke) return { subject: "Smoke Fallback Subject", body: "smoke fallback" };
      const { object } = await generateObject({
        model: resolveModel(CHEAP_MODEL),
        schema: draftSchema,
        system: skill.body,
        prompt,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 0,
      });
      return { subject: object.subject, body: object.body };
    }
  },
});

// ── Cockpit Executive-Agent tool set (AGNT-01/02) ────────────────────────────
// The governed tools the loop (Plan 04) hands to generateText. Each tool is a THIN wrapper
// over the primitive it governs — the tool IS the enforcement boundary. Structural facts
// (which addresses are valid, which recipient sits at #index) are resolved/validated HERE
// from the row + the pure @pikar/core reducers, NEVER trusted from the model. Redaction runs
// before the drafting sub-call; the recipient view the model reasons over is index+label only
// (raw addresses are substituted server-side inside removeRecipient). No generateText loop yet.
// ponytail: no abstraction layer — each tool is a thin `execute` closure over an existing
// primitive; the shared plan-row read is one helper.

// The plan-row fields the tools read. Explicit so the runQuery result never resolves through
// the `internal` graph (guidelines §96 circular-inference cliff, as the sibling actions do).
type PlanRow = {
  tenantId: string;
  recipients?: string[];
  subject?: string;
  body?: string;
  mode?: "individual" | "group";
  greetingName?: string;
};

/**
 * Format the current plan state for the model (Plan 04 feeds this into the loop each turn).
 * Recipients render as the index+label view from buildRecipientView — an address NEVER appears
 * (§2-D: the raw email does not reach the model). Pure — takes the row, returns a string.
 */
export function buildAgentContext(plan: {
  recipients?: string[];
  subject?: string;
  body?: string;
  mode?: "individual" | "group";
}): string {
  const view = buildRecipientView((plan.recipients ?? []).map((address) => ({ address })));
  const recipients = view.length
    ? view.map((r) => `  #${r.index}: ${r.label}`).join("\n")
    : "  (none yet)";
  return [
    "Current email plan:",
    "Recipients (reason about these by #index only):",
    recipients,
    `Subject: ${plan.subject ?? "(not set)"}`,
    `Body drafted: ${plan.body ? "yes" : "no"}`,
    `Send mode: ${plan.mode ?? "(not set)"}`,
  ].join("\n");
}

/**
 * Build the governed tool set for one plan (AGNT-01/02). Each tool wraps its primitive and
 * preserves that primitive's governance; nothing trusts a structural fact from the model. Plan
 * 04 hands this set to generateText — Plan 03 ships them as independently testable wrappers.
 */
export function buildCockpitTools(ctx: GenericActionCtx<DataModel>, tenantId: string, planId: Id<"plans">) {
  const readPlan = async (): Promise<PlanRow> => {
    const plan: PlanRow | null = await ctx.runQuery(internal.plans.getById, { planId });
    if (!plan || plan.tenantId !== tenantId) throw new Error("cockpit: plan row missing"); // no cross-tenant
    return plan;
  };

  // add | set share the bounce/patch shape; remove differs (index → server-side address).
  const editRecipients = async (edit: RecipientEdit): Promise<string> => {
    const plan = await readPlan();
    const result = applyRecipientEdit(plan.recipients ?? [], edit);
    if (!result.ok) {
      // Bounce at the boundary — do NOT patch; hand the rejected tokens back so the agent re-asks.
      return `Rejected (not applied): ${result.rejected.join(", ")}. The recipient list is unchanged.`;
    }
    await ctx.runMutation(internal.plans.patchPlan, { planId, recipients: result.recipients });
    return `Recipients updated — ${result.recipients.length} on the list.`;
  };

  return {
    resolveContacts: tool({
      description:
        "Look up a named person in the user's mailbox to find their email address. Use for a NAME (not a typed address). Returns matching contacts by label for the user to pick — you never see the address.",
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string", description: "The person's name to look up." } },
        required: ["name"],
        additionalProperties: false,
      }),
      execute: async ({ name }): Promise<string> => {
        // correlationId = planId: a stable ref for the refs-only mailbox.searched audit (§4).
        const res = await ctx.runAction(internal.gmail.search, { tenantId, name, correlationId: planId });
        if (!res.ok) {
          // Read-time auth failure: light the reconnect banner AND fall back to asking (never dead-end).
          await ctx.runMutation(internal.notifications.notify, {
            tenantId,
            kind: "gmail_reconnect",
            message: "I couldn't read your mailbox — reconnect Gmail so I can look up contacts.",
          });
          return `I couldn't read the mailbox to look up "${name}". Ask the user for the email address directly.`;
        }
        const matches = rankCandidates(name, res.records);
        if (matches.length === 0) return `No contacts matched "${name}". Ask the user for the email address directly.`;
        // Hold the candidates on the content plane so the ResolutionCard renders; the human picks a
        // chip → resolveRecipients folds the real address in (the model never sees it).
        await ctx.runMutation(internal.plans.writeCandidates, { planId, candidates: [{ name, matches }], pendingValid: [] });
        // refs-only summary: counts + display-name LABELS, never an address (§2-D / §4).
        const labels = matches.map((m, i) => `#${i + 1} ${m.displayName ?? "(no name)"}`).join(", ");
        return `Found ${matches.length} contact(s) for "${name}": ${labels}. The user will pick one — do not guess the address.`;
      },
    }),
    addRecipients: tool({
      description: "Add one or more explicit, user-provided email addresses. Invalid addresses are rejected, not added.",
      inputSchema: jsonSchema<{ addresses: string[] }>({
        type: "object",
        properties: { addresses: { type: "array", items: { type: "string" }, description: "Explicit email addresses the user typed." } },
        required: ["addresses"],
        additionalProperties: false,
      }),
      execute: ({ addresses }): Promise<string> => editRecipients({ op: "add", addresses }),
    }),
    setRecipients: tool({
      description: "Replace the entire recipient list with these explicit email addresses. Invalid addresses are rejected.",
      inputSchema: jsonSchema<{ addresses: string[] }>({
        type: "object",
        properties: { addresses: { type: "array", items: { type: "string" } } },
        required: ["addresses"],
        additionalProperties: false,
      }),
      execute: ({ addresses }): Promise<string> => editRecipients({ op: "set", addresses }),
    }),
    removeRecipient: tool({
      description:
        "Remove the recipient at the given 1-based #index (as shown in the plan). You never handle the address — the server resolves the index to it.",
      inputSchema: jsonSchema<{ index: number }>({
        type: "object",
        properties: { index: { type: "number", description: "1-based index of the recipient to remove." } },
        required: ["index"],
        additionalProperties: false,
      }),
      execute: ({ index }): Promise<string> => editRecipients({ op: "remove", index }),
    }),
    setSubject: tool({
      description: "Set the email subject line.",
      inputSchema: jsonSchema<{ subject: string }>({
        type: "object",
        properties: { subject: { type: "string" } },
        required: ["subject"],
        additionalProperties: false,
      }),
      execute: async ({ subject }): Promise<string> => {
        await ctx.runMutation(internal.plans.patchPlan, { planId, subject });
        return "Subject set.";
      },
    }),
    setMode: tool({
      description: "Set how multiple recipients are addressed: individually (a separate email each) or as one group thread.",
      inputSchema: jsonSchema<{ mode: "individual" | "group" }>({
        type: "object",
        properties: { mode: { type: "string", enum: ["individual", "group"] } },
        required: ["mode"],
        additionalProperties: false,
      }),
      execute: async ({ mode }): Promise<string> => {
        await ctx.runMutation(internal.plans.patchPlan, { planId, mode });
        return `Send mode set to ${mode}.`;
      },
    }),
    draftBody: tool({
      description: "Draft the email body from a plain-language description of what to say. The draft is stored on the plan.",
      inputSchema: jsonSchema<{ intent: string }>({
        type: "object",
        properties: { intent: { type: "string", description: "What the email should say, in plain language." } },
        required: ["intent"],
        additionalProperties: false,
      }),
      execute: async ({ intent }): Promise<string> => {
        // Redact BEFORE the drafting model sees anything (GRDL-01/02, CLAUDE.md §4). Fail closed.
        const scan = scanText(intent);
        if (!scan.ok) throw new Error("cockpit: body-intent scan failed");
        const safeText = scan.value.safeText;
        const plan = await readPlan();
        const draft: { subject: string; body: string } = await ctx.runAction(internal.llm.draftCockpit, {
          tenantId,
          safeText,
          safeTextHash: await contentHash(safeText),
          greetingName: plan.greetingName, // resolved display name ONLY (SC3 — never a header hint)
        });
        // bodyIntent is content-plane (never a log — §4); body is the drafted wording.
        await ctx.runMutation(internal.plans.patchPlan, { planId, bodyIntent: intent, body: draft.body });
        return "Body drafted and saved to the plan.";
      },
    }),
    proposePlan: tool({
      description: "Propose the finished plan for the user to review and Approve. Call only once recipients, subject, and a drafted body are all set.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      execute: async (): Promise<string> => {
        const plan = await readPlan();
        const recipients = plan.recipients ?? [];
        // Guard: never propose an incomplete plan (a zero-recipient plan drafted+proposed was the
        // 03.2.1 bug). Refuse and tell the agent what's missing so it re-resolves / re-asks.
        if (recipients.length === 0) {
          return "Cannot propose yet — no recipients are set. Have the user resolve or add at least one recipient first.";
        }
        if (!plan.subject) return "Cannot propose yet — no subject is set. Ask the user for the subject.";
        if (!plan.body) return "Cannot propose yet — the body has not been drafted. Call draftBody first.";
        // Structural facts come from the ROW, never from model args (DECISION #2).
        await ctx.runMutation(internal.cockpit.proposeEmailPlan, {
          planId,
          recipients,
          mode: recipients.length > 1 ? (plan.mode ?? "individual") : "individual",
          subject: plan.subject,
          body: plan.body,
        });
        return "Plan proposed — the user can now review and Approve it.";
      },
    }),
  };
}

// ── The governed Executive-Agent tool-loop (AGNT-01/02) ──────────────────────
// runCockpitAgent is the reasoning engine: preCall gates BEFORE the loop (a governed stop is a
// conversational "paused" reply, NEVER a DLQ), generateText drives the tools with the cockpit-agent
// skill as `system`, stepCountIs(8) bounds the loop (the ceiling without a proposal makes the agent
// ask rather than loop), and recordSpend consumes the priced usage after — verbatim the route/draft
// rails. An eligible failure retries once on CHEAP_MODEL (isFallbackEligible).
// ponytail: `stopWhen: stepCountIs(8)` IS ai@7's maxSteps (the SDK renamed it; do NOT bump the
// pinned component to chase the old name — §6).

const PAUSED_REPLY =
  "I've paused for a moment — I'm briefly unavailable. Please send that again shortly.";

// A model paired with the pricing id used for recordSpend. An injected mock model is not a gateway
// string, so pricing needs the id explicitly (priceUsage keys on the model string).
type PricedModel = { model: LanguageModel; id: string };

// Invoke one built tool by name with a live action ctx (convex-test cannot fabricate one, so both
// the SMOKE offline path and the test shims route through this). Mirrors the tool-loop's own call.
function invokeTool(
  tools: ReturnType<typeof buildCockpitTools>,
  name: string,
  input: unknown,
): Promise<string> {
  const t = (tools as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<string> }>)[name];
  if (!t) throw new Error(`unknown cockpit tool: ${name}`);
  return t.execute(input, { toolCallId: "cockpit", messages: [] });
}

// Price the reasoning call's usage → consume the daily-spend window (guarded: unknown model / zero
// cost skip; recordSpend itself also no-ops at cents<=0, so a ZERO_USAGE turn never drains budget).
async function recordModelSpend(
  ctx: GenericActionCtx<DataModel>,
  id: string,
  usage: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  const priced = priceUsage(id, usage);
  if (!priced.ok) return;
  await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
}

// The governed generateText loop shared by runCockpitAgent (a gateway model string) and the
// mock-model test shim (a scripted mock — Convex args cannot carry a LanguageModel). Runs the
// loop, records spend, and on an eligible primary failure retries once on the fallback model.
// Explicit return type keeps this out of the `internal`-graph circular inference (§96).
async function runAgentLoop(
  ctx: GenericActionCtx<DataModel>,
  args: {
    tenantId: string;
    planId: Id<"plans">;
    system: string;
    prompt: string;
    primary: PricedModel;
    fallback: PricedModel;
  },
): Promise<{ reply: string }> {
  const { tenantId, planId, system, prompt, primary, fallback } = args;
  const tools = buildCockpitTools(ctx, tenantId, planId);
  const run = async (m: PricedModel, maxRetries: number): Promise<{ reply: string }> => {
    const res = await generateText({
      model: m.model,
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(8),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries,
    });
    await recordModelSpend(ctx, m.id, res.usage);
    return { reply: res.text };
  };
  try {
    return await run(primary, 1);
  } catch (e) {
    if (!isFallbackEligible(e)) throw e; // our bug / config → propagate (the driver saves an error turn)
    return await run(fallback, 0);
  }
}

// ── SMOKE:: agent sentinel (the Plan 05 offline E2E path) ────────────────────
// The E2E has no gateway, so it drives the loop turn-by-turn: ONE sentinel op per user message
// maps to exactly ONE governed tool call (the SAME tools the model would call — no logic
// duplication, no generateText). Per-request + content-free framing, mirroring the route/draft
// sentinel. Grammar (one per message):
//   SMOKE::agent::add=a@x.com,b@x.com | resolve=Name | subject=... | mode=individual|group
//                | body=<intent> | remove=<1-based index> | propose
type AgentSmokeOp =
  | { kind: "add"; addresses: string[] }
  | { kind: "resolve"; name: string }
  | { kind: "subject"; subject: string }
  | { kind: "mode"; mode: "individual" | "group" }
  | { kind: "body"; intent: string }
  | { kind: "remove"; index: number }
  | { kind: "propose" };

function parseAgentSmoke(text: string): AgentSmokeOp | null {
  const m = text.match(/^SMOKE::agent::([\s\S]+)$/);
  if (!m?.[1]) return null;
  const spec = m[1].trim();
  if (spec === "propose") return { kind: "propose" };
  const eq = spec.indexOf("=");
  if (eq < 0) return null;
  const key = spec.slice(0, eq).trim();
  const val = spec.slice(eq + 1).trim();
  switch (key) {
    case "add":
      return { kind: "add", addresses: val.split(",").map((s) => s.trim()).filter(Boolean) };
    case "resolve":
      return { kind: "resolve", name: val };
    case "subject":
      return { kind: "subject", subject: val };
    case "mode":
      return { kind: "mode", mode: val === "group" ? "group" : "individual" };
    case "body":
      return { kind: "body", intent: val };
    case "remove":
      return { kind: "remove", index: Number(val) };
    default:
      return null;
  }
}

function runAgentSmokeOp(tools: ReturnType<typeof buildCockpitTools>, op: AgentSmokeOp): Promise<string> {
  switch (op.kind) {
    case "add":
      return invokeTool(tools, "addRecipients", { addresses: op.addresses });
    case "resolve":
      return invokeTool(tools, "resolveContacts", { name: op.name });
    case "subject":
      return invokeTool(tools, "setSubject", { subject: op.subject });
    case "mode":
      return invokeTool(tools, "setMode", { mode: op.mode });
    case "body":
      return invokeTool(tools, "draftBody", { intent: op.intent });
    case "remove":
      return invokeTool(tools, "removeRecipient", { index: op.index });
    case "propose":
      return invokeTool(tools, "proposePlan", {});
  }
}

/**
 * The Executive Agent tool-loop (AGNT-01/02). One turn: gate on preCall (blocked → a conversational
 * "paused" reply as DATA, never a throw/DLQ) → load the cockpit-agent skill as `system` (fails
 * closed unseeded, §5) → feed the index+label plan context (address-free, §2-D) + the user text to
 * generateText with the governed tools → recordSpend the priced usage → return the assistant reply
 * (Plan 05's driver saves it to the thread). A SMOKE:: sentinel drives one governed tool call
 * offline (no gateway — the Plan 05 E2E path). Explicit return type dodges TS7022 (§96).
 * ponytail: `model?` overrides the gateway model string; the mock-model seam is the test shim below
 * (a LanguageModel is not Convex-serializable, so it cannot ride in the args).
 */
export const runCockpitAgent = internalAction({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    text: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { tenantId, planId, text, model },
  ): Promise<{ reply: string; blocked?: "kill_switch" | "daily_budget_exhausted" }> => {
    // 1. Governed gate BEFORE any reasoning call — a governed stop is a paused reply, never a DLQ.
    const pre: { ok: true } | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" } =
      await ctx.runMutation(internal.guardrails.preCall, {});
    if (!pre.ok) return { reply: PAUSED_REPLY, blocked: pre.reason };

    // 2. System = the cockpit-agent skill body (no hardcoded prompt — §5; fails closed unseeded).
    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: COCKPIT_AGENT_SKILL,
    });

    // 3. Current plan state → the model-facing context (index+label recipients, address-free §2-D).
    const plan: PlanRow | null = await ctx.runQuery(internal.plans.getById, { planId });
    const tools = buildCockpitTools(ctx, tenantId, planId);

    // 4. Offline sentinel path (Plan 05 E2E): one op → one governed tool call, no generateText.
    const smokeOp = parseAgentSmoke(text);
    if (smokeOp) return { reply: await runAgentSmokeOp(tools, smokeOp) };

    // 5. The governed generateText tool-loop; eligible failure → CHEAP_MODEL.
    const primaryId = model ?? DEFAULT_MODEL;
    const { reply } = await runAgentLoop(ctx, {
      tenantId,
      planId,
      system: skill.body,
      prompt: `${buildAgentContext(plan ?? {})}\n\nThe user says: ${text}`,
      primary: { model: resolveModel(primaryId), id: primaryId },
      fallback: { model: resolveModel(CHEAP_MODEL), id: CHEAP_MODEL },
    });
    return { reply };
  },
});

/**
 * Test-support shim (convex-test cannot fabricate an action ctx): build the tool set with a live
 * ctx and invoke one tool by name. Exercises the REAL primitives offline via SMOKE::. Not used in
 * production — the generateText loop above is the real caller.
 * ponytail: test-only, but it must live in this "use node" module — the tools close over an action
 * ctx a query/mutation test ctx cannot provide.
 */
export const __invokeCockpitTool = internalAction({
  args: { tenantId: v.string(), planId: v.id("plans"), toolName: v.string(), input: v.any() },
  handler: async (ctx, { tenantId, planId, toolName, input }): Promise<string> =>
    invokeTool(buildCockpitTools(ctx, tenantId, planId), toolName, input),
});

/**
 * Test-support shim for the mock-model loop: a LanguageModel cannot ride through Convex action args,
 * so the mock is BUILT here from a serializable script of doGenerate results and handed to the SAME
 * governed loop (runAgentLoop) runCockpitAgent uses. Proves generateText runs the tools + records
 * spend + falls back to CHEAP_MODEL — all offline. Mirrors __invokeCockpitTool.
 * ponytail: script-driven mock, not a model arg (models are not Convex-serializable).
 */
export const __runCockpitAgentWithScript = internalAction({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    primary: v.array(v.any()),
    fallback: v.optional(v.array(v.any())),
    failPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, { tenantId, planId, primary, fallback, failPrimary }): Promise<{ reply: string }> => {
    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: COCKPIT_AGENT_SKILL,
    });
    const plan: PlanRow | null = await ctx.runQuery(internal.plans.getById, { planId });
    const primaryModel = failPrimary
      ? new MockLanguageModelV4({
          doGenerate: async () => {
            throw new DOMException("mock: forced primary failure", "TimeoutError");
          },
        })
      : new MockLanguageModelV4({ doGenerate: primary as never });
    const fallbackModel = new MockLanguageModelV4({ doGenerate: (fallback ?? primary) as never });
    return await runAgentLoop(ctx, {
      tenantId,
      planId,
      system: skill.body,
      prompt: `${buildAgentContext(plan ?? {})}\n\nThe user says: drive the plan to a proposal.`,
      primary: { model: primaryModel as unknown as LanguageModel, id: DEFAULT_MODEL },
      fallback: { model: fallbackModel as unknown as LanguageModel, id: CHEAP_MODEL },
    });
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
