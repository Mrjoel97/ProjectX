// @vitest-environment node
//
// Business Evaluation Engine (BEVL-01) — convex-test over the SMOKE:: grounding seam (zero network).
// This file rides `vaultGroundHydrated`'s offline seam (`SMOKE::<docId,…>`): a grounding query that
// starts with the sentinel resolves the seed docs tenant-scoped, no embedding call. The engine then
// carries the prior Scorecard forward, grounds, runs the pure diagnose(), and persists ONE row.
//
// `node` environment (15-04, the cockpitTools.test.ts / dispatch.test.ts idiom): the DISP-01
// end-to-end block below drives `internal.dispatch.__runSpecialistWithScript`, and `dispatch.ts`
// imports `runSpecialistTurn` from the `"use node"` llm.ts — a Convex-runtime module cannot load it.
import { serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// The engine's refs-only evaluation.ran audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier) so the REAL audit path runs
// under convex-test instead of throwing "component not registered" (the cockpitTools.test.ts idiom).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// The dispatcher's envelope reads/spends hit the rate-limiter's daily-spend window, and the memo
// terminal ingests through the SAME startIngest spine persistBrief uses (workflow + workpool).
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableTenant } from "./lib/functions";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

// The DISP-01 block loads `ai` + `@ai-sdk/openai` through the "use node" llm.ts inside convex-test's
// lazy module loader; on a cold checkout that first import alone exceeds vitest's 5s default
// (dispatch.test.ts / runCockpitAgent.test.ts carry the same line for the same reason).
vi.setConfig({ testTimeout: 30_000 });

const TENANT = "tenant_a";
const THREAD = "thread_1";

/** convex-test instance with every component the engine + the dispatch terminal touch. */
function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
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
  options: {
    title?: string;
    kind?: "brief" | "web_research";
  } = {},
): Promise<Id<"vaultDocuments">> {
  return t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: options.title ?? "Business profile",
      kind: options.kind ?? "brief",
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

describe("runEvaluation (SC#4 — web research citations retain their retrieval date)", () => {
  test("a web research vault title becomes a dated citation, without citing an ungrounded doc", async () => {
    const t = newTest();
    await t.mutation(internal.skills.seedSkills, {});
    const researchDocId = await seedDoc(t, TENANT, profileDocText(true), {
      title: "Web research: dog-training unit economics (retrieved 2026-07-29)",
      kind: "web_research",
    });

    await t.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: `${THREAD}_web_research`,
      query: `SMOKE::${researchDocId}`,
    });

    const grounded = await t.withIdentity({ subject: TENANT }).query(api.evaluations.byThread, {
      threadId: `${THREAD}_web_research`,
    });
    const datedFinding = grounded?.findings.find(
      (finding) => finding.citationDocId === researchDocId,
    );
    expect(datedFinding?.citationTitle).toContain("retrieved ");
    // Deliberate non-decision: `source` stays the closed "vault" literal. Freshness rides the
    // document title, so SC#4 needs neither an evaluations.ts edit nor a widened schema union.
    expect(datedFinding?.source).toBe("vault");

    // Use a fresh database so "no such document" is literal. Reusing the first tenant would carry
    // its prior scorecard provenance forward by design, including the web-research citation.
    const withoutResearchTest = newTest();
    await withoutResearchTest.mutation(internal.skills.seedSkills, {});
    const ordinaryDocId = await seedDoc(withoutResearchTest, TENANT, profileDocText(true));
    await withoutResearchTest.action(internal.evaluations.runEvaluation, {
      tenantId: TENANT,
      threadId: `${THREAD}_without_web_research`,
      query: `SMOKE::${ordinaryDocId}`,
    });
    const withoutResearch = await withoutResearchTest
      .withIdentity({ subject: TENANT })
      .query(api.evaluations.byThread, {
        threadId: `${THREAD}_without_web_research`,
      });
    expect(withoutResearch?.findings.some((finding) => finding.citationTitle.includes("retrieved ")))
      .toBe(false);
  });
});

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

