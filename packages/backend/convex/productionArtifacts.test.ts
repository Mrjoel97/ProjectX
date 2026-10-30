// @vitest-environment node
// Offline caller integration: real tool -> registry drafter -> native writer -> owned storage.
// Named preview-failure/large-report cases replace only their draft/projection boundaries;
// the routing cases above them exercise the actual seeded drafter actions without a provider.
import { inflateRawSync } from "node:zlib";
import { PRESENTATION_DRAFTER_SKILL } from "@pikar/contracts/skill";
import { presentationToMarkdown, renderPresentationHtml } from "@pikar/core/presentation";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as XLSX from "xlsx";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PPTX_MIME } from "./lib/presentationPptx";
import { internalAction, internalMutation } from "./lib/tenantLifecycle";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const SMOKE = "SMOKE::route=direct_llm::";
type T = ReturnType<typeof convexTest>;
function makeTest(overrides: Record<string, () => Promise<unknown>> = {}) {
  const t = convexTest(schema, { ...modules, ...overrides });
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}
async function setup(overrides: Record<string, () => Promise<unknown>> = {}) {
  const t = makeTest(overrides);
  await t.mutation(internal.skills.seedSkills, {});
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: "t1",
    threadId: "production-artifacts",
  });
  return { t, planId };
}
const invoke = (t: T, planId: Id<"plans">, toolName: string, input: unknown, tenantId = "t1") =>
  t.action(internal.llm.__invokeCockpitTool, { tenantId, planId, toolName, input });
const docs = (t: T) => t.run((ctx) => ctx.db.query("vaultDocuments").collect());
const storageRows = (t: T) => t.run((ctx) => ctx.db.system.query("_storage").collect());
const bytesAt = async (t: T, id: Id<"_storage">) =>
  Uint8Array.from(
    await t.run(async (ctx) => {
      const blob = await ctx.storage.get(id);
      if (!blob) throw new Error("Missing actual stored file");
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }),
  );
function unzip(bytes: Uint8Array) {
  const zip = Buffer.from(bytes);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not an OOXML file");
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, string>();
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const size = zip.readUInt32LE(at + 20),
      nameSize = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameSize).toString("utf8");
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(start, start + size);
    entries.set(
      name,
      (zip.readUInt16LE(at + 10) === 8 ? inflateRawSync(compressed) : compressed).toString("utf8"),
    );
    at += 46 + nameSize + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}
