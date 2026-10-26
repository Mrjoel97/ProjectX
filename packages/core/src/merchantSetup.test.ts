import { expect, test } from "vitest";
import {
  assessMerchantSetup,
  type MerchantSetup,
  merchantSetupHash,
  parseMerchantSetupDraft,
} from "./merchantSetup";
import { assessOnlinePresenceBrief, mergeOnlinePresenceBrief } from "./onlinePresence";

const ref = "user:plan:1";
const quote =
  "Seller country US. Buyers US. Currency USD. Tote price 2500 minor units. Stock 12. Tax 0 basis points; shipping 0 minor units. Validity 7 days, retention 7 days. Automatic digital delivery disabled.";
const evidence = [{ sourceRef: ref, quote }];
function fixture(): MerchantSetup {
  return {
    version: 1,
    sellerCountry: "US",
    currency: "USD",
    countries: ["US"],
    products: [
      {
        catalogueItemId: "tote",
        sku: "tote",
        variant: "standard",
        goodsKind: "physical",
        priceMinor: 2500,
        stock: { kind: "finite", onHand: 12, reservationTtlMs: 600000 },
        evidence,
      },
    ],
    policy: {
      sellerOfRecordRef: ref,
      taxRounding: "half_up",
      physical: {
        shippingSourceRef: ref,
        shippingMinor: 0,
        returnsPolicyRef: ref,
        taxSourceRef: ref,
        taxBasisPoints: 0,
        refundPolicyRef: ref,
        buyerRetentionRef: ref,
      },
    },
    automation: {
      autoDigitalDelivery: false,
      digitalValidityDays: 7,
      buyerRetentionDays: 7,
      policyRef: ref,
    },
    evidence,
  };
}
const context = {
  binding: {
    tenantId: "tenant",
    projectId: "project",
    version: 1,
    contentHash: "a".repeat(64),
    catalogueItemIds: ["tote"],
    policyRevision: 0,
    automationRevision: 0,
    mappings: [{ catalogueItemId: "tote", revision: 0 }],
  },
  sources: [
    {
      ref,
      revision: "revision1",
      text: quote,
      kind: "user" as const,
      intent: "current" as const,
      status: "approved" as const,
      visibility: "unspecified" as const,
    },
  ],
  sourceSnapshots: [{ ref, revision: "revision1" }],
};

