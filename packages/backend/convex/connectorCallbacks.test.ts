// The Phase 28 connector OAuth callback routes (28-09 slice, pulled forward into wave 7).
//
// These routes are what makes the phase finishable at all. `completeHubSpotConnect` and the two
// `handleCallback`s shipped as `internalAction`s with no route, so no grant could complete, so no
// live evidence could exist, so wave 7 could never judge a lane `passed` — while 28-09, which owns
// the routes, depends on wave 7. This file proves the way out is safe.
//
// FIVE things are being proven, and the first is the whole design:
//
//  1. THE GATE IS THE ADMISSION AXIS, NOT THE LANE. A `parked` lane still permits a callback (that
//     is how the owner gathers the evidence wave 7 judges) while staying invisible to every tenant
//     through `availableProviders`. A provider nobody has judged permits nothing.
//  2. THE GATE RUNS FIRST, proven by CONSEQUENCE rather than by call order: after a refused
//     callback the one-time state is still UNBURNED, which can only be true if nothing consumed it.
//  3. NO PROVIDER DETAIL REACHES THE REDIRECT. A redirect lands in browser history, the Referer
//     header and every proxy log in between (CLAUDE.md §4).
//  4. A CALLBACK ALWAYS REDIRECTS — never a 500, never a dead end on the Convex site origin.
//  5. PAYPAL HAS NO ROUTE, and that is deliberate: `beginConnect` refuses by design and mints no
//     state, so there is nothing to call back.
//
// Every test is $0: convex-test and Web Crypto only, no network, no provider, no model.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { CONNECT_RESULTS } from "./connectorOAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const SITE = "https://app.test";
const YEAR = 365 * 86_400_000;

/** The three providers that HAVE a consent flow. PayPal is absent on purpose — see §5 above. */
const ROUTED = ["hubspot", "quickbooks", "stripe"] as const;
type Routed = (typeof ROUTED)[number];

async function harness() {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  return { t, as: t.withIdentity({ subject: `${user}|session_1` }) };
}
type Harness = Awaited<ReturnType<typeof harness>>;

/**
 * Insert a gate row directly. `sealGate` is owner-only and validates a pass; these tests need axis
 * combinations it would refuse (an expired row, a beta admission in production), so they write the
 * row the resolver reads rather than going through the writer.
 */
const gate = (
  h: Harness,
  over: {
    provider?: Routed;
    environment?: "sandbox" | "production";
    admission?: "approved_beta" | "approved_production" | "blocked" | "deferred";
    lane?: "passed" | "parked" | "failed";
    reviewBy?: number;
  } = {},
) =>
  h.t.run((ctx) =>
    ctx.db.insert("providerGates", {
      provider: over.provider ?? "hubspot",
      environment: over.environment ?? "sandbox",
      admission: over.admission ?? "approved_production",
      // PARKED BY DEFAULT, because that is the state every lane is actually in today and the one
      // the route must permit. A default of `passed` would make most of this file vacuous.
      lane: over.lane ?? "parked",
      evidenceRef: "docs/connectors/hubspot-suitability.md#decision",
      reviewBy: over.reviewBy ?? Date.now() + YEAR,
      revision: 1,
      updatedAt: Date.now(),
    }),
  );

const mint = (h: Harness, provider: Routed = "hubspot", environment = "sandbox") =>
  h.as.mutation(api.connectorOAuth.mintConnectState, {
    provider,
    environment,
    redirectPath: "/dashboard/profile",
  } as never);

const stateRows = (h: Harness) => h.t.run((ctx) => ctx.db.query("connectorOAuthStates").collect());

/**
 * The state row's BURN MARKER. `consumeConnectState` patches `usedAt` rather than deleting the row
 * (a deleted row cannot be told from one that never existed, and a replay must be refused as
 * `already_used`), so this — not a row count — is what proves a handler consumed the state.
 */
const burned = async (h: Harness) => {
  const rows = await stateRows(h);
  // `every` on an EMPTY array is `true`, so a missing state row would read as a burned one and
  // "the handler consumed it" would pass with nothing there at all (the `onlyRow` lesson next door).
  if (rows.length === 0) throw new Error("no state row to inspect — the burn check proves nothing");
  return rows.every((r) => r.usedAt !== undefined);
};

