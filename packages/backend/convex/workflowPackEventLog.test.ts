import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PACK_EVENTS, PACK_OUTCOMES, planDecisions } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PACK_EVENT_PAGE_MAX } from "./workflowPackEventLog";

const modules = import.meta.glob("./**/*.*s");

// 27-03 Task 2 (PACK-04). The append-only recorder over the `workflowPackEvents` table 27-02
// created. Two properties are asserted here and nowhere else:
//
//   ISOLATION — the tenant-derived read can never return another tenant's rows, proven with two
//   real users rather than by reading the wrapper's source.
//   PRIVACY — the plane structurally cannot carry raw content. That is proven by making Convex
//   REFUSE a row with a text field, not by asserting the convention in prose.

const base = {
  tenantId: "t-a",
  packId: "brand-review" as const,
  runId: "run-1",
  event: "run_started" as const,
};

describe("the recorder is append-only and closed", () => {
  test("a recorded event reads back through the metric shape", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.workflowPackEventLog.record, {
      ...base,
      event: "run_completed",
      outcome: "partial",
      claimCount: 4,
      citedClaimCount: 3,
    });

    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("partial");
    expect(rows[0]?.createdAt).toBeGreaterThan(0);
  });

  // The module is the SOLE write surface for a table classified `audit_immutable`, which is a claim
  // about immutability rather than a filing label. A patch/replace/delete here would make the
  // classification a lie — and would put rows outside the tenant deletion walk that can still be
  // rewritten. This is the `auditImmutability.test.ts` posture, applied to the second such table.
  // MUTATION that must turn this RED: add any update path to workflowPackEventLog.ts.
  test("the module contains no update path — insert only", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./workflowPackEventLog.ts", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(src).toContain("ctx.db.insert(");
    for (const forbidden of ["ctx.db.patch(", "ctx.db.replace(", "ctx.db.delete("]) {
      expect(src.includes(forbidden), `${forbidden} appears in the sole write surface`).toBe(false);
    }
    // Non-vacuity: the strip above must not have eaten the file.
    expect(src.length).toBeGreaterThan(500);
  });

  test("an event name outside the closed vocabulary is refused at the boundary", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately outside the closed union
        event: "run_vibed" as any,
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately outside the closed union
        packId: "not-a-pack" as any,
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        event: "run_completed",
        // biome-ignore lint/suspicious/noExplicitAny: deliberately outside the closed union
        outcome: "great" as any,
      }),
    ).rejects.toThrow();
  });

  // The vocabulary the recorder accepts must be the WHOLE vocabulary — a name the pure metrics
  // module knows but the recorder refuses is an event that can never be measured.
  test("every event name and every outcome in @pikar/core is actually recordable", async () => {
    const t = convexTest(schema, modules);
    for (const event of PACK_EVENTS) {
      await t.mutation(internal.workflowPackEventLog.record, { ...base, event });
    }
    for (const outcome of PACK_OUTCOMES) {
      await t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        event: "run_completed",
        outcome,
      });
    }
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows).toHaveLength(PACK_EVENTS.length + PACK_OUTCOMES.length);
  });
});

describe("the plane structurally cannot carry raw content (CLAUDE.md §4)", () => {
  // NOT a convention test. Convex refuses an argument object carrying a key the validator does not
  // declare, so there is nowhere for a prompt, an output, an excerpt, a URL, a subject line, a
  // customer name or a financial value to go. Each of these is a field someone would plausibly add
  // "just for debugging" — and each is refused by construction.
  //
  // DEFENCE IN DEPTH, measured 2026-08-23 rather than assumed: widening the ARGS validator alone
  // does NOT open the hole. `record` spreads its args into `ctx.db.insert`, so the TABLE's own
  // closed validator refuses the field a second time ("Unexpected field `note` in object"). Both
  // validators must be widened before a text field can be stored, and this test goes red only when
  // both are — verified by mutating each in turn.
  test.each([
    ["prompt", { prompt: "summarise this angry email" }],
    ["output", { output: "Dear Ms Vance, I am sorry to hear..." }],
    ["excerpt", { excerpt: "…the invoice was wrong…" }],
    ["url", { url: "https://example.com/complaint/42" }],
    ["subject", { subject: "Re: my order never arrived" }],
    ["customerName", { customerName: "Ada Vance" }],
    ["amountUsd", { amountUsd: 4200 }],
    ["note", { note: "free text" }],
  ])("a %s field is refused by the validator", async (_label, extra) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        ...extra,
        // biome-ignore lint/suspicious/noExplicitAny: the point is that this key does not exist
      } as any),
    ).rejects.toThrow();
    // …and nothing was written on the way to the refusal.
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toEqual([]);
  });

  // The cost/latency prohibition, at the boundary rather than only in the pure type: this plane
  // must never become a second billing number that can disagree with `spendEvents`.
  test.each([
    ["costUsd"],
    ["amountCents"],
    ["durationMs"],
    ["latencyMs"],
  ])("%s cannot be recorded — cost and latency have owners", async (field) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        [field]: 12,
        // biome-ignore lint/suspicious/noExplicitAny: the point is that this key does not exist
      } as any),
    ).rejects.toThrow();
  });
});