test("complete sourced package is stable under object-key order and binds exact revision/version", () => {
  const a = assessMerchantSetup(fixture(), context);
  expect(a.ready).toBe(true);
  if (!a.ready) throw Error("fixture");
  expect(assessMerchantSetup(JSON.parse(JSON.stringify(fixture())), context)).toEqual(a);
  const b = assessMerchantSetup(fixture(), {
    ...context,
    binding: { ...context.binding, version: 2 },
  });
  expect(b.ready && b.packageHash).not.toEqual(a.packageHash);
  expect(merchantSetupHash({ b: 2, a: 1 })).toBe(merchantSetupHash({ a: 1, b: 2 }));
});
test("partial draft is accepted as draft, has explicit missing facts, and never becomes authority", () => {
  const p = parseMerchantSetupDraft({ version: 1, products: [{ catalogueItemId: "tote" }] });
  expect(p.valid).toBe(true);
  expect(p.value).toBeUndefined();
  expect(p.missing.some((m) => m.field.endsWith("priceMinor"))).toBe(true);
  expect(assessMerchantSetup({ version: 1 }, context).ready).toBe(false);
});
test.each([
  (x: MerchantSetup) => ({ ...x, approved: true }),
  (x: MerchantSetup) => ({
    ...x,
    products: [{ ...x.products[0], stock: { kind: "untracked", approved: true } }],
  }),
  (x: MerchantSetup) => ({ ...x, automation: { ...x.automation, refunds: true } }),
  (x: MerchantSetup) => ({ ...x, products: [{ ...x.products[0], priceMinor: 0 }] }),
  (x: MerchantSetup) => ({
    ...x,
    products: [
      { ...x.products[0], stock: { kind: "finite", onHand: 12, reservationTtlMs: 60001 } },
    ],
  }),
  (x: MerchantSetup) => ({ ...x, products: [{ ...x.products[0], goodsKind: "service" }] }),
  (x: MerchantSetup) => ({ ...x, countries: ["US", "US"] }),
])("closed parser refuses malformed choices and invented authority %#", (change) => {
  expect(parseMerchantSetupDraft(change(fixture())).valid).toBe(false);
});
test("price, stock, source excerpt, country, policy rates and standing choice cannot be invented", () => {
  for (const change of [
    (x: MerchantSetup) => ({ ...x, products: [{ ...x.products[0], priceMinor: 99999 }] }),
    (x: MerchantSetup) => ({
      ...x,
      products: [
        {
          ...x.products[0],
          stock: { kind: "finite" as const, onHand: 999, reservationTtlMs: 600000 },
        },
      ],
    }),
    (x: MerchantSetup) => ({ ...x, evidence: [{ sourceRef: ref, quote: "Invented quote" }] }),
    (x: MerchantSetup) => ({ ...x, sellerCountry: "GB" }),
    (x: MerchantSetup) => ({
      ...x,
      policy: { ...x.policy, physical: { ...x.policy.physical!, taxBasisPoints: 900 } },
    }),
    (x: MerchantSetup) => ({ ...x, automation: { ...x.automation, autoDigitalDelivery: true } }),
  ])
    expect(assessMerchantSetup(change(fixture()), context).ready).toBe(false);
});
test("foreign, stale, planned and changed source revisions refuse exact review", () => {
  for (const sources of [
    [],
    context.sources.map((s) => ({ ...s, stale: true })),
    context.sources.map((s) => ({ ...s, intent: "planned" as const })),
    context.sources.map((s) => ({ ...s, revision: "changed" })),
  ])
    expect(assessMerchantSetup(fixture(), { ...context, sources }).ready).toBe(false);
});
test("catalogue substitution, duplicate mapping and missing branches refuse", () => {
  for (const products of [
    [{ ...fixture().products[0], catalogueItemId: "other" }],
    fixture().products.concat(fixture().products),
  ])
    expect(assessMerchantSetup({ ...fixture(), products }, context).ready).toBe(false);
  expect(
    assessMerchantSetup(fixture(), {
      ...context,
      binding: { ...context.binding, catalogueItemIds: ["tote", "other"] },
    }).ready,
  ).toBe(false);
  const noPolicy = fixture();
  delete noPolicy.policy.physical;
  expect(parseMerchantSetupDraft(noPolicy).value).toBeUndefined();
});
test("private presentation can be built with incomplete setup and optional setup revisions preserve/clear explicitly", () => {
  const brief = {
    kind: "shop",
    businessName: "Totes",
    headline: "Totes",
    summary: "Cotton totes.",
    audience: "Shoppers",
    catalogue: [{ id: "tote", name: "Tote", description: "Cotton tote" }],
    shopSetup: { version: 1 },
    sourceRefs: [ref],
  };
  expect(assessOnlinePresenceBrief(brief, context.sources).ok).toBe(true);
  const merged = mergeOnlinePresenceBrief(brief, { ...brief, shopSetup: undefined });
  expect(merged.ok).toBe(true);
  const incoming = { ...brief };
  delete (incoming as { shopSetup?: unknown }).shopSetup;
  const preserved = mergeOnlinePresenceBrief(brief, incoming);
  expect(preserved.ok && preserved.brief.shopSetup).toEqual({ version: 1 });
  expect(preserved.ok && preserved.inheritedShopSetup).toBe(true);
  const cleared = mergeOnlinePresenceBrief(brief, incoming, ["shopSetup"]);
  expect(cleared.ok && cleared.brief.shopSetup).toBeUndefined();
  expect(cleared.ok && cleared.inheritedShopSetup).toBe(false);
});