// ── 15.1-04 (SC#2b): the rubric comes from the tenantProfiles ROW, not from the markdown ────────
//
// design §4.2: the `- **Persona:**` line in a `business_profile` doc is a PROJECTION of
// `tenantProfiles.tier`. `deserializeProfile` still falls back to `"solopreneur"` on a garbled line,
// and that fallback is only harmless because NOTHING authoritative reads it any more. These tests
// are what keep it harmless: they drive the engine over one identical malformed document and prove
// the framework follows the TABLE.

/**
 * Seed the tier row DIRECTLY (never through `saveFacts`). This suite is about which tier the engine
 * READS, not how it was derived — and design §10's `legacy` row legitimately carries no facts at all.
 */
async function seedTier(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  tier: "solopreneur" | "startup" | "sme" | "enterprise",
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      tier,
      tierSource: "derived",
      derivedAt: Date.now(),
    }),
  );
}

/**
 * The SC#2b fixture: a profile doc whose Persona line is GARBAGE (`isTier` rejects "wizard") and
 * which states NO financial figure, so nothing but the tier can decide the rubric. Before this plan
 * `deserializeProfile` fell back to `"solopreneur"` and the engine picked `"lean"` from it.
 */
const MALFORMED_PERSONA_DOC = profileDocText(false).replace(
  "- **Persona:** solopreneur",
  "- **Persona:** wizard",
);
/** Same document, plus the labeled figures that trip `financialsPresent` (the Q3 override fixture). */
const MALFORMED_WITH_FINANCIALS = `${MALFORMED_PERSONA_DOC}\n\nCAC: $150\nLTGP: $4500\n30-day cash: $200\n`;

/** Run the engine over `text` and return the persisted row's framework, asserting nothing queued. */
async function frameworkFor(t: ReturnType<typeof convexTest>, text: string): Promise<string> {
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t, TENANT, text);
  await t.action(internal.evaluations.runEvaluation, {
    tenantId: TENANT,
    threadId: THREAD,
    query: `SMOKE::${docId}`,
  });
  // A read-only evaluation must queue NOTHING. A leftover production job would make this file
  // depend on whether OPENAI_API_KEY is set (the 15-04 lesson) — assert, then clear.
  const queued = await readScheduled(t);
  await cancelQueued(t);
  expect(queued).toHaveLength(0);
  const row = await t
    .withIdentity({ subject: TENANT })
    .query(api.evaluations.byThread, { threadId: THREAD });
  return row?.framework as string;
}

describe("the framework auto-pick reads the tier table (SC#2b)", () => {
  // Non-vacuity: if `serializeProfile` ever stops emitting `- **Persona:** solopreneur`, the
  // `.replace()` above silently no-ops and every test below would pass for the wrong reason.
  test("the fixture really is malformed", () => {
    expect(MALFORMED_PERSONA_DOC).toContain("- **Persona:** wizard");
    expect(MALFORMED_PERSONA_DOC).not.toContain("solopreneur");
  });

  test("a malformed profile does not reclassify the tenant — tier `sme` still picks swot", async () => {
    const t = newTest();
    await seedTier(t, TENANT, "sme");
    expect(await frameworkFor(t, MALFORMED_PERSONA_DOC)).toBe("swot");
  });

  test("the TABLE moves the pick: the same markdown at tier `startup` picks bmc", async () => {
    const t = newTest();
    await seedTier(t, TENANT, "startup");
    // Two tiers, two frameworks, one identical document — the table is the authority, and this is
    // not the fallback happening to agree.
    expect(await frameworkFor(t, MALFORMED_PERSONA_DOC)).toBe("bmc");
  });

  test("no tier row at all → the honest `solopreneur` default (lean)", async () => {
    const t = newTest();
    expect(await frameworkFor(t, MALFORMED_PERSONA_DOC)).toBe("lean");
  });

  test("Q3 holds: financials present still override the tier with growth-os", async () => {
    const t = newTest();
    await seedTier(t, TENANT, "sme");
    // Intended behaviour, not a bug: financials mean a growth-os diagnosis is POSSIBLE. The tier's
    // perceivable effect lands on the specialist prompt (ADR-009), never on the rubric.
    expect(await frameworkFor(t, MALFORMED_WITH_FINANCIALS)).toBe("growth-os");
  });
});

