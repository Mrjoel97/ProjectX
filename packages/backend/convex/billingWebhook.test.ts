// The Stripe webhook route, driven END TO END in-memory via `convexTest(...).fetch()`.
//
// Everything here is offline at $0 against a FABRICATED `whsec_test_…` secret. No live Stripe key,
// no Dashboard configuration, no network. The handler cannot tell the difference — that is the
// point of verifying a signature rather than trusting a source.
//
// The signature is computed IN THIS FILE with the same HMAC law, never by calling
// `verifyStripeSignature`. A test that signs with the function under test proves only that the
// function agrees with itself.
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const SECRET = "whsec_test_2b8f1c4d9e0a7f3b6c5d4e2a1f0b9c8d";
const OTHER_SECRET = "whsec_test_0000000000000000000000000000000000";
const PATH = "/billing/stripe/webhook";

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** The HMAC law, written out independently of the module under test. */
async function sign(payload: string, t: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const nowS = () => Math.floor(Date.now() / 1000);

/**
 * A deliberately NON-canonical body: odd key order, extra whitespace, a nested object. If anything
 * in the handler re-serialized this before verifying, the HMAC would stop matching.
 */
function body(overrides: { id?: string; type?: string; objectId?: string } = {}): string {
  const { id = "evt_1", type = "invoice.paid", objectId = "in_1" } = overrides;
  return `{  "type": ${JSON.stringify(type)},\n  "data" : { "object": { "id": ${JSON.stringify(
    objectId,
  )}, "amount_paid": 1200 } },\n "id":${JSON.stringify(id)} }`;
}

/** Fire one delivery against a SHARED harness, so row counts accumulate across calls. */
async function deliver(t: ReturnType<typeof harness>, payload: string, header: string) {
  return await t.fetch(PATH, {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
}

async function signedHeader(payload: string, secret = SECRET, ts = nowS()) {
  return `t=${ts},v1=${await sign(payload, ts, secret)}`;
}

const rows = (t: ReturnType<typeof harness>) =>
  t.run(async (ctx) => await ctx.db.query("billingStripeEvents").collect());

beforeEach(() => {
  vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("POST /billing/stripe/webhook — acceptance", () => {
  test("a valid signature over the EXACT raw body returns 200 and writes exactly one row", async () => {
    const t = harness();
    const payload = body();
    const res = await deliver(t, payload, await signedHeader(payload));
    expect(res.status).toBe(200);

    const stored = await rows(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      eventId: "evt_1",
      eventType: "invoice.paid",
      objectId: "in_1",
    });
  });

  // Stripe puts a fake `v0` on test events and both signatures on one header during a secret roll.
  test("two v1 values where only the SECOND is correct still verifies (secret roll)", async () => {
    const t = harness();
    const payload = body();
    const ts = nowS();
    const good = await sign(payload, ts, SECRET);
    const stale = await sign(payload, ts, OTHER_SECRET);
    const res = await deliver(t, payload, `t=${ts},v1=${stale},v1=${good}`);
    expect(res.status).toBe(200);
    expect(await rows(t)).toHaveLength(1);
  });

  test("an UNHANDLED event type is 200 and recorded `ignored` — never a 500", async () => {
    const t = harness();
    const payload = body({ id: "evt_d", type: "charge.dispute.created", objectId: "dp_1" });
    const res = await deliver(t, payload, await signedHeader(payload));
    expect(res.status).toBe(200);
    const stored = await rows(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: "ignored",
      eventType: "charge.dispute.created",
    });
  });

  // CLAUDE.md §4: the stored row carries ids, types and counts ONLY.
  test("the stored row carries no payload — the amount in the body never reaches the DB", async () => {
    const t = harness();
    const payload = body();
    await deliver(t, payload, await signedHeader(payload));
    const stored = await rows(t);
    expect(JSON.stringify(stored[0])).not.toContain("1200");
    expect(JSON.stringify(stored[0])).not.toContain("amount_paid");
  });
});

describe("POST /billing/stripe/webhook — idempotency is structural", () => {
  test("the IDENTICAL delivery fired twice returns 200 twice and leaves exactly ONE row", async () => {
    const t = harness();
    const payload = body();
    const header = await signedHeader(payload);

    const first = await deliver(t, payload, header);
    const second = await deliver(t, payload, header);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await rows(t)).toHaveLength(1);
  });

  // Stripe's OWN duplicate guidance: some duplicates arrive as two DISTINCT Event objects. Keying
  // only on `event.id` would apply the same object transition twice.
  test("a DIFFERENT event.id for the same (object, type) is recorded but NOT applied again", async () => {
    const t = harness();
    const first = body({ id: "evt_a", type: "invoice.paid", objectId: "in_dup" });
    const second = body({ id: "evt_b", type: "invoice.paid", objectId: "in_dup" });

    expect((await deliver(t, first, await signedHeader(first))).status).toBe(200);
    expect((await deliver(t, second, await signedHeader(second))).status).toBe(200);

    const stored = await rows(t);
    expect(stored).toHaveLength(2);
    expect(stored.map((r) => r.eventId).sort()).toEqual(["evt_a", "evt_b"]);
  });

  // THE BRANCH ITSELF, asserted directly rather than through the stored row.
  //
  // This test exists because the route-level version of it is currently VACUOUS: the effect switch
  // is empty, so `status` is `ignored` either way and no assertion over the rows can tell the
  // by-object branch from the ordinary path. `outcome` can, and a mutation that deletes the
  // `by_object_type` read fails HERE and nowhere else.
  test("receiveAndApply reports the three outcomes apart: new / duplicate_event / duplicate_object", async () => {
    const t = harness();
    const call = (eventId: string, eventType: string, objectId: string) =>
      t.mutation(internal.billingWebhook.receiveAndApply, { eventId, eventType, objectId });

    expect(await call("evt_1", "invoice.paid", "in_9")).toEqual({
      outcome: "new",
      status: "ignored",
    });
    // Stripe re-delivering the SAME Event object: nothing new is stored.
    expect(await call("evt_1", "invoice.paid", "in_9")).toEqual({
      outcome: "duplicate_event",
      status: "ignored",
    });
    // A DIFFERENT Event object for the same (object, type): stored, but never applied.
    expect(await call("evt_2", "invoice.paid", "in_9")).toEqual({
      outcome: "duplicate_object",
      status: "ignored",
    });
    // A different object is not a duplicate of anything.
    expect(await call("evt_3", "invoice.paid", "in_10")).toEqual({
      outcome: "new",
      status: "ignored",
    });
    // Nor is a different type on the same object.
    expect(await call("evt_4", "invoice.finalized", "in_9")).toEqual({
      outcome: "new",
      status: "ignored",
    });
    expect(await rows(t)).toHaveLength(4);
  });

  // An empty objectId must not be a dedupe key, or every object-less event would collapse into
  // one bucket. Asserted on `outcome`, because the row count alone cannot see the branch.
  test("an EMPTY objectId is never treated as a duplicate-by-object", async () => {
    const t = harness();
    const call = (eventId: string) =>
      t.mutation(internal.billingWebhook.receiveAndApply, {
        eventId,
        eventType: "invoice.paid",
        objectId: "",
      });
    expect((await call("evt_e1")).outcome).toBe("new");
    expect((await call("evt_e2")).outcome).toBe("new");
  });

  test("the same object with a DIFFERENT type is not a duplicate", async () => {
    const t = harness();
    const a = body({ id: "evt_f", type: "invoice.finalized", objectId: "in_x" });
    const b = body({ id: "evt_p", type: "invoice.paid", objectId: "in_x" });
    await deliver(t, a, await signedHeader(a));
    await deliver(t, b, await signedHeader(b));
    expect(await rows(t)).toHaveLength(2);
  });

  // An absent object id must NOT collapse every such event into one dedupe bucket.
  test("two events with no object id are both recorded", async () => {
    const t = harness();
    const a = `{"id":"evt_n1","type":"invoice.paid"}`;
    const b = `{"id":"evt_n2","type":"invoice.paid"}`;
    await deliver(t, a, await signedHeader(a));
    await deliver(t, b, await signedHeader(b));
    const stored = await rows(t);
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => r.objectId === "")).toBe(true);
  });
});

