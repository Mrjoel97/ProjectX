// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopSetupReview } from "./ShopSetupReview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ proposal: undefined as any, approve: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.proposal,
  useMutation: () => mocks.approve,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const proposal = () => ({
  planId: "owned-plan",
  expectedRevision: 7,
  projectId: "owned-project",
  version: 3,
  contentHash: "sha256:artifact-three",
  packageHash: "sha256:package-three",
  ready: true,
  catalogueItems: [{ id: "jug", name: "Seafoam jug" }],
  missing: [],
  approval: null,
  inventoryReview: [
    { catalogueItemId: "jug", action: "preserve", currentOnHand: 10, requestedOnHand: 12 },
  ],
  setup: {
    version: 1,
    sellerCountry: "TZ",
    currency: "GBP",
    countries: ["GB"],
    products: [
      {
        catalogueItemId: "jug",
        sku: "JUG-1",
        variant: "Seafoam",
        goodsKind: "physical",
        priceMinor: 4800,
        stock: { kind: "finite", onHand: 12, reservationTtlMs: 900000 },
        evidence: [{ sourceRef: "vault:owned", quote: "The seafoam jug costs £48." }],
      },
    ],
    policy: {
      sellerOfRecordRef: "vault:seller",
      taxRounding: "half_up",
      physical: {
        taxSourceRef: "vault:tax",
        taxBasisPoints: 0,
        refundPolicyRef: "vault:refund",
        buyerRetentionRef: "vault:retention",
        shippingSourceRef: "vault:shipping",
        shippingMinor: 500,
        returnsPolicyRef: "vault:returns",
      },
    },
    automation: {
      autoDigitalDelivery: false,
      digitalValidityDays: 30,
      buyerRetentionDays: 90,
      policyRef: "vault:operations",
    },
    evidence: [{ sourceRef: "vault:seller", quote: "The seller is established in Tanzania." }],
  },
});
const render = async () => {
  await act(async () => root.render(<ShopSetupReview projectId="owned-project" />));
};
const check = async () => {
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
};
const approveButton = () =>
  [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Approve this shop setup"),
  ) as HTMLButtonElement | undefined;
beforeEach(() => {
  mocks.proposal = proposal();
  mocks.approve.mockReset().mockResolvedValue({ ok: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("exact owner shop setup review", () => {
  it("waits for actual setup and refuses approval when business information is incomplete", async () => {
    mocks.proposal = undefined;
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Checking the exact setup",
    );
    expect(approveButton()).toBeUndefined();
    mocks.proposal = {
      ...proposal(),
      ready: false,
      setup: null,
      packageHash: null,
      missing: [
        { field: "price", reason: "missing", question: "What is the confirmed selling price?" },
      ],
    };
    await render();
    expect(host.textContent).toContain("What is the confirmed selling price?");
    expect(approveButton()).toBeUndefined();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("shows actual seller and monetary facts and approves only the exact reviewed package", async () => {
    await render();
    expect(host.textContent).toContain("Tanzania");
    expect(host.textContent).toContain("United Kingdom");
    expect(host.textContent).toContain("Seafoam jug");
    expect(host.textContent).toContain("£48.00");
    expect(host.textContent).toContain("£5.00");
    expect(approveButton()?.disabled).toBe(true);
    await check();
    expect(approveButton()?.disabled).toBe(false);
    await act(async () => approveButton()?.click());
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({
      planId: "owned-plan",
      expectedRevision: 7,
      packageHash: "sha256:package-three",
    });
    expect(host.textContent).not.toContain("has a recorded approval");
    expect(approveButton()?.disabled).toBe(true);
  });

  it("requires fresh consent when the version, package hash or session revision changes", async () => {
    await render();
    await check();
    expect(approveButton()?.disabled).toBe(false);
    mocks.proposal = {
      ...proposal(),
      version: 4,
      expectedRevision: 8,
      packageHash: "sha256:package-four",
    };
    await render();
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect(approveButton()?.disabled).toBe(true);
    await check();
    await act(async () => approveButton()?.click());
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith({
      planId: "owned-plan",
      expectedRevision: 8,
      packageHash: "sha256:package-four",
    });
  });

  it("uses the recorded server approval and never a successful mutation as readiness", async () => {
    mocks.proposal = {
      ...proposal(),
      ready: false,
      approval: {
        packageHash: "sha256:package-three",
        version: 3,
        productIds: ["product-one"],
        policyRevision: 1,
        automationRevision: 1,
        current: true,
      },
    };
    await render();
    expect(host.textContent).toContain("has a recorded approval for version 3");
    expect(approveButton()).toBeUndefined();
    mocks.proposal = {
      ...mocks.proposal,
      ready: true,
      approval: { ...mocks.proposal.approval, current: false },
    };
    await render();
    await check();
    mocks.approve.mockRejectedValueOnce(new Error("STALE_PACKAGE"));
    await act(async () => approveButton()?.click());
    expect(host.textContent).toContain("could not be confirmed");
    expect(host.textContent).not.toContain("has a recorded approval for version 3");
  });

  it("distinguishes preserved actual stock from an explicit stock change", async () => {
    await render();
    expect(host.textContent).toContain("10 currently available");
    expect(host.textContent).toContain("Preserve current stock");
    expect(host.textContent).not.toContain("12 available");
    mocks.proposal = {
      ...proposal(),
      inventoryReview: [
        { catalogueItemId: "jug", action: "set", currentOnHand: 10, requestedOnHand: 15 },
      ],
    };
    await render();
    expect(host.textContent).toContain("Set available stock to 15");
    expect(host.textContent).toContain("10 currently available");
  });
});