/**
 * Deployment configuration for QuickBooks and Stripe. Both read it BEFORE consuming the state and
 * throw by name when it is missing, so without this their handlers are unreachable and every
 * "the handler was reached" assertion below would pass vacuously on the config refusal instead.
 * HubSpot needs none: it consumes the state first.
 */
function configureQbAndStripe() {
  vi.stubEnv("QUICKBOOKS_CLIENT_ID", "qb-client");
  vi.stubEnv("QUICKBOOKS_CLIENT_SECRET", "qb-secret");
  vi.stubEnv("QUICKBOOKS_REDIRECT_URI", `${SITE}/connectors/quickbooks/callback/sandbox`);
  vi.stubEnv("STRIPE_APP_CLIENT_ID", "ca_test_client");
  vi.stubEnv("STRIPE_APP_SECRET_KEY", "sk_test_secret");
  vi.stubEnv("STRIPE_APP_REDIRECT_URI", `${SITE}/connectors/stripe/callback/sandbox`);
  vi.stubEnv("STRIPE_APP_API_VERSION", "2026-08-26.dahlia");
}

const call = (h: Harness, path: string) => h.t.fetch(path, { method: "GET" });
const location = (res: Response) => res.headers.get("Location") ?? "";
/** The `result=` a redirect carries, or "" when there is none. */
const resultOf = (res: Response) => new URL(location(res), SITE).searchParams.get("result") ?? "";

