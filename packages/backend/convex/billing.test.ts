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
import { SPEND_RAILS } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { codeOf } from "../__fixtures__/sourceScan";
// The Phase 26 equality below drives `api.finance.summary`, the SHIPPED surface, so the real
// rate-limiter component has to be present — a stub would prove nothing about what Finance
// renders. Relative imports: the packages block deep specifiers (guardrails.test.ts idiom).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api } from "./_generated/api";
import {
  billingPeriodKey,
  checkoutParams,
  INVOICE_PAGE_LIMIT,
  PORTAL_IDEMPOTENCY_WINDOW_MS,
  UNAPPLIED_FUNDS_PAGE_LIMIT,
} from "./billing";
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

/**
 * The WEB app's own source. 28.1-07 (BILL-04) requires the no-card-data proof to cover the half a
 * browser renders, not only the backend: the locked decision is Stripe-hosted everything, and a
 * card input appearing in a page is that decision being reversed by accident.
 */
const webSources = import.meta.glob("../../../apps/web/app/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The spend plane's own source, read so the "no revenue rail" claim is checked, not asserted. */
const spendSource = import.meta.glob("../../core/src/spend.ts", {
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

/** …and keep the backend handle, for tests that have to seed rows a producer would write. */
async function withTenantHandle() {
  const t = convexTest(schema, modules);
  return { t, ...(await tenantOn(t)) };
}

const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

/** One tenant on a backend that carries the components `api.finance.summary` needs. */
async function withTenantOnFinance() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return await tenantOn(t);
}

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
      checkoutParams({
        tenantId: "t",
        priceId: PRICE,
        trialDays: null,
        customerId: null,
        origin: ORIGIN,
      }),
    ).toThrow(/TRIAL_DAYS/);
  });

  test("a zero or fractional trial is not a trial and is refused too", () => {
    for (const trialDays of [0, -1, 1.5]) {
      expect(() =>
        checkoutParams({
          tenantId: "t",
          priceId: PRICE,
          trialDays,
          customerId: null,
          origin: ORIGIN,
        }),
      ).toThrow(/TRIAL_DAYS/);
    }
  });

  test("the configured trial is 14 days, written out", () => {
    expect(TRIAL_DAYS).toBe(14);
    const params = checkoutParams({
      tenantId: "t",
      priceId: PRICE,
      trialDays: 14,
      customerId: null,
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
    // …and over a file the comment stripper GUTTED. Every module here declares something; a
    // stripper that ate the declarations would make every negative scan below pass vacuously.
    const blanked = scanned.filter(([, content]) => !/\bexport\b/.test(content)).map(([p]) => p);
    expect(blanked).toEqual([]);
    expect(codeOf("const a = 1; // /* not a block\nconst b = 2;")).toContain("const b = 2;");
    // …and a URL SURVIVES. The `//` in any `https://` opened the line-comment arm and deleted the
    // rest of the line, so the two scans below were blind to exactly the offender they exist to
    // catch: `config.ts` reduced to `export const STRIPE_API_BASE = "https:` (28.1-11 #12).
    expect(codeOf('const u = "https://api.stripe.com/v1/customers"; // x')).toContain(
      "https://api.stripe.com/v1/customers",
    );
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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 28.1-05 filled the two arms 28.1-04 left unreachable: `billingStatus` reads a real
// `billingCustomers` row, and `portalLink` resolves a real `stripeCustomerId`.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Seed a mapping row the way `billingWebhook.receiveAndApply` would. */
async function mapCustomer(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  stripeCustomerId: string,
  status: string,
) {
  await t.run((ctx) =>
    ctx.db.insert("billingCustomers", {
      tenantId,
      stripeCustomerId,
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

describe("a re-subscribing tenant reuses their Stripe customer (28.1-11, audit #5)", () => {
  test("startCheckout passes `customer` when a mapping already exists", async () => {
    // Without this Stripe mints a SECOND `cus_` for a tenant that already has one. The webhook's
    // mapping is keyed on (tenantId, stripeCustomerId) and `applyMapping` refuses a tenant whose
    // stored customer disagrees (`tenantConflict`) — so every event for the new customer
    // dead-letters, and a tenant who cancels and comes back is permanently unmappable: their
    // money arrives at Stripe and is never booked in our ledger.
    stubStripe(sessionReply());
    const { t, as, tenantId } = await withTenantHandle();
    await mapCustomer(t, tenantId, "cus_RETURNING", "canceled");

    await as.action(api.billing.startCheckout, {});

    expect(form().get("customer")).toBe("cus_RETURNING");
  });

  test("…and sends NO customer when there is no mapping, so Stripe creates the first one", async () => {
    // The complement, and it is the reason `customer` is conditional rather than always present:
    // an empty string would be a 400 from Stripe, and a fabricated id would be worse.
    stubStripe(sessionReply());
    const { as } = await withTenantHandle();

    await as.action(api.billing.startCheckout, {});

    expect(form().has("customer")).toBe(false);
  });
});

describe("billingStatus reads the mapping 28.1-05 landed, and still refuses to guess", () => {
  async function stateFor(status: string) {
    const t = convexTest(schema, modules);
    const { as, tenantId } = await tenantOn(t);
    await mapCustomer(t, tenantId, "cus_status", status);
    return await as.query(api.billing.billingStatus, {});
  }

  test("a trialing or an active mapping is `subscribed`", async () => {
    expect(await stateFor("trialing")).toEqual({ state: "subscribed" });
    expect(await stateFor("active")).toEqual({ state: "subscribed" });
  });

  test("a canceled mapping is `not_subscribed` — the arm 28.1-04 could not reach", async () => {
    expect(await stateFor("canceled")).toEqual({ state: "not_subscribed" });
  });

  test("a mapping that has seen no subscription event yet is `unknown`, never subscribed", async () => {
    // The window between `checkout.session.completed` and the first `customer.subscription.*`.
    // Reporting it as subscribed would grant access off a row that has never carried a status.
    expect(await stateFor("pending")).toEqual({ state: "unknown" });
  });

  test("ANOTHER tenant's mapping is not this tenant's status", async () => {
    // Two tenants on ONE backend, so the two ids genuinely differ.
    const t = convexTest(schema, modules);
    const mine = await tenantOn(t);
    const theirs = await tenantOn(t);
    expect(mine.tenantId).not.toBe(theirs.tenantId);
    await mapCustomer(t, theirs.tenantId, "cus_theirs", "active");
    expect(await mine.as.query(api.billing.billingStatus, {})).toEqual({ state: "unknown" });
  });
});

describe("portalLink opens the portal for a MAPPED tenant, and only for a mapped one", () => {
  test("a mapped tenant reaches Stripe with its OWN customer id", async () => {
    const t = convexTest(schema, modules);
    const { as, tenantId } = await tenantOn(t);
    await mapCustomer(t, tenantId, "cus_portal", "active");
    stubStripe({ status: 200, body: { id: "bps_1", url: PORTAL_URL } });

    expect(await as.action(api.billing.portalLink, {})).toEqual({ ok: true, url: PORTAL_URL });
    expect(sent().url).toContain("/v1/billing_portal/sessions");
    expect(form().get("customer")).toBe("cus_portal");
  });

  test("the portal is opened with the CALLER's customer, not with the first mapping in the table", async () => {
    const t = convexTest(schema, modules);
    const first = await tenantOn(t);
    const second = await tenantOn(t);
    await mapCustomer(t, first.tenantId, "cus_first", "active");
    await mapCustomer(t, second.tenantId, "cus_second", "active");
    stubStripe({ status: 200, body: { id: "bps_1", url: PORTAL_URL } });

    await second.as.action(api.billing.portalLink, {});
    expect(form().get("customer")).toBe("cus_second");
  });
});

describe("the subscription carries the tenant thread too, or an early event cannot be attributed", () => {
  test("startCheckout puts tenantId on subscription_data metadata as well as the session", async () => {
    // Stripe does not guarantee delivery order. A `customer.subscription.created` that overtakes
    // its `checkout.session.completed` has NO `client_reference_id` and no mapping to fall back
    // on — this is the only thread it can be attributed by, and without it it dead-letters.
    const { as } = await withTenant();
    stubStripe(sessionReply());
    await as.action(api.billing.startCheckout, {});
    const params = form();
    expect(params.get("subscription_data[metadata][tenantId]")).toBe(
      params.get("client_reference_id"),
    );
    expect(params.get("subscription_data[metadata][tenantId]")).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 28.1-06 — unapplied funds WITH THEIR AGE, and the guard on the owner's ledger decision.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Anything that can run a transaction: the bare backend OR an identity-carrying client. */
type Runner = Pick<ReturnType<typeof convexTest>, "run">;

async function seedUnapplied(
  t: Runner,
  tenantId: string,
  rows: { stripeObjectId: string; amountMinor: number; currency?: string; ageDays: number }[],
): Promise<void> {
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert("billingUnapplied", {
        tenantId,
        stripeObjectId: row.stripeObjectId,
        amountMinor: row.amountMinor,
        currency: row.currency ?? "USD",
        observedAt: Date.now() - row.ageDays * DAY,
        amountAt: Date.now() - row.ageDays * DAY,
      });
    }
  });
}

const openBillingCoverage = (t: Runner, tenantId: string) =>
  t.run(async (ctx) => {
    await ctx.db.insert("billingCoverage", { tenantId, coverageStartedAt: Date.now() - 30 * DAY });
  });

describe("unapplied funds are visible WITH their age", () => {
  test("each amount carries its age in days and its stage on Stripe's 75/90 clock", async () => {
    const { as, tenantId } = await withTenant();
    const t = as;
    await openBillingCoverage(t, tenantId);
    await seedUnapplied(t, tenantId, [
      { stripeObjectId: "cus_fresh", amountMinor: 2500, ageDays: 3 },
      { stripeObjectId: "cus_returning", amountMinor: 400, ageDays: 76 },
      { stripeObjectId: "cus_swept", amountMinor: 100, ageDays: 91 },
    ]);

    const result = await t.query(api.billing.unappliedFunds, {});
    const byId = Object.fromEntries(result.funds.map((f) => [f.stripeObjectId, f]));

    // The amount alone is not the answer: Stripe emails reminders, attempts to RETURN the money to
    // the customer's bank at 75 days, and sweeps what it cannot return by 90.
    expect(byId.cus_fresh).toMatchObject({ amountMinor: 2500, ageDays: 3, stage: "held" });
    expect(byId.cus_returning).toMatchObject({ ageDays: 76, stage: "return-attempted" });
    expect(byId.cus_swept).toMatchObject({ ageDays: 91, stage: "swept" });
    expect(result.coverage).toBe("known");
  });

  test("the currency travels with every amount — two currencies never combine", async () => {
    const { as, tenantId } = await withTenant();
    await openBillingCoverage(as, tenantId);
    await seedUnapplied(as, tenantId, [
      { stripeObjectId: "cus_1", amountMinor: 2500, currency: "USD", ageDays: 1 },
      { stripeObjectId: "cus_1", amountMinor: 900, currency: "EUR", ageDays: 1 },
    ]);

    const result = await as.query(api.billing.unappliedFunds, {});
    expect(result.funds).toHaveLength(2);
    expect(result.funds.map((f) => f.currency).sort()).toEqual(["EUR", "USD"]);
    // No blended total anywhere in the payload: there is no honest one to compute.
    expect(JSON.stringify(result)).not.toContain("totalMinor");
  });

  test("no billing coverage is an explicit UNKNOWN, never an empty list read as nothing owed", async () => {
    const { as } = await withTenant();
    const result = await as.query(api.billing.unappliedFunds, {});

    expect(result.coverage).toBe("unknown");
    expect(result.funds).toEqual([]);
    // The pair is the point: a covered tenant with no rows is a CONFIDENT nothing, and the two
    // must not render the same sentence.
    const covered = await withTenant();
    await openBillingCoverage(covered.as, covered.tenantId);
    const known = await covered.as.query(api.billing.unappliedFunds, {});
    expect(known.coverage).toBe("known");
    expect(known.funds).toEqual([]);
    expect(known).not.toEqual(result);
  });

  test("the read is bounded — a huge backlog cannot return everything", async () => {
    const { as, tenantId } = await withTenant();
    await openBillingCoverage(as, tenantId);
    const over = UNAPPLIED_FUNDS_PAGE_LIMIT + 5;
    await seedUnapplied(
      as,
      tenantId,
      Array.from({ length: over }, (_, i) => ({
        stripeObjectId: `cus_${i}`,
        amountMinor: 100 + i,
        ageDays: 1,
      })),
    );

    const result = await as.query(api.billing.unappliedFunds, {});
    expect(result.funds).toHaveLength(UNAPPLIED_FUNDS_PAGE_LIMIT);
    expect(result.truncated).toBe(true);
  });

  test("a CLEARED hold is not money — a zeroed row never reaches the surface", async () => {
    const { as, tenantId } = await withTenant();
    await openBillingCoverage(as, tenantId);
    await seedUnapplied(as, tenantId, [
      { stripeObjectId: "cus_cleared", amountMinor: 0, ageDays: 80 },
      { stripeObjectId: "cus_held", amountMinor: 2500, ageDays: 3 },
    ]);

    const result = await as.query(api.billing.unappliedFunds, {});
    // The zeroed row is kept by the WRITER so a late redelivery cannot resurrect the hold
    // (28.1-11 #8/#13). It is not a hold, so it is not rendered — and it must not arrive here
    // wearing an 80-day age and a "return-attempted" stage over an amount of nothing.
    expect(result.funds.map((f) => f.stripeObjectId)).toEqual(["cus_held"]);
    expect(result.coverage).toBe("known");
  });

  test("UNAPPLIED_FUNDS_PAGE_LIMIT is 100", () => {
    // Written out: a constant the test imports cannot be pinned by mutating it.
    expect(UNAPPLIED_FUNDS_PAGE_LIMIT).toBe(100);
  });

  test("one tenant never sees another's held funds", async () => {
    const t = convexTest(schema, modules);
    const mine = await tenantOn(t);
    const theirs = await tenantOn(t);
    await openBillingCoverage(t, mine.tenantId);
    await seedUnapplied(t, theirs.tenantId, [
      { stripeObjectId: "cus_theirs", amountMinor: 9999, ageDays: 2 },
    ]);

    const result = await mine.as.query(api.billing.unappliedFunds, {});
    expect(result.funds).toEqual([]);
  });
});

/**
 * THE GUARD ON THE OWNER'S LEDGER DECISION (2026-08-28).
 *
 * `billingEvents` is a separate book from `spendEvents` because `SPEND_RAILS` is a closed COST
 * union, `aggregateSpend` hard-codes all three rails in five places, and Phase 26 Finance renders
 * those totals as *what Pikar SPENDS*, today. A fourth `revenue` rail would put money-in into a
 * money-out figure on a live screen.
 */
describe("the spend plane is untouched by the billing ledger", () => {
  test("SPEND_RAILS is exactly the three cost rails, as a written-out literal", () => {
    // NOT `[...SPEND_RAILS]` compared to itself: the literal is the oracle, so a future `revenue`
    // rail is a RED test rather than a silent corruption of Finance.
    expect([...SPEND_RAILS]).toEqual(["reasoning", "media", "ingest"]);
    expect(SPEND_RAILS).toHaveLength(3);
    expect([...SPEND_RAILS]).not.toContain("revenue");
    expect([...SPEND_RAILS]).not.toContain("billing");
  });

  test("no source in the spend plane mentions a revenue rail", () => {
    const spend = spendSource["../../core/src/spend.ts"] ?? "";
    expect(spend.length).toBeGreaterThan(500); // non-vacuity
    expect(spend).not.toContain("revenue");
    expect(spend).toContain('SPEND_RAILS = ["reasoning", "media", "ingest"]');
  });

  test("finance.summary reports BYTE-IDENTICAL totals with and without billingEvents rows", async () => {
    const { as, tenantId } = await withTenantOnFinance();
    const now = Date.now();
    await as.run(async (ctx) => {
      await ctx.db.insert("spendCoverage", { tenantId, coverageStartedAt: now - 10 * DAY });
      for (const [i, rail] of ["reasoning", "media", "ingest"].entries()) {
        await ctx.db.insert("spendEvents", {
          tenantId,
          rail: rail as "reasoning" | "media" | "ingest",
          phase: "actual",
          amountCents: 100 * (i + 1),
          correlationId: `plan:cost:${i}`,
          createdAt: now - DAY,
        });
      }
    });

    const window = { sinceMs: now - 5 * DAY, untilMs: now + DAY, browserTimeZone: "UTC" };
    const before = await as.query(api.finance.summary, window);

    // The SAME tenant now also has a full billing history: an estimate, an arrival, a collection
    // and a refund, in a currency the spend plane has never heard of.
    await as.run(async (ctx) => {
      await ctx.db.insert("billingCoverage", { tenantId, coverageStartedAt: now - 10 * DAY });
      for (const [i, phase] of ["estimated", "reserved", "actual", "refunded"].entries()) {
        await ctx.db.insert("billingEvents", {
          tenantId,
          phase: phase as "estimated" | "reserved" | "actual" | "refunded",
          amountMinor: 490_000,
          currency: "JPY",
          correlationId: `billing/in_${i}`,
          kind: "invoice-paid-card",
          createdAt: now - DAY,
        });
      }
    });

    const after = await as.query(api.finance.summary, window);

    expect(JSON.stringify(after.tracked)).toBe(JSON.stringify(before.tracked));
    expect(after.coverageStartedAt).toBe(before.coverageStartedAt);
    // Non-vacuity: the spend rows really were aggregated, so "identical" is not "identically empty".
    expect(before.tracked.coverage).toBe("covered");
    if (before.tracked.coverage === "covered") {
      expect(before.tracked.totals.actual.amountCents).toBe(600);
    }
    // And the revenue is nowhere in the Finance payload at all.
    expect(JSON.stringify(after)).not.toContain("490000");
    expect(JSON.stringify(after)).not.toContain("JPY");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 28.1-07 (BILL-04) — the hosted invoice page, and the proof no card data exists.
//
// The tenant-facing half of the rollup is ONE link. B2B customers who cannot pay by card pay on
// Stripe's Hosted Invoice Page; we serve `invoice.hosted_invoice_url` and nothing else. There is
// no invoice renderer, no payment form and no card field anywhere in this repo, and the scans at
// the bottom of this file are what keep it that way.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const HOSTED_INVOICE = "https://invoice.stripe.com/i/acct_SENTINEL/test_SENTINELPAGE";

/** A period row in whatever state the test needs. There is no producer in the app yet. */
async function seedInvoicePeriod(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  over: Partial<{
    periodKey: string;
    status: "pending" | "claimed" | "posted" | "failed";
    hostedInvoiceUrl: string;
    amountMinor: number;
    currency: string;
    postedAt: number;
  }> = {},
) {
  const now = Date.now();
  const status = over.status ?? "posted";
  return await t.run((ctx) =>
    ctx.db.insert("billingPeriods", {
      tenantId,
      periodKey: over.periodKey ?? "2026-08",
      periodStart: now - 30 * 86_400_000,
      periodEnd: now - 86_400_000,
      dueAt: now - 3_600_000,
      status,
      charges: [
        {
          ref: "sub-1",
          kind: "subscription" as const,
          amountMinor: 4900,
          currency: "USD",
          occurredAt: now - 15 * 86_400_000,
          // Hand-seeded: a real charge carries the owner identity `raiseAdjustment` reads from
          // `ctx`, and this row has no producer behind it (28.1-10).
          raisedBy: "seeded_by_test",
        },
      ],
      attempts: 1,
      ...(status === "posted"
        ? {
            postedAt: over.postedAt ?? now,
            stripeInvoiceId: "in_SENTINELINVOICE",
            hostedInvoiceUrl: over.hostedInvoiceUrl ?? HOSTED_INVOICE,
            amountMinor: over.amountMinor ?? 4900,
            currency: over.currency ?? "USD",
          }
        : {}),
    }),
  );
}

/** Open billing coverage the way the first recorded movement would. */
async function openCoverage(t: ReturnType<typeof convexTest>, tenantId: string) {
  await t.run((ctx) =>
    ctx.db.insert("billingCoverage", { tenantId, coverageStartedAt: Date.now() - 86_400_000 }),
  );
}

describe("invoices serves the hosted page and never fabricates a zero", () => {
  test("a tenant we have never watched gets UNKNOWN coverage, not an empty bill history", async () => {
    const { as } = await withTenant();
    const answer = await as.query(api.billing.invoices, {});
    expect(answer.coverage).toBe("unknown");
    expect(answer.coverageStartedAt).toBeNull();
    expect(answer.invoices).toEqual([]);
    expect(answer.truncated).toBe(false);
  });

  test("KNOWN-and-empty is a DIFFERENT answer from UNKNOWN-and-empty", async () => {
    const t = convexTest(schema, modules);
    const a = await tenantOn(t);
    const b = await tenantOn(t);
    await openCoverage(t, a.tenantId);

    const known = await a.as.query(api.billing.invoices, {});
    const unknown = await b.as.query(api.billing.invoices, {});

    expect(known.coverage).toBe("known");
    expect(known.invoices).toEqual([]);
    // The `CashFigure` law: an empty list under `unknown` means "we have never watched this
    // tenant"; an empty list under `known` means "there is genuinely no invoice". Rendering both
    // as "no bills" is the mistake this assertion exists to prevent.
    expect(known).not.toEqual(unknown);
  });

  test("a posted period is returned with its hosted url VERBATIM and Stripe's own total", async () => {
    const { t, as, tenantId } = await withTenantHandle();
    await openCoverage(t, tenantId);
    await seedInvoicePeriod(t, tenantId);

    const answer = await as.query(api.billing.invoices, {});

    expect(answer.coverage).toBe("known");
    expect(answer.invoices).toHaveLength(1);
    const invoice = answer.invoices[0];
    // Passed through unchanged. Nothing in this codebase renders an invoice or a payment field.
    expect(invoice?.hostedInvoiceUrl).toBe(HOSTED_INVOICE);
    expect(invoice?.amountMinor).toBe(4900);
    expect(invoice?.currency).toBe("USD");
    expect(invoice?.periodKey).toBe("2026-08");
    expect(typeof invoice?.postedAt).toBe("number");
  });

  test("a period that has NOT been posted is not a bill and is not returned", async () => {
    const { t, as, tenantId } = await withTenantHandle();
    await openCoverage(t, tenantId);
    for (const status of ["pending", "claimed", "failed"] as const) {
      await seedInvoicePeriod(t, tenantId, { status, periodKey: `2026-0${status.length}` });
    }

    const answer = await as.query(api.billing.invoices, {});

    // A claimed period is work in progress; a failed one is an operator's problem, not a document
    // the customer owes money on. Neither has a hosted url to serve.
    expect(answer.invoices).toEqual([]);
    expect(answer.coverage).toBe("known");
  });

  test("a NON-POSTED row carrying a hosted url is still refused — by its STATUS", async () => {
    // 28.1-07 MUTATION FINDING. The first version of this suite seeded unposted periods with no
    // `hostedInvoiceUrl`, so the field guards refused them and the STATUS check killed nothing —
    // flipping `row.status === "posted"` to a tautology left the suite green. The load-bearing
    // guard was unfalsifiable. This row has every field a posted one has and the wrong status.
    const { t, as, tenantId } = await withTenantHandle();
    await openCoverage(t, tenantId);
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("billingPeriods", {
        tenantId,
        periodKey: "2026-08",
        periodStart: now - 30 * 86_400_000,
        periodEnd: now - 86_400_000,
        dueAt: now - 3_600_000,
        status: "failed",
        charges: [],
        attempts: 2,
        postedAt: now,
        stripeInvoiceId: "in_SENTINELNOTPOSTED",
        hostedInvoiceUrl: HOSTED_INVOICE,
        amountMinor: 4900,
        currency: "USD",
        failureCode: "stripe_http",
      }),
    );

    const answer = await as.query(api.billing.invoices, {});

    expect(answer.invoices).toEqual([]);
    expect(JSON.stringify(answer)).not.toMatch(/SENTINELNOTPOSTED/);
  });

  test("ANOTHER tenant's invoice is never in this tenant's list", async () => {
    const t = convexTest(schema, modules);
    const a = await tenantOn(t);
    const b = await tenantOn(t);
    await openCoverage(t, a.tenantId);
    await seedInvoicePeriod(t, b.tenantId, {
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_OTHER/test_OTHERTENANT",
    });

    const answer = await a.as.query(api.billing.invoices, {});

    expect(answer.invoices).toEqual([]);
    expect(JSON.stringify(answer)).not.toMatch(/OTHERTENANT/);
  });

  test("an unauthenticated caller gets nothing", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.billing.invoices, {})).rejects.toThrow();
  });

  test("the page limit is FIFTY, written out, and a full page says it is truncated", async () => {
    expect(INVOICE_PAGE_LIMIT).toBe(50);
    const { t, as, tenantId } = await withTenantHandle();
    await openCoverage(t, tenantId);
    for (let i = 0; i <= INVOICE_PAGE_LIMIT; i++) {
      await seedInvoicePeriod(t, tenantId, { periodKey: `2026-${String(i).padStart(3, "0")}` });
    }

    const answer = await as.query(api.billing.invoices, {});

    expect(answer.invoices).toHaveLength(INVOICE_PAGE_LIMIT);
    // Said out loud: a silently partial list of bills is a wrong one.
    expect(answer.truncated).toBe(true);
  });
});

describe("no invoice, payment form or card field exists anywhere a user can see", () => {
  const FORBIDDEN = ["card_number", "cvc", "exp_month", "exp_year", "three_d_secure", "3ds"];
  const pattern = new RegExp(FORBIDDEN.join("|"), "i");

  test("the web app scan is reading real files, not an empty glob", () => {
    expect(Object.keys(webSources).length).toBeGreaterThan(20);
    expect(pattern.test("<input name='card_number' />")).toBe(true);
  });

  test("the WEB app contains no card field and no 3DS handling either", () => {
    // The backend half is scanned above. This is the half a browser actually renders: the locked
    // decision is Stripe-hosted everything, so a card input appearing here is the decision being
    // reversed by accident.
    const offenders = Object.entries(webSources)
      .filter(([, content]) => pattern.test(codeOf(content)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  test("no web file renders an invoice document — we serve Stripe's hosted page", () => {
    // A renderer would need a total, a line-item loop and a tax line. We serve one anchor tag's
    // worth of surface, and 28.1-09 is when that anchor first appeared: this used to assert
    // `billing.invoices` had NO caller in apps/web, which was true and was the gap, not the goal.
    const callers = Object.entries(webSources)
      .filter(([, content]) => /api\.billing\.invoices/.test(codeOf(content)))
      .map(([path]) => path.split("/").pop());
    expect(callers).toEqual(["BillingPanel.tsx"]);

    const panel = codeOf(
      Object.entries(webSources).find(([path]) => path.endsWith("BillingPanel.tsx"))?.[1] ?? "",
    );
    // Non-vacuity: a blanked file would satisfy every negative below for the wrong reason.
    expect(panel.length).toBeGreaterThan(2000);
    expect(panel).toContain("hostedInvoiceUrl");
    // …and it serves the link rather than rebuilding the document Stripe already renders.
    expect(panel).not.toMatch(/line_items|lineItems|subtotal|amount_due|total_taxes|tax_amount/i);
  });
});

describe("every mutating Stripe call carries an idempotency key — proven at the CALL SITES", () => {
  /** The window a call's arguments may span. Every call site in this repo is well inside it. */
  const CALL_SPAN = 1200;

  const callSites = Object.entries(backendSources)
    .filter(([path]) => !path.endsWith(".test.ts") && path !== "./billingApi.ts")
    .flatMap(([path, content]) => {
      const code = codeOf(content);
      return [...code.matchAll(/stripePost\(/g)].map((match) => ({
        path,
        text: code.slice(match.index ?? 0, (match.index ?? 0) + CALL_SPAN),
      }));
    });

  test("the scan found the call sites it is supposed to guard", () => {
    // Non-vacuity. A unit test of `stripePost` cannot tell you a CALLER forgot, and an empty
    // list of call sites passes the assertion below for the wrong reason.
    expect(callSites.length).toBeGreaterThanOrEqual(4);
    expect(new Set(callSites.map((site) => site.path))).toEqual(
      new Set(["./billing.ts", "./billingRollup.ts"]),
    );
  });

  test("no stripePost call site omits idempotencyKey", () => {
    const offenders = callSites
      .filter((site) => !/idempotencyKey/.test(site.text))
      .map((site) => site.path);
    expect(offenders).toEqual([]);
  });

  test("…and stripeGet never pretends to carry one, because Stripe ignores it on a GET", () => {
    const wrong = Object.entries(backendSources)
      .filter(([path]) => !path.endsWith(".test.ts") && path !== "./billingApi.ts")
      .filter(([, content]) => /stripeGet\([^)]*idempotencyKey/.test(codeOf(content)))
      .map(([path]) => path);
    expect(wrong).toEqual([]);
  });
});