describe("tenant isolation", () => {
  test("a second user cannot read the first user's pack events", async () => {
    const t = convexTest(schema, modules);
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    const userB = await t.run((ctx) => ctx.db.insert("users", {}));

    await t.mutation(internal.workflowPackEventLog.record, {
      ...base,
      tenantId: String(userA),
      event: "plan_approved",
    });

    const aRows = await t
      .withIdentity({ subject: `${userA}|session_a` })
      .query(api.workflowPackEventLog.forTenant, {});
    const bRows = await t
      .withIdentity({ subject: `${userB}|session_a` })
      .query(api.workflowPackEventLog.forTenant, {});

    // PAIRED, deliberately: asserting only that B sees nothing would pass just as happily against
    // an empty table, which is how a cross-tenant test comes to assert nothing at all.
    expect(aRows).toHaveLength(1);
    expect(bRows).toEqual([]);
    expect(planDecisions(aRows)).toEqual({ approved: 1, edited: 0, rejected: 0 });
  });

  // `tenantId` is derived by the wrapper and is NOT an argument, so there is no parameter to
  // poison. This asserts the absence — a later refactor that "helpfully" accepts one would redden.
  test("the read model takes no tenantId argument", async () => {
    const t = convexTest(schema, modules);
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    const userB = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.mutation(internal.workflowPackEventLog.record, {
      ...base,
      tenantId: String(userA),
    });

    await expect(
      t.withIdentity({ subject: `${userB}|session_a` }).query(api.workflowPackEventLog.forTenant, {
        // biome-ignore lint/suspicious/noExplicitAny: proving the argument does not exist
        tenantId: String(userA),
      } as any),
    ).rejects.toThrow();
  });

  test("an unauthenticated caller is refused, not served an empty list", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.workflowPackEventLog.forTenant, {})).rejects.toThrow();
  });

  test("the pack filter narrows within the tenant and never across it", async () => {
    const t = convexTest(schema, modules);
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    for (const packId of ["brand-review", "process-sop"] as const) {
      await t.mutation(internal.workflowPackEventLog.record, {
        ...base,
        tenantId: String(userA),
        packId,
      });
    }
    const asA = t.withIdentity({ subject: `${userA}|session_a` });
    expect(await asA.query(api.workflowPackEventLog.forTenant, {})).toHaveLength(2);
    const filtered = await asA.query(api.workflowPackEventLog.forTenant, {
      packId: "brand-review",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.packId).toBe("brand-review");
  });

  // The corpus must EXCEED the ceiling or this asserts nothing: a test that seeds five rows and asks
  // for a million passes just as happily against a query with no clamp at all.
  test("the read is bounded — a caller cannot ask for an unbounded scan", async () => {
    const t = convexTest(schema, modules);
    const userA = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run(async (ctx) => {
      for (let i = 0; i < PACK_EVENT_PAGE_MAX + 25; i++) {
        await ctx.db.insert("workflowPackEvents", {
          ...base,
          tenantId: String(userA),
          runId: `run-${i}`,
          createdAt: 1_000 + i,
        });
      }
    });
    const asA = t.withIdentity({ subject: `${userA}|session_a` });

    const unbounded = await asA.query(api.workflowPackEventLog.forTenant, { limit: 1_000_000 });
    expect(unbounded).toHaveLength(PACK_EVENT_PAGE_MAX);
    // …and the default, with no limit named at all, is the same ceiling.
    expect(await asA.query(api.workflowPackEventLog.forTenant, {})).toHaveLength(
      PACK_EVENT_PAGE_MAX,
    );
    // …while a limit BELOW the ceiling is still the caller's to choose.
    expect(await asA.query(api.workflowPackEventLog.forTenant, { limit: 3 })).toHaveLength(3);
  });
});
