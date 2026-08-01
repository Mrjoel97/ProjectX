// IMPR-01 feedback capture (convex-test): a thumbs up/down (+ optional comment) on a delivered
// response creates ONE tenant-scoped, skill-version-attributed row; a re-tap EDITS that same row
// (a mis-tap can't poison the signal); undo deletes it (fully reversible). A request with no
// resolvable skillVersion is rejected (unattributable feedback is never stored — the Pitfall-1
// warning sign), and a cross-tenant requestId is "not found" (the tenant guard).
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";

/** Seed a delivered request row (optionally attributed to a skill version). */
function seedRequest(
  t: ReturnType<typeof convexTest>,
  { tenantId = TENANT, skillVersion }: { tenantId?: string; skillVersion?: number },
) {
  return t.run((ctx) =>
    ctx.db.insert("requests", {
      tenantId,
      correlationId: crypto.randomUUID(),
      goal: "Q3 update",
      recipient: "a@example.com",
      status: "sent",
      attachmentRefs: [],
      skillVersion,
      createdAt: Date.now(),
    }),
  );
}

const rowsFor = (t: ReturnType<typeof convexTest>, requestId: Id<"requests">) =>
  t.run((ctx) =>
    ctx.db
      .query("feedback")
      .withIndex("by_tenant_request", (q) => q.eq("tenantId", TENANT).eq("requestId", requestId))
      .collect(),
  );

describe("feedback capture (IMPR-01)", () => {
  test("submit inserts ONE attributed row; a re-tap edits the SAME row (no duplicate)", async () => {
    const t = convexTest(schema, modules);
    const requestId = await seedRequest(t, { skillVersion: 7 });
    const asT = t.withIdentity({ subject: TENANT });

    await asT.mutation(api.feedback.submitFeedback, { requestId, rating: "down", comment: "wrong tone" });

    let rows = await rowsFor(t, requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rating: "down",
      comment: "wrong tone",
      skillName: COCKPIT_AGENT_SKILL,
      skillVersion: 7,
    });
    const firstCreatedAt = rows[0]!.createdAt;

    // A re-tap (mis-tap fix) EDITS the same row — rating + comment change, still ONE row, createdAt frozen.
    await asT.mutation(api.feedback.submitFeedback, { requestId, rating: "up" });
    rows = await rowsFor(t, requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe("up");
    expect(rows[0]!.comment).toBeUndefined(); // the new tap carried no comment → cleared
    expect(rows[0]!.createdAt).toBe(firstCreatedAt);
    expect(rows[0]!.updatedAt).toBeGreaterThanOrEqual(firstCreatedAt);
  });

  test("undo deletes the row and is idempotent (a mis-tap is fully reversible)", async () => {
    const t = convexTest(schema, modules);
    const requestId = await seedRequest(t, { skillVersion: 3 });
    const asT = t.withIdentity({ subject: TENANT });

    await asT.mutation(api.feedback.submitFeedback, { requestId, rating: "up" });
    expect(await rowsFor(t, requestId)).toHaveLength(1);

    await asT.mutation(api.feedback.undoFeedback, { requestId });
    expect(await rowsFor(t, requestId)).toHaveLength(0);

    // Idempotent: a second undo (no row) does not throw.
    await asT.mutation(api.feedback.undoFeedback, { requestId });
    expect(await rowsFor(t, requestId)).toHaveLength(0);
  });

  test("myFeedback returns the current row (or null) so the UI renders the persisted state", async () => {
    const t = convexTest(schema, modules);
    const requestId = await seedRequest(t, { skillVersion: 2 });
    const asT = t.withIdentity({ subject: TENANT });

    expect(await asT.query(api.feedback.myFeedback, { requestId })).toBeNull();

    await asT.mutation(api.feedback.submitFeedback, { requestId, rating: "down", comment: "off" });
    const row = await asT.query(api.feedback.myFeedback, { requestId });
    expect(row).toMatchObject({ rating: "down", comment: "off", skillVersion: 2 });
  });

  test("an unattributable request (no skillVersion) is rejected — no row is stored", async () => {
    const t = convexTest(schema, modules);
    const requestId = await seedRequest(t, {}); // pre-Phase-8 row: no skillVersion
    const asT = t.withIdentity({ subject: TENANT });

    await expect(
      asT.mutation(api.feedback.submitFeedback, { requestId, rating: "up" }),
    ).rejects.toThrow(/unattributable/i);
    expect(await rowsFor(t, requestId)).toHaveLength(0);
  });

  test("cross-tenant submit is 'request not found' (the tenant guard)", async () => {
    const t = convexTest(schema, modules);
    const requestId = await seedRequest(t, { tenantId: "tenant_b", skillVersion: 5 });
    const asT = t.withIdentity({ subject: TENANT }); // tenant_a rating tenant_b's request

    await expect(
      asT.mutation(api.feedback.submitFeedback, { requestId, rating: "up" }),
    ).rejects.toThrow(/request not found/i);
    // Nothing stored under either tenant.
    expect(await t.run((ctx) => ctx.db.query("feedback").collect())).toHaveLength(0);
  });
});
