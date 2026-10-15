import { COMMERCIAL_BILLING_ENABLED } from "@pikar/billing/config";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("release disables checkout even with Stripe credentials and price installed", async () => {
  expect(COMMERCIAL_BILLING_ENABLED).toBe(false);
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_configured");
  vi.stubEnv("BILLING_STRIPE_PRICE_ID", "price_configured");
  vi.stubEnv("SITE_URL", "https://app.example.com");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  const result = await t.withIdentity({ subject: "tenant" }).action(api.billing.startCheckout, {});
  expect(result).toEqual({ ok: false, reason: "commercial_billing_disabled" });
  expect(fetchMock).not.toHaveBeenCalled();
});
