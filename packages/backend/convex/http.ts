import { GOOGLE_SCOPES, notificationMessage } from "@pikar/core";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { verifyState } from "./gmailAuth";
import { contentHash } from "./lib/hash";

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

// ── The fal webhook (MEDIA-01, plan 20-06) ───────────────────────────────────────────────────
//
// The landing half of the media spine. It proves the caller knows a secret we minted for THIS job,
// downloads the asset bytes HERE, stores them under the tenant, and discards the URL.
//
// **Downloading inside the webhook is what makes CLAUDE.md §4 structural instead of a promise.** A
// signed fal URL is BOTH a content leak and a live credential; by fetching and storing here there is
// nowhere in the schema for one to live, and the §4 scans in `llmRedaction.test.ts` pin that.
//
// ponytail: HMAC path segment, not Ed25519/JWKS. The segment proves the caller knows a secret we
// minted for THIS job; it does NOT prove fal sent it. Upgrade path when that matters: verify
// `X-Fal-Webhook-Signature` (Ed25519 over `request_id\nuser_id\ntimestamp\nsha256(body)`) against
// fal's JWKS at `https://rest.fal.ai/.well-known/jwks.json`, cached <=24 h. FIRST confirm the Convex
// default runtime's `crypto.subtle` supports Ed25519 — UNVERIFIED, research Open Question 3,
// deliberately deferred out of this phase — and note that a file holding an `http.route` cannot be
// "use node", so `node:crypto` is only reachable via an extra `runAction` hop.
const FAL_TIMESTAMP_TOLERANCE_S = 300;
/** Hosts an asset may be downloaded from. The URL comes from a third party, so an unguarded fetch
 *  here is an SSRF into whatever the caller names — and the caller only had to know ONE job's
 *  digest. Suffix match, so `v3.fal.media` passes and `fal.media.evil.com` does not. */
const FAL_ASSET_HOSTS = ["fal.media", "fal.ai", "fal.run"];
/** ~4 MB is a typical 10 s 480p clip (playbook: ~55 MB across a 13-line job). This is an abuse
 *  ceiling, not a budget: a provider that returns something enormous fails the line loudly. */
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

/** ONE arm per kind, keyed on the ROW's kind — never on the payload's shape. `stt` is added by plan
 *  20-17; until then an unhandled kind fails with a code, because "find whatever url is in this body"
 *  is a third party choosing what we download. */
const ASSET_PATH: Record<string, (p: Record<string, unknown>) => unknown> = {
  video: (p) => (p.video as Record<string, unknown> | undefined)?.url,
  image: (p) => (p.images as Array<Record<string, unknown>> | undefined)?.[0]?.url,
  // 20-14. `fal-ai/inworld-tts` returns `{ audio: { url, content_type, file_name, file_size } }` —
  // no duration, no character count, and no moderation field. Everything downstream of this line is
  // the SAME code a video take walks; that sameness is the plan's whole argument.
  tts: (p) => (p.audio as Record<string, unknown> | undefined)?.url,
};

/**
 * Kinds whose asset arrives INLINE in the callback rather than as a URL to fetch (plan 20-17).
 *
 * `scribe-v2` returns `{ words: [{ text, start, end, type, speaker_id }] }` in the payload itself —
 * there is no file and no URL, so the whole fetch-and-host-check path below simply does not apply.
 * Storing it is still the right move: the transcript is the burn stage's input, and a payload that
 * lived only in this request would have to be re-bought to be re-burned.
 *
 * Re-serialised rather than stored verbatim: the bytes that reach storage are then a value WE
 * produced from a shape we checked, not a provider's response body echoed onto disk.
 */
const INLINE_ASSET: Record<
  string,
  // `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: TS 5.9 made the view generic over its
  // buffer, and the bare form is the SharedArrayBuffer-permitting supertype that `Blob` rejects.
  (p: Record<string, unknown>) => { bytes: Uint8Array<ArrayBuffer>; mimeType: string } | null
> = {
  stt: (p) => {
    if (!Array.isArray(p.words)) return null;
    const words = p.words.flatMap((w) => {
      const o = w as Record<string, unknown>;
      if (typeof o.text !== "string") return [];
      if (typeof o.start !== "number" || typeof o.end !== "number") return [];
      // `type` absent means a plain word: the provider omits it on some rows and captions must not
      // silently lose those. Anything else is carried through and dropped by the .ass writer.
      return [{ text: o.text, start: o.start, end: o.end, type: String(o.type ?? "word") }];
    });
    return {
      bytes: new TextEncoder().encode(JSON.stringify({ words })),
      mimeType: "application/json",
    };
  },
};

/** The provider's checker, or `null` when it said nothing at all. `null` is NOT `false`. */
function moderationOf(p: Record<string, unknown>): boolean | null {
  const flags = p.has_nsfw_concepts;
  if (!Array.isArray(flags) || flags.length === 0) return null;
  return flags.some((f) => f === true);
}

/** What fal says it actually produced, by kind. Absent fields stay absent — the submitted spec then
 *  stands, and `landResult` records that as a re-price rather than a guess. */