// ── 15-04 (DISP-01): "Act on this" RUNS the specialist ────────────────────────────────────────
//
// Lane A's assertions live HERE. `gapAction.test.ts` is the 12-05 characterization file; it is run
// as a regression check by this plan's verify command.
//
// The property the first two tests exist for: a dispatched gap must not be APPROVABLE while the
// specialist is still running. Otherwise the user can approve a deterministic template that will
// shortly be overwritten by — or sit under — a specialist attribution header, at the exact surface
// where consent is irreversible. `actOnGap` stages `collecting`, and `executePlan` already refuses
// anything but `"proposed"` (cockpit.ts:530), so the race is closed BY CONSTRUCTION: no new guard,
// no new status literal, no UI change.

/** A grounded evaluation whose single gap routes at a REGISTERED specialist (money-model-designer). */
async function seedGapEvaluation(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.mutation(internal.skills.seedSkills, {});
  const docId = await seedDoc(t, TENANT, profileDocText(true));
  await t.action(internal.evaluations.runEvaluation, {
    tenantId: TENANT,
    threadId: THREAD,
    query: `SMOKE::${docId}`,
  });
}

type ScheduledRow = { _id: Id<"_scheduled_functions">; name: string; args: unknown[] };
/** The pending scheduler queue. `_scheduled_functions` is a SYSTEM table — read it through
 *  `ctx.db.system`, which is the only way to prove "exactly one dispatch was queued" BEFORE
 *  anything runs it. */
async function readScheduled(t: ReturnType<typeof convexTest>): Promise<ScheduledRow[]> {
  return (await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  )) as unknown as ScheduledRow[];
}
const dispatchArgsOf = (row: ScheduledRow): Record<string, unknown> =>
  row.args[0] as Record<string, unknown>;
/** Drop whatever `actOnGap` queued. The PRODUCTION `runSpecialist` resolves a REAL gateway model,
 *  and convex-test flushes due scheduled work in the background — leaving a job queued would make
 *  these tests depend on whether OPENAI_API_KEY happens to be set on the machine. Every test below
 *  asserts the QUEUE and then clears it; the run itself is driven through the scripted twin. */
async function cancelQueued(t: ReturnType<typeof convexTest>): Promise<void> {
  for (const row of await readScheduled(t)) await t.run((ctx) => ctx.scheduler.cancel(row._id));
}

