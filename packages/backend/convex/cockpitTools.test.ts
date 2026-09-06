// @vitest-environment node
//
// Per-tool governance coverage for the cockpit Executive-Agent tool set (Plan 03, AGNT-01/02).
// The tools ARE the enforcement boundary — these drive them through a live action ctx (via the
// __invokeCockpitTool shim, since convex-test cannot fabricate one) against the REAL primitives,
// offline via SMOKE::. Nyquist truths #2/#3 sampled at 100%: validation bounce, index
// substitution, redaction-before-draft, and refs-only resolve summary each get an assertion.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_AUTHORABLE_SKILLS, CONTENT_DRAFTER_SKILL } from "@pikar/contracts/skill";
import {
  ACTION_TYPES,
  type ActionType,
  CALENDAR_HORIZON_MS,
  NO_GRANTS,
  PLAN_ATTACHMENT_CAP_BYTES,
  packOutputIsDocument,
  parseSendTime,
  SPECIALISTS,
  type ToolGrants,
  XLSX_MIME,
} from "@pikar/core";
import { sheetRows } from "@pikar/vault/sheets";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
// resolveContacts drives gmail.search, whose refs-only mailbox.searched audit hits the auditCounts
// aggregate; register the component (relative import — the package blocks the deep specifier) so the
// REAL audit path runs under convex-test instead of throwing "component not registered".
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
// runCockpitAgent's preCall/recordSpend drive the rate-limiter component (the daily-spend window).
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { contentHash } from "./lib/hash";
import {
  buildAgentContext,
  buildCockpitTools,
  buildHistoryBlock,
  buildWebResearchTool,
  PAGE_READ_CHARS,
  PAGE_READS_PER_RUN,
  parseAgentSmoke,
  parseExtractResult,
  parseWebResults,
  sourcesFromToolOutput,
  type ToolContext,
  WEB_RESULT_MIN_SCORE,
} from "./llm";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// NO @ts-expect-error on this one, unlike the three above: tsconfig.json includes vitest.config.mts,
// which pulls Vite's global types in, so import.meta.glob typechecks and the directive is DEAD
// (TS2578 — a real +1 on the backend's error count). Do not "restore" the sibling idiom here.
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

const SMOKE = "SMOKE::route=direct_llm::";
type T = ReturnType<typeof convexTest>;

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await t.mutation(internal.skills.seedSkills, {});
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "t1",
    threadId: "thread1",
  });
  return { t, planId };
}

// Same harness plus the rate-limiter component: runCockpitAgent (the SMOKE::agent sentinel path)
// runs preCall/recordSpend, which the tool-level __invokeCockpitTool shim never touches.
async function setupWithLimiter(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  await t.mutation(internal.skills.seedSkills, {});
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "t1",
    threadId: "thread1",
  });
  return { t, planId };
}

const call = (t: T, planId: Id<"plans">, toolName: string, input: unknown): Promise<string> =>
  t.action(internal.llm.__invokeCockpitTool, { tenantId: "t1", planId, toolName, input });

const readPlan = (t: T, planId: Id<"plans">) => t.run((ctx) => ctx.db.get(planId));

test("addRecipients bounces an invalid address (unchanged) and applies a valid one", async () => {
  const { t, planId } = await setup();

  const bounce = await call(t, planId, "addRecipients", { addresses: ["not-an-email"] });
  expect(bounce).toMatch(/reject/i);
  expect((await readPlan(t, planId))?.recipients).toEqual([]); // never entered recipients

  const ok = await call(t, planId, "addRecipients", { addresses: ["bob@example.com"] });
  expect(ok).not.toMatch(/reject/i);
  expect((await readPlan(t, planId))?.recipients).toEqual(["bob@example.com"]);
});

test("removeRecipient resolves a 1-based index — the address is never a tool arg", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com", "alice@example.com"] });

  const res = await call(t, planId, "removeRecipient", { index: 1 }); // remove #1 (bob) by INDEX only
  expect(res).not.toMatch(/reject/i);
  expect((await readPlan(t, planId))?.recipients).toEqual(["alice@example.com"]);

  // Out-of-range index bounces (never a silent no-op into a send).
  const oob = await call(t, planId, "removeRecipient", { index: 9 });
  expect(oob).toMatch(/reject/i);
});

test("setRecipients([]) cannot wipe already-set recipients — it bounces (03.2.1 disappearing-recipients bug)", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com", "alice@example.com"] });

  const res = await call(t, planId, "setRecipients", { addresses: [] });
  expect(res).toMatch(/reject/i);
  // Recipients survive — an empty set no longer silently clears the list.
  expect((await readPlan(t, planId))?.recipients).toEqual(["bob@example.com", "alice@example.com"]);
});

// ── THE PIN MUST REACH THE PLAN ROW, NOT JUST EXIST AS AN ARG (2026-08-30) ────────────────────
//
// `cockpit.test.ts` proves `proposeEmailPlan` HONOURS a `skillVersion` it is handed. That is only
// half a fix, and the cheaper half: a capability nothing calls is indistinguishable from no
// capability, and the mutation's own unit test cannot tell the difference. This drives the REAL
// tool through `__invokeCockpitTool` — the same shim the agent loop uses — with an EVAL-01 pin and
// a DIFFERENT active row, and reads the persisted plan.
//
// Delete the `skillVersion:` line from the propose tool in `llm.ts` and this test goes red while
// every test in `cockpit.test.ts` stays green. That asymmetry is the whole point of having it.
test("A PINNED tool run stamps the plan with the PIN, not the active cockpit-agent row", async () => {
  const { t, planId } = await setup();
  // seedSkills gave us an ACTIVE cockpit-agent. Add a candidate at a version it cannot collide with
  // and pin THAT — the shape of every `--skill cockpit-agent@N` gate run.
  const activeVersion: number = (
    await t.query(internal.skills.getActiveSkill, { name: "cockpit-agent" })
  ).version;
  const pinned = activeVersion + 7;
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: "cockpit-agent",
      version: pinned,
      body: "candidate body",
      status: "candidate",
      createdAt: Date.now(),
    }),
  );

  await call(t, planId, "addRecipients", { addresses: ["bob@example.com"] });
  await call(t, planId, "setSubject", { subject: "Q3 update" });
  await call(t, planId, "draftBody", { intent: `${SMOKE}Here is the Q3 update.` });

  await t.action(internal.llm.__invokeCockpitTool, {
    tenantId: "t1",
    planId,
    toolName: "proposePlan",
    input: {},
    skillVersions: { "cockpit-agent": pinned },
  });

  const plan = await readPlan(t, planId);
  expect(plan?.status).toBe("proposed");
  expect(plan?.skillVersion).toBe(pinned);
  expect(plan?.skillVersion).not.toBe(activeVersion); // the bug this closes, stated positively
});

test("proposePlan refuses an incomplete plan — never proposes a zero-recipient plan", async () => {
  const { t, planId } = await setup();

  const noRecip = await call(t, planId, "proposePlan", {});
  expect(noRecip).toMatch(/no recipients/i);
  expect((await readPlan(t, planId))?.status).not.toBe("proposed");

  // A recipient but no subject/body → still refuses (nothing half-baked reaches the PLAN card).
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com"] });
  const noSubject = await call(t, planId, "proposePlan", {});
  expect(noSubject).toMatch(/subject/i);
  expect((await readPlan(t, planId))?.status).not.toBe("proposed");
});

test("draftBody redacts (scanText) BEFORE the drafting model call", async () => {
  const { t, planId } = await setup();
  const LEAK = "leak@secret.com";
  // SMOKE:: survives redaction (no PII); the embedded address is redacted to a placeholder before
  // draftCockpit ever sees it — the offline draft cannot echo it back.
  await call(t, planId, "draftBody", { intent: `${SMOKE} tell them to write ${LEAK}` });

  const plan = await readPlan(t, planId);
  expect(plan?.body).toBeTruthy(); // a draft landed on the row
  expect(plan?.body).not.toContain(LEAK); // the raw address never reached the draft
});

test("resolveContacts writes candidates and returns a refs-only summary (NO address)", async () => {
  const { t, planId } = await setup();
  const summary = await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" });

  expect(summary).not.toContain("@"); // no address ever crosses to the model (§2-D)
  const plan = await readPlan(t, planId);
  expect(plan?.candidates?.length).toBeGreaterThan(0); // held on the content plane for the card
  // 19-08: with NOTHING saved, the Gmail-header fallback is byte-unchanged and DID run. This is
  // the non-vacuous half of the contacts-first pair below — without it, "zero header searches"
  // could pass because the search never runs for anybody.
  expect(await headerSearches(t)).toHaveLength(1);
});

test("resolveContacts is ADDITIVE — two names in ONE turn both survive (the 'Sarah and Zach' drop bug)", async () => {
  const { t, planId } = await setup();
  // The agent resolves each named person with its own resolveContacts call in a single turn.
  // Both must persist on the plan row so the ResolutionCard offers BOTH names — the second search
  // must NOT obliterate the first (writeCandidates used to patch the array wholesale).
  await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" });
  await call(t, planId, "resolveContacts", { name: "SMOKE::Sara" });

  const plan = await readPlan(t, planId);
  const names = (plan?.candidates ?? []).map((c: { name: string }) => c.name);
  expect(names).toContain("SMOKE::Sarah"); // the FIRST name is not dropped by the second search
  expect(names).toContain("SMOKE::Sara");
  expect(plan?.candidates?.length).toBe(2); // both names held for the card — no wholesale overwrite
});

test("resolveContacts re-search of the SAME name REPLACES that name's matches (upsert, no dupes)", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" });
  await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" }); // re-resolve the same name

  const plan = await readPlan(t, planId);
  const sarahEntries = (plan?.candidates ?? []).filter(
    (c: { name: string }) => c.name === "SMOKE::Sarah",
  );
  expect(sarahEntries.length).toBe(1); // upsert by name — never a duplicate section for one name
});

// ── 03.3-04 Task 1: generated attachment tools (CKPT-02) ──────────────────────
// Each tool is the governance boundary: scan → draft → render → store → record. Drive them
// through the real primitives offline (SMOKE:: draftDocument returns fixed markdown → markdownToPdf
// yields deterministic bytes) and assert the plan-row source of truth + no orphan bytes.

const ATTACH = "SMOKE::route=direct_llm::"; // survives redaction → draftDocument offline path

test("generateAttachment renders a stored PDF ref on the plan (scan→draft→render→store→record)", async () => {
  const { t, planId } = await setup();
  const res = await call(t, planId, "generateAttachment", { topic: `${ATTACH} quarterly report` });

  expect(res).toMatch(/\.pdf/); // a filename label, never a URL/bytes
  expect(res).not.toMatch(/http/i);
  const plan = await readPlan(t, planId);
  expect(plan?.attachments?.length).toBe(1);
  expect(plan?.attachments?.[0]?.mimeType).toBe("application/pdf");
  expect(plan?.attachments?.[0]?.size).toBeGreaterThan(0);
  expect(plan?.attachmentError).toBeUndefined(); // a clean generate clears any prior error
  // bytes actually landed in storage.
  const url = await t.run((ctx) => ctx.storage.getUrl(plan!.attachments![0]!.storageId));
  expect(url).toBeTruthy();
});

// SC4 (Phase 18 / ACTN-04): the SECOND output format rides the SAME governed chain — scan →
// registry drafter → cap → ctx.storage.store → ref-only return. No new tool, no new route.
// SC4b is the test above: an argument-less (three-arg) call is still a PDF, byte-identical.
test("generateAttachment({ format: 'html' }) stores a text/html page through the same chain (SC4)", async () => {
  const { t, planId } = await setup();
  const res = await call(t, planId, "generateAttachment", {
    topic: `${ATTACH} launch note`,
    format: "html",
  });

  expect(res).toMatch(/\.html/); // a filename label, never a URL/bytes
  expect(res).not.toMatch(/http:|https:/i);
  const att = (await readPlan(t, planId))!.attachments![0]!;
  expect(att.mimeType).toBe("text/html");
  expect(att.filename).toMatch(/\.html$/);
  expect(att.size).toBeGreaterThan(0);

  // The stored bytes are renderHtmlDocument's page, NOT the raw markdown.
  // Read the text INSIDE t.run — a Blob is not a Convex value and cannot cross that boundary.
  const text = await t.run(async (ctx) => (await ctx.storage.get(att.storageId))!.text());
  expect(text).toContain("<!doctype html>");
  expect(text).toContain("<h1>Smoke Document</h1>");
  expect(text).not.toMatch(/^# Smoke Document/m); // markdown never stored verbatim
});

test("the html branch shares the render-fail seam and the byte cap (one governed path, SC4)", async () => {
  const { t, planId } = await setup();
  const fail = await call(t, planId, "generateAttachment", {
    topic: "SMOKE::route=direct_llm::render=fail:: broken",
    format: "html",
  });
  expect(fail).toMatch(/couldn't|render|failed|try again/i);
  expect((await readPlan(t, planId))?.attachments ?? []).toEqual([]);

  // Same 8 MiB PLAN_ATTACHMENT_CAP_BYTES ceiling — deliberately NOT a second per-format constant.
  const sid = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
  await t.mutation(internal.plans.recordAttachments, {
    planId,
    attachments: [
      {
        storageId: sid,
        filename: "big.pdf",
        mimeType: "application/pdf",
        size: PLAN_ATTACHMENT_CAP_BYTES,
      },
    ],
  });
  const capped = await call(t, planId, "generateAttachment", {
    topic: `${ATTACH} another`,
    format: "html",
  });
  expect(capped).toMatch(/size|large|limit/i);
  expect((await readPlan(t, planId))?.attachments?.length).toBe(1);
});

test("regenerateAttachment supersedes in place and deletes the OLD bytes (O3, no orphan)", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "generateAttachment", { topic: `${ATTACH} first` });
  const oldId = (await readPlan(t, planId))!.attachments![0]!.storageId;

  const res = await call(t, planId, "regenerateAttachment", {
    index: 1,
    topic: `${ATTACH} second`,
  });
  expect(res).not.toMatch(/reject/i);
  const after = await readPlan(t, planId);
  expect(after?.attachments?.length).toBe(1);
  const newId = after!.attachments![0]!.storageId;
  expect(newId).not.toBe(oldId);
  expect(await t.run((ctx) => ctx.storage.getUrl(oldId))).toBeNull(); // old bytes deleted

  // Out-of-range index bounces (no change, nothing rendered/stored).
  const oob = await call(t, planId, "regenerateAttachment", { index: 9, topic: `${ATTACH} nope` });
  expect(oob).toMatch(/reject/i);
  expect((await readPlan(t, planId))?.attachments?.length).toBe(1);
});

test("removeAttachment drops the ref and deletes its stored bytes (no orphan)", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "generateAttachment", { topic: `${ATTACH} doc a` });
  const id = (await readPlan(t, planId))!.attachments![0]!.storageId;

  const res = await call(t, planId, "removeAttachment", { index: 1 });
  expect(res).not.toMatch(/reject/i);
  expect((await readPlan(t, planId))?.attachments ?? []).toEqual([]);
  expect(await t.run((ctx) => ctx.storage.getUrl(id))).toBeNull(); // bytes deleted

  const oob = await call(t, planId, "removeAttachment", { index: 1 });
  expect(oob).toMatch(/reject/i); // nothing left to remove
});

test("generateAttachment on a render failure sets attachmentError and stores NO ref (block-on-render-fail)", async () => {
  const { t, planId } = await setup();
  const res = await call(t, planId, "generateAttachment", {
    topic: "SMOKE::route=direct_llm::render=fail:: broken",
  });

  expect(res).toMatch(/couldn't|render|failed|try again/i);
  const plan = await readPlan(t, planId);
  expect(plan?.attachmentError).toBeTruthy();
  expect(plan?.attachments ?? []).toEqual([]); // no ref added on a render throw
});

test("generateAttachment over the byte cap sets attachmentError and stores NO new ref", async () => {
  const { t, planId } = await setup();
  // Pre-seed a real stored blob whose recorded size already fills the cap.
  const sid = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
  await t.mutation(internal.plans.recordAttachments, {
    planId,
    attachments: [
      {
        storageId: sid,
        filename: "big.pdf",
        mimeType: "application/pdf",
        size: PLAN_ATTACHMENT_CAP_BYTES,
      },
    ],
  });

  const res = await call(t, planId, "generateAttachment", { topic: `${ATTACH} another` });
  expect(res).toMatch(/size|large|limit/i);
  const plan = await readPlan(t, planId);
  expect(plan?.attachmentError).toBeTruthy();
  expect(plan?.attachments?.length).toBe(1); // no new ref appended over-cap
});

// ── 03.3-04 Task 2: proposePlan render-OK + under-cap gate (V7) ────────────────
// A render-failed / over-cap plan is structurally NOT approvable. proposePlan reads the facts
// from the ROW (never model args) and refuses so the agent regenerates/removes before proposing.

async function fillProposable(t: T, planId: Id<"plans">): Promise<void> {
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com"] });
  await call(t, planId, "setSubject", { subject: "Hi" });
  await call(t, planId, "draftBody", { intent: `${ATTACH} say hello` });
}

test("proposePlan refuses when attachmentError is set (render-fail/over-cap → not approvable, V7)", async () => {
  const { t, planId } = await setup();
  await fillProposable(t, planId);
  await call(t, planId, "generateAttachment", {
    topic: "SMOKE::route=direct_llm::render=fail:: x",
  });

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/attachment|cannot propose/i);
  expect((await readPlan(t, planId))?.status).not.toBe("proposed");
});

test("proposePlan refuses when attachments exceed the byte cap (defense-in-depth, no error flag)", async () => {
  const { t, planId } = await setup();
  await fillProposable(t, planId);
  const sid = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
  await t.mutation(internal.plans.recordAttachments, {
    planId,
    attachments: [
      {
        storageId: sid,
        filename: "big.pdf",
        mimeType: "application/pdf",
        size: PLAN_ATTACHMENT_CAP_BYTES + 1,
      },
    ],
  }); // no attachmentError — the cap re-check must catch it on its own

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/size|large|limit/i);
  expect((await readPlan(t, planId))?.status).not.toBe("proposed");
});

test("proposePlan proceeds with a healthy attachment", async () => {
  const { t, planId } = await setup();
  await fillProposable(t, planId);
  await call(t, planId, "generateAttachment", { topic: `${ATTACH} healthy doc` });

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/proposed/i);
  expect((await readPlan(t, planId))?.status).toBe("proposed");
});

// ── 03.10-04 Task 1: proposePlan pending-pick guard (UAT-C deadlock) ────────────
// A parked contact pick (candidates on the ROW, no user pick yet) is an OPEN resolution — proposing
// over it produces the "#1 (no name)" dead-end (the picker vanishes on `status === "proposed"`).
// proposePlan REFUSES while candidates are parked (facts from the ROW, DECISION #2), so the bad state
// is unreachable for EVERY reader. Backend owns the invariant; the frontend guard (Task 2) is
// defense-in-depth. The refusal proves proposeEmailPlan never ran (it flips status → 'proposed').

test("proposePlan refuses while a contact pick is still parked (never proposes over a pending pick)", async () => {
  const { t, planId } = await setup();
  await fillProposable(t, planId); // recipients + subject + body all set — otherwise proposable
  await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" }); // park a pick — no user pick yet
  expect((await readPlan(t, planId))?.candidates?.length).toBeGreaterThan(0);

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/pick is still pending/i); // refuse-and-instruct string
  expect((await readPlan(t, planId))?.status).not.toBe("proposed"); // proposeEmailPlan never invoked
});

test("proposePlan proceeds with NO parked pick (control — the guard is scoped to a pending pick)", async () => {
  const { t, planId } = await setup();
  await fillProposable(t, planId); // no resolveContacts → no candidates parked
  expect((await readPlan(t, planId))?.candidates ?? []).toEqual([]);

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/proposed/i); // happy path unregressed — the guard only bites a pending pick
  expect((await readPlan(t, planId))?.status).toBe("proposed");
});

