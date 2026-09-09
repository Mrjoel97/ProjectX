/**
 * THE CONNECTOR OAUTH CALLBACK, ON OUR OWN DOMAIN — a thin forwarder to the Convex HTTP route.
 *
 * WHY IT EXISTS. Gmail and Microsoft both register
 * `https://<deployment>.convex.site/<provider>/callback` and Google and Microsoft accept it. INTUIT
 * DOES NOT: a production QuickBooks app refuses a `convex.site` redirect URI, so the runbook's
 * `https://opulent-octopus-494.convex.site/connectors/quickbooks/callback/production` cannot be
 * registered at all (owner, 2026-09-09). The lane was blocked on a URI nobody could enter.
 *
 * So the URI becomes `https://www.pikar-ai.com/connectors/<provider>/callback/<environment>` — a
 * domain the owner controls and Intuit accepts — and this route hands the request to the SAME
 * Convex handler that has always processed it. No connector logic moves; `quickbooksAuth.handleCallback`
 * remains the only thing that validates state, realmId or a code.
 *
 * SERVER-SIDE, NOT A BROWSER REDIRECT, and that is the point. A 307 back to `convex.site` would put
 * the authorization CODE in browser history, in a `Referer`, and in every proxy log on the second
 * hop — the exact class of leak the Convex route's own comments refuse for `error_description`
 * (CLAUDE.md §4). Fetching server-side means the code is seen by our Next server and our Convex
 * deployment, and by nothing else.
 *
 * IT CANNOT BE AN OPEN REDIRECT. The Convex handler answers 303 with an ABSOLUTE `Location` built
 * from its own `SITE_URL`. This route never forwards that URL: it takes only the PATH and re-hosts
 * it on the request's own origin, so the only reachable destination is a page on this site — true
 * even if `SITE_URL` is ever misconfigured to point somewhere else.
 */

const PROVIDERS = new Set(["quickbooks", "hubspot", "stripe"]);
const ENVIRONMENTS = new Set(["sandbox", "production"]);

/** Where a connector refusal lands, matching the Convex route's own closed-set failure path. */
const FALLBACK = "/dashboard/profile?connect=unavailable";

export const runtime = "nodejs";

/**
 * The Convex HTTP origin. Actions are served from `.convex.site`, the client API from
 * `.convex.cloud`, and only the latter is configured — so it is derived rather than added as a
 * second env var that could drift from the first.
 */
function convexSiteOrigin(): string | null {
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? "";
  if (cloud === "") return null;
  try {
    const url = new URL(cloud);
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    return url.origin;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string; environment: string }> },
): Promise<Response> {
  const { provider, environment } = await context.params;
  const here = new URL(request.url);
  const bounce = (path: string) => Response.redirect(new URL(path, here.origin), 303);

  // CLOSED SETS, checked before anything is forwarded. An unknown segment is a stray GET, and it
  // gets the same answer as every other failure — never a reason it could learn something from.
  if (!PROVIDERS.has(provider) || !ENVIRONMENTS.has(environment)) return bounce(FALLBACK);

  const origin = convexSiteOrigin();
  if (origin === null) return bounce(FALLBACK);

  let location: string | null = null;
  try {
    const upstream = await fetch(
      `${origin}/connectors/${provider}/callback/${environment}${here.search}`,
      { redirect: "manual" },
    );
    location = upstream.headers.get("location");
  } catch {
    // Never surface the provider's or the network's words: a callback is reached from someone
    // else's website and its failure text is not ours to echo.
    return bounce(FALLBACK);
  }
  if (location === null) return bounce(FALLBACK);

  // PATH ONLY. See the header — this is what makes an open redirect unreachable.
  let path: string;
  try {
    const resolved = new URL(location, here.origin);
    path = `${resolved.pathname}${resolved.search}`;
  } catch {
    return bounce(FALLBACK);
  }
  return bounce(path);
}
