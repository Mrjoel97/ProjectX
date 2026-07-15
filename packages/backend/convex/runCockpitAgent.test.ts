// @vitest-environment node
//
// Mock-model loop integration coverage for the Executive-Agent tool-loop (Plan 04, AGNT-01/02).
// A LanguageModel is not Convex-serializable, so the mock is built INSIDE the action from a
// scripted array of doGenerate results (via the __runCockpitAgentWithScript shim) and handed to the
// REAL governed loop (runAgentLoop) — no gateway. Proves the Nyquist truths deterministically:
//   #1 a scripted conversational edit sequence mutates the plans row to a correct `proposed` state,
//   #3 a kill-switch stop yields a paused reply and writes NO deadLetters row (never a DLQ),
//   #5 recordSpend consumes the daily-spend window on non-zero usage + an eligible failure falls
//      back to CHEAP_MODEL.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
// recordSpend drives the rate-limiter component (reserve into the daily-spend window); register it
// (relative import — the package blocks the deep specifier) so the REAL guardrail path runs under
// convex-test instead of throwing "component not registered".
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts");

// A SMOKE:: body-intent survives redaction and short-circuits draftCockpit offline (no gateway).
const SMOKE_BODY = "SMOKE::route=direct_llm:: say a friendly hello";
type T = ReturnType<typeof convexTest>;

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  await t.mutation(internal.skills.seedSkills, {}); // cockpit-agent + email-drafter active seeds
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId: "t1", threadId: "thread1" });
  return { t, planId };
}

const readPlan = (t: T, planId: Id<"plans">) => t.run((ctx) => ctx.db.get(planId));

// ── Scripted mock doGenerate results (LanguageModelV4 provider shape) ─────────
const provUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const toolStep = (toolName: string, input: unknown) => ({
  content: [{ type: "tool-call", toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage: provUsage(0, 0),
  warnings: [],
});
const textStep = (text: string, input = 0, output = 0) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: provUsage(input, output),
  warnings: [],
});

test("mock loop: a scripted edit sequence drives the plan to a correct `proposed` state", async () => {
  const { t, planId } = await setup();

  // Script: addRecipients → setSubject → draftBody → proposePlan → final assistant text.
  // The final step reports huge usage so recordSpend reserves > the daily budget (assert below).
  const reply = await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [
      toolStep("addRecipients", { addresses: ["bob@example.com", "alice@example.com"] }),
      toolStep("setSubject", { subject: "Project sync" }),
      toolStep("draftBody", { intent: SMOKE_BODY }),
      toolStep("proposePlan", {}),
      textStep("Your plan is ready — review and Approve.", 1_000_000, 10_000_000),
    ],
  });

  expect(reply.reply).toBe("Your plan is ready — review and Approve.");
  // costUsd rides the loop's return (EVAL-01 Pattern 4 — the eval runner's cost-cap read): the
  // priced huge usage on DEFAULT_MODEL is a positive number, the same value recordSpend consumed.
  expect(typeof reply.costUsd).toBe("number");
  expect(reply.costUsd).toBeGreaterThan(0);

  const plan = await readPlan(t, planId);
  expect(plan?.status).toBe("proposed"); // conversational edits reached a proposed plan (truth #1)
  expect(plan?.recipients).toEqual(["bob@example.com", "alice@example.com"]);
  expect(plan?.subject).toBe("Project sync");
  expect(plan?.body).toBeTruthy(); // a draft landed on the row

  // recordSpend consumed the daily-spend window: the priced huge usage (> $5) drove it negative,
  // so the next preCall fails closed (truth #5 — recordSpend runs with the reasoning call's usage).
  const pre = await t.mutation(internal.guardrails.preCall, {});
  expect(pre).toEqual({ ok: false, reason: "daily_budget_exhausted" });
});

test("mock loop: a remove edit resolves the 1-based index (the right recipient remains)", async () => {
  const { t, planId } = await setup();
  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [
      toolStep("addRecipients", { addresses: ["bob@example.com", "alice@example.com"] }),
      toolStep("removeRecipient", { index: 1 }), // remove #1 (bob) by INDEX only
      textStep("Removed the first recipient.", 0, 0),
    ],
  });

  expect((await readPlan(t, planId))?.recipients).toEqual(["alice@example.com"]);
});

test("kill-switch: runCockpitAgent returns a paused reply + blocked, and writes NO deadLetters", async () => {
  const { t, planId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("guardrailConfig", { killSwitch: true, budgetUsdPerRequest: 0.05, updatedAt: Date.now() });
  });

  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    text: "add bob@example.com",
  });

  expect(res.blocked).toBe("kill_switch");
  expect(res.reply).toMatch(/paus/i); // conversational stop, not an error
  // A governed stop is NEVER a DLQ failure (truth #3).
  const dlq = await t.run((ctx) => ctx.db.query("deadLetters").collect());
  expect(dlq).toHaveLength(0);
});

