// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Product = {
  _id: string;
  sku: string;
  variant: string;
  currency: string;
  priceMinor: number;
  status: "draft" | "active" | "retired";
  revision: number;
  stockRevision: number;
  available: number | "untracked";
  reservationTtlMs: number | null;
};
let page: { products: Product[]; nextCursor: string | null } | undefined;
let queryArgs: unknown;
const calls: { name: string; args: unknown }[] = [];
let failure: string | null = null;
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (getFunctionName(ref as never) !== "tenantCatalogue:listProducts")
      throw new Error("Unexpected query");
    queryArgs = args;
    return page;
  },
  useMutation: (ref: unknown) => async (args: unknown) => {
    const name = getFunctionName(ref as never);
    calls.push({ name, args });
    if (failure) throw new Error(failure);
    return { productId: "product-new", revision: 2, stockRevision: 2 };
  },
}));

const { TenantCatalogue } = await import("./TenantCatalogue");
let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  page = { products: [], nextCursor: null };
  calls.length = 0;
  queryArgs = null;
  failure = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async () => {
  await act(async () => root.render(createElement(TenantCatalogue)));
};
const button = (name: string) => {
  const found = [...host.querySelectorAll("button")].find((el) => el.textContent?.includes(name));
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
};
const click = async (el: Element) => {
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const type = async (label: string, value: string) => {
  const input = [...host.querySelectorAll("input")].find((el) =>
    el.labels?.[0]?.textContent?.includes(label),
  );
  if (!input) throw new Error(`Missing labelled input ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("authenticated tenant catalogue controls", () => {
  test("loading, empty and closed-commerce states are explicit", async () => {
    page = undefined;
    await render();
    expect(host.textContent).toContain("Loading your catalogue");
    page = { products: [], nextCursor: null };
    await render();
    expect(host.textContent).toContain("No products yet");
    expect(host.textContent).toContain("Checkout is not available");
    expect(host.querySelector("[aria-label='Create product']")).not.toBeNull();
  });

  test("desktop/mobile DOM keeps labelled keyboard controls and finite availability", async () => {
    page = {
      products: [
        {
          _id: "product-a",
          sku: "lamp",
          variant: "bronze",
          currency: "USD",
          priceMinor: 1250,
          status: "active",
          revision: 1,
          stockRevision: 2,
          available: 3,
          reservationTtlMs: 900_000,
        },
      ],
      nextCursor: "more",
    };
    for (const width of [1280, 390]) {
      window.innerWidth = width;
      await render();
      expect(host.textContent).toContain("3 available");
      expect(host.textContent).toContain("More products are available");
      expect(host.querySelector("[data-testid='catalogue-grid']")?.getAttribute("style")).toContain(
        "auto-fit",
      );
      for (const label of ["SKU", "Variant", "Currency", "Price (minor units)"]) {
        expect(
          [...host.querySelectorAll("input")].some((el) =>
            el.labels?.[0]?.textContent?.includes(label),
          ),
        ).toBe(true);
      }
      expect(button("Pause").getAttribute("type")).toBe("button");
      (button("Pause") as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(button("Pause"));
    }
  });

  test("row actions pin product and stock revisions; pagination never silently truncates", async () => {
    page = {
      products: [
        {
          _id: "product-a",
          sku: "lamp",
          variant: "bronze",
          currency: "USD",
          priceMinor: 1250,
          status: "active",
          revision: 4,
          stockRevision: 7,
          available: 3,
          reservationTtlMs: 900_000,
        },
      ],
      nextCursor: "page-2",
    };
    await render();
    await type("New price (minor units)", "1500");
    await click(button("Save price"));
    expect(calls.at(-1)).toEqual({
      name: "tenantCatalogue:editProduct",
      args: { productId: "product-a", expectedRevision: 4, priceMinor: 1500 },
    });
    await type("Stock adjustment", "-1");
    await click(button("Adjust stock"));
    expect(calls.at(-1)).toEqual({
      name: "tenantCatalogue:adjustStock",
      args: { productId: "product-a", expectedRevision: 7, delta: -1 },
    });
    await click(button("Pause product"));
    expect(calls.at(-1)).toEqual({
      name: "tenantCatalogue:editProduct",
      args: { productId: "product-a", expectedRevision: 4, status: "retired" },
    });
    await click(button("Next page"));
    expect(queryArgs).toEqual({ cursor: "page-2", limit: 24 });
    expect(button("Previous page")).toBeTruthy();
  });

  test("an active finite product shows its saved hold window and permits a bounded CAS edit", async () => {
    page = {
      products: [
        {
          _id: "product-a",
          sku: "lamp",
          variant: "bronze",
          currency: "USD",
          priceMinor: 1250,
          status: "active",
          revision: 4,
          stockRevision: 7,
          available: 3,
          reservationTtlMs: 1_200_000,
        },
      ],
      nextCursor: null,
    };
    await render();
    const card = host.querySelector("article")!;
    expect(card.textContent).toContain("Current reservation window: 20 minutes");
    const input = [...card.querySelectorAll("input")].find((el) =>
      el.labels?.[0]?.textContent?.includes("Reservation window"),
    )!;
    expect(input.value).toBe("20");
    const save = [...card.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Confirm stock policy"),
    )!;
    const setMinutes = async (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setMinutes("0");
    expect(save.disabled).toBe(true);
    await setMinutes("61");
    expect(save.disabled).toBe(true);
    expect(calls).toHaveLength(0);
    await setMinutes("60");
    expect(save.disabled).toBe(false);
    failure = "STALE_REVISION";
    await click(save);
    expect(calls).toEqual([
      {
        name: "tenantCatalogue:configureStockPolicy",
        args: {
          productId: "product-a",
          expectedStockRevision: 7,
          policy: { kind: "finite", reservationTtlMs: 3_600_000 },
        },
      },
    ]);
    expect(card.textContent).toContain("stale");
    expect(input.value).toBe("60");
  });

  test("untracked stock requires an explicit checkbox and never masquerades as finite units", async () => {
    await render();
    const posture = [...host.querySelectorAll("select")].find((el) =>
      el.labels?.[0]?.textContent?.includes("Stock posture"),
    );
    expect(posture).toBeTruthy();
    await act(async () => {
      posture!.value = "untracked";
      posture!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("I explicitly approve untracked stock");
    expect(host.textContent).not.toContain("Starting units");
    page = {
      products: [
        {
          _id: "untracked-a",
          sku: "service",
          variant: "one",
          currency: "USD",
          priceMinor: 500,
          status: "active",
          revision: 1,
          stockRevision: 1,
          available: "untracked",
          reservationTtlMs: null,
        },
      ],
      nextCursor: null,
    };
    await render();
    expect(host.textContent).toContain("Stock untracked — explicitly approved");
    expect(host.textContent).not.toContain("0 available");
  });

  test("create, stale refusal and retry use tenant-scoped mutations and preserve form values", async () => {
    await render();
    await type("SKU", "lamp");
    await type("Variant", "bronze");
    await type("Currency", "USD");
    await type("Price (minor units)", "1250");
    await type("Starting units", "4");
    await type("Reservation window (minutes)", "61");
    await click(button("Create product"));
    expect(calls).toHaveLength(0);
    await type("Reservation window (minutes)", "15");
    failure = "STALE_REVISION";
    await click(button("Create product"));
    expect(host.getAttribute("role")).not.toBe("alert");
    expect(host.textContent).toContain("stale");
    expect(calls.at(-1)).toMatchObject({
      name: "tenantCatalogue:createProduct",
      args: {
        sku: "lamp",
        variant: "bronze",
        currency: "USD",
        priceMinor: 1250,
        stock: { kind: "finite", onHand: 4, reservationTtlMs: 900000 },
      },
    });
    failure = null;
    await click(button("Create product"));
    expect(host.textContent).toContain("Product created");
  });

  test("the authenticated sites route mounts the live catalogue without a public shop link", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/dashboard/sites/page.tsx"), "utf8");
    expect(source).toContain('import { TenantCatalogue } from "./TenantCatalogue"');
    expect(source).toContain("<TenantCatalogue />");
    expect(source).not.toContain("/checkout");
  });
});
