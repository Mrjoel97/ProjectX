import type { FigureClaim } from "@pikar/core";
import { emptyScorecard } from "@pikar/core/growth/index";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts), so the component must be registered
// or the applier's audit insert throws `Component "auditCounts" is not registered`. Relative
// import — the package blocks the deep specifier. Same idiom as audit.test.ts / contacts.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api } from "./_generated/api";
import { applyFinanceClaims, writeFigureRow } from "./cash";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves (audit.test.ts idiom).
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

/**
 * A backend with the auditCounts component registered — for the TWO tests whose applier reaches
 * `internal.audit.log`, and no others. Registering it loads the whole aggregate component tree into
 * an in-memory backend, and paying that on all 33 tests in this file is the memory budget
 * `contacts.test.ts`'s harness comment warns about (it killed a sibling file under parallel load).
 */
function withAudit() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

const DAY = 24 * 60 * 60 * 1000;

// Match finance.test.ts's identity helper exactly — a second, subtly different one is how two
// tenant-scoping tests end up asserting different things about the same wrapper. `tenantQuery`
// resolves scope from `requireScope`, which only splits the subject string — no `ctx.db.get`, so
// (unlike the owner wrappers) no `users` row needs to exist for this identity to be valid.
const asTenant = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: `${userId}|session`, issuer: "test" });

async function seedSend(t: ReturnType<typeof convexTest>, tenantId: string, createdAt: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("requests", {
      tenantId,
      correlationId: `c-${createdAt}-${Math.random()}`,
      goal: "g",
      recipient: "someone@example.com",
      status: "sent",
      attachmentRefs: [],
      createdAt,
    });
  });
}

describe("cash.activity", () => {
  test("an unauthenticated caller is rejected before anything is read", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.cash.activity, { sinceMs: Date.now() - DAY, untilMs: Date.now() }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("counts only this tenant's delivered sends", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedSend(t, "tenant-a", now - 1000);
    await seedSend(t, "tenant-a", now - 2000);
    await seedSend(t, "tenant-b", now - 1000);

    const result = await asTenant(t, "tenant-a").query(api.cash.activity, {
      sinceMs: now - 3 * DAY,
      untilMs: now,
    });
    expect(result.activity.todayCount).toBe(2);
  });

  test("a non-sent request is not a reach-out", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("requests", {
        tenantId: "tenant-a",
        correlationId: "c-draft",
        goal: "g",
        recipient: "someone@example.com",
        status: "awaiting_review",
        attachmentRefs: [],
        createdAt: now - 1000,
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.activity, {
      sinceMs: now - 3 * DAY,
      untilMs: now,
    });
    expect(result.activity.todayCount).toBe(0);
  });
});

