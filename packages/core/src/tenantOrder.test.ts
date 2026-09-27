import { describe, expect, test } from "vitest";
import { quoteOrder, transitionOrder } from "./tenantOrder";

const product = {
  id: "p1",
  tenantId: "tenant-a",
  sku: "lamp",
  variant: "one",
  goodsKind: "physical" as const,
  currency: "USD",
  priceMinor: 1250,
  status: "active" as const,
  revision: 2,
};
const stock = {
  kind: "finite" as const,
  tenantId: "tenant-a",
  productId: "p1",
  onHand: 3,
  reserved: 0,
  revision: 4,
  reservationTtlMs: 900_000,
};
const input = {
  tenantId: "tenant-a",
  projectId: "site-a",
  addressCountry: "TZ",
  lines: [
    {
      presentationItemId: "card-1",
      productId: "p1",
      quantity: 2,
      expectedProductRevision: 2,
      expectedUnitMinor: 1250,
    },
  ],
  mappings: [{ presentationItemId: "card-1", productId: "p1", product, stock }],
  policy: {
    id: "policy-a",
    tenantId: "tenant-a",
    projectId: "site-a",
    revision: 1,
    sellerOfRecordRef: "seller-a",
    currency: "USD",
    countries: ["TZ"],
    taxRounding: "half_up" as const,
    physical: {
      taxSourceRef: "tax-a",
      taxBasisPoints: 1000,
      shippingSourceRef: "shipping-a",
      shippingMinor: 300,
      returnsPolicyRef: "returns-a",
      refundPolicyRef: "refund-v1",
      buyerRetentionRef: "retain-a",
    },
    digital: {
      taxSourceRef: "tax-d",
      taxBasisPoints: 500,
      deliveryRef: "delivery-a",
      revocationRef: "revoke-a",
      noShipping: true as const,
      refundPolicyRef: "refund-d",
      buyerRetentionRef: "retain-d",
    },
  },
};

