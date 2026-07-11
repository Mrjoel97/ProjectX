"use node";

// Gmail delivery send action (DLVR-01). "use node": this module holds ONLY the send
// action — every DB touch goes through internal queries/mutations in gmailAuth.ts /
// pipeline.ts / audit.ts via ctx.runQuery/runMutation (01-07 rule: a "use node" module
// may contain only actions, and actions have no ctx.db).
//
// The pipeline (02-06) invokes this through `retrier.run(ctx, internal.gmail.send, ...)`,
// so retries + terminal→deadLetter routing are the retrier's job; here a 5xx THROWS
// (retry) and a dead refresh token routes to awaiting_reauth WITHOUT throwing (the
// approved draft is preserved and delivery resumes after the user reconnects).
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** RFC-2822 plain-text message. */
function buildMime(to: string, subject: string, body: string): string {
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
}

function base64Url(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.runQuery(internal.gmailAuth.getForDelivery, { requestId });
    if (!req) throw new Error(`gmail.send: request ${requestId} not found`);

    const token = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId: req.tenantId });
    if (!token) {
      // Never connected / disconnected — preserve the draft, prompt reconnect.
      await ctx.runMutation(internal.pipeline.setStatus, { requestId, status: "awaiting_reauth" });
      return { delivered: false, reason: "not_connected" as const };
    }

    // Refresh the access token on demand.
    const refreshRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!refreshRes.ok) {
      // 7-day refresh expiry (invalid_grant) → awaiting_reauth. Do NOT throw: throwing
      // would burn retrier attempts and eventually DLQ an approved draft the user can
      // still deliver by reconnecting. This resolves the token-expiry race for the user.
      await ctx.runMutation(internal.pipeline.setStatus, { requestId, status: "awaiting_reauth" });
      return { delivered: false, reason: "refresh_failed" as const };
    }
    const refreshed = (await refreshRes.json()) as { access_token: string; expires_in?: number };
    await ctx.runMutation(internal.gmailAuth.updateAccess, {
      tenantId: req.tenantId,
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
    });

    // Deliver via the Gmail REST API.
    const raw = base64Url(buildMime(req.recipient, req.subject, req.body));
    const sendRes = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (sendRes.status >= 500) {
      // Transient: THROW so the retrier retries; a terminal failure flows onComplete →
      // deadLetters → OPSG-07.
      throw new Error(`gmail.send: transient ${sendRes.status}`);
    }
    if (!sendRes.ok) {
      throw new Error(`gmail.send: ${sendRes.status} ${await sendRes.text()}`);
    }
    const sent = (await sendRes.json()) as { id: string };

    // Record the message id as an audit ref — refs/ids ONLY, never the body/PII (CLAUDE.md §4).
    // Status stays untouched: the pipeline owns the `sent` transition after retrier.run returns.
    await ctx.runMutation(internal.audit.log, {
      tenantId: req.tenantId,
      correlationId: req.correlationId,
      eventType: "gmail.sent",
      actor: "system",
      payload: { requestId, messageId: sent.id },
    });
    return { delivered: true, messageId: sent.id };
  },
});
