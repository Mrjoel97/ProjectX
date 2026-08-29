// 28.1-04 Task 1 — the ONE outbound transport to Pikar's OWN Stripe account.
//
// Every test here is OFFLINE at $0 against a stubbed `fetch`. No live key, no network, no Stripe.
// A green run proves the REQUEST we would send, never that Stripe accepts it.
//
// Four refusals are proven INDEPENDENTLY, because sequential guards absorb each other and an
// absorbed guard has no coverage at all:
//   1. `BILLING_STRIPE_SECRET_KEY` unset          → throws, `fetch` never called
//   2. `STRIPE_API_VERSION` null (unpinned)       → throws, `fetch` never called
//   3. `stripePost` without an idempotency key    → throws, `fetch` never called
//   4. a hostile Stripe `error.code`              → dropped, never echoed
//
// (2) is the one a reader will want to argue with. An unpinned `Stripe-Version` is exactly the
// silent-payload-reshape hazard the pin exists to prevent — the invoice tax field is
// `total_tax_amounts` before Basil and `total_taxes` after — so shipping a request without it is
// WORSE than not shipping the request. It refuses for the same reason an unset secret does.
import { STRIPE_API_BASE, STRIPE_API_VERSION } from "@pikar/billing/config";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BILLING_STRIPE_TIMEOUT_MS, stripeGet, stripePost } from "./billingApi";

const SECRET = "sk_test_SENTINEL-BILLING-SECRET";

type Recorded = { url: string; method: string; body: string; headers: Record<string, string> };
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

let calls: Recorded[] = [];

/** Install a fake `fetch` that records the request and returns a canned reply. */
function stubStripe(reply: Reply | ((call: Recorded) => Reply)): void {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k] = v;
    }
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      headers,
    };
    calls.push(call);
    const r = typeof reply === "function" ? reply(call) : reply;
    return new Response(r.body === undefined ? "{}" : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  });
}

/** A `fetch` that throws before any response — the transport-error path. */
function stubThrowingFetch(error: unknown): void {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: "",
      headers: {},
    });
    throw error;
  });
}

/** A `fetch` that must never run. Calling it FAILS the test rather than returning something. */
function stubForbiddenFetch(): void {
  vi.stubGlobal("fetch", async () => {
    calls.push({ url: "FORBIDDEN", method: "", body: "", headers: {} });
    throw new Error("fetch was called and must not have been");
  });
}

