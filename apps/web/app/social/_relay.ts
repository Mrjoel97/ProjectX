/** Closed owned-domain relays: request headers never select a backend or carry credentials. */
export const OWNED_ORIGINS = {
  production: "https://www.pikar-ai.com",
  review: "https://review.pikar-ai.com",
} as const;
export const RELAY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
type Provider = "youtube" | "tiktok";

export function ownedOrigin(request: Request, provider?: Provider): string | null {
  const url = new URL(request.url);
  if (url.username || url.password || url.hash) return null;
  if (url.origin === OWNED_ORIGINS.review) return url.origin;
  if (provider !== "tiktok" && url.origin === OWNED_ORIGINS.production) return url.origin;
  return null;
}

export function convexHttpOrigin(): string | null {
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
    return `https://${cloud.hostname.replace(/\.convex\.cloud$/, ".convex.site")}`;
  } catch {
    return null;
  }
}

export function empty(status: number): Response {
  return new Response(null, {
    status,
    headers: status === 405 ? { ...RELAY_HEADERS, Allow: "GET" } : RELAY_HEADERS,
  });
}

export async function callback(request: Request, provider: Provider): Promise<Response> {
  if (request.method !== "GET") return empty(405);
  const app = ownedOrigin(request, provider);
  function bounce(result: "failed" | "cancelled" | { receipt: string }): Response {
    const destination = new URL("/connect-social", app ?? OWNED_ORIGINS.production);
    destination.searchParams.set("provider", provider);
    if (typeof result === "string") destination.searchParams.set("result", result);
    else destination.searchParams.set("complete", result.receipt);
    return new Response(null, {
      status: 303,
      headers: { ...RELAY_HEADERS, Location: destination.toString() },
    });
  }
  const path = `/social/${provider}/callback`;
  const here = new URL(request.url);
  if (app === null || here.pathname !== path) return bounce("failed");
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
  const target = new URL(path, origin);
  target.searchParams.set("state", state);
  // Provider descriptions, account hints and arbitrary query fields stay outside the relay.
  if (denied) target.searchParams.set("error", "access_denied");
  else target.searchParams.set("code", code ?? "");
  try {
    const upstream = await fetch(target, {
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
      destination.origin !== app ||
      destination.pathname !== "/connect-social" ||
      destination.username ||
      destination.password ||
      destination.hash ||
      [...destination.searchParams.keys()].some(
        (key) => !["provider", "complete", "result"].includes(key),
      ) ||
      ["provider", "complete", "result"].some(
        (key) => destination.searchParams.getAll(key).length > 1,
      ) ||
      destination.searchParams.get("provider") !== provider
    )
      return bounce("failed");
    const receipt = destination.searchParams.get("complete");
    const result = destination.searchParams.get("result");
    if (receipt !== null && result === null && OPAQUE.test(receipt)) return bounce({ receipt });
    if (receipt === null && (result === "failed" || result === "cancelled")) return bounce(result);
  } catch {
    // Provider/network errors may contain codes or account details; never echo them.
  }
  return bounce("failed");
}
