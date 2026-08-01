import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via Vite's import.meta.glob. Passing them
// explicitly keeps discovery reliable inside the pnpm workspace.
const modules = import.meta.glob("./**/*.*s");

// Convex Auth signs a subject of `<users._id>|<authSessions._id>`, so a returning user
// arrives with a DIFFERENT subject every login. These tests insert real `users` rows and
// build subjects from their ids, rather than asserting on a string parser, because the
// property that matters is the one the wrapper actually gives a handler: scope that is
// stable per USER and isolated per user. Regression guard for the per-session-scoping bug
// (spec 2026-07-21-tenant-scope-per-session-fix-design).
describe("tenant scope: stable per user, isolated across users (SC-2)", () => {
  test("two sessions of ONE user share one tenant scope", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    // Same user row, two different login sessions.
    const sessionA = t.withIdentity({ subject: `${userId}|session_a` });
    const sessionB = t.withIdentity({ subject: `${userId}|session_b` });

    await sessionA.mutation(api.demo.addItem, { label: "written-in-session-a" });

    // The whole point: a NEW session must not mint a new tenant.
    const readBack = await sessionB.query(api.demo.listItems, {});
    expect(readBack).toHaveLength(1);
    // `!` earned by the length assertion above (`noUncheckedIndexedAccess` makes an index read
    // `T | undefined`, and TS cannot see that the assertion already failed the test).
    const item = readBack[0]!;
    expect(item.label).toBe("written-in-session-a");
    expect(item.tenantId).toBe(String(userId));
  });

  test("a second user cannot read the first user's data", async () => {
    const t = convexTest(schema, modules);
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    const userB = await t.run((ctx) => ctx.db.insert("users", {}));

    await t
      .withIdentity({ subject: `${userA}|session_a` })
      .mutation(api.demo.addItem, { label: "a-secret" });

    const bItems = await t
      .withIdentity({ subject: `${userB}|session_a` })
      .query(api.demo.listItems, {});
    expect(bItems).toEqual([]);
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
