// @vitest-environment node
//
// Per-tool governance coverage for the cockpit Executive-Agent tool set (Plan 03, AGNT-01/02).
// The tools ARE the enforcement boundary — these drive them through a live action ctx (via the
// __invokeCockpitTool shim, since convex-test cannot fabricate one) against the REAL primitives,
// offline via SMOKE::. Nyquist truths #2/#3 sampled at 100%: validation bounce, index
// substitution, redaction-before-draft, and refs-only resolve summary each get an assertion.
import { PLAN_ATTACHMENT_CAP_BYTES } from "@pikar/core";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