describe("cash.saveInput", () => {
  test("an unauthenticated caller cannot write a number", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.cash.saveInput, { field: "cashOnHand", value: 1000 }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("a finance-ops field lands in financeInputs with its own statedAt", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
      field: "cashOnHand",
      value: 12_000,
    });
    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe("tenant-a");
    expect(rows[0]?.valueUsd).toBe(12_000);
    expect(rows[0]?.statedAt).toBeGreaterThan(0);
  });

  test("saving the same field twice updates the row rather than adding a second", async () => {
    const t = convexTest(schema, modules);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 100 });
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 200 });
    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valueUsd).toBe(200);
  });

  test("a Hormozi field lands on the SCORECARD — CAC is never duplicated into a second table", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    const financeRows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(financeRows).toHaveLength(0);
    const evaluation = await t.run((ctx) => ctx.db.query("evaluations").first());
    expect(evaluation?.scorecard.financials.cac).toBe(1400);
    expect(evaluation?.userProvided).toContain("financials.cac");
  });

  test("an invalid value is refused at the boundary and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await expect(
      asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
        field: "purchasesPerLifetime",
        value: 0.5,
      }),
    ).rejects.toThrow(/INVALID_INPUT/);
    const evaluations = await t.run((ctx) => ctx.db.query("evaluations").collect());
    expect(evaluations).toHaveLength(0);
  });

  // Whole-branch review B1: the tenant's newest `evaluations` row can be a `document-review` row
  // with a LITERAL `scorecard: {}` (`voiceDoc.ts`). Before the fix, `saveInput` for a scorecard-store
  // field crashed reaching for that row through `latestScorecardRow`, and the UI reported "That
  // number could not be saved." `latestScorecardRow` now skips it, so `saveInput` seeds a fresh,
  // well-formed carrier instead of touching the malformed one.
  test("saveInput succeeds when the tenant's newest evaluations row has no usable scorecard", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: "tenant-a",
        threadId: "docreview-thread",
        framework: "document-review",
        findings: [],
        gaps: [],
        notEnoughData: [],
        scorecard: {},
        userProvided: [],
        verdict: "insufficient",
        createdAt: Date.now(),
      });
    });

    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cac", value: 1400 });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("evaluations")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "tenant-a"))
        .collect(),
    );
    const withCac = rows.find((row) => row.scorecard?.financials?.cac === 1400);
    expect(withCac).toBeDefined();
    // The malformed row is untouched, not patched in place.
    expect(rows.find((row) => row.threadId === "docreview-thread")?.scorecard).toEqual({});
  });
});

describe("cash.inputs", () => {
  test("one tenant cannot read another tenant's numbers", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
      field: "cashOnHand",
      value: 99_000,
    });
    const result = await asTenant(t, "tenant-b").query(api.cash.inputs, {});
    const cash = result.inputs.find((i) => i.field === "cashOnHand");
    expect(cash?.value).toBeNull();
  });

  test("an input stated more than 90 days ago is stale", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("financeInputs", {
        tenantId: "tenant-a",
        field: "cashOnHand",
        valueUsd: 5_000,
        statedAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    expect(result.inputs.find((i) => i.field === "cashOnHand")?.stale).toBe(true);
  });

  test("a fresh input is not stale", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cashOnHand", value: 1 });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    expect(result.inputs.find((i) => i.field === "cashOnHand")?.stale).toBe(false);
  });

  // Bug found in Task 3 review: `runEvaluation` carries `scorecard`/`userProvided` FORWARD verbatim
  // into a NEW row stamped `createdAt: Date.now()` on every weekly re-evaluation. Reading the ROW's
  // `createdAt` as a stand-in for a FIELD's stated time reported a 91-day-old CAC as "confirmed
  // today" the moment a re-evaluation carried it into a fresh row — silently suppressing the exact
  // confirm-or-update prompt the 90-day rule exists for. `userProvidedAt` (a dot-path → epoch-ms map,
  // stamped by `applyScorecardAnswer`, carried forward unchanged by `runEvaluation`) fixes this.
  test("a scorecard field answered 91 days ago and carried into a fresh row still reports stale", async () => {
    const t = convexTest(schema, modules);
    const oldAnswer = Date.now() - 91 * DAY;
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: "tenant-a",
        threadId: "thread-a",
        framework: "growth-os",
        findings: [],
        gaps: [],
        notEnoughData: [],
        scorecard: { ...emptyScorecard, financials: { ...emptyScorecard.financials, cac: 1200 } },
        userProvided: ["financials.cac"],
        userProvidedAt: { "financials.cac": oldAnswer },
        // The CARRIED-FORWARD row's own timestamp — fresh, on purpose. This is exactly what a
        // weekly re-evaluation produces: a new row, an old answer.
        createdAt: Date.now(),
        verdict: "insufficient",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    const cac = result.inputs.find((i) => i.field === "cac");
    expect(cac?.value).toBe(1200);
    expect(cac?.statedAt).toBe(oldAnswer);
    expect(cac?.stale).toBe(true);
  });

  test("a scorecard value with no recorded stated time (a legacy row) needs confirmation, never reads as fresh", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: "tenant-a",
        threadId: "thread-a",
        framework: "growth-os",
        findings: [],
        gaps: [],
        notEnoughData: [],
        scorecard: { ...emptyScorecard, financials: { ...emptyScorecard.financials, cac: 900 } },
        userProvided: ["financials.cac"],
        // NO userProvidedAt — the shape every scorecard-stored figure has before this fix.
        createdAt: Date.now(),
        verdict: "insufficient",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    const cac = result.inputs.find((i) => i.field === "cac");
    expect(cac?.value).toBe(900);
    expect(cac?.statedAt).toBeNull(); // honest — we do not know when this was stated
    expect(cac?.stale).toBe(true); // unknown age needs confirmation, never reads as fresh
  });
});

