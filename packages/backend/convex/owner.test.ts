import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
// `audit.log` maintains the auditCounts aggregate, so the REAL insert path throws
// `Component "auditCounts" is not registered` without this. Same harness shape as
// calendar.test.ts / blueprint.test.ts (relative import — the package blocks the subpath).
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

// GOVN-01. Owner authority is the `users.owner` boolean and NOTHING else. Every negative
// case below is anti-vacuous: it reads the target row (or the audit table) back after the
// refusal, so a test cannot pass merely because the fixture was never really there.

describe("owner.viewer — one boolean, fail-closed", () => {
  test("owner:true reads true; the same owner is still owner from a second session", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));

    const sessionA = await t
      .withIdentity({ subject: `${userId}|session_a` })
      .query(api.owner.viewer, {});
    const sessionB = await t
      .withIdentity({ subject: `${userId}|session_b` })
      .query(api.owner.viewer, {});

    expect(sessionA).toEqual({ isOwner: true });
    // Ownership must survive a logout/login. If this ever keys on the session-bearing
    // subject instead of the user row, this is the assertion that catches it.
    expect(sessionB).toEqual({ isOwner: true });
  });

  test("an absent owner field reads false (absence means false, no migration)", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    const result = await t
      .withIdentity({ subject: `${userId}|s` })
      .query(api.owner.viewer, {});

    expect(result).toEqual({ isOwner: false });
    // Anti-vacuity: the row really exists and really has no owner field.
    const row = await t.run((ctx) => ctx.db.get(userId));
    expect(row).not.toBeNull();
    expect(row?.owner).toBeUndefined();
  });

  test("an explicit owner:false reads false", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", { owner: false }));

    expect(
      await t.withIdentity({ subject: `${userId}|s` }).query(api.owner.viewer, {}),
    ).toEqual({ isOwner: false });

    const row = await t.run((ctx) => ctx.db.get(userId));
    expect(row?.owner).toBe(false);
  });

  test("an orphan identity (row deleted, session alive) reads false", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    await t.run((ctx) => ctx.db.delete(userId));

    expect(
      await t.withIdentity({ subject: `${userId}|s` }).query(api.owner.viewer, {}),
    ).toEqual({ isOwner: false });
    // Anti-vacuity: the row is genuinely gone, so `false` came from the null read and not
    // from the fixture never having been an owner.
    expect(await t.run((ctx) => ctx.db.get(userId))).toBeNull();
  });

  test("an unauthenticated caller cannot even ask", async () => {
    const t = harness();
    await expect(t.query(api.owner.viewer, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe("owner.bootstrapOwner — exact, idempotent, audited once", () => {
  test("absent -> true on the first run, no-op on the second, with exactly one audit row", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    const first = await t.mutation(internal.owner.bootstrapOwner, { userId });
    expect(first).toEqual({ changed: true, userId });
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({ owner: true });

    const second = await t.mutation(internal.owner.bootstrapOwner, { userId });
    expect(second).toEqual({ changed: false, userId });
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({ owner: true });

    // Idempotence is about the AUDIT too — a second grant event would imply a second
    // transition that never happened.
    const events = await t.run((ctx) => ctx.db.query("audit").collect());
    const granted = events.filter((e) => e.eventType === "owner.granted");
    expect(granted).toHaveLength(1);
  });

  test("the audit payload key set is exactly owner,userId (CLAUDE.md §4)", async () => {
    const t = harness();
    const userId = await t.run((ctx) =>
      // Populate the PII-bearing fields so a leak would actually have something to leak.
      ctx.db.insert("users", { email: "owner@example.com", name: "Real Name" }),
    );

    await t.mutation(internal.owner.bootstrapOwner, { userId });

    const granted = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("eventType"), "owner.granted"))
        .collect(),
    );
    expect(granted).toHaveLength(1);
    const event = granted[0]!;
    expect(Object.keys(event.payload).sort()).toEqual(["owner", "userId"]);
    expect(event.payload).toEqual({ owner: true, userId });

    // The serialized row must not carry the identifying fields anywhere, including in the
    // actor/correlation strings.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("Real Name");
  });

  test("explicit owner:false is promoted once", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", { owner: false }));

    expect(await t.mutation(internal.owner.bootstrapOwner, { userId })).toEqual({
      changed: true,
      userId,
    });
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({ owner: true });
  });

  test("a missing row throws NO_SUCH_USER and grants nobody", async () => {
    const t = harness();
    const bystander = await t.run((ctx) => ctx.db.insert("users", {}));
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {});
      await ctx.db.delete(id);
      return id;
    });

    await expect(t.mutation(internal.owner.bootstrapOwner, { userId: ghost })).rejects.toThrow(
      /NO_SUCH_USER/,
    );

    // Anti-vacuity: the failure must not have promoted some other row instead.
    expect((await t.run((ctx) => ctx.db.get(bystander)))?.owner).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(0);
  });

  test("granting one user never touches another", async () => {
    const t = harness();
    const target = await t.run((ctx) => ctx.db.insert("users", {}));
    const other = await t.run((ctx) => ctx.db.insert("users", {}));

    await t.mutation(internal.owner.bootstrapOwner, { userId: target });

    expect(await t.run((ctx) => ctx.db.get(target))).toMatchObject({ owner: true });
    expect((await t.run((ctx) => ctx.db.get(other)))?.owner).toBeUndefined();
  });
});
