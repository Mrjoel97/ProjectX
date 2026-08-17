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

import { OFFER_ARCHITECT_SKILL, RESEARCH_SPECIALIST_SKILL } from "@pikar/contracts/skill";
import { SPECIALISTS } from "@pikar/core";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
// The cockpit DRIVERS (sendCockpitMessage / resolveRecipients) additionally touch the agent thread
// store and the audit aggregate — the intake.test.ts registration set, reused verbatim.
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// recordSpend drives the rate-limiter component (reserve into the daily-spend window); register it
// (relative import — the package blocks the deep specifier) so the REAL guardrail path runs under
// convex-test instead of throwing "component not registered".
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
// A node-env vitest file can import this "use node" module directly — the cockpitTools.test.ts
// precedent. Importing the CHOOSER is what makes the 45s default assertable rather than assumed.
import {
  callTimeoutMsFor,
  MEDIA_REFUSAL_REPLY,
  runSpecialistTurn,
  USER_FACING_MEDIA_REPLY,
} from "./llm";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

// A SMOKE:: body-intent survives redaction and short-circuits draftCockpit offline (no gateway).
const SMOKE_BODY = "SMOKE::route=direct_llm:: say a friendly hello";
type T = ReturnType<typeof convexTest>;

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  await t.mutation(internal.skills.seedSkills, {}); // cockpit-agent + email-drafter active seeds
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "t1",
    threadId: "thread1",
  });
  return { t, planId };
}

const readPlan = (t: T, planId: Id<"plans">) => t.run((ctx) => ctx.db.get(planId));

// ── Scripted mock doGenerate results (LanguageModelV4 provider shape) ─────────
const provUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const toolStep = (toolName: string, input: unknown) => ({
  content: [
    { type: "tool-call", toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) },
  ],
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
  const pre = await t.mutation(internal.guardrails.preCall, { tenantId: "t1" });
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
    await ctx.db.insert("guardrailConfig", {
      killSwitch: true,
      budgetUsdPerRequest: 0.05,
      updatedAt: Date.now(),
    });
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

test("an email-dependent turn requests Gmail only when the disconnected user asks for email", async () => {
  const { t, planId } = await setup();
  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    text: "Send the proposal to Amina",
  });

  expect(res.costUsd).toBe(0);
  expect(res.reply).toMatch(/email capability/i);
  expect(res.reply).toMatch(/connect Gmail/i);
  expect(res.reply).toMatch(/rest of the cockpit remains available/i);
});

