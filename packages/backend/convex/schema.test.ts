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
import {
  AUTHORITY_CLASSES,
  CONFIDENCE_LABELS,
  FRESHNESS_LABELS,
  KNOWLEDGE_SOURCES,
  MISSING_PACK_SOURCES,
  PARTIAL_REASONS,
  REACHABLE_PACK_SOURCES,
  UNAVAILABLE_REASONS,
} from "@pikar/core";
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
    //
    // WHITESPACE-INSENSITIVE, not line-anchored. The original scan was `/^\s*(name)\s*:\s*v\./gm`,
    // which only matched a declaration that BEGINS a line — so a table written on ONE line escaped
    // it entirely. The audit proved it: injecting
    // `routines: defineTable({ tenantId: v.string(), nextRunAt: v.number() }).index(...)` as a
    // single line left this test GREEN with a live `nextRunAt` in the schema (only the two
    // table-name tests went red). A field declaration is preceded by `{`, `,` or whitespace and by
    // nothing else, so that is what this matches.
    //
    // MUTATION OBSERVED RED: the same one-line `routines` injection now turns THIS test red too.
    const declared = new Set(
      [...SOURCE.matchAll(/[{,\s]([A-Za-z][A-Za-z0-9_]*)\s*:\s*v\./g)].map((m) => m[1]),
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

  test("the field scan can actually SEE the fields it claims to scan", () => {
    // Without this control, a regex that matched nothing would report "no banned field anywhere"
    // forever — which is exactly how the line-anchored version passed over a live `nextRunAt`.
    const declared = new Set(
      [...SOURCE.matchAll(/[{,\s]([A-Za-z][A-Za-z0-9_]*)\s*:\s*v\./g)].map((m) => m[1]),
    );
    for (const real of ["tenantId", "textHash", "templateId", "sourcePreferences", "createdAt"]) {
      expect([...declared], `the field scan cannot see ${real}`).toContain(real);
    }
  });

  test("the Phase-29 pin row has no schedule-shaped field", () => {
    const block = tableBlock("savedPrompts");
    // Positive witnesses first: all FIVE pin-lineage fields this plan added. `sourcePreferences`
    // was missing from this loop until the 29-01 repair — the one added field with zero coverage,
    // and the one the `textHash` fold-list also forgot.
    for (const added of [
      "templateId",
      "templateVersion",
      "tenantSkillId",
      "customizationHash",
      "sourcePreferences",
    ]) {
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

// ── The lineage fields' SHAPE, proved by insert rather than by substring ────────────────────

describe("pin lineage is stored as the shape it claims, not merely as a field name", () => {
  // WHY THESE ARE INSERTS. The only assertion over the nine new optional fields used to be a
  // source-text scan for `${field}:v.optional(`, which matches `v.optional(v.string())`,
  // `v.optional(v.any())` and `v.optional(v.id("tenantSkills"))` IDENTICALLY. The audit relaxed
  // `tenantSkillId` to `v.optional(v.string())` and `templateVersion` to `v.optional(v.string())`
  // and every schema and savedPrompts test stayed green. Storing a value proves storage, not shape
  // — the same defect SC-13 found for `conflictEvidence`, still standing everywhere else.
  //
  // `tenantSkillId` is the load-bearing one: the pin must name the EXACT candidate ROW, because
  // two tenants can hold the same skill name AND version. `v.id("tenantSkills")` is what refuses a
  // `(name, version)` string at insert time.
  const pin = {
    tenantId: "t1",
    text: "run the pulse",
    title: "run the pulse",
    textHash: "h1",
    createdAt: 1,
  };

  const aTenantSkill = async (ctx: {
    db: { insert: (t: "tenantSkills", v: Record<string, unknown>) => Promise<unknown> };
  }) =>
    ctx.db.insert("tenantSkills", {
      tenantId: "t1",
      name: "pack-business-pulse",
      version: 1,
      body: "b",
      authoredBody: "a",
      status: "candidate",
      author: "user",
      basedOnScope: "global",
      basedOnName: "pack-business-pulse",
      basedOnVersion: 1,
      rollbackEligible: false,
      createdAt: 1,
    });

  test("a real tenantSkills row id round-trips, and every lineage value comes back unchanged", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const skillId = await aTenantSkill(ctx as never);
      await ctx.db.insert("savedPrompts", {
        ...pin,
        templateId: "business-pulse",
        templateVersion: 3,
        tenantSkillId: skillId as never,
        customizationHash: "c".repeat(64),
        sourcePreferences: ["vault", "drive"],
      });
    });
    const [row] = await t.run((ctx) => ctx.db.query("savedPrompts").collect());
    expect(row?.templateId).toBe("business-pulse");
    expect(row?.templateVersion).toBe(3);
    expect(row?.customizationHash).toBe("c".repeat(64));
    expect(row?.sourcePreferences).toEqual(["vault", "drive"]);
    // The id came back as a real id, and it resolves to the row it named.
    const skillId = row?.tenantSkillId;
    expect(skillId, "the pin lost its tenantSkills row id").toBeDefined();
    const resolved = await t.run(async (ctx) => (skillId ? await ctx.db.get(skillId) : null));
    expect(resolved?.name).toBe("pack-business-pulse");
  });

  test("tenantSkillId is REFUSED a string that is not a tenantSkills row id", async () => {
    // MUTATION that must turn this RED: `tenantSkillId: v.optional(v.string())`.
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("savedPrompts", {
          ...pin,
          // biome-ignore lint/suspicious/noExplicitAny: a (name, version) string is the illegal shape
          tenantSkillId: "pack-business-pulse@3" as any,
        });
      }),
    ).rejects.toThrow();
  });

  test("tenantSkillId is REFUSED an id belonging to a DIFFERENT table", async () => {
    // A `savedPrompts` id is a well-formed Convex id and still not a candidate row. The validator
    // is table-typed, which is the property `v.optional(v.string())` would have thrown away.
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        const otherId = await ctx.db.insert("savedPrompts", pin);
        await ctx.db.insert("savedPrompts", {
          ...pin,
          textHash: "h2",
          // biome-ignore lint/suspicious/noExplicitAny: an id from the wrong table IS the illegal shape
          tenantSkillId: otherId as any,
        });
      }),
    ).rejects.toThrow();
  });

  test("templateVersion is a NUMBER — a stringified version is refused", async () => {
    // MUTATION: `templateVersion: v.optional(v.string())`. A version that can be either type is a
    // version two comparisons disagree about.
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        // biome-ignore lint/suspicious/noExplicitAny: "3" is the illegal shape
        await ctx.db.insert("savedPrompts", { ...pin, templateVersion: "3" as any });
      }),
    ).rejects.toThrow();
  });

  test("sourcePreferences is an ARRAY of strings, not a comma-joined one", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        // biome-ignore lint/suspicious/noExplicitAny: a joined string is the illegal shape
        await ctx.db.insert("savedPrompts", { ...pin, sourcePreferences: "vault,drive" as any });
      }),
    ).rejects.toThrow();
  });

  test("sourcePreferences refuses a source the product does not have — a WRONG VALUE, not a wrong type", async () => {
    // The test above refuses the wrong TYPE. Nothing refused a wrong VALUE: the field was
    // `v.optional(v.array(v.string()))` under a comment reading "Bounded `PackSource` names", and
    // a convex-test probe stored `["notion","http://evil.example","sharepoint"]` verbatim — the
    // identical hole the same commit had just closed one field over on `claims[].evidence[]`.
    // MUTATION that must turn this RED: `sourcePreferences: v.optional(v.array(v.string()))`.
    const t = convexTest(schema, modules);
    for (const bad of [["notion"], ["http://evil.example"], ["vault", "sharepoint"], ["gmail"]]) {
      await expect(
        t.run(async (ctx) => {
          // biome-ignore lint/suspicious/noExplicitAny: the point is that these values are illegal
          await ctx.db.insert("savedPrompts", { ...pin, sourcePreferences: bad as any });
        }),
        bad.join(","),
      ).rejects.toThrow();
    }
    // …and the WHOLE `PackSource` vocabulary still inserts: this is `PackSource[]`, not
    // `KnowledgeSource[]`, so narrowing it to the five search sources is also a defect.
    await t.run(async (ctx) => {
      await ctx.db.insert("savedPrompts", {
        ...pin,
        sourcePreferences: [...REACHABLE_PACK_SOURCES, ...MISSING_PACK_SOURCES],
      });
    });
  });

  test("a pin with NO lineage still inserts — every field is optional, no row needs migrating", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("savedPrompts", pin);
    });
    const [row] = await t.run((ctx) => ctx.db.query("savedPrompts").collect());
    expect(row?.templateId).toBeUndefined();
    expect(row?.tenantSkillId).toBeUndefined();
  });

  test("tenantSkills lineage round-trips with the same typed guarantees", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantSkills", {
        tenantId: "t1",
        name: "pack-business-pulse",
        version: 1,
        body: "b",
        authoredBody: "a",
        status: "candidate",
        author: "user",
        basedOnScope: "global",
        basedOnName: "pack-business-pulse",
        basedOnVersion: 1,
        rollbackEligible: false,
        createdAt: 1,
        templateId: "business-pulse",
        templateVersion: 3,
        customizationValues: '{"tone":"direct"}',
        customizationHash: "c".repeat(64),
      });
    });
    const [row] = await t.run((ctx) => ctx.db.query("tenantSkills").collect());
    expect(row?.templateVersion).toBe(3);
    // `customizationValues` is the validated form input as JSON — a STRING, so a raw object is
    // refused rather than silently stored as a second, unvalidated shape.
    expect(row?.customizationValues).toBe('{"tone":"direct"}');
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("tenantSkills", {
          tenantId: "t1",
          name: "pack-business-pulse",
          version: 2,
          body: "b",
          authoredBody: "a",
          status: "candidate",
          author: "user",
          basedOnScope: "global",
          basedOnName: "pack-business-pulse",
          basedOnVersion: 1,
          rollbackEligible: false,
          createdAt: 1,
          // biome-ignore lint/suspicious/noExplicitAny: an object is the illegal shape
          customizationValues: { tone: "direct" } as any,
        });
      }),
    ).rejects.toThrow();
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
            {
              source: "crm-facts",
              status: "unavailable",
              reason: "not_landed",
              returned: 0,
              // biome-ignore lint/suspicious/noExplicitAny: the point is that this shape is illegal
            } as any,
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
        sources: [{ source: "crm-facts", status: "unavailable", reason: "not_landed" }],
      });
    });
    const [row] = await t.run((ctx) => ctx.db.query("knowledgeSearches").collect());
    expect(row?.sources[0]).toEqual({
      source: "crm-facts",
      status: "unavailable",
      reason: "not_landed",
    });
    expect(row?.sources[0]).not.toHaveProperty("returned");
  });

  test("a source outside the closed enum is refused on the COVERAGE plane", async () => {
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

  test("a CITATION naming a source the product does not have is refused too", async () => {
    // The closed union used to be applied on the coverage plane ONLY: `claims[].evidence[].source`
    // and `claims[].conflictEvidence[].source` were bare `v.string()`. The audit inserted a row
    // whose citation source was `"notion"` and whose conflict source was `"http://evil.example"`
    // and it stored and read back cleanly — a RENDERED citation naming a source that does not
    // exist, which is the exact lie this table's comment says it makes unspellable.
    //
    // MUTATION that must turn this RED: relax either `source:` back to `v.string()`.
    const t = convexTest(schema, modules);
    for (const bad of ["notion", "http://evil.example", "gmail", ""]) {
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
                    // biome-ignore lint/suspicious/noExplicitAny: the point is that this source is illegal
                    source: bad as any,
                    sourceRef: "d1",
                    label: "Rate card",
                    authority: "tenant_owned" as const,
                    freshness: "current" as const,
                    retrievedAt: 1,
                  },
                ],
                conflictEvidence: [],
              },
            ],
          });
        }),
        `evidence source "${bad}" was accepted`,
      ).rejects.toThrow();
    }
  });

  test("a CONFLICTING citation is held to the same closed vocabulary", async () => {
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
                  source: "vault" as const,
                  sourceRef: "d1",
                  label: "Rate card",
                  authority: "tenant_owned" as const,
                  freshness: "current" as const,
                  retrievedAt: 1,
                },
              ],
              conflictEvidence: [
                {
                  // biome-ignore lint/suspicious/noExplicitAny: the point is that this source is illegal
                  source: "http://evil.example" as any,
                  sourceRef: "x",
                  label: "",
                },
              ],
            },
          ],
        });
      }),
    ).rejects.toThrow();
  });

  test("the coverage plane and the citation plane speak the SAME closed vocabulary", () => {
    // Two planes on one row that disagree about what a source is called is how `gmail` ends up
    // beside `inbox`. `knowledgeSource` is now literally the same const in all three positions.
    const block = dense(tableBlock("knowledgeSearches"));
    // FIVE uses: the three arms of the `sources[]` discriminated union, plus `evidence[]` and
    // `conflictEvidence[]` — the last two were bare `v.string()` before the 29-01 repair.
    expect(block.split("source:knowledgeSource").length - 1).toBe(5);
    expect(block, "a source field is still a bare string").not.toContain("source:v.string()");
  });

  test("an unavailable reason outside the closed set is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("knowledgeSearches", {
          ...base,
          // biome-ignore lint/suspicious/noExplicitAny: the point is that this reason is illegal
          sources: [{ source: "inbox", status: "unavailable", reason: "dunno" } as any],
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
            conflictEvidence: [{ source: "inbox", sourceRef: "m1", label: "Quote to Acme" }],
            excerpt: "standard rate is $40",
          },
        ],
      });
    });
    const [row] = await t.run((ctx) => ctx.db.query("knowledgeSearches").collect());
    expect(row?.claims[0]?.conflictEvidence).toEqual([
      { source: "inbox", sourceRef: "m1", label: "Quote to Acme" },
    ]);
  });
});

