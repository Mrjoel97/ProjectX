import { notificationMessage } from "@pikar/core";
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

// IMPR-02 trajectory export: the authenticated seam the CI SkillOpt job pulls PII-scrubbed
// trajectories from. Auth is a shared bearer token (SKILLOPT_TOKEN) — this is the owner's OWN
// deployment and the CI job holds the token, so a shared secret is the ponytail-right auth here
// (no OAuth). All scrubbing + fail-closed dropping happens in buildTrajectoryExport; this route
// only gates access and serializes the result.
http.route({
  path: "/skillopt/export",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.SKILLOPT_TOKEN;
    const auth = req.headers.get("Authorization");
    // Fail-closed: reject when the token is unset OR the header is missing/mismatched.
    if (!expected || auth !== `Bearer ${expected}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const data = await ctx.runQuery(internal.skilloptExport.buildTrajectoryExport, {});
    return Response.json(data);
  }),
});

// IMPR-02 write-back + IMPR-03 evidence: the CI SkillOpt job POSTs an accepted (held-out-eval-passing)
// skill body back here. It lands as a CANDIDATE through insertCandidate (routes through the registry
// gate — never a raw patch, never active; §5) — the owner does the SEPARATE activateSkill click (Plan
// 06 ops control), which only passes EVAL_GATE after eval:golden records evidence. Auth is the same
// SKILLOPT_TOKEN bearer as /export (fail-closed 401). We write ONE insert-only, refs/counts-ONLY audit
// row (§3/§4 — no body, no prose) and notify the owner "candidate ready" through the notify choke point.
http.route({
  path: "/skillopt/writeback",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.SKILLOPT_TOKEN;
    const authHeader = req.headers.get("Authorization");
    if (!expected || authHeader !== `Bearer ${expected}`) {
      return new Response("unauthorized", { status: 401 });
    }

    const { name, body, runId, negativeRate, sampleCount } = (await req.json()) as {
      name: string;
      body: string;
      runId: string;
      negativeRate: number;
      sampleCount: number;
    };

    // SECURITY: the audit/notify tenant is NOT taken from the request body — a body-supplied
    // tenantId is attacker-controllable (anyone with SKILLOPT_TOKEN could aim an audit row or a
    // notification at an arbitrary tenant = cross-tenant write / IDOR). It comes from trusted
    // server-side config (SKILLOPT_OWNER_TENANT env, same trust class as SKILLOPT_TOKEN). The owner
    // sets it when configuring the optimizer; the dormant-ship default means writeback isn't
    // legitimately called until then. ponytail: env config is the owner-scoped source — a per-owner
    // config row only becomes worth it once there is more than one owner (Phase 9).
    const ownerTenant = process.env.SKILLOPT_OWNER_TENANT;

    // Route the optimized body through the registry gate. A non-gated name throws here → 500 (rejected).
    // The skill registry is GLOBAL (insertCandidate is tenant-agnostic), so the candidate lands
    // regardless — only the tenant-scoped audit/notify below depend on a trusted owner tenant.
    const { fromVersion, toVersion, inserted } = await ctx.runMutation(internal.skills.insertCandidate, {
      name,
      body,
    });

    // Only a genuinely NEW candidate is an optimization: an idempotent repost writes no audit/notify (no churn).
    // Skip the tenant-scoped audit/notify when no trusted owner tenant is configured rather than
    // writing them against an untrusted tenant — the global candidate is still safely inserted above.
    if (inserted && ownerTenant) {
      // IMPR-03: ONE insert-only audit row — refs/counts ONLY (§3/§4). No skill body, no user content.
      await ctx.runMutation(internal.audit.log, {
        tenantId: ownerTenant,
        correlationId: runId,
        eventType: "skill.optimized",
        actor: "skillopt",
        payload: { skillName: name, fromVersion, toVersion, runId, negativeRate, sampleCount },
      });

      // Owner "candidate ready" notification via the choke point — the static label carries no refs/content (§4).
      await ctx.runMutation(internal.notifications.notify, {
        tenantId: ownerTenant,
        kind: "optimizer.candidate",
        message: notificationMessage("optimizer.candidate"),
      });
    }

    return Response.json({ ok: true, fromVersion, toVersion, inserted, notified: inserted && !!ownerTenant });
  }),
});

export default http;