// The `directVideo` route returns a tool's string to the user with NO model in between. Every
// media string the tool can return is written for the MODEL, so each one needs a translation —
// and the DRIFT is the risk: add a refusal reason, forget the translation, and that reason ships
// "Tell the user…" to a human. This asserts coverage against the source record, not a count.
test("every driver-plane media reply has a user-facing translation, and none of them leak", () => {
  for (const [reason, driver] of Object.entries(MEDIA_REFUSAL_REPLY)) {
    expect(USER_FACING_MEDIA_REPLY.has(driver), `no user-facing reply for "${reason}"`).toBe(true);
  }
  for (const [driver, user] of USER_FACING_MEDIA_REPLY) {
    // The driver string is the thing being replaced; the translation must not BE it.
    expect(user).not.toBe(driver);
    // Nothing addressed to a model, and no tool name, may survive into a user's reply.
    expect(user, user).not.toMatch(/\bTell the user\b|\bAsk whether\b|\bdo not (describe|wait)\b/i);
    expect(user, user).not.toMatch(/resetPlan|`[a-z]+Plan`|\bcall `/i);
    expect(user.trim()).not.toMatch(/carry on\.$/i);
  }
});

test("an explicit video request stages the media dispatch instead of invoking a withheld tool", async () => {
  const { t, planId } = await setup();

  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    text: "Create a short-form video for our launch",
    turnId: "video-turn",
  });

  expect(res.costUsd).toBe(0);
  // The reply reaches the user with NO model in between, so it must be addressed to the user.
  // This assertion used to require `/media director has started/` — the driver-plane string the
  // tool returns for the MODEL to read — which is exactly how the owner came to be shown
  // "you do not have it yet, so do not describe it, do not wait for it" on production 2026-08-17.
  expect(res.reply).toMatch(/reel proposal/i);
  expect(res.reply).toMatch(/nothing has been (generated|charged)/i);
  // The load-bearing half: no instruction addressed to a model may survive onto the screen.
  expect(res.reply).not.toMatch(/do not describe it|do not wait for it|carry on\.?$/i);
  expect(res.reply).not.toMatch(/\bTell the user\b|\bAsk whether\b|`?resetPlan`?/i);

  const plan = await readPlan(t, planId);
  expect(plan).toMatchObject({ kind: "memo", status: "collecting" });
  expect(plan?.subject).toMatch(/^Reel:/);

  const steps = await t.run((ctx) => ctx.db.query("agentSteps").collect());
  expect(steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        turnId: "video-turn",
        stepKey: "route-dispatchMedia",
        tool: "dispatchMedia",
        phase: "done",
      }),
    ]),
  );
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

// ── 03.9-02: the activity trace actually FIRES (CKPT-05) ─────────────────────
//
// THE reason these tests are load-bearing rather than nice-to-have: ai@7's `notify` SWALLOWS
// callback exceptions (`try { await cb(e) } catch {}` — dist/index.js:2636-2639). That is
// fail-open by design (a broken step writer can never break an agent turn) but it also means the
// emitter fails SILENTLY: a bad validator, a wrong arg name, a missing index produces no error, no
// log, and no red test — the feature just quietly renders nothing in production (research
// Pitfall 6). So every test below asserts the ROWS EXIST. A test that only asserted the loop
// returned a reply would be green against a completely broken emitter.
//
// This shim is the only offline path that can see it: __runCockpitAgentWithScript drives the REAL
// runAgentLoop → the REAL generateText with a MockLanguageModelV4, so the SDK callbacks genuinely
// fire (unlike __invokeCockpitTool, which calls tool.execute directly).

const readSteps = (t: T) => t.run((ctx) => ctx.db.query("agentSteps").collect());
/** The turn identity the driver mints in production (cockpit.ts); supplied here so we can assert on it. */
const TURN = { turnId: "turn-1", threadId: "thread1" };
/** Two tenants for the 21-02 overlay-isolation cases at the bottom of this file. */
const TENANT_A = "tenant_overlay_a";
const TENANT_B = "tenant_overlay_b";

test("activity trace: a scripted 2-tool run leaves 2 terminal rows with durations", async () => {
  const { t, planId } = await setup();

  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    ...TURN,
    primary: [
      toolStep("addRecipients", { addresses: ["bob@example.com"] }),
      toolStep("setSubject", { subject: "Project sync" }),
      textStep("Done — the plan is coming together.", 0, 0),
    ],
  });

  const steps = await readSteps(t);
  expect(
    steps,
    "the emitter wrote no rows — a swallowed callback throw looks exactly like this",
  ).toHaveLength(2);
  expect(steps.map((s) => s.tool).sort()).toEqual(["addRecipients", "setSubject"]);
  for (const s of steps) {
    expect(s.phase, `${s.tool} never terminalized`).toBe("done");
    expect(typeof s.durationMs, `${s.tool} has no duration`).toBe("number"); // toolExecutionMs (may be 0)
    expect(s.endedAt).toBeTruthy();
    expect(s.turnId).toBe("turn-1");
    expect(s.threadId).toBe("thread1");
    expect(s.tenantId).toBe("t1");
  }
});

test("activity trace: a THROWING tool leaves an `error` row and NO orphan `running`", async () => {
  const { t, planId } = await setup();
  // Delete the plan row → proposePlan's readPlan() throws (the tool's first statement). A real
  // execute() throw, not a mocked one: onToolExecutionEnd fires on tool-error too, discriminated
  // by toolOutput.type (dist/index.js:2955-2983), so this terminal state is FREE.
  await t.run((ctx) => ctx.db.delete(planId));

  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    ...TURN,
    // The SDK feeds the tool-error back to the model, which then finishes with text.
    primary: [toolStep("proposePlan", {}), textStep("I hit a problem with the plan.", 0, 0)],
  });

  const steps = await readSteps(t);
  expect(steps).toHaveLength(1);
  expect(steps[0]!.tool).toBe("proposePlan");
  expect(steps[0]!.phase, "a throwing tool did not terminalize as `error`").toBe("error");
  expect(
    steps.filter((s) => s.phase === "running"),
    "a step is spinning forever after a tool throw",
  ).toHaveLength(0);
});

test("activity trace: the FALLBACK retry's steps are emitted honestly, not suppressed", async () => {
  const { t, planId } = await setup();

  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    ...TURN,
    failPrimary: true, // the primary model throws a TimeoutError at doGenerate (isFallbackEligible)
    primary: [],
    fallback: [
      toolStep("addRecipients", { addresses: ["bob@example.com"] }),
      toolStep("setSubject", { subject: "Recovered subject" }),
      textStep("Recovered on the cheap model.", 0, 0),
    ],
  });

  // The retry's work IS the agent's work — it must appear. Honest: with this shim the primary
  // throws at its FIRST doGenerate, so it never reached a tool call and has no rows of its own;
  // what this pins is that a re-entered run() still emits, and that the second attempt's rows are
  // not swallowed or de-duplicated away. Rows are append-only per toolCallId BY CONSTRUCTION
  // (agentSteps.record only ever inserts) — hiding a retry would repeat the "computed and
  // discarded" failure the 03.7 UAT called out (research Pitfall 3).
  const steps = await readSteps(t);
  expect(steps).toHaveLength(2);
  expect(steps.map((s) => s.tool).sort()).toEqual(["addRecipients", "setSubject"]);
  for (const s of steps) expect(s.phase).toBe("done");
});

test("activity trace: a SMOKE op leaves ONE terminal row (the offline E2E path — Pitfall 4)", async () => {
  const { t, planId } = await setup();
  // The SMOKE sentinel short-circuits BEFORE generateText, so no SDK callback can fire. Every
  // offline E2E in the repo drives this path — without its own emission the whole activity surface
  // would be invisible to all of them and Plan 04's spec would assert on an empty surface.
  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    turnId: "turn-smoke",
    text: "SMOKE::agent::subject=Hi",
  });
  expect(res.reply).toBeTruthy();

  const steps = await readSteps(t);
  expect(
    steps,
    "the SMOKE path emitted nothing — the offline E2E would see an empty surface",
  ).toHaveLength(1);
  expect(steps[0]!.tool).toBe("setSubject"); // the op kind mapped to its real tool name
  expect(steps[0]!.phase).toBe("done");
  expect(steps[0]!.turnId).toBe("turn-smoke");
  expect(typeof steps[0]!.durationMs).toBe("number");
});

// ── 03.9-02: the DRIVER-owned turn lifecycle — a started step always ends (CKPT-05) ──────────
//
// The SDK gives per-tool terminal state for free. What it cannot give is the TURN: the `thinking`
// row that covers preCall + the skill-registry load + the first model round-trip — all of which
// happen before any tool event could possibly fire, and which ARE the whole 10-30s wait on the
// many turns that call no tool at all. These tests pin that the row is minted AND that it is
// terminal on every exit.

/** The driver spine offline: agent thread store + rate limiter + the audit aggregate. */
function setupDriver(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agentModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

const killSwitchOn = (t: T) =>
  t.run(async (ctx) => {
    await ctx.db.insert("guardrailConfig", {
      killSwitch: true,
      budgetUsdPerRequest: 0.05,
      updatedAt: Date.now(),
    });
  });

test("turn lifecycle: a GOVERNED STOP terminalizes the thinking row (the EARLY-RETURN path)", async () => {
  const t = setupDriver();
  await t.mutation(internal.skills.seedSkills, {});
  await killSwitchOn(t);

  // THE assertion of this task. A governed stop (kill switch / daily budget) comes back from
  // runCockpitAgent as DATA through a normal `return` — it is NOT a throw, so it never enters the
  // driver's `catch`. A catch-only terminalization leaves this row spinning forever, and it would
  // do so SILENTLY (research Pitfall 2's easy-to-miss mode). Only a `finally` covers it.
  await t
    .withIdentity({ subject: "t1" })
    .action(api.cockpit.sendCockpitMessage, { text: "who should I send this to?" });

  const steps = await readSteps(t);
  // Also pins the zero-tool turn: a governed stop calls no tool, so the thinking row is the ONLY
  // thing standing between the user and a blank, frozen-looking workspace.
  expect(steps, "the driver minted no thinking row").toHaveLength(1);
  expect(steps[0]!.tool).toBe("thinking");
  expect(steps[0]!.stepKey).toBe("thinking");
  expect(steps[0]!.phase, "the thinking row survived a governed stop as `running`").toBe("done");
  expect(steps[0]!.endedAt).toBeTruthy();
  expect(
    steps.filter((s) => s.phase === "running"),
    "a blocked turn left a row spinning forever",
  ).toHaveLength(0);
});

test("turn lifecycle: a THROWN failure out of the loop still terminalizes the thinking row", async () => {
  const t = setupDriver();
  // Skills deliberately UNSEEDED: getActiveSkill fails closed (NO_ACTIVE_SKILL) and the throw
  // propagates out of runCockpitAgent — the same exit a model timeout takes. Zero API calls (the
  // load happens before any model would be touched). This is the intake.test.ts idiom.
  await t
    .withIdentity({ subject: "t1" })
    .action(api.cockpit.sendCockpitMessage, { text: "draft something" });

  const steps = await readSteps(t);
  expect(steps).toHaveLength(1);
  expect(steps[0]!.tool).toBe("thinking");
  expect(steps[0]!.phase, "a thrown model failure left the thinking row running").toBe("done");
  expect(steps.filter((s) => s.phase === "running")).toHaveLength(0);
});

test("turn lifecycle: resolveRecipients (the OTHER agent entry point) terminalizes its turn too", async () => {
  const t = setupDriver();
  await t.mutation(internal.skills.seedSkills, {});
  await killSwitchOn(t);
  const asT = t.withIdentity({ subject: "t1" });

  const { threadId } = await asT.action(api.cockpit.sendCockpitMessage, { text: "email bob" });
  // A contact pick is a real 10-30s agent turn the user currently watches in SILENCE after clicking
  // a chip. Omitting it would leave one of the two agent entry points frozen — which is precisely
  // what "cross-cutting" in the phase goal exists to prevent.
  await asT.action(api.cockpit.resolveRecipients, {
    threadId,
    picks: [{ name: "Bob", address: "bob@example.com", displayName: "Bob" }],
  });

  // 19-08: wipe-on-pick is UNCHANGED by the contacts-first precedence. `resolveContacts` now has
  // two SOURCES for its candidates (a saved contact, else the Gmail headers) but exactly one
  // content-plane home, and the pick still clears it — "no contacts cache at rest" (SC#7) applies
  // to the transient parking spot as much as to the contacts table.
  const picked = await t.run((ctx) => ctx.db.query("plans").collect());
  expect(picked[0]?.candidates).toBeUndefined();
  expect(picked[0]?.pendingValid).toBeUndefined();

  const steps = await readSteps(t);
  expect(steps, "resolveRecipients minted no thinking row").toHaveLength(2);
  expect(steps.every((s) => s.tool === "thinking")).toBe(true);
  expect(steps.every((s) => s.phase === "done")).toBe(true);
  expect(steps.every((s) => s.threadId === threadId)).toBe(true);
  // Two turns ⇒ two distinct server-minted turnIds (the trace groups per turn, not per thread).
  expect(new Set(steps.map((s) => s.turnId)).size).toBe(2);
});

// ── 07-04: AGNT-04 — an exhausted model timeout escalates to an agent.timeout notification ────
//
// The Executive-Agent loop already bounds every model call with AbortSignal.timeout + one
// CHEAP_MODEL fallback. What was missing: on an EXHAUSTED timeout (BOTH models time out) the driver
// saved a generic error turn with no signal. Now runAgentLoop re-throws a content-free ConvexError
// timeout marker and the driver fires ONE agent.timeout notification — staying non-dead-ending.
// The SMOKE::agent::timeout seam forces both models to an AbortSignal-class timeout through the REAL
// runAgentLoop (no gateway), the offline analogue of a live double-timeout.

test("agent.timeout (AGNT-04): an exhausted model timeout fires ONE agent.timeout notification + a safe non-dead-ending reply; the thinking row still terminalizes", async () => {
  const t = setupDriver();
  await t.mutation(internal.skills.seedSkills, {});
  const asT = t.withIdentity({ subject: "t1" });

  const { threadId } = await asT.action(api.cockpit.sendCockpitMessage, {
    text: "SMOKE::agent::timeout",
  });

  // Exactly ONE agent.timeout notification (never over-notify), scoped to the tenant.
  const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
  expect(notifs).toHaveLength(1);
  expect(notifs[0]!.kind).toBe("agent.timeout");
  expect(notifs[0]!.tenantId).toBe("t1");

  // The turn is NON-dead-ending: the safe reply was saved (nothing was sent).
  const msgs = await asT.query(api.cockpit.listThreadMessages, {
    threadId,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(msgs.page.some((m) => (m.text ?? "").includes("nothing was sent"))).toBe(true);

  // The finally still terminalized the thinking trace (invariant 11) — no orphan `running` row.
  const steps = await readSteps(t);
  expect(steps.length).toBeGreaterThanOrEqual(1);
  expect(steps.every((s) => s.phase === "done")).toBe(true);
  expect(steps.filter((s) => s.phase === "running")).toHaveLength(0);
});

test("agent.timeout (AGNT-04): a NON-timeout failure fires NO agent.timeout notification (don't over-notify)", async () => {
  const t = setupDriver();
  // Skills deliberately UNSEEDED → getActiveSkill throws NO_ACTIVE_SKILL: a NON-timeout failure that
  // reaches the driver's catch the same way. The generic error turn saves; NO notification fires.
  await t.withIdentity({ subject: "t1" }).action(api.cockpit.sendCockpitMessage, {
    text: "draft something",
  });

  const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
  expect(notifs).toHaveLength(0);
});

// ── 15-02 (DISP-01): the toolNames seam — ONE loop, a swapped (skill body, tool-set) pair ────
//
// A specialist is not a second loop. It is runAgentLoop with a different `system` (already the
// seam runCockpitAgent uses) and a RESTRICTED tool record. The restriction has to be STRUCTURAL
// ABSENCE from the record — `activeTools` would leave the withheld tool's `execute` closure in
// the record and reachable via invokeTool, and skill wording is not a capability boundary at all.
// This is the omitRecipientEdits precedent (llm.ts:619-626) generalized to an explicit allow-list.
//
// Every assertion below is on the SIDE EFFECT, never on an error string: what "withheld" means is
// that the plan row does not move, whatever the SDK chooses to do with a name it cannot resolve.

/** Drive the shim, tolerating a throw: a hallucinated tool name may propagate out of generateText. */
async function runTolerant(t: T, args: Record<string, unknown>): Promise<void> {
  try {
    await t.action(internal.llm.__runCockpitAgentWithScript, args as never);
  } catch {
    /* the assertion is the ABSENCE of the side effect, not the error */
  }
}

/** Two write tools, two independently observable slots on the plan row. */
const EDIT_SCRIPT = [
  toolStep("setSubject", { subject: "Kept" }),
  toolStep("addRecipients", { addresses: ["bob@example.com"] }),
  textStep("done", 0, 0),
];

test("toolNames ABSENT: the full tool record — every existing caller is byte-identical", async () => {
  const { t, planId } = await setup();
  await runTolerant(t, { tenantId: "t1", planId, ...TURN, primary: EDIT_SCRIPT });

  const plan = await readPlan(t, planId);
  expect(
    plan?.subject,
    "an absent toolNames changed the tool set — existing callers regressed",
  ).toBe("Kept");
  expect(plan?.recipients).toEqual(["bob@example.com"]);
  expect((await readSteps(t)).map((s) => s.tool).sort()).toEqual(["addRecipients", "setSubject"]);
});

test("toolNames ['searchVault']: the withheld tools are ABSENT — the plan row does not move", async () => {
  const { t, planId } = await setup();
  await runTolerant(t, {
    tenantId: "t1",
    planId,
    ...TURN,
    primary: EDIT_SCRIPT,
    toolNames: ["searchVault"],
  });

  const plan = await readPlan(t, planId);
  expect(plan?.subject, "a withheld setSubject still wrote the plan row").toBeFalsy();
  expect(plan?.recipients ?? [], "a withheld addRecipients still wrote the plan row").toEqual([]);
  // A withheld tool never even STARTS: the trace has nothing to show, because the key is gone.
  expect(await readSteps(t), "a withheld tool emitted an activity step").toHaveLength(0);
});

test("toolNames: a NAMED tool still runs; only the unnamed ones are withheld", async () => {
  const { t, planId } = await setup();
  await runTolerant(t, {
    tenantId: "t1",
    planId,
    ...TURN,
    primary: EDIT_SCRIPT,
    toolNames: ["setSubject"],
  });

  const plan = await readPlan(t, planId);
  // Non-vacuity: without this the two tests above would pass against a filter that returns {}.
  expect(plan?.subject, "the ALLOWED tool was filtered out too — the allow-list is inverted").toBe(
    "Kept",
  );
  expect(plan?.recipients ?? [], "addRecipients was not in toolNames but still ran").toEqual([]);
  expect((await readSteps(t)).map((s) => s.tool)).toEqual(["setSubject"]);
});

test("toolNames []: an EMPTY array is NOT the same as ABSENT (the falsy-vs-undefined bug)", async () => {
  const { t, planId } = await setup();
  await runTolerant(t, { tenantId: "t1", planId, ...TURN, primary: EDIT_SCRIPT, toolNames: [] });

  const plan = await readPlan(t, planId);
  // `toolNames ? filtered : built` would hand back the FULL record here and this would read "Kept",
  // which is exactly why the implementation must test `=== undefined`.
  expect(plan?.subject, "an empty toolNames yielded the FULL tool record").toBeFalsy();
  expect(plan?.recipients ?? []).toEqual([]);
  expect(await readSteps(t)).toHaveLength(0);
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

// ── Phase 16 (16-05) — the research exception, and the floors that keep it an EXCEPTION ────────

// D12 obligation #2. This is a TEST rather than a comment because the whole claim of the research
// exception is that it changes NOTHING for any other path.
test("callTimeoutMsFor: research gets its own clock, everything else keeps 45s", () => {
  expect(callTimeoutMsFor(RESEARCH_SPECIALIST_SKILL)).toBe(180_000);
  // A LITERAL 45_000, never the CALL_TIMEOUT_MS symbol — an assertion written against the symbol
  // tracks the very refactor it exists to catch, and would stay green while the default moved.
  expect(callTimeoutMsFor("offer-architect")).toBe(45_000);
  expect(callTimeoutMsFor("some-skill-that-does-not-exist")).toBe(45_000);
});

// THE STEP REGRESSION FLOOR, and it is a different assertion from any cost floor.
//
// If the soft wall-clock stop were derived UNCONDITIONALLY from the budget, then for a default
// turn `45_000 - 60_000` is NEGATIVE, and `elapsed >= negative` is true on the FIRST evaluation —
// so every executive turn, every Growth OS specialist turn and this scripted shim would truncate
// at step 1. A cost floor cannot catch that: a one-step turn still prices correctly.
test("a NON-research scripted turn runs all four tool steps and is NOT truncated", async () => {
  const { t, planId } = await setup();

  const res = await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [
      toolStep("addRecipients", { addresses: ["bob@example.com"] }),
      toolStep("setSubject", { subject: "Four steps" }),
      toolStep("draftBody", { intent: SMOKE_BODY }),
      toolStep("proposePlan", {}),
      textStep("Done.", 10, 10),
    ],
  });

  expect(res.reply).toBe("Done.");
  expect(res.truncated, "the default path truncated — the soft clock leaked onto it").toBe(false);
  expect(res.truncatedReason).toBeUndefined();
  // The COST floor, asserted in the same turn: a turn with no hosted search must bill exactly as
  // before, so this change cannot silently re-price every existing cockpit turn.
  expect(res.webSearchCalls).toBe(0);
  expect(res.sources).toEqual([]);
});

// ── FIN-01: every llm.ts spend correlation is DISTINCT ───────────────────────
// A SOURCE check, for the same reason guardrails.test.ts's sibling scan is one: llm.ts spends at
// eight places and no runtime test can observe a call site nobody scripted. Six of the eight are
// one of three PRIMARY/FALLBACK pairs and a seventh is the web-search FEE that fires in the SAME
// attempt as the loop's token cost — all of them fully billed, none of them replays. The ledger
// identity is (tenantId, correlationId, phase), so a copy-pasted template makes the second charge
// return the first row and vanish, leaving the ledger BELOW the limiter. That is the direction
// that cannot be reconstructed, and a duplicated literal is exactly how it would happen.
test("every llm.ts spend correlation template is distinct and charset-legal", () => {
  // `Object.values(...).join` rather than indexing the glob by key: the key shape is a bundler
  // detail, and an index that missed would hand this scan an empty string it would pass on.
  const raw = Object.values(
    import.meta.glob("./llm.ts", { query: "?raw", import: "default", eager: true }) as Record<
      string,
      string
    >,
  ).join("\n");
  // Comments first — this block DISCUSSES the templates in prose, and a scan that read its own
  // documentation would report a collision that does not exist (the importGuard.test.ts trap).
  const code = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  const templates = [
    // The helper's 6th argument. `[^`]*?` up to the FIRST backtick works for the single-line
    // callers and the wrapped one alike: no other backtick appears inside these arg lists.
    ...[...code.matchAll(/recordModelSpend\([^`]*?`([^`]+)`/g)].map((m) => m[1] ?? ""),
    // ...and the fee, which calls recordSpend directly rather than through the helper.
    ...[...code.matchAll(/correlationId:\s*`([^`]+)`/g)].map((m) => m[1] ?? ""),
  ];
  // Anti-vacuity: a renamed helper would otherwise make an empty list pass for free.
  expect(templates.length).toBe(8);
  expect(new Set(templates).size, `duplicate spend correlation: ${templates.join(", ")}`).toBe(
    templates.length,
  );
  for (const t of templates) {
    // The interpolations are all crypto.randomUUID()s / a 0|1 attempt index, so a base32 stand-in
    // is faithful. This catches a future template that reaches for something with whitespace in it.
    const sample = t.replace(/\$\{[^}]+\}/g, "abc123");
    expect(sample, `illegal correlation charset: ${t}`).toMatch(/^[A-Za-z0-9._:@/-]{1,128}$/);
  }
});

// ── 19-11 (ACTN-05): the DEGRADE GRADIENT ────────────────────────────────────
// `stageCrmWrite` refuses ALL-OR-NOTHING over its operations list, so whenever any element is
// imperfect the model's cheapest retry is a SIMPLER list — and the simplest list that succeeds is
// a bare `addContact`. That is how "remind me on Thursday to chase Rhea" was measured landing as
// an undated contact (19-10, run 309b1c3d): not a model reflex, a downhill path the tool boundary
// built. The flag is TURN-scoped, which is why this test lives here and not in cockpitTools.test.ts
// — `__invokeCockpitTool` rebuilds the closure per call and structurally cannot see it.
const crmStep = (id: string, operations: unknown[]) => ({
  content: [
    {
      type: "tool-call",
      toolCallId: id,
      toolName: "stageCrmWrite",
      input: JSON.stringify({ operations }),
    },
  ],
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage: provUsage(0, 0),
  warnings: [],
});

test("19-11: dropping a refused follow-up is not an exit — the contact-only retry is refused too", async () => {
  const { t, planId } = await setup();

  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [
      // No clientContext on this shim, so §2-D refuses the dated follow-up outright (no_clock).
      crmStep("c-1", [
        {
          op: "addFollowUp",
          email: "rhea@example.com",
          note: "chase the renewal",
          due: "Thursday",
        },
      ]),
      // The downhill move. Before 19-11 this staged a bare contact and reported SUCCESS — the
      // exact plan row 19-10 measured against the live body.
      crmStep("c-2", [{ op: "addContact", email: "rhea@example.com", name: "Rhea Calloway" }]),
      textStep("Told the user what is on the card."),
    ],
  });

  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBeUndefined();
  expect(plan?.crmOperations).toBeUndefined();
  expect(plan?.status).toBe("collecting");
});

test("19-11 anti-vacuity: a contact-only list with NO refused follow-up still stages normally", async () => {
  const { t, planId } = await setup();

  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    primary: [
      crmStep("c-1", [{ op: "addContact", email: "rhea@example.com", name: "Rhea Calloway" }]),
      textStep("Told the user what is on the card."),
    ],
  });

  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("crm_write");
  expect(plan?.crmOperations).toHaveLength(1);
});

// ── 19-11 (§2-D): the CLOCK must survive into the loop's OWN tool set ─────────
// THE ACTN-05 ROOT CAUSE. `runAgentLoop` builds its own tools and passed `undefined` for
// `buildCockpitTools`' 4th (clientContext) argument, so `setSendTime`, `checkAvailability`,
// `proposeCalendarEvent` and `stageCrmWrite`'s dated follow-up all took their no-clock refusal on
// every live turn. Invisible because the only offline callers were `__invokeCockpitTool` (bypasses
// the loop, passes a clock directly) and the SMOKE path (pins its own). Measured on eval run
// 7e375c3c: seven refusals, every one `{"reason":"no_clock","ops":["addFollowUp"],
// "dueProvided":[true]}` — the model had supplied the whole follow-up all along.
test("19-11: the trusted clock reaches the tools runAgentLoop builds (§2-D)", async () => {
  const { t, planId } = await setup();

  await t.action(internal.llm.__runCockpitAgentWithScript, {
    tenantId: "t1",
    planId,
    clientContext: { tz: "UTC", nowMs: Date.UTC(2020, 0, 1, 12, 0, 0) },
    primary: [
      crmStep("c-1", [
        {
          op: "addFollowUp",
          email: "rhea@example.com",
          note: "chase the renewal",
          due: "tomorrow",
        },
      ]),
      textStep("Staged the follow-up."),
    ],
  });

  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("crm_write");
  const ops = plan?.crmOperations as Array<{ op: string; dueAt: number }> | undefined;
  expect(ops).toHaveLength(1);
  expect(ops?.[0]?.op).toBe("addFollowUp");
  // A FINITE dueAt is the observable end of the whole §2-D chain: the user's words, parsed against
  // the trusted clock. "tomorrow" off the pinned instant is the 09:00 default the next day.
  expect(ops?.[0]?.dueAt).toBe(Date.UTC(2020, 0, 2, 9, 0, 0));
});

// ── 21-02 (SKILL-01): a tenant's adaptation reaches the REAL specialist system prompt ─────────
//
// THE test this phase exists for. 21-01's own summary is blunt about it: a tested contract with no
// caller is invisible to every green suite here, and a `tenantSkills` row that never reaches a
// model call is not a skill capability. So this drives the SHIPPED `runSpecialistTurn` — the same
// function `dispatch.runSpecialist` calls in production — and reads the system prompt the model
// actually received.
//
// The mock's `doGenerate` is a FUNCTION here rather than the usual scripted array: the array form
// returns canned results and can only ever tell us what came back, never what went in. ai@7's
// MockLanguageModelV4 accepts either (`typeof doGenerate === "function"` branch, ai/dist/test),
// so this is the existing seam used the other way round, not a new one.
test("21-02: tenant A's active adaptation reaches A's specialist prompt and NEVER B's", async () => {
  const { t } = await setup(); // seedSkills → offer-architect v1 ACTIVE (the global base)
  const NEEDLE = "ZQ7RUNTIMEd41d8cd9";
  const planFor = (tenantId: string) =>
    t.mutation(internal.plans.insertPlan, { tenantId, threadId: `thread-${tenantId}` });
  const planA = await planFor(TENANT_A);
  const planB = await planFor(TENANT_B);

  // A has an ACTIVE overlay. 21-04 owns the real activation transition; inserting the row directly
  // keeps this test about the LOADER rather than about activation authority.
  await t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId: TENANT_A,
      name: OFFER_ARCHITECT_SKILL,
      version: 2,
      body: `OFFER ARCHITECT CORE plus adaptation ${NEEDLE}`,
      authoredBody: `adaptation ${NEEDLE}`,
      status: "active",
      author: "user",
      basedOnScope: "global",
      basedOnName: OFFER_ARCHITECT_SKILL,
      basedOnVersion: 1,
      rollbackEligible: false,
      createdAt: 0,
    }),
  );
  // …and B has a CANDIDATE carrying the SAME needle. If a candidate ever resolved at runtime, B's
  // prompt would carry the needle for a reason that has nothing to do with tenancy — so this row
  // is what makes B's clean prompt evidence about `status`, not just about `tenantId`.
  await t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId: TENANT_B,
      name: OFFER_ARCHITECT_SKILL,
      version: 2,
      body: `B DRAFT ${NEEDLE}`,
      authoredBody: `b draft ${NEEDLE}`,
      status: "candidate",
      author: "user",
      basedOnScope: "global",
      basedOnName: OFFER_ARCHITECT_SKILL,
      basedOnVersion: 1,
      rollbackEligible: false,
      createdAt: 0,
    }),
  );

  const turn = async (tenantId: string, planId: Id<"plans">) => {
    let system = "";
    let grantedTools: string[] = [];
    const capture = async (opts: {
      prompt: ReadonlyArray<{ role: string; content: unknown }>;
      tools?: ReadonlyArray<{ name?: string }>;
    }) => {
      // The `system` role message is the skill body runAgentLoop handed the provider — read out of
      // the provider-level call options, so this is the prompt the MODEL saw, not a re-derivation.
      system = String(opts.prompt.find((m) => m.role === "system")?.content ?? "");
      grantedTools = (opts.tools ?? []).map((x) => String(x?.name)).sort();
      return textStep("noted", 0, 0);
    };
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
      runAction: t.action.bind(t),
    } as unknown as Parameters<typeof runSpecialistTurn>[0];
    const res = await runSpecialistTurn(ctx, {
      tenantId,
      planId,
      skillName: OFFER_ARCHITECT_SKILL,
      // The CODE-OWNED grant, read from the shared spec — not a literal retyped here.
      toolNames: SPECIALISTS["offer-architect"].tools,
      prompt: "shape my offer",
      mockScript: { primary: capture as never },
    });
    return { system, grantedTools, res };
  };

  const a = await turn(TENANT_A, planA);
  const b = await turn(TENANT_B, planB);

  const globalBody = (
    await t.query(internal.skills.getActiveSkill, { name: OFFER_ARCHITECT_SKILL })
  ).body;

  // A got the OVERLAY, byte for byte, and the reported skillVersion is the tenant-local 2.
  expect(a.system).toBe(`OFFER ARCHITECT CORE plus adaptation ${NEEDLE}`);
  expect(a.system).toContain(NEEDLE);
  expect(a.res.skillVersion).toBe(2);
  // B got the GLOBAL body, byte for byte — a real prompt (the positive witness), with no trace of
  // the needle from A's ACTIVE row or from B's own CANDIDATE.
  expect(b.system).toBe(globalBody);
  expect(b.system.length).toBeGreaterThan(200);
  expect(b.system).not.toContain(NEEDLE);
  expect(b.res.skillVersion).toBe(1);
  // …and the two prompts really did differ, so neither equality above is trivially the other's.
  expect(a.system).not.toBe(b.system);

  // ADR-007: a prompt row ADVISES behaviour, it never GRANTS capability. The overlay changed A's
  // system prompt and left the tool grant byte-identical to B's and to the code-owned spec.
  expect(a.grantedTools).toEqual(b.grantedTools);
  expect(a.grantedTools).toEqual([...SPECIALISTS["offer-architect"].tools].sort());
});

test("21-02: a tenant with no overlay still loads the global row; an unseeded skill fails CLOSED", async () => {
  const { t } = await setup();
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT_A,
    threadId: "thread-fallback",
  });
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
    runAction: t.action.bind(t),
  } as unknown as Parameters<typeof runSpecialistTurn>[0];
  const run = (skillName: string) =>
    runSpecialistTurn(ctx, {
      tenantId: TENANT_A,
      planId,
      skillName,
      toolNames: SPECIALISTS["offer-architect"].tools,
      prompt: "shape my offer",
      mockScript: { primary: [textStep("noted", 0, 0)] },
    });

  // Mutation 8 (remove the global fallback) turns THIS assertion red.
  expect((await run(OFFER_ARCHITECT_SKILL)).skillVersion).toBe(1);
  // …and the fallback did not soften the fail-closed contract for a name with no row at all.
  await expect(run("never-seeded-skill")).rejects.toThrow(/NO_ACTIVE_SKILL/);
});

