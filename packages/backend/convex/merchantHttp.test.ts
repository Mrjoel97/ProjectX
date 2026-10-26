import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { boundedMerchantBody } from "./merchantHttp";
const modules = import.meta.glob("./**/*.*s");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("public merchant boundary", () => {
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