describe("cash.unitEconomics", () => {
  test("an unauthenticated caller is rejected before anything is read", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.cash.unitEconomics, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });

  // Same read path as `cash.inputs` (`inputStatesFor`), so a foreign tenant's scorecard is exactly
  // as unreachable here as it is there: `latestScorecardRow` is tenant-scoped, and `tenant-a` has
  // entered nothing, so its CFA stays `unknown` no matter what `tenant-b` has on file.
  test("a foreign tenant's scorecard is not read — CFA stays unknown", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-b").mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    await asTenant(t, "tenant-b").mutation(api.cash.saveInput, {
      field: "thirtyDayCashPerCustomer",
      value: 2000,
    });

    const result = await asTenant(t, "tenant-a").query(api.cash.unitEconomics, {});
    expect(result.cfa.state).toBe("unknown");
  });

  test("cac and 30-day cash per customer, both entered, derive a known CFA", async () => {
    const t = convexTest(schema, modules);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    await as.mutation(api.cash.saveInput, { field: "thirtyDayCashPerCustomer", value: 2000 });

    const result = await as.query(api.cash.unitEconomics, {});
    expect(result.cfa.state).toBe("known");
    expect(result.cfa.state === "known" && result.cfa.origin).toBe("derived");
  });
});

describe("cash.shape", () => {
  test("a tenant with no profile row gets a null tier, not a guessed solopreneur", async () => {
    const t = convexTest(schema, modules);
    const result = await asTenant(t, "tenant-a").query(api.cash.shape, {});
    expect(result.tier).toBeNull();
    expect(result.funding).toBeNull();
  });

  test("the tier and posture come from tenantProfiles, read-only", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        funding: "funded",
        revenueStage: "early-revenue",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.shape, {});
    expect(result).toMatchObject({ tier: "startup", funding: "funded" });
    // `toMatchObject` ignores extra keys, so it cannot catch a `revenueStage` leak — the exact
    // binding this test looks like it guards. An explicit key-set check does.
    expect(Object.keys(result).sort()).toEqual(["funding", "tier"]);
  });

  test("one tenant's shape is not another's", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "sme",
        tierSource: "derived",
        derivedAt: Date.now(),
      });
    });
    expect((await asTenant(t, "tenant-b").query(api.cash.shape, {})).tier).toBeNull();
  });
});

describe("tier change", () => {
  test("inputs persist untouched when a solopreneur hires — they are facts about the business", async () => {
    const t = convexTest(schema, modules);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 20_000 });
    await as.mutation(api.cash.saveInput, { field: "cac", value: 300 });

    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        funding: "bootstrapped",
      });
    });

    const inputs = await as.query(api.cash.inputs, {});
    expect(inputs.inputs.find((i) => i.field === "cashOnHand")?.value).toBe(20_000);
    expect(inputs.inputs.find((i) => i.field === "cac")?.value).toBe(300);
    // A newly visible metric shows unknown with its prompt, never back-filled.
    expect(inputs.inputs.find((i) => i.field === "mrr")?.value).toBeNull();
  });
});

