import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import schema from "./schema";
import { boundedUploadBody, MAX_UPLOAD_BYTES } from "./uploads";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://app.example.com");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("stream cap measures actual bytes independently of declared headers", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
      controller.enqueue(new Uint8Array(3));
      controller.close();
    },
  });
  await expect(new Response(boundedUploadBody(body, 5)).arrayBuffer()).rejects.toThrow(
    "UPLOAD_SIZE_INVALID",
  );
});

test("Vault refuses foreign sidecars and leaves duplicate upload bytes eligible for expiry", async () => {
  const t = convexTest(schema, modules);
  const [original, sidecar] = await t.run(async (ctx) => {
    const ids = [];
    for (const tenantId of ["owner", "other"]) {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      await ctx.db.insert("uploadReceipts", {
        tenantId,
        storageId,
        ticketHash: storageId,
        state: "complete",
        expiresAt: Date.now() + 10000,
      });
      ids.push(storageId);
    }
    await ctx.db.insert("vaultDocuments", {
      tenantId: "owner",
      title: "existing",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "application/pdf",
      size: 1,
      contentHash: "same",
      status: "ready",
      createdAt: Date.now(),
    });
    return ids;
  });
  const owner = t.withIdentity({ subject: "owner" });
  await expect(
    owner.mutation(api.vault.vaultUpload, {
      storageId: original!,
      transcriptionStorageId: sidecar!,
      filename: "duplicate.pdf",
      mimeType: "application/pdf",
      size: 1,
      contentHash: "same",
    }),
  ).rejects.toThrow("UPLOAD_NOT_OWNED");
  expect(
    (
      await owner.mutation(api.vault.vaultUpload, {
        storageId: original!,
        filename: "duplicate.pdf",
        mimeType: "application/pdf",
        size: 1,
        contentHash: "same",
      })
    ).deduped,
  ).toBe(true);
  const receipt = await t.query(internal.uploads.requireOwned, {
    tenantId: "owner",
    storageId: original!,
  });
  expect(receipt.expiresAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
});

test("stream relay binds actual bytes to the issuer, keeps URL contract and rejects ticket reuse", async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "tenant-a" });
  const url = await owner.mutation(api.requests.generateUploadUrl, {});
  expect(typeof url).toBe("string");
  let bytes = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const blob = await new Response(options.body).blob();
      bytes = await blob.text();
      const storageId = await t.run((ctx) => ctx.storage.store(blob));
      return Response.json({ storageId });
    }),
  );
  const request = {
    method: "POST",
    headers: { Origin: "https://app.example.com", "Content-Type": "text/plain" },
    body: "owned bytes",
  };
  const response = await t.fetch(new URL(url).pathname + new URL(url).search, request);
  expect(response.status).toBe(200);
  const { storageId } = await response.json();
  expect(bytes).toBe("owned bytes");
  expect(
    (await t.query(internal.uploads.requireOwned, { tenantId: "tenant-a", storageId })).storageId,
  ).toBe(storageId);
  await expect(
    t.query(internal.uploads.requireOwned, { tenantId: "tenant-b", storageId }),
  ).rejects.toThrow("UPLOAD_NOT_OWNED");
  expect((await t.fetch(new URL(url).pathname + new URL(url).search, request)).status).toBe(400);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("foreign origin, oversized declaration and erased issuer never start upload", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const owner = t.withIdentity({ subject: String(userId) });
  const url = new URL(await owner.mutation(api.requests.generateUploadUrl, {}));
  const path = url.pathname + url.search;
  vi.stubGlobal("fetch", vi.fn());
  expect(
    (
      await t.fetch(path, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: "x",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await t.fetch(path, {
        method: "POST",
        headers: {
          Origin: "https://app.example.com",
          "Content-Length": String(MAX_UPLOAD_BYTES + 1),
        },
        body: "x",
      })
    ).status,
  ).toBe(400);
  await t.mutation(internal.authRevocations.beginErasure, { userId });
  expect(
    (
      await t.fetch(path, {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
        body: "x",
      })
    ).status,
  ).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test("upload completion racing erasure deletes only its newly created blob", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const url = new URL(
    await t.withIdentity({ subject: String(userId) }).mutation(api.requests.generateUploadUrl, {}),
  );
  let created: string | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const blob = await new Response(options.body).blob();
      created = await t.run((ctx) => ctx.storage.store(blob));
      await t.mutation(internal.authRevocations.beginErasure, { userId });
      return Response.json({ storageId: created });
    }),
  );
  const response = await t.fetch(url.pathname + url.search, {
    method: "POST",
    headers: { Origin: "https://app.example.com" },
    body: "x",
  });
  expect(response.status).toBe(400);
  expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
  expect(created).toBeTruthy();
});

test("expired tickets and unbound completed uploads are purged, bound bytes survive", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [i, expiresAt] of [Date.now() - 1, Number.MAX_SAFE_INTEGER].entries()) {
      const storageId = await ctx.storage.store(new Blob([String(i)]));
      await ctx.db.insert("uploadReceipts", {
        tenantId: "owner",
        ticketHash: await contentHash(String(i)),
        state: "complete",
        storageId,
        expiresAt,
      });
    }
  });
  expect(await t.mutation(internal.uploads.purgeExpired, {})).toBe(1);
  expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
});