describe("actOnGap dispatches the specialist (DISP-01)", () => {
  test("a dispatchable gap stages `collecting` and queues exactly ONE runSpecialist", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedGapEvaluation(t);

    const row = await asT.query(api.evaluations.byThread, { threadId: THREAD });
    const gap = row?.gaps[0];
    expect(gap?.route).toBe("money-model-designer"); // the premise: a REGISTERED specialist

    const res = await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    expect(res.ok).toBe(true);

    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(plan?.status).toBe("collecting"); // NOT "proposed" — nothing to approve yet
    expect(plan?.kind).toBe("memo"); // the shape is already decided
    expect(plan?.recipients ?? []).toHaveLength(0);
    expect(plan?.subject).toContain(gap?.label ?? "");
    // No template body is staged: the specialist's output is the only body this plan will ever have.
    expect(plan?.body ?? "").toBe("");

    const scheduled = await readScheduled(t);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.name).toContain("runSpecialist");
    expect(scheduled[0]?.name).toContain("dispatch");
    const args = dispatchArgsOf(scheduled[0] as ScheduledRow);
    expect(args).toMatchObject({
      tenantId: TENANT,
      threadId: THREAD,
      planId: plan?._id,
      gapIndex: 0,
      route: "money-model-designer",
      parentAgentId: "executive", // a code-owned constant, never user or model text
      depth: 1,
      ancestry: [],
      envelopeCents: 0, // the ROOT signal — 15-03 derives the real envelope from the live rail
      spentCents: 0,
    });
    expect(typeof args.rootRequestId).toBe("string");
    expect(String(args.rootRequestId).length).toBeGreaterThan(10);
    await cancelQueued(t);
  });

  test("the Approve race is closed: executePlan on a `collecting` plan persists NOTHING", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedGapEvaluation(t);
    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    await cancelQueued(t);
    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });

    const res = await asT.mutation(api.cockpit.executePlan, { planId: plan?._id as Id<"plans"> });
    expect(res).toEqual({ ok: true, alreadyStarted: true }); // the CAS refuses a non-proposed row

    const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(docs.filter((d) => d.kind === "next_step_memo")).toHaveLength(0);
    const requests = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(requests).toHaveLength(0);
    const after = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(after?.status).toBe("collecting"); // no CAS flip — the plan is still the specialist's
  });

  test("rootRequestId is minted FRESH per call — two dispatches never share a lineage key", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedGapEvaluation(t);

    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });

    const scheduled = await readScheduled(t);
    expect(scheduled).toHaveLength(2);
    const roots = scheduled.map((s) => dispatchArgsOf(s).rootRequestId);
    // planId is IDENTICAL across the two (actOnGap recycles the thread's one row, 12-05), which is
    // exactly why the lineage key must not be derived from it — ADR-008.
    const planIds = new Set(scheduled.map((s) => dispatchArgsOf(s).planId));
    expect(planIds.size).toBe(1);
    expect(new Set(roots).size).toBe(2);
    await cancelQueued(t);
  });

  // The other terminal: there is no specialist to run, so the 12-05 behaviour IS the right answer.
  // `""` is diagnose()'s deliberate not-enough-data emission; `scale` is its healthy branch. Both
  // persist as `v.string()` on gaps[].route, so the runtime resolve is the real guard.
  test.each(["", "scale"])(
    "a gap routed at %j runs nothing — the 12-05 memo lands `proposed` immediately",
    async (route) => {
      const t = newTest();
      const asT = t.withIdentity({ subject: TENANT });
      await seedGapEvaluation(t);
      const row = await asT.query(api.evaluations.byThread, { threadId: THREAD });
      // Re-point the persisted gap at a non-specialist route (the engine only emits these on
      // branches that carry no gap, so the row is edited directly rather than contrived upstream).
      await t.run((ctx) =>
        ctx.db.patch(row?._id as Id<"evaluations">, {
          gaps: (row?.gaps ?? []).map((g) => ({ ...g, route })),
        }),
      );

      const res = await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
      expect(res.ok).toBe(true);

      const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
      expect(plan?.status).toBe("proposed"); // approvable at once — nothing is coming
      expect(plan?.kind).toBe("memo");
      expect(plan?.body).toContain("## The next step"); // the deterministic buildMemo template
      expect(await readScheduled(t)).toHaveLength(0);
    },
  );

  test("the 12-05 refusals are unchanged: gap_not_found and plan_busy still queue nothing", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedGapEvaluation(t);

    expect(await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 99 })).toEqual(
      { ok: false, reason: "gap_not_found" },
    );

    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    const plan = await asT.query(api.plans.byThread, { threadId: THREAD });
    await t.run((ctx) => ctx.db.patch(plan?._id as Id<"plans">, { status: "delivering" }));
    expect(await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 })).toEqual({
      ok: false,
      reason: "plan_busy",
    });
    expect(await readScheduled(t)).toHaveLength(1); // only the first (successful) call queued one
    await cancelQueued(t);
  });
});

