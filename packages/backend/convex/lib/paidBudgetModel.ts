import { EVAL_MAX_OUTPUT_TOKENS } from "@pikar/cost/evalBudget";
import {
  goldenChatWireOptions,
  goldenOpenRouterObservedUsage,
  goldenProviderCeilingCents,
} from "@pikar/cost/goldenProviderBudget";
import { type LanguageModel, wrapLanguageModel } from "ai";
import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

function refuseCacheWrites(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "cacheControl" || key === "cache_control") && child !== undefined)
      throw new Error("PAID_CACHE_WRITE_UNSUPPORTED");
    refuseCacheWrites(child);
  }
}

/** Brackets every provider attempt, including SDK loop steps. All supported ordinary pins
 * already have reviewed provider bounds. Unsupported pins fail before egress. Ambiguous
 * responses keep their hold; settlement happens before parsing or subsequent tools can fail. */
export function paidBudgetModel(args: {
  ctx: GenericActionCtx<DataModel>;
  tenantId: string;
  model: LanguageModel;
  modelId: string;
  rail?: "ingest";
  onCost?: (usd: number) => void;
  /** Server-selected native website design context; never supplied by model tool arguments. */
  websiteDesign?: { planId: Id<"plans">; revision: number; runRef: string };
  beforeCall?: () => Promise<void>;
}): ReturnType<typeof wrapLanguageModel> {
  const kimi = args.modelId === "or/moonshotai/kimi-k3.1-pro";
  if (Boolean(args.websiteDesign) !== kimi || (args.websiteDesign && args.rail))
    throw new Error("PAID_WEBSITE_MODEL_SCOPE_INVALID");
  const call = {
    kind: "chat",
    model: args.modelId,
    maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS,
  } as const;
  const ceilingCents = goldenProviderCeilingCents(call);
  const options = goldenChatWireOptions(call);
  if (typeof args.model === "string") throw new Error("PAID_MODEL_UNSUPPORTED");
  return wrapLanguageModel({
    model: args.model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        if (params.tools?.some((tool) => tool.type !== "function"))
          throw new Error("PAID_HOSTED_TOOL_UNSUPPORTED");
        for (const message of params.prompt) {
          refuseCacheWrites(message.providerOptions);
          if (typeof message.content !== "string")
            for (const part of message.content) refuseCacheWrites(part.providerOptions);
        }
        return {
          ...params,
          maxOutputTokens: Math.min(
            params.maxOutputTokens ?? EVAL_MAX_OUTPUT_TOKENS,
            EVAL_MAX_OUTPUT_TOKENS,
          ),
          providerOptions: {
            openrouter: {
              ...options,
              ...(args.websiteDesign ? { reasoning: { effort: "low" as const } } : {}),
            },
          },
        };
      },
      wrapGenerate: async ({ doGenerate }) => {
        await args.beforeCall?.();
        const reservationId = await args.ctx.runMutation(internal.guardrails.reservePaidCall, {
          tenantId: args.tenantId,
          callId: crypto.randomUUID(),
          model: args.modelId,
          ceilingCents,
          rail: args.rail,
          ...(args.websiteDesign ? { websiteDesign: args.websiteDesign } : {}),
        });
        let result: Awaited<ReturnType<typeof doGenerate>>;
        try {
          result = await doGenerate();
        } catch {
          // Plain non-retryable error: a retry/fallback must not hide uncertain provider spend.
          throw new Error("PAID_MODEL_RESPONSE_UNRESOLVED");
        }
        const usage = result.providerMetadata?.openrouter?.usage as { cost?: unknown } | undefined;
        const costUsd = usage?.cost;
        if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0)
          throw new Error("PAID_COST_UNKNOWN");
        const observed = goldenOpenRouterObservedUsage(result.response?.body);
        if (observed?.isByok !== false || observed.costUsd !== costUsd)
          throw new Error("PAID_BILLING_MODE_UNVERIFIED");
        const settled = await args.ctx.runMutation(internal.guardrails.settlePaidCall, {
          tenantId: args.tenantId,
          reservationId,
          costUsd,
        });
        args.onCost?.(costUsd);
        if (settled.breached) throw new Error("PAID_PROVIDER_EXCEEDED_RESERVATION");
        return result;
      },
      wrapStream: async () => {
        throw new Error("PAID_STREAM_UNSUPPORTED");
      },
    },
  });
}
