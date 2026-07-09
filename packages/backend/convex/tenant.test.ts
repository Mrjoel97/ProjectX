import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via Vite's import.meta.glob. Passing them
// explicitly keeps discovery reliable inside the pnpm workspace.
const modules = import.meta.glob("./**/*.*s");

describe("tenant isolation (SC-2)", () => {
  test("cross-tenant reads are isolated: A's write is invisible to B", async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity({ subject: "user_a" });
    const asB = t.withIdentity({ subject: "user_b" });

    await asA.mutation(api.demo.addItem, { label: "a-secret" });

    const bItems = await asB.query(api.demo.listItems, {});
    expect(bItems).toEqual([]);
  });

  test("a tenant reads exactly its own items", async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity({ subject: "user_a" });

    await asA.mutation(api.demo.addItem, { label: "a-item" });

    const aItems = await asA.query(api.demo.listItems, {});
    expect(aItems).toHaveLength(1);
    expect(aItems[0].label).toBe("a-item");
    expect(aItems[0].tenantId).toBe("user_a");
  });

  test("an unauthenticated mutation throws UNAUTHENTICATED", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.demo.addItem, { label: "nope" })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });

  test("an unauthenticated query throws UNAUTHENTICATED", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.demo.listItems, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});
