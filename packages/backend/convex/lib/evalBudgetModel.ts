import { EVAL_MAX_OUTPUT_TOKENS, EVAL_MODEL_BOUNDS } from "@pikar/cost/evalBudget";
import {
  goldenChatWireOptions,
  goldenOpenRouterObservedUsage,
} from "@pikar/cost/goldenProviderBudget";
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
  /** General golden suite uses real local tools/RAG; native vertical grants stay closed. */
  mode?: "golden";
}): ReturnType<typeof wrapLanguageModel> {
  const goldenCall = {
    kind: "chat",
    model: args.modelId,
    maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS,
  } as const;
  const goldenOptions = args.mode === "golden" ? goldenChatWireOptions(goldenCall) : undefined;
  const bound = EVAL_MODEL_BOUNDS[args.modelId];
  if ((!bound && !goldenOptions) || typeof args.model === "string")
    throw new Error("EVAL_MODEL_UNSUPPORTED");
  return wrapLanguageModel({
    model: args.model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        if (!goldenOptions && params.maxOutputTokens !== EVAL_MAX_OUTPUT_TOKENS)
          throw new Error("EVAL_OUTPUT_LIMIT_REQUIRED");
        if (
          params.tools?.some(
            (tool) =>
              tool.type !== "function" ||
              (!goldenOptions && !["searchVault", "saveAsDocument"].includes(tool.name)),
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
          maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS,
          providerOptions: {
            openrouter: goldenOptions ?? {
              max_tokens: EVAL_MAX_OUTPUT_TOKENS,
              n: 1,
              plugins: [],
              transforms: [],
              provider: {
                only: ["openai"],
                allow_fallbacks: false,
                require_parameters: true,
                max_price: {
                  prompt: bound?.promptPerMillion ?? 0,
                  completion: bound?.completionPerMillion ?? 0,
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
          ...(goldenOptions ? { providerCall: goldenCall } : {}),
        });
        let result: Awaited<ReturnType<typeof doGenerate>>;
        try {
          result = await doGenerate();
        } catch (error) {
          // Ambiguous golden requests retain their hold; neither SDK nor model fallback may
          // silently submit the same paid operation again after an uncertain provider response.
          if (goldenOptions) throw new Error("EVAL_MODEL_RESPONSE_UNRESOLVED");
          throw error;
        }
        const usage = result.providerMetadata?.openrouter?.usage as
          | { cost?: unknown; is_byok?: unknown }
          | undefined;
        if (typeof usage?.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0)
          throw new Error("EVAL_COST_UNKNOWN");
        // Unsupported billing has unknown external cost. Keep the entire hold so a swallowed
        // tool error cannot leave a clean ledger capable of issuing passing evidence.
        if (goldenOptions) {
          // Pinned OpenRouter SDK preserves raw response.body but omits is_byok from its
          // derived providerMetadata. Inspect the same response, without a second request.
          const observed = goldenOpenRouterObservedUsage(result.response?.body);
          if (observed?.isByok !== false || observed.costUsd !== usage.cost)
            throw new Error("EVAL_MODEL_BILLING_MODE_UNVERIFIED");
        }
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
