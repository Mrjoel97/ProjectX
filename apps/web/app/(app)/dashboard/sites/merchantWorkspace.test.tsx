// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatMerchantMoney,
  MerchantWorkspace,
  safeMerchantConnectionUrl,
} from "./MerchantWorkspace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  status: undefined as any,
  orders: { orders: [], truncated: false } as any,
  connect: vi.fn(),
  refresh: vi.fn(),
  prepare: vi.fn(),
  checkout: vi.fn(),
  order: null as {
    _id: string;
    projectId: string;
    status: string;
    snapshot: { currency: string; country: string; totalMinor: number; lines: { sku: string }[] };
  } | null,
  start: vi.fn(),
  push: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.prepare,
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(reference);
    return name === "merchantCommerce:status"
      ? mocks.status
      : name === "tenantOrders:getOrder"
        ? mocks.order
        : mocks.orders;
  },
  useAction: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    return name === "merchantProvider:connect"
      ? mocks.connect
      : name === "merchantProvider:refresh"
        ? mocks.refresh
        : name === "merchantProvider:checkout"
          ? mocks.checkout
          : mocks.start;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./ShopSetupReview", () => ({
  ShopSetupReview: () => <section>Setup proposal review</section>,
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const status = () => ({
  projectId: "owned-project",
  environment: "test",
  testOnly: true,
  publicCheckoutReady: false,
  blockers: ["merchant_policy_required", "stripe:verified_test_payment_required"],
  providers: [
    {
      provider: "stripe",
      configured: true,
      status: "not_connected",
      canConnect: true,
      missingKeyNames: [],
      blockers: [],
    },
    {
      provider: "paypal",
      configured: false,
      status: "not_connected",
      canConnect: false,
      missingKeyNames: ["SERVER_KEY_NAME"],
      blockers: [],
    },
  ],
  automation: null,
});
async function render() {
  await act(async () => root.render(<MerchantWorkspace projectId="owned-project" />));
}
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(text),
  ) as HTMLButtonElement;