test("SMOKE::agent attachment ops drive the tools offline (attach -> regenerate -> removeAttachment)", async () => {
  const { t, planId } = await setup();
  const run = (text: string) =>
    t.action(internal.llm.runCockpitAgent, { tenantId: "t1", threadId: "thread1", planId, text });

  // attach: SMOKE:: topic → draftDocument fixed markdown → markdownToPdf deterministic bytes.
  const gen = await run("SMOKE::agent::attach=SMOKE::route=direct_llm:: quarterly report");
  expect(gen.reply).toMatch(/\.pdf/);
  const afterGen = await readPlan(t, planId);
  expect(afterGen?.attachments?.length).toBe(1);
  const firstId = afterGen!.attachments![0]!.storageId;

  // regenerate=<index>:<topic> — supersede in place, old bytes gone.
  await run("SMOKE::agent::regenerate=1:SMOKE::route=direct_llm:: revised report");
  const afterRegen = await readPlan(t, planId);
  expect(afterRegen?.attachments?.length).toBe(1);
  expect(afterRegen!.attachments![0]!.storageId).not.toBe(firstId);
  expect(await t.run((ctx) => ctx.storage.getUrl(firstId))).toBeNull();

  // removeAttachment=<index> — dropped.
  const rm = await run("SMOKE::agent::removeAttachment=1");
  expect(rm.reply).toMatch(/removed/i);
  expect((await readPlan(t, planId))?.attachments ?? []).toEqual([]);
});

test("SMOKE::agent::sendTime drives setSendTime offline with a pinned clock (SCHD-01)", async () => {
  const { t, planId } = await setup();
  // The SMOKE path pins a deterministic {tz:"UTC", nowMs} so the NL time resolves offline — the
  // model never supplies "now"/tz (§2-D). A relative "in 3 hours" always resolves to a future instant.
  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    text: "SMOKE::agent::sendTime=in 3 hours",
  });
  expect(res.reply).not.toMatch(/ambiguous|picker|passed/i);
  expect((await readPlan(t, planId))?.sendAt).toBeTruthy(); // sendAt landed via the governed tool
});

test("fallback: an eligible primary failure retries on the CHEAP model", async () => {
  const { t, planId } = await setup();

  const reply = await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    failPrimary: true, // primary model throws a TimeoutError (isFallbackEligible)
    primary: [],
    fallback: [textStep("Recovered on the cheap model.", 0, 0)],
  });

  expect(reply.reply).toBe("Recovered on the cheap model.");
  // A fallback run still returns a summed costUsd: the primary threw inside generateText (nothing
  // recorded), the fallback's zero usage prices to 0 — the field is a number either way.
  expect(typeof reply.costUsd).toBe("number");
  expect(reply.costUsd).toBeGreaterThanOrEqual(0);
});

// ── skillVersions pin (EVAL-01, RESEARCH Pitfall 2) ──────────────────────────
// The eval runner must evaluate the CANDIDATE body, not whatever is active. The shim surfaces the
// loaded skill version alongside reply so the pin is observable without capturing the raw prompt.

const insertCandidate = (t: T, name: string, version: number) =>
  t.run(async (ctx) => {
    await ctx.db.insert("skills", {
      name,
      version,
      body: `${name} v${version} candidate body`,
      status: "candidate",
      createdAt: Date.now(),
    });
  });

test("skillVersions pin: a pinned cockpit-agent candidate loads as the system prompt; no pin = active", async () => {
  const { t, planId } = await setup(); // seedSkills → cockpit-agent v1 ACTIVE
  await insertCandidate(t, "cockpit-agent", 2);

  // No pin → behavior unchanged: the ACTIVE v1 loads.
  const unpinned = await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [textStep("hello", 0, 0)],
  });
  expect(unpinned.skillVersion).toBe(1);

  // Pin → the CANDIDATE v2 row loads (its body becomes `system` — same loaded row).
  const pinned = await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [textStep("hello", 0, 0)],
    skillVersions: { "cockpit-agent": 2 },
  });
  expect(pinned.skillVersion).toBe(2);
});

test("skillVersions pin: a missing (name, version) fails CLOSED — never silently falls back to active", async () => {
  const { t, planId } = await setup();
  await expect(
    t.action(internal.llm.__runCockpitAgentWithScript, {
      tenantId: "t1",
      planId,
      primary: [textStep("hello", 0, 0)],
      skillVersions: { "cockpit-agent": 99 },
    }),
  ).rejects.toThrow(/NO_SUCH_SKILL_VERSION/);
});

test("draftDocument pin: loads the pinned drafter version, fails closed on a missing one", async () => {
  const { t } = await setup(); // seedSkills → document-drafter v1 ACTIVE
  const args = {
    tenantId: "t1",
    safeText: "SMOKE::route=direct_llm:: quarterly report", // SMOKE keeps the model un-called
    safeTextHash: "hash-eval-pin",
  };

  // Only v1 exists → a pinned 99 refuses (fail closed, Pitfall 2).
  await expect(t.action(internal.llm.draftDocument, { ...args, skillVersion: 99 })).rejects.toThrow(
    /NO_SUCH_SKILL_VERSION/,
  );

  // A real candidate row → the pinned load succeeds; the load happens BEFORE the smoke
  // short-circuit, so the pinned lookup itself is exercised offline.
  await insertCandidate(t, "document-drafter", 2);
  const doc = await t.action(internal.llm.draftDocument, { ...args, skillVersion: 2 });
  expect(doc.title).toBe("Smoke Document");
});
