import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via import.meta.glob; exclude the tests.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// The optimizerEligibility query is a THIN adapter over @pikar/core's classifyBreach — these
// prove the roll (per-skill up/down counts) is wired to the pure decision: eligible flips true
// ONLY when both the rate and the floor are crossed; below the floor → false (IMPR-02).

/** Seed n feedback rows for a skill (down first). requestId is never dereferenced by the query
 *  (the roll reads skillName + rating only), so one shared minimal request is enough. */
async function seedFeedback(
  t: ReturnType<typeof convexTest>,
  opts: { skillName: string; down: number; up: number },
) {
  await t.run(async (ctx) => {
    const requestId = (await ctx.db.insert("requests", {
      tenantId: "tester",
      correlationId: "c1",
      goal: "g",
      recipient: "r",
      status: "submitted",
      attachmentRefs: [],
      createdAt: 1,
    })) as Id<"requests">;
    const insert = (rating: "up" | "down") =>
      ctx.db.insert("feedback", {
        tenantId: "tester",
        requestId,
        skillName: opts.skillName,
        skillVersion: 12,
        rating,
        createdAt: 1,
        updatedAt: 1,
      });
    for (let i = 0; i < opts.down; i++) await insert("down");
    for (let i = 0; i < opts.up; i++) await insert("up");
  });
}

test("empty feedback → not eligible, below_sample_floor (no divide-by-zero)", async () => {
  const t = convexTest(schema, modules);
  const r = await t.query(internal.optimizerEligibility.optimizerEligibility, {});
  expect(r.eligible).toBe(false);
  expect(r.reason).toBe("below_sample_floor");
  expect(r.sampleCount).toBe(0);
  expect(r.skillName).toBe("cockpit-agent"); // default skill
});

test("below the sample floor → not eligible even at a 100% negative rate", async () => {
  const t = convexTest(schema, modules);
  await seedFeedback(t, { skillName: "cockpit-agent", down: 5, up: 0 });
  const r = await t.query(internal.optimizerEligibility.optimizerEligibility, {});
  expect(r.eligible).toBe(false);
  expect(r.reason).toBe("below_sample_floor");
  expect(r.sampleCount).toBe(5);
});

test("floor met but rate below threshold → below_threshold", async () => {
  const t = convexTest(schema, modules);
  // 2 down / 20 total = 0.10 < 0.30
  await seedFeedback(t, { skillName: "cockpit-agent", down: 2, up: 18 });
  const r = await t.query(internal.optimizerEligibility.optimizerEligibility, {});
  expect(r.eligible).toBe(false);
  expect(r.reason).toBe("below_threshold");
  expect(r.sampleCount).toBe(20);
});

test("rate AND floor crossed, no prior run → eligible", async () => {
  const t = convexTest(schema, modules);
  // 8 down / 20 total = 0.40 ≥ 0.30, count ≥ 20
  await seedFeedback(t, { skillName: "cockpit-agent", down: 8, up: 12 });
  const r = await t.query(internal.optimizerEligibility.optimizerEligibility, {});
  expect(r.eligible).toBe(true);
  expect(r.reason).toBe("eligible");
  expect(r.negativeRate).toBeCloseTo(0.4);
  expect(r.threshold).toBe(0.3);
});

test("crossed rate + floor but within cooldown → not eligible (cooldown)", async () => {
  const t = convexTest(schema, modules);
  await seedFeedback(t, { skillName: "cockpit-agent", down: 8, up: 12 });
  // Anchor a run 1h ago; default cooldown is 7d → too soon.
  await t.mutation(internal.optimizerConfig.setOptimizerConfig, {
    lastRunAt: Date.now() - 3_600_000,
  });
  const r = await t.query(internal.optimizerEligibility.optimizerEligibility, {});
  expect(r.eligible).toBe(false);
  expect(r.reason).toBe("cooldown");
});

test("the roll is per-skill — another skill's feedback does not count", async () => {
  const t = convexTest(schema, modules);
  await seedFeedback(t, { skillName: "cockpit-agent", down: 2, up: 3 }); // 5 for the target
  await seedFeedback(t, { skillName: "inbox-digest", down: 30, up: 0 }); // noise, other skill
  const r = await t.query(internal.optimizerEligibility.optimizerEligibility, {});
  expect(r.sampleCount).toBe(5); // only cockpit-agent rows
  expect(r.reason).toBe("below_sample_floor");
});
