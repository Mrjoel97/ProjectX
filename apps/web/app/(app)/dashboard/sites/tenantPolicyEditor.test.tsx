// @vitest-environment jsdom

import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type SavedPolicy = {
  id: string;
  tenantId: string;
  projectId: string;
  revision: number;
  sellerOfRecordRef: string;
  currency: string;
  countries: string[];
  taxRounding: "half_up";
  physical?: {
    shippingSourceRef: string;
    shippingMinor: number;
    returnsPolicyRef: string;
    taxSourceRef: string;
    taxBasisPoints: number;
    refundPolicyRef: string;
    buyerRetentionRef: string;
  };
  digital?: {
    deliveryRef: string;
    revocationRef: string;
    noShipping: true;
    taxSourceRef: string;
    taxBasisPoints: number;
    refundPolicyRef: string;
    buyerRetentionRef: string;
  };
};
let policy: SavedPolicy | null | undefined;
let failure: string | null;
const calls: { name: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (getFunctionName(ref as never) !== "tenantOrders:getLatestPolicy")
      throw new Error("Unexpected query");
    expect(args).toEqual({ projectId: "store-a" });
    return policy;
  },
  useMutation: (ref: unknown) => async (args: unknown) => {
    const name = getFunctionName(ref as never);
    calls.push({ name, args });
    if (failure) throw new Error(failure);
    return { policyId: "policy-next", revision: 1 };
  },
}));

const { TenantPolicyEditor } = await import("./TenantPolicyEditor");
let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  policy = null;
  failure = null;
  calls.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async () => {
  await act(async () => root.render(createElement(TenantPolicyEditor, { projectId: "store-a" })));
};
const input = (label: string) => {
  const found = [...host.querySelectorAll("input")].find((element) =>
    element.labels?.[0]?.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing input ${label}`);
  return found;
};
const fill = async (label: string, value: string) => {
  const element = input(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const toggle = async (label: string) => {
  await act(async () => input(label).click());
};
const submit = async () => {
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing policy form");
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
};

describe("private merchant policy editor", () => {
  test("loading and empty states never imply public commerce readiness", async () => {
    policy = undefined;
    await render();
    expect(host.textContent).toContain("Loading merchant policy");
    expect(host.querySelector("form")).toBeNull();
    policy = null;
    await render();
    expect(host.textContent).toContain("No policy saved yet");
    expect(host.textContent).toContain("Public checkout stays closed");
    expect(host.querySelector("form")?.getAttribute("aria-label")).toBe("Merchant shop policy");
  });

  test("requires explicit physical and digital facts before a revision-zero save", async () => {
    await render();
    await fill("Seller-of-record reference", "seller-v1");
    await fill("Allowed buyer countries", "US, GB");
    await submit();
    expect(calls).toHaveLength(0);
    await toggle("Configure physical sales");
    await toggle("Configure digital sales");
    await fill("Shipping source reference", "ship-v1");
    await fill("Shipping amount", "300");
    await fill("Returns policy reference", "returns-v1");
    await fill("Physical tax source reference", "tax-p-v1");
    await fill("Physical tax basis points", "900");
    await fill("Physical refund policy reference", "refund-p-v1");
    await fill("Physical buyer-retention reference", "retain-p-v1");
    await fill("Digital delivery reference", "deliver-v1");
    await fill("Digital revocation reference", "revoke-v1");
    await fill("Digital tax source reference", "tax-d-v1");
    await fill("Digital tax basis points", "500");
    await fill("Digital refund policy reference", "refund-d-v1");
    await fill("Digital buyer-retention reference", "retain-d-v1");
    await submit();
    expect(calls).toHaveLength(0);
    await toggle("I confirm digital goods have zero shipping");
    await fill("Allowed buyer countries", "US, US");
    await submit();
    expect(calls).toHaveLength(0);
    await fill("Allowed buyer countries", "US, GB");
    await fill("Digital tax basis points", "10001");
    await submit();
    expect(calls).toHaveLength(0);
    await fill("Digital tax basis points", "500");
    await submit();
    expect(calls).toEqual([
      {
        name: "tenantOrders:configurePolicy",
        args: {
          projectId: "store-a",
          expectedRevision: 0,
          sellerOfRecordRef: "seller-v1",
          currency: "USD",
          countries: ["US", "GB"],
          taxRounding: "half_up",
          physical: {
            shippingSourceRef: "ship-v1",
            shippingMinor: 300,
            returnsPolicyRef: "returns-v1",
            taxSourceRef: "tax-p-v1",
            taxBasisPoints: 900,
            refundPolicyRef: "refund-p-v1",
            buyerRetentionRef: "retain-p-v1",
          },
          digital: {
            deliveryRef: "deliver-v1",
            revocationRef: "revoke-v1",
            noShipping: true,
            taxSourceRef: "tax-d-v1",
            taxBasisPoints: 500,
            refundPolicyRef: "refund-d-v1",
            buyerRetentionRef: "retain-d-v1",
          },
        },
      },
    ]);
    expect(host.textContent).toContain("Checkout remains closed");
  });

  test("saved policy hydrates its exact revision and a stale edit refuses", async () => {
    policy = {
      id: "policy-3",
      tenantId: "tenant-a",
      projectId: "store-a",
      revision: 3,
      sellerOfRecordRef: "seller-v3",
      currency: "EUR",
      countries: ["DE"],
      taxRounding: "half_up",
      physical: {
        shippingSourceRef: "ship-v3",
        shippingMinor: 0,
        returnsPolicyRef: "returns-v3",
        taxSourceRef: "tax-v3",
        taxBasisPoints: 1000,
        refundPolicyRef: "refund-v3",
        buyerRetentionRef: "retain-v3",
      },
    };
    await render();
    expect(host.textContent).toContain("Saved policy v3");
    expect(input("Shipping amount").value).toBe("0");
    expect(host.textContent).not.toContain("Digital delivery reference");
    failure = "STALE_REVISION";
    await submit();
    expect(calls.at(-1)).toMatchObject({
      name: "tenantOrders:configurePolicy",
      args: { projectId: "store-a", expectedRevision: 3, currency: "EUR" },
    });
    expect(host.textContent).toContain("changed elsewhere");
  });
});
