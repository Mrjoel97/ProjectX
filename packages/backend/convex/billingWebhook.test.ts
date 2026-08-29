// The Stripe webhook route, driven END TO END in-memory via `convexTest(...).fetch()`.
//
// Everything here is offline at $0 against a FABRICATED `whsec_test_…` secret. No live Stripe key,
// no Dashboard configuration, no network. The handler cannot tell the difference — that is the
// point of verifying a signature rather than trusting a source.
//
// The signature is computed IN THIS FILE with the same HMAC law, never by calling
// `verifyStripeSignature`. A test that signs with the function under test proves only that the
// function agrees with itself.
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
