// Business Evaluation Engine (BEVL-01) — convex-test over the SMOKE:: grounding seam (zero network).
// This file rides `vaultGroundHydrated`'s offline seam (`SMOKE::<docId,…>`): a grounding query that
// starts with the sentinel resolves the seed docs tenant-scoped, no embedding call. The engine then
// carries the prior Scorecard forward, grounds, runs the pure diagnose(), and persists ONE row.
import { serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// The engine's refs-only evaluation.ran audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) so the REAL audit path runs
// under convex-test instead of throwing "component not registered" (the cockpitTools.test.ts idiom).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const THREAD = "thread_1";

/** convex-test instance with the auditCounts aggregate component registered. */
function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

/** A committed business-profile vault doc (round-trips through deserializeProfile) + financial lines. */
function profileDocText(withFinancials: boolean, withOffering = true): string {
  const md = serializeProfile({
    name: "Acme Dog Training",
    oneLineDescription: "In-home dog training for busy urban owners.",
    persona: "solopreneur",
    stage: "early-revenue",
    // Sparse-start allows an empty offering — the honest idea-stage shape, and what pins diagnose()
    // to Gate 1 ("No offer worth buying yet") in the delta tests below.
    offering: withOffering ? "6-week private obedience program" : "",
    targetCustomer: "urban dog owners with new puppies",
    primaryGoals: ["more clients"],
    knownConstraints: [],
  });
  // Direct labeled figures → the honest financial scan fires (growth-os auto-pick).
  return withFinancials ? `${md}\n\nCAC: $150\nLTGP: $4500\n30-day cash: $200\n` : md;
}

/** Seed a groundable vault doc; return its id (the SMOKE:: seed). */
async function seedDoc(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  text: string,
): Promise<Id<"vaultDocuments">> {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business profile",
      kind: "brief",
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: text.length,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
}

describe("runEvaluation (BEVL-01 — grounded assessment persists a cited row)", () => {
  test("a grounded run persists a row with >=1 cited finding; byThread returns it", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));

    const result = await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    expect(result.findingCount).toBeGreaterThanOrEqual(1);

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    expect(row).not.toBeNull();
    expect(row?.framework).toBe("growth-os"); // financials present → growth-os auto-pick
    // Every finding carries a citation (SC #1) — a docId+title or an honest user-provided label.
    expect(row?.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of row?.findings ?? []) {
      expect(f.citationTitle).toBeTruthy();
      expect(["high", "medium", "low"]).toContain(f.confidence);
    }
    // A grounded finding cites the seed doc.
    expect(row?.findings.some((f) => f.citationDocId === docId && f.source === "vault")).toBe(true);
  });
});

describe("recordScorecardAnswer (BEVL-01 — the 'store' persistence path)", () => {
  test("stores a user figure into the latest row's scorecard + userProvided[]", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(false));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    await t
      .withIdentity({ subject: TENANT })
      .mutation(api.evaluations.recordScorecardAnswer, {
        threadId: THREAD,
        field: "financials.cac",
        value: 150,
      });

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    expect(row?.scorecard.financials.cac).toBe(150);
    expect(row?.userProvided).toContain("financials.cac");
  });
});

describe("evaluation.ran audit is refs-only (§4 — no grounded prose leaks)", () => {
  test("the audit payload carries counts/enums ONLY — no finding label or citation string", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("audit")
        .filter((q) => q.eq(q.field("eventType"), "evaluation.ran"))
        .collect(),
    );
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as Record<string, unknown>;

    // Structural §4 assertion: every key is a known count/enum; counts are numbers; enums are the
    // closed framework/verdict vocab. No key can carry a finding label, citation, or chunk of prose.
    const COUNT_KEYS = ["findingCount", "gapCount", "groundedDocCount", "userProvidedCount"];
    const ENUM_KEYS = ["framework", "verdict"];
    expect(new Set(Object.keys(payload))).toEqual(new Set([...COUNT_KEYS, ...ENUM_KEYS]));
    for (const k of COUNT_KEYS) expect(typeof payload[k]).toBe("number");
    expect(["swot", "lean", "bmc", "growth-os"]).toContain(payload.framework);
    expect(["gaps", "healthy", "insufficient"]).toContain(payload.verdict);

    // And no payload value echoes a grounded finding label (the content plane never reaches audit).
    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    const labels = (row?.findings ?? []).map((f) => f.label);
    for (const value of Object.values(payload)) {
      if (typeof value === "string") expect(labels).not.toContain(value);
    }
  });
});

describe("carry-forward / anti-re-ask (LOCKED store half)", () => {
  test("a user-provided figure survives into the NEXT run and is cited 'user-provided'", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(false)); // no financials in the vault
    // Run 1 (creates the row), user answers the missing figure, Run 2 must NOT re-ask it.
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });
    await t.withIdentity({ subject: TENANT }).mutation(api.evaluations.recordScorecardAnswer, {
      threadId: THREAD,
      field: "financials.cac",
      value: 150,
    });
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    // The figure is carried forward (not re-nulled) …
    expect(row?.scorecard.financials.cac).toBe(150);
    expect(row?.userProvided).toContain("financials.cac");
    // … and any finding on it is honestly labeled user-provided (never fabricated as a vault fact).
    const cacFinding = row?.findings.find((f) => f.label.startsWith("CAC:"));
    expect(cacFinding?.source).toBe("user-provided");
  });
});

