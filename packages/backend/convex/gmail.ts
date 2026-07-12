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
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// The ONE token-refresh root — both send() and search() call it (root-cause discipline,
// CLAUDE.md ladder rung 2). Reads the tenant's stored tokens, POSTs the refresh_token grant,
// persists the fresh access token. Returns a discriminated result — NEVER throws: a dead/
// disconnected token is a governed reauth signal, not a retriable failure. Each caller decides
// how to surface `false` (send → awaiting_reauth; search → notification + fall back to asking).
async function freshAccessToken(
  ctx: ActionCtx,
  tenantId: string,
): Promise<
  { ok: true; token: string } | { ok: false; reason: "not_connected" | "refresh_failed" }
> {
  const token = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId });
  if (!token) return { ok: false, reason: "not_connected" as const };

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
  if (!refreshRes.ok) return { ok: false, reason: "refresh_failed" as const };

  const refreshed = (await refreshRes.json()) as { access_token: string; expires_in?: number };
  await ctx.runMutation(internal.gmailAuth.updateAccess, {
    tenantId,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
  });
  return { ok: true, token: refreshed.access_token };
}

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

// Explicit return type: keeps `send` out of the internal-graph type-inference cycle.
// Inferring it from the body forces resolution of `internal.{pipeline,gmailAuth,audit}`,
// which (with llm.ts's actions doing the same) tips TS past its circular-inference limit
// and collapses sibling actions to `any` (Convex guidelines §96).
type SendResult =
  | { delivered: false; reason: "not_connected" | "refresh_failed" }
  | { delivered: true; messageId: string };

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<SendResult> => {
    const req = await ctx.runQuery(internal.gmailAuth.getForDelivery, { requestId });
    if (!req) throw new Error(`gmail.send: request ${requestId} not found`);

    // ponytail: SMOKE::fail sentinel — deterministic offline terminal throw for the fan-out
    // isolation smoke (mirrors llm.ts's fail=primary). The message carries no PII, and real
    // rows never start with it. Remove with the other SMOKE seams once a mock-Gmail smoke exists.
    if (req.subject.startsWith("SMOKE::fail")) {
      throw new Error("SMOKE_FAILURE: forced fan-out send failure");
    }

    // One refresh root (shared with search). A dead/disconnected token → awaiting_reauth
    // WITHOUT throwing: throwing would burn retrier attempts and eventually DLQ an approved
    // draft the user can still deliver by reconnecting (resolves the 7-day expiry race).
    const access = await freshAccessToken(ctx, req.tenantId);
    if (!access.ok) {
      await ctx.runMutation(internal.pipeline.setStatus, { requestId, status: "awaiting_reauth" });
      return { delivered: false, reason: access.reason };
    }

    // Deliver via the Gmail REST API.
    const raw = base64Url(buildMime(req.recipient, req.subject, req.body));
    const sendRes = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.token}`,
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
