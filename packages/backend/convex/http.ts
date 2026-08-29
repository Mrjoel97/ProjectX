import { GOOGLE_SCOPES, type MicrosoftCallbackError, notificationMessage } from "@pikar/core";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { verifyStripeSignature } from "./billingWebhook";
import { verifyState } from "./gmailAuth";
import { MICROSOFT_TOKEN_ENDPOINT, verifyMicrosoftState } from "./microsoftAuth";

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
    const seeOther = (path: string) =>
      new Response(null, { status: 303, headers: { Location: `${site}${path}` } });
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
      scope: tok.scope ?? GOOGLE_SCOPES,
    });
    // Back to the cockpit — gmailStatus (reactive) flips the composer to connected on arrival.
    return seeOther("/dashboard/workspace");
  }),
});

// Microsoft OAuth callback (17-06, ADR-018): validate `state`, exchange `code` for tokens, store
// internally. ONE grant covering Calendar AND Mail — Phase 25-06 consumes this row for Outlook and
// must NOT add a second callback here.
//
// TWO DELIBERATE DIVERGENCES FROM THE GMAIL ROUTE ABOVE, both tightenings:
//
//  1. **Fixed error codes, never provider text.** The Gmail route interpolates `${oauthError}` and
//     raw prose into its redirect. A Microsoft error body can carry the authorization code,
//     correlation ids and directory/tenant names, and a redirect is written to browser history, the
//     Referer header and every proxy log in between. So this maps failures onto the closed
//     `MICROSOFT_CALLBACK_ERRORS` set and the connect page owns the wording.
//  2. **No provider detail is thrown, either.** A thrown message becomes a Convex log line; the
//     failure paths return a redirect instead of throwing, so there is no error string to leak.
//
// The crown-jewel refresh token never touches the browser — it flows code → server → DB.
http.route({
  path: "/microsoft/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    // This runs on the Convex site origin; it MUST bounce the browser back to the app (SITE_URL)
    // so the user never dead-ends on this domain. Success → Connections, where the newly connected
    // card is what the user came to see. Failure → the connect page carrying only a fixed code.
    const site = process.env.SITE_URL ?? "http://localhost:3111";
    const seeOther = (path: string) =>
      new Response(null, { status: 303, headers: { Location: `${site}${path}` } });
    const fail = (code: MicrosoftCallbackError) =>
      seeOther(`/connect-microsoft?microsoftError=${code}`);

    const url = new URL(req.url);
    // Any provider-side refusal — user declined, admin consent required, invalid_client — collapses
    // to one code. The distinction is not actionable by the user and the detail is not safe to echo.
    if (url.searchParams.get("error")) return fail("cancelled");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return fail("missing_callback");

    // BEFORE the token POST, always. An unverified state must never reach a credentialed request:
    // that is what stops a forged callback from grafting an attacker's grant onto another tenant.
    const tenantId = await verifyMicrosoftState(state);
    if (!tenantId) return fail("invalid_state");

    const tokenRes = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? "",
        redirect_uri: process.env.MICROSOFT_CALENDAR_REDIRECT_URI ?? "",
        grant_type: "authorization_code",
      }),
    });
    // The body is NOT read on failure. Reading it invites logging it.
    if (!tokenRes.ok) return fail("exchange_failed");

    // Only known scalars are named. An unexpected field cannot ride along into the DB.
    const tok = (await tokenRes.json()) as {
      refresh_token?: string;
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    // No refresh token means a non-durable connection: it works until the first expiry and then
    // dies silently. Refuse it as a hard error so the user re-consents rather than half-connecting.
    if (!tok.refresh_token || !tok.access_token) return fail("missing_refresh");

    await ctx.runMutation(internal.microsoftAuth.store, {
      tenantId,
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
      // The GRANTED scope, not the requested one. Microsoft may return less than was asked for, and
      // storing MICROSOFT_SCOPES here would make `mailReady` claim a capability the grant lacks —
      // the exact lie the derived-readiness booleans exist to prevent. Fall back to empty, never to
      // the request: an unknown grant must read as un-ready, not as fully ready.
      scope: tok.scope ?? "",
    });
    return seeOther("/dashboard/profile");
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
    const { fromVersion, toVersion, inserted } = await ctx.runMutation(
      internal.skills.insertCandidate,
      {
        name,
        body,
      },
    );

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

    return Response.json({
      ok: true,
      fromVersion,
      toVersion,
      inserted,
      notified: inserted && !!ownerTenant,
    });
  }),
});