beforeEach(() => {
  sessionStorage.clear();
  mocks.prepare.mockReset();
  mocks.checkout.mockReset();
  mocks.order = null;
  mocks.status = status();
  mocks.orders = { orders: [], truncated: false };
  mocks.connect
    .mockReset()
    .mockResolvedValue({ ok: true, url: "https://connect.stripe.com/setup/example" });
  mocks.refresh.mockReset().mockResolvedValue({ ok: true, ready: true });
  mocks.start.mockReset().mockResolvedValue({ threadId: "shop-thread" });
  mocks.push.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("merchant operations readback", () => {
  it("resumes a reserved item on reload and opens checkout for the verified order total", async () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    sessionStorage.setItem("pikar:flw-order:owned-project", id);
    mocks.status = {
      ...status(),
      privateFlutterwavePilot: {
        items: [],
        canStartTest: true,
        verifiedTestPayment: false,
        blockers: [],
      },
    };
    mocks.order = {
      _id: id,
      projectId: "owned-project",
      status: "pending",
      snapshot: {
        country: "TZ",
        currency: "TZS",
        totalMinor: 100000,
        lines: [{ sku: "postcard" }],
      },
    };
    const url = "https://checkout.flutterwave.com/v3/hosted/pay/test123";
    mocks.checkout.mockResolvedValue({ ok: true, url });
    await render();
    expect(host.textContent).toContain(formatMerchantMoney(100000, "TZS"));
    const email = host.querySelector("input[type=email]") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        email,
        "buyer@example.test",
      );
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Request test checkout").click());
    expect(mocks.checkout).toHaveBeenCalledWith({
      orderId: id,
      provider: "flutterwave",
      buyerEmail: "buyer@example.test",
    });
    expect(host.querySelector(`a[href="${url}"]`)).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("connects the private Tanzanian wallet with the confirmed currency and requires a verified receipt", async () => {
    mocks.status = {
      ...status(),
      providers: [
        {
          provider: "flutterwave",
          configured: true,
          status: "not_connected",
          canConnect: true,
          blockers: [],
          connectionContext: { sellerCountry: "TZ", currency: "TZS" },
        },
      ],
      privateFlutterwavePilot: {
        items: [],
        canStartTest: false,
        verifiedTestPayment: false,
        blockers: [],
      },
    };
    mocks.connect.mockResolvedValue({ ok: true });
    await render();
    await act(async () =>
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    await act(async () => button("Connect Flutterwave").click());
    expect(mocks.connect).toHaveBeenCalledWith({
      projectId: "owned-project",
      provider: "flutterwave",
      shareDataConsent: true,
      sellerCountry: "TZ",
      currency: "TZS",
    });
    expect(host.textContent).toContain("Test wallet checked");
    expect(host.textContent).not.toContain("Flutterwave confirmed a test payment");
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("holds setup while loading and shows missing facts without exposing provider configuration names", async () => {
    mocks.status = undefined;
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Checking payment connections",
    );
    expect(host.querySelectorAll("button")).toHaveLength(0);
    mocks.status = status();
    await render();
    expect(host.textContent).toContain("Your selling and fulfilment policy needs review");
    expect(host.textContent).toContain("A verified test payment is still needed");
    expect(host.textContent).not.toContain("SERVER_KEY_NAME");
    expect(host.textContent).toContain("No orders yet");
    expect(button("Connect Stripe").disabled).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("requires explicit sharing consent, passes no invented country/currency and exposes only a safe onboarding link", async () => {
    await render();
    await act(async () =>
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    expect(button("Connect Stripe").disabled).toBe(false);
    await act(async () => button("Connect Stripe").click());
    expect(mocks.connect).toHaveBeenCalledWith({
      projectId: "owned-project",
      provider: "stripe",
      shareDataConsent: true,
    });
    expect(
      host.querySelector('a[href="https://connect.stripe.com/setup/example"]')?.getAttribute("rel"),
    ).toBe("noopener noreferrer");
    expect(host.textContent).not.toContain("Test checkout is ready");
    mocks.connect.mockResolvedValue({ ok: true, url: "https://evil.test/connect" });
    await act(async () => button("Connect Stripe").click());
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "secure connection link could not be confirmed",
    );
  });

  it("does not promote a successful refresh response to checkout readiness without its live server query", async () => {
    await render();
    await act(async () => button("Refresh account status").click());
    expect(mocks.refresh).toHaveBeenCalledWith({ projectId: "owned-project", provider: "stripe" });
    expect(host.textContent).not.toContain("Test checkout is ready");
    mocks.status = { ...status(), publicCheckoutReady: true, blockers: [] };
    await render();
    expect(host.textContent).toContain("Test checkout is ready");
    expect(host.textContent).toContain("real charges are unavailable");
  });

  it("shows actual order/payment/fulfilment states and refund amounts without inventing sales totals", async () => {
    mocks.orders = {
      orders: [
        {
          orderId: "owned-order-12345678",
          status: "paid_needs_review",
          paymentStatus: "merchant_review",
          provider: "stripe",
          currency: "USD",
          totalMinor: 12500,
          refundedMinor: 2500,
          createdAt: Date.UTC(2026, 9, 24),
          reviewRequired: true,
          fulfilments: [{ kind: "digital_entitlement", status: "succeeded" }],
          buyerNoticeStates: [],
        },
      ],
      truncated: false,
    };
    await render();
    expect(host.textContent).toContain("1 shown · 1 need review");
    expect(host.textContent).toContain("Order 12345678");
    expect(host.textContent).toContain("Paid · needs review");
    expect(host.textContent).toContain("$125.00");
    expect(host.textContent).toContain("$25.00 refunded");
    expect(host.textContent).toContain("Digital delivery: Completed");
    expect(host.textContent).not.toContain("Revenue");
  });

  it("routes setup to the existing agent conversation without calling a payment action", async () => {
    await render();
    await act(async () => button("Ask Pikar").click());
    expect(mocks.start.mock.calls[0]?.[0]?.text).toContain("existing shop project owned-project");
    expect(mocks.push).toHaveBeenCalledWith(
      "/dashboard/workspace?thread=shop-thread&label=Your%20shop",
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects executable, foreign, live PayPal, credentialed and custom-port connection URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "http://connect.stripe.com/setup",
      "https://connect.stripe.com.evil.test/setup",
      "https://user@connect.stripe.com/setup",
      "https://connect.stripe.com:444/setup",
    ])
      expect(safeMerchantConnectionUrl(value, "stripe")).toBeNull();
    expect(safeMerchantConnectionUrl("https://www.paypal.com/connect", "paypal")).toBeNull();
    expect(safeMerchantConnectionUrl("https://www.sandbox.paypal.com/connect", "paypal")).toBe(
      "https://www.sandbox.paypal.com/connect",
    );
    expect(formatMerchantMoney(12500, "USD")).toBe("$125.00");
    expect(formatMerchantMoney(12500, "JPY")).toBe("¥12,500");
    expect(formatMerchantMoney(-1, "USD")).toBe("Amount unavailable");
  });
});