describe("server order quote", () => {
  const digitalProduct = {
    ...product,
    id: "p2",
    sku: "ebook",
    goodsKind: "digital" as const,
    priceMinor: 1000,
  };
  const digitalStock = { ...stock, productId: "p2" };
  const digitalLine = {
    presentationItemId: "card-2",
    productId: "p2",
    quantity: 1,
    expectedProductRevision: 2,
    expectedUnitMinor: 1000,
  };
  const digitalMapping = {
    presentationItemId: "card-2",
    productId: "p2",
    product: digitalProduct,
    stock: digitalStock,
  };

  test("digital-only explicitly ships for zero; mixed cart taxes per kind and ships physical once", () => {
    const digital = quoteOrder({ ...input, lines: [digitalLine], mappings: [digitalMapping] });
    expect(digital).toMatchObject({
      ok: true,
      snapshot: {
        subtotalMinor: 1000,
        taxMinor: 50,
        shippingMinor: 0,
        totalMinor: 1050,
        lines: [{ goodsKind: "digital", taxSourceRef: "tax-d" }],
      },
    });
    const mixed = quoteOrder({
      ...input,
      lines: [...input.lines, digitalLine],
      mappings: [...input.mappings, digitalMapping],
    });
    expect(mixed).toMatchObject({
      ok: true,
      snapshot: { subtotalMinor: 3500, taxMinor: 300, shippingMinor: 300, totalMinor: 4100 },
    });
    if (mixed.ok && digital.ok) expect(mixed.snapshot.hash).not.toBe(digital.snapshot.hash);
  });

  test("legacy goods and each missing branch fact refuse, including mixed carts", () => {
    expect(
      quoteOrder({
        ...input,
        mappings: [{ ...input.mappings[0]!, product: { ...product, goodsKind: undefined } }],
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({ ...input, policy: { ...input.policy, physical: undefined } }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        lines: [digitalLine],
        mappings: [digitalMapping],
        policy: { ...input.policy, digital: undefined },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        lines: [digitalLine],
        mappings: [digitalMapping],
        policy: {
          ...input.policy,
          digital: { ...input.policy.digital, noShipping: false as never },
        },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        lines: [...input.lines, digitalLine],
        mappings: [...input.mappings, digitalMapping],
        policy: { ...input.policy, digital: undefined },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        policy: { ...input.policy, physical: { ...input.policy.physical, buyerRetentionRef: "" } },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({ ...input, policy: { ...input.policy, sellerOfRecordRef: "  \t" } }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        policy: {
          ...input.policy,
          physical: { ...input.policy.physical, buyerRetentionRef: " \n " },
        },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        lines: [digitalLine],
        mappings: [digitalMapping],
        policy: { ...input.policy, digital: { ...input.policy.digital, deliveryRef: "  " } },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    for (const physical of [
      { returnsPolicyRef: "" },
      { shippingMinor: -1 },
      { taxBasisPoints: 10_001 },
      { refundPolicyRef: "" },
    ])
      expect(
        quoteOrder({
          ...input,
          policy: { ...input.policy, physical: { ...input.policy.physical, ...physical } },
        }),
      ).toMatchObject({ ok: false, reason: "configuration_required" });
    for (const digital of [
      { deliveryRef: "" },
      { revocationRef: "" },
      { taxSourceRef: "" },
      { taxBasisPoints: 10_001 },
      { refundPolicyRef: "" },
      { buyerRetentionRef: "" },
    ])
      expect(
        quoteOrder({
          ...input,
          lines: [digitalLine],
          mappings: [digitalMapping],
          policy: { ...input.policy, digital: { ...input.policy.digital, ...digital } },
        }),
      ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({ ...input, policy: { ...input.policy, tenantId: "tenant-b" } }),
    ).toMatchObject({ ok: false, reason: "foreign" });
    expect(
      quoteOrder({ ...input, policy: { ...input.policy, projectId: "site-b" } }),
    ).toMatchObject({ ok: false, reason: "foreign" });
    expect(
      quoteOrder({ ...input, policy: { ...input.policy, taxRounding: undefined as never } }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        lines: [{ ...input.lines[0], goodsKind: "digital" }],
      } as unknown as typeof input),
    ).toMatchObject({ ok: false, reason: "invalid_cart" });
  });
  test("pins live mapped price, stock and explicit policy with exact minor-unit arithmetic", () => {
    const result = quoteOrder(input);
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        subtotalMinor: 2500,
        taxMinor: 250,
        shippingMinor: 300,
        totalMinor: 3050,
        policyId: "policy-a",
        lines: [
          { goodsKind: "physical", refundPolicyRef: "refund-v1", buyerRetentionRef: "retain-a" },
        ],
      },
    });
    if (result.ok) expect(result.snapshot.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("the quote digest is independent of nested policy property insertion order", () => {
    const original = quoteOrder(input);
    const reordered = quoteOrder({
      ...input,
      policy: {
        ...input.policy,
        physical: {
          buyerRetentionRef: input.policy.physical.buyerRetentionRef,
          refundPolicyRef: input.policy.physical.refundPolicyRef,
          returnsPolicyRef: input.policy.physical.returnsPolicyRef,
          shippingMinor: input.policy.physical.shippingMinor,
          shippingSourceRef: input.policy.physical.shippingSourceRef,
          taxBasisPoints: input.policy.physical.taxBasisPoints,
          taxSourceRef: input.policy.physical.taxSourceRef,
        },
      },
    });
    expect(original.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (original.ok && reordered.ok) {
      expect(reordered.snapshot.totalMinor).toBe(original.snapshot.totalMinor);
      expect(reordered.snapshot.hash).toBe(original.snapshot.hash);
    }
  });

  test("refuses stale/foreign mapping, price and stock drift", () => {
    expect(
      quoteOrder({ ...input, lines: [{ ...input.lines[0]!, expectedUnitMinor: 1200 }] }),
    ).toMatchObject({ ok: false, reason: "stale" });
    expect(
      quoteOrder({
        ...input,
        mappings: [{ ...input.mappings[0]!, product: { ...product, tenantId: "tenant-b" } }],
      }),
    ).toMatchObject({ ok: false, reason: "foreign" });
    expect(
      quoteOrder({
        ...input,
        mappings: [{ ...input.mappings[0]!, stock: { ...stock, reserved: 2 } }],
      }),
    ).toMatchObject({ ok: false, reason: "out_of_stock" });
    expect(
      quoteOrder({
        ...input,
        mappings: [
          { ...input.mappings[0]!, product: { ...product, goodsKind: "digital", revision: 3 } },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "stale" });
  });

  test("missing policies, unsupported geography/currency and overflow refuse", () => {
    expect(
      quoteOrder({
        ...input,
        policy: { ...input.policy, physical: { ...input.policy.physical, refundPolicyRef: "" } },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        policy: { ...input.policy, physical: { ...input.policy.physical, taxSourceRef: "" } },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        policy: { ...input.policy, physical: { ...input.policy.physical, shippingSourceRef: "" } },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      quoteOrder({
        ...input,
        mappings: [{ ...input.mappings[0]!, stock: { ...stock, reservationTtlMs: undefined } }],
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(quoteOrder({ ...input, addressCountry: "US" })).toMatchObject({
      ok: false,
      reason: "unsupported_geography",
    });
    expect(quoteOrder({ ...input, policy: { ...input.policy, currency: "EUR" } })).toMatchObject({
      ok: false,
      reason: "unsupported_currency",
    });
    expect(quoteOrder({ ...input, clientTotalMinor: 1 } as typeof input)).toMatchObject({
      ok: false,
      reason: "invalid_cart",
    });
    expect(
      quoteOrder({
        ...input,
        mappings: [
          { ...input.mappings[0]!, product: { ...product, priceMinor: Number.MAX_SAFE_INTEGER } },
        ],
        lines: [{ ...input.lines[0]!, expectedUnitMinor: Number.MAX_SAFE_INTEGER }],
      }),
    ).toMatchObject({ ok: false, reason: "overflow" });
  });

  test("quote accepts only merchant-configured whole-minute finite holds through sixty minutes", () => {
    for (const ttl of [60_000, 60 * 60_000]) {
      expect(
        quoteOrder({
          ...input,
          mappings: [{ ...input.mappings[0]!, stock: { ...stock, reservationTtlMs: ttl } }],
        }),
      ).toMatchObject({ ok: true });
    }
    for (const ttl of [0, 90_000, 61 * 60_000, 24 * 60 * 60_000]) {
      expect(
        quoteOrder({
          ...input,
          mappings: [{ ...input.mappings[0]!, stock: { ...stock, reservationTtlMs: ttl } }],
        }),
      ).toMatchObject({ ok: false, reason: "configuration_required" });
    }
  });

  test("cancellation before and after verified payment are distinct", () => {
    expect(transitionOrder("pending", "cancel")).toBe("cancelled");
    expect(transitionOrder("paid", "cancel")).toBe("cancel_requested");
    expect(transitionOrder("expired", "payment_confirmed")).toBe("paid_needs_review");
  });
});
