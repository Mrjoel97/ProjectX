import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { boundedMerchantBody } from "./merchantHttp";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("public merchant boundary", () => {
  test("a public buyer cannot submit a private Flutterwave pilot order", async () => {
    const t = convexTest(schema, modules);
    const result = await t.fetch("/merchant/checkout/test-shop", {
      method: "POST",
      headers: {
        Origin: "https://some.convex.site",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "provider=flutterwave&country=TZ&qty:item=1",
    });
    expect(result.status).toBe(400);
    expect(await t.run((ctx) => ctx.db.query("tenantOrders").collect())).toEqual([]);
  });
  test("v3 Flutterwave webhook requires its secret before looking up an order", async () => {
    const t = convexTest(schema, modules),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_SECRET_KEY", "FLWSECK_TEST-fixture-X");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_WEBHOOK_SECRET", "test-webhook-hash");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_ACCOUNT_ID", "12345");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_TENANT_ID", "test-tenant");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_PROJECT_ID", "test-project");
    const event = {
      event: "charge.completed",
      data: {
        id: 42,
        account_id: 12345,
        tx_ref: `pikar-flw-${"a".repeat(64)}`,
        status: "successful",
      },
    };
    const send = (body: unknown, secret?: string) =>
      t.fetch("/merchant/flutterwave/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "verif-hash": secret } : {}),
        },
        body: JSON.stringify(body),
      });
    expect((await send(event)).status).toBe(401);
    expect((await send(event, "wrong")).status).toBe(401);
    const secret = "test-webhook-hash";
    expect((await send({ ...event, data: { ...event.data, id: -1 } }, secret)).status).toBe(400);
    expect(
      (await send({ ...event, data: { ...event.data, account_id: 777 } }, secret)).status,
    ).toBe(200);
    expect(
      (await send({ ...event, data: { ...event.data, tx_ref: "unrelated" } }, secret)).status,
    ).toBe(200);
    expect(await (await send(event, secret)).text()).toBe("ignored");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("tenantMerchantEvents").collect())).toEqual([]);
  });
  test("actual streamed bodies are bounded even with absent or dishonest content-length", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5000));
        controller.enqueue(new Uint8Array(5000));
        controller.close();
      },
    });
    await expect(
      boundedMerchantBody(
        new Request("https://native.test/merchant/checkout/shop", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit),
        8192,
      ),
    ).rejects.toThrow("TOO_LARGE");
    await expect(
      boundedMerchantBody(
        new Request("https://native.test/merchant/checkout/shop", {
          method: "POST",
          body: "ok",
          headers: { "Content-Length": "9999999" },
        }),
        8192,
      ),
    ).rejects.toThrow("TOO_LARGE");
  });
  test("cross-origin buyer POST cannot create an order or invoke a provider", async () => {
    const t = convexTest(schema, modules),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await t.fetch("/merchant/checkout/native-shop", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "provider=stripe&country=TZ&qty:item=1",
    });
    expect(result.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("tenantOrders").collect())).toEqual([]);
  });
  test("invalid signed webhook cannot certify payment or reach provider reconciliation", async () => {
    vi.stubEnv("MERCHANT_STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
    vi.stubEnv("MERCHANT_STRIPE_TEST_WEBHOOK_SECRET", "whsec_fixture");
    const t = convexTest(schema, modules),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await t.fetch("/merchant/stripe/webhook", {
      method: "POST",
      headers: { "Stripe-Signature": "t=0,v1=invalid", "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "evt_attack",
        livemode: false,
        account: "acct_attack",
        data: { object: { id: "cs_test_attack" } },
      }),
    });
    expect(result.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("tenantMerchantEvents").collect())).toEqual([]);
  });
});
