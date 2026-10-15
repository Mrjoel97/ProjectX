import { notificationMessage } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via Vite's import.meta.glob.
const modules = import.meta.glob("./**/*.*s");

const TENANT = "user_notify";

const notifications = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", TENANT))
      .collect(),
  );

const listScheduled = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("notify choke point (OPSG-05 — in-app insert + best-effort external dispatch)", () => {
  test("notify inserts the in-app row AND schedules the external dispatch", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.notifications.notify, {
      tenantId: TENANT,
      kind: "deadletter",
      message: notificationMessage("deadletter"),
    });

    // The fail-closed floor: exactly one in-app row is written synchronously.
    const rows = await notifications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("deadletter");
    expect(rows[0]?.read).toBe(false);

    // The external channel is scheduled (runAfter 0) — never inline, so a slow/failing send can
    // never block or roll back the in-app write.
    const scheduled = await listScheduled(t);
    expect(scheduled.some((s) => String(s.name).includes("notifyExternal"))).toBe(true);
  });

  test("dispatch fails closed with no connected mailbox — never throws, never re-notifies (loop guard)", async () => {
    const t = convexTest(schema, modules);

    // No gmailTokens row for the tenant → freshAccessToken returns not_connected → dispatch returns
    // silently BEFORE any network call. It must not throw and must write NOTHING (a failed external
    // send that notified would create the very notification loop OPSG-05 forbids).
    // A void action resolves to null over the convex-test boundary — the load-bearing claim is that
    // it RESOLVES (never throws).
    await expect(
      t.action(internal.notifyExternal.dispatch, { tenantId: TENANT, kind: "deadletter" }),
    ).resolves.toBeNull();

    expect(await notifications(t)).toHaveLength(0);
  });
});

test("unread notification window is bounded, isolated, and advances after dismissal", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 105; i++)
      await ctx.db.insert("notifications", {
        tenantId: TENANT,
        kind: "test",
        message: "Notice",
        read: false,
        createdAt: i,
      });
    await ctx.db.insert("notifications", {
      tenantId: "other",
      kind: "test",
      message: "Foreign",
      read: false,
      createdAt: 1000,
    });
  });
  const actor = t.withIdentity({ subject: `${TENANT}|s` });
  const first = await actor.query(api.notifications.unreadWindow, {});
  expect(first.items).toHaveLength(100);
  expect(first.truncated).toBe(true);
  expect(first.items[0]?.createdAt).toBe(104);
  expect(first.items.every((n) => n.tenantId === TENANT)).toBe(true);
  for (const row of first.items.slice(0, 6))
    await actor.mutation(api.notifications.markRead, { notificationId: row._id });
  const next = await actor.query(api.notifications.unreadWindow, {});
  expect(next.items).toHaveLength(99);
  expect(next.truncated).toBe(false);
  expect(next.items.at(-1)?.createdAt).toBe(0);
});