describe("POST /billing/stripe/webhook — refusal writes NOTHING", () => {
  test("a body tampered AFTER signing is 400 and zero rows", async () => {
    const t = harness();
    const payload = body();
    const header = await signedHeader(payload);
    const tampered = payload.replace("1200", "9900000");

    const res = await deliver(t, tampered, header);
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  test("signed with a DIFFERENT secret is 400 and zero rows", async () => {
    const t = harness();
    const payload = body();
    const res = await deliver(t, payload, await signedHeader(payload, OTHER_SECRET));
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  // THE TOLERANCE GUARD, isolated. The signature below is genuinely VALID — only `t` is stale —
  // so this test can only pass while the recency check exists independently of the HMAC check.
  test("a stale `t` (older than the 300s tolerance) is 400 even with a VALID signature", async () => {
    const t = harness();
    const payload = body();
    const stale = nowS() - 301;
    const res = await deliver(t, payload, await signedHeader(payload, SECRET, stale));
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  test("a `t` 299s old, correctly signed, is still ACCEPTED — the window is 300, not 0", async () => {
    const t = harness();
    const payload = body();
    const res = await deliver(t, payload, await signedHeader(payload, SECRET, nowS() - 299));
    expect(res.status).toBe(200);
    expect(await rows(t)).toHaveLength(1);
  });

  // A future-dated `t` is the same replay risk mirrored; `Math.abs` is load-bearing.
  test("a `t` far in the FUTURE is 400", async () => {
    const t = harness();
    const payload = body();
    const res = await deliver(t, payload, await signedHeader(payload, SECRET, nowS() + 3600));
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  test("a header carrying only v0 is 400 and zero rows", async () => {
    const t = harness();
    const payload = body();
    const ts = nowS();
    const res = await deliver(t, payload, `t=${ts},v0=${await sign(payload, ts, SECRET)}`);
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  test.each([
    ["", "empty header"],
    ["garbage", "no key=value"],
    ["v1=abc", "no t"],
  ])("a malformed header (%s — %s) is 400 and zero rows", async (header) => {
    const t = harness();
    const res = await deliver(t, body(), header);
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  test("no `stripe-signature` header at all is 400", async () => {
    const t = harness();
    const res = await t.fetch(PATH, { method: "POST", body: body() });
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  // p25-no-dev-fallback: an unconfigured deployment must be SILENT, never credulous. And it must
  // refuse BEFORE reading the body — an unset secret is not an invitation to parse untrusted input.
  test("BILLING_STRIPE_WEBHOOK_SECRET unset is 400, zero rows, and the body is NEVER read", async () => {
    const payload = body();
    const header = await signedHeader(payload); // signed correctly — only the SECRET is absent
    vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", "");
    const t = harness();
    // Watch the raw-body read itself. If the handler reads the body before checking the secret,
    // this fails — asserting only on the 400 would pass for the wrong reason.
    const textSpy = vi.spyOn(Request.prototype, "text");

    const res = await deliver(t, payload, header);

    expect(res.status).toBe(400);
    expect(textSpy).not.toHaveBeenCalled();
    expect(await rows(t)).toHaveLength(0);
    textSpy.mockRestore();
  });

  test("a correctly-signed body that is not JSON is 400 and zero rows", async () => {
    const t = harness();
    const payload = "not json at all";
    const res = await deliver(t, payload, await signedHeader(payload));
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });

  test("a correctly-signed JSON body with no `id` is 400 and zero rows", async () => {
    const t = harness();
    const payload = `{"type":"invoice.paid","data":{"object":{"id":"in_1"}}}`;
    const res = await deliver(t, payload, await signedHeader(payload));
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 28.1-05: the tenant ↔ Stripe-customer mapping, and the refusal that keeps it honest.
//
// Everything below is driven through the SAME signature-verified route as the tests above — a
// fabricated `whsec_`, a fabricated event, no network. What is being proven is not that a helper
// would behave; it is what the SHIPPED path writes to the database.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The PII a real Stripe delivery carries. Present in every fabricated event below, on purpose. */
const SENTINEL_EMAIL = "sentinel-buyer@example.invalid";
const SENTINEL_NAME = "Sentinel Buyer";

/** Create a real `users` row and return its id as a tenantId, exactly as `requireScope` derives it. */
async function seedTenant(t: ReturnType<typeof harness>): Promise<string> {
  return String(await t.run((ctx) => ctx.db.insert("users", { email: "seeded@example.invalid" })));
}

/** A `checkout.session.completed` body, with the customer's email and name on it. */
function checkoutBody(input: {
  id?: string;
  sessionId?: string;
  customer?: string | null;
  clientReferenceId?: string | null;
  metadataTenantId?: string | null;
  subscription?: string | null;
  created?: number;
}): string {
  const object: Record<string, unknown> = {
    id: input.sessionId ?? "cs_test_1",
    object: "checkout.session",
    amount_total: 4900,
    status: "complete",
    customer_details: { email: SENTINEL_EMAIL, name: SENTINEL_NAME, phone: "+15550000000" },
    customer_email: SENTINEL_EMAIL,
  };
  if (input.customer !== null) object.customer = input.customer ?? "cus_1";
  if (input.clientReferenceId !== null) object.client_reference_id = input.clientReferenceId;
  if (input.metadataTenantId !== null) object.metadata = { tenantId: input.metadataTenantId };
  if (input.subscription !== null) object.subscription = input.subscription ?? "sub_1";
  return JSON.stringify({
    id: input.id ?? "evt_checkout_1",
    type: "checkout.session.completed",
    created: input.created ?? 1_700_000_000,
    data: { object },
  });
}

/** A `customer.subscription.*` body, with the payment method's billing details on it. */
function subscriptionBody(input: {
  id?: string;
  type?: string;
  subscriptionId?: string;
  customer?: string;
  status?: string;
  metadataTenantId?: string | null;
  created?: number;
}): string {
  const object: Record<string, unknown> = {
    id: input.subscriptionId ?? "sub_1",
    object: "subscription",
    customer: input.customer ?? "cus_1",
    status: input.status ?? "trialing",
    trial_end: 1_800_000_000,
    items: { data: [{ id: "si_1", price: { id: "price_1", nickname: "Pikar AI" } }] },
    default_payment_method: { billing_details: { email: SENTINEL_EMAIL, name: SENTINEL_NAME } },
  };
  if (input.metadataTenantId) object.metadata = { tenantId: input.metadataTenantId };
  return JSON.stringify({
    id: input.id ?? "evt_sub_1",
    type: input.type ?? "customer.subscription.created",
    created: input.created ?? 1_700_000_100,
    data: { object },
  });
}

async function send(t: ReturnType<typeof harness>, payload: string): Promise<Response> {
  return await deliver(t, payload, await signedHeader(payload));
}

const mappings = (t: ReturnType<typeof harness>) =>
  t.run(async (ctx) => await ctx.db.query("billingCustomers").collect());
const letters = (t: ReturnType<typeof harness>) =>
  t.run(async (ctx) => await ctx.db.query("deadLetters").collect());
const auditRows = (t: ReturnType<typeof harness>) =>
  t.run(async (ctx) => await ctx.db.query("audit").collect());
const userCount = (t: ReturnType<typeof harness>) =>
  t.run(async (ctx) => (await ctx.db.query("users").collect()).length);

describe("the tenant <-> Stripe-customer mapping resolves in BOTH directions", () => {
  test("a checkout for a known tenant writes one row that resolves each way", async () => {
    const t = harness();
    const tenantId = await seedTenant(t);
    expect((await send(t, checkoutBody({ clientReferenceId: tenantId }))).status).toBe(200);

    // BOTH directions through the real indexes, not through a `.collect()` filter: two indexes is
    // the requirement, and a single-index mapping would pass a collect-and-filter assertion.
    const forward = await t.run((ctx) =>
      ctx.db
        .query("billingCustomers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .first(),
    );
    const reverse = await t.run((ctx) =>
      ctx.db
        .query("billingCustomers")
        .withIndex("by_customer", (q) => q.eq("stripeCustomerId", "cus_1"))
        .first(),
    );
    expect(forward?.stripeCustomerId).toBe("cus_1");
    expect(reverse?.tenantId).toBe(tenantId);
    expect(forward?._id).toEqual(reverse?._id);
    expect(await mappings(t)).toHaveLength(1);
  });

  test("the tenant is found via metadata.tenantId when client_reference_id is absent", async () => {
    const t = harness();
    const tenantId = await seedTenant(t);
    await send(t, checkoutBody({ clientReferenceId: null, metadataTenantId: tenantId }));
    const [row] = await mappings(t);
    expect(row?.tenantId).toBe(tenantId);
  });

  test("the mapping is written to the ONE tenant that paid, across two tenants on one backend", async () => {
    // Anti-vacuity: a handler that hardcoded a tenant id, or took "the first users row", passes a
    // single-tenant version of this test.
    const t = harness();
    const first = await seedTenant(t);
    const second = await seedTenant(t);
    expect(first).not.toBe(second);
    await send(t, checkoutBody({ clientReferenceId: second, customer: "cus_second" }));
    const [row] = await mappings(t);
    expect(row?.tenantId).toBe(second);
    expect(row?.tenantId).not.toBe(first);
  });

  test("the SAME event delivered twice leaves exactly ONE mapping row", async () => {
    const t = harness();
    const tenantId = await seedTenant(t);
    const payload = checkoutBody({ clientReferenceId: tenantId });
    const header = await signedHeader(payload);
    expect((await deliver(t, payload, header)).status).toBe(200);
    expect((await deliver(t, payload, header)).status).toBe(200);
    expect(await mappings(t)).toHaveLength(1);
  });

  test("a checkout and its subscription event, in EITHER order, leave one row with the status", async () => {
    // Stripe does not guarantee delivery order. The subscription carries `metadata.tenantId`
    // because `startCheckout` puts it on `subscription_data[metadata]` — without that thread the
    // early-subscription case has nothing to attribute to and must dead-letter.
    for (const order of ["checkout-first", "subscription-first"] as const) {
      const t = harness();
      const tenantId = await seedTenant(t);
      const checkout = checkoutBody({ clientReferenceId: tenantId });
      const sub = subscriptionBody({ metadataTenantId: tenantId });
      const first = order === "checkout-first" ? checkout : sub;
      const second = order === "checkout-first" ? sub : checkout;
      await send(t, first);
      await send(t, second);

      const rows = await mappings(t);
      expect(rows, order).toHaveLength(1);
      expect(rows[0], order).toMatchObject({
        tenantId,
        stripeCustomerId: "cus_1",
        subscriptionId: "sub_1",
        status: "trialing",
        priceId: "price_1",
      });
      expect(await letters(t), order).toHaveLength(0);
    }
  });

  test("subscription.updated moves the status; deleted terminates it WITHOUT removing the row", async () => {
    const t = harness();
    const tenantId = await seedTenant(t);
    await send(t, checkoutBody({ clientReferenceId: tenantId }));
    await send(
      t,
      subscriptionBody({
        id: "evt_up",
        type: "customer.subscription.updated",
        status: "active",
        created: 1_700_000_200,
      }),
    );
    expect((await mappings(t))[0]?.status).toBe("active");

    await send(
      t,
      subscriptionBody({
        id: "evt_del",
        type: "customer.subscription.deleted",
        status: "canceled",
        created: 1_700_000_300,
      }),
    );
    const rows = await mappings(t);
    // The mapping SURVIVES a cancellation: the customer still exists at Stripe, and losing the id
    // is how a returning subscriber gets a second Stripe customer.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("canceled");
    expect(rows[0]?.stripeCustomerId).toBe("cus_1");
  });

  test("a LATE `updated` cannot resurrect a canceled subscription", async () => {
    // Order-independent is not the same as order-blind. Stripe re-delivers on failure, so an
    // `updated` generated BEFORE a `deleted` can arrive after it; applying it would hand a
    // canceled customer their access back.
    const t = harness();
    const tenantId = await seedTenant(t);
    await send(t, checkoutBody({ clientReferenceId: tenantId }));
    await send(
      t,
      subscriptionBody({
        id: "evt_del",
        type: "customer.subscription.deleted",
        status: "canceled",
        created: 1_700_000_300,
      }),
    );
    await send(
      t,
      subscriptionBody({
        id: "evt_stale",
        type: "customer.subscription.updated",
        status: "active",
        created: 1_700_000_100, // older than the cancellation
      }),
    );
    expect((await mappings(t))[0]?.status).toBe("canceled");
  });

  test("a SECOND Stripe customer for an already-mapped tenant is recorded, never absorbed", async () => {
    const t = harness();
    const tenantId = await seedTenant(t);
    await send(t, checkoutBody({ clientReferenceId: tenantId, customer: "cus_first" }));
    await send(
      t,
      // A second checkout is a second SESSION. Reusing `cs_test_1` would be deduped by
      // (objectId, eventType) before the effect switch ever ran, and the test would pass for the
      // wrong reason.
      checkoutBody({
        id: "evt_checkout_2",
        sessionId: "cs_test_2",
        clientReferenceId: tenantId,
        customer: "cus_second",
      }),
    );

    const rows = await mappings(t);
    expect(rows).toHaveLength(1);
    // The FIRST mapping stands. Silently overwriting it strands a live Stripe customer that
    // nothing in this database points at any more.
    expect(rows[0]?.stripeCustomerId).toBe("cus_first");
    const dl = await letters(t);
    expect(dl).toHaveLength(1);
    expect(dl[0]?.error).toBe("billing_tenant_customer_conflict");
    expect(dl[0]?.tenantId).toBe(tenantId);
  });

  test("a Stripe customer claimed by a SECOND tenant is recorded, never re-pointed", async () => {
    const t = harness();
    const first = await seedTenant(t);
    const second = await seedTenant(t);
    await send(t, checkoutBody({ clientReferenceId: first }));
    await send(
      t,
      checkoutBody({ id: "evt_checkout_2", sessionId: "cs_test_2", clientReferenceId: second }),
    );

    const rows = await mappings(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(first);
    const dl = await letters(t);
    expect(dl).toHaveLength(1);
    expect(dl[0]?.error).toBe("billing_customer_tenant_conflict");
  });
});

describe("an unmatched Stripe customer is dead-lettered by ref and NEVER auto-provisioned", () => {
  test("a checkout for an unknown tenant creates zero users, zero mappings, one dead letter", async () => {
    const t = harness();
    const before = await userCount(t);
    // A syntactically plausible tenant id that no `users` row carries.
    const res = await send(t, checkoutBody({ clientReferenceId: "kn700000000000000000000000000" }));
    expect(res.status).toBe(200); // still 200: Stripe must not retry a refusal we already recorded

    // COUNTS, not "no error was thrown". Auto-provisioning is a WRITE, and only a count sees it.
    expect(await userCount(t)).toBe(before);
    expect(await mappings(t)).toHaveLength(0);

    const dl = await letters(t);
    expect(dl).toHaveLength(1);
    expect(dl[0]).toMatchObject({
      source: "billing",
      status: "new",
      error: "billing_unknown_tenant",
      correlationId: "evt_checkout_1",
    });
    expect(dl[0]?.workflowId).toBeUndefined();
    // A code-owned sentinel. NOT an invented tenant id and NOT a real one borrowed from elsewhere.
    expect(dl[0]?.tenantId).toBe("billing:unattributed");
  });

  test("the stored dead letter contains NO email and NO name — whole-row string assertion", async () => {
    const t = harness();
    await send(t, checkoutBody({ clientReferenceId: "kn700000000000000000000000000" }));
    const [row] = await letters(t);
    // Asserted on the STORED ROW, not on the argument that was passed: a redaction that happens
    // after the insert is not a redaction.
    const json = JSON.stringify(row);
    expect(json).not.toContain(SENTINEL_EMAIL);
    expect(json).not.toContain(SENTINEL_NAME);
    expect(json).not.toContain("+15550000000");
    expect(json).not.toContain("4900");
    // Refs, ids and enum tokens only.
    expect(row?.payload).toEqual({
      stripeEventId: "evt_checkout_1",
      stripeEventType: "checkout.session.completed",
      stripeCustomerId: "cus_1",
      stripeObjectId: "cs_test_1",
    });
  });

  test("the audit row beside it is equally clean, and carries the reason as a CODE", async () => {
    const t = harness();
    await send(t, checkoutBody({ clientReferenceId: "kn700000000000000000000000000" }));
    const rows = (await auditRows(t)).filter((r) => r.eventType === "deadletter.written");
    expect(rows).toHaveLength(1);
    const json = JSON.stringify(rows[0]);
    expect(json).not.toContain(SENTINEL_EMAIL);
    expect(json).not.toContain(SENTINEL_NAME);
    expect(rows[0]?.actor).toBe("system");
    expect(rows[0]?.payload).toMatchObject({
      source: "billing",
      reason: "billing_unknown_tenant",
      status: "new",
    });
    // A code token, never prose: `error` and `reason` are rendered on the operator screen.
    expect(String(rows[0]?.payload?.reason)).toMatch(/^[a-z0-9_]+$/);
  });

  test("the SAME unmatched event delivered twice still produces exactly ONE dead letter", async () => {
    const t = harness();
    const payload = checkoutBody({ clientReferenceId: "kn700000000000000000000000000" });
    const header = await signedHeader(payload);
    await deliver(t, payload, header);
    await deliver(t, payload, header);
    expect(await letters(t)).toHaveLength(1);
  });

  test("a subscription event for an unknown customer takes the same refusal path", async () => {
    const t = harness();
    const before = await userCount(t);
    await send(
      t,
      subscriptionBody({ type: "customer.subscription.updated", customer: "cus_ghost" }),
    );
    expect(await userCount(t)).toBe(before);
    expect(await mappings(t)).toHaveLength(0);
    const dl = await letters(t);
    expect(dl).toHaveLength(1);
    expect(dl[0]?.error).toBe("billing_unattributable_customer");
    expect(dl[0]?.payload).toMatchObject({ stripeCustomerId: "cus_ghost" });
  });

  test("a checkout with NO tenant thread at all is refused, not guessed at", async () => {
    const t = harness();
    await seedTenant(t); // a tenant EXISTS — the handler must still not pick it
    await send(t, checkoutBody({ clientReferenceId: null, metadataTenantId: null }));
    expect(await mappings(t)).toHaveLength(0);
    expect((await letters(t))[0]?.error).toBe("billing_unattributable_customer");
  });

  test("a checkout with no customer id is refused rather than mapped to nothing", async () => {
    const t = harness();
    const tenantId = await seedTenant(t);
    await send(t, checkoutBody({ clientReferenceId: tenantId, customer: null }));
    expect(await mappings(t)).toHaveLength(0);
    expect((await letters(t))[0]?.error).toBe("billing_no_customer");
  });

  test("the mapping module contains no way to create a user or a tenant", () => {
    // A literal scan, because no type can express "this module cannot invent a user". Comments are
    // stripped first — a mention in prose is indistinguishable from a use to a naive `includes`.
    const src = readFileSync(new URL("./billingWebhook.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/insert\(\s*["']users["']/);
    expect(src).not.toMatch(/insert\(\s*["']tenant/);
    // Non-vacuity: the stripper must not have eaten the module.
    expect(src).toMatch(/insert\(\s*["']billingCustomers["']/);
    expect(src).toMatch(/insert\(\s*["']deadLetters["']/);
    // CLAUDE.md §3: nothing here mutates or removes a dead letter or an audit row.
    expect(src).not.toMatch(/(patch|replace|delete)\(\s*["'](deadLetters|audit)["']/);
  });
});
