import { EVAL_MAX_OUTPUT_TOKENS, EVAL_MODEL_BOUNDS } from "@pikar/cost/evalBudget";
import {
  goldenChatWireOptions,
  goldenOpenRouterObservedUsage,
  goldenProviderCeilingCents,
} from "@pikar/cost/goldenProviderBudget";
import {
  APICallError,
  InvalidResponseDataError,
  JSONParseError,
  type LanguageModel,
  TypeValidationError,
  wrapLanguageModel,
} from "ai";
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

const FAILED_CONSERVATIVE_PREFIX = "EVAL_MODEL_RESPONSE_FAILED_CONSERVATIVE";
// The authoring probe's counterpart. An AMBIGUOUS attempt (transport failed, outcome unknown)
// settles NOTHING, so its token must not borrow the `…FAILED_CONSERVATIVE` name — a reader would
// then read a settlement that never happened.
const UNRESOLVED_HOLD_PREFIX = "EVAL_PROVIDER_ATTEMPT_UNRESOLVED";
const MAX_DIAGNOSTIC_BODY_BYTES = 8_192;
const FAILURE_DIAGNOSTIC_CATEGORIES = ["TOOL_SCHEMA", "ROUTING", "MODEL", "CONTEXT"] as const;
type FailureDiagnosticCategory = (typeof FAILURE_DIAGNOSTIC_CATEGORIES)[number] | "UNKNOWN";

const PROVIDER_ERROR_CODES: Readonly<Record<string, FailureDiagnosticCategory>> = {
  invalid_tool_schema: "TOOL_SCHEMA",
  tool_schema_invalid: "TOOL_SCHEMA",
  no_available_provider: "ROUTING",
  provider_not_available: "ROUTING",
  routing_error: "ROUTING",
  model_not_found: "MODEL",
  invalid_model: "MODEL",
  context_length_exceeded: "CONTEXT",
  max_context_length_exceeded: "CONTEXT",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Categorize only exact, code-owned provider codes/parameter paths from a small envelope. */
function structuredHttp400Category(responseBody: unknown, depth = 0): FailureDiagnosticCategory {
  if (depth > 1) return "UNKNOWN";
  if (
    typeof responseBody !== "string" ||
    responseBody.length === 0 ||
    new TextEncoder().encode(responseBody).byteLength > MAX_DIAGNOSTIC_BODY_BYTES
  )
    return "UNKNOWN";
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return "UNKNOWN";
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).some((key) => !["error", "user_id"].includes(key)) ||
    (parsed.user_id !== undefined &&
      (typeof parsed.user_id !== "string" || parsed.user_id.length > 256)) ||
    !isRecord(parsed.error) ||
    Object.keys(parsed.error).some(
      (key) => !["code", "message", "type", "param", "metadata"].includes(key),
    )
  )
    return "UNKNOWN";

  const error = parsed.error;
  const candidates: FailureDiagnosticCategory[] = [];
  if (typeof error.code === "string") {
    if (!Object.hasOwn(PROVIDER_ERROR_CODES, error.code)) return "UNKNOWN";
    const category = PROVIDER_ERROR_CODES[error.code];
    if (category === undefined) return "UNKNOWN";
    candidates.push(category);
  } else if (error.code !== undefined && error.code !== null && error.code !== 400) {
    return "UNKNOWN";
  }
  if (
    (error.message !== undefined &&
      (typeof error.message !== "string" || error.message.length > MAX_DIAGNOSTIC_BODY_BYTES)) ||
    (error.type !== undefined &&
      error.type !== null &&
      (typeof error.type !== "string" || error.type !== "invalid_request_error")) ||
    (error.param !== undefined && error.param !== null && typeof error.param !== "string")
  )
    return "UNKNOWN";
  if (
    typeof error.param === "string" &&
    /^tools\[(?:0|[1-9][0-9]{0,2})\]\.function\.parameters$/.test(error.param)
  )
    candidates.push("TOOL_SCHEMA");
  // OpenRouter sometimes wraps a provider's serialized error under metadata.raw.
  if (error.metadata !== undefined) {
    if (
      !isRecord(error.metadata) ||
      Object.keys(error.metadata).some(
        (key) => !["raw", "provider_name", "is_byok"].includes(key),
      ) ||
      (error.metadata.provider_name !== undefined &&
        (typeof error.metadata.provider_name !== "string" ||
          error.metadata.provider_name.length > 128)) ||
      (error.metadata.is_byok !== undefined && typeof error.metadata.is_byok !== "boolean")
    )
      return "UNKNOWN";
    if (error.metadata.raw !== undefined) {
      if (typeof error.metadata.raw !== "string") return "UNKNOWN";
      const inner = structuredHttp400Category(error.metadata.raw, depth + 1);
      if (inner === "UNKNOWN") return "UNKNOWN";
      candidates.push(inner);
    }
  }
  const first = candidates[0];
  return first !== undefined && candidates.every((category) => category === first)
    ? first
    : "UNKNOWN";
}