// ── The fal webhook: REMOVED (25.1-06, D14) ──────────────────────────────────────────────────
//
// The `/fal/callback/*` route, its HMAC path segment, its SSRF host allow-list and
// `mediaComplete.resolveJob` all died here. ADR-017 retired fal as a provider and ADR-024 records
// the second cutover to OpenAI; `submitLine` has not handed a webhook URL to anyone since. No
// provider could reach the route, so the only caller it could ever have had was somebody holding
// `FAL_WEBHOOK_SECRET` — a landing that writes a terminal `succeeded` and fetches an attacker-named
// URL, kept alive for nothing. Assets now land through `media.ts`'s poll-and-store path, which is
// where the "download here, never store the URL" rule (CLAUDE.md §4) lives today.

// ── The render BLOB route (MEDIA-01, plan 20-15) ──────────────────────────────────────────────
//
// The render runner lives in `apps/web` (D11 — that is where OIDC is automatic and no Vercel access
// token is needed), so the clips and voice takes have to reach it over HTTP. This route is how, and
// it is the THIRD use of the `/skillopt/export` bearer shape — the same fail-closed four lines.
//
// **Everything security-relevant comes from the ROW** (`http.ts:123-129`'s rule): the request
// carries ONE opaque job id and nothing else — no tenant, no path, no storage id. `normalizeId`
// refuses a malformed or foreign-table id, and a job that is not `succeeded` has no bytes.
//
// The tenant boundary is NOT here — it is upstream, in `renderReel.batchToRender`, which reads job
// ids through the tenant-prefixed `by_batch` index. Saying this route "checks the tenant" would be
// a phrase with no mechanism: it is handed an id it did not choose, and the only honest guarantee
// it can make is that it invents nothing.
//
// ponytail: a bearer-guarded blob route instead of handing out `ctx.storage.getUrl` results.
// `plans.attachmentUrls`' own header calls a signed storage URL a bearer capability; this keeps
// that capability inside the deployment and hands out only a secret we rotate — and it keeps
// `storage.getUrl`'s "only inside a tenantQuery" scan intact, which an httpAction could not
// satisfy. Upgrade path if the render ever runs somewhere we do not control: short-lived scoped
// read tokens, which is a real design rather than a URL.
//
// NO HMAC PATH SEGMENT. The reasoning is preserved from when the fal callback above did have one:
// a THIRD PARTY holds no secret of ours, so a per-job segment is the only thing that can
// authenticate it. Here the caller already proves knowledge of `MEDIA_RENDER_SECRET` in the header
// — and an HMAC keyed on that same secret is derivable by anyone who has it. Ceremony, not defence.
http.route({
  // `pathPrefix`, not a glob: Convex's router has no `*` syntax (the 20-06 lesson).
  pathPrefix: "/media/blob/",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.MEDIA_RENDER_SECRET;
    const authHeader = req.headers.get("Authorization");
    // Fail-closed: reject when the secret is unset OR the header is missing/mismatched.
    if (!expected || authHeader !== `Bearer ${expected}`) {
      return new Response("unauthorized", { status: 401 });
    }

    const raw = new URL(req.url).pathname.split("/").pop() ?? "";
    const asset = await ctx.runQuery(internal.render.renderReel.resolveRenderAsset, { raw });
    if (!asset) return new Response("not found", { status: 404 });

    const blob = await ctx.storage.get(asset.assetStorageId);
    if (!blob) return new Response("not found", { status: 404 });
    return new Response(blob, { headers: { "Content-Type": asset.mimeType } });
  }),
});