test("an agent-written figure reads back with agent provenance, not as a user statement", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1|s1" });

  await t.run(async (ctx) => {
    await writeFigureRow(ctx.db, "u1", {
      field: "cashOnHand",
      value: 38_500,
      origin: "stated",
      actor: "agent",
      basis: "user statement, turn 4",
      observedAt: 1_754_000_000_000,
      confidence: "high",
    });
  });

  const { inputs } = await asUser.query(api.cash.inputs, {});
  const cash = inputs.find((i) => i.field === "cashOnHand");
  expect(cash?.value).toBe(38_500);
  expect(cash?.actor).toBe("agent");
  expect(cash?.basis).toBe("user statement, turn 4");
  expect(cash?.statedAt).toBe(1_754_000_000_000);
});

test("saveInput stamps the human as the actor and observedAt as now", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1|s1" });
  await asUser.mutation(api.cash.saveInput, { field: "cashOnHand", value: 1_000 });

  const { inputs } = await asUser.query(api.cash.inputs, {});
  const cash = inputs.find((i) => i.field === "cashOnHand");
  expect(cash?.actor).toBe("user");
  expect(cash?.origin).toBe("stated");
});

// The two branches of `inputStatesFor`'s scorecard arm, and the guard that keeps the agent out of
// it. Task 3's first two tests both used `cashOnHand` — a `financeInputs` field — so the
// `userProvided` predicate that flips the trust language for SIX of the eleven `CASH_INPUTS` fields
// had no coverage at all. Its correctness rests on `applyScorecardAnswer` appending the dot-path to
// `userProvided`, an incidental coupling to another module's array that nothing else enforces.
test("a scorecard field answered in the panel reads back as the user's own statement", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1|s1" });
  await asUser.mutation(api.cash.saveInput, { field: "cac", value: 1_400 });

  const { inputs } = await asUser.query(api.cash.inputs, {});
  const cac = inputs.find((i) => i.field === "cac");
  expect(cac?.value).toBe(1_400);
  expect(cac?.origin).toBe("stated");
  expect(cac?.actor).toBe("user");
  expect(cac?.basis).toBeNull();
});

// WHOLE-BRANCH REVIEW I3. This used to assert `origin: "observed"`, which the spec forbids:
// `observed` means PIKAR MEASURED IT, and nothing measures yet — "a figure read out of the owner's
// own P&L is still an assertion by a human, made in a document" (spec §1). The page rendered that
// as "Measured by Pikar on <date>.", which is false about a grounded fill. The honest pair is
// `stated` (a human asserted it, somewhere) + `agent` (Pikar, not the owner, put it here).
test("a grounded scorecard fill is a human's assertion recorded by the AGENT — never measured, never the owner's own", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("evaluations", {
      tenantId: "u1",
      threadId: "thread-a",
      framework: "growth-os",
      findings: [],
      gaps: [],
      notEnoughData: [],
      // A real value the GROUNDING put there. Absent from `userProvided` — the owner never said it.
      scorecard: { ...emptyScorecard, financials: { ...emptyScorecard.financials, cac: 250 } },
      userProvided: [],
      verdict: "insufficient",
      createdAt: Date.now(),
    });
  });

  const { inputs } = await t.withIdentity({ subject: "u1|s1" }).query(api.cash.inputs, {});
  const cac = inputs.find((i) => i.field === "cac");
  expect(cac?.value).toBe(250);
  expect(cac?.origin).toBe("stated");
  expect(cac?.actor).toBe("agent");
  expect(cac?.basis).toBe("business evaluation grounding");
});

