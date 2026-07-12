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
    // The callback runs on the Convex site origin (:3211); it MUST bounce the browser back to
    // the app (SITE_URL) so the user never dead-ends on this domain in the same tab. Success →
    // the cockpit (gmailStatus is reactive, so the composer unlocks on arrival); any failure →
    // the connect page carrying a readable reason. See connect-gmail/page.tsx (?gmailError=).
    const site = process.env.SITE_URL ?? "http://localhost:3111";
    const seeOther = (path: string) => new Response(null, { status: 303, headers: { Location: `${site}${path}` } });
    const fail = (msg: string) => seeOther(`/connect-gmail?gmailError=${encodeURIComponent(msg)}`);

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return fail(`Gmail connection cancelled or failed: ${oauthError}`);
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return fail("Missing code or state — please try connecting again.");

    const tenantId = await verifyState(state);
    if (!tenantId) return fail("Invalid or tampered state — please try connecting again.");

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
      return fail("Token exchange with Google failed — please try connecting again.");
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
      return fail(
        "No refresh token returned. Remove Pikar's access at myaccount.google.com/permissions, then reconnect.",
      );
    }

    await ctx.runMutation(internal.gmailAuth.store, {
      tenantId,
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
      scope: tok.scope ?? "https://www.googleapis.com/auth/gmail.modify",
    });
    // Back to the cockpit — gmailStatus (reactive) flips the composer to connected on arrival.
    return seeOther("/dashboard/workspace");
  }),
});

export default http;
