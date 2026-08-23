// 27-07 Task 1 (PACK-02/PACK-03). The binding onto the REAL Executive Agent loop.
//
// THE CENTRAL ASSERTION IS BEHAVIOURAL, NOT A SOURCE SCAN. A scripted model asks for EVERY tool any
// pack can hold plus every tool no pack may hold, and the `agentSteps` rows say which of them the
// loop actually found: `ai@7` rejects a call to a name that is not a key of the record BEFORE
// `execute`, so `onToolExecutionStart` never fires for an absent tool. The observed set is compared,
// both directions, with `toolsForWorkflowPack` — the difference between proving the grant reached
// the loop and proving a constant equals itself, which is the vacuity this phase keeps re-learning.
//
// The same script is first driven through the EXECUTIVE record (`__runCockpitAgentWithScript` with
// no allow-list). That control is what makes the negative direction mean something: it proves every
// probe input is valid and every forbidden tool DOES execute when it is present, so its absence in a
// pack run is absence from the record rather than a rejected argument.
//
// Everything here runs offline through `__runWorkflowPackWithScript`, which swaps ONLY the model and
// shares every other line with the production entry point.
//
// `node` environment (the dispatch.test.ts idiom): the binding is a `"use node"` module and the
// mock-model loop wants the node runtime.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { packBrandReviewSkillBody } from "@pikar/contracts/skills/packBrandReview";
import { packBusinessPulseSkillBody } from "@pikar/contracts/skills/packBusinessPulse";
import { packCampaignPlanSkillBody } from "@pikar/contracts/skills/packCampaignPlan";
import { packCustomerComplaintSkillBody } from "@pikar/contracts/skills/packCustomerComplaint";
import { packProcessSopSkillBody } from "@pikar/contracts/skills/packProcessSop";
import { packSalesCallPrepSkillBody } from "@pikar/contracts/skills/packSalesCallPrep";
import {
  PACK_UNREACHABLE_TOOLS,
  packPreflight,
  toolsForWorkflowPack,
  WORKFLOW_PACK_IDS,
} from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
// The daily-spend rail `guardrails.preCall` gates on lives in the rate-limiter component, and the
// audit insert path aggregates — register both (relative imports; the packages block deep specifiers).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { newArtifactIds, outcomeFor, preflightPrompt } from "./workflowPackBinding";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_pack_a";
const TENANT_B = "tenant_pack_b";
const THREAD = "thread_pack_1";
const REPLY = "Obelisk margin read: three figures, two of them stale.";

/** The six pack bodies, keyed by registry name. 27-08 publishes these as candidates; a test seeds
 *  them ACTIVE so `runSpecialistTurn`'s fail-closed loader resolves a real body. */
const PACK_BODIES: Record<string, string> = {
  "pack-business-pulse": packBusinessPulseSkillBody,
  "pack-campaign-plan": packCampaignPlanSkillBody,
  "pack-customer-complaint": packCustomerComplaintSkillBody,
  "pack-sales-call-prep": packSalesCallPrepSkillBody,
  "pack-process-sop": packProcessSopSkillBody,
  "pack-brand-review": packBrandReviewSkillBody,
};

const provUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const textStep = (text: string) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: provUsage(10, 5),
  warnings: [],
});
const toolStep = (toolName: string, input: unknown = {}) => ({
  content: [
    { type: "tool-call", toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) },
  ],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage: provUsage(0, 0),
  warnings: [],
});

type T = TestConvex<typeof schema>;

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await t.run(async (ctx) => {
    for (const [name, body] of Object.entries(PACK_BODIES)) {
      await ctx.db.insert("skills", {
        name,
        version: 1,
        body,
        status: "active" as const,
        createdAt: Date.now(),
      });
    }
  });
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT,
    threadId: THREAD,
  });
  return { t, planId };
}

const runArgs = (planId: Id<"plans">, packId: string) => ({
  tenantId: TENANT,
  packId,
  threadId: THREAD,
  planId,
  text: "Give me a read on where things stand.",
});

/** Valid input for every tool the probe asks for. An INVALID input is rejected before execution
 *  exactly as an absent tool is, so a lazy `{}` here would make "absent" unfalsifiable. */