// ── The public unsubscribe route (PIPE-01, plan 19-04) ────────────────────────────────────────
//
// The phase's ONLY public unauthenticated route. It lives HERE and not in `apps/web` because
// `apps/web/middleware.ts` is default-deny (`isPublic` = `/`, `/privacy`, `/terms`, `/signin`,
// `/signup`): a page there costs a security-sensitive matcher edit PLUS a bearer-secret hop back
// into Convex to write the suppression. The Convex site origin is untouched by that middleware,
// which is why the fal webhook above works at all.
//
// NO ENV GUARD HERE, deliberately. `verifyUnsubToken` (`contacts.ts`) holds the single fail-closed
// `if (!secret) return null` on the verify path, and both entry points go through it. A second copy
// at this route would make that one vacuous — `contacts-crm.md` invariant 8.
//
// NO RATE LIMITER, deliberately. A valid segment requires the deployment secret and brute-forcing
// an HMAC-SHA-256 digest is infeasible; a per-address ceiling is meaningless when the operation is
// an idempotent upsert, so a replayed link re-suppresses the same row and shows the same
// confirmation. That idempotency IS the abuse mitigation. `@convex-dev/rate-limiter` is already a
// pinned component if that ever stops being true.
//
// Only 200 and 404 leave this route. One bare 404 for every rejection — a stale-but-well-formed
// token and a malformed one must be indistinguishable from outside.
//
// ponytail: inline styles mirroring the BRAND tokens. An httpAction cannot import globals.css, and
// moving this page to apps/web costs a default-deny middleware edit (isPublic in
// apps/web/middleware.ts) plus a bearer-secret hop back into Convex to write the suppression.
// Upgrade path: make that trade when this page needs to be more than one paragraph.

/** `<base64url(tenantId|recipient)>.<hmacHex>` — `gmailAuth.verifyState`'s idiom, verbatim. */
function unsubSegment(pathname: string): { raw: string; digest: string } | null {
  const segment = pathname.split("/").pop() ?? "";
  const dot = segment.lastIndexOf(".");
  if (dot <= 0) return null;
  return { raw: segment.slice(0, dot), digest: segment.slice(dot + 1) };
}

const unsubNotFound = () => new Response("not found", { status: 404 });

/** The recipient string is signed by US, but it is still tenant-authored text being echoed into
 *  markup — escape it rather than trust the signature to also mean "safe to interpolate". */
const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

/** BRAND §2 hex, copied (not imported — see the ponytail note): `--canvas` #f8fafc, `--card`
 *  #ffffff, `--ink` #0e1419, `--ink-soft` #55606c, `--rule` #d8dbe0, `--teal-900` #0b4f4a,
 *  `--teal-600` #009689 as a FILL under white text (BRAND §2: never small teal text). */
function unsubPage(heading: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${heading} · Pikar AI</title></head>` +
      `<body style="margin:0;padding:48px 16px;background:#f8fafc;color:#0e1419;` +
      `font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">` +
      `<main style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d8dbe0;` +
      `border-radius:12px;padding:32px;">` +
      `<p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:.08em;` +
      `text-transform:uppercase;color:#0b4f4a;">Pikar AI</p>` +
      `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:600;">${heading}</h1>` +
      body +
      `</main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** The addresses, echoed so the recipient can see WHICH mailbox they are about to unsubscribe. */
const unsubAddresses = (addresses: string[]) =>
  `<p style="margin:0 0 20px;font-size:16px;font-weight:600;word-break:break-all;">` +
  `${addresses.map(esc).join("<br>")}</p>`;

http.route({
  // `pathPrefix`, not a glob: Convex's router has no `*` syntax (the 20-06 lesson).
  pathPrefix: "/unsubscribe/",
  method: "GET",
  // THE GET NEVER WRITES. Corporate mail scanners and link prefetchers fire every URL in a
  // message, so a GET-suppresses design silently unsubscribes people who never clicked. The
  // confirm button below is what stops the feature firing itself; POST is the only mutating verb.
  handler: httpAction(async (ctx, req) => {
    const pathname = new URL(req.url).pathname;
    const parts = unsubSegment(pathname);
    if (!parts) return unsubNotFound();
    const resolved = await ctx.runQuery(internal.contacts.resolveUnsubToken, parts);
    if (!resolved) return unsubNotFound();

    const many = resolved.addresses.length > 1;
    return unsubPage(
      "Stop receiving these emails",
      `<p style="margin:0 0 8px;font-size:14px;color:#55606c;">This will stop email to:</p>` +
        unsubAddresses(resolved.addresses) +
        `<p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#55606c;">` +
        `Nothing has changed yet — opening this page does not unsubscribe anyone. Press the button ` +
        `and we will stop sending to ${many ? "those addresses" : "that address"}.</p>` +
        // Same-origin form POST, no JS: a fetch() from a Next page would need CORS on this origin.
        `<form method="POST" action="${esc(pathname)}">` +
        `<button type="submit" style="display:block;width:100%;padding:14px 20px;border:0;` +
        `border-radius:8px;background:#009689;color:#ffffff;font-size:16px;font-weight:600;` +
        `font-family:inherit;cursor:pointer;">Unsubscribe</button></form>`,
    );
  }),
});