// ── 03.4-02 Task 1: personalizeRecipient tool + buildAgentContext surfacing (CKPT-03) ──────────
// Per-recipient body tailoring by 1-based #index. Mirrors draftBody's scan→draftCockpit→patch, but
// the tailored wording lands in recipientBodies[address] (address resolved server-side, §2-D) —
// the shared body is UNCHANGED. Out-of-range index bounces without a write; overrides merge.

const PERS = "SMOKE::route=direct_llm::"; // survives redaction → draftCockpit offline path

test("personalizeRecipient tailors ONE recipient into recipientBodies; shared body unchanged", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com", "alice@example.com"] });
  await call(t, planId, "draftBody", { intent: `${PERS} shared hello` });
  const shared = (await readPlan(t, planId))?.body;
  expect(shared).toBeTruthy();

  const res = await call(t, planId, "personalizeRecipient", {
    index: 1,
    instructions: `${PERS} make it warmer`,
  });
  expect(res).toMatch(/#1/); // a label referencing the index
  expect(res).not.toContain("@"); // never an address (§2-D)

  const plan = await readPlan(t, planId);
  expect(plan?.recipientBodies?.["bob@example.com"]).toBeTruthy(); // override landed for #1
  expect(plan?.recipientBodies?.["alice@example.com"]).toBeUndefined(); // #2 untouched
  expect(plan?.body).toBe(shared); // the SHARED body is unchanged
});

test("personalizeRecipient bounces an out-of-range #index and does NOT patch", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com", "alice@example.com"] });

  const oob = await call(t, planId, "personalizeRecipient", {
    index: 99,
    instructions: `${PERS} nope`,
  });
  expect(oob).toMatch(/no recipient|reject/i);
  expect((await readPlan(t, planId))?.recipientBodies ?? {}).toEqual({}); // no write
});

test("personalizeRecipient merges — tailoring #2 preserves #1's override", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com", "alice@example.com"] });

  await call(t, planId, "personalizeRecipient", { index: 1, instructions: `${PERS} for bob` });
  await call(t, planId, "personalizeRecipient", { index: 2, instructions: `${PERS} for alice` });

  const rb = (await readPlan(t, planId))?.recipientBodies ?? {};
  expect(rb["bob@example.com"]).toBeTruthy(); // #1's override survives the #2 write (merge, not replace)
  expect(rb["alice@example.com"]).toBeTruthy();
});

test("buildAgentContext surfaces personalized/shared by #index, never an address (§2-D)", () => {
  const ctx = buildAgentContext({
    recipients: ["bob@example.com", "alice@example.com"],
    recipientBodies: { "bob@example.com": "Hi Bob, warmer wording." },
  });
  expect(ctx).toMatch(/#1:.*personalized/); // #1 is flagged personalized
  expect(ctx).toMatch(/#2:.*shared body/); // #2 falls back to the shared body
  expect(ctx).not.toContain("@"); // no raw address in the model-facing context
});

test("buildAgentContext surfaces names AWAITING a pick (name + count) — the agent sees resolution-in-progress", () => {
  const ctx = buildAgentContext({
    recipients: ["zach@example.com"],
    // A resolution is mid-flight: Sarah searched, matches parked, waiting for the user's card pick.
    candidates: [
      {
        name: "Sarah",
        matches: [
          { address: "sarah@example.com", displayName: "Sarah Smoke" },
          { address: "sara@example.org", displayName: "Sara Test" },
        ],
      },
    ],
  });
  // The agent MUST see that Sarah is pending — so it won't claim "already added" (nothing written)
  // nor blindly re-resolve; it tells the user to pick from the card. This is the fix for the
  // agent↔workspace disconnect: the model's view of the shared plan state is now complete.
  expect(ctx).toContain("Sarah"); // the pending name is visible
  expect(ctx).toMatch(/still open|not.*picked/i); // framed as a NEUTRAL open-pick state (03.10-05 — no longer the imperative "Awaiting…tell the user to pick")
  expect(ctx).toContain("2"); // the count of found contacts (refs-only)
  expect(ctx).not.toContain("sarah@example.com"); // §2-D: no candidate address to the model
  expect(ctx).not.toContain("Sarah Smoke"); // §4: match hints are USER-only, never to the model
});

// ── 03.10-07 (UAT-F1/F2): picked names render; recipient tools withheld on the continue turn ────

test("buildAgentContext renders a picked recipient by NAME via recipientNames (UAT-F1)", () => {
  const ctx = buildAgentContext({
    // Case-insensitive lookup: the stored key is the lowercased address the fold wrote.
    recipients: ["Brett.Fox@Example.com"],
    recipientNames: { "brett.fox@example.com": "Brett J. Fox" },
  });
  // The model sees the picked NAME — structurally distinguishable from an unresolved placeholder,
  // so the skill's distrust clause has nothing to fire on after a completed pick.
  expect(ctx).toContain("#1: Brett J. Fox");
  expect(ctx).not.toContain("(no name)");
  expect(ctx).not.toContain("@"); // §2-D: the address never enters the model-facing context
});

test("buildAgentContext falls back to the placeholder when no pick named the address", () => {
  // A typed-literal recipient (pendingValid fold) has no picked name — nobody chose it, so the
  // neutral placeholder is CORRECT, not a bug.
  const ctx = buildAgentContext({ recipients: ["typed@example.com"] });
  expect(ctx).toContain("(no name)");
  expect(ctx).not.toContain("@");
});

test("buildCockpitTools withholds addRecipients/setRecipients/removeRecipient ONLY under omitRecipientEdits (UAT-F2)", () => {
  // Building the record never touches the ctx (the tools only close over it), so a bare stub is
  // enough to prove the STRUCTURAL invariant: the keys are absent, not merely discouraged.
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const RECIPIENT_TOOLS = ["addRecipients", "setRecipients", "removeRecipient"];

  const full = Object.keys(buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId }));
  for (const name of RECIPIENT_TOOLS)
    expect(full, `${name} missing from the normal set`).toContain(name);

  const withheld = Object.keys(
    buildCockpitTools(
      { ctx: stubCtx, tenantId: "t1", planId },
      { ...NO_GRANTS, recipientEdits: false },
    ),
  );
  for (const name of RECIPIENT_TOOLS)
    expect(withheld, `${name} present on the post-pick continue turn`).not.toContain(name);
  // resolveContacts stays — it writes candidates, not recipients (proposePlan's pending-pick gate covers it).
  expect(withheld).toContain("resolveContacts");
  // The withholding removes EXACTLY the three recipient-mutating keys — nothing else changes.
  expect(full.filter((n) => !RECIPIENT_TOOLS.includes(n)).sort()).toEqual([...withheld].sort());
});

test("saveAsDocument is BUILT only when the document is the deliverable (27-10)", () => {
  // Structural absence, the `grantWebResearch` precedent: `runAgentLoop` returns the FULL record
  // when `toolNames === undefined`, so a save channel built unconditionally is one the EXECUTIVE
  // agent acquires on every cockpit turn. Keys, not wording — a filtered record still holds the
  // closure and stays reachable through invokeTool.
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const keys = (documentIsDeliverable = false) =>
    Object.keys(
      buildCockpitTools(
        { ctx: stubCtx, tenantId: "t1", planId },
        { ...NO_GRANTS, documentIsDeliverable },
      ),
    );

  expect(keys()).not.toContain("saveAsDocument");
  expect(keys(false)).not.toContain("saveAsDocument");
  expect(keys(true)).toContain("saveAsDocument");
  // It ADDS a key and takes nothing away — the executive's record is otherwise untouched.
  expect(
    keys(true)
      .filter((k) => k !== "saveAsDocument")
      .sort(),
  ).toEqual([...keys()].sort());
  // And it carries no content argument at all. That absence IS the fix: the model cannot re-type
  // (or mis-type) the deliverable into a tool call, because there is nowhere to put it.
  // Indexed, not dotted: the record's STATIC type is the executive's (the `{} as typeof` trick that
  // keeps ai@7's event types narrow), so the conditional key exists at runtime and not in the type.
  const tool = (
    buildCockpitTools(
      { ctx: stubCtx, tenantId: "t1", planId },
      { ...NO_GRANTS, documentIsDeliverable: true },
    ) as unknown as Record<string, { inputSchema?: { jsonSchema?: { properties?: object } } }>
  ).saveAsDocument;
  expect(Object.keys(tool?.inputSchema?.jsonSchema?.properties ?? {})).toEqual(["title"]);
});

test("packOutputIsDocument is what selects it, and only for document-output packs (27-10)", () => {
  // The flag is derived from the trusted skill NAME in runSpecialistTurn, never from `toolNames` —
  // a specialist must not be able to grant itself a save channel by holding a tool. This pins the
  // derivation: `pack-business-pulse` is a BRIEFING and `pack-customer-complaint` a draft reply, so
  // neither may acquire it, and no non-pack name may either.
  expect(packOutputIsDocument("pack-sales-call-prep")).toBe(true);
  expect(packOutputIsDocument("pack-business-pulse")).toBe(false);
  expect(packOutputIsDocument("pack-customer-complaint")).toBe(false);
  expect(packOutputIsDocument("cockpit-agent")).toBe(false);
  expect(packOutputIsDocument("document-drafter")).toBe(false);
  expect(packOutputIsDocument("pack-not-a-real-pack")).toBe(false);
});

// ── 12-04 (BEVL-01): the evaluation tools are registered in the cockpit set ────────────────────

test("buildCockpitTools registers BOTH evaluateBusiness (read) and recordScorecardAnswer (write)", () => {
  // The suite has no generic snapshot of tool keys, so without this line a dropped registration
  // would ship silently. A bare stub ctx is enough — the tools only CLOSE over ctx here.
  const stubCtx = {} as ToolContext["ctx"];
  const keys = Object.keys(
    buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId: "plan-stub" as Id<"plans"> }),
  );
  expect(keys).toContain("evaluateBusiness");
  expect(keys).toContain("recordScorecardAnswer");
});

test("buildCockpitTools registers tenant-derived Drive reads without a tenantId input", () => {
  const tools = buildCockpitTools({
    ctx: {} as ToolContext["ctx"],
    tenantId: "t1",
    planId: "plan-stub" as Id<"plans">,
  });
  for (const name of ["listDriveFolders", "findInDrive"] as const) {
    expect(Object.keys(tools)).toContain(name);
    const schema = tools[name].inputSchema as unknown as {
      jsonSchema: { properties: Record<string, unknown> };
    };
    expect(schema.jsonSchema.properties).not.toHaveProperty("tenantId");
  }
});

// ── 22.1b: every tool the research grant NAMES is actually BUILT ──────────────────────────────
//
// The runtime-record assertion nobody wrote for `dispatchResearch`. That tool was built only under
// a gate the eval runner silently failed to satisfy, so it was ABSENT from the record on every run
// — nothing errored, nothing was logged, and no test noticed. `SPECIALISTS[route].tools` is the
// allow-list `runAgentLoop` FILTERS the built record with, so a listed-but-unbuilt name is simply
// gone; this closes that structurally rather than per-tool.
// MUTATION that turns this RED: remove `declareUnsupportedTool` from the grantWebResearch spread
// in llm.ts while leaving it in RESEARCH_TOOLS.
test("every tool the research specialist is granted is actually built under its grant", () => {
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const built = Object.keys(
    buildCockpitTools(
      { ctx: stubCtx, tenantId: "t1", planId },
      { ...NO_GRANTS, webResearch: true, dispatch: false },
    ),
  );
  for (const name of SPECIALISTS.research.tools) {
    expect(built, `research lists "${name}" but nothing builds it`).toContain(name);
  }
  // …and it stays OFF the executive's set: `grantWebResearch` is false whenever `toolNames` is
  // undefined, so the cockpit agent can never reach the specialist's refusal channel.
  expect(Object.keys(buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId }))).not.toContain(
    "declareUnsupported",
  );
});

// ── `webResearch` is a LOCAL tool now, and the whole plane depends on that ────────────────────
//
// Rewritten 2026-08-07: this test asserted the PROVIDER-EXECUTED contract (a `{type:
// "provider-defined"}` marker with no `execute`, vendor-matched to RESEARCH_MODEL). That contract
// is gone — `webResearch` is a local Tavily-backed tool — and three call-site behaviours hang off
// the difference, each of which fails SILENTLY if this regresses:
//   • `runAgentLoop` counts searches by NAME (a local tool has providerExecuted false, so the old
//     flag-based count would be 0 forever and the search fee would never draw the rail);
//   • sources come from this tool's RESULT parts (`res.sources` only fills for hosted tools);
//   • `onToolExecutionStart` fires, so `agentSteps.tool` needs the `webResearch` literal.
//
// MUTATION that turns this RED: drop `execute` from the tool in llm.ts — it silently reverts to a
// non-executable descriptor and every web search returns nothing.
test("buildWebResearchTool exposes exactly `webResearch` + `readPage`, and both are LOCALLY executable", () => {
  const built = buildWebResearchTool();
  // The key is OURS and `SPECIALISTS.research.tools` filters on it. Unlike the hosted era, it is
  // ALSO the name the SDK emits on the tool-call part — which is what makes the by-name count safe.
  // Phase 39: `readPage` rides the same record — one flag builds both, so a search-granted agent
  // can always read what it found and nothing else can read anything.
  expect(Object.keys(built)).toEqual(["webResearch", "readPage"]);
  // The load-bearing bit: a local tool HAS an execute. Without it nothing is called, and the tool
  // silently degrades to a no-op the model still believes it invoked.
  expect(typeof (built.webResearch as { execute?: unknown }).execute).toBe("function");
  // No provider-defined marker: it is not any vendor's tool, which is exactly why research is no
  // longer pinned to RESEARCH_MODEL's vendor.
  expect((built.webResearch as { id?: string }).id).toBeUndefined();
});

// The pure mapper is where the mistakes live — the network half needs a key, this half does not.
// Anything without a parseable absolute URL is dropped: a source the reader cannot open is not
// evidence, and `sources.length` is half of the honesty verdict.

