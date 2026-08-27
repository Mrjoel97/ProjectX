// Phase 29 (29-01 Task 3) — the additive schema boundary, and the ABSENCE it must preserve.
//
// Two jobs:
//  1. Prove the Phase-29 widening is what it claims: tenant-scoped, bounded, and shaped so an
//     unreachable source cannot carry a result count.
//  2. Prove recurrence storage is STRUCTURALLY absent. `schema.ts` L~359 carries a comment
//     promising there is no `routines` table, cron, trigger, recurrence, next-run timestamp,
//     execution-history table, canvas or DSL. Until this file existed, that promise was enforced
//     nowhere — `savedPrompts.test.ts` and `pinnedPrompts.test.ts` scan the MODULE and the UI, and
//     neither has ever read `schema.ts`. A table is the one place recurrence could land without
//     tripping either of them.
//
// The absence test reads the PARSED SCHEMA OBJECT, not the source text, precisely because the
// source text legitimately contains every banned word — inside the comment that bans them.
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SOURCE = readFileSync(new URL("./schema.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// `TableDefinition.indexes` is PRIVATE in convex's types, so this reads through `unknown`. That is
// deliberate and is the point of the file: an index list read off the parsed schema cannot drift
// from what Convex will actually deploy, the way a regex over the source can.
const tables = schema.tables as unknown as Record<
  string,
  { indexes?: { indexDescriptor: string; fields: string[] }[] } | undefined
>;
const tableNames = Object.keys(tables);

/** Index descriptors + fields for one table, read off the parsed schema rather than the source. */
function indexesOf(table: string): { name: string; fields: string[] }[] {
  const t = tables[table];
  expect(t, `${table} must exist in the schema`).toBeDefined();
  return (t?.indexes ?? []).map((i) => ({ name: i.indexDescriptor, fields: i.fields }));
}

/** The declaration text of one table, whitespace-insensitive (the formatter rewraps freely). */
function tableBlock(name: string): string {
  const marker = `\n  ${name}: defineTable(`;
  const start = SOURCE.indexOf(marker);
  expect(start, `${name} table must exist`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + marker.length);
  const next = rest.search(/\n {2}[A-Za-z][A-Za-z0-9]*: defineTable\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const dense = (value: string): string => value.replace(/\s+/g, "").replace(/,\)/g, ")");

// ── The absence that ROUT-02 depends on ────────────────────────────────────────────────────

describe("recurrence storage is structurally absent", () => {
  const RECURRENCE_TABLES = [
    "routines",
    "routineRuns",
    "routineRun",
    "schedules",
    "scheduledRuns",
    "cronJobs",
    "crons",
    "recurrences",
    "standingApprovals",
    "runHistory",
    "executionHistory",
  ];

  test("no table named after a routine, schedule, cron, recurrence or run history exists", () => {
    for (const banned of RECURRENCE_TABLES) {
      expect(tableNames, `schema declares a ${banned} table`).not.toContain(banned);
    }
  });

  test("no table name contains routine/cron/recurr/schedul at all", () => {
    for (const name of tableNames) {
      expect(name, `table ${name} is recurrence-shaped`).not.toMatch(
        /routine|cron|recurr|schedul/i,
      );
    }
  });

  test("NO FIELD ANYWHERE is a next-run, cadence, timezone-rule, scheduler-id or standing approval", () => {
    // Field names are read from the SOURCE's `name: v.` declarations, because the parsed validator
    // tree does not expose object-field names uniformly across `v.object` / `v.union` nesting.
    const declared = new Set(
      [...SOURCE.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*v\./gm)].map((m) => m[1]),
    );
    // THE THREE NAMED EXCEPTIONS. Each is a real, pre-existing, ONE-SHOT field, and each is listed
    // here rather than dropped from the ban so the carve-out is visible instead of implicit —
    // quietly widening a scan until it passes is how an absence test starts lying.
    //   • `optimizerConfig.lastRunAt` — a cooldown anchor on the SINGLE global optimizer-config row,
    //     set by the SkillOpt CI job. No tenant, no next occurrence, nothing that arms itself.
    //   • `plans.scheduledFunctionId` / `pendingTimeouts.scheduledId` — cancellable handles for ONE
    //     deferred send (03.5 SCHD-01) and ONE awaitEvent timeout. A one-shot `runAt` that fires
    //     once and is cancelled is not recurrence; a field that computes the NEXT one is.
    // Everything below has no legitimate one-shot reading: each only makes sense if something
    // repeats. `scheduledId`-shaped names are re-banned per-table on the Phase-29 rows further down.
    const BANNED_FIELDS = [
      "nextRunAt",
      "nextRun",
      "cron",
      "cronExpression",
      "rrule",
      "recurrence",
      "recurrenceRule",
      "cadence",
      "interval",
      "intervalMs",
      "timezone",
      "ianaTimezone",
      "schedulerId",
      "standingApproval",
      "standingApprovalId",
      "autoRun",
      "runCount",
      "missedRuns",
      "catchUp",
      "overlapPolicy",
    ];
    for (const banned of BANNED_FIELDS) {
      expect([...declared], `a schema field is named ${banned}`).not.toContain(banned);
    }
  });

  test("the L359 promise is still written down, so removing it is a visible diff", () => {
    expect(SOURCE).toContain(
      "There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp,",
    );
    expect(SOURCE).toContain("execution-history table, canvas or DSL");
  });

  test("the ONE pre-existing scheduler bookkeeping table is not a recurrence table", () => {
    // `pendingTimeouts` exists and holds a `scheduledId` for ONE awaitEvent timeout. It is named
    // here so this suite cannot be read as claiming the repo has no scheduler at all — it claims
    // there is no RECURRING one, and `pendingTimeouts` has no next-occurrence or repeat field.
    expect(tableNames).toContain("pendingTimeouts");
    // FIELD DECLARATIONS only (`name:v.`). `tableBlock` runs to the next `defineTable`, so it also
    // sweeps up the comment above the NEXT table — and the comment above `exportCursors` says
    // "the WORM export cron". A bare substring scan over that span reports a cron field that does
    // not exist, which is a false alarm and therefore a test that has to be fixed rather than
    // trusted.
    const block = dense(tableBlock("pendingTimeouts"));
    for (const banned of ["nextRunAt", "cron", "rrule", "recurrence", "cadence", "timezone"]) {
      expect(block, `pendingTimeouts gained ${banned}`).not.toContain(`${banned}:v.`);
    }
    // Positive witness: what it actually holds is one workflow's single pending timeout.
    expect(block).toContain("workflowId:v.string()");
    expect(block).toContain("scheduledId:v.string()");
  });

  test("the Phase-29 pin row has no schedule-shaped field", () => {
    const block = tableBlock("savedPrompts");
    // Positive witnesses first: the pin lineage this plan DID add.
    for (const added of ["templateId", "templateVersion", "tenantSkillId", "customizationHash"]) {
      expect(dense(block), `savedPrompts is missing ${added}`).toContain(`${added}:v.optional(`);
    }
    // Then the absence. These are field declarations, so `name: v.` — the comment above the table
    // legitimately names several of them in prose.
    for (const banned of [
      "cadence",
      "timezone",
      "nextRunAt",
      "enabled",
      "scheduledId",
      "runCount",
    ]) {
      expect(dense(block), `savedPrompts gained ${banned}`).not.toContain(`${banned}:v.`);
    }
  });
});

// ── The Phase-29 widening ──────────────────────────────────────────────────────────────────

describe("knowledgeSearches is the tenant-scoped, bounded search content plane", () => {
  test("the table exists with exactly the indexes the coordinator reads", () => {
    expect(tableNames).toContain("knowledgeSearches");
    expect(
      indexesOf("knowledgeSearches")
        .map((i) => i.name)
        .sort(),
    ).toEqual(["by_tenant", "by_tenant_createdAt", "by_thread"]);
  });

  test("EVERY index is tenant-first — there is no cross-tenant read on this table", () => {
    for (const index of indexesOf("knowledgeSearches")) {
      expect(index.fields[0], `${index.name} does not start with tenantId`).toBe("tenantId");
    }
  });

  test("the new tenantSkills and savedPrompts indexes are tenant-first too", () => {
    for (const table of ["tenantSkills", "savedPrompts"]) {
      const added = indexesOf(table).find((i) => i.name === "by_tenant_template");
      expect(added, `${table} is missing by_tenant_template`).toBeDefined();
      expect(added?.fields).toEqual(["tenantId", "templateId"]);
    }
  });

  test("tenantSkills carries pack-template lineage, all optional so no row needs migrating", () => {
    const block = dense(tableBlock("tenantSkills"));
    for (const field of [
      "templateId",
      "templateVersion",
      "customizationValues",
      "customizationHash",
    ]) {
      expect(block, `tenantSkills is missing ${field}`).toContain(`${field}:v.optional(`);
    }
  });
});

describe("an unreachable source cannot carry a result count", () => {
  // This is the KNOW-01 honesty requirement made STRUCTURAL. The `sources` validator is a
  // discriminated union of three object shapes; the `unavailable` arm simply has no `returned`
  // field, so the lie is unspellable rather than merely discouraged.
  const base = {
    tenantId: "t1",
    threadId: "th1",
    runId: "r1",
    question: "what is our rate?",
    summary: "Your standard rate is $40/hour.",
    confidence: "medium" as const,
    claims: [],
    unanswered: [],
    unsupportedCount: 0,
    invalidCitationCount: 0,
    createdAt: 1,
  };

  test("an available source WITH a count inserts", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeSearches", {
        ...base,
        sources: [{ source: "vault", status: "available", returned: 3 }],
      });
    });
    const rows = await t.run((ctx) => ctx.db.query("knowledgeSearches").collect());
    expect(rows).toHaveLength(1);
  });

  test("an UNAVAILABLE source carrying a count is REFUSED by the validator", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          sources: [
            // biome-ignore lint/suspicious/noExplicitAny: the point is that this shape is illegal
            { source: "crm", status: "unavailable", reason: "not_landed", returned: 0 } as any,
          ],
        });
      }),
    ).rejects.toThrow();
  });

  test("an available source WITHOUT a count is refused — silence is not zero", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          // biome-ignore lint/suspicious/noExplicitAny: the point is that this shape is illegal
          sources: [{ source: "vault", status: "available" } as any],
        });
      }),
    ).rejects.toThrow();
  });

  test("an unavailable source with a closed reason inserts, and keeps NO count field", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeSearches", {
        ...base,
        sources: [{ source: "crm", status: "unavailable", reason: "not_landed" }],
      });
    });
    const [row] = await t.run((ctx) => ctx.db.query("knowledgeSearches").collect());
    expect(row?.sources[0]).toEqual({ source: "crm", status: "unavailable", reason: "not_landed" });
    expect(row?.sources[0]).not.toHaveProperty("returned");
  });

  test("a source outside the closed enum is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          // biome-ignore lint/suspicious/noExplicitAny: the point is that this source is illegal
          sources: [{ source: "notion", status: "available", returned: 1 } as any],
        });
      }),
    ).rejects.toThrow();
  });

  test("an unavailable reason outside the closed set is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          // biome-ignore lint/suspicious/noExplicitAny: the point is that this reason is illegal
          sources: [{ source: "gmail", status: "unavailable", reason: "dunno" } as any],
        });
      }),
    ).rejects.toThrow();
  });

  test("a confidence outside the closed label set is refused — no probability may be stored", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          // biome-ignore lint/suspicious/noExplicitAny: the point is that 0.92 is not a label
          confidence: 0.92 as any,
          sources: [],
        });
      }),
    ).rejects.toThrow();
  });

  test("an authority class outside the frozen five is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          sources: [],
          claims: [
            {
              text: "Rate is $40.",
              evidence: [
                {
                  source: "vault",
                  sourceRef: "d1",
                  label: "Rate card",
                  // biome-ignore lint/suspicious/noExplicitAny: the point is that this class is illegal
                  authority: "verified_truth" as any,
                  freshness: "current" as const,
                  retrievedAt: 1,
                },
              ],
              conflictEvidence: [],
            },
          ],
        });
      }),
    ).rejects.toThrow();
  });

  test("a claim with NO conflictEvidence field is REFUSED — the array is required, not optional", async () => {
    // Found by mutation SC-13: the round-trip test below stayed green when `conflictEvidence` was
    // relaxed to `v.optional(v.any())`, because storing a value proves storage, not shape. A claim
    // that may simply omit its disagreement is a claim a synthesizer can quietly flatten, so the
    // requirement is that the field is REQUIRED. An empty array is the honest "nothing disagreed".
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          sources: [],
          claims: [
            {
              text: "Rate is $40.",
              evidence: [
                {
                  source: "vault",
                  sourceRef: "d1",
                  label: "Rate card",
                  authority: "tenant_owned",
                  freshness: "current",
                  retrievedAt: 1,
                },
              ],
              // biome-ignore lint/suspicious/noExplicitAny: the missing field IS the illegal shape
            } as any,
          ],
        });
      }),
    ).rejects.toThrow();
  });

  test("a claim keeps its conflicting evidence — the row can hold disagreement", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeSearches", {
        ...base,
        sources: [{ source: "vault", status: "available", returned: 1 }],
        claims: [
          {
            text: "Our standard rate is $40/hour.",
            evidence: [
              {
                source: "vault",
                sourceRef: "d1",
                label: "Rate card",
                authority: "tenant_owned",
                freshness: "current",
                retrievedAt: 1,
              },
            ],
            conflictEvidence: [{ source: "gmail", sourceRef: "m1", label: "Quote to Acme" }],
            excerpt: "standard rate is $40",
          },
        ],
      });
    });
    const [row] = await t.run((ctx) => ctx.db.query("knowledgeSearches").collect());
    expect(row?.claims[0]?.conflictEvidence).toEqual([
      { source: "gmail", sourceRef: "m1", label: "Quote to Acme" },
    ]);
  });
});

describe("two tenants never see each other's searches", () => {
  test("the tenant index partitions the table", async () => {
    const t = convexTest(schema, modules);
    const base = {
      threadId: "th",
      runId: "r",
      question: "q",
      summary: "s",
      confidence: "low" as const,
      sources: [],
      claims: [],
      unanswered: [],
      unsupportedCount: 0,
      invalidCitationCount: 0,
      createdAt: 1,
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeSearches", { ...base, tenantId: "A" });
      await ctx.db.insert("knowledgeSearches", { ...base, tenantId: "B" });
    });
    const forA = await t.run((ctx) =>
      ctx.db
        .query("knowledgeSearches")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "A"))
        .collect(),
    );
    expect(forA).toHaveLength(1);
    expect(forA[0]?.tenantId).toBe("A");
  });
});