/**
 * 21-03 REGRESSION — and the reason it drives the ACTION instead of reading the source.
 *
 * `runCockpitAgent`'s args validator shipped WITHOUT `tenantSkillIds` while the internal loop's
 * type (`runSpecialistTurn`) had declared it from the start. In Convex the `args` validator is the
 * RUNTIME contract, so an unlisted field is refused BEFORE the handler runs: golden run `6e021dce`
 * died 0/41 at the door with `ArgumentValidationError`, having never reached a model.
 *
 * Nothing caught it, and the near-misses are the instructive part. `d2374bf` threaded the pin
 * through SCHEDULED DISPATCH and `dispatch.test.ts` proves it there — genuinely, with its own
 * "drop tenantSkillIds at one handoff" mutation — but the eval reaches the system through THIS
 * action, so that suite is structurally blind to this door. `eval:golden --self-check` asserts
 * OFFLINE that the runner COMPOSES `{skillVersions, tenantSkillIds}`; it can never prove the
 * server ACCEPTS it. 2030 backend tests were green throughout.
 *
 * Both halves below must stay:
 *   1. THE DOOR OPENS — delete the validator field and `t.action` throws instead of returning.
 *   2. THE PIN IS FORWARDED — accepting it and dropping it silently is the SAME defect one hop
 *      later, and strictly worse than the crash: the specialist would run the ACTIVE body while
 *      the evidence row claimed the candidate. That is the exact failure dispatch.ts:185-188
 *      documents, arriving by a different road.
 */