/**
 * The closed, content-free CLASS of a failed provider attempt. Shared by the golden suite's
 * conservative settlement and the probe's retained hold so the two classifiers cannot drift.
 * Same rule as `closedGoldenFailureToken`: no message, body, header, URL or arbitrary name.
 */
function closedProviderFailureClass(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const httpClass =
      typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
        ? `HTTP_${status}`
        : "HTTP_UNKNOWN";
    return status === 400
      ? `${httpClass}_CATEGORY_${structuredHttp400Category(error.responseBody)}`
      : httpClass;
  }
  if (JSONParseError.isInstance(error)) return "PARSE";
  if (TypeValidationError.isInstance(error) || InvalidResponseDataError.isInstance(error))
    return "SCHEMA";
  if (error instanceof DOMException && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof DOMException && error.name === "AbortError") return "ABORT";
  return "UNKNOWN";
}

/**
 * A terminal golden failure must be diagnosable without exposing an SDK error's message, body,
 * headers, URL, or arbitrary name. This token stays within existing Workflow error logging.
 */
export function closedGoldenFailureToken(error: unknown): string {
  return `${FAILED_CONSERVATIVE_PREFIX}_${closedProviderFailureClass(error)}`;
}

/**
 * The authoring-probe counterpart of `closedGoldenFailureToken`, for a RETAINED hold rather than a
 * conservative settlement (23-EXECUTION-PREPARATION: "an unresolved attempt retains its whole
 * hold"). The value is only ever consumed as `new Error(token)`, and THAT is load-bearing: a bare
 * `Error` has `name === "Error"`, which `isFallbackEligible` cannot match. Re-throwing the original
 * transport failure instead would preserve its `TimeoutError`/`AbortError` name, and the agent
 * loop's cross-model rollover would then spend a SECOND authorised call on the same envelope.
 */
function closedUnresolvedHoldToken(error: unknown): string {
  return `${UNRESOLVED_HOLD_PREFIX}_${closedProviderFailureClass(error)}`;
}

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
  /** Authoring-probe discriminator: an ambiguous attempt RETAINS its whole reservation instead of
   *  settling the golden ceiling, and must never authorise a second paid call (23-PREPARATION:
   *  "Ambiguous provider attempts retain holds and do not trigger an automatic paid retry"). Absent
   *  everywhere else, so every other `mode: "golden"` caller keeps the byte-identical settle. */
  retainUnresolvedHold?: boolean;
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
            // The @openrouter provider SPREADS these keys into the top-level request body —
            // only keys OpenRouter's documented chat-completions schema accepts may appear
            // here, and no `require_parameters` filter (the `n`/`plugins` incidents: see
            // @pikar/cost goldenChatWireOptions / openRouterProvider).
            openrouter: goldenOptions ?? {
              max_tokens: EVAL_MAX_OUTPUT_TOKENS,
              provider: {
                only: ["openai"],
                order: ["openai"],
                allow_fallbacks: false,
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
          // The probe's own failure policy, checked BEFORE the golden settle: an ambiguous attempt
          // keeps its WHOLE hold — never settled, never released — so the envelope can neither
          // close nor authorise another call, and no second paid retry is ever attempted. The
          // throw is a fresh bare `Error`, never the original error, so `isFallbackEligible` cannot
          // read an inherited TimeoutError/AbortError and roll over to a second authorised call.
          if (args.retainUnresolvedHold) throw new Error(closedUnresolvedHoldToken(error));
          // A golden provider failure is terminal and is never replayed. Charge the full reserved
          // ceiling instead of leaving an uncloseable hold: this may overstate spend, but can never
          // understate exposure, and the explicit basis prevents it being mistaken for observed
          // provider usage. The original error remains content-private.
          if (goldenOptions) {
            await args.ctx.runMutation(internal.guardrails.settleEvalCall, {
              tenantId: args.tenantId,
              reservationId,
              costUsd: goldenProviderCeilingCents(goldenCall) / 100,
              settlementBasis: "conservative_ceiling",
            });
            throw new Error(closedGoldenFailureToken(error));
          }
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
