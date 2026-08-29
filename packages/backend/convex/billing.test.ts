// 28.1-04 Task 2 — the two hosted doors: Checkout and the Customer Portal.
//
// OFFLINE at $0. A real in-memory Convex backend (convex-test) plus a stubbed `fetch`. Nothing
// here proves Stripe accepts anything; it proves the REQUEST, the refusals, and what does NOT
// reach the caller.
//
// The sharpest assertion in this file is `client_reference_id === ctx.tenantId`. That field is
// the ONLY thread 28.1-05's webhook has back to a tenant; without it a completed checkout has
// nothing to match and must dead-letter, which is a paid-but-unprovisioned customer.
import { TRIAL_DAYS } from "@pikar/billing/config";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { billingPeriodKey, checkoutParams, PORTAL_IDEMPOTENCY_WINDOW_MS } from "./billing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the scans. edge-runtime has no `node:fs`. */
const backendSources = import.meta.glob("./billing*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const packageSources = import.meta.glob("../../billing/src/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PRICE = "price_1U9oXpV05ajSTq7I4Z4U1se9";
const ORIGIN = "https://www.pikar-ai.com";
const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_SENTINELSESSION";
const PORTAL_URL = "https://billing.stripe.com/p/session/SENTINELPORTAL";

type Recorded = { url: string; body: string; headers: Record<string, string> };
type Reply = { status: number; body?: unknown };

let calls: Recorded[] = [];

function stubStripe(reply: Reply | ((call: Recorded) => Reply)): void {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    };
    calls.push(call);
    const r = typeof reply === "function" ? reply(call) : reply;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  });
}

function stubForbiddenFetch(): void {
  vi.stubGlobal("fetch", async () => {
    calls.push({ url: "FORBIDDEN", body: "", headers: {} });
    throw new Error("fetch was called and must not have been");
  });
}

function sent(index = 0): Recorded {
  const call = calls[index];
  if (!call) throw new Error(`no request was recorded at index ${index}`);
  return call;
}

/** The form parameters of the n-th recorded request. */
const form = (index = 0) => new URLSearchParams(sent(index).body);

/** A full Checkout session as Stripe returns it — deliberately carrying PII we must not pass on. */
const sessionReply = (url: string = SESSION_URL) => ({
  status: 200,
  body: {
    id: "cs_test_SENTINELSESSION",
    object: "checkout.session",
    url,
    customer: "cus_SENTINELCUSTOMER",
    customer_details: { email: "SENTINEL-BUYER@example.com", name: "SENTINEL Buyer" },
    amount_total: 4900,
  },
});

/**
 * Add a tenant to an EXISTING backend and return a client carrying its identity.
 *
 * Taking `t` rather than booting one is what makes the two-tenant tests mean anything: a second
 * `convexTest(...)` is a second empty database, so its first `users` row gets the SAME id as the
 * first backend's — and "two tenants differ" then fails against code that is perfectly correct.
 */
async function tenantOn(t: ReturnType<typeof convexTest>) {
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  return { as: t.withIdentity({ subject: `${userId}|session` }), tenantId: String(userId) };
}

/** Boot a backend with one tenant on it. */
const withTenant = () => tenantOn(convexTest(schema, modules));

/**
 * Source with comments stripped, so a guard cannot punish its own documentation. A file that
 * WARNS against card data or against reusing the read rail reads exactly like one that does it.
 *
 * Line comments FIRST, and the order is load-bearing (`env.test.ts` measured this): stripping
 * block comments first lets a `/*` inside a `//` comment open a block that runs to the next
 * closing marker anywhere in the file, swallowing real code in between.
 */
const codeOf = (content: string): string =>
  content
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

