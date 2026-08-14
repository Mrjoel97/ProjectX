// @vitest-environment node
//
// Correction 7: a corpus-backed, non-email-first cockpit journey. The fixture is read from the
// upload package users actually test with; it is deliberately not a hand-written ACME surrogate.
// One governed agent loop grounds in Zawadi's strategy, assesses the business, and creates a
// standalone operating document while the tenant has no Gmail connection.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

const TENANT = "zawadi_solopreneur";
const THREAD = "zawadi_operator_journey";
const corpusRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../output/simulated-businesses/zawadi-growth-studio/01-clean-baseline",
);

const corpus = (relativePath: string): string =>
  readFileSync(join(corpusRoot, relativePath), "utf8").replace(/\r\n/g, "\n");

const businessOverview = corpus("01-company/business-overview.md");
const goalsAndScorecard = corpus("02-strategy/goals-and-scorecard.md");
const riskRegister = corpus("02-strategy/risk-register.md");
const pricing = corpus("03-offers/pricing-and-payment-terms.md");
const capacityPlan = corpus("06-operations/weekly-capacity-plan.md");
const cashPosition = corpus("07-finance/cash-position.md");

type T = ReturnType<typeof convexTest>;

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

const toolStep = (toolName: string, input: unknown) => ({
  content: [
    { type: "tool-call", toolCallId: `zawadi-${toolName}`, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage,
  warnings: [],
});

const textStep = (text: string) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage,
  warnings: [],
});

async function setupZawadi(): Promise<{
  t: T;
  planId: Id<"plans">;
  strategyDocId: Id<"vaultDocuments">;
}> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  await t.mutation(internal.skills.seedSkills, {});

  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId: TENANT,
      tier: "solopreneur",
      tierSource: "derived",
      derivedAt: Date.now(),
    }),
  );

  const profileText = serializeProfile({
    name: "Zawadi Growth Studio",
    oneLineDescription:
      "A one-person consultancy helping independent East African hospitality operators increase commission-free direct bookings.",
    persona: "solopreneur",
    stage: "Early revenue; productizing a service business",
    offering: "Four-week Direct Booking Sprint",
    targetCustomer: "Owner-managed hotels, guesthouses, and tour operators in Tanzania and Kenya",
    primaryGoals: [
      "Reach USD 8,000 in monthly collected revenue by 2026-12-31",
      "Close two Direct Booking Sprints per month by 2026-10-31",
    ],
    knownConstraints: [
      "Asha Mrema is the only person working in the business",
      "Client delivery must not exceed 30 hours per week",
    ],
  });

  const insertDoc = (title: string, text: string, kind = "upload") =>
    t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title,
        kind,
        category: "business",
        source: "upload",
        mimeType: "text/markdown",
        size: text.length,
        contentHash: `zawadi-${title.toLowerCase().replace(/\W+/g, "-")}`,
        text,
        status: "ready",
        createdAt: Date.now(),
      }),
    );

  await insertDoc(
    "Zawadi business profile",
    `${profileText}\n${businessOverview}`,
    "business_profile",
  );
  const strategyDocId = await insertDoc(
    "Zawadi strategy and operating constraints",
    [goalsAndScorecard, riskRegister, capacityPlan].join("\n\n"),
  );
  await insertDoc("Zawadi pricing and cash position", `${pricing}\n\n${cashPosition}`);

  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT,
    threadId: THREAD,
  });
  return { t, planId, strategyDocId };
}

describe("Zawadi solopreneur: useful cockpit work before email", () => {
  test("the source corpus still carries the business facts this scenario validates", () => {
    expect(businessOverview).toContain("Asha Mrema");
    expect(businessOverview).toContain("one-person consultancy");
    expect(goalsAndScorecard).toContain("USD 8,000");
    expect(riskRegister).toContain("Qualified lead flow stays inconsistent");
    expect(capacityPlan).toContain("Client delivery | 30 hours");
    expect(pricing).toContain("Direct Booking Sprint | 2,400");
    expect(cashPosition).toContain("Cash on hand | 14,500");
  });

  test("vault strategy, business assessment, and document creation work with no Gmail connection", async () => {
    const { t, planId, strategyDocId } = await setupZawadi();

    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(0);

    const result = await t.action(internal.llm.__runCockpitAgentWithScript, {
      tenantId: TENANT,
      planId,
      threadId: THREAD,
      primary: [
        toolStep("searchVault", { query: `SMOKE::${strategyDocId}` }),
        toolStep("evaluateBusiness", { framework: "lean" }),
        toolStep("createDocument", {
          form: "long",
          topic:
            "SMOKE::route=direct_llm:: Zawadi 30-day lead-generation operating plan that protects the 30-hour client-delivery guardrail",
        }),
        textStep("Your grounded operating plan and business assessment are ready in the panel."),
      ],
    });

    expect(result.reply).toMatch(/operating plan.*assessment/i);

    const sources = await t.run((ctx) => ctx.db.query("vaultSources").collect());
    // The schema encodes a grounding/source card as an absent role; only authored output says
    // `role: "created"` (the same distinction the cockpit reader uses).
    expect(
      sources.some(
        (row) =>
          row.role === undefined &&
          row.titles.includes("Zawadi strategy and operating constraints"),
      ),
    ).toBe(true);
    expect(
      sources.some((row) => row.role === "created" && row.titles.includes("Smoke Document")),
    ).toBe(true);

    const evaluation = (await t.run((ctx) => ctx.db.query("evaluations").collect())).find(
      (row) => row.tenantId === TENANT && row.threadId === THREAD,
    );
    expect(evaluation?.framework).toBe("lean");
    expect(evaluation?.findings.length).toBeGreaterThanOrEqual(4);
    expect(
      evaluation?.findings.map((finding: { label: string }) => finding.label).join(" "),
    ).toMatch(/Zawadi Growth Studio|Direct Booking Sprint/);

    const created = (await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).filter(
      (row) => row.tenantId === TENANT && row.kind === "created_document",
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.origin).toBe("agent");
    expect(created[0]?.status).toBe("ready");

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan).toMatchObject({ status: "collecting", recipients: [] });
    expect(plan?.subject).toBeUndefined();
    expect(plan?.body).toBeUndefined();

    // This is the acceptance boundary: useful work completed without touching any email rail.
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("requests").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(0);
    const audit = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(audit.map((row) => row.eventType)).toEqual(
      expect.arrayContaining(["vault.searched", "evaluation.ran", "document.created"]),
    );
    expect(audit.some((row) => /mailbox|gmail|email/i.test(row.eventType))).toBe(false);
  }, 60_000);
});
