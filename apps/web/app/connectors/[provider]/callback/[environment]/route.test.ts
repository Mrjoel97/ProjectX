import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

/**
 * The connector callback forwarder (2026-09-09). Intuit refuses a `convex.site` redirect URI on a
 * production app, so the registered URI is on our own domain and this route hands the request to the
 * same Convex handler that has always processed it.
 *
 * What is worth testing here is NOT the forwarding — that is four lines — but the two properties
 * that make a public OAuth landing pad safe: it can only ever redirect within this site, and it
 * never answers an unknown provider/environment with anything a caller could learn from.
 */

const CONVEX = "https://opulent-octopus-494.convex.cloud";
const SITE = "https://www.pikar-ai.com";
const params = (provider: string, environment: string) =>
  Promise.resolve({ provider, environment });

let seen: string[] = [];

beforeEach(() => {
  seen = [];
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CONVEX);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Stub the ONE upstream call, recording the URL it was given. */
const upstreamReturns = (location: string | null) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      seen.push(String(url));
      return new Response(null, {
        status: 303,
        headers: location === null ? {} : { location },
      });
    }),
  );

describe("connector callback forwarder", () => {
  test("forwards to the Convex SITE origin, preserving the query verbatim", async () => {
    upstreamReturns(`${SITE}/dashboard/profile?connect=quickbooks_connected`);

    const res = await GET(
      new Request(
        `${SITE}/connectors/quickbooks/callback/production?code=abc123&state=xyz&realmId=42`,
      ),
      { params: params("quickbooks", "production") },
    );

    // `.convex.cloud` is the client API; HTTP actions are served from `.convex.site`. Deriving it
    // rather than adding a second env var is what keeps the two from drifting.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(
      "https://opulent-octopus-494.convex.site/connectors/quickbooks/callback/production?code=abc123&state=xyz&realmId=42",
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `${SITE}/dashboard/profile?connect=quickbooks_connected`,
    );
  });

  // THE SAFETY PROPERTY. The upstream Location is built from Convex's own `SITE_URL`; if that were
  // ever misconfigured, forwarding it verbatim would turn a public OAuth landing pad into an open
  // redirect. Only the PATH is taken, so the destination is always this site.
  test("an off-site upstream Location cannot escape this origin", async () => {
    upstreamReturns("https://evil.example/steal?code=abc123");

    const res = await GET(
      new Request(`${SITE}/connectors/quickbooks/callback/production?code=abc123&state=xyz`),
      { params: params("quickbooks", "production") },
    );

    // MUTATION: redirect to `location` instead of its path → this becomes evil.example and reddens.
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.origin).toBe(SITE);
    expect(to.pathname).toBe("/steal");
    expect(res.headers.get("location")).not.toContain("evil.example");
  });

  test("an unknown provider or environment is refused BEFORE anything is forwarded", async () => {
    upstreamReturns(`${SITE}/dashboard/profile`);

    for (const [provider, environment] of [
      ["paypal", "production"],
      ["quickbooks", "staging"],
      ["../../etc", "production"],
    ] as const) {
      const res = await GET(new Request(`${SITE}/connectors/x/callback/y?code=abc`), {
        params: params(provider, environment),
      });
      expect(res.headers.get("location")).toBe(`${SITE}/dashboard/profile?connect=unavailable`);
    }
    // MUTATION: drop the closed-set check → the fetch runs and this reddens. "Before anything is
    // forwarded" is the claim; the call count is the only thing that can prove it.
    expect(seen).toHaveLength(0);
  });

  test("an upstream failure lands somewhere safe and echoes nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED opulent-octopus-494.convex.site:443");
      }),
    );

    const res = await GET(
      new Request(`${SITE}/connectors/quickbooks/callback/production?error=access_denied`),
      { params: params("quickbooks", "production") },
    );

    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${SITE}/dashboard/profile?connect=unavailable`);
    // A callback is reached from someone else's website; its failure text is not ours to echo.
    expect(location).not.toContain("ECONNREFUSED");
    expect(location).not.toContain("access_denied");
  });

  test("an unconfigured deployment refuses instead of forwarding to nowhere", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    vi.stubEnv("CONVEX_URL", "");
    upstreamReturns(`${SITE}/dashboard/profile`);

    const res = await GET(
      new Request(`${SITE}/connectors/quickbooks/callback/production?code=abc`),
      { params: params("quickbooks", "production") },
    );

    expect(res.headers.get("location")).toBe(`${SITE}/dashboard/profile?connect=unavailable`);
    expect(seen).toHaveLength(0);
  });
});
