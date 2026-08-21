// DLVR-02: the two-arm send dispatcher. THE seam every production send goes through.
//
// Deliberately thin. It answers one question — which mailbox does this row go out through — and
// hands off. All governance (suppression, the CAN-SPAM footer, attachment resolution, the audit
// ref) lives in the provider actions and, for the parts that must not diverge, in the single
// `prepareGovernedMessage` both of them call.
//
// WHY A DISPATCHER RATHER THAN A PROVIDER FIELD READ AT EACH CALLER: there are two production
// callers (`deliverApprovedPlan.ts` and `pipeline.ts`) and each is inside a retrier/workflow with
// its own terminal handling. Putting the routing decision in both means two places to add the
// third provider, and two places for the `?? "google"` legacy default to drift.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * The union of both arms' results. `messageId` is `""` on the Microsoft arm because Graph's
 * `sendMail` returns 202 with an empty body and has no id to give — see graph.ts.
 *
 * Explicit (guidelines §96): inferring this would resolve `internal.{gmail,graph}` through the
 * internal-api graph and collapse sibling actions to `any`.
 */
export type DeliveryResult =
  | {
      delivered: false;
      reason:
        | "not_connected"
        | "refresh_failed"
        | "suppressed"
        | "mail_scope_missing"
        | "too_large";
    }
  | { delivered: true; messageId: string };

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<DeliveryResult> => {
    const provider = await ctx.runQuery(internal.gmailAuth.mailProviderFor, { requestId });
    // ABSENCE MEANS GOOGLE, and that is the whole migration story. Every `requests` row written
    // before 25-05 predates the second provider and was a Gmail send; `mailProvider` is optional
    // precisely so those rows keep delivering with no backfill and no schema surgery.
    return provider === "microsoft"
      ? await ctx.runAction(internal.graph.send, { requestId })
      : await ctx.runAction(internal.gmail.send, { requestId });
  },
});
