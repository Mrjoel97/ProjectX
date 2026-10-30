import { describe, expect, it } from "vitest";
import {
  type MerchantCartView,
  renderMerchantCart,
  renderMerchantCommerceLink,
  renderMerchantOrderStatus,
} from "./merchantBuyer";

const cart: MerchantCartView = {
  slug: "ceramics",
  title: "A real shop",
  currency: "GBP",
  items: [
    {
      id: "owned_product",
      name: "A jug",
      description: "Confirmed ceramic product.",
      unitMinor: 4800,
      productRevision: 7,
      maxQuantity: 3,
      imagePath: `/p/ceramics/assets/ownedimage/${"a".repeat(64)}`,
    },
  ],
  countryOptions: ["TZ", "GB"],
  providers: ["stripe"],
};

describe("server-owned merchant buyer presentation", () => {
  it("posts selected quantities and displayed snapshot identity without choosing country/provider or claiming payment", () => {
    const html = renderMerchantCart(cart);
    expect(html).toContain('method="post" action="/merchant/checkout/ceramics"');
    expect(html).toContain(
      'name="qty:owned_product" type="number" inputmode="numeric" min="0" max="3" step="1" value="0"',
    );
    expect(html).toContain('name="rev:owned_product" value="7"');
    expect(html).toContain('name="unit:owned_product" value="4800"');
    expect(html).toContain("£48.00");
    expect(html).toContain('<option value="">Choose a country</option>');
    expect(html).toContain('<option value="">Choose a payment provider</option>');
    expect(html).toContain("Tanzania");
    expect(html).toContain('href="/p/ceramics/catalogue"');
    expect(html).not.toMatch(/selected|<script|name="(?:card|email|password)"|Payment confirmed/);
    expect(html).toContain("Sandbox checkout");
    expect(html).toContain("No payment is confirmed on this page");
  });

  it("escapes visible product content, forbids external images, traversal and duplicate product identities", () => {
    const escaped = renderMerchantCart({
      ...cart,
      title: 'A <script>alert("x")</script>',
      items: [
        {
          ...cart.items[0]!,
          name: 'A "jug" <img src=x onerror=alert(1)>',
          description: "<script>bad</script>",
        },
      ],
    });
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("<img src=x");
    for (const invalid of [
      { ...cart, slug: "../foreign" },
      { ...cart, providers: ["live-provider"] },
      { ...cart, items: [cart.items[0], cart.items[0]] },
      { ...cart, items: [{ ...cart.items[0], imagePath: "https://foreign.example/image.jpg" }] },
      {
        ...cart,
        items: [{ ...cart.items[0], imagePath: `/p/foreign/assets/ownedimage/${"a".repeat(64)}` }],
      },
      { ...cart, items: [{ ...cart.items[0], unitMinor: 0 }] },
    ])
      expect(() => renderMerchantCart(invalid as MerchantCartView)).toThrow(
        "MERCHANT_CART_VIEW_INVALID",
      );
  });

  it("keeps unavailable products unselectable and stale prices require a fresh review", () => {
    const html = renderMerchantCart({
      ...cart,
      notice: "stale_price",
      items: [{ ...cart.items[0]!, maxQuantity: 0 }],
    });
    expect(html).toContain("A product or price changed");
    expect(html).toContain("Currently unavailable");
    expect(html).toContain('<button type="submit" disabled>');
    expect(renderMerchantCommerceLink({ slug: "ceramics" })).toContain(
      'href="/merchant/shop/ceramics"',
    );
    expect(() => renderMerchantCommerceLink({ slug: 'bad" onclick="bad' })).toThrow();
  });

  it("shows uncertain payment honestly, and only paid status may expose bounded server-minted digital access", () => {
    const pending = renderMerchantOrderStatus({
      status: "unknown",
      currency: "GBP",
      totalMinor: 4800,
      notices: ["payment_unknown"],
      digitalLinks: [],
      fulfilments: [],
    });
    expect(pending).toContain("Do not start another payment");
    expect(pending).not.toContain("Payment confirmed");
    expect(pending).not.toMatch(/email sent|delivered/i);
    const input = {
      status: "paid" as const,
      currency: "GBP",
      totalMinor: 4800,
      notices: ["delivery_ready" as const],
      digitalLinks: [
        {
          href: `/merchant/download/owned_operation?access=${"t".repeat(43)}`,
          label: "Download your file",
        },
      ],
      fulfilments: [{ kind: "digital_entitlement" as const, status: "succeeded" as const }],
    };
    const html = renderMerchantOrderStatus(input);
    expect(html).toContain("Payment confirmed");
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("Digital access: Access ready");
    const physical = renderMerchantOrderStatus({
      ...input,
      notices: [],
      digitalLinks: [],
      fulfilments: [{ kind: "physical_shipment", status: "succeeded" }],
    });
    expect(physical).toContain("Shipment: Merchant handoff recorded");
    expect(physical).not.toMatch(/delivered|carrier dispatch/i);
    expect(() => renderMerchantOrderStatus({ ...input, status: "merchant_review" })).toThrow(
      "MERCHANT_ORDER_VIEW_INVALID",
    );
    expect(() =>
      renderMerchantOrderStatus({
        ...input,
        digitalLinks: [{ href: "https://foreign.test/file", label: "File" }],
      }),
    ).toThrow("MERCHANT_ORDER_VIEW_INVALID");
    expect(() => renderMerchantOrderStatus({ ...input, digitalLinks: [] })).toThrow(
      "MERCHANT_ORDER_VIEW_INVALID",
    );
  });
});