function assertPresentation(bytes: Uint8Array) {
  const files = unzip(bytes);
  expect(
    [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)),
  ).toHaveLength(2);
  expect(files.get("ppt/slides/slide1.xml")).toContain("Smoke Presentation");
  expect(files.get("ppt/slides/slide2.xml")).toContain("Review the source evidence");
  expect(files.get("ppt/slides/slide2.xml")).toContain("<p:sp>");
  expect(files.get("[Content_Types].xml")).toContain("presentationml.presentation.main+xml");
}
function assertWorkbook(bytes: Uint8Array) {
  const workbook = XLSX.read(bytes, { type: "array", cellStyles: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
  expect(sheet.B6).toMatchObject({ t: "n", v: 500 });
  expect(sheet.B7).toMatchObject({ t: "n", v: 120 });
  expect(sheet.A6?.v).toBe("Setup");
  const files = unzip(bytes);
  expect(files.get("xl/styles.xml")).toContain("FF0B4F4A");
  expect(files.get("xl/worksheets/sheet1.xml")).toContain('state="frozen"');
  expect(files.get("xl/worksheets/sheet1.xml")).toContain("<autoFilter");
  expect(files.get("xl/worksheets/sheet1.xml")).toContain("<mergeCell");
}

let forbiddenFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  forbiddenFetch = vi.fn(() => {
    throw new Error("No provider or other network is authorized in offline artifact integration");
  });
  vi.stubGlobal("fetch", forbiddenFetch);
});
afterEach(() => {
  try {
    expect(forbiddenFetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("presentation and workbook production callers", () => {
  test("presentation drafter fails closed without its registry row and succeeds only after seeding", async () => {
    const t = makeTest();
    const args = { tenantId: "t1", safeText: `${SMOKE} business review` };
    await expect(t.action(internal.llm.draftPresentation, args)).rejects.toThrow(/NO_ACTIVE_SKILL/);
    await t.mutation(internal.skills.seedSkills, {});
    const drafted = await t.action(internal.llm.draftPresentation, args);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) throw new Error("Seeded draft refused");
    expect(drafted.spec.slides).toHaveLength(2);
    expect(drafted.markdown).toContain("Download the PowerPoint");
    const active = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) =>
          q.eq("name", PRESENTATION_DRAFTER_SKILL).eq("status", "active"),
        )
        .unique(),
    );
    expect(active?.body).toContain("Presentation Drafter");
  });
  test("presentation drafter returns exhausted-budget refusal before the offline shortcut", async () => {
    const { t } = await setup();
    await t.mutation(internal.guardrails.recordSpend, { tenantId: "t1", costUsd: 10 });
    await expect(
      t.action(internal.llm.draftPresentation, { tenantId: "t1", safeText: `${SMOKE} review` }),
    ).resolves.toEqual({ ok: false, reason: "daily_budget_exhausted" });
    expect(await storageRows(t)).toHaveLength(0);
  });
  test("presentation drafter returns kill-switch refusal before the offline shortcut", async () => {
    const { t } = await setup();
    await t.mutation(internal.guardrails.setKillSwitch, { on: true });
    await expect(
      t.action(internal.llm.draftPresentation, { tenantId: "t1", safeText: `${SMOKE} review` }),
    ).resolves.toEqual({ ok: false, reason: "kill_switch" });
  });
  test("createDocument(presentation) stores actual PPTX, source lineage and a same-spec tenant-owned preview", async () => {
    const { t, planId } = await setup();
    const result = await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} quarterly review`,
      form: "presentation",
    });
    expect(result).toContain(".pptx");
    const rows = await docs(t);
    expect(rows).toHaveLength(1);
    const doc = rows[0]!;
    expect(doc).toMatchObject({
      tenantId: "t1",
      storedMimeType: PPTX_MIME,
      sourcePlanId: planId,
      sourceThreadId: "production-artifacts",
      origin: "agent",
      kind: "created_document",
    });
    expect(doc.text).toContain("Presentation outline");
    assertPresentation(await bytesAt(t, doc.storageId!));
    const preview = await t
      .withIdentity({ subject: "t1" })
      .query(api.vaultPresentations.byDoc, { docId: doc._id });
    expect(preview?.title).toBe("Smoke Presentation");
    expect(renderPresentationHtml(preview, 1)).toContain("Review the source evidence");
    await expect(
      t.withIdentity({ subject: "t2" }).query(api.vaultPresentations.byDoc, { docId: doc._id }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(internal.vaultPresentations.upsert, {
        tenantId: "t2",
        docId: doc._id,
        spec: JSON.stringify(preview),
      }),
    ).rejects.toThrow("presentation_not_owned");
    const card = await t.run((ctx) => ctx.db.query("vaultSources").first());
    expect(card).toMatchObject({ form: "presentation", role: "created", docIds: [doc._id] });
    expect(await storageRows(t)).toHaveLength(1);
  });
  test("PPTX attachment regeneration preserves format and deletes only superseded bytes; render failure preserves the good file", async () => {
    const { t, planId } = await setup();
    const result = await invoke(t, planId, "generateAttachment", {
      topic: `${SMOKE} presentation`,
      format: "pptx",
    });
    expect(result).toContain(".pptx");
    const first = (await t.run((ctx) => ctx.db.get(planId)))!.attachments![0]!;
    expect(first.mimeType).toBe(PPTX_MIME);
    assertPresentation(await bytesAt(t, first.storageId));
    await invoke(t, planId, "regenerateAttachment", {
      index: 1,
      topic: `${SMOKE} revised presentation`,
    });
    const second = (await t.run((ctx) => ctx.db.get(planId)))!.attachments![0]!;
    expect(second.filename).toMatch(/\.pptx$/u);
    expect(second.mimeType).toBe(PPTX_MIME);
    expect(second.storageId).not.toBe(first.storageId);
    expect(await t.run((ctx) => ctx.storage.getUrl(first.storageId))).toBeNull();
    assertPresentation(await bytesAt(t, second.storageId));
    const failure = await invoke(t, planId, "regenerateAttachment", {
      index: 1,
      topic: `${SMOKE}render=fail:: failed replacement`,
    });
    expect(failure).toMatch(/failed to render/u);
    expect((await t.run((ctx) => ctx.db.get(planId)))!.attachments![0]!.storageId).toBe(
      second.storageId,
    );
    expect(await storageRows(t)).toHaveLength(1);
  });
  test("created sheets store styled XLSX with actual numeric cells and a tenant-owned grid", async () => {
    const { t, planId } = await setup();
    await invoke(t, planId, "createDocument", { topic: `${SMOKE} price list`, form: "sheet" });
    const doc = (await docs(t))[0]!;
    expect(doc.storedMimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    assertWorkbook(await bytesAt(t, doc.storageId!));
    const grid = await t
      .withIdentity({ subject: "t1" })
      .query(api.vault.vaultDocSheets, { vaultDocId: doc._id });
    expect(grid?.sheets[0]?.rows.find((row) => row[0] === "Setup")?.[1]).toContain("500");
    await expect(
      t.withIdentity({ subject: "t2" }).query(api.vault.vaultDocSheets, { vaultDocId: doc._id }),
    ).resolves.toBeNull();
  });
  test("spreadsheet attachments reach the styled writer and store actual numeric XLSX bytes", async () => {
    const { t, planId } = await setup();
    await invoke(t, planId, "generateAttachment", { topic: `${SMOKE} price list`, format: "xlsx" });
    const attachment = (await t.run((ctx) => ctx.db.get(planId)))!.attachments![0]!;
    expect(attachment.filename).toMatch(/\.xlsx$/u);
    assertWorkbook(await bytesAt(t, attachment.storageId));
  });
  test("failed registry drafting preserves the previous presentation, preview and stored-byte ownership", async () => {
    const { t, planId } = await setup();
    await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} good review`,
      form: "presentation",
    });
    const before = (await docs(t))[0]!;
    const originalBytes = await bytesAt(t, before.storageId!);
    const originalPreview = await t
      .withIdentity({ subject: "t1" })
      .query(api.vaultPresentations.byDoc, { docId: before._id });
    await t.run(async (ctx) => {
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) =>
          q.eq("name", PRESENTATION_DRAFTER_SKILL).eq("status", "active"),
        )
        .unique();
      await ctx.db.patch(skill!._id, { status: "archived" });
    });
    const failure = await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} replacement`,
      form: "presentation",
      replace: 1,
    });
    expect(failure).toMatch(/couldn't create/u);
    expect(await docs(t)).toEqual([before]);
    expect(await bytesAt(t, before.storageId!)).toEqual(originalBytes);
    expect(
      await t
        .withIdentity({ subject: "t1" })
        .query(api.vaultPresentations.byDoc, { docId: before._id }),
    ).toEqual(originalPreview);
    expect(await storageRows(t)).toHaveLength(1);
  });
  test("changing presentation to sheet and back replaces actual bytes and removes each stale preview", async () => {
    const { t, planId } = await setup();
    const owner = t.withIdentity({ subject: "t1" });
    await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} initial deck`,
      form: "presentation",
    });
    const first = (await docs(t))[0]!;
    await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} convert to prices`,
      form: "sheet",
      replace: 1,
    });
    const sheet = (await docs(t))[0]!;
    expect(sheet._id).toBe(first._id);
    expect(sheet.storageId).not.toBe(first.storageId);
    assertWorkbook(await bytesAt(t, sheet.storageId!));
    await expect(
      owner.query(api.vaultPresentations.byDoc, { docId: first._id }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("vaultPresentations").collect())).toHaveLength(0);
    expect(await owner.query(api.vault.vaultDocSheets, { vaultDocId: first._id })).not.toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(first.storageId!))).toBeNull();
    await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} return to presentation`,
      form: "presentation",
      replace: 1,
    });
    const final = (await docs(t))[0]!;
    expect(final._id).toBe(first._id);
    assertPresentation(await bytesAt(t, final.storageId!));
    expect(await owner.query(api.vaultPresentations.byDoc, { docId: first._id })).not.toBeNull();
    await expect(
      owner.query(api.vault.vaultDocSheets, { vaultDocId: first._id }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("vaultSheets").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.storage.getUrl(sheet.storageId!))).toBeNull();
    expect(await docs(t)).toHaveLength(1);
    expect(await storageRows(t)).toHaveLength(1);
  });
  test("refused replacement does not orphan a newly rendered PPTX or mutate the existing document", async () => {
    const { t, planId } = await setup();
    await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} good review`,
      form: "presentation",
    });
    const before = (await docs(t))[0]!;
    const refused = await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} invalid index`,
      form: "presentation",
      replace: 99,
    });
    expect(refused).toMatch(/no document #99/u);
    expect(await docs(t)).toEqual([before]);
    expect(await storageRows(t)).toHaveLength(1);
  });
  test.each([
    "sheet",
    "presentation",
  ] as const)("optional %s preview failure preserves one original and completes its Output card without redrafting", async (form) => {
    let drafts = 0,
      projections = 0;
    const spec = {
      title: "Smoke Presentation",
      slides: [
        { kind: "cover", title: "Smoke Presentation" },
        {
          kind: "bullets",
          title: "Next steps",
          bullets: ["Review the source evidence", "Choose the next action"],
        },
      ],
    };
    const draft = internalAction({
      args: {
        tenantId: v.string(),
        safeText: v.string(),
        safeTextHash: v.optional(v.string()),
        skillName: v.optional(v.string()),
        skillVersion: v.optional(v.number()),
        evalBudgetId: v.optional(v.id("spendEvents")),
      },
      handler: async () => {
        drafts++;
        return form === "presentation"
          ? { ok: true, title: spec.title, markdown: presentationToMarkdown(spec), spec }
          : {
              ok: true,
              title: "Smoke Prices",
              markdown:
                "## Prices\n\n| Item | Unit price (USD) |\n| --- | --- |\n| Setup | 500 |\n| Monthly | 120 |\n",
            };
      },
    });
    const overrides: Record<string, () => Promise<unknown>> = {
      "./llm.ts": async () => ({
        ...(await import("./llm")),
        [form === "presentation" ? "draftPresentation" : "draftDocument"]: draft,
      }),
    };
    if (form === "sheet")
      overrides["./vault.ts"] = async () => ({
        ...(await import("./vault")),
        upsertSheets: internalMutation({
          args: {
            tenantId: v.string(),
            docId: v.id("vaultDocuments"),
            sheets: v.any(),
            sheetCount: v.number(),
            expectedStorageId: v.optional(v.id("_storage")),
          },
          handler: async () => {
            projections++;
            throw new Error("fixture_optional_preview_failure");
          },
        }),
      });
    else
      overrides["./vaultPresentations.ts"] = async () => ({
        ...(await import("./vaultPresentations")),
        upsert: internalMutation({
          args: {
            tenantId: v.string(),
            docId: v.id("vaultDocuments"),
            spec: v.string(),
            expectedStorageId: v.optional(v.id("_storage")),
          },
          handler: async () => {
            projections++;
            throw new Error("fixture_optional_preview_failure");
          },
        }),
      });
    const { t, planId } = await setup(overrides);
    const response = await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} preview failure fixture`,
      form,
    });
    expect(response).toContain("saved to your vault");
    if (form === "presentation") expect(response).toContain("slide preview is unavailable");
    expect(drafts).toBe(1);
    expect(projections).toBe(1);
    const rows = await docs(t);
    expect(rows).toHaveLength(1);
    const bytes = await bytesAt(t, rows[0]!.storageId!);
    if (form === "sheet") assertWorkbook(bytes);
    else assertPresentation(bytes);
    expect(await storageRows(t)).toHaveLength(1);
    const cards = await t.run((ctx) => ctx.db.query("vaultSources").collect());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ role: "created", form, docIds: [rows[0]!._id] });
    expect(
      (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
        (row) => row.eventType === "document.created",
      ),
    ).toHaveLength(1);
  });
  test("a large generated workbook keeps full original data while projecting a bounded actual-file preview", async () => {
    let drafts = 0;
    const draftDocument = internalAction({
      args: {
        tenantId: v.string(),
        safeText: v.string(),
        safeTextHash: v.string(),
        skillName: v.optional(v.string()),
        skillVersion: v.optional(v.number()),
        evalBudgetId: v.optional(v.id("spendEvents")),
      },
      handler: async () => {
        drafts++;
        return {
          ok: true,
          title: "Large operating report",
          markdown: `## Data\n\n| Item | Quantity |\n| --- | --- |\n${Array.from({ length: 201 }, (_, index) => `| Product ${index + 1} | ${index + 1} |`).join("\n")}\n`,
        };
      },
    });
    const { t, planId } = await setup({
      "./llm.ts": async () => ({ ...(await import("./llm")), draftDocument }),
    });
    const response = await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} large report fixture`,
      form: "sheet",
    });
    expect(response).toContain("saved to your vault");
    const doc = (await docs(t))[0]!;
    const workbook = XLSX.read(await bytesAt(t, doc.storageId!), { type: "array" });
    const actualSheet = workbook.Sheets[workbook.SheetNames[0]!]!;
    expect(actualSheet.B206).toMatchObject({ t: "n", v: 201 });
    const preview = await t
      .withIdentity({ subject: "t1" })
      .query(api.vault.vaultDocSheets, { vaultDocId: doc._id });
    expect(preview?.sheets[0]?.rows.length).toBeLessThanOrEqual(200);
    expect(preview?.sheets[0]?.totalRows).toBeGreaterThan(200);
    expect(preview?.sheets[0]?.totalCols).toBe(2);
    expect(drafts).toBe(1);
    expect(await storageRows(t)).toHaveLength(1);
  });
  test.each([
    "sheet",
    "presentation",
  ] as const)("a delayed %s projection cannot overwrite a newer original's preview", async (form) => {
    const { t, planId } = await setup();
    await invoke(t, planId, "createDocument", { topic: `${SMOKE} first original`, form });
    const first = (await docs(t))[0]!;
    await invoke(t, planId, "createDocument", {
      topic: `${SMOKE} newer original`,
      form,
      replace: 1,
    });
    const current = (await docs(t))[0]!;
    expect(current.storageId).not.toBe(first.storageId);
    const owner = t.withIdentity({ subject: "t1" });
    if (form === "sheet") {
      const preview = await owner.query(api.vault.vaultDocSheets, { vaultDocId: current._id });
      await expect(
        t.mutation(internal.vault.upsertSheets, {
          tenantId: "t1",
          docId: current._id,
          expectedStorageId: first.storageId!,
          sheets: [{ name: "STALE", rows: [["stale"]], totalRows: 1, totalCols: 1 }],
          sheetCount: 1,
        }),
      ).rejects.toThrow("stale_sheet_preview");
      expect(await owner.query(api.vault.vaultDocSheets, { vaultDocId: current._id })).toEqual(
        preview,
      );
      assertWorkbook(await bytesAt(t, current.storageId!));
    } else {
      const preview = await owner.query(api.vaultPresentations.byDoc, { docId: current._id });
      await expect(
        t.mutation(internal.vaultPresentations.upsert, {
          tenantId: "t1",
          docId: current._id,
          expectedStorageId: first.storageId!,
          spec: JSON.stringify({
            title: "STALE",
            slides: [{ kind: "cover", title: "Stale preview" }],
          }),
        }),
      ).rejects.toThrow("stale_presentation_preview");
      expect(await owner.query(api.vaultPresentations.byDoc, { docId: current._id })).toEqual(
        preview,
      );
      assertPresentation(await bytesAt(t, current.storageId!));
    }
    expect((await docs(t))[0]?.storageId).toBe(current.storageId);
    expect(await t.run((ctx) => ctx.storage.getUrl(first.storageId!))).toBeNull();
    expect(await storageRows(t)).toHaveLength(1);
  });
});