// ── The core -> storage seam: every state `@pikar/core` can CONSTRUCT must be STORABLE ─────

describe("the Convex enums are the @pikar/core enums, proved by storing every member", () => {
  // WHY THIS EXISTS. The Phase-29 unions were first hand-copied into `schema.ts`, and three
  // separate narrowings of them each left the whole backend suite AND the typecheck green:
  // dropping `support-desk` from the source union, `unplanned` from the unavailable reasons, and
  // `agent_authored` from the authority classes. Nothing crossed the package boundary — this file
  // imported nothing from `@pikar/core`. The cost is the honest-gap row the phase exists to
  // produce: core can construct `{status:"unavailable", reason:"not_landed",
  // source:"support-desk"}` and the validator would refuse it at INSERT time, at runtime, with
  // nothing red in CI.
  //
  // `schema.ts` now DERIVES each union from the core constant, so there is one list rather than
  // two. These inserts are what makes that derivation falsifiable: hand-write any of these unions
  // back into `schema.ts` minus a member and the matching loop below goes red.
  const base = {
    tenantId: "t1",
    threadId: "th1",
    runId: "r1",
    question: "q",
    summary: "s",
    confidence: "medium" as const,
    sources: [],
    claims: [],
    unanswered: [],
    unsupportedCount: 0,
    invalidCitationCount: 0,
    createdAt: 1,
  };
  const citation = (over: Record<string, unknown>) => ({
    source: "vault" as const,
    sourceRef: "d1",
    label: "Rate card",
    authority: "tenant_owned" as const,
    freshness: "current" as const,
    retrievedAt: 1,
    ...over,
  });
  const insert = (row: Record<string, unknown>) => {
    const t = convexTest(schema, modules);
    // biome-ignore lint/suspicious/noExplicitAny: the row is built from core constants, not literals
    return t.run(async (ctx) => ctx.db.insert("knowledgeSearches", { ...base, ...row } as any));
  };

  test("every KNOWLEDGE_SOURCE stores on the coverage plane AND as a citation", async () => {
    for (const source of KNOWLEDGE_SOURCES) {
      await insert({ sources: [{ source, status: "available", returned: 1 }] });
      await insert({
        claims: [{ text: "c", evidence: [citation({ source })], conflictEvidence: [] }],
      });
    }
    expect(KNOWLEDGE_SOURCES).toHaveLength(5);
  });

  test("every UNAVAILABLE_REASON and PARTIAL_REASON stores", async () => {
    for (const reason of UNAVAILABLE_REASONS) {
      await insert({ sources: [{ source: "crm-facts", status: "unavailable", reason }] });
    }
    for (const reason of PARTIAL_REASONS) {
      await insert({ sources: [{ source: "drive", status: "partial", returned: 2, reason }] });
    }
    expect([UNAVAILABLE_REASONS.length, PARTIAL_REASONS.length]).toEqual([6, 2]);
  });

  test("every AUTHORITY_CLASS and FRESHNESS_LABEL stores on a citation", async () => {
    for (const authority of AUTHORITY_CLASSES) {
      await insert({
        claims: [{ text: "c", evidence: [citation({ authority })], conflictEvidence: [] }],
      });
    }
    for (const freshness of FRESHNESS_LABELS) {
      await insert({
        claims: [{ text: "c", evidence: [citation({ freshness })], conflictEvidence: [] }],
      });
    }
    expect([AUTHORITY_CLASSES.length, FRESHNESS_LABELS.length]).toEqual([5, 4]);
  });

  test("every CONFIDENCE_LABEL stores, and none of them is a number", async () => {
    for (const confidence of CONFIDENCE_LABELS) await insert({ confidence });
    for (const notALabel of [0.9, "0.9", "certain"]) {
      await expect(insert({ confidence: notALabel }), String(notALabel)).rejects.toThrow();
    }
  });

  test("the schema restates NO Phase-29 enum member as a hand-written literal", () => {
    // The derivation is the control; this is the tripwire that keeps it. A `v.literal("vault")`
    // reappearing inside `knowledgeSearches` is the fork coming back, and the loops above would
    // still pass as long as the hand-written copy happened to be complete on the day it landed.
    const block = dense(tableBlock("knowledgeSearches"));
    for (const member of [
      ...KNOWLEDGE_SOURCES,
      ...UNAVAILABLE_REASONS,
      ...AUTHORITY_CLASSES,
      ...FRESHNESS_LABELS,
      ...CONFIDENCE_LABELS,
    ]) {
      expect(block, `${member} is hand-written here instead of derived`).not.toContain(
        `v.literal("${member}")`,
      );
    }
    // …and the three status discriminants ARE still hand-written, deliberately: they are the
    // discriminated union's tags, one per arm, not a member of any core list.
    for (const status of ["available", "partial", "unavailable"]) {
      expect(block).toContain(`v.literal("${status}")`);
    }
  });
});