beforeEach(() => {
  calls = [];
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("stripePost speaks Stripe's actual wire format", () => {
  test("the four headers, the origin and the path are exactly what Stripe requires", async () => {
    stubStripe({ status: 200, body: { id: "cs_test_1", url: "https://checkout.stripe.com/c/x" } });

    const result = await stripePost(
      "/v1/checkout/sessions",
      { mode: "subscription" },
      { idempotencyKey: "key-abc" },
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    // Exact equality, never `.includes` — a loose matcher survives a deletion mutation correctly
    // and would therefore make the mutation check unable to see the failure it exists to catch.
    expect(call.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(call.headers["Idempotency-Key"]).toBe("key-abc");
  });

  test("the pinned Stripe-Version is the WRITTEN-OUT version, not whatever the constant says", async () => {
    // Asserted against a literal on purpose. A test that compares the header to the imported
    // `STRIPE_API_VERSION` moves its own oracle with the subject: change the constant and the
    // assertion silently follows it, so the pin is never actually pinned by anything.
    stubStripe({ status: 200, body: {} });
    await stripePost("/v1/checkout/sessions", {}, { idempotencyKey: "k" });
    expect(calls[0].headers["Stripe-Version"]).toBe("2026-08-26.dahlia");
    // …and the wiring half: the header really is fed from config, not typed twice.
    expect(calls[0].headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect(STRIPE_API_BASE).toBe("https://api.stripe.com");
  });

  test("the body is form-encoded, never JSON — Stripe's API does not accept JSON", async () => {
    stubStripe({ status: 200, body: {} });
    await stripePost(
      "/v1/checkout/sessions",
      { mode: "subscription", "metadata[tenantId]": "t_1", "line_items[0][quantity]": "1" },
      { idempotencyKey: "k" },
    );

    const body = calls[0].body;
    expect(body).not.toContain("{");
    expect(body).not.toContain('"mode"');
    const parsed = new URLSearchParams(body);
    expect(parsed.get("mode")).toBe("subscription");
    expect(parsed.get("metadata[tenantId]")).toBe("t_1");
    expect(parsed.get("line_items[0][quantity]")).toBe("1");
  });

  test("the SAME inputs produce the SAME body — a replayed key must carry identical parameters", async () => {
    // Stripe errors when a key is replayed with different parameters, so the body must be a pure
    // function of the inputs and nothing else — not of the order they happen to be written in.
    stubStripe({ status: 200, body: {} });
    await stripePost("/v1/x", { b: "2", a: "1" }, { idempotencyKey: "same" });
    await stripePost("/v1/x", { a: "1", b: "2" }, { idempotencyKey: "same" });

    expect(calls[0].body).toBe(calls[1].body);
    expect(calls[0].headers["Idempotency-Key"]).toBe(calls[1].headers["Idempotency-Key"]);
    // Anti-vacuity: the bodies are equal because they encode the same pair, not because both are
    // empty.
    expect(calls[0].body.length).toBeGreaterThan(4);
  });
});

describe("stripeGet is the read half and carries no idempotency key", () => {
  test("Stripe honours Idempotency-Key on POST only, so a GET must not send one", async () => {
    stubStripe({ status: 200, body: { id: "in_1" } });
    const result = await stripeGet("/v1/invoices", { limit: "3" });

    expect(result.ok).toBe(true);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://api.stripe.com/v1/invoices?limit=3");
    expect(calls[0].headers["Idempotency-Key"]).toBeUndefined();
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0].headers["Stripe-Version"]).toBe("2026-08-26.dahlia");
  });
});

describe("every refusal fires on its own, before anything reaches the network", () => {
  test("GUARD 1: an unset BILLING_STRIPE_SECRET_KEY throws naming the variable, and fetch never runs", async () => {
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "");
    stubForbiddenFetch();

    await expect(
      stripePost("/v1/checkout/sessions", {}, { idempotencyKey: "k" }),
    ).rejects.toThrow(/BILLING_STRIPE_SECRET_KEY/);
    await expect(stripeGet("/v1/invoices")).rejects.toThrow(/BILLING_STRIPE_SECRET_KEY/);
    expect(calls).toEqual([]);
  });

  test("GUARD 1b: a whitespace-only secret is UNSET — `convex env set X \" \"` is the classic false-ready", async () => {
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "   ");
    stubForbiddenFetch();
    await expect(stripePost("/v1/x", {}, { idempotencyKey: "k" })).rejects.toThrow(
      /BILLING_STRIPE_SECRET_KEY/,
    );
    expect(calls).toEqual([]);
  });

  test("GUARD 2: an UNPINNED Stripe-Version refuses exactly like an unset secret", async () => {
    // Driven through a real re-import of the module under a mocked config, not through a helper
    // taking the version as an argument: what has to be proven is that the SHIPPED code path
    // consults the pin, not that some exported validator would have rejected null if called.
    vi.resetModules();
    vi.doMock("@pikar/billing/config", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      STRIPE_API_VERSION: null,
    }));
    stubForbiddenFetch();

    const unpinned = await import("./billingApi");
    await expect(unpinned.stripePost("/v1/x", {}, { idempotencyKey: "k" })).rejects.toThrow(
      /STRIPE_API_VERSION/,
    );
    await expect(unpinned.stripeGet("/v1/x")).rejects.toThrow(/STRIPE_API_VERSION/);
    expect(calls).toEqual([]);
    vi.doUnmock("@pikar/billing/config");
  });

  test("GUARD 3: a POST without an idempotency key throws, and fetch never runs", async () => {
    stubForbiddenFetch();
    // A type error at compile time; the cast is what lets the RUNTIME half be asserted at all.
    const noKey = stripePost as unknown as (p: string, q: Record<string, string>) => Promise<void>;
    await expect(noKey("/v1/checkout/sessions", {})).rejects.toThrow(/[Ii]dempotency/);
    const blank = stripePost("/v1/checkout/sessions", {}, { idempotencyKey: "  " });
    await expect(blank).rejects.toThrow(/[Ii]dempotency/);
    expect(calls).toEqual([]);
  });
});