beforeEach(() => {
  vi.stubEnv("SITE_URL", SITE);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── The gate ──────────────────────────────────────────────────────────────────────────────

describe("the callback gate is the admission axis, and it runs first", () => {
  // THE POINT OF THE WHOLE SLICE. If this refused, no provider could ever produce evidence and no
  // lane could ever be judged `passed` — the deadlock this file exists to document and break.
  test.each(ROUTED)("%s: a PARKED but admitted lane permits the callback", async (provider) => {
    const h = await harness();
    configureQbAndStripe();
    await gate(h, { provider });
    // A state that was never minted. The handler is the only thing that can say `invalid_state`;
    // the gate refuses with `unavailable`. So this code proves the handler was REACHED.
    const res = await call(h, `/connectors/${provider}/callback/sandbox?code=c&state=never-minted`);
    expect(res.status).toBe(303);
    expect(resultOf(res)).toBe("invalid_state");
  });

  test.each(ROUTED)("%s: no gate row at all permits nothing", async (provider) => {
    const h = await harness();
    const res = await call(h, `/connectors/${provider}/callback/sandbox?code=c&state=never-minted`);
    expect(resultOf(res)).toBe("unavailable");
  });

  // ORDERING, PROVEN BY CONSEQUENCE. There is no call-sequence bookkeeping to drift out of sync:
  // the state row can only still exist if nothing consumed it, and consuming it is the first thing
  // the provider handler does.
  test("a refused callback leaves the one-time state UNBURNED", async () => {
    const h = await harness();
    const { state } = await mint(h);
    expect(await stateRows(h)).toHaveLength(1);

    const refused = await call(h, `/connectors/hubspot/callback/sandbox?code=c&state=${state}`);
    expect(resultOf(refused)).toBe("unavailable");
    expect(await burned(h)).toBe(false);

    // And once the gate permits, the SAME state IS burned — so the marker being unset above was
    // the gate refusing, not a state that could never have been consumed in the first place.
    await gate(h);
    await call(h, `/connectors/hubspot/callback/sandbox?code=c&state=${state}`);
    expect(await burned(h)).toBe(true);
  });

  test.each([
    ["a failed lane", { lane: "failed" as const }],
    ["a blocked admission", { admission: "blocked" as const }],
    ["a deferred admission", { admission: "deferred" as const }],
    ["expired evidence", { reviewBy: Date.now() - 1 }],
  ])("%s permits nothing", async (_name, over) => {
    const h = await harness();
    await gate(h, over);
    const res = await call(h, "/connectors/hubspot/callback/sandbox?code=c&state=never-minted");
    expect(resultOf(res)).toBe("unavailable");
  });

  // The admission axis is environment-aware, and this is the PAIR that proves it rather than one
  // half that a blanket refusal would also satisfy.
  test("approved_beta reaches sandbox and NOT production", async () => {
    const sandbox = await harness();
    await gate(sandbox, { admission: "approved_beta", environment: "sandbox" });
    expect(
      resultOf(await call(sandbox, "/connectors/hubspot/callback/sandbox?code=c&state=x")),
    ).toBe("invalid_state");

    const production = await harness();
    await gate(production, { admission: "approved_beta", environment: "production" });
    expect(
      resultOf(await call(production, "/connectors/hubspot/callback/production?code=c&state=x")),
    ).toBe("unavailable");
  });

  // A gate row is per-environment. A sandbox approval must not open the production callback, which
  // is the axis a single global "hubspot is approved" flag would have collapsed.
  test("a sandbox gate does not permit the production callback", async () => {
    const h = await harness();
    await gate(h, { environment: "sandbox" });
    const res = await call(h, "/connectors/hubspot/callback/production?code=c&state=x");
    expect(resultOf(res)).toBe("unavailable");
  });
});

// ── The path ──────────────────────────────────────────────────────────────────────────────

describe("the environment comes out of the path, and only two values exist", () => {
  test.each([
    "staging",
    "Production",
    "sandbox-",
    "SANDBOX",
  ])("an unknown environment segment %o refuses", async (segment) => {
    const h = await harness();
    // Permitted in BOTH real environments, so a refusal here can only be the segment.
    await gate(h, { environment: "sandbox" });
    await gate(h, { environment: "production" });
    const res = await call(h, `/connectors/hubspot/callback/${segment}?code=c&state=x`);
    expect(resultOf(res)).toBe("unavailable");
  });

  test("PayPal has no callback route — beginConnect refuses and mints no state", async () => {
    const h = await harness();
    const res = await call(h, "/connectors/paypal/callback/production?code=c&state=x");
    expect(res.status).toBe(404);
  });
});

// ── The redirect ──────────────────────────────────────────────────────────────────────────

describe("the redirect carries a closed set and nothing else", () => {
  test.each(ROUTED)("%s: a provider refusal never echoes its description", async (provider) => {
    const h = await harness();
    await gate(h, { provider });
    const res = await call(
      h,
      `/connectors/${provider}/callback/sandbox?error=access_denied` +
        "&error_description=portal%20acme-industries%20declined&state=x",
    );
    const where = location(res);
    expect(where.startsWith(SITE)).toBe(true);
    expect(where).not.toContain("acme-industries");
    expect(where).not.toContain("access_denied");
    expect(where).not.toContain("declined");
    expect(CONNECT_RESULTS as readonly string[]).toContain(resultOf(res));
  });

  test("a missing state is refused before anything else, with no state burned", async () => {
    const h = await harness();
    await gate(h);
    await mint(h);
    const res = await call(h, "/connectors/hubspot/callback/sandbox?code=c");
    expect(resultOf(res)).toBe("invalid_state");
    expect(await burned(h)).toBe(false);
  });

  // A CALLBACK ALWAYS REDIRECTS. `requireQbApp` and `requireStripeApp` throw BY NAME when the
  // deployment is unconfigured — and they run BEFORE the state is consumed, so without the route's
  // catch this is a 500 on the Convex site origin carrying a provider message into a log line.
  test.each([
    "quickbooks",
    "stripe",
  ] as const)("%s: an unconfigured deployment redirects rather than throwing", async (provider) => {
    const h = await harness();
    await gate(h, { provider });
    const { state } = await mint(h, provider);
    const res = await call(h, `/connectors/${provider}/callback/sandbox?code=c&state=${state}`);
    expect(res.status).toBe(303);
    expect(resultOf(res)).toBe("unavailable");
  });

  test.each(ROUTED)("%s: every redirect is same-origin and in-app", async (provider) => {
    const h = await harness();
    await gate(h, { provider });
    const res = await call(
      h,
      `/connectors/${provider}/callback/sandbox?code=c&state=x&redirect_uri=https://evil.test`,
    );
    expect(location(res)).toMatch(new RegExp(`^${SITE}/dashboard/profile\\?connect=${provider}&`));
    expect(location(res)).not.toContain("evil.test");
  });
});