// ── The phase's user-visible claim, end to end ────────────────────────────────────────────────
//
// "Act on this" → the specialist RUNS → the result reaches the SAME single Approve gate → one
// saved memo → and the gmail fan-out was never reachable.
//
// The scheduled function is driven through `__runSpecialistWithScript` rather than
// `t.finishAllScheduledFunctions()`: the production `runSpecialist` resolves a REAL gateway model,
// and a test that spends money (or fails on a missing key) proves nothing. The twin is the SAME
// `dispatchAndLand` over the SAME governed loop with a scripted model — and the test first asserts
// that what `actOnGap` queued really is `runSpecialist`, then replays its EXACT args, so nothing
// about the hand-off is assumed.
const SPECIALIST_REPLY =
  "Tier the offer: a 3-month sprint at $1,500 with the onboarding audit bundled in.";
/** One scripted `doGenerate` step (LanguageModelV4 provider shape, the runCockpitAgent.test.ts
 *  idiom). Zero usage ⇒ zero cost ⇒ the run stays well inside its envelope. */
const scriptedReply = (text: string) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  },
  warnings: [],
});

describe("Act on this → dispatch → approvable (DISP-01)", () => {
  test("a tapped gap runs its specialist and lands ONE saved memo, with ZERO requests rows", async () => {
    const t = newTest();
    const asT = t.withIdentity({ subject: TENANT });
    await seedGapEvaluation(t);

    // 1. Tap. The plan is staged and NOT approvable.
    await asT.mutation(api.evaluations.actOnGap, { threadId: THREAD, gapIndex: 0 });
    const staged = await asT.query(api.plans.byThread, { threadId: THREAD });
    const planId = staged?._id as Id<"plans">;
    expect(staged?.status).toBe("collecting");
    expect(
      await asT.mutation(api.cockpit.executePlan, { planId }),
      "a template was approvable while the specialist was still running",
    ).toEqual({ ok: true, alreadyStarted: true });

    // 2. Run what was queued, with a scripted model (no network, no spend).
    const queued = await readScheduled(t);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.name).toContain("runSpecialist");
    const args = dispatchArgsOf(queued[0] as ScheduledRow);
    const rootRequestId = String(args.rootRequestId);
    // Cancel the queued PRODUCTION job first: it resolves a real gateway model, and convex-test
    // flushes due scheduled work as soon as the next action runs — so leaving it queued would race
    // a network call against the replay below (and win, landing the error fallback).
    await t.run((ctx) => ctx.scheduler.cancel((queued[0] as ScheduledRow)._id));
    await t.action(internal.dispatch.__runSpecialistWithScript, {
      ...(args as never),
      primary: [scriptedReply(SPECIALIST_REPLY)],
    });

    // 3. The specialist's work is now on the plan row, attributed, at the ONE Approve gate.
    const proposed = await asT.query(api.plans.byThread, { threadId: THREAD });
    expect(proposed?.status).toBe("proposed");
    expect(proposed?.kind).toBe("memo");
    expect(proposed?.body?.startsWith("> Produced by the **money-model-designer** specialist.")).toBe(
      true,
    );
    expect(proposed?.body).toContain(SPECIALIST_REPLY);

    // 4. Approve now works, and takes the MEMO terminal.
    expect(await asT.mutation(api.cockpit.executePlan, { planId })).toMatchObject({ ok: true });
    const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    const memos = docs.filter((d) => d.kind === "next_step_memo");
    expect(memos).toHaveLength(1);
    expect(memos[0]?.text).toBe(proposed?.body);
    expect(memos[0]?.tenantId).toBe(TENANT);

    // 5. The 12-05 structural property SURVIVES dispatch: zero requests rows on the whole path, so
    //    deliverApprovedPlan / gmail.send stayed unreachable — not merely unused.
    expect(await t.run((ctx) => ctx.db.query("requests").collect())).toHaveLength(0);

    // 6. …and the run is reconstructable from the lineage index, entirely within this tenant.
    const lineage = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .withIndex("by_correlation", (q) => q.eq("correlationId", rootRequestId))
        .collect(),
    );
    expect(lineage.map((r) => r.eventType)).toEqual([
      "subagent.dispatched",
      "subagent.completed",
    ]);
    for (const r of lineage) expect(r.tenantId).toBe(stableTenant(TENANT));
  });
});