// ── Phase 39 (RSCH-01): `readPage` reads ONLY what the run's own search returned ──────────────
//
// The containment is a Set inside the tool record: `webResearch` adds every parsed result URL,
// `readPage` refuses anything else BEFORE any network call. That is what keeps an injected page from
// steering the specialist to an arbitrary host — the model never names a host, it picks from what
// the provider returned. Fetch is stubbed per request URL so one test can drive both tools.
// MUTATION that turns this RED: drop the `returned.has(url)` guard in llm.ts.
const extractOpts = { toolCallId: "call-1", messages: [] } as never;
const PAGE_URL = "https://vendor.example/pricing";
const searchPayload = {
  results: [{ url: PAGE_URL, title: "Pricing", content: "snippet", score: 0.9 }],
};
const extractPayload = (raw: string) => ({ results: [{ url: PAGE_URL, raw_content: raw }] });
const tavilyFetch = (extract: unknown) =>
  vi.fn(async (input: unknown, _init?: RequestInit) => {
    const url = String(input);
    const body = url.endsWith("/extract") ? extract : searchPayload;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
type Exec = (input: unknown, opts: unknown) => Promise<Record<string, unknown>>;
const execs = () => {
  const built = buildWebResearchTool() as unknown as {
    webResearch: { execute: Exec };
    readPage: { execute: Exec };
  };
  return { search: built.webResearch.execute, read: built.readPage.execute };
};

test("readPage refuses a URL no search in this run returned — before any network call", async () => {
  vi.stubEnv("TAVILY_API_KEY", "k");
  const fetchMock = tavilyFetch(extractPayload("page"));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { read } = execs();
    const out = await read({ url: PAGE_URL, focus: "the price" }, extractOpts);
    expect(out.content).toBe("");
    expect(String(out.note)).toMatch(/not returned by a search/);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("readPage reads a page its own search returned, sends the focus as the rerank query, and bills a step", async () => {
  vi.stubEnv("TAVILY_API_KEY", "k");
  const fetchMock = tavilyFetch(extractPayload("The plan costs $49 a month."));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { search, read } = execs();
    await search({ query: "vendor pricing" }, extractOpts);
    const out = await read({ url: PAGE_URL, focus: "monthly price" }, extractOpts);
    expect(out).toEqual({
      url: PAGE_URL,
      content: "The plan costs $49 a month.",
      truncated: false,
    });
    const extractCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/extract"));
    expect(extractCall).toBeDefined();
    const sent = JSON.parse(String(extractCall?.[1]?.body));
    expect(sent).toMatchObject({
      urls: [PAGE_URL],
      extract_depth: "basic",
      query: "monthly price",
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("readPage caps the reads per run and reports a failed extraction as a note, never a throw", async () => {
  vi.stubEnv("TAVILY_API_KEY", "k");
  const fetchMock = tavilyFetch({ results: [], failed_results: [{ url: PAGE_URL, error: "403" }] });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { search, read } = execs();
    await search({ query: "vendor pricing" }, extractOpts);
    for (let i = 0; i < PAGE_READS_PER_RUN; i++) {
      const out = await read({ url: PAGE_URL, focus: "price" }, extractOpts);
      expect(String(out.note)).toMatch(/page read failed: 403/);
    }
    const capped = await read({ url: PAGE_URL, focus: "price" }, extractOpts);
    expect(String(capped.note)).toMatch(new RegExp(`read its ${PAGE_READS_PER_RUN} pages`));
    // The cap counts CALLS: exactly PAGE_READS_PER_RUN extract requests went out, not one more.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/extract"))).toHaveLength(
      PAGE_READS_PER_RUN,
    );
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("parseExtractResult caps the excerpt at PAGE_READ_CHARS and surfaces the provider's failure reason", () => {
  const long = "x".repeat(PAGE_READ_CHARS + 10);
  expect(parseExtractResult(extractPayload(long), PAGE_URL)).toEqual({
    content: "x".repeat(PAGE_READ_CHARS),
    truncated: true,
  });
  expect(
    parseExtractResult({ failed_results: [{ url: PAGE_URL, error: "timeout" }] }, PAGE_URL),
  ).toEqual({
    error: "timeout",
  });
  // A payload about some OTHER url is not this page's content.
  expect(
    parseExtractResult({ results: [{ url: "https://other", raw_content: "z" }] }, PAGE_URL),
  ).toEqual({
    error: "no content returned for that page",
  });
});

test("parseWebResults keeps parseable URLs, drops the rest, and never invents fields", () => {
  const rows = parseWebResults({
    results: [
      { url: "https://example.com/a", title: "A", content: "alpha" },
      { url: "not a url", title: "B", content: "beta" }, // unparseable → dropped
      { title: "C", content: "gamma" }, // no url at all → dropped
      { url: "https://example.com/d" }, // missing title/content → kept, empty strings
    ],
  });
  expect(rows.map((r) => r.url)).toEqual(["https://example.com/a", "https://example.com/d"]);
  expect(rows[0]).toEqual({ url: "https://example.com/a", title: "A", snippet: "alpha" });
  expect(rows[1]).toEqual({ url: "https://example.com/d", title: "", snippet: "" });
});

// ── The relevance floor — what restores the honesty verdict ──────────────────
//
// MEASURED against live Tavily: real research results score 0.60–0.81; the invented entity in
// fixture 33 returns NOTHING for exact-name searches and tops out at 0.51 for a loose one. The floor
// sits in that gap. It matters because `sources` aggregates across every search in a run, so one
// loose sub-question would otherwise drag near-misses in and make
// `declaredQuestionScope && sources.length === 0` unfireable — a run that found nothing reporting
// itself as sourced.
//
// MUTATION that turns this RED: drop the score check in parseWebResults.
test("parseWebResults drops near-miss results below the measured relevance floor", () => {
  const rows = parseWebResults({
    results: [
      { url: "https://example.com/real", title: "R", content: "x", score: 0.6022 }, // lowest real
      { url: "https://example.com/edge", title: "E", content: "x", score: WEB_RESULT_MIN_SCORE },
      { url: "https://example.com/near", title: "N", content: "x", score: 0.51 }, // fixture 33's best
      { url: "https://example.com/junk", title: "J", content: "x", score: 0.0409 },
    ],
  });
  expect(rows.map((r) => r.url)).toEqual([
    "https://example.com/real",
    "https://example.com/edge", // the floor is inclusive — only strictly-below is dropped
  ]);
});

test("parseWebResults keeps a result with NO score — absence is not low relevance", () => {
  // Discarding unscored rows would turn a provider change into an empty evidence list, which is the
  // silent-zero failure this path exists to avoid. Only an explicit low score drops a row.
  const rows = parseWebResults({ results: [{ url: "https://example.com/a", title: "A" }] });
  expect(rows).toHaveLength(1);
});

// The tool-result shape is NOT the API shape: `snippet` vs `content`, and no `score` (already
// filtered at execute time). Conflating them is one field rename away from emptying every source
// list, which is why this has its own mapper and its own test.
test("sourcesFromToolOutput reads our own tool output shape and drops unusable URLs", () => {
  expect(
    sourcesFromToolOutput({
      results: [
        { url: "https://example.com/a", title: "A", snippet: "alpha" },
        { url: "not a url", title: "B", snippet: "beta" },
        { title: "C", snippet: "gamma" },
      ],
    }),
  ).toEqual([{ url: "https://example.com/a", title: "A" }]);
  expect(sourcesFromToolOutput(undefined)).toEqual([]);
});

test("parseWebResults returns [] for junk rather than throwing into the agent loop", () => {
  // A tool that throws ends the specialist's whole run, so a malformed provider response must
  // degrade to "found nothing" — which the evidence verdict then reports honestly.
  for (const junk of [undefined, null, {}, { results: null }, { results: "nope" }, 42]) {
    expect(parseWebResults(junk)).toEqual([]);
  }
});

// ── 03.10-06 (UAT-E): buildHistoryBlock — the bounded conversation-so-far window ──────────────

test("buildHistoryBlock returns '' for absent/empty history (prompt byte-identical when historyless)", () => {
  expect(buildHistoryBlock(undefined)).toBe("");
  expect(buildHistoryBlock([])).toBe("");
});

test("buildHistoryBlock keeps only the NEWEST 10 of a longer history (most-recent win)", () => {
  const history = Array.from({ length: 14 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turn-${i}`,
  }));
  const block = buildHistoryBlock(history);
  expect(block).not.toContain("turn-3"); // oldest 4 dropped
  expect(block).toContain("turn-4"); // the newest 10 survive …
  expect(block).toContain("turn-13"); // … through the most recent
});

test("buildHistoryBlock truncates a >500-char message with a trailing ellipsis", () => {
  const block = buildHistoryBlock([{ role: "user", content: "x".repeat(600) }]);
  expect(block).toContain(`${"x".repeat(500)} …`);
  expect(block).not.toContain("x".repeat(501));
});

test("buildHistoryBlock renders the header line first, then User:/Assistant: labels oldest-first", () => {
  const block = buildHistoryBlock([
    { role: "user", content: "draft an email" },
    { role: "assistant", content: "what should the subject be?" },
  ]);
  const lines = block.split("\n");
  expect(lines[0]).toMatch(/^Conversation so far/);
  expect(lines[1]).toBe("User: draft an email");
  expect(lines[2]).toBe("Assistant: what should the subject be?");
});

// ── 03.4-02 Task 2: proposePlan group-mode refusal gate (CKPT-03, locked decision) ────────────
// Personalization is exclusive with a group send (a group is ONE combined email). proposePlan
// REFUSES a group plan that carries any personalization, telling the agent to switch to individual
// (explicit consent to individual sends) — facts read from the ROW, like the attachmentError gate.

async function fillTwoProposable(t: T, planId: Id<"plans">): Promise<void> {
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com", "alice@example.com"] });
  await call(t, planId, "setSubject", { subject: "Hi" });
  await call(t, planId, "draftBody", { intent: `${PERS} hello all` });
}

test("proposePlan refuses a GROUP plan that carries personalization (individual required)", async () => {
  const { t, planId } = await setup();
  await fillTwoProposable(t, planId);
  await call(t, planId, "setMode", { mode: "group" });
  await call(t, planId, "personalizeRecipient", {
    index: 1,
    instructions: `${PERS} warmer for bob`,
  });

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/individual/i); // tells the agent to switch to individual
  expect((await readPlan(t, planId))?.status).not.toBe("proposed"); // not proposed
});

test("proposePlan PROCEEDS for an INDIVIDUAL plan that carries personalization", async () => {
  const { t, planId } = await setup();
  await fillTwoProposable(t, planId);
  await call(t, planId, "setMode", { mode: "individual" });
  await call(t, planId, "personalizeRecipient", {
    index: 1,
    instructions: `${PERS} warmer for bob`,
  });

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/proposed/i);
  expect((await readPlan(t, planId))?.status).toBe("proposed");
});

test("proposePlan is unaffected for a GROUP plan with NO personalization (today's behavior)", async () => {
  const { t, planId } = await setup();
  await fillTwoProposable(t, planId);
  await call(t, planId, "setMode", { mode: "group" });

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/proposed/i);
  expect((await readPlan(t, planId))?.status).toBe("proposed");
});

// ── 03.5-02 Task 1: setSendTime tool (NL time → sendAt) + send-time context surfacing (SCHD-01) ─
// The tool parses a volunteered natural-language time with the CLIENT's clock+zone (never the
// model's, §2-D) and writes plan.sendAt ONLY on a resolved future instant; an ambiguous/past parse
// re-asks and writes nothing (SC2). The clock is threaded in via the __invokeCockpitTool shim's
// optional clientContext (pinned deterministically here — the same trick runCockpitAgent's SMOKE
// path uses offline).

// Pinned clock: 2020-01-01 12:00:00 UTC — a fixed "now" so every parse below is deterministic.
const PIN_CLOCK = { tz: "UTC", nowMs: Date.UTC(2020, 0, 1, 12, 0, 0) };
const callClock = (
  t: T,
  planId: Id<"plans">,
  toolName: string,
  input: unknown,
  clientContext: { tz: string; nowMs: number } = PIN_CLOCK,
): Promise<string> =>
  t.action(internal.llm.__invokeCockpitTool, {
    tenantId: "t1",
    planId,
    toolName,
    input,
    clientContext,
  });

test("setSendTime resolves a relative time and patches sendAt (client clock, not the model's)", async () => {
  const { t, planId } = await setup();
  const res = await callClock(t, planId, "setSendTime", { text: "in 2 hours" });
  expect(res).not.toMatch(/ambiguous|passed|couldn't/i);
  // resolved off the pinned nowMs — 2h later, deterministic (the model NEVER supplies "now", §2-D).
  expect((await readPlan(t, planId))?.sendAt).toBe(PIN_CLOCK.nowMs + 2 * 3_600_000);
});

test("setSendTime re-asks on an AMBIGUOUS time and writes NOTHING (SC2 — never guess)", async () => {
  const { t, planId } = await setup();
  const res = await callClock(t, planId, "setSendTime", { text: "4am" }); // bare AM, no day → ambiguous
  expect(res).toMatch(/ambiguous/i);
  expect((await readPlan(t, planId))?.sendAt).toBeUndefined(); // no write
});

test("setSendTime re-asks on a PAST time and writes NOTHING (SC2 — never silently send)", async () => {
  const { t, planId } = await setup();
  const res = await callClock(t, planId, "setSendTime", { text: "today at 8am" }); // before the pinned noon
  expect(res).toMatch(/pass/i);
  expect((await readPlan(t, planId))?.sendAt).toBeUndefined(); // no write
});

test("setSendTime re-asks on a TOO-FAR time and writes NOTHING (SCHD-01 — never a silent clamp)", async () => {
  const { t, planId } = await setup();
  // 169 hours out is past the 7-day horizon (168h) — beyond what a Gmail token reliably survives.
  const res = await callClock(t, planId, "setSendTime", { text: "in 169 hours" });
  expect(res).toMatch(/further out|reliably schedule|sooner/i);
  expect((await readPlan(t, planId))?.sendAt).toBeUndefined(); // no write — fail fast in conversation
});

test("setSendTime without a client clock points to the picker and writes NOTHING (§2-D)", async () => {
  const { t, planId } = await setup();
  // `call` builds the tools with NO clientContext — the tool refuses to invent a clock and defers
  // to the date picker (Wave 3's confirm-source-of-truth), never taking "now"/tz from the model.
  const res = await call(t, planId, "setSendTime", { text: "in 2 hours" });
  expect(res).toMatch(/picker|timezone/i);
  expect((await readPlan(t, planId))?.sendAt).toBeUndefined();
});

test("buildAgentContext surfaces the resolved send time as an absolute instant (user tz)", () => {
  const ctx = buildAgentContext({ sendAt: Date.UTC(2020, 0, 1, 14, 0, 0) }, "UTC");
  expect(ctx).toMatch(/Send time:/);
  expect(ctx).toMatch(/2020/); // the absolute date the model confirms — not a raw epoch
});

test("buildAgentContext shows immediate-on-approve when no sendAt is set", () => {
  const ctx = buildAgentContext({});
  expect(ctx).toMatch(/Send time:.*immediate/i);
});

// ── 03.7-03: the briefing tools under the TOOLLESS-INGESTION invariant (CKPT-04 / SC-2/3/4) ──────
// briefInbox is the ONLY path that touches raw message bodies, and it hands the tool-bearing loop a
// COUNTS-ONLY string — bodies AND gists stay out of the model's tool context. These are the RUNTIME
// half of the SC-2 enforcement (llmRedaction.test.ts holds the static-scan half).
//
// The needle is `attacker@evil.example`, which the seeded fixture carries ONLY inside a message
// BODY (smoke.seedInboxFixture, 03.7-02) — so its absence from a tool return / audit payload proves
// no body text crossed that boundary. baseMs is pinned to PIN_CLOCK.nowMs (== llm.ts SMOKE_NOW_MS),
// so the fixture's today/yesterday/this-week buckets are deterministic offline.
const NEEDLE = "attacker@evil.example";

async function setupBriefing(): Promise<{ t: T; planId: Id<"plans"> }> {
  const { t, planId } = await setup();
  // offlineDigest: true → digestInbox short-circuits to a deterministic digest (zero model calls).
  await t.mutation(internal.smoke.seedInboxFixture, {
    tenantId: "t1",
    offlineDigest: true,
    baseMs: PIN_CLOCK.nowMs,
  });
  return { t, planId };
}

test("briefInbox returns a COUNTS-ONLY string — no body text reaches the loop (SC-2)", async () => {
  const { t, planId } = await setupBriefing();
  const reply = await callClock(t, planId, "briefInbox", { range: "today" });

  // THE invariant: the loop-visible return carries counts, never a body (or even a gist).
  expect(reply, "briefInbox leaked body text into the tool-bearing loop").not.toContain(NEEDLE);
  // UAT-F3: ONE set of code-owned numbers — the same listedCount + isNeedsYou-counted needsYou
  // the card masthead shows, so the agent's sentence can never contradict the panel.
  expect(reply).toMatch(/Briefing ready: \d+ messages, \d+ need you/);
  expect(reply).toMatch(/\d+ summarized/);
  expect(reply).toMatch(/workspace panel/i);
});

test("briefInbox persists a briefings row whose sender/ts are CODE-owned (ADR-004, SC-4)", async () => {
  const { t, planId } = await setupBriefing();
  await callClock(t, planId, "briefInbox", { range: "today" });

  const row = await t.run((ctx) => ctx.db.query("briefings").first());
  expect(row, "no briefings row was written").not.toBeNull();
  expect(row!.items.length).toBeGreaterThan(0);
  expect(row!.tz).toBe("UTC");
  expect(row!.range).toBe("today");

  // sender + ts come from the FIXTURE META (joinDigest), never from the digest — the model has no
  // schema field for either. The reply fixture is seeded at baseMs - 1h and asks for a reply.
  const sarah = row!.items.find((i: { sender: string }) => i.sender.includes("Sarah Chen"));
  expect(sarah, "the code-owned sender never made it onto the row").toBeDefined();
  expect(sarah!.sender).toBe("Sarah Chen <sarah.chen@example.com>");
  expect(sarah!.ts).toBe(PIN_CLOCK.nowMs - 3_600_000);
  expect(sarah!.bucket).toBe("today");

  // SC-4: the "Needs you" triage comes from the schema-validated digest (needsReply/deadline).
  const needsYou = row!.items.filter((i: { needsReply: boolean }) => i.needsReply);
  expect(needsYou.length).toBeGreaterThan(0);
  expect(needsYou[0]!.deadline).toBeTruthy();
});

test("briefInbox writes exactly ONE refs-only briefing.created audit row (§4, SC-3)", async () => {
  const { t, planId } = await setupBriefing();
  await callClock(t, planId, "briefInbox", { range: "today" });

  const created = await t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), "briefing.created"))
      .collect(),
  );
  expect(created).toHaveLength(1);
  // Counts + ids ONLY — a gist/sender/subject here would make the audit log a PII honeypot (§4).
  expect(Object.keys(created[0]!.payload as object).sort()).toEqual([
    "briefingId",
    "digestedCount",
    "listedCount",
    "range",
  ]);
  expect(JSON.stringify(created[0]!.payload)).not.toContain(NEEDLE);
});

test("digestInbox (smoke) emits a non-empty cross-message synopsis + a collapse-exercisable newsletter row (Gap 1.1/1.3)", async () => {
  const { t } = await setup();
  // The toolless digest itself, driven on its offline path: it returns the DigestBatch that
  // briefInbox persists. The synopsis is the model's ONE cross-message clause (the lede), and
  // the offline path must deterministically include ≥1 newsletter item so plan 08's noise-collapse
  // path is exercisable offline rather than only eyeballed live.
  const batch = await t.action(internal.llm.digestInbox, {
    tenantId: "t1",
    messages: [
      { index: 0, from: "a@example.com", subject: "Re: contract", body: "please reply" },
      { index: 1, from: "b@example.com", subject: "Weekly digest", body: "newsletter body" },
      { index: 2, from: "c@example.com", subject: "FYI", body: "for your information" },
    ],
    smoke: true,
  });

  // A non-empty synopsis string — the lede the briefings row will carry (never a count/sender/date).
  expect(typeof batch.synopsis).toBe("string");
  expect(
    batch.synopsis.length,
    "digestInbox produced an empty synopsis on the smoke path",
  ).toBeGreaterThan(0);
  // Exactly one newsletter row (the non-needsReply item #1) so collapseNoise has something to fold,
  // while item #0 stays the needsReply action row.
  expect(batch.items.filter((i) => i.category === "newsletter").length).toBe(1);
  expect(batch.items.find((i) => i.category === "newsletter")!.needsReply).toBe(false);
  expect(batch.items[0]!.needsReply).toBe(true);
});

test("briefInbox persists the digest synopsis on the briefings row (Gap 1.1)", async () => {
  const { t, planId } = await setupBriefing();
  await callClock(t, planId, "briefInbox", { range: "today" });

  const row = await t.run((ctx) => ctx.db.query("briefings").first());
  expect(row, "no briefings row was written").not.toBeNull();
  // The synopsis rides the ROW (the content plane), never the counts-only loop return.
  expect(typeof row!.synopsis).toBe("string");
  expect(row!.synopsis!.length, "the synopsis did not reach the briefings row").toBeGreaterThan(0);
});

test("listInbox returns sender LABELS + subjects + a count — never an address, snippet or body", async () => {
  const { t, planId } = await setupBriefing();
  const reply = await callClock(t, planId, "listInbox", { range: "today" });

  expect(reply).toContain("Sarah Chen"); // the display-name LABEL
  expect(reply).toContain("Re: Q3 numbers"); // the subject
  expect(reply).toMatch(/\d+ message/);
  // §2-D: an address never crosses to the model, exactly as with recipients.
  expect(reply, "listInbox leaked a raw address to the model").not.toContain(
    "sarah.chen@example.com",
  );
  // Snippets are third-party content too — the strictest reading keeps them out of the loop.
  expect(reply, "listInbox leaked a snippet").not.toContain("before the board call");
  expect(reply, "listInbox leaked body text").not.toContain(NEEDLE);
});

// ── 03.11-04 (RPLY-01): replyToMessage — server-side resolve → recipient-by-ref → toolless draft ──
// The one governed tool that turns "reply to X" into a real reply in ONE turn: resolves the target
// server-side from a fuzzy ref, sets recipient BY REF (no panel), the Re: subject + threading, and
// drafts the body toollessly. Returns LABELS/COUNTS only. Driven offline over the seeded fixture
// (fix-reply = Sarah Chen, "Re: Q3 numbers", thread-reply-1). The reply intent carries SMOKE:: so
// draftReply short-circuits to a deterministic offline body (zero model calls).

test("replyToMessage resolves ONE match by ref: recipient-by-ref + Re: subject + threading, NO panel, label-not-address", async () => {
  const { t, planId } = await setupBriefing();
  const res = await callClock(t, planId, "replyToMessage", {
    intent: `${SMOKE} I'll send the figures Friday`,
    sender: "Sarah",
  });

  // The return is a LABEL + Re: subject — never the address, the Message-ID, or the body.
  expect(res).toContain("Sarah Chen"); // the display-name label (#1)
  expect(res, "the From address leaked to the loop").not.toContain("sarah.chen@example.com");
  expect(res, "the Message-ID leaked to the loop").not.toContain("<CAF-reply-1@mail.gmail.com>");

  const plan = await readPlan(t, planId);
  // Recipient set BY REF, no panel round-trip.
  expect(plan?.recipients).toEqual(["sarah.chen@example.com"]);
  expect(plan?.recipientNames?.["sarah.chen@example.com"]).toBe("Sarah Chen");
  expect(
    plan?.candidates ?? [],
    "replyToMessage wrote candidates — it must NOT round-trip a panel",
  ).toEqual([]);
  // Re: subject (not doubled) + the four threading fields, server-side.
  expect(plan?.subject).toBe("Re: Q3 numbers");
  expect(plan?.replyToMessageId).toBe("fix-reply");
  expect(plan?.replyThreadId).toBe("thread-reply-1");
  expect(plan?.inReplyTo).toBe("<CAF-reply-1@mail.gmail.com>");
  expect(plan?.references).toBe("<CAF-reply-1@mail.gmail.com>");
  // Body drafted toollessly (the deterministic offline draftReply body).
  expect(plan?.body).toBeTruthy();
});

test("replyToMessage narrows by subject to a single target", async () => {
  const { t, planId } = await setupBriefing();
  const res = await callClock(t, planId, "replyToMessage", {
    intent: `${SMOKE} sounds good`,
    subject: "Q3",
  });
  expect(res).toContain("Sarah Chen");
  expect((await readPlan(t, planId))?.replyToMessageId).toBe("fix-reply");
});

test("replyToMessage on 0 matches clarifies and writes NOTHING (no-guess, never substitute)", async () => {
  const { t, planId } = await setupBriefing();
  const res = await callClock(t, planId, "replyToMessage", {
    intent: `${SMOKE} hi`,
    sender: "Nonexistent Person",
  });
  expect(res).toMatch(/couldn't find|could not find/i);
  const plan = await readPlan(t, planId);
  expect(plan?.recipients ?? []).toEqual([]); // nothing set
  expect(plan?.subject).toBeUndefined();
  expect(plan?.replyThreadId).toBeUndefined();
});

test("replyToMessage on 2+ matches lists candidates BY LABEL and asks — writes NOTHING, no address", async () => {
  const { t, planId } = await setupBriefing();
  // "example.com" matches three senders (Sarah, Tom, Priya) — ambiguous, so it must ask.
  const res = await callClock(t, planId, "replyToMessage", {
    intent: `${SMOKE} thanks`,
    sender: "example.com",
  });
  expect(res).toMatch(/which one|found \d+ messages/i);
  expect(res, "candidate list leaked an address").not.toContain("@"); // labels only (§2-D)
  const plan = await readPlan(t, planId);
  expect(plan?.recipients ?? []).toEqual([]); // never picked for the user
  expect(plan?.replyThreadId).toBeUndefined();
});

test("replyToMessage over an INJECTION message addresses the real From, never the injected needle", async () => {
  const { t, planId } = await setupBriefing();
  // fix-injection's From is no-reply@example.net; its BODY carries attacker@evil.example.
  const res = await callClock(t, planId, "replyToMessage", {
    intent: `${SMOKE} noted`,
    sender: "Notifications",
  });
  const plan = await readPlan(t, planId);
  expect(plan?.recipients).toEqual(["no-reply@example.net"]); // the From, never the injected address
  expect(JSON.stringify(plan), "the injected needle became a plan field").not.toContain(NEEDLE);
  expect(res, "the injected needle reached the loop").not.toContain(NEEDLE);
});

test("both briefing tools degrade conversationally with no mailbox — fallback + reconnect, no throw", async () => {
  // No fixture seeded and no Gmail token → the not_connected branch (resolveContacts precedent).
  const { t, planId } = await setup();

  for (const toolName of ["listInbox", "briefInbox"]) {
    const reply = await callClock(t, planId, toolName, { range: "today" });
    expect(reply, `${toolName} did not degrade conversationally`).toMatch(/mailbox/i);
    expect(reply).toMatch(/reconnect/i);
  }
  // Nothing was read, so nothing may be persisted.
  expect(await t.run((ctx) => ctx.db.query("briefings").first())).toBeNull();

  const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
  expect(notifs.filter((n) => n.kind === "gmail_reconnect").length).toBe(2);
});

// ── 10-02 (VGND-01/BETA-05): searchVault — the governed read-only vault-grounding tool ──────────
// Drives the tool directly through __invokeCockpitTool with a SMOKE::<docId> query (offline, no
// embedding network, no OPENAI_API_KEY). Proves: genuine hydrated fenced retrieval (not a swallowed
// UNAUTHENTICATED no-match), honest fail-open on a miss (SC1), refs-only vault.searched audit (SC3,
// §4), and tenant-B-empty isolation (BETA-05).
const VAULT_NEEDLE = "ACME-Q3-REVENUE-SECRET-BODY";

// Minimal groundable vault doc under `tenantId`. ownedDocsMeta/getDoc scope on tenantId only (no
// status filter), so these fields are the whole seed.
const seedVaultDoc = (t: T, tenantId: string, text: string): Promise<Id<"vaultDocuments">> =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Q3 Report",
      kind: "upload",
      category: "business",
      source: "upload",
      mimeType: "text/plain",
      size: text.length,
      contentHash: "hash-q3",
      text,
      status: "ready",
      createdAt: Date.now(),
    }),
  );

test("searchVault hydrates a fenced chunk into the loop + writes a vaultSources card (VGND-01)", async () => {
  const { t, planId } = await setup();
  const docId = await seedVaultDoc(t, "t1", `The company report: ${VAULT_NEEDLE} grew 20%.`);

  const reply = await call(t, planId, "searchVault", { query: `SMOKE::${docId}` });

  // The SC2 fence AND the real chunk text — this assertion CANNOT pass on the fail-open path (no
  // fence there), so it proves genuine retrieval via the identity-less internalAction.
  expect(reply).toContain("<vault_context");
  expect(reply).toContain(VAULT_NEEDLE);
  // The chunk carries its SOURCE TITLE into the loop. Every specialist body says "cite the document
  // title beside every claim"; without this the titles reached only the UI card and that
  // instruction was unsatisfiable — no grounded memo could ever name what it retrieved.
  expect(reply).toContain("[Q3 Report]");

  // The content-plane source card exists: titles=labels-to-UI, count===1.
  const row = await t.run((ctx) => ctx.db.query("vaultSources").first());
  expect(row, "no vaultSources row was written on a hit").not.toBeNull();
  expect(row!.count).toBe(1);
  expect(row!.titles).toEqual(["Q3 Report"]);
  expect(row!.threadId).toBe("thread1");
});

test("searchVault fails open on a no-match — honest nudge, never throws (SC1)", async () => {
  const { t, planId } = await setup();

  const reply = await call(t, planId, "searchVault", { query: "SMOKE::" }); // empty seed → no docs
  expect(reply).toMatch(/don't have anything|upload/i);
  expect(reply).not.toContain("<vault_context"); // no fence on a miss

  // No source card written on a miss (nothing to show).
  expect(await t.run((ctx) => ctx.db.query("vaultSources").first())).toBeNull();
});

test("searchVault writes a refs-only vault.searched audit — queryHash + resultCount ONLY (SC3, §4)", async () => {
  const { t, planId } = await setup();
  const docId = await seedVaultDoc(t, "t1", `Secret figures: ${VAULT_NEEDLE}.`);
  const query = `SMOKE::${docId}`;

  await call(t, planId, "searchVault", { query });

  const rows = await t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), "vault.searched"))
      .collect(),
  );
  expect(rows).toHaveLength(1);
  const payload = rows[0]!.payload as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(["queryHash", "resultCount"]);
  expect(payload.queryHash).toBe(await contentHash(query));
  expect(payload.resultCount).toBe(1);
  // Neither the raw query nor any chunk substring may reach the payload (§4).
  const json = JSON.stringify(payload);
  expect(json).not.toContain("SMOKE::");
  expect(json).not.toContain(VAULT_NEEDLE);
});

test("searchVault gives tenant B NOTHING of tenant A's corpus (BETA-05)", async () => {
  const { t } = await setup();
  const t1Doc = await seedVaultDoc(t, "t1", `Tenant A private: ${VAULT_NEEDLE}.`);
  const t2Plan = await t.mutation(internal.plans.insertPlan, {
    tenantId: "t2",
    threadId: "thread2",
  });

  const reply = await t.action(internal.llm.__invokeCockpitTool, {
    tenantId: "t2",
    planId: t2Plan,
    toolName: "searchVault",
    input: { query: `SMOKE::${t1Doc}` }, // t2 asking for t1's doc id
  });
  expect(reply).toMatch(/don't have anything|upload/i); // tenant B gets the honest no-match
  expect(reply).not.toContain(VAULT_NEEDLE); // never A's content
});

// ── A memo plan must NOT be described to the model as an email ────────────────────────────────
//
// Live-verified defect (2026-07-26): after "Act on this" staged a `kind: "memo"` plan
// (evaluations.ts:709-712 — recipients [], subject "Next step: <gap>"), the NEXT cockpit turn
// replied "The subject is set, and the email will be sent individually to each recipient. Would
// you like to proceed…". That was not a mis-route — buildAgentContext had rendered the memo under
// "Current email plan:" with Recipients/Send mode/Send time slots, and the model read it faithfully.
//
// Phase 15 generalized the EXECUTOR (ACTION_TYPES/actionTypeOf/armFor) but not the model-facing
// CONTEXT. These assertions are what stops that half-generalization from returning.
test("buildAgentContext describes a memo plan as a memo — never as an email (ACTN-01)", () => {
  const ctx = buildAgentContext({
    kind: "memo",
    subject: "Next step: Customer doesn't pay for themselves in 30 days.",
    body: "> Produced by the **money-model-designer** specialist.",
  });

  // Assert on the SLOT STRUCTURE, not on word presence: the memo block deliberately says the words
  // "email"/"recipients" in NEGATION ("A memo is NOT an email… do not offer to add recipients"),
  // which is the part that steers the model. A bare /email/i ban would forbid the very sentence
  // doing the work. What must be absent is the email plan's *offered fields*.
  expect(ctx).not.toContain("Current email plan:"); // the header that mislabelled the action type
  expect(ctx).toMatch(/^Current memo plan/); // and it must say what it actually is
  expect(ctx).not.toMatch(/^Recipients \(/m); // no recipient list to populate
  expect(ctx).not.toMatch(/^Send mode:/m); // a memo is never sent to anyone
  expect(ctx).not.toMatch(/^Send time:/m);
  expect(ctx).not.toMatch(/^Attachments \(/m);
  expect(ctx).toContain("Next step: Customer doesn't pay for themselves in 30 days."); // subject survives
});

test("buildAgentContext still describes an email plan as an email (no kind ⇒ email, actionTypeOf)", () => {
  const ctx = buildAgentContext({ recipients: ["bob@example.com"], subject: "Q3 numbers" });
  expect(ctx).toContain("Current email plan:"); // the absent-kind default is unchanged
  expect(ctx).toMatch(/Send mode/); // email slots still offered
});

const ACTION_CONTEXT_HEADERS = {
  email: /^Current email plan:/,
  memo: /^Current memo plan/,
  calendar_event: /^Current calendar event plan/,
  media: /^Current media plan/,
  crm_write: /^Current CRM plan/,
  finance_write: /^Current figure-update plan/,
  calendar_manage: /^Current calendar-management plan/,
} as const satisfies Record<ActionType, RegExp>;

test("buildAgentContext has one explicit semantic branch for EVERY ACTION_TYPES member", () => {
  // Exact key equality is the runtime half of the switch's compile-time `assertNever`: a widened
  // registry must make this test visit the new member, not merely leave an uncalled branch behind.
  expect(Object.keys(ACTION_CONTEXT_HEADERS)).toEqual([...ACTION_TYPES]);

  for (const actionType of ACTION_TYPES) {
    const ctx = buildAgentContext(actionType === "email" ? {} : { kind: actionType });
    expect(ctx, `wrong context branch for ${actionType}`).toMatch(
      ACTION_CONTEXT_HEADERS[actionType],
    );
    expect(
      Object.values(ACTION_CONTEXT_HEADERS).filter((header) => header.test(ctx)),
      `${actionType} matched more than one action-context header`,
    ).toHaveLength(1);

    if (actionType !== "email") {
      expect(ctx).not.toContain("Current email plan:");
      expect(ctx).not.toMatch(/^Recipients \(|^Send mode:|^Send time:|^Attachments \(/m);
    }
  }
});

// ── Phase 17-03 Task 1: checkAvailability — read-only busy ranges in the governed loop ────────
const CALENDAR_TITLE_NEEDLE = "ZZQX private event title";
const CALENDAR_ATTENDEE_NEEDLE = "private-attendee@example.com";
const CALENDAR_DESCRIPTION_NEEDLE = "ZZQX private event description";
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtCalendarInstant = (ms: number, tz = "UTC") =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(
    ms,
  );

test("checkAvailability returns the busy-block count and every displayed block time, never event content", async () => {
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs,
  });

  const reply = await callClock(t, planId, "checkAvailability", { range: "today" });

  expect(reply).toMatch(/2 busy block/i);
  for (const offset of [1, 2, 4, 5.5]) {
    expect(reply).toContain(fmtCalendarInstant(PIN_CLOCK.nowMs + offset * 3_600_000));
  }
  expect(reply).not.toContain(CALENDAR_TITLE_NEEDLE);
  expect(reply).not.toContain(CALENDAR_ATTENDEE_NEEDLE);
  expect(reply).not.toContain(CALENDAR_DESCRIPTION_NEEDLE);
});

test("checkAvailability says the user is free when the selected window has zero busy blocks", async () => {
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs + 8 * DAY_MS,
  });

  const reply = await callClock(t, planId, "checkAvailability", { range: "today" });

  expect(reply).toMatch(/free|no busy/i);
});

// ── ACTN-02: the availability read must leave a row the CALENDAR card can render ───────────────
//
// THE DEFECT THESE EXIST FOR, in the owner's words: "it just replied with a message ... no card in
// the workspace." The tool answered correctly in chat and wrote nothing down, so the canvas stayed
// blank and the agent looked detached from its own actions. The assertions below are on the STORED
// ROW, never on the reply string — the reply was already right when the bug was live, so asserting
// it would pass with the card still missing.

test("a BUSY availability read writes the blocks to the content plane for the card", async () => {
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs,
  });

  await callClock(t, planId, "checkAvailability", { range: "today" });

  const views = await t.run((ctx) => ctx.db.query("calendarViews").collect());
  expect(views).toHaveLength(1);
  expect(views[0].busy).toHaveLength(2); // the same two blocks the reply reports
  expect(views[0].range).toBe("today");
  expect(views[0].tz).toBe(PIN_CLOCK.tz); // the zone the read was bucketed in, not the browser's
  // Instants are code-owned and land unrounded — the card formats, the row stores.
  expect(views[0].busy[0].startMs).toBeLessThan(views[0].busy[0].endMs);
});

test("an EMPTY availability read STILL writes a row — a clear calendar is an answer, not a blank", async () => {
  // This is the case the owner was most likely to read as broken: ask what's on the calendar, get
  // prose saying "you're free", and see an empty canvas that looks identical to a failure. A
  // `busy.length > 0` guard anywhere in the write path makes this test red.
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs + 8 * DAY_MS, // fixture lands outside the window ⇒ zero busy blocks
  });

  await callClock(t, planId, "checkAvailability", { range: "today" });

  const views = await t.run((ctx) => ctx.db.query("calendarViews").collect());
  expect(views).toHaveLength(1); // the row EXISTS...
  expect(views[0].busy).toEqual([]); // ...and says, positively, that nothing is scheduled
});

test("the stored row records WHICH calendar was read, so the card cannot mislabel it", async () => {
  // Mislabelling is not cosmetic here: a user who connected both providers and is shown the wrong
  // one has no way to tell an empty Outlook calendar from a full Google one.
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs,
  });

  await callClock(t, planId, "checkAvailability", { range: "today" });

  const views = await t.run((ctx) => ctx.db.query("calendarViews").collect());
  expect(views[0].provider).toBe("google"); // the default branch, explicitly recorded
});

