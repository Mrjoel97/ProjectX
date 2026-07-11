import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyState } from "./gmailAuth";

const http = httpRouter();

// Wire Convex Auth sign-in/callback httpAction routes.
auth.addHttpRoutes(http);

// Gmail OAuth callback: validate `state`, exchange `code` for tokens, store internally.
// The crown-jewel refresh token never touches the browser — it flows code → server → DB.
http.route({
  path: "/gmail/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return new Response(`Gmail connection cancelled or failed: ${oauthError}`, { status: 400 });
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return new Response("Missing code or state", { status: 400 });

    const tenantId = await verifyState(state);
    if (!tenantId) return new Response("Invalid or tampered state", { status: 400 });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
        redirect_uri: process.env.GMAIL_OAUTH_REDIRECT_URI ?? "",
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      return new Response("Token exchange failed", { status: 502 });
    }
    const tok = (await tokenRes.json()) as {
      refresh_token?: string;
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    // Pitfall 3: no refresh_token means Google reused a prior grant (missing offline+consent).
    // Surface it as a hard error so the user re-consents rather than silently half-connecting.
    if (!tok.refresh_token || !tok.access_token) {
      return new Response(
        "No refresh token returned. Remove Pikar's access at myaccount.google.com/permissions, then reconnect.",
        { status: 400 },
      );
    }

    await ctx.runMutation(internal.gmailAuth.store, {
      tenantId,
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
      scope: tok.scope ?? "https://www.googleapis.com/auth/gmail.modify",
    });
    return new Response("Gmail connected. You can close this tab and return to Pikar.", {
      status: 200,
    });
  }),
});

export default http;
