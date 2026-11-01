import { sha256Bytes } from "@pikar/core/webRuntime";
import { v } from "convex/values";
import { preflightStitchDesign, stitchConfigurationSummary } from "./lib/stitchDesignClient";
import { internalAction } from "./lib/tenantLifecycle";

export const STITCH_INCLUDED_CREDITS_DECLARATION =
  "operator_confirmed_included_free_credits_no_paid_overage" as const;
/** Shared exact-deployment guard. No caller-provided host or production fallback. */
export function assertPresenceDesignStage(): void {
  if (
    process.env.CONVEX_CLOUD_URL !== "https://third-gecko-977.convex.cloud" ||
    process.env.CONVEX_SITE_URL !== "https://third-gecko-977.convex.site"
  )
    throw new Error("PRESENCE_DESIGN_DEDICATED_STAGE_REQUIRED");
}

/** Internal operator probe only. The descriptor is hashed locally; it is never a generation prompt.
 * Included/no-overage is an explicit operator declaration, not provider-observed billed usage. */
export const preflight = internalAction({
  args: { billingBasis: v.literal(STITCH_INCLUDED_CREDITS_DECLARATION) },
  handler: async (_ctx, args) => {
    assertPresenceDesignStage();
    const descriptor = "pikar-stitch-read-only-protocol-preflight-v1";
    const scope = {
      tenantId: "operator_preflight",
      planId: "stitch_protocol_preflight",
      briefHash: sha256Bytes(new TextEncoder().encode(descriptor)),
      runRef: crypto.randomUUID(),
    };
    const result = await preflightStitchDesign(
      { scope, prompt: descriptor, deviceType: "DESKTOP" },
      {
        authorize: async (request) => {
          assertPresenceDesignStage();
          if (
            request.scope.tenantId !== scope.tenantId ||
            request.scope.planId !== scope.planId ||
            request.scope.runRef !== scope.runRef ||
            request.scope.briefHash !== scope.briefHash ||
            request.prompt !== descriptor ||
            request.deviceType !== "DESKTOP"
          )
            throw new Error("PRESENCE_DESIGN_PROBE_SCOPE_REFUSED");
        },
        beforeAttempt: async (attempt) => {
          assertPresenceDesignStage();
          if (
            attempt.potentiallyGenerative ||
            !["initialize", "initialized", "tools_list"].includes(attempt.operation)
          )
            throw new Error("PRESENCE_DESIGN_PROBE_READ_ONLY");
          return { reservationRef: `readonly_${attempt.operation}` };
        },
        afterAttempt: async () => {},
        checkpoint: async () => {
          throw new Error("PRESENCE_DESIGN_PROBE_READ_ONLY");
        },
        requestTimeoutMs: 20000,
      },
    );
    return {
      deployment: "third-gecko-977" as const,
      configuration: stitchConfigurationSummary(),
      billing: { basis: args.billingBasis, providerActualCost: "not_reported" as const },
      result,
    };
  },
});