const PROBE_INPUTS: Record<string, unknown> = {
  // Every tool some pack is granted.
  searchVault: { query: "probe" },
  readFinance: {},
  webResearch: { query: "probe" },
  declareUnsupported: { claim: "probe", scope: "sub-question" },
  createDocument: { topic: "probe", form: "short" },
  listInbox: { range: "today" },
  briefInbox: { range: "today" },
  replyToMessage: { intent: "probe" },
  proposePlan: {},
  listManagedCalendarEvents: {},
  findInDrive: { query: "probe" },
  listDriveFolders: {},
  // Every tool NO pack may be granted: the four structurally unreachable ones plus three send-path
  // tools an allow-list simply does not name.
  dispatchResearch: { question: "probe" },
  dispatchMedia: { brief: "probe" },
  proposeImage: { prompt: "probe" },
  authorSkillCandidate: { name: "probe", authoredBody: "probe" },
  addRecipients: { addresses: ["a@example.test"] },
  setRecipients: { addresses: ["a@example.test"] },
  generateAttachment: { topic: "probe" },
};
const PROBE_NAMES = Object.keys(PROBE_INPUTS);

/**
 * The probe is driven in CHUNKS, and that is load-bearing rather than tidy. `runAgentLoop` stops at
 * `stepCountIs(8)`, so a single 19-tool script silently stops after the seventh call and every tool
 * after it reads as ABSENT — a green "exactly its grant" over a truncated run. Six calls plus the
 * closing text step stay inside the budget; the chunks share one `turnId`, so the activity trace
 * accumulates into one observed set.
 */
const PROBE_CHUNK = 6;
const probeChunks = (): (typeof PROBE_NAMES)[] => {
  const out: string[][] = [];
  for (let i = 0; i < PROBE_NAMES.length; i += PROBE_CHUNK)
    out.push(PROBE_NAMES.slice(i, i + PROBE_CHUNK));
  return out;
};
const chunkScript = (names: string[]) => [
  ...names.map((name) => toolStep(name, PROBE_INPUTS[name])),
  textStep(REPLY),
];

/** Which probed tools the loop actually FOUND — read off the activity trace the SDK drives. */
async function executedTools(t: T, turnId: string): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("agentSteps")
      .withIndex("by_turn", (q) => q.eq("tenantId", TENANT).eq("turnId", turnId))
      .collect(),
  );
  return [...new Set(rows.map((r) => r.tool).filter((tool) => tool !== "thinking"))].sort();
}

/** Run the whole probe through ONE pack and return the tools its record turned out to contain. */
async function packToolRecord(t: T, planId: Id<"plans">, packId: string): Promise<string[]> {
  const runId = `run-${packId}`;
  for (const chunk of probeChunks()) {
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, packId),
      runId,
      primary: chunkScript(chunk),
      fallback: chunkScript(chunk),
    });
  }
  return executedTools(t, runId);
}

