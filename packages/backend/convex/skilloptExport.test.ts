// IMPR-02 trajectory export (convex-test): the SEPARATE, PII-scrubbed export plane the CI SkillOpt
// job pulls from. Proves the scrub firewall (a seeded email/SSN/phone never reaches the output),
// the fail-closed DROP (a field that can't be scrubbed omits the whole trajectory — never ship raw
// text), rating→hard scoring, a deterministic train/valid split, and that unrated/unattributable
// trajectories are skipped.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";

/** Seed a delivered request + its feedback row. Returns the requestId. */
async function seedRated(
  t: ReturnType<typeof convexTest>,
  {
    goal = "Q3 update",
    body,
    comment,
    rating,
    skillVersion = 7,
  }: {
    goal?: string;
    body?: string;
    comment?: string;
    rating: "up" | "down";
    skillVersion?: number;
  },
): Promise<Id<"requests">> {
  return t.run(async (ctx) => {
    const requestId = await ctx.db.insert("requests", {
      tenantId: TENANT,
      correlationId: crypto.randomUUID(),
      goal,
      recipient: "a@example.com",
      status: "sent",
      attachmentRefs: [],
      editedBody: body,
      skillVersion,
      createdAt: Date.now(),
    });
    await ctx.db.insert("feedback", {
      tenantId: TENANT,
      requestId,
      skillName: "cockpit-agent",
      skillVersion,
      rating,
      comment,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return requestId;
  });
}

const runExport = (t: ReturnType<typeof convexTest>) =>
  t.query(internal.skilloptExport.buildTrajectoryExport, {});

describe("trajectory export (IMPR-02)", () => {
  test("scrubs PII from goal/body/comment — a seeded email/SSN/phone never reaches the output", async () => {
    const t = convexTest(schema, modules);
    await seedRated(t, {
      goal: "Draft to a@b.com",
      body: "My SSN is 555-12-3456 — please confirm.",
      comment: "call 555-123-4567 if wrong",
      rating: "up",
    });

    const out = await runExport(t);
    expect(out.items).toHaveLength(1);
    const blob = JSON.stringify(out);
    // The scrub firewall: no raw PII anywhere in the emitted JSON.
    expect(blob).not.toContain("a@b.com");
    expect(blob).not.toContain("555-12-3456");
    expect(blob).not.toContain("555-123-4567");
    // counts reflect the redaction (structured PII was found + replaced).
    const item = out.items[0]!;
    expect(item.counts.email).toBeGreaterThanOrEqual(1);
    expect(item.counts.ssn).toBeGreaterThanOrEqual(1);
    expect(item.counts.phone).toBeGreaterThanOrEqual(1);
    // Placeholders survive so the structure is preserved for the optimizer.
    expect(item.task_description).toContain("[EMAIL_1]");
  });

  test("rating maps to hard: up→1, down→0", async () => {
    const t = convexTest(schema, modules);
    const upId = await seedRated(t, { rating: "up", skillVersion: 1 });
    const downId = await seedRated(t, { rating: "down", skillVersion: 1 });

    const out = await runExport(t);
    const byId = new Map(out.items.map((i) => [i.id, i]));
    expect(byId.get(upId)!.hard).toBe(1);
    expect(byId.get(downId)!.hard).toBe(0);
  });

  test("fail-closed: a field that can't be scrubbed DROPS the whole trajectory", async () => {
    const t = convexTest(schema, modules);
    const okId = await seedRated(t, { rating: "up" });
    // PII_POISON:: routes the body into scanText's real Err branch (the intake.ts sentinel pattern).
    const poisonId = await seedRated(t, { body: "PII_POISON:: unscrubbaable", rating: "up" });

    const out = await runExport(t);
    const ids = out.items.map((i) => i.id);
    expect(ids).toContain(okId);
    expect(ids).not.toContain(poisonId); // dropped — never shipped raw
  });

  test("split is deterministic (same requestId → same bucket every run) and valid ∈ {train,valid}", async () => {
    const t = convexTest(schema, modules);
    await seedRated(t, { rating: "up", skillVersion: 1 });
    await seedRated(t, { rating: "down", skillVersion: 1 });

    const a = await runExport(t);
    const b = await runExport(t);
    const splitA = new Map(a.items.map((i) => [i.id, i.split]));
    for (const item of b.items) {
      expect(item.split).toBe(splitA.get(item.id)); // stable across runs
      expect(["train", "valid"]).toContain(item.split);
    }
  });

  test("an unattributable trajectory (request lost its skillVersion) is skipped", async () => {
    const t = convexTest(schema, modules);
    // A feedback row whose request has NO skillVersion (a pre-Phase-8 request) — unattributable.
    await t.run(async (ctx) => {
      const requestId = await ctx.db.insert("requests", {
        tenantId: TENANT,
        correlationId: crypto.randomUUID(),
        goal: "orphan",
        recipient: "a@example.com",
        status: "sent",
        attachmentRefs: [],
        createdAt: Date.now(),
      });
      await ctx.db.insert("feedback", {
        tenantId: TENANT,
        requestId,
        skillName: "cockpit-agent",
        skillVersion: 4,
        rating: "up",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const out = await runExport(t);
    expect(out.items).toHaveLength(0);
  });
});