beforeEach(() => {
  calls = [];
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_SENTINEL");
  vi.stubEnv("BILLING_STRIPE_PRICE_ID", PRICE);
  vi.stubEnv("SITE_URL", ORIGIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("startCheckout opens a hosted Stripe Checkout with a trial and a card up front", () => {
  test("the request is a subscription checkout carrying the price, the trial and the tenant", async () => {
    stubStripe(sessionReply());
    const { as, tenantId } = await withTenant();

    const result = await as.action(api.billing.startCheckout, {});

    expect(result).toEqual({ ok: true, url: SESSION_URL });
    expect(sent().url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const p = form();
    expect(p.get("mode")).toBe("subscription");
    expect(p.get("line_items[0][price]")).toBe(PRICE);
    expect(p.get("line_items[0][quantity]")).toBe("1");
    // A TRIAL, not freemium: the card is collected up front so it auto-converts.
    expect(p.get("payment_method_collection")).toBe("always");
    // Written out, not read from the imported constant — an oracle that moves with the subject
    // pins nothing.
    expect(p.get("subscription_data[trial_period_days]")).toBe("14");
    expect(p.get("success_url")).toBe(`${ORIGIN}/dashboard/settings?checkout=success`);
    expect(p.get("cancel_url")).toBe(`${ORIGIN}/dashboard/settings?checkout=cancel`);
    // BILL-02: every mutating outbound call is keyed.
    expect(sent().headers["Idempotency-Key"]).toBeTruthy();
    // …and the tenant thread the webhook will match on.
    expect(p.get("client_reference_id")).toBe(tenantId);
    expect(p.get("metadata[tenantId]")).toBe(tenantId);
  });

  test("client_reference_id is the caller's OWN tenant, never a constant or another tenant's", async () => {
    // Anti-vacuity for the assertion above: two tenants must produce two different values, or
    // `toBe(tenantId)` could be passing against a hardcoded string.
    stubStripe(sessionReply());
    const backend = convexTest(schema, modules);
    const a = await tenantOn(backend);
    const b = await tenantOn(backend);
    await a.as.action(api.billing.startCheckout, {});
    await b.as.action(api.billing.startCheckout, {});

    expect(form(0).get("client_reference_id")).toBe(a.tenantId);
    expect(form(1).get("client_reference_id")).toBe(b.tenantId);
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  test("ONLY the hosted url reaches the caller — no session, no customer, no email", async () => {
    stubStripe(sessionReply());
    const { as } = await withTenant();
    const result = await as.action(api.billing.startCheckout, {});

    expect(Object.keys(result).sort()).toEqual(["ok", "url"]);
    const returned = JSON.stringify(result);
    expect(returned).not.toContain("SENTINEL-BUYER@example.com");
    expect(returned).not.toContain("cus_SENTINELCUSTOMER");
    expect(returned).not.toContain("SENTINEL Buyer");
    expect(returned).not.toContain("4900");
  });

  test("a double-click inside the same day sends the SAME key AND the SAME body", async () => {
    // Stripe errors when one key is replayed with different parameters, so the two have to be
    // asserted together — a stable key over a drifting body is a failed request, not a guard.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T09:00:00Z"));
    stubStripe(sessionReply());
    const { as } = await withTenant();

    await as.action(api.billing.startCheckout, {});
    vi.setSystemTime(new Date("2026-08-29T23:59:00Z"));
    await as.action(api.billing.startCheckout, {});

    expect(sent(0).headers["Idempotency-Key"]).toBe(sent(1).headers["Idempotency-Key"]);
    expect(sent(0).body).toBe(sent(1).body);
    expect(sent(0).headers["Idempotency-Key"]?.length).toBeGreaterThan(10);
  });

  test("two different tenants never share a key — the key is derived, not constant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T09:00:00Z"));
    stubStripe(sessionReply());
    const backend = convexTest(schema, modules);
    const a = await tenantOn(backend);
    const b = await tenantOn(backend);
    await a.as.action(api.billing.startCheckout, {});
    await b.as.action(api.billing.startCheckout, {});

    expect(a.tenantId).not.toBe(b.tenantId);
    expect(sent(0).headers["Idempotency-Key"]).not.toBe(sent(1).headers["Idempotency-Key"]);
  });

  test("the period key rolls over at the UTC day boundary and nowhere else", async () => {
    expect(billingPeriodKey(Date.parse("2026-08-29T23:59:59.999Z"))).toBe("2026-08-29");
    expect(billingPeriodKey(Date.parse("2026-08-30T00:00:00.000Z"))).toBe("2026-08-30");
  });

  test("a Stripe refusal is reported as a refusal, never as a success with no url", async () => {
    stubStripe({ status: 400, body: { error: { code: "resource_missing" } } });
    const { as } = await withTenant();
    const result = await as.action(api.billing.startCheckout, {});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("http");
  });

  test("a `url` that is not a Stripe host is REFUSED — the caller redirects a browser to it", async () => {
    stubStripe(sessionReply("https://evil.example.com/pay"));
    const { as } = await withTenant();
    const result = await as.action(api.billing.startCheckout, {});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("evil.example.com");
  });

  test("an unset BILLING_STRIPE_PRICE_ID refuses loudly, and fetch never runs", async () => {
    vi.stubEnv("BILLING_STRIPE_PRICE_ID", "");
    stubForbiddenFetch();
    const { as } = await withTenant();
    await expect(as.action(api.billing.startCheckout, {})).rejects.toThrow(
      /BILLING_STRIPE_PRICE_ID/,
    );
    expect(calls).toEqual([]);
  });

  test("an unset SITE_URL refuses loudly rather than sending a localhost return url", async () => {
    // A checkout whose success_url points at a dead origin takes the money and strands the buyer.
    vi.stubEnv("SITE_URL", "");
    stubForbiddenFetch();
    const { as } = await withTenant();
    await expect(as.action(api.billing.startCheckout, {})).rejects.toThrow(/SITE_URL/);
    expect(calls).toEqual([]);
  });

  test("an unauthenticated caller never reaches Stripe", async () => {
    stubForbiddenFetch();
    const t = convexTest(schema, modules);
    await expect(t.action(api.billing.startCheckout, {})).rejects.toThrow(/UNAUTHENTICATED/);
    expect(calls).toEqual([]);
  });
});

describe("checkoutParams refuses an unconfigured trial rather than inventing one", () => {
  test("a null TRIAL_DAYS throws naming the constant", () => {
    expect(() =>
      checkoutParams({ tenantId: "t", priceId: PRICE, trialDays: null, origin: ORIGIN }),
    ).toThrow(/TRIAL_DAYS/);
  });

  test("a zero or fractional trial is not a trial and is refused too", () => {
    for (const trialDays of [0, -1, 1.5]) {
      expect(() =>
        checkoutParams({ tenantId: "t", priceId: PRICE, trialDays, origin: ORIGIN }),
      ).toThrow(/TRIAL_DAYS/);
    }
  });

  test("the configured trial is 14 days, written out", () => {
    expect(TRIAL_DAYS).toBe(14);
    const params = checkoutParams({
      tenantId: "t",
      priceId: PRICE,
      trialDays: 14,
      origin: ORIGIN,
    });
    expect(params["subscription_data[trial_period_days]"]).toBe("14");
  });

  test("startCheckout feeds the CONFIG constant, not a number typed a second time", () => {
    // A behavioural test cannot tell `TRIAL_DAYS` from a hardcoded `14` while the constant is 14,
    // so the wiring is asserted against the source. Deletion of the import is what this catches.
    const source = backendSources["./billing.ts"] ?? "";
    expect(source).toContain("TRIAL_DAYS");
    expect(source).toContain('from "@pikar/billing/config"');
    expect(source).toContain("trialDays: TRIAL_DAYS");
  });
});

describe("portalLink is the Customer Portal door, and it never provisions to make itself work", () => {
  test("a tenant with no Stripe customer gets a refusal and Stripe is never called", async () => {
    // 28.1-05 owns the tenant↔customer mapping. Until it exists EVERY tenant lands here — and
    // creating a customer to make the call succeed would mint an unmapped Stripe object.
    stubForbiddenFetch();
    const { as } = await withTenant();
    const result = await as.action(api.billing.portalLink, {});
    expect(result).toEqual({ ok: false, reason: "no_stripe_customer" });
    expect(calls).toEqual([]);
  });

  test("the portal request carries the customer, the return url and a key", async () => {
    // The transport arm is driven directly: `portalLink` cannot reach it until 28.1-05 lands a
    // mapping, and an untested arm behind a green suite is exactly the gap this repo has paid for.
    stubStripe({ status: 200, body: { id: "bps_1", url: PORTAL_URL } });
    const { portalSession } = await import("./billing");
    const result = await portalSession("cus_SENTINEL", `${ORIGIN}/dashboard/settings`, "pkey-1");

    expect(result).toEqual({ ok: true, url: PORTAL_URL });
    expect(sent().url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(form().get("customer")).toBe("cus_SENTINEL");
    expect(form().get("return_url")).toBe(`${ORIGIN}/dashboard/settings`);
    expect(sent().headers["Idempotency-Key"]).toBe("pkey-1");
  });

  test("the portal idempotency window is SHORT — a portal url is single-use and expires", () => {
    // Deliberately not the checkout's daily window. Replaying a day-old key hands the user back a
    // link that has already been spent, which is worse than minting a second session.
    expect(PORTAL_IDEMPOTENCY_WINDOW_MS).toBe(60_000);
  });

  test("no billing module ever POSTs to /v1/customers", async () => {
    const offenders = Object.entries(backendSources)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, content]) => codeOf(content).includes("/v1/customers"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    // Anti-vacuity: the scan really did read the modules it claims to have cleared.
    expect(
      Object.keys(backendSources).filter((p) => !p.endsWith(".test.ts")).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("billingStatus never fabricates a state it has no evidence for", () => {
  test("a tenant with no billing row is `unknown`, not zero and not a free tier", async () => {
    const { as } = await withTenant();
    const result = await as.query(api.billing.billingStatus, {});
    expect(result).toEqual({ state: "unknown" });
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("free");
    expect(rendered).not.toContain("0");
    expect(rendered).not.toContain("active");
  });
});

describe("no card data and no 3DS exists anywhere in this subsystem", () => {
  const FORBIDDEN = ["card_number", "cvc", "exp_month", "exp_year", "three_d_secure", "3ds"];
  const pattern = new RegExp(FORBIDDEN.join("|"), "i");

  const scanned = Object.entries({ ...backendSources, ...packageSources })
    .filter(([path]) => !path.endsWith(".test.ts"))
    .map(([path, content]) => [path, codeOf(content)] as const);

  test("the scan actually read both halves of the subsystem", () => {
    // Without this the assertion below is a green light over an empty glob.
    expect(scanned.length).toBeGreaterThanOrEqual(8);
    expect(scanned.map(([p]) => p)).toContain("./billing.ts");
    expect(scanned.map(([p]) => p)).toContain("../../billing/src/config.ts");
    // …and the pattern really does match the thing it is looking for.
    expect(pattern.test("payment_method[card][exp_month]")).toBe(true);
  });

  test("Stripe-hosted means card data never touches this codebase", () => {
    const offenders = scanned.filter(([, content]) => pattern.test(content)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  test("the READ rail is not reused for the write direction", () => {
    // `connectorFetch.ts` is Phase 28's GET-only transport into a TENANT's Stripe account. Its
    // allow-list and its secret belong to the opposite trust boundary.
    const offenders = scanned
      .filter(([, content]) => content.includes("connectorFetch"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  test("billingApi.ts is the ONLY module that names Stripe's origin", () => {
    const namers = Object.entries(backendSources)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, content]) => /STRIPE_API_BASE|api\.stripe\.com/.test(codeOf(content)))
      .map(([path]) => path);
    expect(namers).toEqual(["./billingApi.ts"]);
  });
});
