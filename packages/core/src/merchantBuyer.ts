import { escapeWebText } from "./webRuntime";

type Provider = "stripe" | "paypal";
export type MerchantCartView = {
  readonly slug: string;
  readonly title: string;
  readonly currency: string;
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly unitMinor: number;
    readonly productRevision: number;
    readonly maxQuantity: number;
    readonly imagePath?: string;
  }[];
  readonly countryOptions: readonly string[];
  readonly providers: readonly Provider[];
  readonly homePage?: string;
  readonly notice?: "stale_price" | "unavailable" | "invalid_selection";
};
const slug = (value: string) =>
  typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
const opaque = (value: string) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const text = (value: string, max = 4000) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const amount = (value: number) => Number.isSafeInteger(value) && value > 0;
const currency = (value: string) => /^[A-Z]{3}$/.test(value);
const providerName = (value: Provider) => (value === "stripe" ? "Stripe" : "PayPal");
function money(value: number, code: string): string {
  const formatter = new Intl.NumberFormat("en", { style: "currency", currency: code });
  return escapeWebText(
    formatter.format(value / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)),
  );
}

const styles = `:root{color-scheme:light;--paper:#f7f6f2;--card:#ffffff;--ink:#24372e;--muted:#526259;--accent:#2e4c3c;--line:#c5cec8}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font:400 1rem/1.6 system-ui,sans-serif;overflow-wrap:anywhere}a{color:inherit;text-underline-offset:.25em}header,main,footer{max-width:1120px;margin:auto;padding-inline:24px}header{padding-block:24px;display:flex;align-items:center;justify-content:space-between;gap:16px}header a{font-weight:700;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.mode{background:var(--ink);color:#ffffff;padding:12px 24px;text-align:center;font-size:.92rem}main{padding-block:36px 60px}h1,h2,h3{line-height:1.15;letter-spacing:-.035em}h1{font:400 clamp(2.3rem,5vw,4rem)/1.05 Georgia,serif;margin:0 0 20px}h2{font-size:1.4rem;margin:0 0 20px}h3{font-size:1.15rem;margin:0 0 8px}.intro{max-width:64ch;margin:0 0 36px;color:var(--muted)}.cart{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:40px;align-items:start}.items{display:grid;gap:0}.item{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:24px;padding:24px 0;border-bottom:1px solid var(--line)}.item:first-child{padding-top:0}.item.has-image{grid-template-columns:84px minmax(0,1fr) 104px}.item img{width:84px;height:104px;object-fit:contain;background:var(--card);border-radius:12px}.item p{margin:8px 0;max-width:55ch;font-size:.94rem}.item .price{font-weight:600;font-size:1rem}.item label{font-size:.88rem;display:grid;gap:8px}.item input{width:100%;min-height:46px}.checkout{padding:28px;background:var(--card);border-radius:18px;position:sticky;top:24px}.checkout p{font-size:.92rem;line-height:1.65}.checkout label{display:grid;gap:8px;font-size:.94rem;margin:20px 0}input,select{font:inherit;padding:10px 12px;border:1px solid #62766a;border-radius:8px;background:#ffffff;color:var(--ink);min-height:46px;max-width:100%}button,.action{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;border:2px solid var(--accent);border-radius:10px;background:var(--accent);color:#ffffff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}.checkout button{width:100%;margin-top:8px}button:disabled{background:var(--paper);color:var(--muted);border-color:var(--line);cursor:not-allowed}:focus-visible{outline:3px solid var(--ink);outline-offset:4px;box-shadow:0 0 0 3px #ffffff}.notice{padding:20px;background:#e6ece6;border-radius:12px;margin-bottom:28px}.receipt{max-width:760px}.receipt dl{display:grid;grid-template-columns:1fr auto;gap:16px;margin:32px 0;padding:24px;background:var(--card);border-radius:14px}.receipt dt{color:var(--muted)}.receipt dd{margin:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}.receipt li{margin-block:12px}.receipt .downloads{display:grid;gap:12px;justify-items:start}.receipt h2{margin-top:36px}footer{padding-block:24px 40px;color:var(--muted);font-size:.9rem}fieldset{border:0;margin:0;padding:0;min-width:0}legend{font-weight:600;padding:0;margin-bottom:20px}.summary-list{padding-left:20px}@media(max-width:800px){.cart{grid-template-columns:1fr;gap:28px}.checkout{position:static}.item{gap:16px;grid-template-columns:minmax(0,1fr) 86px}.item.has-image{grid-template-columns:64px minmax(0,1fr) 86px}.item img{width:64px;height:80px}header,main,footer{padding-inline:20px}main{padding-top:28px}.mode{padding-inline:20px}.receipt dl{padding:20px}.checkout{padding:24px}}`;
function page(title: string, brand: string, body: string, backPath?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escapeWebText(title)} · ${escapeWebText(brand)}</title><style>${styles}</style></head><body><div class="mode">Sandbox checkout · test payments only · no real charge</div><header>${backPath ? `<a href="${escapeWebText(backPath)}">${escapeWebText(brand)}</a>` : `<strong>${escapeWebText(brand)}</strong>`}<span>Secure test checkout</span></header><main>${body}</main><footer>Payment and delivery states are confirmed by recorded results. A browser return alone does not confirm payment.</footer></body></html>`;
}

/** All prices and availability are server-selected snapshots; POST must recheck every mapping,
 * displayed revision and price. This form never captures card credentials or executes scripts. */
export function renderMerchantCart(input: MerchantCartView): string {
  if (
    !slug(input.slug) ||
    (input.homePage !== undefined && !slug(input.homePage)) ||
    !text(input.title, 128) ||
    !currency(input.currency) ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 50 ||
    new Set(input.items.map((item) => item.id)).size !== input.items.length ||
    !input.items.every(
      (item) =>
        opaque(item.id) &&
        text(item.name, 256) &&
        text(item.description) &&
        amount(item.unitMinor) &&
        amount(item.productRevision) &&
        Number.isInteger(item.maxQuantity) &&
        item.maxQuantity >= 0 &&
        item.maxQuantity <= 100 &&
        (item.imagePath === undefined ||
          new RegExp(`^/p/${input.slug}/assets/[A-Za-z0-9_-]{1,96}/[a-f0-9]{64}$`).test(
            item.imagePath,
          )),
    ) ||
    !Array.isArray(input.countryOptions) ||
    input.countryOptions.length < 1 ||
    input.countryOptions.length > 100 ||
    new Set(input.countryOptions).size !== input.countryOptions.length ||
    !input.countryOptions.every((country) => /^[A-Z]{2}$/.test(country)) ||
    !Array.isArray(input.providers) ||
    input.providers.length < 1 ||
    input.providers.length > 2 ||
    new Set(input.providers).size !== input.providers.length ||
    !input.providers.every((provider) => provider === "stripe" || provider === "paypal") ||
    (input.notice !== undefined &&
      !["stale_price", "unavailable", "invalid_selection"].includes(input.notice))
  )
    throw new Error("MERCHANT_CART_VIEW_INVALID");
  const notices = {
    stale_price: "A product or price changed. Review the current details before continuing.",
    unavailable: "Some products are unavailable. Review your selection before continuing.",
    invalid_selection: "Choose your quantities, country and payment method before continuing.",
  };
  const countryNames = new Intl.DisplayNames("en", { type: "region" });
  const products = input.items
    .map(
      (item) =>
        `<article class="item${item.imagePath ? " has-image" : ""}">${item.imagePath ? `<img src="${escapeWebText(item.imagePath)}" alt="${escapeWebText(item.name)}" width="84" height="104">` : ""}<div><h3>${escapeWebText(item.name)}</h3><p>${escapeWebText(item.description)}</p><p class="price">${money(item.unitMinor, input.currency)}</p>${item.maxQuantity === 0 ? "<p>Currently unavailable</p>" : ""}</div><label>Quantity<input aria-label="Quantity for ${escapeWebText(item.name)}" name="qty:${item.id}" type="number" inputmode="numeric" min="0" max="${item.maxQuantity}" step="1" value="0"${item.maxQuantity === 0 ? " disabled" : ""}><input type="hidden" name="rev:${item.id}" value="${item.productRevision}"><input type="hidden" name="unit:${item.id}" value="${item.unitMinor}"></label></article>`,
    )
    .join("");
  return page(
    "Your selection",
    input.title,
    `<h1>Your selection</h1><p class="intro">Choose your pieces. Your total, including the applicable delivery and tax policy, is reviewed before you confirm a test payment with the provider.</p>${input.notice ? `<div class="notice" role="alert">${notices[input.notice]}</div>` : ""}<form class="cart" method="post" action="/merchant/checkout/${input.slug}"><section class="items" aria-label="Products">${products}</section><section class="checkout"><fieldset><legend>Continue to checkout</legend><label>Delivery country<select name="country" required><option value="">Choose a country</option>${input.countryOptions.map((country) => `<option value="${country}">${escapeWebText(countryNames.of(country) ?? country)}</option>`).join("")}</select></label><label>Payment provider<select name="provider" required><option value="">Choose a payment provider</option>${input.providers.map((provider) => `<option value="${provider}">${providerName(provider)} · test mode</option>`).join("")}</select></label><p>Prices and availability are checked again before checkout. No payment is confirmed on this page.</p><button type="submit"${input.items.every((item) => item.maxQuantity === 0) ? " disabled" : ""}>Review total and continue</button></fieldset></section></form>`,
    `/p/${input.slug}/${input.homePage ?? "catalogue"}`,
  );
}

/** Only the adapter's verified readiness path may attach this link to a published response. */
export function renderMerchantCommerceLink(input: { readonly slug: string }): string {
  if (!slug(input.slug)) throw new Error("MERCHANT_CART_VIEW_INVALID");
  return `<aside aria-label="Test shop checkout" style="padding:20px;text-align:center;background:#24372e;color:#ffffff;font:400 1rem/1.6 system-ui,sans-serif"><a href="/merchant/shop/${input.slug}" style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 24px;border:2px solid #ffffff;border-radius:10px;color:#ffffff;text-decoration:none;font-weight:600">Browse and test checkout</a><p style="margin:8px 0 0;font-size:.9rem">Sandbox only. No real charges.</p></aside>`;
}