describe("two-tenant isolation (SC #5)", () => {
  test("tenant B never reads tenant A's evaluation row", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    // tenant_a sees its row; tenant_b sees null through the same tenant-scoped query.
    expect(
      await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, { threadId: THREAD }),
    ).not.toBeNull();
    expect(
      await t
        .withIdentity({ subject: "tenant_b" })
        .query(api.evaluations.byThread, { threadId: THREAD }),
    ).toBeNull();
  });
});

describe("thin-data honesty (idea-stage → not enough data, never a fabricated finding)", () => {
  test("a run with no grounding → 'insufficient' + notEnoughData, ZERO fabricated findings/gaps", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    // SMOKE:: with no seed docs → the engine grounds nothing (a sparse/idea-stage profile).
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: "SMOKE::",
    });

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });
    expect(row?.verdict).toBe("insufficient");
    expect(row?.findings).toHaveLength(0); // nothing grounded → nothing asserted (no fabrication)
    expect(row?.gaps).toHaveLength(0); // no grounded basis → no fabricated prescription
    expect(row?.notEnoughData.length).toBeGreaterThanOrEqual(1); // an honest nudge instead
  });
});

// BEVL-03 "what changed" — the delta the weekly cron's review card reads. Computed INSIDE
// runEvaluation (the append-only table forbids a follow-up patch) and only when the caller asks
// for it, so an on-demand run never shows a delta line.
describe("delta (BEVL-03 — what changed since the previous evaluation)", () => {
  test("delta is absent on a first run", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));

    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
      withDelta: true,
    });

    const row = await t
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD });
    expect(row?.delta).toBeUndefined(); // no previous row ⇒ nothing to compare against
  });

  test("delta is absent without the withDelta flag", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));

    for (let i = 0; i < 2; i++) {
      await t.action(internal.evaluations.runEvaluation, {
        tenantId: TENANT,
        threadId: THREAD,
        query: `SMOKE::${docId}`,
      });
    }

    const row = await t
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD });
    expect(row?.delta).toBeUndefined(); // an on-demand run never renders a "what changed" line
  });

  test("delta reports gaps opened and closed by route/playbook", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    // Run 1: a profile with NO offering → Gate 1 ("No offer worth buying yet").
    const noOffer = await seedDoc(t, TENANT, profileDocText(false, false));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${noOffer}`,
      withDelta: true,
    });
    const first = await t
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD });
    expect(first?.gaps.map((g) => `${g.route}/${g.playbook}`)).toEqual([
      "offer-architect/02-build-offer",
    ]);

    // Run 2: the offer now exists and financials are stated → the constraint MOVES down the ladder.
    const withOffer = await seedDoc(t, TENANT, profileDocText(true, true));
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${withOffer}`,
      withDelta: true,
    });

    const row = await t
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD });
    // Assert on the KEY STRING: a route-only key would report this real move as "no change" only
    // when the route is unchanged, but the key must be the full route/playbook pair regardless.
    expect(row?.delta?.gapsClosed).toEqual(["offer-architect/02-build-offer"]);
    expect(row?.delta?.gapsOpened).toEqual(["money-model-designer/06-assemble"]);
  });

  test("delta counts newly added findings", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    // A user-answered figure seeds a carrier row with zero findings; the first real run cites it.
    await t.withIdentity({ subject: TENANT }).mutation(api.evaluations.recordScorecardAnswer, {
      threadId: THREAD,
      field: "financials.cac",
      value: 150,
    });
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: "SMOKE::",
      withDelta: true,
    });
    const grew = await t
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD });
    expect(grew?.delta?.newFindings).toBeGreaterThan(0);

    // An unchanged re-run: same carried figure, same diagnosis → nothing moved.
    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: "SMOKE::",
      withDelta: true,
    });
    const same = await t
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, { threadId: THREAD });
    expect(same?.delta?.newFindings).toBe(0);
    expect(same?.delta?.gapsClosed).toEqual([]);
    expect(same?.delta?.gapsOpened).toEqual([]);
  });
});

// Regression (owner-reported, 2026-07-25): a grounded profile that clearly STATES an offering was
// still diagnosed "No offer worth buying yet" — `emptyScorecard.identity.currentOffers` is `[]`,
// not null, so fillVault's `!= null` guard skipped it forever. hasOffer stayed false and Gate 1
// fired on EVERY vault-grounded run, masking the real constraint further down the ladder.
describe("fillVault treats an empty array as unset (offer gate is reachable)", () => {
  test("a profile stating an offering passes Gate 1 and routes to the real constraint", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const docId = await seedDoc(t, TENANT, profileDocText(true));

    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: THREAD,
      query: `SMOKE::${docId}`,
    });

    const row = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: THREAD,
    });

    // The offering from the profile actually landed on the scorecard.
    expect(row?.scorecard?.identity?.currentOffers ?? []).toHaveLength(1);

    // ...so diagnose() got PAST the offer gate. Gate 1 would route to offer-architect.
    for (const gap of row?.gaps ?? []) {
      expect(gap.route).not.toBe("offer-architect");
      expect(gap.label).not.toContain("No offer worth buying yet");
    }
  });
});
