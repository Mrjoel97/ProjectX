/** Owned-domain YouTube callback: code/state travel server-to-server only. */
const APP_ORIGIN = "https://www.pikar-ai.com";
const CALLBACK_PATH = "/social/youtube/callback";
const RESULT_PATH = "/connect-social";
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bounce(result: "failed" | "cancelled" | { receipt: string }): Response {
  const destination = new URL(RESULT_PATH, APP_ORIGIN);
  destination.searchParams.set("provider", "youtube");
  if (typeof result === "string") destination.searchParams.set("result", result);
  else destination.searchParams.set("complete", result.receipt);
  return new Response(null, {
    status: 303,
    headers: { ...HEADERS, Location: destination.toString() },
  });
}

function convexHttpOrigin(): string | null {
  try {
    const cloud = new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
    if (
      cloud.protocol !== "https:" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.convex\.cloud$/.test(cloud.hostname) ||
      cloud.username ||
      cloud.password ||
      cloud.port ||
      cloud.pathname !== "/" ||
      cloud.search ||
      cloud.hash
    )
      return null;
    return "https://" + cloud.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: HEADERS });
  const here = new URL(request.url);
  if (here.origin !== APP_ORIGIN || here.pathname !== CALLBACK_PATH) return bounce("failed");
  const params = here.searchParams;
  if (["state", "code", "error"].some((key) => params.getAll(key).length > 1))
    return bounce("failed");
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const denied = params.has("error");
  if (!OPAQUE.test(state) || (denied && code !== null)) return bounce("failed");
  if (!denied && (code === null || !/^[\x21-\x7e]{1,4096}$/.test(code))) return bounce("failed");
  if (denied && !/^[a-z_]{1,128}$/.test(params.get("error") ?? "")) return bounce("failed");
  const origin = convexHttpOrigin();
  if (origin === null) return bounce("failed");
  const upstreamUrl = new URL(CALLBACK_PATH, origin);
  upstreamUrl.searchParams.set("state", state);
  // Descriptions, scope, account hints and arbitrary provider query fields are not relayed.
  if (denied) upstreamUrl.searchParams.set("error", "access_denied");
  else upstreamUrl.searchParams.set("code", code!);
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const location = upstream.headers.get("location");
    await upstream.body?.cancel();
    if (upstream.status !== 303 || location === null) return bounce("failed");
    const destination = new URL(location);
    if (
      destination.origin !== APP_ORIGIN ||
      destination.pathname !== RESULT_PATH ||
      destination.username ||
      destination.password ||
      destination.hash ||
      [...destination.searchParams.keys()].some(
        (key) => !["provider", "complete", "result"].includes(key),
      ) ||
      ["provider", "complete", "result"].some(
        (key) => destination.searchParams.getAll(key).length > 1,
      ) ||
      destination.searchParams.get("provider") !== "youtube"
    )
      return bounce("failed");
    const receipt = destination.searchParams.get("complete");
    const result = destination.searchParams.get("result");
    if (receipt !== null && result === null && OPAQUE.test(receipt)) return bounce({ receipt });
    if (receipt === null && (result === "failed" || result === "cancelled")) return bounce(result);
  } catch {
    // Never echo provider/network text, code, state or an upstream URL.
  }
  return bounce("failed");
}
