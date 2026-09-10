import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import schema from "./schema";
import { VISUAL_FILE_LIMIT_BYTES } from "./verticalVisual";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// The existing shelf smoke's actual 1x1 PNG. No external fetch or model creates fixtures.
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
// A container signature probe, deliberately not evidence of successful JPEG pixel decoding.
const jpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(body = png, mimeType = "image/png", tenantId = "tenant-a") {
  const t = convexTest(schema, modules);
  const sourceDocId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(body)]));
    return ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Private screenshot",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType,
      size: 0,
      contentHash: "text-derived-stored-hash-is-not-image-hash",
      text: "PRIVATE OCR MUST NOT BE READ",
      storageId,
      status: "ready",
      createdAt: 1,
    });
  });
  const read = (expectedSha256?: string) =>
    t.action(internal.verticalVisual.readOwnedScreenshot, {
      tenantId: "tenant-a",
      sourceDocId,
      expectedSha256,
    });
  return { t, sourceDocId, read };
}

describe("trusted owned screenshot preparation", () => {
  test("returns actual PNG bytes and hash without network, OCR, writes or public authority", async () => {
    const { t, sourceDocId, read } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("NO_NETWORK_ALLOWED");
      }),
    );
    const result = await read();
    expect(new Uint8Array(result.bytes)).toEqual(png);
    expect(result).toEqual({
      bytes: result.bytes,
      mimeType: "image/png",
      sourceDocId,
      sha256: await contentHash(new Uint8Array(png)),
      byteLength: png.byteLength,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("skills").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  test("recognizes the JPEG container independently of PNG", async () => {
    const { read } = await fixture(jpeg, "image/jpeg");
    expect(await read()).toMatchObject({ mimeType: "image/jpeg", byteLength: jpeg.length });
  });

  test("rejects foreign and deleted documents", async () => {
    const foreign = await fixture(png, "image/png", "tenant-b");
    await expect(foreign.read()).rejects.toThrow(/not found/);
    const own = await fixture();
    await own.t.run((ctx) => ctx.db.delete(own.sourceDocId));
    await expect(own.read()).rejects.toThrow(/not found/);
  });

  test("rejects unfinished, sealed, unbacked and deleted storage", async () => {
    const { t, sourceDocId, read } = await fixture();
    await t.run((ctx) => ctx.db.patch(sourceDocId, { status: "processing" }));
    await expect(read()).rejects.toThrow("VISUAL_SOURCE_NOT_READY");
    await t.run(async (ctx) => {
      const folderId = await ctx.db.insert("vaultFolders", {
        tenantId: "tenant-a",
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
    await expect(read()).rejects.toThrow("VISUAL_SOURCE_SEALED");
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(sourceDocId);
      if (doc?.storageId) await ctx.storage.delete(doc.storageId);
      await ctx.db.patch(sourceDocId, { folderId: undefined });
    });
    await expect(read()).rejects.toThrow("VISUAL_SOURCE_MISSING");
    await t.run((ctx) => ctx.db.patch(sourceDocId, { storageId: undefined }));
    await expect(read()).rejects.toThrow("VISUAL_SOURCE_NOT_READY");
  });

  test.each([
    [png, "image/jpeg", "VISUAL_MIME_MISMATCH"],
    [jpeg, "image/png", "VISUAL_MIME_MISMATCH"],
    [png, "application/octet-stream", "VISUAL_FORMAT_UNSUPPORTED"],
    [
      new TextEncoder().encode('<svg><image href="https://example.test/private"/></svg>'),
      "image/png",
      "VISUAL_FORMAT_UNSUPPORTED",
    ],
    [
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]),
      "image/png",
      "VISUAL_FORMAT_UNSUPPORTED",
    ],
    [png.slice(0, 8), "image/png", "VISUAL_FORMAT_UNSUPPORTED"],
    [new Uint8Array(), "image/jpeg", "VISUAL_FORMAT_UNSUPPORTED"],
  ])("fails closed for unsupported/spoofed/truncated input %#", async (body, mime, error) => {
    const { read } = await fixture(body, mime);
    await expect(read()).rejects.toThrow(error);
  });

  test("checks actual storage size before materializing bytes despite a zero Vault.size", async () => {
    const { read } = await fixture(new Uint8Array(VISUAL_FILE_LIMIT_BYTES + 1));
    const materialize = vi.spyOn(Blob.prototype, "arrayBuffer");
    await expect(read()).rejects.toThrow("VISUAL_FILE_TOO_LARGE");
    expect(materialize).not.toHaveBeenCalled();
  });

  test("binds replay to exact bytes and rejects malformed or changed hashes", async () => {
    const { t, sourceDocId, read } = await fixture();
    const initial = await read();
    expect((await read(initial.sha256)).sha256).toBe(initial.sha256);
    await expect(read("untrusted hash")).rejects.toThrow("VISUAL_EXPECTED_HASH_INVALID");
    await expect(read("0".repeat(64))).rejects.toThrow("VISUAL_SOURCE_CHANGED");
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([...png, 0])]));
      await ctx.db.patch(sourceDocId, { storageId });
    });
    await expect(read(initial.sha256)).rejects.toThrow("VISUAL_SOURCE_CHANGED");
  });
});