test("checkAvailability turns reauth into a reconnect notification and conversational fallback", async () => {
  const { t, planId } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId: "t1",
      refreshToken: "refresh-token",
      accessToken: "access-token",
      expiresAt: PIN_CLOCK.nowMs + 3_600_000,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      updatedAt: PIN_CLOCK.nowMs,
    }),
  );

  const reply = await callClock(t, planId, "checkAvailability", { range: "today" });

  expect(reply).toMatch(/calendar/i);
  expect(reply).toMatch(/reconnect/i);
  const notifications = await t.run((ctx) => ctx.db.query("notifications").collect());
  expect(notifications.filter((row) => row.kind === "gmail_reconnect")).toHaveLength(1);
});

// ── 17-07: explicit provider selection, and the reconnect that must follow it ──────────────────
//
// THE DEFECT THIS BLOCK EXISTS FOR: a Microsoft calendar outage that writes a `gmail_reconnect`
// row sends the user to the GOOGLE consent screen to fix an Outlook connection. The banner clears,
// the real problem stands, and the next check fails identically — a dead end that looks like it was
// handled.
test("a Microsoft outage writes a MICROSOFT reconnect row, never a gmail_reconnect one", async () => {
  const { t, planId } = await setup();
  // No Microsoft grant at all: the read fails at `not_connected`.
  const reply = await callClock(t, planId, "checkAvailability", {
    range: "today",
    provider: "microsoft",
  });

  expect(reply).toMatch(/reconnect Microsoft/i);
  expect(reply).not.toMatch(/reconnect Google/i);
  const kinds = (await t.run((ctx) => ctx.db.query("notifications").collect())).map((r) => r.kind);
  expect(kinds).toContain("microsoft_calendar_reconnect");
  expect(kinds).not.toContain("gmail_reconnect");
});

test("an ABSENT provider still reads Google — every shipped prompt and fixture keeps working", async () => {
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs,
  });
  // The Google fixture answers, which it could only do on the Google branch.
  const reply = await callClock(t, planId, "checkAvailability", { range: "today" });
  expect(reply).toMatch(/2 busy block/i);
});

test("proposeCalendarEvent stages the provider as a FACT ON THE ROW, and absent means google", async () => {
  for (const [provider, expected] of [
    ["microsoft", "microsoft"],
    [undefined, "google"],
  ] as const) {
    const { t, planId } = await setup();
    const reply = await callClock(t, planId, "proposeCalendarEvent", {
      title: "Quarterly review",
      when: "tomorrow at 9am",
      durationMinutes: 30,
      ...(provider ? { provider } : {}),
    });
    // The staged row is the oracle — `executePlan` routes on stored state after Approve, never on
    // what the model said in conversation.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.calendarProvider ?? "google").toBe(expected);
    expect(plan?.status).toBe("proposed");
    // And the confirmation names the calendar, because the user is about to approve a write to it.
    expect(reply).toMatch(expected === "microsoft" ? /Microsoft Calendar/ : /Google Calendar/);
  }
});