function actualOf(kind: string, p: Record<string, unknown>): Record<string, unknown> | undefined {
  if (kind !== "image") return undefined;
  const first = (p.images as Array<Record<string, unknown>> | undefined)?.[0];
  const width = typeof first?.width === "number" ? first.width : undefined;
  const height = typeof first?.height === "number" ? first.height : undefined;
  return width === undefined && height === undefined ? undefined : { width, height };
}

/** A CODE from the provider's error, never its prose — the `calendar.ts:84` reasonCode idiom. A
 *  multi-word message fails the pattern and collapses to `provider_error`, which is the point. */
function errorCode(body: { error?: unknown }): string {
  const e = body.error;
  return typeof e === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(e) ? e : "provider_error";
}

http.route({
  // `pathPrefix`, not a glob: Convex's router has no `*` syntax, so `path: "/fal/callback/*"` would
  // match nothing at all.
  pathPrefix: "/fal/callback/",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const unauthorized = () => new Response("unauthorized", { status: 401 });

    // 1. REPLAY WINDOW. Three lines, and they kill replay of a captured URL + body. fal sends unix
    //    SECONDS. An absent or unparseable header is a refusal, not a pass.
    const ts = Number(req.headers.get("x-fal-webhook-timestamp"));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > FAL_TIMESTAMP_TOLERANCE_S) {
      return unauthorized();
    }

    // 2. The path segment — `gmailAuth.verifyState:66-71`'s shape verbatim, `lastIndexOf(".")`.
    const segment = new URL(req.url).pathname.split("/").pop() ?? "";
    const dot = segment.lastIndexOf(".");
    if (dot <= 0) return unauthorized();
    const job = await ctx.runQuery(internal.mediaComplete.resolveJob, {
      raw: segment.slice(0, dot),
      digest: segment.slice(dot + 1),
    });
    if (!job) return unauthorized();

    // 3. IDEMPOTENCY. fal's retry policy is undocumented, so delivery is assumed at-least-once.
    if (job.terminal) return new Response("ok", { status: 200 });

    const body = (await req.json().catch(() => null)) as {
      status?: unknown;
      error?: unknown;
      payload?: unknown;
    } | null;
    if (!body) return new Response("bad request", { status: 400 });

    // Every failure below lands the row and returns 200: the row is terminal afterwards, so a fal
    // retry is a no-op, and a non-2xx would only buy redeliveries that change nothing.
    const failLand = async (code: string) => {
      await ctx.runMutation(internal.mediaComplete.landResult, {
        jobId: job.jobId,
        outcome: { ok: false, code },
      });
      return new Response("ok", { status: 200 });
    };

    if (body.status !== "OK") return await failLand(errorCode(body));

    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const inline = INLINE_ASSET[job.kind];
    const extract = ASSET_PATH[job.kind];
    if (!inline && !extract) return await failLand("unhandled_kind");

    let bytes: Uint8Array<ArrayBuffer>;
    let mimeType: string;
    if (inline) {
      // No fetch, no host check, no URL — there is nothing to SSRF into. The payload came through
      // the HMAC-guarded route and is turned into bytes right here.
      const asset = inline(payload);
      if (!asset) return await failLand("no_asset_payload");
      if (asset.bytes.byteLength === 0) return await failLand("asset_empty");
      bytes = asset.bytes;
      mimeType = asset.mimeType;
    } else {
      const rawUrl = extract?.(payload);
      if (typeof rawUrl !== "string") return await failLand("no_asset_url");

      let assetUrl: URL;
      try {
        assetUrl = new URL(rawUrl);
      } catch {
        return await failLand("bad_asset_url");
      }
      if (
        assetUrl.protocol !== "https:" ||
        !FAL_ASSET_HOSTS.some((h) => assetUrl.hostname === h || assetUrl.hostname.endsWith(`.${h}`))
      ) {
        return await failLand("asset_host_refused");
      }

      const assetRes = await fetch(assetUrl).catch(() => null);
      if (!assetRes?.ok) return await failLand("asset_fetch_failed");
      const buf = await assetRes.arrayBuffer();
      if (buf.byteLength === 0) return await failLand("asset_empty");
      if (buf.byteLength > MAX_ASSET_BYTES) return await failLand("asset_too_large");
      bytes = new Uint8Array(buf);
      mimeType = assetRes.headers.get("content-type") ?? "application/octet-stream";
    }
    const assetStorageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));

    // THE URL DIES HERE. It is not passed to `landResult`, not logged, not stored — the row carries
    // a storage id and a content hash, and there is no schema field it could live in.
    await ctx.runMutation(internal.mediaComplete.landResult, {
      jobId: job.jobId,
      outcome: {
        ok: true,
        assetStorageId,
        assetHash: await contentHash(bytes),
        mimeType,
        bytes: bytes.byteLength,
        moderation: moderationOf(payload),
        actual: actualOf(job.kind, payload),
      },
    });
    return new Response("ok", { status: 200 });
  }),
});

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
// NO HMAC PATH SEGMENT, unlike `/fal/callback/*`, and the difference is the caller. fal is a THIRD
// PARTY that holds no secret of ours, so the segment is the only thing that can authenticate it.
// Here the caller already proves knowledge of `MEDIA_RENDER_SECRET` in the header — and an HMAC
// keyed on that same secret is derivable by anyone who has it. It would be ceremony, not defence.
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

export default http;