http.route({
  pathPrefix: "/unsubscribe/",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const parts = unsubSegment(new URL(req.url).pathname);
    if (!parts) return unsubNotFound();
    // Resolved for the confirmation's address list; the mutation re-verifies from scratch and
    // never trusts this decode (contacts.ts — the POST cannot trust a decode its caller supplied).
    const resolved = await ctx.runQuery(internal.contacts.resolveUnsubToken, parts);
    if (!resolved) return unsubNotFound();
    await ctx.runMutation(internal.contacts.suppressFromUnsubscribe, parts);

    return unsubPage(
      "You have been unsubscribed",
      `<p style="margin:0 0 8px;font-size:14px;color:#55606c;">We will no longer email:</p>` +
        unsubAddresses(resolved.addresses) +
        `<p style="margin:0;font-size:15px;line-height:1.6;color:#55606c;">` +
        `You can close this page. If you receive another message from us, reply and tell us — ` +
        `pressing this button again is harmless but will not change anything.</p>`,
    );
  }),
});

// ── Phase 28.1: PIKAR'S OWN Stripe merchant account, charging outward ────────────────────────────
// NOT the Phase 28 `stripe*` connector (a tenant's account, read-only). See docs/playbooks/billing.md.
//
// THE ORDER OF THE FIRST FIVE LINES IS THE WHOLE SECURITY PROPERTY:
//   secret + header present -> read the raw body ONCE -> verify against THAT EXACT STRING ->
//   only then parse -> one transactional mutation.
// `req.json()` followed by a re-stringify would change key order and whitespace and break the
// HMAC; parsing before verifying would hand an unverified payload to a parser and the DB.
//
// This route is hand-verified with Web Crypto rather than Stripe's SDK because `http.ts` cannot be
// "use node" — Convex HTTP actions run in the query/mutation sandbox, so the synchronous
// `constructEvent` (Node crypto) is unreachable here and `stripe` is not a dependency.
http.route({
  path: "/billing/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // No development fallback (p25-no-dev-fallback). Unset means REFUSE, never "accept
    // unverified" — an unconfigured deployment must be silent, not credulous.
    const secret = process.env.BILLING_STRIPE_WEBHOOK_SECRET;
    const header = req.headers.get("stripe-signature");
    if (!secret || !header) return new Response("unauthorized", { status: 400 });

    const raw = await req.text(); // THE RAW STRING. Read once, verified as-is.
    if (!(await verifyStripeSignature(raw, header, secret, Math.floor(Date.now() / 1000)))) {
      return new Response("invalid signature", { status: 400 });
    }

    // Only AFTER verification is parsing safe.
    let event: { id?: unknown; type?: unknown; data?: { object?: { id?: unknown } } };
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response("malformed", { status: 400 });
    }
    if (typeof event.id !== "string" || typeof event.type !== "string") {
      return new Response("malformed", { status: 400 });
    }
    const objectId = event.data?.object?.id;

    await ctx.runMutation(internal.billingWebhook.receiveAndApply, {
      eventId: event.id,
      eventType: event.type,
      objectId: typeof objectId === "string" ? objectId : "",
    });
    // 2xx fast and unconditional once recorded. A non-2xx (or a timeout) is a delivery failure to
    // Stripe and buys a retry we have already deduped away.
    return new Response(null, { status: 200 });
  }),
});

export default http;