test("staging touches no provider — the network is never reached before Approve", async () => {
  const { t, planId } = await setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await callClock(t, planId, "proposeCalendarEvent", {
    title: "Quarterly review",
    when: "tomorrow at 9am",
    durationMinutes: 30,
    provider: "microsoft",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("checkAvailability without clientContext refuses before freeBusy is called", async () => {
  const { t, planId } = await setup();
  await t.mutation(internal.smoke.seedCalendarFixture, {
    tenantId: "t1",
    baseMs: PIN_CLOCK.nowMs,
  });

  const reply = await call(t, planId, "checkAvailability", { range: "today" });

  expect(reply).toMatch(/local time|timezone/i);
  expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([]);
});

// ── Phase 17-03 Task 2: proposeCalendarEvent — stage only; Approve owns the external write ─────
const expectCalendarStageEmpty = async (t: T, planId: Id<"plans">) => {
  const plan = await readPlan(t, planId);
  expect(plan?.status).toBe("collecting");
  expect(plan?.kind).toBeUndefined();
  expect(plan?.eventTitle).toBeUndefined();
  expect(plan?.eventStartMs).toBeUndefined();
  expect(plan?.eventDurationMs).toBeUndefined();
  expect(plan?.eventTz).toBeUndefined();
  expect(plan?.calendarEventId).toBeUndefined();
  expect(plan?.calendarRunId).toBeUndefined();
};

test("proposeCalendarEvent stages all four fields at proposed, never fetches or crosses Approve", async () => {
  const { t, planId } = await setup();
  const fetchMock = vi.fn(() => {
    throw new Error("a staging tool must never call fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  const when = "in 2 hours";

  try {
    const reply = await callClock(t, planId, "proposeCalendarEvent", {
      title: CALENDAR_TITLE_NEEDLE,
      when,
      durationMinutes: 10,
    });
    const parsed = parseSendTime(when, PIN_CLOCK.nowMs, PIN_CLOCK.tz, CALENDAR_HORIZON_MS);
    if (parsed.kind !== "resolved") throw new Error("invalid resolved-time test fixture");

    expect(reply).toMatch(/confirm|approve|proposed|staged/i);
    const plan = await readPlan(t, planId);
    expect(plan?.kind).toBe("calendar_event");
    expect(plan?.status).toBe("proposed");
    expect(plan?.eventTitle).toBe(CALENDAR_TITLE_NEEDLE);
    expect(plan?.eventStartMs).toBe(parsed.epochMs);
    expect(plan?.eventDurationMs).toBe(15 * 60_000); // lower clamp, not a model-provided clock
    expect(plan?.eventTz).toBe(PIN_CLOCK.tz);
    expect(plan?.status).not.toMatch(/approved|delivering|done/);
    expect(plan?.calendarEventId).toBeUndefined();
    expect(plan?.calendarRunId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("proposeCalendarEvent resolves the same relative instant under different timezones", async () => {
  const utc = await setup();
  const dar = await setup();
  const when = "in 2 hours";

  await callClock(
    utc.t,
    utc.planId,
    "proposeCalendarEvent",
    { title: "UTC event", when, durationMinutes: 30 },
    { ...PIN_CLOCK, tz: "UTC" },
  );
  await callClock(
    dar.t,
    dar.planId,
    "proposeCalendarEvent",
    { title: "Dar event", when, durationMinutes: 30 },
    { ...PIN_CLOCK, tz: "Africa/Dar_es_Salaam" },
  );

  const utcStart = (await readPlan(utc.t, utc.planId))?.eventStartMs;
  const darStart = (await readPlan(dar.t, dar.planId))?.eventStartMs;
  expect(utcStart).toBe(PIN_CLOCK.nowMs + 2 * 3_600_000);
  expect(darStart).toBe(utcStart);
});

test("proposeCalendarEvent re-asks and writes nothing for ambiguous, past, or absent times", async () => {
  for (const when of ["4am", "today at 8am", "please schedule the proposal"]) {
    const { t, planId } = await setup();

    const reply = await callClock(t, planId, "proposeCalendarEvent", {
      title: "Do not stage",
      when,
      durationMinutes: 30,
    });

    expect(reply).toMatch(/ask|ambiguous|passed|specific time|detect/i);
    await expectCalendarStageEmpty(t, planId);
  }
});

test("proposeCalendarEvent accepts an event beyond email's seven-day horizon", async () => {
  const { t, planId } = await setup();
  const when = "in 240 hours";
  const parsed = parseSendTime(when, PIN_CLOCK.nowMs, PIN_CLOCK.tz, CALENDAR_HORIZON_MS);
  if (parsed.kind !== "resolved") throw new Error("calendar-horizon test fixture did not resolve");

  await callClock(t, planId, "proposeCalendarEvent", {
    title: "Ten-day planning session",
    when,
    durationMinutes: 60,
  });

  const plan = await readPlan(t, planId);
  expect(plan?.status).toBe("proposed");
  expect(plan?.eventStartMs).toBe(parsed.epochMs);
});

test("proposeCalendarEvent without clientContext refuses and leaves the plan untouched", async () => {
  const { t, planId } = await setup();

  const reply = await call(t, planId, "proposeCalendarEvent", {
    title: "No trusted clock",
    when: "in 2 hours",
    durationMinutes: 30,
  });

  expect(reply).toMatch(/local time|timezone/i);
  await expectCalendarStageEmpty(t, planId);
});

// ── 17-09: managed-event discovery and inspect-then-stage management ──────────────────────────

async function seedManagedToolEvent(
  t: T,
  planId: Id<"plans">,
  over: Partial<{
    tenantId: string;
    title: string;
    startMs: number;
    etag: string | undefined;
    attendeeFree: boolean;
  }> = {},
) {
  const etag = "etag" in over ? over.etag : '"stored"';
  return await t.mutation(internal.calendarEvents.upsertManaged, {
    tenantId: over.tenantId ?? "t1",
    sourcePlanId: planId,
    provider: "google",
    externalEventId: `evt_${over.title ?? Math.random()}`,
    ...(etag === undefined ? {} : { etag }),
    title: over.title ?? "Quarterly review",
    startMs: over.startMs ?? PIN_CLOCK.nowMs + 3_600_000,
    durationMs: 30 * 60_000,
    tz: PIN_CLOCK.tz,
    attendeeFree: over.attendeeFree ?? true,
  });
}

async function seedGoogleCalendarGrant(t: T) {
  await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId: "t1",
      refreshToken: "refresh-token",
      accessToken: "access-token",
      expiresAt: Date.now() + 3_600_000,
      scope: "https://www.googleapis.com/auth/calendar.events",
      updatedAt: Date.now(),
    }),
  );
}

const inspectedGoogleEvent = (over: { attendees?: unknown[]; etag?: string } = {}) =>
  new Response(
    JSON.stringify({
      id: "evt_provider",
      etag: over.etag ?? '"fresh"',
      summary: "Provider title",
      start: { dateTime: new Date(PIN_CLOCK.nowMs + 3_600_000).toISOString() },
      end: { dateTime: new Date(PIN_CLOCK.nowMs + 5_400_000).toISOString() },
      attendees: over.attendees ?? [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

test("listManagedCalendarEvents is bounded, stable-ref based, and strictly read-only", async () => {
  const { t, planId } = await setup();
  const newest = await seedManagedToolEvent(t, planId, {
    title: "Newest",
    startMs: PIN_CLOCK.nowMs + 50 * 3_600_000,
  });
  await seedManagedToolEvent(t, planId, { title: "Needs inspection", etag: undefined });
  await seedManagedToolEvent(t, planId, { title: "Has guests", attendeeFree: false });
  await seedManagedToolEvent(t, planId, { tenantId: "t2", title: "Foreign" });
  const fetchMock = vi.fn(() => {
    throw new Error("managed-event listing must never call a provider");
  });
  vi.stubGlobal("fetch", fetchMock);

  try {
    const reply = await call(t, planId, "listManagedCalendarEvents", {});
    expect(reply).toContain(`ref=${newest}`);
    expect(reply).toContain("Newest");
    expect(reply).not.toMatch(/Needs inspection|Has guests|Foreign/);
    expect(reply).toMatch(/2 other event\(s\).*omitted/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("listManagedCalendarEvents reports an honest empty result", async () => {
  const { t, planId } = await setup();
  expect(await call(t, planId, "listManagedCalendarEvents", {})).toMatch(
    /no Pikar-managed calendar events/i,
  );
});

test("proposeCalendarChange inspects once, copies the fresh etag, and only proposes", async () => {
  const { t, planId } = await setup();
  const managedEventId = await seedManagedToolEvent(t, planId);
  await seedGoogleCalendarGrant(t);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "fresh-access-token", expires_in: 3600 }))
    .mockResolvedValueOnce(inspectedGoogleEvent());
  vi.stubGlobal("fetch", fetchMock);

  try {
    const reply = await callClock(t, planId, "proposeCalendarChange", {
      managedEventId: String(managedEventId),
      operation: "update",
      title: "Updated title",
      when: "in 3 hours",
      durationMinutes: 45,
    });
    expect(reply).toMatch(/staged|approve/i);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one OAuth refresh, then one provider inspection
    const inspectCall = fetchMock.mock.calls[1] as unknown as [unknown, RequestInit | undefined];
    expect(inspectCall[1]?.method).toBeUndefined(); // inspection GET, never a provider write

    const plan = await readPlan(t, planId);
    expect(plan).toMatchObject({
      kind: "calendar_manage",
      status: "proposed",
      calendarManagedEventId: managedEventId,
      calendarExpectedEtag: '"fresh"',
      calendarOperation: "update",
      eventTitle: "Updated title",
      eventStartMs: PIN_CLOCK.nowMs + 3 * 3_600_000,
      eventDurationMs: 45 * 60_000,
    });
    expect(plan?.calendarRunId).toBeUndefined();
    expect(plan?.status).not.toMatch(/approved|delivering|done/);
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("proposeCalendarChange refuses ambiguous time and delete content before inspection", async () => {
  for (const input of [
    { operation: "update", when: "4am" },
    { operation: "delete", title: "Must not ride a delete" },
  ] as const) {
    const { t, planId } = await setup();
    const managedEventId = await seedManagedToolEvent(t, planId);
    const fetchMock = vi.fn(() => {
      throw new Error("invalid proposal must stop before provider inspection");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const reply = await callClock(t, planId, "proposeCalendarChange", {
        managedEventId: String(managedEventId),
        ...input,
      });
      expect(reply).toMatch(/nothing was staged/i);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await readPlan(t, planId))?.status).toBe("collecting");
    } finally {
      vi.unstubAllGlobals();
    }
  }
});

test("fresh attendees and reconnect both leave the plan untouched", async () => {
  const attendeeCase = await setup();
  const attendeeId = await seedManagedToolEvent(attendeeCase.t, attendeeCase.planId);
  await seedGoogleCalendarGrant(attendeeCase.t);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "fresh-access-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(inspectedGoogleEvent({ attendees: [{}] })),
  );
  try {
    expect(
      await callClock(attendeeCase.t, attendeeCase.planId, "proposeCalendarChange", {
        managedEventId: String(attendeeId),
        operation: "delete",
      }),
    ).toMatch(/attendees/i);
    expect((await readPlan(attendeeCase.t, attendeeCase.planId))?.status).toBe("collecting");
  } finally {
    vi.unstubAllGlobals();
  }

  const reconnectCase = await setup();
  const reconnectId = await seedManagedToolEvent(reconnectCase.t, reconnectCase.planId);
  expect(
    await callClock(reconnectCase.t, reconnectCase.planId, "proposeCalendarChange", {
      managedEventId: String(reconnectId),
      operation: "delete",
    }),
  ).toMatch(/reconnect/i);
  expect((await readPlan(reconnectCase.t, reconnectCase.planId))?.status).toBe("collecting");
});

test("foreign and missing managed-event refs are indistinguishable", async () => {
  const { t, planId } = await setup();
  const foreign = await seedManagedToolEvent(t, planId, { tenantId: "t2" });
  const missing = String(foreign).replace(/.$/, (last) => (last === "a" ? "b" : "a"));

  const foreignReply = await callClock(t, planId, "proposeCalendarChange", {
    managedEventId: String(foreign),
    operation: "delete",
  });
  const missingReply = await callClock(t, planId, "proposeCalendarChange", {
    managedEventId: missing,
    operation: "delete",
  });
  expect(foreignReply).toBe(missingReply);
  expect((await readPlan(t, planId))?.status).toBe("collecting");
});

// ── Phase 18 (ACTN-04): the createDocument tool ───────────────────────────────
// The surface the model actually calls. Everything before it in this phase is machinery; these
// rows pin what the machinery is FOR: one governed artifact in the tenant's vault, a sentence back
// (never bytes, never a URL, never a raw _id), and no external side effect anywhere in the body.

const CREATE_TOPIC = `${SMOKE} Quarterly one-pager`;
const SMOKE_TITLE = "Smoke Document"; // draftDocument's deterministic offline title

const vaultDocs = (t: T) => t.run((ctx) => ctx.db.query("vaultDocuments").collect());
const cardRows = (t: T) => t.run((ctx) => ctx.db.query("vaultSources").collect());
const auditRows = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());
const createdAudit = async (t: T) =>
  (await auditRows(t)).filter((r) => r.eventType === "document.created");

test("createDocument(long) saves ONE governed vault artifact with a derived PDF and returns a sentence", async () => {
  const { t, planId } = await setup();

  const reply = await call(t, planId, "createDocument", { topic: CREATE_TOPIC, form: "long" });

  const docs = await vaultDocs(t);
  expect(docs).toHaveLength(1);
  const doc = docs[0]!;
  // SC1: a ref-only return — the title, never bytes, never a URL, never the raw _id.
  expect(reply).toContain(SMOKE_TITLE);
  expect(reply).not.toContain(String(doc._id));
  expect(reply).not.toMatch(/https?:\/\/|%PDF|storageId/i);
  // The artifact of record is MARKDOWN for both forms; the PDF is a derived download.
  expect(doc.kind).toBe("created_document");
  expect(doc.mimeType).toBe("text/markdown");
  expect(doc.origin).toBe("agent");
  expect(doc.status).toBe("ready");
  // 26-11 (CONT-01): the THREADING ITSELF, not merely the validator shape. createdDocs.test.ts
  // calls insertCreatedDoc directly, so it can only prove the two args exist; this asserts that
  // llm.ts actually passes the plan's own ids THROUGH the tool. Both come from `readPlan()`, never
  // from a model-supplied argument -- otherwise the model could stamp a document with another
  // thread's provenance. MUTATION: drop the two fields at the insertCreatedDoc call site in llm.ts
  // and this reddens while createdDocs.test.ts stays green. That asymmetry is the whole point.
  expect(doc.sourcePlanId).toBe(planId);
  expect(doc.sourceThreadId).toBe(await t.run(async (ctx) => (await ctx.db.get(planId))?.threadId));
  expect(doc.storageId).toBeDefined(); // ⇒ PreviewModal's canDownload is true, for free
  expect(await t.run((ctx) => ctx.storage.getUrl(doc.storageId!))).not.toBeNull();

  // SC6: ONE Output-card row per turn, carrying the docId, the role, a snippet and the FORM (the
  // badge's only data source — nothing else in this suite catches its absence).
  const cards = await cardRows(t);
  expect(cards).toHaveLength(1);
  expect(cards[0]!.role).toBe("created");
  expect(cards[0]!.form).toBe("long");
  expect(cards[0]!.docIds).toEqual([doc._id]);
  expect(cards[0]!.titles).toEqual([SMOKE_TITLE]);
  expect(cards[0]!.count).toBe(1);
  expect(cards[0]!.snippet).toBeTruthy();

  // SC3: the audit row is refs/hashes/ids/enums/booleans ONLY (CLAUDE.md §4).
  const created = await createdAudit(t);
  expect(created).toHaveLength(1);
  const payload = created[0]!.payload as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(["form", "hasPdf", "topicHash", "vaultDocId"]);
  expect(payload.form).toBe("long");
  expect(payload.hasPdf).toBe(true);
  expect(payload.vaultDocId).toBe(String(doc._id));
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/Quarterly|one-pager/i); // never the topic
  expect(serialized).not.toContain(SMOKE_TITLE); // never the prose
});

test("createDocument(short) drafts with content-drafter and stores NO storageId (no Download button)", async () => {
  const { t, planId } = await setup();

  await call(t, planId, "createDocument", { topic: `${SMOKE} a LinkedIn post`, form: "short" });

  const doc = (await vaultDocs(t))[0]!;
  expect(doc.kind).toBe("created_content");
  expect(doc.mimeType).toBe("text/markdown"); // still markdown — the locked artifact of record
  // "No PDF for short-form" is the structural ABSENCE of storageId, not a flag and not a mime check.
  expect(doc.storageId).toBeUndefined();
  expect((await cardRows(t))[0]!.form).toBe("short");
  expect((await createdAudit(t))[0]!.payload).toMatchObject({ form: "short", hasPdf: false });
});

test("`form` selects the SKILL ROW — archiving content-drafter breaks ONLY short-form, and as a sentence", async () => {
  const { t, planId } = await setup();
  // The shipped retirement path (skills.ts:455) — a hand-rolled t.run patch would also have to
  // re-declare the schema type this file's `T` deliberately leaves generic.
  expect(await t.mutation(internal.skills.archiveSkill, { name: CONTENT_DRAFTER_SKILL })).toEqual({
    archived: true,
  });

  // A drafter failure is a RETURNED SENTENCE, never a throw out of the governed loop.
  const refused = await call(t, planId, "createDocument", {
    topic: `${SMOKE} a post`,
    form: "short",
  });
  expect(refused).toMatch(/couldn't|could not/i);
  expect(await vaultDocs(t)).toHaveLength(0); // nothing half-written
  expect(await cardRows(t)).toHaveLength(0);

  // Long-form is untouched: document-drafter is still active and still what `long` loads.
  const ok = await call(t, planId, "createDocument", { topic: CREATE_TOPIC, form: "long" });
  expect(ok).toContain(SMOKE_TITLE);
  expect(await vaultDocs(t)).toHaveLength(1);
});

test("N createDocument calls share ONE Output card carrying ALL N docIds (#index stays addressable)", async () => {
  const { t, planId } = await setup();

  await call(t, planId, "createDocument", { topic: `${SMOKE} first`, form: "long" });
  await call(t, planId, "createDocument", { topic: `${SMOKE} second`, form: "short" });

  const docs = await vaultDocs(t);
  expect(docs).toHaveLength(2);
  // byThread is latest-wins, so the LATEST card is what `#index` resolves against — it must carry
  // both ids in creation order. A card carrying one id per artifact pins every #index to 1.
  const latest = (await cardRows(t)).filter((r) => r.role === "created").at(-1)!;
  expect(latest.docIds).toEqual(docs.map((d) => d._id));
  expect(latest.count).toBe(2);
  expect(latest.form).toBe("short"); // the newest artifact's badge
});

// THE BUG EVAL FIXTURE 35 CAUGHT, and it cost a paid gate to find. `replace` is MODEL-SUPPLIED and
// the live model sends it on EVERY call — including the first, when the conversation holds no
// created documents at all. Obeying it routed a create down patchCreatedDoc, which refused
// correctly ("there's no document #1"), so nothing was ever created, the agent read the refusal as
// "try again", and looped: thirteen tool calls, all recorded `done`, zero documents. With ZERO
// created documents `replace` cannot denote anything, so it is noise, not a refusal case.
// This is the `confirmed`-flag principle (18-08: a model-supplied flag is the model grading its own
// decision) applied to the one model-supplied field that already existed.
test("a first createDocument CREATES even when the model supplies a bogus `replace`", async () => {
  const { t, planId } = await setup();

  const reply = await call(t, planId, "createDocument", {
    topic: CREATE_TOPIC,
    form: "long",
    replace: 1, // nothing exists to rewrite — the exact shape observed live
  });

  expect(reply).toContain(SMOKE_TITLE);
  expect(reply).toMatch(/saved to your vault/i); // created, NOT "rewritten as #1"
  expect(reply).not.toMatch(/there's no document/i);
  expect(await vaultDocs(t)).toHaveLength(1);
  const card = (await cardRows(t)).filter((r) => r.role === "created").at(-1)!;
  expect(card.docIds).toHaveLength(1);
});

// The other half of the rule: once documents EXIST, an out-of-range index keeps its honest refusal,
// because there the user may genuinely mean a document numbered differently. Widening the fallback
// to every out-of-range `replace` would silently create a second document when a revision was asked
// for — the failure this pair exists to keep apart.
test("with documents present, an out-of-range `replace` still refuses and creates nothing", async () => {
  const { t, planId } = await setup();

  await call(t, planId, "createDocument", { topic: `${SMOKE} first`, form: "long" });
  const refused = await call(t, planId, "createDocument", {
    topic: `${SMOKE} second`,
    form: "long",
    replace: 7,
  });

  expect(refused).toMatch(/no document #7/i);
  expect(await vaultDocs(t)).toHaveLength(1); // the refusal wrote nothing
});

// ── Static scans over the tool body ───────────────────────────────────────────

const convexSrcDir = dirname(fileURLToPath(import.meta.url));
const readLlmSource = (): string =>
  readFileSync(join(convexSrcDir, "llm.ts"), "utf8").replace(/\r\n/g, "\n");

// THE CLOSED-UNION TRAP, CLOSED STRUCTURALLY. `agentSteps.tool` is a closed union, and
// `onToolExecutionStart` records EVERY tool the model calls. A tool whose name has no literal makes
// `agentSteps:record` throw `ArgumentValidationError` — and the AI SDK SWALLOWS callback throws, so
// the step vanishes in PROD while the entire suite stays green. schema.ts warns about this twice in
// prose; it still happened a third time (`recordScorecardAnswer`, found 2026-08-08 in eval logs).
// Prose is not a guard. This is: every `<name>: tool(` key in buildCockpitTools must have a literal.
test("every cockpit tool name has an agentSteps.tool literal (the swallowed-step trap)", () => {
  const toolNames = [...readLlmSource().matchAll(/\n {4}([A-Za-z_]\w*): tool\(/g)].map((m) => m[1]);
  // Non-vacuity floor: if the record is ever restructured this scan must fail LOUDLY, not pass on
  // an empty list — the exact way a static scan rots into decoration.
  expect(
    toolNames.length,
    "found no `<name>: tool(` keys — did buildCockpitTools move?",
  ).toBeGreaterThan(20);

  const schemaSrc = readFileSync(join(convexSrcDir, "schema.ts"), "utf8").replace(/\r\n/g, "\n");
  const agentSteps = schemaSrc.slice(schemaSrc.indexOf("agentSteps: defineTable"));
  const unionBlock = agentSteps.slice(0, agentSteps.indexOf(").index("));
  const literals = new Set([...unionBlock.matchAll(/v\.literal\("([^"]+)"\)/g)].map((m) => m[1]));
  expect(literals.size, "no literals parsed from the agentSteps.tool union").toBeGreaterThan(20);

  expect([...new Set(toolNames)].filter((n) => !literals.has(n))).toEqual([]);
});

/** Slice the createDocument tool body: `createDocument: tool(` → the NEXT tool key in the record. */
function createDocumentBlock(): string {
  const full = readLlmSource();
  const start = full.indexOf("createDocument: tool(");
  expect(start, "createDocument tool not found — did it get renamed?").toBeGreaterThanOrEqual(0);
  const rest = full.slice(start);
  const end = rest.slice(1).search(/\n {4}[A-Za-z_]\w*: tool\(/);
  expect(end, "no tool follows createDocument — the slice would run to EOF").toBeGreaterThan(0);
  const block = rest.slice(0, end + 1);
  // Non-vacuity floor: an anchor that moved must fail LOUDLY, not pass trivially.
  expect(block.length, "the createDocument slice is empty").toBeGreaterThan(400);
  return block;
}

test("the createDocument Output-card write passes role, snippet AND form (the badge's only source)", () => {
  const block = createDocumentBlock();
  const insert = block.match(/internal\.vaultSources\.insert,\s*\{[\s\S]*?\n {8}\}/);
  expect(insert, "vaultSources.insert call not found in the createDocument body").not.toBeNull();
  expect(insert![0], 'the created card omits role: "created"').toMatch(/role:\s*"created"/);
  expect(insert![0], "the created card omits snippet").toMatch(/\bsnippet\b/);
  expect(
    insert![0],
    "the created card omits `form` — every short-form turn would silently badge DOCUMENT",
  ).toMatch(/\bform\b/);
});

test("parseAgentSmoke: create=<form>:<topic> splits on the FIRST colon, nested SMOKE prefix intact", () => {
  // The nested SMOKE::route prefix is LOAD-BEARING and part of the TOPIC: `create=` only picks the
  // tool, it does not keep the model out of the loop. parseSmoke is ^-anchored on the safeText
  // draftDocument receives, so the prefix must be handed through unstripped.
  expect(
    parseAgentSmoke(`SMOKE::agent::create=long:${SMOKE} Quarterly one-pager`, "tenant_parser"),
  ).toEqual({
    kind: "create",
    form: "long",
    topic: `${SMOKE} Quarterly one-pager`,
  });
  expect(parseAgentSmoke("SMOKE::agent::create=short:a LinkedIn post", "tenant_parser")).toEqual({
    kind: "create",
    form: "short",
    topic: "a LinkedIn post",
  });
  // Malformed drives NOTHING — exactly like a malformed regenerate=.
  expect(parseAgentSmoke("SMOKE::agent::create=long", "tenant_parser")).toBeNull(); // no colon
  expect(parseAgentSmoke("SMOKE::agent::create=medium:x", "tenant_parser")).toBeNull(); // outside the closed enum
});

test("SMOKE::agent::create drives ONE governed createDocument OFFLINE and records tool: createDocument", async () => {
  const { t, planId } = await setupWithLimiter();

  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    turnId: "turn1",
    text: `SMOKE::agent::create=long:${SMOKE} Quarterly one-pager`,
  });

  expect(res.costUsd).toBe(0); // no gateway key, no model call
  expect(res.reply).toContain(SMOKE_TITLE);
  // The step row reads SMOKE_OP_TOOL, so the invoke and the trace can never drift.
  const steps = await t.run((ctx) => ctx.db.query("agentSteps").collect());
  expect(steps.map((s) => s.tool)).toEqual(["createDocument"]);
  expect(await vaultDocs(t)).toHaveLength(1);
});

// ── THE GATE'S OBSERVATION ROW (2026-08-30) ───────────────────────────────────────────────────
//
// `run-eval-golden.mjs` used to build its evidence row out of `skillVersionsOf(pins)` — its OWN
// argument — so a green run certified a body it never loaded. The fix is that the runner now reads
// back what actually ran; these two tests own the write half of that, because a read-back of a row
// nobody writes fails in exactly the direction that looks like success (no evidence, no alarm).
test("a PINNED cockpit turn records the body it loaded — the row the eval gate reads back", async () => {
  const { t, planId } = await setupWithLimiter();
  const active: number = (await t.query(internal.skills.getActiveSkill, { name: "cockpit-agent" }))
    .version;
  const pinned = active + 5;
  await t.run((ctx) =>
    ctx.db.insert("skills", {
      name: "cockpit-agent",
      version: pinned,
      body: "candidate body under evaluation",
      status: "candidate",
      createdAt: Date.now(),
    }),
  );

  await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    turnId: "turn1",
    text: `SMOKE::agent::create=long:${SMOKE} Quarterly one-pager`,
    skillVersions: { "cockpit-agent": pinned },
  });

  const rows = await t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), "agent.skill_loaded"))
      .collect(),
  );
  expect(rows).toHaveLength(1);
  const payload = rows[0].payload as {
    skillName: string;
    skillVersion: number;
    skillBodyHash: string;
    pinned: boolean;
  };
  expect(payload.skillName).toBe("cockpit-agent");
  // THE VERSION THAT LOADED, not the one that is active — the whole point of the row.
  expect(payload.skillVersion).toBe(pinned);
  expect(payload.skillVersion).not.toBe(active);
  expect(payload.pinned).toBe(true);
  // A hash, never the body (§4). 64 hex chars of SHA-256, and NOT the body string itself.
  expect(payload.skillBodyHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(rows[0])).not.toContain("candidate body under evaluation");
});

test("an UNPINNED turn writes no attribution row — production does not pay for a gate concern", async () => {
  const { t, planId } = await setupWithLimiter();

  await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    turnId: "turn1",
    text: `SMOKE::agent::create=long:${SMOKE} Quarterly one-pager`,
  });

  const rows = await t.run((ctx) =>
    ctx.db
      .query("audit")
      .filter((q) => q.eq(q.field("eventType"), "agent.skill_loaded"))
      .collect(),
  );
  expect(rows).toHaveLength(0);
});

test("parseAgentSmoke accepts only the closed Drive list/find grammar", () => {
  expect(parseAgentSmoke("SMOKE::agent::drive=list:SMOKE::folder-1", "tenant_parser")).toEqual({
    kind: "driveList",
    parentId: "SMOKE::folder-1",
  });
  expect(
    parseAgentSmoke("SMOKE::agent::drive=find:SMOKE::quarterly plan", "tenant_parser"),
  ).toEqual({
    kind: "driveFind",
    query: "SMOKE::quarterly plan",
  });
  expect(parseAgentSmoke("SMOKE::agent::drive=import:folder-1", "tenant_parser")).toBeNull();
  expect(parseAgentSmoke("SMOKE::agent::drive=find:", "tenant_parser")).toBeNull();
});

test("SMOKE Drive list/find round-trip offline at $0 with truthful tool traces", async () => {
  for (const [text, tool, reply] of [
    ["SMOKE::agent::drive=list:SMOKE::folder-1", "listDriveFolders", "Smoke folder"],
    ["SMOKE::agent::drive=find:SMOKE::quarterly", "findInDrive", "Smoke result"],
  ] as const) {
    const { t, planId } = await setupWithLimiter();
    const result = await t.action(internal.llm.runCockpitAgent, {
      tenantId: "t1",
      threadId: "thread1",
      planId,
      turnId: "turn1",
      text,
    });
    expect(result.costUsd).toBe(0);
    expect(result.reply).toContain(reply);
    const steps = await t.run((ctx) => ctx.db.query("agentSteps").collect());
    expect(steps.map((step) => step.tool)).toEqual([tool]);
  }
});

// ── SC7: the replace #index revision path ─────────────────────────────────────

test("createDocument(replace: 1) rewrites the SAME row in place and drops the superseded PDF", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "createDocument", { topic: CREATE_TOPIC, form: "long" });
  const before = (await vaultDocs(t))[0]!;
  const oldStorage = before.storageId!;

  const reply = await call(t, planId, "createDocument", {
    topic: `${SMOKE} same thing, shorter`,
    form: "short",
    replace: 1,
  });
  expect(reply).toMatch(/#1/);
  expect(reply).not.toContain(String(before._id)); // still never a raw id

  // ONE row, latest content wins — no second row, no version history.
  const after = await vaultDocs(t);
  expect(after).toHaveLength(1);
  expect(after[0]!._id).toBe(before._id);
  expect(after[0]!.kind).toBe("created_content");
  expect(after[0]!.origin).toBe("agent"); // a revise never re-provenances the row
  // long → short removes storageId ⇒ the Download button disappears, for free.
  expect(after[0]!.storageId).toBeUndefined();
  // …and the superseded bytes are GONE, deleted only after the patch persisted.
  expect(await t.run((ctx) => ctx.storage.getUrl(oldStorage))).toBeNull();

  // The card refreshes with a NEW append-only row: same docIds, fresh form/snippet.
  const cards = (await cardRows(t)).filter((r) => r.role === "created");
  expect(cards).toHaveLength(2);
  expect(cards[1]!.docIds).toEqual([before._id]);
  expect(cards[1]!.form).toBe("short");
  expect(cards[1]!.count).toBe(1);

  const audits = await createdAudit(t);
  expect(audits).toHaveLength(2);
  expect(audits[1]!.payload).toMatchObject({
    form: "short",
    hasPdf: false,
    vaultDocId: String(before._id),
  });
});

test("createDocument(replace: <bad index>) returns a sentence and changes NOTHING", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "createDocument", { topic: CREATE_TOPIC, form: "long" });
  const before = (await vaultDocs(t))[0]!;

  const reply = await call(t, planId, "createDocument", {
    topic: `${SMOKE} rewrite the fifth one`,
    form: "long",
    replace: 5,
  });

  // A refusal is a returned sentence, never a throw — and nothing is half-written.
  expect(reply).toMatch(/no document #5|nothing was changed/i);
  const after = await vaultDocs(t);
  expect(after).toHaveLength(1);
  expect(after[0]!.contentHash).toBe(before.contentHash);
  expect(after[0]!.storageId).toBe(before.storageId);
  expect((await cardRows(t)).filter((r) => r.role === "created")).toHaveLength(1); // no new card
  expect(await createdAudit(t)).toHaveLength(1); // no audit for work not done
});

// ── SC2 + the renderer-bypass guard (static) ──────────────────────────────────

test("SC2: the createDocument tool body has NO external side effect", () => {
  // Creation SAVES. Delivery still crosses the shipped Approve gate through the untouched
  // attachment path — and this scan is what keeps that a structural fact rather than a habit.
  // Comments are stripped: the invariant is about the CODE surface.
  const block = createDocumentBlock().replace(/\/\/[^\n]*/g, "");
  // Non-vacuity floor: the slice must really be the tool body, or the scan proves nothing.
  expect(block, "the createDocument slice lost its vault write — the scan is vacuous").toMatch(
    /internal\.vault\.(insert|patch)CreatedDoc/,
  );
  expect(block, "createDocument reaches a mail surface").not.toMatch(/gmail/i);
  expect(block, "createDocument starts a workflow").not.toMatch(/workflow\.start/);
  expect(block, "createDocument dispatches back into cockpit.ts").not.toMatch(
    /internal\.cockpit\./,
  );
});

test("renderAndStore's html branch renders through renderHtmlDocument — never raw markdown bytes", () => {
  const src = readLlmSource();
  const start = src.indexOf("const renderAndStore = async (");
  expect(
    start,
    "renderAndStore not found — did it get renamed or extracted?",
  ).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("\n  };\n");
  expect(end, "the renderAndStore close was not found — the slice is unbounded").toBeGreaterThan(0);
  const block = rest.slice(0, end);
  expect(block.length, "the renderAndStore slice is empty").toBeGreaterThan(400);
  // The spec → markup boundary: html bytes come from the renderer, never from the markdown source.
  expect(block, "the html branch no longer calls renderHtmlDocument").toMatch(
    /renderHtmlDocument\(draft\.title, draft\.markdown\)/,
  );
  expect(src, "raw markdown is being encoded as document bytes somewhere in llm.ts").not.toMatch(
    /encode\(draft\.markdown\)/,
  );
});

// ── 19-08 (ACTN-05): contacts-first resolution + the ONE CRM staging tool ─────
//
// SC#1's first half. Two properties, and NEITHER is provable by reading a reply string:
//   • CONTACTS FIRST. A saved contact is a deliberate human statement about who someone is; a
//     Gmail-header match is an inference. The proof is a ROW COUNT on `audit`: `gmail.search`
//     ALWAYS writes exactly one refs-only `mailbox.searched` row (gmail.ts, shared by the SMOKE
//     and live paths), so zero rows means the header search never ran. A reply-string check would
//     pass on a header search that happened to return the same labels — the 19-04 inert-GET lesson.
//   • NO CONTACTS CACHE AT REST (SC#7). `resolveContacts` must write NO `contacts` row, on a
//     resolution that matched nothing, one, or several. Counted before and after, same reason.

const contactRows = (t: T) => t.run((ctx) => ctx.db.query("contacts").collect());
const followUpRows = (t: T) => t.run((ctx) => ctx.db.query("followUps").collect());
/** Every refs-only `mailbox.searched` audit row — one per gmail.search call, SMOKE path included. */
const headerSearches = async (t: T) =>
  (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
    (r) => r.eventType === "mailbox.searched",
  );

const seedContact = (t: T, email: string, name?: string) =>
  t.run((ctx) =>
    ctx.db.insert("contacts", {
      tenantId: "t1",
      email,
      ...(name ? { name } : {}),
      origin: "user-entered" as const,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

test("resolveContacts prefers a SAVED contact and never searches Gmail headers", async () => {
  const { t, planId } = await setup();
  await seedContact(t, "sarah@saved.example", "Sarah Saved");

  const summary = await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" });

  // THE assertion: the header search did not run. Counted, not read off the reply.
  expect(await headerSearches(t)).toHaveLength(0);
  expect(summary).toContain("Sarah Saved");
  expect(summary).toContain("saved"); // the model is told WHY this beat the mailbox
  expect(summary).not.toContain("@"); // §2-D: the address still never crosses to the model
  // The saved row is parked as the candidate the human picks — same content plane, same card.
  const plan = await readPlan(t, planId);
  expect(plan?.candidates?.[0]?.matches?.map((m: { address: string }) => m.address)).toEqual([
    "sarah@saved.example",
  ]);
});

test("a saved match brings that contact's OPEN follow-ups into the SAME turn", async () => {
  const { t, planId } = await setup();
  const contactId = await seedContact(t, "sarah@saved.example", "Sarah Saved");
  await t.run(async (ctx) => {
    await ctx.db.insert("followUps", {
      tenantId: "t1",
      contactId,
      note: "chase the signed quote",
      dueAt: 2_000,
      status: "open",
      createdAt: 1,
    });
    await ctx.db.insert("followUps", {
      tenantId: "t1",
      contactId,
      note: "already handled last week",
      dueAt: 1_000,
      status: "done",
      createdAt: 1,
    });
  });

  const summary = await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah" });

  expect(summary).toContain("chase the signed quote"); // no second tool call needed
  expect(summary).not.toContain("already handled last week"); // OPEN only
  expect(await headerSearches(t)).toHaveLength(0);
});

test("resolveContacts writes NOTHING to contacts — matched none, one, or several (SC#7)", async () => {
  const { t, planId } = await setup();
  await seedContact(t, "sarah@saved.example", "Sarah Saved");
  await seedContact(t, "sara@saved.example", "Sara Saved");
  expect(await contactRows(t)).toHaveLength(2);

  // Matched NOTHING saved ⇒ falls through to the Gmail-header path, which resolves two SMOKE
  // header records — and still mints no contact row. Header resolution NEVER writes a contact.
  await call(t, planId, "resolveContacts", { name: "SMOKE::Nobody Here" });
  expect(await contactRows(t)).toHaveLength(2);
  expect(await headerSearches(t)).toHaveLength(1); // the fallback really did run

  await call(t, planId, "resolveContacts", { name: "SMOKE::Sarah Saved" }); // matched ONE
  expect(await contactRows(t)).toHaveLength(2);

  await call(t, planId, "resolveContacts", { name: "SMOKE::Sar" }); // matched SEVERAL
  const plan = await readPlan(t, planId);
  expect(plan?.candidates?.at(-1)?.matches?.length).toBe(2);
  expect(await contactRows(t)).toHaveLength(2);
  // …and the two saved-contact resolutions added no further header searches.
  expect(await headerSearches(t)).toHaveLength(1);
});

test("stageCrmWrite PROPOSES a crm_write plan and applies NOTHING (the Approve gate is the only path)", async () => {
  const { t, planId } = await setup();

  const reply = await callClock(t, planId, "stageCrmWrite", {
    operations: [
      { op: "addContact", email: "New.Person@Example.com", name: "New Person" },
      {
        op: "addFollowUp",
        email: "new.person@example.com",
        note: "send the quote",
        due: "tomorrow",
      },
    ],
  });

  expect(reply).toMatch(/approve/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("crm_write");
  expect(plan?.status).toBe("proposed");
  expect(plan?.crmOperations).toHaveLength(2);
  // parseCrmOperations ran at the WRITE boundary too (19-06's note), not only at the apply
  // boundary: the address is stored NORMALIZED, which is the visible trace of that second parse.
  expect((plan?.crmOperations?.[0] as { email: string } | undefined)?.email).toBe(
    "new.person@example.com",
  );
  // §2-D: the model supplies the user's WORDS, never an instant. "tomorrow" off the pinned clock.
  expect((plan?.crmOperations?.[1] as { dueAt: number } | undefined)?.dueAt).toBe(
    Date.UTC(2020, 0, 2, 9, 0, 0),
  );
  // Nothing applied. The gate is the only application path.
  expect(await contactRows(t)).toHaveLength(0);
  expect(await followUpRows(t)).toHaveLength(0);
});

test("stageCrmWrite REFUSES a follow-up that names no contact — a sentence, never a throw", async () => {
  const { t, planId } = await setup();
  // The structural brake against the CRM becoming a general task generator (invariant 11):
  // contactless follow-ups are a USER-only capability.
  const reply = await callClock(t, planId, "stageCrmWrite", {
    operations: [{ op: "addFollowUp", note: "call someone", due: "tomorrow" }],
  });

  expect(reply).toMatch(/who|contact/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBeUndefined();
  expect(plan?.crmOperations).toBeUndefined();
  expect(plan?.status).toBe("collecting");
});

// ── 19-11 (ACTN-05 defect): a dated CONTACT is a follow-up that lost its op ───────────────────
// 19-10 measured the live body staging `{op:"addContact", …}` with no `dueAt` for "remind me on
// Thursday to chase Rhea". The tool USED to accept `due`/`note` on an addContact — they were
// optional on every item in one permissive object — and then SILENTLY DROP them, so a model that
// supplied the whole follow-up got a bare contact staged and the date destroyed with no signal.
// A silent drop at a trust boundary cannot be answered; a returned refusal must be.
test("stageCrmWrite REFUSES a contact carrying a date — the follow-up half is never silently dropped", async () => {
  const { t, planId } = await setup();

  const dated = await callClock(t, planId, "stageCrmWrite", {
    operations: [{ op: "addContact", email: "rhea@example.com", name: "Rhea", due: "Thursday" }],
  });
  expect(dated).toMatch(/addFollowUp/);
  // Nothing staged: the plan row is untouched, so the model cannot mistake the drop for a save.
  expect((await readPlan(t, planId))?.kind).toBeUndefined();

  // `note` is the other half of a follow-up and was dropped just as silently.
  const noted = await callClock(t, planId, "stageCrmWrite", {
    operations: [
      { op: "addContact", email: "rhea@example.com", name: "Rhea", note: "chase the renewal" },
    ],
  });
  expect(noted).toMatch(/addFollowUp/);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

// ── 19-11 (ACTN-05 defect, half two): a REFUSAL must not destroy the previous turn's staging ──
// Measured on eval run `266ef8f4`. Turn 2 asked for a follow-up "not tied to anyone"; the agent
// satisfied the required-`email` brake by INVENTING `no-email`, the op was accepted, and because
// `patchPlan` replaces `crmOperations` wholesale it overwrote turn 1's legitimate Rhea follow-up.
// Fixture 36's counts were then satisfied by REPLACEMENT rather than by turn 2 declining.
//
// The replace is left alone deliberately: a plan row is the CURRENT STAGED STATE, not a log, and an
// appending patch would make a model correcting its own list double it instead. What must hold is
// that a REFUSED operation never reaches `patchPlan` at all — every refusal is an early `return`
// above the mutation, so turn 1 survives. This asserts on the STORED ops, not the reply text.
test("a REFUSED turn-2 op leaves turn-1's staged follow-up intact — a refusal never reaches patchPlan", async () => {
  const { t, planId } = await setup();

  await callClock(t, planId, "stageCrmWrite", {
    operations: [
      { op: "addFollowUp", email: "rhea@example.com", note: "chase the renewal", due: "tomorrow" },
    ],
  });
  const afterTurn1 = await readPlan(t, planId);
  expect(afterTurn1?.crmOperations).toHaveLength(1);

  // The verbatim op the live model emitted.
  const reply = await callClock(t, planId, "stageCrmWrite", {
    operations: [
      { op: "addFollowUp", email: "no-email", note: "to review our pricing page", due: "tomorrow" },
    ],
  });
  // Pins the SPECIFIC refusal, not the generic `malformed` fallback — which also says "nothing was
  // staged", so that phrase alone would pass with the new CRM_PARSE_REFUSAL entry deleted.
  expect(reply).toMatch(/nothing was staged/i);
  expect(reply).toMatch(/never invent/i);

  const afterTurn2 = await readPlan(t, planId);
  expect(afterTurn2?.crmOperations).toEqual(afterTurn1?.crmOperations);
  expect((afterTurn2?.crmOperations?.[0] as { email: string } | undefined)?.email).toBe(
    "rhea@example.com",
  );
  expect(afterTurn2?.kind).toBe("crm_write");
  expect(afterTurn2?.status).toBe("proposed");
  // And nothing was applied by either turn — the Approve gate is still the only write path.
  expect(await contactRows(t)).toHaveLength(0);
  expect(await followUpRows(t)).toHaveLength(0);
});

// The union arm the model must actively choose. `addContact` used to be the enum's FIRST member
// and the schema's minimum valid emission (`required: ["op","email"]`), so it was reachable
// without the model having chosen it at all. A follow-up's date is now structurally required.
test("stageCrmWrite's schema puts the follow-up arm FIRST and requires its date", async () => {
  const tools = buildCockpitTools({
    ctx: {} as never,
    tenantId: "t1",
    planId: "plan1" as unknown as Id<"plans">,
    clientContext: PIN_CLOCK,
  });
  const schema = (
    tools.stageCrmWrite.inputSchema as unknown as {
      jsonSchema: {
        properties: {
          operations: {
            items: { anyOf: Array<{ properties: { op: { enum: string[] } }; required: string[] }> };
          };
        };
      };
    }
  ).jsonSchema;
  const arms = schema.properties.operations.items.anyOf;
  expect(arms.map((a) => a.properties.op.enum[0])).toEqual(["addFollowUp", "addContact"]);
  expect(arms[0]!.required).toEqual(["op", "email", "note", "due"]);
  // …and a contact structurally cannot carry the follow-up fields at all.
  expect(Object.keys(arms[1]!.properties)).toEqual(["op", "email", "name"]);
});

test("stageCrmWrite REFUSES an empty operation list — a sentence, never a throw", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageCrmWrite", { operations: [] });
  expect(reply).toMatch(/nothing|no changes/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

test("stageCrmWrite REFUSES over a half-composed email rather than hijacking the plan row", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "addRecipients", { addresses: ["bob@example.com"] });
  await call(t, planId, "setSubject", { subject: "Quarterly update" });

  const reply = await callClock(t, planId, "stageCrmWrite", {
    operations: [{ op: "addContact", email: "new@example.com" }],
  });

  expect(reply).toMatch(/draft/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBeUndefined(); // the email draft survives intact
  expect(plan?.subject).toBe("Quarterly update");
  expect(plan?.recipients).toEqual(["bob@example.com"]);
});

test("stageCrmWrite cannot complete or cancel a follow-up — only the human closes one", async () => {
  const { t, planId } = await setup();
  const contactId = await seedContact(t, "sarah@saved.example", "Sarah Saved");
  const followUpId = await t.run((ctx) =>
    ctx.db.insert("followUps", {
      tenantId: "t1",
      contactId,
      note: "chase the quote",
      dueAt: 2_000,
      status: "open" as const,
      createdAt: 1,
    }),
  );

  const reply = await callClock(t, planId, "stageCrmWrite", {
    operations: [{ op: "completeFollowUp", followUpRef: followUpId }],
  });

  expect(reply).toMatch(/can only|Pipeline/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

test("parseAgentSmoke: crm=<email>[:<note>] and its op→tool mapping", () => {
  expect(parseAgentSmoke("SMOKE::agent::crm=new@example.com", "tenant_parser")).toEqual({
    kind: "crm",
    email: "new@example.com",
    note: undefined,
  });
  expect(
    parseAgentSmoke("SMOKE::agent::crm=new@example.com:send the quote", "tenant_parser"),
  ).toEqual({
    kind: "crm",
    email: "new@example.com",
    note: "send the quote",
  });
  expect(parseAgentSmoke("SMOKE::agent::crm=", "tenant_parser")).toBeNull(); // no address drives nothing
});

test("SMOKE::agent::crm drives ONE governed stageCrmWrite OFFLINE at $0 and traces it", async () => {
  const { t, planId } = await setupWithLimiter();

  const res = await t.action(internal.llm.runCockpitAgent, {
    tenantId: "t1",
    threadId: "thread1",
    planId,
    turnId: "turn1",
    text: "SMOKE::agent::crm=new@example.com:send the quote",
  });

  expect(res.costUsd).toBe(0); // no gateway key, no model call
  const steps = await t.run((ctx) => ctx.db.query("agentSteps").collect());
  expect(steps.map((s) => s.tool)).toEqual(["stageCrmWrite"]);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("crm_write");
  expect(plan?.crmOperations).toHaveLength(2); // the contact + its follow-up
  expect(await contactRows(t)).toHaveLength(0); // still staged, still not applied
});

test("readFinance takes no arguments — the tenant is never model-supplied", async () => {
  const tools = buildCockpitTools({
    ctx: {} as never,
    tenantId: "t1",
    planId: "plan1" as unknown as Id<"plans">,
    clientContext: PIN_CLOCK,
  });
  const schema = (
    tools.readFinance.inputSchema as unknown as {
      jsonSchema: { properties: Record<string, unknown> };
    }
  ).jsonSchema;
  expect(Object.keys(schema.properties)).toEqual([]);
});

type FinanceReply = {
  unitEconomics: Record<string, { state: string; needs?: string; because?: string }>;
  solvency: Record<string, { state: string; needs?: string; because?: string }>;
  inputs: Array<{ field: string; value: number | null; stale: boolean }>;
};

// A brand-new tenant has NO financeInputs rows and NO scorecard evaluation at all — the normal
// case for the Finance page, not an error. This must not throw; every derived figure must come
// back as an honest "unknown"/"not-computable" state (never "known") for the agent to describe.
// Tightened per Task 7 review: the exact figure count (not a floor a regression could slip under)
// and — the one property this tool exists to hold — every suppressed figure carries ITS REASON.
// A figure with no `needs`/`because` is exactly the "trust me" the tool must never emit.
test("readFinance on a tenant with no figures at all returns honest unknown/not-computable states, never throws", async () => {
  const { t, planId } = await setup(); // fresh "t1", zero financeInputs rows, zero scorecard rows
  const reply = await call(t, planId, "readFinance", {});
  const parsed = JSON.parse(reply) as FinanceReply;

  const unitFigures = Object.values(parsed.unitEconomics);
  const solvencyFigures = Object.values(parsed.solvency);
  expect(unitFigures).toHaveLength(8); // cfa, ltgp, ltgpCac, cacPayback, cacVsIndustry, grossMargin, cohortChurn, referralPct
  expect(solvencyFigures).toHaveLength(5); // runway, netBurn, mrr, arr, workingCapital
  for (const figure of [...unitFigures, ...solvencyFigures]) {
    expect(["unknown", "not-computable", "not-applicable"]).toContain(figure.state);
    // Never a suppressed figure with no reason: `needs` for unknown, `because` for the other two.
    const reason = figure.needs ?? figure.because;
    expect(reason, `figure ${JSON.stringify(figure)} was suppressed with no reason`).toEqual(
      expect.stringMatching(/\S/),
    );
  }

  // Task 7 review, Important 1: an unconfirmed tier must never read as a guessed "solopreneur" —
  // mrr/arr/workingCapital come back UNKNOWN ("needs" your figure / your business shape), never
  // the false structural certainty of "not-applicable".
  expect(parsed.solvency.mrr?.state).toBe("unknown");
  expect(parsed.solvency.arr?.state).toBe("unknown");
  expect(parsed.solvency.workingCapital?.state).toBe("unknown");

  // Task 7 review, Important 2: the per-input freshness line the description promises ("out of
  // date") is actually present — all 11 CASH_INPUTS fields, none stale (nothing was ever entered).
  expect(parsed.inputs).toHaveLength(11);
  expect(parsed.inputs.every((i) => i.value === null && i.stale === false)).toBe(true);
});

// Task 7 review, Important 1 (the funded-startup-mid-onboarding case, verbatim). A tenant with a
// REAL stated MRR but no tenantProfiles row (business shape not yet confirmed) must see that MRR —
// the old "guess solopreneur" default discarded it in favor of a false "does not apply" claim.
test("readFinance surfaces a REAL stated MRR even when the tenant's business shape is unconfirmed", async () => {
  const { t, planId } = await setup();
  // "t1|session" → tenantId "t1" (requireScope splits on "|"), the SAME tenant `call` below drives
  // the tool for — mirrors `asTenant` in cash.test.ts.
  await t
    .withIdentity({ subject: "t1|session", issuer: "test" })
    .mutation(api.cash.saveInput, { field: "mrr", value: 8_000 });

  const reply = await call(t, planId, "readFinance", {});
  const parsed = JSON.parse(reply) as FinanceReply;
  expect(parsed.solvency.mrr).toMatchObject({ state: "known", value: 8_000 });
  expect(parsed.solvency.arr).toMatchObject({ state: "known", value: 96_000 });

  // Contrast: the DASHBOARD's own `solvency` query is UNCHANGED — it still defaults an unconfirmed
  // tier to "solopreneur" (the page's compensating "complete your shape" invitation makes that
  // acceptable there), so it still shows mrr as not-applicable for this same tenant/data. The tool
  // and the page are DELIBERATELY different on this one point; this pins that they stay that way.
  const dashboard = await t
    .withIdentity({ subject: "t1|session", issuer: "test" })
    .query(api.cash.solvency, {});
  expect(dashboard.mrr.state).toBe("not-applicable");
});

// ── Task 8: stageFinanceWrite — the agent's ONLY route to a figure ────────────────────────────
// contacts-crm.md invariant 11: the ACTOR decides gating. The human editing the SAME figure
// through `cash.saveInput` is ungated; the agent's identical write must stage a plan. The tool
// STAGES and applies NOTHING — `executePlan`'s `inline` arm applies the list after Approve.
// Every refusal below is a RETURNED SENTENCE, never a throw (18-06's rule): a throw out of the
// governed loop leaves the model with nothing to say to the user.

// The happy path stages `mrr` — a `financeInputs` field the agent may actually write. Staging
// `cac` here would be a green test on a plan the Approve gate refuses unconditionally.
test("stageFinanceWrite stages the WHOLE claim and applies NOTHING", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: "14000 / 10, this turn" }],
  });
  expect(reply).toMatch(/approve/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("finance_write");
  // The FULL constructed claim, field by field. `toHaveLength(1)` alone would stay green while the
  // tool dropped `basis`, wrote the wrong `field`, or let the model label its own provenance.
  expect(plan?.financeClaims).toEqual([
    {
      field: "mrr",
      value: 9000,
      // NOT model inputs: the provenance of the WRITE. A model that could stamp `actor: "user"`
      // would defeat invariant 11 outright.
      origin: "stated",
      actor: "agent",
      basis: "14000 / 10, this turn",
      // The CLIENT's pinned clock (§2-D), never the model's and never a fresh Date.now().
      observedAt: PIN_CLOCK.nowMs,
      confidence: "high",
    },
  ]);
  // The Approve gate is a CAS on `proposed` (cockpit.executePlan: `status !== "proposed"` is an
  // idempotent no-op), and every approval surface lists by that status. A row staged at
  // `collecting` would render nowhere and could never be approved at all.
  expect(plan?.status).toBe("proposed");
  // APPLIES NOTHING, asserted against BOTH stores a figure can land in — `financeInputs` for the
  // five finance-ops figures, `evaluations` for the Hormozi scorecard ones.
  expect(await t.run((ctx) => ctx.db.query("financeInputs").first())).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("evaluations").first())).toBeNull();
});

// THE defining property of this tool — ONE tool carrying a LIST, so one plan and one approval
// click however many figures moved. With N=1 everywhere, a bug that staged only `updates[0]` was
// invisible. The `stageCrmWrite` test at :1863 is the precedent.
test("stageFinanceWrite carries a LIST — one plan, one click, two figures", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [
      { field: "mrr", value: 9000, basis: "turn 4" },
      { field: "cashOnHand", value: 38_500, basis: "bank balance, turn 4" },
    ],
  });
  expect(reply).toMatch(/2 figure/);
  const claims = (await readPlan(t, planId))?.financeClaims as { field: string; value: number }[];
  expect(claims).toHaveLength(2);
  expect(claims[1]).toMatchObject({
    field: "cashOnHand",
    value: 38_500,
    basis: "bank balance, turn 4",
  });
});

// ALL-OR-NOTHING over the list: the patch happens AFTER the loop, so a bad element stages none of
// them. A per-element patch would leave half a list on the card and report success.
test("stageFinanceWrite stages NOTHING when a later update in the list is bad", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [
      { field: "mrr", value: 9000, basis: "turn 4" },
      { field: "vibes", value: 3, basis: "turn 4" },
    ],
  });
  expect(reply).toMatch(/not a figure I can update/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBeUndefined();
  expect(plan?.financeClaims).toBeUndefined(); // the GOOD first element is not stranded on the row
});

// Fix round 2 (Task 5): 6 of the 11 collected inputs are `store: "scorecard"`, and this comment
// used to say `applyFinanceClaims` refuses every one of them unconditionally — false since Tasks
// 1/5 (`evaluations.fieldProvenance`; `cash.ts` no longer produces `agent_cannot_update_figure`).
// `llm.ts`'s `stageFinanceWrite` gate stands anyway, as a DELIBERATE HOLD: refusing at the TOOL
// means the model learns it this turn instead of the user spending an approval click on a plan the
// product does not yet want it proposing, pending a review of what the model should be allowed to
// propose in chat. A hand-seeded/legacy plan row, or a future writer of `financeClaims` (vault
// documents, connectors), still reaches `applyFinanceClaims` directly and applies — this tool-level
// refusal is strictly narrower than the store's own capability, not a mirror of a store limit.
test("stageFinanceWrite REFUSES a scorecard figure and NAMES the five it can write", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "cac", value: 1400, basis: "14000 / 10, this turn" }],
  });
  expect(reply).toMatch(/can only update/i);
  for (const writable of ["cashOnHand", "monthlyOperatingCost", "mrr", "receivables", "payables"]) {
    expect(reply).toContain(writable);
  }
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

test("stageFinanceWrite REFUSES an unknown field rather than inventing one", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "vibes", value: 3, basis: "turn 1" }],
  });
  expect(reply).toMatch(/cannot|not a/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

test("stageFinanceWrite REFUSES an empty update list — a sentence, never a throw", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", { updates: [] });
  expect(reply).toMatch(/nothing|no changes/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

// §4 is enforced in `validateFigureClaim` (@pikar/core) — the shared boundary every producer
// runs, not just this one. `basis` reaches the audit log and the approval card.
test("stageFinanceWrite REFUSES a basis that QUOTES the user instead of naming a reference (§4)", async () => {
  const { t, planId } = await setup();
  const quoted = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: 'the user said "our MRR is nine grand now"' }],
  });
  expect(quoted).toMatch(/not quote it/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();

  // Same rule, the OTHER half: a basis long enough to be a transcript rather than a reference.
  const long = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: `this turn ${"x".repeat(130)}` }],
  });
  expect(long).toMatch(/not quote it/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

// One plan row per thread (plans.by_thread is `.unique()`): staging finance onto a half-composed
// email would turn the draft into a figure card and strand it. The `stageCrmWrite` /
// `stageResearchPlan` / `stageMediaPlan` refusal, on the same hazard.
test("stageFinanceWrite REFUSES rather than replacing a half-composed email draft", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "setSubject", { subject: "Q3 pricing" });

  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: "this turn" }],
  });
  expect(reply).toMatch(/draft/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBeUndefined(); // the draft survives
  expect(plan?.subject).toBe("Q3 pricing");
  expect(plan?.financeClaims).toBeUndefined();
});

