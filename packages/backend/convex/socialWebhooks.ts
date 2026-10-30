import { isSocialProvider, socialHash, socialRecord, socialString } from "@pikar/core/social";
import {
  boundedSocialBody,
  equalSignature,
  socialHmac,
  verifySocialWebhook,
} from "@pikar/core/socialWebhook";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { internalMutation } from "./lib/tenantLifecycle";
import { socialProvider } from "./social";
/** App-level delivery health, refs only. No account identifiers or event content are persisted. */
export const recordDelivery = internalMutation({
  args: { provider: socialProvider, digest: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("socialWebhookReceipts")
      .withIndex("by_provider", (q) => q.eq("provider", a.provider))
      .unique();
    if (row?.digest === a.digest) return;
    if (row) await ctx.db.patch(row._id, { digest: a.digest, receivedAt: Date.now() });
    else await ctx.db.insert("socialWebhookReceipts", { ...a, receivedAt: Date.now() });
  },
});
export const receive = httpAction(async (ctx, req) => {
  const headers = { "Cache-Control": "no-store" },
    url = new URL(req.url);
  const match = /^\/social\/(x|meta|tiktok|youtube)\/webhook$/.exec(url.pathname);
  if (!match || !isSocialProvider(match[1]!)) return new Response(null, { status: 404, headers });
  const provider = match[1]!;
  const secret =
    provider === "youtube"
      ? process.env.YOUTUBE_WEBHOOK_SECRET
      : process.env[provider.toUpperCase() + "_OAUTH_CLIENT_SECRET"];
  if (!secret) return new Response(null, { status: 503, headers });
  try {
    if (req.method === "GET") {
      if (provider === "x") {
        const token = url.searchParams.get("crc_token");
        if (!token || token.length > 512 || url.searchParams.getAll("crc_token").length !== 1)
          throw new Error();
        return Response.json(
          { response_token: "sha256=" + (await socialHmac(secret, token, "SHA-256", true)) },
          { headers },
        );
      }
      const challenge = url.searchParams.get("hub.challenge");
      if (
        !challenge ||
        challenge.length > 1024 ||
        ["hub.challenge", "hub.mode", "hub.verify_token", "hub.topic"].some(
          (key) => url.searchParams.getAll(key).length > 1,
        )
      )
        throw new Error();
      if (provider === "meta") {
        const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
        if (
          !expected ||
          url.searchParams.get("hub.mode") !== "subscribe" ||
          !equalSignature(url.searchParams.get("hub.verify_token") ?? "", expected)
        )
          throw new Error();
      } else if (provider === "youtube") {
        const topic = url.searchParams.get("hub.topic") ?? "";
        if (
          !/^https:\/\/www\.youtube\.com\/xml\/feeds\/videos\.xml\?channel_id=[A-Za-z0-9_-]{1,128}$/.test(
            topic,
          ) ||
          !["subscribe", "unsubscribe"].includes(url.searchParams.get("hub.mode") ?? "") ||
          !equalSignature(
            url.searchParams.get("hub.verify_token") ?? "",
            await socialHmac(secret, topic),
          )
        )
          throw new Error();
      } else throw new Error();
      return new Response(challenge, { headers });
    }
    if (req.method !== "POST") return new Response(null, { status: 405, headers });
    const signature =
      req.headers.get(
        provider === "x"
          ? "x-twitter-webhooks-signature-oauth2"
          : provider === "tiktok"
            ? "tiktok-signature"
            : provider === "meta"
              ? "x-hub-signature-256"
              : "x-hub-signature",
      ) ?? "";
    const body = await boundedSocialBody(req);
    if (!(await verifySocialWebhook(provider, secret, body, signature)))
      return new Response(null, { status: 401, headers });
    if (provider !== "youtube") {
      const event = socialRecord(JSON.parse(body));
      if (
        provider === "tiktok" &&
        socialString(event.client_key) !== process.env.TIKTOK_OAUTH_CLIENT_ID
      )
        return new Response(null, { status: 401, headers });
    }
    await ctx.runMutation(internal.socialWebhooks.recordDelivery, {
      provider,
      digest: await socialHash(provider + ":webhook:" + body),
    });
    return new Response(null, { status: 200, headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
});
