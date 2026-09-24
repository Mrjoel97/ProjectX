import { describe, expect, it } from "vitest";
import type {
  MerchantAccountRef,
  MerchantProviderRef,
  OrderRef,
  PolicyVersionRef,
  ProductRef,
  SkuRef,
  TenantCommerceRef,
} from "@pikar/contracts/tenantCommerce";
import { addCommerceMinor, checkoutIdempotencyKey, multiplyCommerceMinor, quoteTenantCommerce } from "./tenantCommerce";

const tenant = "tenant-a" as TenantCommerceRef;
const product = "product-a" as ProductRef;
const sku = "sku-a" as SkuRef;
const pricePolicy = "price-v1" as PolicyVersionRef;
const taxPolicy = "tax-v1" as PolicyVersionRef;
const shippingPolicy = "ship-v1" as PolicyVersionRef;
const merchantAccount = "merchant-a" as MerchantAccountRef;
const provider = "provider-a" as MerchantProviderRef;

const input = () => ({
  tenant,
  merchantAccount,
  provider,
  taxPolicy,
  shippingPolicy,
  taxMinor: 200,
  shippingMinor: 300,
  lines: [{ tenant, product, sku, productVersion: 1, pricePolicy, currency: "USD", unitMinor: 1200, quantity: 2 }],
});

describe("tenant commerce contract", () => {
  it("adds only safe integer minor amounts and refuses overflow", () => {
    expect(addCommerceMinor(1200, 300)).toEqual({ ok: true, value: 1500 });
    expect(addCommerceMinor(Number.MAX_SAFE_INTEGER, 1)).toEqual({ ok: false, reason: "overflow" });
    expect(addCommerceMinor(-1, 1)).toEqual({ ok: false, reason: "invalid_amount" });
    expect(multiplyCommerceMinor(1200, 2)).toEqual({ ok: true, value: 2400 });
    expect(multiplyCommerceMinor(Number.MAX_SAFE_INTEGER, 2)).toEqual({ ok: false, reason: "overflow" });
    expect(multiplyCommerceMinor(100, 1.5)).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("quotes server-owned line, tax and shipping amounts with policy identities", () => {
    expect(quoteTenantCommerce(input())).toEqual({
      ok: true,
      quote: {
        tenant,
        merchantAccount,
        provider,
        taxPolicy,
        shippingPolicy,
        currency: "USD",
        subtotalMinor: 2400,
        taxMinor: 200,
        shippingMinor: 300,
        totalMinor: 2900,
        lines: input().lines,
      },
    });
  });

  it("rejects mixed currencies, negative and fractional amounts, and client total overrides", () => {
    expect(quoteTenantCommerce({ ...input(), lines: [...input().lines, { ...input().lines[0]!, currency: "EUR" }] })).toEqual({ ok: false, reason: "mixed_currency" });
    expect(quoteTenantCommerce({ ...input(), taxMinor: -1 })).toEqual({ ok: false, reason: "invalid_amount" });
    expect(quoteTenantCommerce({ ...input(), shippingMinor: 1.5 })).toEqual({ ok: false, reason: "invalid_amount" });
    expect(quoteTenantCommerce({ ...input(), clientTotalMinor: 1 } as unknown as Parameters<typeof quoteTenantCommerce>[0])).toEqual({ ok: false, reason: "client_total_override" });
    expect(quoteTenantCommerce({ ...input(), lines: null } as unknown as Parameters<typeof quoteTenantCommerce>[0])).toEqual({ ok: false, reason: "invalid_quantity" });
    expect(quoteTenantCommerce({ ...input(), lines: [null] } as unknown as Parameters<typeof quoteTenantCommerce>[0])).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses absent merchant configuration, stale prices and foreign lines", () => {
    expect(quoteTenantCommerce({ ...input(), merchantAccount: undefined })).toEqual({ ok: false, reason: "configuration_required" });
    expect(quoteTenantCommerce({ ...input(), taxPolicy: undefined })).toEqual({ ok: false, reason: "configuration_required" });
    expect(quoteTenantCommerce({ ...input(), provider: undefined })).toEqual({ ok: false, reason: "configuration_required" });
    expect(quoteTenantCommerce({ ...input(), lines: [{ ...input().lines[0]!, productVersion: 0 }] })).toEqual({ ok: false, reason: "stale" });
    expect(quoteTenantCommerce({ ...input(), lines: [{ ...input().lines[0]!, tenant: "tenant-b" as TenantCommerceRef }] })).toEqual({ ok: false, reason: "foreign" });
  });

  it("uses tenant, order and purpose for a deterministic refs-only idempotency input", () => {
    const order = "order-a" as OrderRef;
    const key = checkoutIdempotencyKey({ tenant, order, purpose: "checkout", attempt: 1 });
    expect(key).toEqual(checkoutIdempotencyKey({ tenant, order, purpose: "checkout", attempt: 1 }));
    expect(key).not.toEqual(checkoutIdempotencyKey({ tenant: "tenant-b" as TenantCommerceRef, order, purpose: "checkout", attempt: 1 }));
    expect(key).not.toContain("buyer");
    expect(() => checkoutIdempotencyKey({ tenant, order, purpose: "other", attempt: 1 } as unknown as Parameters<typeof checkoutIdempotencyKey>[0])).toThrow(RangeError);
  });
});