// ── The header index is a map the next reader trusts ───────────────────────────────────────

describe("the schema header index is not decorative prose", () => {
  const header = SOURCE.slice(
    SOURCE.indexOf("SCHEMA TABLE INDEX"),
    SOURCE.indexOf("\n/**", SOURCE.indexOf("SCHEMA TABLE INDEX")),
  );

  // The header indexes the tables DECLARED IN THIS FILE. `tableNames` also contains the six
  // `authTables` spread in from `@convex-dev/auth`, which the header has never claimed to list.
  const declaredHere = [...SOURCE.matchAll(/\n {2}([A-Za-z][A-Za-z0-9]*): defineTable\(/g)].map(
    (m) => m[1] as string,
  );

  test("the header block and the table scan are both real, so the two tests below are not vacuous", () => {
    expect(header.length).toBeGreaterThan(500);
    expect(header).toContain("grouped by domain");
    expect(declaredHere.length).toBeGreaterThan(40);
    // The regex is tied to the PARSED schema: a name it finds that Convex does not have would mean
    // the scan is reading something other than table declarations.
    for (const name of declaredHere)
      expect(tableNames, `${name} is not a real table`).toContain(name);
  });

  test("the STATED count is the real number of tables declared here", () => {
    // `tenantData.test.ts:23` counts `defineTable` matches in this source and NEVER reads the
    // header, so the number the first 29-01 repair corrected 46 -> 47 was protected by nothing:
    // changing it back to "46 tables" left every suite green.
    const stated = header.match(/SCHEMA TABLE INDEX — (\d+) tables/);
    expect(stated?.[1], "the header no longer states a table count").toBeDefined();
    expect(Number(stated?.[1])).toBe(declaredHere.length);
  });

  test("every table is NAMED in the index — the list disagreed with its own headline by one", () => {
    // `workflowPackEvents` (landed 27-02) appeared nowhere in the index, so the list enumerated 46
    // names under a "47 tables" headline. A map that silently omits a table sends the next reader
    // to grep, which is the thing the index exists to save.
    const missing = declaredHere.filter((name) => !new RegExp(`\\b${name}\\b`).test(header));
    expect(missing, "tables absent from the header index").toEqual([]);
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
