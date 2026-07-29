// @vitest-environment node
//
// Per-tool governance coverage for the cockpit Executive-Agent tool set (Plan 03, AGNT-01/02).
// The tools ARE the enforcement boundary — these drive them through a live action ctx (via the
// __invokeCockpitTool shim, since convex-test cannot fabricate one) against the REAL primitives,
// offline via SMOKE::. Nyquist truths #2/#3 sampled at 100%: validation bounce, index
// substitution, redaction-before-draft, and refs-only resolve summary each get an assertion.
import { CALENDAR_HORIZON_MS, parseSendTime, PLAN_ATTACHMENT_CAP_BYTES } from "@pikar/core";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { contentHash } from "./lib/hash";
import { buildAgentContext, buildCockpitTools, buildHistoryBlock } from "./llm";
import schema from "./schema";
// resolveContacts drives gmail.search, whose refs-only mailbox.searched audit hits the auditCounts
// aggregate; register the component (relative import — the package blocks the deep specifier) so the
// REAL audit path runs under convex-test instead of throwing "component not registered".
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");

const SMOKE = "SMOKE::route=direct_llm::";
type T = ReturnType<typeof convexTest>;

async function setup(): Promise<{ t: T; planId: Id<"plans"> }> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await t.mutation(internal.skills.seedSkills, {});
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId: "t1", threadId: "thread1" });
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
  const sarahEntries = (plan?.candidates ?? []).filter((c: { name: string }) => c.name === "SMOKE::Sarah");
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

test("regenerateAttachment supersedes in place and deletes the OLD bytes (O3, no orphan)", async () => {
  const { t, planId } = await setup();
  await call(t, planId, "generateAttachment", { topic: `${ATTACH} first` });
  const oldId = (await readPlan(t, planId))!.attachments![0]!.storageId;

  const res = await call(t, planId, "regenerateAttachment", { index: 1, topic: `${ATTACH} second` });
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
      { storageId: sid, filename: "big.pdf", mimeType: "application/pdf", size: PLAN_ATTACHMENT_CAP_BYTES },
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
  await call(t, planId, "generateAttachment", { topic: "SMOKE::route=direct_llm::render=fail:: x" });

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
      { storageId: sid, filename: "big.pdf", mimeType: "application/pdf", size: PLAN_ATTACHMENT_CAP_BYTES + 1 },
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
  const stubCtx = {} as Parameters<typeof buildCockpitTools>[0];
  const planId = "plan-stub" as Id<"plans">;
  const RECIPIENT_TOOLS = ["addRecipients", "setRecipients", "removeRecipient"];

  const full = Object.keys(buildCockpitTools(stubCtx, "t1", planId));
  for (const name of RECIPIENT_TOOLS) expect(full, `${name} missing from the normal set`).toContain(name);

  const withheld = Object.keys(buildCockpitTools(stubCtx, "t1", planId, undefined, undefined, true));
  for (const name of RECIPIENT_TOOLS)
    expect(withheld, `${name} present on the post-pick continue turn`).not.toContain(name);
  // resolveContacts stays — it writes candidates, not recipients (proposePlan's pending-pick gate covers it).
  expect(withheld).toContain("resolveContacts");
  // The withholding removes EXACTLY the three recipient-mutating keys — nothing else changes.
  expect(full.filter((n) => !RECIPIENT_TOOLS.includes(n)).sort()).toEqual([...withheld].sort());
});

// ── 12-04 (BEVL-01): the evaluation tools are registered in the cockpit set ────────────────────

test("buildCockpitTools registers BOTH evaluateBusiness (read) and recordScorecardAnswer (write)", () => {
  // The suite has no generic snapshot of tool keys, so without this line a dropped registration
  // would ship silently. A bare stub ctx is enough — the tools only CLOSE over ctx here.
  const stubCtx = {} as Parameters<typeof buildCockpitTools>[0];
  const keys = Object.keys(buildCockpitTools(stubCtx, "t1", "plan-stub" as Id<"plans">));
  expect(keys).toContain("evaluateBusiness");
  expect(keys).toContain("recordScorecardAnswer");
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
  await call(t, planId, "personalizeRecipient", { index: 1, instructions: `${PERS} warmer for bob` });

  const res = await call(t, planId, "proposePlan", {});
  expect(res).toMatch(/individual/i); // tells the agent to switch to individual
  expect((await readPlan(t, planId))?.status).not.toBe("proposed"); // not proposed
});

test("proposePlan PROCEEDS for an INDIVIDUAL plan that carries personalization", async () => {
  const { t, planId } = await setup();
  await fillTwoProposable(t, planId);
  await call(t, planId, "setMode", { mode: "individual" });
  await call(t, planId, "personalizeRecipient", { index: 1, instructions: `${PERS} warmer for bob` });

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
  expect(batch.synopsis.length, "digestInbox produced an empty synopsis on the smoke path").toBeGreaterThan(0);
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
  expect(plan?.candidates ?? [], "replyToMessage wrote candidates — it must NOT round-trip a panel").toEqual([]);
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
  const t2Plan = await t.mutation(internal.plans.insertPlan, { tenantId: "t2", threadId: "thread2" });

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

// ── Phase 17-03 Task 1: checkAvailability — read-only busy ranges in the governed loop ────────
const CALENDAR_TITLE_NEEDLE = "ZZQX private event title";
const CALENDAR_ATTENDEE_NEEDLE = "private-attendee@example.com";
const CALENDAR_DESCRIPTION_NEEDLE = "ZZQX private event description";
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtCalendarInstant = (ms: number, tz = "UTC") =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(ms);

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