test("21-03: runCockpitAgent accepts a tenant pin AND forwards it to the dispatched specialist", async () => {
  const { t, planId } = await setup();

  // A REAL row: `v.id("tenantSkills")` refuses anything that is not a decodable id of that table,
  // so a fabricated string would fail for the wrong reason and prove nothing.
  const candidateId = await t.run((ctx) =>
    ctx.db.insert("tenantSkills", {
      tenantId: "t1",
      name: "media",
      version: 2,
      body: "candidate body",
      authoredBody: "candidate adaptation",
      status: "candidate",
      author: "user",
      basedOnScope: "global",
      basedOnName: "media",
      basedOnVersion: 1,
      rollbackEligible: false,
      createdAt: Date.now(),
    }),
  );

  // The explicit-video route: code-owned, no model, and it SCHEDULES `dispatch.runMedia` — which
  // makes the forwarded argument readable off the scheduler queue rather than inferred.
  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    text: "Create a short-form video for our launch",
    turnId: "tenant-pin-turn",
    tenantSkillIds: { media: candidateId },
  });
  // Half 1: we got a RETURN VALUE at all. Without the validator field this line is never reached.
  expect(res.costUsd).toBe(0);

  // Half 2: the pin is on the scheduled specialist call, not quietly dropped in the tool builder.
  const scheduled = (await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  )) as unknown as { name: string; args: unknown[] }[];
  const media = scheduled.find((s) => s.name.includes("runMedia"));
  expect(media, "the explicit-video route must schedule dispatch:runMedia").toBeTruthy();
  expect(media?.args[0]).toMatchObject({ tenantSkillIds: { media: candidateId } });
});
