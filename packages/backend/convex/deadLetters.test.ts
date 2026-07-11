import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via Vite's import.meta.glob.
const modules = import.meta.glob("./**/*.*s");

/** Seed a deadLetters row for a tenant at a given status (bypasses the insert-only handler). */
async function seedDeadLetter(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  status: "new" | "replayed" | "resolved",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("deadLetters", {
      tenantId,
      correlationId: `cid-${crypto.randomUUID()}`,
      workflowId: `wf-${crypto.randomUUID()}`,
      payload: { requestId: "ref-only" },
      error: "route_not_implemented",
      status,
      createdAt: Date.now(),
    }),
  );
}

describe("operator dead-letter surface (OPSG-07)", () => {
  test("newCount / listNew return only this tenant's status=new rows", async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity({ subject: "user_a" });

    await seedDeadLetter(t, "user_a", "new");
    await seedDeadLetter(t, "user_a", "new");
    await seedDeadLetter(t, "user_a", "resolved"); // resolved is excluded
    await seedDeadLetter(t, "user_b", "new"); // other tenant is invisible

    expect(await asA.query(api.deadLetters.newCount, {})).toBe(2);
    const list = await asA.query(api.deadLetters.listNew, {});
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.tenantId === "user_a" && r.status === "new")).toBe(true);
  });

  test("markResolved flips new -> resolved and clears it from the new-count (badge)", async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity({ subject: "user_a" });

    const id = await seedDeadLetter(t, "user_a", "new");
    expect(await asA.query(api.deadLetters.newCount, {})).toBe(1);

    await asA.mutation(api.deadLetters.markResolved, { id });

    expect(await asA.query(api.deadLetters.newCount, {})).toBe(0);
    expect(await asA.query(api.deadLetters.listNew, {})).toHaveLength(0);
  });

  test("markResolved cannot cross tenants", async () => {
    const t = convexTest(schema, modules);
    const asB = t.withIdentity({ subject: "user_b" });
    const id = await seedDeadLetter(t, "user_a", "new");

    await expect(asB.mutation(api.deadLetters.markResolved, { id })).rejects.toThrow();
    // A's row is untouched.
    expect(await t.withIdentity({ subject: "user_a" }).query(api.deadLetters.newCount, {})).toBe(1);
  });

  test("an unauthenticated read fails closed", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.deadLetters.newCount, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});