describe("the grant reaching the loop is the registry's, exactly", () => {
  // THE CONTROL. Without it, "the pack did not run dispatchResearch" could equally mean "the probe
  // input was wrong" — and every negative below would be unfalsifiable.
  test("the executive record DOES contain every tool the packs are denied", async () => {
    const { t, planId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("skills", {
        name: COCKPIT_AGENT_SKILL,
        version: 1,
        body: "You are the executive agent.",
        status: "active" as const,
        createdAt: Date.now(),
      });
    });
    for (const chunk of probeChunks()) {
      await t.action(internal.llm.__runCockpitAgentWithScript, {
        tenantId: TENANT,
        planId,
        threadId: THREAD,
        turnId: "run-control",
        primary: chunkScript(chunk),
        fallback: chunkScript(chunk),
        // NO `toolNames` — this is the unrestricted record, which is exactly the point.
      });
    }
    const executed = await executedTools(t, "run-control");
    for (const denied of [...PACK_UNREACHABLE_TOOLS, "addRecipients", "setRecipients"]) {
      expect(executed, `control run never executed ${denied} — the probe input is wrong`).toContain(
        denied,
      );
    }
  });

  // MUTATION that must turn this RED: widen or narrow any `existing` row's `tools` in
  // packages/core/src/workflowPacks.ts, or replace `toolsForWorkflowPack(packId)` in the binding
  // with a hand-typed list.
  test.each(WORKFLOW_PACK_IDS)("%s is handed exactly its derived tool list", async (packId) => {
    const { t, planId } = await setup();
    const granted = [...toolsForWorkflowPack(packId)].sort();
    // Non-vacuity: an empty grant would make the comparison below trivially true.
    expect(granted.length).toBeGreaterThan(0);
    // Every granted name must also be PROBED, or "exactly" would only mean "exactly what we asked".
    expect(granted.filter((g) => !PROBE_NAMES.includes(g))).toEqual([]);
    expect(await packToolRecord(t, planId, packId)).toEqual(granted);
  });

  // The leaf-agent property (owner decision B). `runAgentLoop` derives `grantDispatch` and
  // `grantSkillAuthoring` from `toolNames === undefined`, so these four are never BUILT for a pack —
  // and the control above proves they ARE built for an agent with no allow-list.
  test.each(
    WORKFLOW_PACK_IDS,
  )("%s is a leaf agent — no dispatch, no skill authoring", async (packId) => {
    const { t, planId } = await setup();
    const executed = await packToolRecord(t, planId, packId);
    expect(PACK_UNREACHABLE_TOOLS.length).toBeGreaterThan(0);
    for (const forbidden of PACK_UNREACHABLE_TOOLS) {
      expect(executed, `${packId} reached ${forbidden}`).not.toContain(forbidden);
    }
    // The send path is withheld the same way: no recipient edits from inside a pack.
    for (const sendPath of ["addRecipients", "setRecipients", "generateAttachment"]) {
      expect(executed, `${packId} reached ${sendPath}`).not.toContain(sendPath);
    }
  });

  // Only ONE pack may stage a plan for approval (@pikar/core pins it by name). Observed at the loop,
  // so a registry that says one thing and a record that does another cannot both look green.
  test("only customer-complaint can stage a plan", async () => {
    const { t, planId } = await setup();
    for (const packId of WORKFLOW_PACK_IDS) {
      const executed = await packToolRecord(t, planId, packId);
      expect(executed.includes("proposePlan"), `${packId} staged a plan`).toBe(
        packId === "customer-complaint",
      );
    }
  });
});

describe("an unknown pack id is refused, and records nothing", () => {
  // A refusal that wrote a row would need a packId to write it under — and there isn't one. The
  // assertion is that the plane stays EMPTY, not that some "unknown" row appears.
  test.each(["not-a-pack", "__proto__", "constructor", ""])("%s is refused", async (packId) => {
    const { t, planId } = await setup();
    const res = await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, packId),
      primary: [textStep(REPLY)],
    });
    expect(res).toEqual({ ok: false, reason: "unknown_pack" });
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toHaveLength(0);
  });
});

describe("the run is governed and always terminalizes", () => {
  test("a completed run emits started, preflight and exactly one terminal", async () => {
    const { t, planId } = await setup();
    const res = await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "business-pulse"),
      recommendationId: "rec-1",
      primary: [textStep(REPLY)],
    });
    expect(res.ok && res.reply).toBe(REPLY);

    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    const events = rows.map((r) => r.event);
    expect(events).toContain("recommendation_accepted");
    expect(events).toContain("run_started");
    expect(events).toContain("preflight_completed");
    expect(events.filter((e) => e === "run_completed" || e === "run_failed")).toHaveLength(1);
    // Every row of one run shares the run id, which IS the loop's correlation id.
    expect(new Set(rows.map((r) => r.runId)).size).toBe(1);
    expect(rows.every((r) => r.packId === "business-pulse")).toBe(true);
  });

  // The kill switch is the one gate that must bind on EVERY paid model path. Without the `preCall`
  // in the binding, a pack run would be the single lane that ignores it — and every test above would
  // still pass, because they never look at the gate.
  // MUTATION that must turn this RED: delete the `guardrails.preCall` call in workflowPackBinding.ts.
  test("a killed switch blocks the run before the model, and records `blocked`", async () => {
    const { t, planId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("guardrailConfig", {
        killSwitch: true,
        budgetUsdPerRequest: 1,
        updatedAt: Date.now(),
      });
    });
    const res = await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "business-pulse"),
      // A script that would return a DIFFERENT reply if it ever ran — so "blocked" cannot be
      // satisfied by a run that happened anyway.
      primary: [textStep(REPLY)],
    });
    expect(res.ok && res.outcome).toBe("blocked");
    expect(res.ok && res.reply).not.toBe(REPLY);
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows.map((r) => r.event)).toEqual(["run_started", "run_failed"]);
    expect(rows.at(-1)?.outcome).toBe("blocked");
    // Blocked BEFORE the preflight probes, so nothing was read and nothing was spent.
    expect(rows.some((r) => r.event === "preflight_completed")).toBe(false);
  });

  // A run that starts and never terminates is a hole in every denominator — the metric plane counts
  // terminals, so a swallowed throw reads as a run still in flight forever.
  //
  // The failure is forced with an EMPTY script (the mock model has no result to return and throws)
  // rather than by calling an ungranted tool: `ai@7` turns a call to an absent tool into a
  // `tool-error` part and lets the loop finish, which is a governed outcome, not a crash.
  // MUTATION that must turn this RED: remove the `catch` in `runPackTurn`.
  test("a throwing run still writes its terminal, then rethrows", async () => {
    const { t, planId } = await setup();
    await expect(
      t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
        ...runArgs(planId, "business-pulse"),
        primary: [],
        fallback: [],
      }),
    ).rejects.toThrow();
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    const terminal = rows.find((r) => r.event === "run_failed");
    expect(terminal?.outcome).toBe("failed");
  });
});

