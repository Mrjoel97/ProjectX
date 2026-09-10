import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { utils, write } from "xlsx";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => vi.unstubAllGlobals());

async function fixture(owner = true) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { owner }));
  const viewer = t.withIdentity({ subject: `${userId}|session` });
  const addFile = async (
    mimeType = "text/csv",
    body: BlobPart = "Name,Value\nEast,12\nWest,4",
    tenantId = String(userId),
  ) =>
    t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([body]));
      return ctx.db.insert("vaultDocuments", {
        tenantId,
        title: "Private file",
        kind: "upload",
        category: "my-uploads",
        source: "upload",
        mimeType,
        size: 10,
        contentHash: "untrusted-stored-hash",
        text: "formatted preview is never read",
        storageId,
        status: "ready",
        createdAt: 1,
      });
    });
  return { t, userId, viewer, addFile };
}

describe("owner Data preview", () => {
  test("creates a normal retained artifact from owned storage bytes without any network call", async () => {
    const { t, viewer, userId, addFile } = await fixture();
    const sourceDocId = await addFile();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("NO_NETWORK_ALLOWED");
      }),
    );
    const result = await viewer.action(api.verticalData.previewDataset, {
      sourceDocId,
      hasHeader: true,
    });
    const artifact = await t.run((ctx) => ctx.db.get(result.artifactId));
    expect(result.rowCount).toBe(2);
    expect(artifact).toMatchObject({
      tenantId: String(userId),
      kind: "created_document",
      status: "ready",
      origin: "agent",
    });
    expect(artifact?.text).toContain("operator preview");
    expect(artifact?.text).toContain(sourceDocId);
    expect(artifact?.text).not.toContain("formatted preview is never read");
    expect(artifact?.text).not.toContain("untrusted-stored-hash");
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("skills").collect())).toEqual([]);
  });

  test("fails closed for anonymous/non-owner callers and another tenant's exact file", async () => {
    const { t, viewer, addFile } = await fixture(false);
    const sourceDocId = await addFile();
    await expect(t.action(api.verticalData.previewDataset, { sourceDocId })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
    await expect(viewer.action(api.verticalData.previewDataset, { sourceDocId })).rejects.toThrow(
      /OWNER_REQUIRED/,
    );
    const own = await fixture();
    const foreignDocId = await own.addFile("text/csv", "private", "another-tenant");
    await expect(
      own.viewer.action(api.verticalData.previewDataset, { sourceDocId: foreignDocId }),
    ).rejects.toThrow(/not found/);
    expect(await own.t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
  });

  test("trusted native preparation computes XLSX facts and formula warnings, never a model result", async () => {
    const { t, userId, addFile } = await fixture();
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([["Amount"], [12], [-4]]);
    sheet.B2 = { t: "n", v: 42, f: "6*7" };
    sheet["!ref"] = "A1:B3";
    utils.book_append_sheet(workbook, sheet, "Facts");
    const buffer = write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const sourceDocId = await addFile(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    );
    const profile = await t.action(internal.verticalData.profileOwnedDataset, {
      tenantId: String(userId),
      sourceDocId,
      hasHeader: true,
    });
    expect(profile.sheets[0]?.columns[0]?.numericRange).toEqual({ min: -4, max: 12 });
    expect(profile.warnings).toContain("formula_cached_values_only");
    expect(profile.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
  });

  test("rejects unsupported/unfinished/sealed files without writing an artifact", async () => {
    const { t, viewer, userId, addFile } = await fixture();
    const sourceDocId = await addFile("application/pdf");
    await expect(viewer.action(api.verticalData.previewDataset, { sourceDocId })).rejects.toThrow(
      "DATA_FORMAT_UNSUPPORTED",
    );
    await t.run((ctx) => ctx.db.patch(sourceDocId, { mimeType: "text/csv", status: "processing" }));
    await expect(viewer.action(api.verticalData.previewDataset, { sourceDocId })).rejects.toThrow(
      "DATA_SOURCE_NOT_READY",
    );
    await t.run(async (ctx) => {
      const folderId = await ctx.db.insert("vaultFolders", {
        tenantId: String(userId),
        name: "sealed",
        source: "upload",
        status: "ingesting",
        memberCount: 2,
        terminalCount: 1,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 0,
        createdAt: 1,
      });
      await ctx.db.patch(sourceDocId, { status: "ready", folderId });
    });
    await expect(viewer.action(api.verticalData.previewDataset, { sourceDocId })).rejects.toThrow(
      "DATA_SOURCE_SEALED",
    );
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
  });
});