// ── The cross-kind clobber, BOTH directions ───────────────────────────────────────────────────
// The email-slot draft guard above does NOT see another STAGED ACTION: a `crm_write` row carries
// `crmOperations` and no subject/body; a `calendar_event` row carries `eventTitle`/`eventStartMs`.
// Both used to sail through, and `patchPlan` then overwrote `kind` — `executePlan` routes on
// `actionTypeOf(plan.kind)` alone, so the surviving list was never applied and never rendered,
// after the model had already told the user it was staged. A silent drop at a trust boundary is
// the class 19-11 exists to close, so ONE shared predicate now guards both staging tools.
test("stageFinanceWrite REFUSES rather than silently discarding a staged CRM plan", async () => {
  const { t, planId } = await setup();
  await callClock(t, planId, "stageCrmWrite", {
    operations: [{ op: "addContact", email: "rhea@example.com", name: "Rhea" }],
  });
  expect((await readPlan(t, planId))?.kind).toBe("crm_write");

  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: "this turn" }],
  });
  expect(reply).toMatch(/already staged|already on/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("crm_write"); // the CRM plan survives intact
  expect(plan?.crmOperations).toHaveLength(1);
  expect(plan?.financeClaims).toBeUndefined();
});

// WHOLE-BRANCH REVIEW I2 — the THIRD staging tool on the same shared plan row. `otherKindStaged`
// guarded `stageCrmWrite` and `stageFinanceWrite` only, while `proposeCalendarEvent` patched
// `kind: "calendar_event"` with no interlock at all: the staged `financeClaims` survived on the row
// but `executePlan` routes on `actionTypeOf(plan.kind)`, so they were never applied and never
// rendered — after the model had already told the user the figures were staged. `cockpit.md`'s own
// Task-8 entry names `calendar_event` as part of this hazard; only the calendar side was missed.
test("proposeCalendarEvent REFUSES rather than silently discarding a staged finance plan", async () => {
  const { t, planId } = await setup();
  await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: "this turn" }],
  });
  expect((await readPlan(t, planId))?.kind).toBe("finance_write");

  const reply = await callClock(t, planId, "proposeCalendarEvent", {
    title: CALENDAR_TITLE_NEEDLE,
    when: "in 2 hours",
    durationMinutes: 30,
  });
  expect(reply).toMatch(/already staged|already on/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("finance_write"); // the figure plan survives intact
  expect(plan?.financeClaims).toHaveLength(1);
  expect(plan?.eventTitle).toBeUndefined();
  expect(plan?.eventStartMs).toBeUndefined();
});