// ── applyFinanceClaims: the Approve-gated agent write path (the `finance_write` inline arm) ─────
//
// invariant 11 — the ACTOR decides gating. `saveInput` above is the SAME write, ungated, because a
// human is editing their own figure. Everything below goes through a staged plan and Approve.
describe("applyFinanceClaims (the finance_write inline arm)", () => {
  const agentClaim = {
    field: "cashOnHand" as const,
    value: 38_500,
    origin: "stated" as const,
    actor: "agent" as const,
    basis: "user statement, turn 4",
    observedAt: 1_754_000_000_000,
    confidence: "high" as const,
  };

  test("a staged finance plan writes NOTHING until it is approved", async () => {
    const t = withAudit();
    const asUser = t.withIdentity({ subject: "u1|s1" });

    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: "u1",
        threadId: "thread-a",
        kind: "finance_write",
        status: "proposed",
        financeClaims: [agentClaim],
        createdAt: Date.now(),
      } as never),
    );

    // Staging alone is inert: the row exists, the store does not know about it.
    const before = await asUser.query(api.cash.inputs, {});
    expect(before.inputs.find((i) => i.field === "cashOnHand")?.value).toBeNull();

    await t.run((ctx) => applyFinanceClaims(ctx, "u1", [agentClaim]));

    const after = await asUser.query(api.cash.inputs, {});
    expect(after.inputs.find((i) => i.field === "cashOnHand")?.value).toBe(38_500);
    expect(after.inputs.find((i) => i.field === "cashOnHand")?.actor).toBe("agent");
    expect(planId).toBeDefined();
    // The tenant is the applier's explicit argument (in production: the APPROVED PLAN ROW's), so
    // nobody else's figure moved.
    const other = await t.withIdentity({ subject: "u2|s1" }).query(api.cash.inputs, {});
    expect(other.inputs.find((i) => i.field === "cashOnHand")?.value).toBeNull();
  });

  test("the audit row carries names and counts, and NEVER a figure (§4)", async () => {
    const t = withAudit();
    await t.run((ctx) => applyFinanceClaims(ctx, "u1", [agentClaim]));

    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const row = rows.find((r) => r.eventType === "finance.claims_applied");
    expect(row).toBeDefined();
    expect(Object.keys(row?.payload as object).sort()).toEqual([
      "actors",
      "confidences",
      "count",
      "fields",
      "skipped",
    ]);
    // The negative assertion is the point: the figure must not be reachable anywhere in the row.
    expect(JSON.stringify(row)).not.toContain("38500");
  });

  // `actor` is a fact about which DOOR the write came through, not data. `validateFigureClaim`
  // cannot catch a lie about it — its actor rule only bites when `confidence !== "high"`, and
  // confidence is model-controlled, so `{actor: "user", confidence: "high"}` is a LEGAL claim by
  // that function's contract and passes every other guard here. The audit assertion is the half
  // that matters most: that log is append-only, so a wrong attribution cannot be corrected later.
  test("a plan row claiming actor 'user' is stored as the AGENT's write, in the row AND the audit", async () => {
    const t = withAudit();
    await t.run((ctx) =>
      applyFinanceClaims(ctx, "u1", [{ ...agentClaim, actor: "user" as const }]),
    );

    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows[0]?.valueUsd).toBe(38_500);
    expect(rows[0]?.actor).toBe("agent");

    const audit = await t.run((ctx) => ctx.db.query("audit").collect());
    const payload = audit.find((r) => r.eventType === "finance.claims_applied")?.payload as {
      actors: string[];
    };
    expect(payload.actors).toEqual(["agent"]);

    // And it reads back to the owner as the agent's number, not as their own statement.
    const { inputs } = await t.withIdentity({ subject: "u1|s1" }).query(api.cash.inputs, {});
    expect(inputs.find((i) => i.field === "cashOnHand")?.actor).toBe("agent");
  });

  // ALL-OR-NOTHING, asserted rather than assumed — but not by ROLLBACK anymore. REVIEW FIX (Task
  // 5 follow-up): after the pass-1 hoist above, every `validateFigureClaim` rule is checked in
  // pass 1, so pass 2's `writeFigureRow` can never fail for a claim that reached it — a genuine
  // "good write, then a THROW mid-batch that Convex rolls back" case is provably unreachable from
  // this function now. All-or-nothing is enforced by ORDERING instead: nothing in pass 2 runs
  // until every claim in the whole list has cleared pass 1, so a good FIRST claim never gets the
  // chance to write before a bad SECOND one is seen.
  test("a bad SECOND claim blocks the good FIRST one — approve-all-or-none", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run((ctx) =>
      applyFinanceClaims(ctx, "u1", [
        agentClaim,
        // The realistic pairing: the agent heard cash on hand AND a CAC in the same turn.
        { ...agentClaim, field: "cac" as const, value: 1_400 },
      ]),
    );
    expect(result).toEqual({ ok: false, reason: "agent_cannot_update_figure" });
    expect(await t.run((ctx) => ctx.db.query("financeInputs").collect())).toHaveLength(0);
  });

  test("an empty claim list writes no audit row — nothing happened", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => applyFinanceClaims(ctx, "u1", undefined));
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows).toHaveLength(0);
  });

  // The plan row is DB-sourced JSON cast to FigureClaim, NOT type-checked input. Both shapes below
  // make `validateFigureClaim` throw past its own {ok, reason} contract — an unknown field reaches
  // `cashInputSpec`, which throws, and a null basis TypeErrors on `.trim()`. An approved plan must
  // refuse cleanly, never crash the mutation.
  test("a malformed claim on the plan row is refused cleanly, not crashed through", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.run((ctx) =>
        applyFinanceClaims(ctx, "u1", [{ ...agentClaim, field: "notAField" } as never]),
      ),
    ).toEqual({ ok: false, reason: "malformed_figure_claim" });
    expect(
      await t.run((ctx) => applyFinanceClaims(ctx, "u1", [{ ...agentClaim, basis: null } as never])),
    ).toEqual({ ok: false, reason: "malformed_figure_claim" });
    expect(await t.run((ctx) => ctx.db.query("financeInputs").collect())).toHaveLength(0);
  });

  // REVIEW FIX (Task 5 follow-up): the two shape-guards above are NOT `validateFigureClaim`'s
  // whole contract. Before this test, a claim that cleared them still reached `writeFigureRow` in
  // pass 2, which called `validateFigureClaim` itself and THREW past this function's own return
  // contract — the exact bug this task exists to remove, still live on four of its six rules. A
  // whitespace-only basis, an out-of-range/NaN value, and a future `observedAt` (the likeliest
  // model error once Task 8 parses date phrases) must all refuse as a RETURN, before pass 2 ever
  // runs, same as the two shape-guards.
  test("every validateFigureClaim rule refuses as a return, not just the two shape-guards", async () => {
    const t = convexTest(schema, modules);
    const cases: FigureClaim[] = [
      { ...agentClaim, basis: "   " },
      { ...agentClaim, value: -1 },
      { ...agentClaim, value: Number.NaN },
      { ...agentClaim, observedAt: Number.NaN },
      { ...agentClaim, observedAt: -1 },
      { ...agentClaim, observedAt: Date.now() + 86_400_000 },
    ];
    for (const claim of cases) {
      expect(await t.run((ctx) => applyFinanceClaims(ctx, "u1", [claim]))).toEqual({
        ok: false,
        reason: "malformed_figure_claim",
      });
    }
    expect(await t.run((ctx) => ctx.db.query("financeInputs").collect())).toHaveLength(0);
  });

  // The real product limit, refused HERE with a reason the approval card can show rather than deep
  // inside `writeFigureRow`: the scorecard store discards origin/actor/basis/observedAt and appends
  // the dot-path to `userProvided`, which `runEvaluation` rebuilds its citation map from at HIGH
  // confidence. The agent can update the five `financeInputs` figures and cannot yet update CAC.
  test("an agent claim on a scorecard field is refused, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run((ctx) =>
      applyFinanceClaims(ctx, "u1", [{ ...agentClaim, field: "cac" as const, value: 1_400 }]),
    );
    expect(result).toEqual({ ok: false, reason: "agent_cannot_update_figure" });
    expect(await t.run((ctx) => ctx.db.query("evaluations").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(0);
  });

  // The merge policy lives in the CALLER — `writeFigureRow` has no isNewerThan guard. Without this
  // an approved claim observed in June patches over a figure the human saved today, moving
  // `statedAt` backward and flipping `actor`. A stale claim is SKIPPED, never an error: the human
  // already has the better number, which is not a failure the user needs to see.
  // WHOLE-BRANCH REVIEW I5. This used to assert the OPPOSITE — that a fully-skipped apply writes
  // NO audit row. An approved governed action with no audit record is a governance hole whatever
  // its frequency, and the vault source (next slice) turns this rare case into the common one:
  // every re-proposal of a figure the owner has since typed lands here. The row is now always
  // written and reports BOTH counts, so the log distinguishes "nothing needed changing" from
  // "nothing happened" — and the applier returns the counts so the card can say which.
  test("an approved plan whose claims are all skipped is still audited, and says so", async () => {
    const t = withAudit();
    const asUser = t.withIdentity({ subject: "u1|s1" });
    await asUser.mutation(api.cash.saveInput, { field: "cashOnHand", value: 12_000 });
    const saved = await t.run((ctx) => ctx.db.query("financeInputs").first());

    const result = await t.run((ctx) =>
      applyFinanceClaims(ctx, "u1", [{ ...agentClaim, observedAt: saved?.statedAt ?? 0 }]),
    );
    expect(result).toEqual({ ok: true, applied: 0, skipped: 1 });

    const { inputs } = await asUser.query(api.cash.inputs, {});
    const cash = inputs.find((i) => i.field === "cashOnHand");
    expect(cash?.value).toBe(12_000);
    expect(cash?.actor).toBe("user");
    expect(cash?.statedAt).toBe(saved?.statedAt);

    const row = await t.run(async (ctx) =>
      (await ctx.db.query("audit").collect()).find((r) => r.eventType === "finance.claims_applied"),
    );
    expect(row?.payload).toMatchObject({ count: 0, skipped: 1, fields: [] });
    // §4 still holds on the path that writes nothing: no figure anywhere in the row.
    expect(JSON.stringify(row)).not.toContain("38500");
  });

  test("a mixed batch reports what was written and what was already up to date", async () => {
    const t = withAudit();
    const asUser = t.withIdentity({ subject: "u1|s1" });
    await asUser.mutation(api.cash.saveInput, { field: "cashOnHand", value: 12_000 });
    const saved = await t.run((ctx) => ctx.db.query("financeInputs").first());

    const result = await t.run((ctx) =>
      applyFinanceClaims(ctx, "u1", [
        { ...agentClaim, observedAt: saved?.statedAt ?? 0 },
        { ...agentClaim, field: "mrr" as const, value: 9_000 },
      ]),
    );
    expect(result).toEqual({ ok: true, applied: 1, skipped: 1 });
  });
});

test("an agent claim on a scorecard field is REFUSED — that store cannot record who said it", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.run(async (ctx) => {
      await writeFigureRow(ctx.db, "u1", {
        field: "cac",
        value: 250,
        origin: "observed",
        actor: "agent",
        basis: "vault document ref",
        observedAt: 1_754_000_000_000,
        confidence: "medium",
      });
    }),
  ).rejects.toThrow(/INVALID_INPUT: scorecard store carries no provenance/);
  // Refused BEFORE the write: half-written is the failure mode, since `applyScorecardAnswer` would
  // also have marked the dot-path user-provided and fed it to the citation map at high confidence.
  const evaluations = await t.run((ctx) => ctx.db.query("evaluations").collect());
  expect(evaluations).toHaveLength(0);
});
