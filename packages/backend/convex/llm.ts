"use node";

// Executive Agent LLM surface (AGNT-01/02/03) — the `route` and `draft` steps the
// pipeline (02-06) reaches through the Vercel AI Gateway.
//
// "use node": this module holds ONLY internalActions; every DB read goes through
// ctx.runQuery (01-07 rule — actions have no ctx.db). Prompts are NEVER hardcoded:
// both bodies load from the skills registry at runtime (CLAUDE.md §5).
//
// A bare string model id ("openai/gpt-4o-mini") routes through the Vercel AI Gateway
// when AI_GATEWAY_API_KEY is set — no provider package import (@ai-sdk/openai) and no
// @convex-dev/agent (CONTEXT locked). `usage` (inputTokens/outputTokens) is returned
// for OPSG-01 telemetry.
import { draftSchema } from "@pikar/contracts/drafting";
import { type RoutingDecision, parseRouting, routingSchema } from "@pikar/contracts/routing";
import { EMAIL_DRAFTER_SKILL, EXECUTIVE_ROUTER_SKILL } from "@pikar/contracts/skill";
import { generateObject } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/** Single model knob so GRDL-03/05 (Phase 3) can vary the model in one place. */
const MODEL = "openai/gpt-4o-mini";

// `usage` shape lifted straight from the AI SDK's own return — version-independent, and
// (paired with the handler return annotations below) keeps these actions out of the
// `internal`-graph circular inference that sibling "use node" modules push past TS's limit.
type GenUsage = Awaited<ReturnType<typeof generateObject>>["usage"];

/**
 * Classify the request goal into a routing decision + step plan (AGNT-01/02).
 * parseRouting collapses any invalid model output to `unknown_route`; the action
 * THROWS it so the pipeline dead-letters deterministically instead of taking a
 * defaulted route (AGNT-03: never a silent default). Returns `usage` for telemetry.
 */
export const route = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (
    ctx,
    { requestId },
  ): Promise<{ routing: RoutingDecision; usage: GenUsage }> => {
    // Explicit result types: without them TS must resolve these through the `internal`
    // graph, which — once sibling "use node" action modules (gmail.ts) join it — tips
    // past its circular-inference limit and collapses this handler to `any` (guidelines §96).
    const req: { subject: string } | null = await ctx.runQuery(
      internal.gmailAuth.getForDelivery,
      { requestId },
    );
    if (!req) throw new Error(`llm.route: request ${requestId} not found`);
    // ponytail: getForDelivery.subject carries the raw goal pre-draft — reuse over a
    // second near-identical request reader. Add a dedicated getGoal query only if the
    // two shapes ever diverge.
    const goal = req.subject;

    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EXECUTIVE_ROUTER_SKILL,
    });

    // ponytail: `goal` is unredacted user text in Phase 2. A redact step slots in AHEAD
    // of this call at GRDL-01 (Phase 3) — do NOT hand-roll a partial redactor here.
    const { object, usage } = await generateObject({
      model: MODEL,
      schema: routingSchema,
      system: skill.body,
      prompt: goal,
    });

    const parsed = parseRouting(object);
    if (!parsed.ok) throw new Error(parsed.reason); // "unknown_route"
    return { routing: parsed.value, usage };
  },
});

/**
 * Draft a subject + plain-text body for the request goal (AGNT-02). Returns `usage`
 * for telemetry. Delivery (02-05 gmail.send) supplies the recipient separately.
 */
export const draft = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (
    ctx,
    { requestId },
  ): Promise<{ subject: string; body: string; usage: GenUsage }> => {
    // Explicit result types break the `internal`-graph circular inference (see route, above).
    const req: { subject: string } | null = await ctx.runQuery(
      internal.gmailAuth.getForDelivery,
      { requestId },
    );
    if (!req) throw new Error(`llm.draft: request ${requestId} not found`);
    const goal = req.subject;

    const skill: { body: string } = await ctx.runQuery(internal.skills.getActiveSkill, {
      name: EMAIL_DRAFTER_SKILL,
    });

    // ponytail: unredacted user goal in Phase 2 — the redact step precedes this call at
    // GRDL-01 (Phase 3).
    const { object, usage } = await generateObject({
      model: MODEL,
      schema: draftSchema,
      system: skill.body,
      prompt: goal,
    });
    return { subject: object.subject, body: object.body, usage };
  },
});