describe("missing sources are probed in code, never invented", () => {
  // The honest-partial contract's runtime half. `customer-complaint` reads the mailbox; a tenant
  // with no Gmail grant must have that discovered BEFORE the model call and counted — not asserted
  // by the body's prose.
  // MUTATION that must turn this RED: return `"available"` unconditionally from `probeSources`.
  test("no mailbox grant is counted as a runtime gap and flagged", async () => {
    const { t, planId } = await setup();
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "customer-complaint"),
      primary: [textStep(REPLY)],
    });
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    const preflight = rows.find((r) => r.event === "preflight_completed");
    expect(preflight?.runtimeMissingCount).toBeGreaterThan(0);
    expect(preflight?.preflightMissingCount).toBeGreaterThan(0);
    // Counts must describe the SAME source set the pack declares, or the ratios measure nothing.
    expect(preflight?.sourceExpectedCount).toBe(
      packPreflight("customer-complaint", {}).sources.length,
    );
    expect(rows.some((r) => r.event === "capability_missing")).toBe(true);
    // A run that could not read a plane it was granted is `partial`, never `useful`.
    expect(rows.find((r) => r.event === "run_completed")?.outcome).toBe("partial");
  });

  // The opposite direction, so the test above is not just "everything is always missing": a granted
  // mailbox is NOT counted as a runtime gap.
  test("a connected mailbox is not counted as a gap", async () => {
    const { t, planId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: TENANT,
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 3_600_000,
        scope: "https://www.googleapis.com/auth/gmail.send",
        updatedAt: Date.now(),
      });
    });
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "customer-complaint"),
      primary: [textStep(REPLY)],
    });
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    const preflight = rows.find((r) => r.event === "preflight_completed");
    // customer-complaint's only reachable planes are inbox and vault; with the mailbox connected
    // nothing reachable is missing at runtime. The MATRIX-missing sources are unchanged — those are
    // announced, not surprises.
    expect(preflight?.runtimeMissingCount).toBe(0);
    expect(preflight?.preflightMissingCount).toBeGreaterThan(0);
    expect(rows.some((r) => r.event === "capability_missing")).toBe(false);
  });

  test("the preflight paragraph names each source and what would unlock it", () => {
    const rendered = preflightPrompt(
      packPreflight("business-pulse", { vault: "available" }),
      "what is going on",
    );
    // The RENDERED string, not the props: a source the code resolved must be visible to the model
    // under the label the registry owns, and a matrix-missing one must carry its unlock.
    expect(rendered).toContain("your knowledge vault: available");
    expect(rendered).toContain("the figures you have entered: unavailable");
    expect(rendered).toContain("an agent-readable version of the Reports summaries");
    // The untrusted text stays LAST — a directive inside it cannot precede the code-owned facts.
    expect(rendered.trimEnd().endsWith("what is going on")).toBe(true);
  });
});