export type MerchantOrderStatusView = {
  readonly status:
    | "pending"
    | "unknown"
    | "expired"
    | "cancelled"
    | "failed"
    | "paid"
    | "merchant_review";
  readonly currency: string;
  readonly totalMinor: number;
  readonly notices: readonly (
    | "payment_pending"
    | "payment_unknown"
    | "stock_review"
    | "delivery_pending"
    | "delivery_ready"
    | "refund_pending"
    | "refunded"
  )[];
  readonly digitalLinks: readonly { readonly href: string; readonly label: string }[];
  readonly fulfilments: readonly {
    readonly kind: "physical_shipment" | "digital_entitlement";
    readonly status: "prepared" | "pending" | "unknown" | "succeeded" | "failed" | "revoked";
  }[];
};
export function renderMerchantOrderStatus(input: MerchantOrderStatusView): string {
  const labels = {
    pending: "Payment pending",
    unknown: "Payment confirmation pending",
    expired: "Checkout expired",
    cancelled: "Checkout cancelled",
    failed: "Payment failed",
    paid: "Payment confirmed",
    merchant_review: "Payment received · shop review needed",
  };
  const notes: Record<string, string> = {
    payment_pending: "Payment confirmation is still pending.",
    payment_unknown:
      "The payment result is not confirmed. Do not start another payment while it is being reconciled.",
    stock_review: "The shop needs to review product availability before fulfilment.",
    delivery_pending: "Delivery is pending. No completed delivery is claimed.",
    delivery_ready: "Digital access is available below.",
    refund_pending: "A refund is being reviewed or confirmed.",
    refunded: "A refund has been confirmed.",
  };
  if (
    !input ||
    !Object.hasOwn(labels, input.status) ||
    !currency(input.currency) ||
    !amount(input.totalMinor) ||
    !Array.isArray(input.notices) ||
    input.notices.length > 10 ||
    !input.notices.every((notice) => Object.hasOwn(notes, notice)) ||
    !Array.isArray(input.digitalLinks) ||
    input.digitalLinks.length > 50 ||
    !input.digitalLinks.every(
      (link) =>
        text(link.label, 256) &&
        /^\/merchant\/download\/[A-Za-z0-9_-]{1,128}\?access=[A-Za-z0-9_-]{32,128}$/.test(
          link.href,
        ),
    ) ||
    (input.digitalLinks.length > 0 && input.status !== "paid") ||
    (input.notices.includes("delivery_ready") &&
      (input.status !== "paid" || input.digitalLinks.length === 0)) ||
    !Array.isArray(input.fulfilments) ||
    input.fulfilments.length > 50 ||
    !input.fulfilments.every(
      (entry) =>
        ["physical_shipment", "digital_entitlement"].includes(entry.kind) &&
        ["prepared", "pending", "unknown", "succeeded", "failed", "revoked"].includes(entry.status),
    )
  )
    throw new Error("MERCHANT_ORDER_VIEW_INVALID");
  const fulfilment: Record<string, string> = {
    prepared: "Prepared",
    pending: "Pending",
    unknown: "Awaiting confirmation",
    succeeded: "Confirmed",
    failed: "Failed",
    revoked: "Revoked",
  };
  return page(
    "Order status",
    "Your shop order",
    `<div class="receipt"><h1>${labels[input.status]}</h1><p class="intro">This status comes from the shop's recorded test payment result.</p><dl><dt>Total</dt><dd>${money(input.totalMinor, input.currency)}</dd><dt>Payment</dt><dd>${labels[input.status]}</dd></dl>${input.notices.length > 0 ? `<ul class="summary-list">${input.notices.map((notice) => `<li>${notes[notice]}</li>`).join("")}</ul>` : ""}${input.digitalLinks.length ? `<section class="downloads"><h2>Your digital access</h2>${input.digitalLinks.map((link) => `<a class="action" href="${escapeWebText(link.href)}" rel="noreferrer">${escapeWebText(link.label)}</a>`).join("")}</section>` : ""}${input.fulfilments.length ? `<section><h2>Fulfilment</h2><ul>${input.fulfilments.map((entry) => `<li>${entry.kind === "digital_entitlement" ? "Digital access" : "Shipment"}: ${entry.kind === "physical_shipment" && entry.status === "succeeded" ? "Merchant handoff recorded" : entry.kind === "digital_entitlement" && entry.status === "succeeded" ? "Access ready" : fulfilment[entry.status]}</li>`).join("")}</ul></section>` : ""}</div>`,
  );
}