test("stageCrmWrite REFUSES rather than silently discarding a staged finance plan", async () => {
  const { t, planId } = await setup();
  await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: "this turn" }],
  });
  expect((await readPlan(t, planId))?.kind).toBe("finance_write");

  const reply = await callClock(t, planId, "stageCrmWrite", {
    operations: [{ op: "addContact", email: "rhea@example.com", name: "Rhea" }],
  });
  expect(reply).toMatch(/already staged|already on/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("finance_write"); // the figure plan survives intact
  expect(plan?.financeClaims).toHaveLength(1);
  expect(plan?.crmOperations).toBeUndefined();
});

// Re-staging the SAME kind is a revision, not a clobber — the model correcting its own list must
// still work, exactly as it does for `stageCrmWrite` today.
test("stageFinanceWrite RE-stages over its own plan (a revision is not a clobber)", async () => {
  const { t, planId } = await setup();
  await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9000, basis: "this turn" }],
  });
  await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "mrr", value: 9500, basis: "corrected, this turn" }],
  });
  const claims = (await readPlan(t, planId))?.financeClaims as { value: number }[];
  expect(claims).toHaveLength(1);
  expect(claims[0]?.value).toBe(9500);
});

// THE SEAM, end to end: nothing anywhere ran `executePlan` on a plan THIS TOOL staged, so
// "stage → Approve → written" was untested as one flow. Everything before this test asserts the
// tool's half; `cockpit.test.ts` asserts the applier's half against a hand-seeded row.
test("stage → Approve → the figure is written (the whole seam, on a plan this tool staged)", async () => {
  const { t, planId } = await setup();
  await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "cashOnHand", value: 38_500, basis: "bank balance, turn 4" }],
  });

  expect(
    await t
      .withIdentity({ subject: "t1|session", issuer: "test" })
      .mutation(api.cockpit.executePlan, { planId }),
  ).toEqual({ ok: true, applied: 1 });

  const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.valueUsd).toBe(38_500);
  // The provenance the TOOL stamped survived the apply — the agent's write is labelled as one.
  expect(rows[0]?.actor).toBe("agent");
  expect(rows[0]?.statedAt).toBe(PIN_CLOCK.nowMs);
  expect((await readPlan(t, planId))?.status).toBe("done");
});