describe("the outcome is derived from what happened", () => {
  test("useful is the narrowest arm", () => {
    const base = { reply: "x", truncated: false, declaredUnsupported: false, runtimeMissing: 0 };
    expect(outcomeFor(base)).toBe("useful");
    expect(outcomeFor({ ...base, truncated: true })).toBe("partial");
    expect(outcomeFor({ ...base, declaredUnsupported: true })).toBe("partial");
    expect(outcomeFor({ ...base, runtimeMissing: 1 })).toBe("partial");
    expect(outcomeFor({ ...base, reply: "   " })).toBe("no_findings");
  });

  // The direction that inflates the pilot: a document created by an EARLIER turn must never be
  // re-counted as this run's artifact.
  test("only ids new to this run count as its artifacts", () => {
    expect(newArtifactIds(["a"], ["a", "b"])).toEqual(["b"]);
    expect(newArtifactIds(["a", "b"], ["a", "b"])).toEqual([]);
    expect(newArtifactIds([], ["a"])).toEqual(["a"]);
  });

  test("a pre-existing created document produces no artifact event", async () => {
    const { t, planId } = await setup();
    await t.run(async (ctx) => {
      const docId = await ctx.db.insert("vaultDocuments", {
        tenantId: TENANT,
        title: "Earlier note",
        category: "workspace-docs",
        kind: "created_doc",
        source: "agent",
        mimeType: "text/markdown",
        size: 5,
        contentHash: "hash-earlier",
        status: "ready",
        text: "older",
        createdAt: Date.now() - 1000,
      });
      await ctx.db.insert("vaultSources", {
        tenantId: TENANT,
        threadId: THREAD,
        docIds: [docId],
        titles: ["Earlier note"],
        count: 1,
        role: "created" as const,
        createdAt: Date.now() - 1000,
      });
    });
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "brand-review"),
      primary: [textStep(REPLY)],
    });
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows.some((r) => r.event === "artifact_created")).toBe(false);
  });
});

describe("tenant isolation and the plan boundary", () => {
  test("a run never leaves the plan approved or delivering", async () => {
    const { t, planId } = await setup();
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "customer-complaint"),
      primary: [textStep(REPLY)],
    });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    // A pack stages at most; `executePlan` is a human `tenantMutation` no agent can reach.
    expect(plan?.status).toBe("collecting");
    expect(await t.run((ctx) => ctx.db.query("requests").collect())).toHaveLength(0);
  });

  test("one tenant's run writes nothing under another tenant", async () => {
    const { t, planId } = await setup();
    await t.action(internal.workflowPackBinding.__runWorkflowPackWithScript, {
      ...runArgs(planId, "business-pulse"),
      primary: [textStep(REPLY)],
    });
    const rows = await t.run((ctx) => ctx.db.query("workflowPackEvents").collect());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === TENANT)).toBe(true);
    expect(rows.some((r) => r.tenantId === TENANT_B)).toBe(false);
  });
});

// ── Structural: this file is a BINDING, and the pack lane is traced ────────────────────────────
//
// The dispatchGuard.test.ts idiom: read the source, strip comments (the prose deliberately NAMES the
// forbidden things), assert on what remains.
describe("the binding stays a binding", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./workflowPackBinding.ts", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  test("no second agent loop, no second store, no second router", () => {
    expect(src.length, "the comment strip ate the file").toBeGreaterThan(1000);
    for (const forbidden of ["generateText(", "streamText(", "ctx.db.", "buildCockpitTools("]) {
      expect(src.includes(forbidden), `workflowPackBinding.ts contains ${forbidden}`).toBe(false);
    }
    // ONE call into the governed loop, and it is the shared seam — not a private copy of it.
    expect(src.match(/runSpecialistTurn\(/g) ?? []).toHaveLength(1);
  });

  // Without this the pack lane is the ONE model path with no Foglamp span, and nothing else in the
  // suite would notice (the SDK is a silent no-op with no API key).
  // MUTATION that must turn this RED: unwrap the `traced(` around `runSpecialistTurn`.
  test("the pack turn runs inside traced()", () => {
    const traced = src.indexOf("traced(");
    const turn = src.indexOf("runSpecialistTurn(");
    expect(traced).toBeGreaterThan(-1);
    expect(turn).toBeGreaterThan(traced);
    // `agentName` must be a STATIC literal at the call site or trace cardinality explodes.
    expect(src).toContain('agentName: "workflow-pack"');
  });
});