describe("a Stripe failure carries ids and codes ONLY — never prose, never a body", () => {
  const PROSE =
    "SENTINEL-PROSE: No such price: 'price_x'; a similar object exists for joel@example.com";

  test("a 4xx returns the error CODE and the request id, and nothing else survives", async () => {
    stubStripe({
      status: 400,
      headers: { "Request-Id": "req_SENTINELREQ1" },
      body: {
        error: {
          type: "invalid_request_error",
          code: "resource_missing",
          param: "line_items[0][price]",
          message: PROSE,
          request_log_url: `https://dashboard.stripe.com/test/logs/req_x?t=${PROSE}`,
        },
      },
    });

    const result = await stripePost("/v1/checkout/sessions", {}, { idempotencyKey: "k" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("http");
    expect(result.error.status).toBe(400);
    expect(result.error.code).toBe("resource_missing");
    expect(result.error.requestId).toBe("req_SENTINELREQ1");
    // CLAUDE.md §4 — refs, hashes, ids and counts ONLY. Nothing loggable may carry the prose.
    const loggable = JSON.stringify(result);
    expect(loggable).not.toContain("SENTINEL-PROSE");
    expect(loggable).not.toContain("joel@example.com");
    expect(loggable).not.toContain("dashboard.stripe.com");
    expect(loggable).not.toContain("line_items");
  });

  test("a hostile error.code is DROPPED, not echoed — the code field is not a prose smuggling route", async () => {
    // `error.code` is documented as a stable enum token. Trusting that documentation is the exact
    // shape of trust this repo has already been bitten by, so the token is shape-checked here and
    // anything else becomes null.
    stubStripe({
      status: 402,
      body: { error: { code: `declined because ${PROSE}` } },
    });
    const result = await stripePost("/v1/x", {}, { idempotencyKey: "k" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBeNull();
    expect(result.error.status).toBe(402);
    expect(JSON.stringify(result)).not.toContain("SENTINEL-PROSE");
  });

  test("a malformed Request-Id is dropped too, so the failure never carries an attacker's string", async () => {
    stubStripe({
      status: 500,
      headers: { "Request-Id": "not a request id" },
      body: { error: { code: "api_error" } },
    });
    const result = await stripePost("/v1/x", {}, { idempotencyKey: "k" });
    if (result.ok) throw new Error("unreachable");
    expect(result.error.requestId).toBeNull();
    expect(result.error.code).toBe("api_error");
  });

  test("a 4xx with a body that is not JSON at all is still a structured failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>gateway</html>", { status: 502 }));
    const result = await stripePost("/v1/x", {}, { idempotencyKey: "k" });
    if (result.ok) throw new Error("unreachable");
    expect(result.error.status).toBe(502);
    expect(result.error.code).toBeNull();
    expect(JSON.stringify(result)).not.toContain("html");
  });
});

describe("a transport failure is surfaced, never swallowed into a success", () => {
  test("a network throw returns a failure", async () => {
    stubThrowingFetch(new TypeError("fetch failed"));
    const result = await stripePost("/v1/x", {}, { idempotencyKey: "k" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("network");
    expect(result.error.status).toBeNull();
  });

  test("a blown deadline is reported as a TIMEOUT, a different fact from a network blip", async () => {
    // They differ operationally: a timeout already spent the whole budget, a blip may not have.
    stubThrowingFetch(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const result = await stripePost("/v1/x", {}, { idempotencyKey: "k" });
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("timeout");
  });

  test("the deadline is a real, bounded number", async () => {
    expect(BILLING_STRIPE_TIMEOUT_MS).toBe(20_000);
  });
});
