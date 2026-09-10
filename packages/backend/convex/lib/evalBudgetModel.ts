import { EVAL_MAX_OUTPUT_TOKENS, EVAL_MODEL_BOUNDS } from "@pikar/cost/evalBudget";
import { type LanguageModel, wrapLanguageModel } from "ai";
import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

export type RetrievedEvalSources = {
  docIds: string[];
  titles: string[];
  origins: string[];
  chunks: string[];
};
export type EvalContext = {
  budgetId: Id<"spendEvents">;
  /** Trusted binding callback reading exactly the provisioned owned fixture documents. No RAG. */
  retrieveSources: (query: string) => Promise<RetrievedEvalSources>;
  /** Observations from the actual tool execution. Hashes and ids only, never source text. */
  onSources: (sources: readonly { docId: string; chunkHash: string }[]) => void;
  /** A failed governing source check poisons subsequent paid steps in the same turn. */
  failure?: "EVAL_SOURCE_READ_FAILED";
};
export type ImageInput = { bytes: ArrayBuffer; mimeType: "image/png" | "image/jpeg" };

function refuseCacheControl(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "cacheControl" || key === "cache_control") && child !== undefined)
      throw new Error("EVAL_CACHE_WRITE_UNSUPPORTED");
    refuseCacheControl(child);
  }
}

/** Native SDK middleware brackets EVERY low-level call, including loop steps and retries.
 * Missing provider cost / failed requests retain the entire reservation. They are never free.
 */
export function evalBudgetModel(args: {
  ctx: GenericActionCtx<DataModel>;
  tenantId: string;
  budgetId: Id<"spendEvents">;
  model: LanguageModel;
  modelId: string;
  onCost: (costUsd: number) => void;
  beforeCall?: () => void;
}): ReturnType<typeof wrapLanguageModel> {
  const bound = EVAL_MODEL_BOUNDS[args.modelId];
  if (!bound || typeof args.model === "string") throw new Error("EVAL_MODEL_UNSUPPORTED");
  return wrapLanguageModel({
    model: args.model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        if (params.maxOutputTokens !== EVAL_MAX_OUTPUT_TOKENS)
          throw new Error("EVAL_OUTPUT_LIMIT_REQUIRED");
        if (
          params.tools?.some(
            (tool) =>
              tool.type !== "function" || !["searchVault", "saveAsDocument"].includes(tool.name),
          )
        )
          throw new Error("EVAL_PAID_TOOL_UNSUPPORTED");
        // User/assistant/provider options can otherwise introduce cache writes, plugins or routing.
        for (const message of params.prompt) {
          refuseCacheControl(message.providerOptions);
          if (typeof message.content !== "string")
            for (const part of message.content) {
              refuseCacheControl(part.providerOptions);
              if (
                part.type === "file" &&
                (part.data.type !== "data" ||
                  !(part.data.data instanceof Uint8Array) ||
                  part.data.data.byteLength > 1_048_576 ||
                  !["image/png", "image/jpeg"].includes(part.mediaType))
              )
                throw new Error("EVAL_MEDIA_UNSUPPORTED");
            }
        }
        return {
          ...params,
          providerOptions: {
            openrouter: {
              max_tokens: EVAL_MAX_OUTPUT_TOKENS,
              n: 1,
              plugins: [],
              transforms: [],
              provider: {
                only: ["openai"],
                allow_fallbacks: false,
                require_parameters: true,
                max_price: {
                  prompt: bound.promptPerMillion,
                  completion: bound.completionPerMillion,
                  request: 0,
                  image: 0,
                },
              },
            },
          },
        };
      },
      wrapGenerate: async ({ doGenerate }) => {
        args.beforeCall?.();
        const reservationId = await args.ctx.runMutation(internal.guardrails.reserveEvalCall, {
          tenantId: args.tenantId,
          budgetId: args.budgetId,
          callId: crypto.randomUUID(),
          model: args.modelId,
          outputTokens: EVAL_MAX_OUTPUT_TOKENS,
        });
        const result = await doGenerate();
        const usage = result.providerMetadata?.openrouter?.usage as { cost?: unknown } | undefined;
        if (typeof usage?.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0)
          throw new Error("EVAL_COST_UNKNOWN");
        const settlement = await args.ctx.runMutation(internal.guardrails.settleEvalCall, {
          tenantId: args.tenantId,
          reservationId,
          costUsd: usage.cost,
        });
        args.onCost(usage.cost);
        if (settlement.breached) throw new Error("EVAL_PROVIDER_EXCEEDED_RESERVATION");
        return result;
      },
      wrapStream: async () => {
        throw new Error("EVAL_STREAM_UNSUPPORTED");
      },
    },
  });
}