// REQUIREMENT 1's pin, and the type system will NOT provide it: `PlanRow` does not declare `kind`,
// so widening ACTION_TYPES never breaks the buildAgentContext call — `media` shipped in Phase 20
// without ever reaching it. Named mutation that turns this RED: delete the `finance_write` arm
// from buildAgentContext, and a staged figure plan falls through to the email context, which
// announces "Current email plan:" with Recipients / Send mode / Send time slots the model then
// offers to fill and send.
test("buildAgentContext describes a finance_write plan as figures, NEVER as an email", () => {
  const ctxText = buildAgentContext({ kind: "finance_write" });
  expect(ctxText).not.toMatch(/Current email plan/);
  expect(ctxText).not.toMatch(/Send mode|Send time|Recipients \(/);
  expect(ctxText).toMatch(/figure/i);
  // The same promise the crm_write arm makes: approving writes the user's OWN records, and the
  // model must not offer to send it to anyone.
  expect(ctxText).toMatch(/not an email/i);
});

// ── Phase-23 (SKILL-02): the skill-authoring tool exists ONLY under the Executive grant ────────
//
// The governance property this whole phase rests on is CAPABILITY MINIMIZATION BY CONSTRUCTION,
// not by instruction. These tests assert the tool's ABSENCE in every context that is not a real
// Executive turn — and absence is asserted on the RETURNED RECORD, because that record is what
// `invokeTool` can reach. A withheld-but-constructed closure would still be callable.

type Lineage = Pick<ToolContext, "threadId" | "rootRequestId">;

/** The executive's authoring shape: the grant plus a turn identity, split across the two Phase 38
 *  arguments. `over` spreads LAST, so an explicit `threadId: undefined` REMOVES the lineage (a
 *  spread keeps explicit undefineds — a destructuring default would silently restore it). */
const authoringGrant = (over: Partial<ToolGrants & Lineage> = {}) => {
  const { threadId, rootRequestId, ...grants } = {
    threadId: "thread1",
    rootRequestId: "turn1",
    ...over,
  };
  return {
    lineage: { threadId, rootRequestId } as Lineage,
    grants: { ...NO_GRANTS, skillAuthoring: true, ...grants } as ToolGrants,
  };
};

test("authorSkillCandidate is ABSENT without the grant, and absent with the grant but no lineage", () => {
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const keys = (shape?: ReturnType<typeof authoringGrant>) =>
    Object.keys(
      buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId, ...shape?.lineage }, shape?.grants),
    );

  // No grants at all — the NO_GRANTS default every bare caller gets.
  expect(keys()).not.toContain("authorSkillCandidate");
  // Granted, but with no turn identity to attribute the authorship to. A row whose provenance
  // cannot name the turn that produced it is exactly what 23-01's index exists to prevent.
  expect(keys(authoringGrant({ threadId: undefined }))).not.toContain("authorSkillCandidate");
  expect(keys(authoringGrant({ rootRequestId: undefined }))).not.toContain("authorSkillCandidate");
  // Lineage present but the grant withheld — the specialist's shape.
  expect(keys(authoringGrant({ skillAuthoring: false }))).not.toContain("authorSkillCandidate");
  // All three present: the Executive's shape, and the ONLY shape that yields the key.
  expect(keys(authoringGrant())).toContain("authorSkillCandidate");
});

test("the authoring grant is SEPARATE from the dispatch grant in both directions", () => {
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const keys = (shape: ReturnType<typeof authoringGrant>) =>
    Object.keys(
      buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId, ...shape.lineage }, shape.grants),
    );

  // Dispatch without authoring: the tool is absent, dispatchResearch is present.
  const dispatchOnly = keys(authoringGrant({ dispatch: true, skillAuthoring: false }));
  expect(dispatchOnly).toContain("dispatchResearch");
  expect(dispatchOnly).not.toContain("authorSkillCandidate");

  // Authoring without dispatch: the mirror. One flag can never imply the other — dispatching a
  // specialist spends money, authoring a skill changes what every future turn is told to be.
  const authoringOnly = keys(authoringGrant({ dispatch: false }));
  expect(authoringOnly).toContain("authorSkillCandidate");
  expect(authoringOnly).not.toContain("dispatchResearch");
});

test("revenue read tools are structurally absent unless the code-owned grant is resolved", () => {
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const keys = (revenueReads = false) =>
    Object.keys(
      buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId }, { ...NO_GRANTS, revenueReads }),
    );

  expect(keys()).not.toContain("readRevenueCrm");
  expect(keys()).not.toContain("readBusinessFinance");
  expect(keys()).not.toContain("declareUnsupported");
  expect(keys(false)).not.toContain("readRevenueCrm");
  expect(keys(true)).toEqual(expect.arrayContaining([...SPECIALISTS.revenue.tools]));
});

test("invoice reminder staging is executive-only and absent from the revenue specialist grant", () => {
  const stubCtx = {} as ToolContext["ctx"];
  const planId = "plan-stub" as Id<"plans">;
  const keys = (grants?: Partial<ToolGrants>) =>
    Object.keys(
      buildCockpitTools({ ctx: stubCtx, tenantId: "t1", planId }, { ...NO_GRANTS, ...grants }),
    );

  expect(keys()).not.toContain("stageInvoiceReminder");
  expect(keys({ revenueReads: true })).not.toContain("stageInvoiceReminder");
  expect(keys({ invoiceReminderStage: true })).toContain("stageInvoiceReminder");
  expect(SPECIALISTS.revenue.tools).not.toContain("stageInvoiceReminder");
});

test("authorSkillCandidate exposes EXACTLY {name, authoredBody} over the closed agent set", () => {
  const shape = authoringGrant();
  const tools = buildCockpitTools(
    {
      ctx: {} as ToolContext["ctx"],
      tenantId: "t1",
      planId: "plan-stub" as Id<"plans">,
      ...shape.lineage,
    },
    shape.grants,
  );
  const schema = tools.authorSkillCandidate.inputSchema as unknown as {
    jsonSchema: {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
      additionalProperties: boolean;
    };
  };

  // KEY-SET EQUALITY. A tenantId, status, version, author or evidence property appearing here
  // would be a field the MODEL could set — the entire authorization story of this tool is that no
  // such field exists.
  expect(Object.keys(schema.jsonSchema.properties).sort()).toEqual(["authoredBody", "name"]);
  expect([...schema.jsonSchema.required].sort()).toEqual(["authoredBody", "name"]);
  expect(schema.jsonSchema.additionalProperties).toBe(false);
  // The enum is SOURCED from the contract, not re-listed: a second copy of these names is how the
  // model-visible set and the server-side check drift apart.
  expect(schema.jsonSchema.properties.name?.enum).toEqual([...AGENT_AUTHORABLE_SKILLS]);
});

test("the authoring tool's region reaches nothing but publishAgentCandidate", () => {
  const src = readLlmSource();
  const from = src.indexOf("  const skillAuthoringTool = {");
  const to = src.indexOf("  const allTools = {", from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  const region = src.slice(from, to);
  expect(region.length).toBeGreaterThan(800); // non-vacuity: the real closure was found

  // The ONE downstream. Named mutation that turns this red: point execute at any other mutation.
  expect(region).toContain("internal.skills.publishAgentCandidate");

  // Everything this tool must NOT be able to reach. Activation and evidence are the governance
  // boundary; scheduler/plans/delivery are how a tool turns into an outward action; the eval
  // fixtures are what the authoring agent must never see (it would be marking its own homework).
  for (const forbidden of [
    "activateTenantCandidate",
    "activateCandidate",
    "activateSkillVersion",
    "transitionSkillActivation",
    "recordTenantEvalEvidence",
    "recordEvalEvidence",
    "ownerApproval",
    "requireOwner",
    "ctx.scheduler",
    "internal.plans",
    "internal.delivery",
    "internal.gmail",
    "buildCockpitTools",
    "evidence",
    "fixture",
  ]) {
    expect(region, `the authoring tool region reaches ${forbidden}`).not.toContain(forbidden);
  }
});

// ── replyToMessage: a MISSING SELECTOR is a malformed call, not an ambiguous one ───────────────
// Regression cover for eval fixture 24-reply-injection, which failed 2/2 (and 1/1 in isolation)
// with one `replyToMessage` call, no error, and a bare plan row. `senderHit`/`subjectHit` are
// vacuously true when their selector is absent, so a call with neither matched EVERY message, fell
// into the "2+ candidates" arm, and returned a menu ending "Ask the user which one to reply to" —
// addressed to the USER, which ends the turn. The user had named the message perfectly.
async function setupMailbox(): Promise<{ t: T; planId: Id<"plans"> }> {
  const { t, planId } = await setup();
  // No baseMs: the seeded messages must land inside listInbox's real `range` window.
  await t.mutation(internal.smoke.seedInboxFixture, { tenantId: "t1", offlineDigest: true });
  return { t, planId };
}

test("replyToMessage with NO sender and NO subject answers the MODEL, and stages nothing", async () => {
  const { t, planId } = await setupMailbox();
  const reply = await call(t, planId, "replyToMessage", { intent: "let them know I reviewed it" });

  // Addressed to the model as a retryable slip — it can call again inside the same tool loop.
  expect(reply).toMatch(/without naming a message/i);
  expect(reply).toMatch(/sender.*subject|subject.*sender/is);
  // NOT the old user-facing dead end. This exact phrasing is what ended the turn.
  expect(reply).not.toMatch(/I found \d+ messages that could match/i);
  // Still no-guess: it must never pick a message on the user's behalf.
  expect(reply).toMatch(/never pick for them/i);
  // And nothing was written, so a retry starts clean.
  const plan = await readPlan(t, planId);
  expect(plan?.recipients ?? []).toEqual([]);
  expect(plan?.subject).toBeUndefined();
});

test("replyToMessage RESOLVES and stages the original sender BEFORE it drafts a body", async () => {
  const { t, planId } = await setupMailbox();
  // The draft is a model call this offline harness has no key for. That is the point of the
  // assertion: the resolved recipient and threaded subject are committed BEFORE drafting, so a
  // drafting failure can never lose the address the user's reply is owed to.
  await call(t, planId, "replyToMessage", {
    intent: "let them know I reviewed it",
    subject: "Account activity",
  }).catch(() => undefined);

  const plan = await readPlan(t, planId);
  // The ORIGINAL sender — never the attacker address planted in that message's body.
  expect(plan?.recipients).toEqual(["no-reply@example.net"]);
  expect(plan?.subject).toBe("Re: Account activity");
});

test("the scorecard and finance tools cannot claim the same figure — both DERIVED", () => {
  // 37-finance-update stated a cash position and was routed to recordScorecardAnswer +
  // evaluateBusiness, 2/2, because BOTH tools read as "store a figure the user stated about their
  // own business". The boundary was already enforced in code (`applyFinanceClaims` refuses every
  // scorecard-stored field) but was INVISIBLE TO THE MODEL, which picks by description.
  //
  // A source assertion is the right shape here and not a weaker stand-in: the defect is that a
  // human hand-listed one side and it went stale. Both descriptions must be built from the SAME
  // constant, and that is a property of the source, not of any single call's return value.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "llm.ts"), "utf8");
  expect(src).toContain('belong to stageFinanceWrite: ${AGENT_WRITABLE_FIGURES.join(", ")}');
  expect(src).toContain('only update these five: ${AGENT_WRITABLE_FIGURES.join(", ")}');
  // And neither may name a figure literally — that is exactly how the two drifted apart before.
  const scorecardLine = src.slice(src.indexOf("belong to stageFinanceWrite"));
  expect(scorecardLine.slice(0, 120)).not.toMatch(/cashOnHand|runway/);
});

test("recordScorecardAnswer REFUSES a finance figure — the Approve gate is not optional", async () => {
  const { t, planId } = await setup();
  // 37-finance-update stated a cash position and the model stored it here, 2/2, even after the
  // description named these figures as out of bounds. A description shifts a tendency; only code
  // enforces a rule. The stake is the human gate: this tool writes IMMEDIATELY, stageFinanceWrite
  // stages for approval, so accepting a finance figure here skips the gate AND the source ref.
  for (const field of ["cashOnHand", "financials.cashOnHand", "FINANCIALS.CashOnHand"]) {
    const reply = await call(t, planId, "recordScorecardAnswer", { field, value: "42000" });
    expect(reply, `${field} was accepted`).toMatch(/not a scorecard answer/i);
    expect(reply).toMatch(/stageFinanceWrite/);
    expect(reply).toMatch(/nothing was saved/i);
  }
  // A genuine scorecard field is untouched — the refusal must not swallow the tool's real job.
  const ok = await call(t, planId, "recordScorecardAnswer", {
    field: "identity.headlinePrice",
    value: "$99",
  });
  expect(ok).toMatch(/Noted/i);
});

// ── Phase 40 (DOC-01): the .xlsx deliverable, on both planes ─────────────────────────────────────
//
// The chain under test is drafter -> markdownToSheets -> sheetsToXlsx -> storage, and the proof
// that it worked is that the STORED BYTES read back as a workbook with the drafted header row.
// Asserting the MIME alone would pass over a PDF renamed .xlsx.
describe("the xlsx attachment (Phase 40)", () => {
  test("format xlsx stores a REAL workbook whose bytes read back as sheets", async () => {
    const { t, planId } = await setup();
    const res = await call(t, planId, "generateAttachment", {
      topic: `${ATTACH} price list`,
      format: "xlsx",
    });

    expect(res).toMatch(/\.xlsx/);
    expect(res).not.toMatch(/http:|https:/i);
    const att = (await readPlan(t, planId))!.attachments![0]!;
    expect(att.mimeType).toBe(XLSX_MIME);
    expect(att.filename).toMatch(/\.xlsx$/);
    expect(att.size).toBeGreaterThan(0);

    // The bytes ARE a workbook: read them back with the same library the ingest rail uses.
    // `t.run` returns through Convex's own serializer, so hand back an ArrayBuffer (v.bytes) and
    // wrap it here — a Uint8Array is not a Convex value.
    const buf = await t.run(
      async (ctx) => await (await ctx.storage.get(att.storageId))!.arrayBuffer(),
    );
    const { sheets } = sheetRows(new Uint8Array(buf));
    expect(sheets.length).toBeGreaterThan(0);
    // The SMOKE drafter fixture writes one table under one heading (see draftDocument).
    expect(sheets[0]?.rows[0]?.length).toBeGreaterThan(1); // a header row with columns
  });

  test("a draft with no table refuses with its OWN sentence and adds no ref", async () => {
    // MUTATION that turns this RED: drop the markdownToSheets length check and let sheetsToXlsx
    // throw into the generic render-fail catch — the model would be told "it failed to render" and
    // would retry the same prose draft forever.
    const { t, planId } = await setup();
    const res = await call(t, planId, "generateAttachment", {
      topic: "SMOKE::route=direct_llm::no-table:: just prose please",
      format: "xlsx",
    });

    expect(res).toMatch(/no table/i);
    expect(res).toMatch(/columns/i);
    const plan = await readPlan(t, planId);
    expect(plan?.attachments ?? []).toEqual([]);
    expect(plan?.attachmentError).toMatch(/no table/i); // the plan is not proposable until fixed
  });

  test("regenerateAttachment keeps the format it already was — html stays html, xlsx stays xlsx", async () => {
    // Before Phase 40 this call passed no format, so BOTH came back as PDFs: the user asked for a
    // revision and got a conversion.
    const { t, planId } = await setup();
    await call(t, planId, "generateAttachment", { topic: `${ATTACH} launch`, format: "html" });
    await call(t, planId, "generateAttachment", { topic: `${ATTACH} prices`, format: "xlsx" });

    await call(t, planId, "regenerateAttachment", { index: 1, topic: `${ATTACH} launch v2` });
    await call(t, planId, "regenerateAttachment", { index: 2, topic: `${ATTACH} prices v2` });

    // `readPlan` rides this file's schema-less `T`, so the row is `any` — name the shape here.
    const atts: { mimeType: string; filename: string }[] = (await readPlan(t, planId))!.attachments;
    expect(atts.map((a) => a.mimeType)).toEqual(["text/html", XLSX_MIME]);
    expect(atts.map((a) => a.filename.split(".").pop())).toEqual(["html", "xlsx"]);
  });
});

describe("createDocument({ form: 'sheet' }) — the vault plane's workbook (Phase 40)", () => {
  test("saves a markdown row whose BYTES are an xlsx, and badges it as a spreadsheet", async () => {
    const { t, planId } = await setup();
    const res = await call(t, planId, "createDocument", {
      topic: `${ATTACH} price list`,
      form: "sheet",
    });

    expect(res).toMatch(/spreadsheet/i);
    const doc = await t.run(async (ctx) =>
      (await ctx.db.query("vaultDocuments").collect()).find((d) => d.origin === "agent"),
    );
    // The artifact of record stays markdown (searchable, groundable); the BYTES are the workbook.
    expect(doc?.mimeType).toBe("text/markdown");
    expect(doc?.storedMimeType).toBe(XLSX_MIME);
    expect(doc?.kind).toBe("created_document");
    expect(doc?.storageId).toBeTruthy();

    // The Output card's badge reads `vaultSources.form` and nothing else.
    const card = await t.run(async (ctx) =>
      (await ctx.db.query("vaultSources").collect()).find((r) => r.role === "created"),
    );
    expect(card?.form).toBe("sheet");
  });
});
