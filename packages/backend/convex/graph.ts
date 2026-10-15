"use node";

// DLVR-02: the Microsoft Graph SEND ADAPTER. Sibling of `gmail.ts`'s send action, and deliberately
// nothing more than that.
//
// WHAT THIS MODULE DOES NOT DO, each for a reason:
//
//  - It does NOT refresh, rotate or write `microsoftCalendarTokens`. `freshGraphToken` in
//    microsoftCalendar.ts is the ONE refresh root over that row (ADR-018 — one grant serves both
//    Calendar and Mail). A second refresh path over one row is a token-rotation race: two
//    concurrent refreshes both POST the same refresh_token, Microsoft rotates it on the first, and
//    the second persists a token the provider has already invalidated.
//  - It does NOT restate the governance guards. Suppression and the CAN-SPAM footer come from
//    `prepareGovernedMessage` in gmail.ts — the SAME function the Google arm calls. Two copies of
//    an unbypassable guard is how a bypass gets built.
//  - It does NOT mint a message id. Graph's `/me/sendMail` returns 202 with an EMPTY body; there
//    is no id to record, and fabricating one would put a lie in the audit log.
import { microsoftMailReady } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { prepareGovernedMessage } from "./gmail";
import { fixtureSeamFor } from "./lib/models";
import { internalAction } from "./lib/tenantLifecycle";
import { freshGraphToken } from "./microsoftCalendar";

const GRAPH_SEND_ENDPOINT = "https://graph.microsoft.com/v1.0/me/sendMail";

/**
 * Graph's documented ceiling for a `sendMail` request is 4 MB of request body. The MIME is
 * base64'd into that body (~4/3 expansion), so refuse above 3 MB of raw MIME rather than letting
 * Graph reject it after the token round trip.
 * ponytail: one flat ceiling. The large-attachment path is an upload session, which is a whole
 * feature and nothing in the beta needs it.
 */
const MAX_MIME_BYTES = 3 * 1024 * 1024;

// Explicit return type (guidelines §96): never inferred through the internal-api graph, or a
// sibling action collapses to `any`. Mirrors gmail.ts's SendResult, plus the two refusals that
// only exist on this side.
type GraphSendResult = import("./delivery").DeliveryResult;

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<GraphSendResult> => {
    const req = await ctx.runQuery(internal.gmailAuth.getForDelivery, { requestId });
    if (!req) throw new Error(`graph.send: request ${requestId} not found`);

    // Same offline smoke seam as the Google arm, so a fan-out isolation smoke behaves identically
    // whichever provider a row carries.
    if (req.subject.startsWith("SMOKE::fail") && fixtureSeamFor(req.tenantId)) {
      throw new Error("SMOKE_FAILURE: forced fan-out send failure");
    }

    // THE SCOPE CHECK COMES BEFORE THE SEND, not after Graph rejects it. A 17-05-era grant was
    // Calendar-only: the row exists, the refresh works, and the token is real — it simply cannot
    // send mail. Discovering that inside Graph would surface as an opaque 403 on the delivery
    // path; here it is a named refusal the UI can turn into "reconnect Microsoft to grant Mail.Send".
    const scope = await ctx.runQuery(internal.microsoftAuth.grantedScope, {
      tenantId: req.tenantId,
    });
    if (scope === null) return { delivered: false, reason: "not_connected" };
    if (!microsoftMailReady(scope)) return { delivered: false, reason: "mail_scope_missing" };

    // A dead grant → awaiting_reauth WITHOUT throwing, exactly as the Google arm does: throwing
    // would burn retrier attempts and eventually DLQ an approved draft the user can still deliver
    // by reconnecting.
    const access = await freshGraphToken(ctx, req.tenantId, Date.now());
    if (!access.ok) {
      // `transient`/`unavailable` are the retrier's business — throw so it retries.
      if (access.reason === "transient" || access.reason === "unavailable") {
        throw new Error(`graph.send: transient token failure (${access.reason})`);
      }
      await ctx.runMutation(internal.pipeline.setStatus, { requestId, status: "awaiting_reauth" });
      return {
        delivered: false,
        reason: access.reason === "not_connected" ? "not_connected" : "refresh_failed",
      };
    }

    const prepared = await prepareGovernedMessage(ctx, req);
    if (!prepared.ok) return { delivered: false, reason: prepared.reason };

    // STANDARD base64, not URL-safe. That single line is the whole byte-level divergence from the
    // Gmail arm — the MIME above it is produced by the same buildMime call.
    const raw = Buffer.from(prepared.mime, "utf8");
    if (raw.byteLength > MAX_MIME_BYTES) return { delivered: false, reason: "too_large" };

    const claim = await ctx.runMutation(internal.delivery.claim, {
      requestId,
      provider: "microsoft",
    });
    if (!claim.proceed) return claim.result;
    try {
      const sendRes = await fetch(GRAPH_SEND_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${access.token}`,
          "Content-Type": "text/plain",
        },
        body: raw.toString("base64"),
      });
      // No provider response body enters errors, logs or dead letters.
      // Even HTTP errors are conservatively held: this adapter cannot prove non-delivery.
      if (!sendRes.ok) throw new Error("DELIVERY_NOT_CONFIRMED");
      const messageId = "";
      await ctx.runMutation(internal.delivery.confirm, { requestId, messageId });
      return { delivered: true, messageId };
    } catch {
      await ctx.runMutation(internal.delivery.markUnknown, { requestId });
      return { delivered: false, reason: "outcome_unknown" };
    }
  },
});
