// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspectWebAssetBytes } from "@pikar/core/webAssets";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import schema from "./schema";
import { servePublishedAsset } from "./webAssets";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// A complete 2×1 RGBA PNG keeps repeated HTTP privacy checks fast. The specialist-loop suite
// separately prepares and renders the real full-size design-study fixture through its tools.
const imageBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
    "base64",
  ),
);
beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site"));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const otherId = await t.run((ctx) => ctx.db.insert("users", {}));
  const planId = await t.mutation(internal.plans.insertPlan, { tenantId, threadId: "image-site" });
  const session = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    planId,
    threadId: "image-site",
    text: "Acme designs gardens for homeowners.",
  });
  const user = t.withIdentity({ subject: `${tenantId}|session` });
  return { t, tenantId, otherId, planId, session, user };
}
type Stack = Awaited<ReturnType<typeof setup>>;
async function source(
  s: Stack,
  options: { tenantId?: string; bytes?: Uint8Array; mimeType?: string; generated?: boolean } = {},
) {
  return s.t.run(async (ctx) => {
    const bytes = options.bytes ?? imageBytes;
    const mimeType = options.mimeType ?? "image/png";
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
    );
    const id = await ctx.db.insert("vaultDocuments", {
      tenantId: options.tenantId ?? s.tenantId,
      title: "Garden illustration",
      kind: options.generated ? "image" : "upload",
      category: "media",
      source: "upload",
      mimeType: options.generated ? "text/markdown" : mimeType,
      ...(options.generated
        ? { storedMimeType: mimeType, text: "Invented claims in a generation prompt" }
        : {}),
      storageId,
      contentHash: "original-source-hash",
      size: bytes.length,
      status: "ready",
      createdAt: 1,
    });
    return { id, storageId, sourceRef: `vault:${id}` };
  });
}
async function prepared(s: Stack) {
  const original = await source(s);
  const result = await s.t.action(internal.webAssets.prepareForPresence, {
    tenantId: s.tenantId,
    planId: s.planId,
    sourceRefs: [original.sourceRef],
  });
  expect(result.rejected).toEqual([]);
  const asset = result.assets[0];
  if (!asset) throw new Error("Missing prepared image");
  return { original, asset };
}
const document = (assetRef: string) => ({
  kind: "site" as const,
  title: "Garden studio",
  brand: { name: "Acme" },
  navigation: [],
  pages: [
    {
      slug: "home",
      title: "Home",
      nodes: [
        {
          kind: "media" as const,
          storageRef: assetRef,
          alt: "An illustration of garden planting",
          placement: "hero" as const,
        },
      ],
    },
  ],
});

test("owned raster intake copies exact safe bytes once; generated source prompts remain private metadata", async () => {
  const s = await setup();
  const { original, asset } = await prepared(s);
  expect(asset).toMatchObject(inspectWebAssetBytes(imageBytes, "image/png"));
  expect(asset.assetRef).toMatch(/^webasset:[A-Za-z0-9_-]+:[a-f0-9]{64}$/);
  const again = await s.t.action(internal.webAssets.prepareForPresence, {
    tenantId: s.tenantId,
    planId: s.planId,
    sourceRefs: [original.sourceRef],
  });
  expect(again.assets).toEqual([asset]);
  const rows = await s.t.run((ctx) => ctx.db.query("webAssets").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.storageId).not.toBe(original.storageId);
  const receipts = await s.t.run((ctx) => ctx.db.query("uploadReceipts").collect());
  expect(receipts).toHaveLength(1);
  expect(receipts[0]?.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
  const generated = await source(s, { generated: true });
  const context = await s.t.query(internal.onlinePresence.contextForTenant, {
    tenantId: s.tenantId,
    planId: s.planId,
  });
  expect(context.assetCandidates).toContainEqual(
    expect.objectContaining({ sourceRef: generated.sourceRef }),
  );
  expect(JSON.stringify(context.assetCandidates)).not.toContain("Invented claims");
  expect(JSON.stringify(context.assetCandidates)).not.toContain("storageId");
  expect(
    await s.t.mutation(internal.onlinePresence.saveBrief, {
      tenantId: s.tenantId,
      planId: s.planId,
      expectedRevision: s.session.revision,
      brief: {
        kind: "website",
        businessName: "Acme",
        headline: "Gardens designed around you",
        summary: "Garden design for homeowners.",
        audience: "Homeowners",
        sourceRefs: [s.session.sourceRef, generated.sourceRef],
      },
    }),
  ).toMatchObject({ ok: true });
  const selected = await s.t.query(internal.onlinePresence.contextForTenant, {
    tenantId: s.tenantId,
    planId: s.planId,
  });
  expect(selected.sources).toContainEqual(
    expect.objectContaining({
      ref: generated.sourceRef,
      text: "Owned image selected for private website preparation. Image descriptions are not business evidence.",
      visibility: "private",
    }),
  );
  expect(JSON.stringify(selected.sources)).not.toContain("Invented claims");
});

test("foreign sources, mislabeled bytes and stale revisions cannot become owned public assets", async () => {
  const s = await setup();
  const foreign = await source(s, { tenantId: s.otherId });
  const bad = await source(s, { bytes: new TextEncoder().encode('<svg onload="alert(1)"></svg>') });
  const mislabeled = await source(s, { mimeType: "image/jpeg" });
  const result = await s.t.action(internal.webAssets.prepareForPresence, {
    tenantId: s.tenantId,
    planId: s.planId,
    sourceRefs: [foreign.sourceRef, bad.sourceRef, mislabeled.sourceRef],
  });
  expect(result.assets).toEqual([]);
  expect(result.rejected).toHaveLength(3);
  expect(await s.t.run((ctx) => ctx.db.query("webAssets").collect())).toEqual([]);
  const own = await source(s);
  const current = await s.t.query(internal.webAssets.sourceForPresence, {
    tenantId: s.tenantId,
    planId: s.planId,
    sourceRef: own.sourceRef,
  });
  if (!current) throw new Error("Source missing");
  await s.t.run((ctx) => ctx.db.patch(own.id, { contentHash: "source-edited-after-inspection" }));
  await expect(
    s.t.mutation(internal.webAssets.commitCopy, {
      tenantId: s.tenantId,
      planId: s.planId,
      sourceRef: own.sourceRef,
      sourceRevision: current.sourceRevision,
      storageId: own.storageId,
      ...inspectWebAssetBytes(imageBytes, "image/png"),
    }),
  ).rejects.toThrow("WEB_ASSET_SOURCE_CHANGED");
});

test("immutable image snapshots stay private until exact publication, refuse foreign reads, survive original deletion and close on unpublish", async () => {
  const s = await setup();
  const { original, asset } = await prepared(s);
  const created = await s.user.mutation(api.webProjects.createDraft, {
    kind: "site",
    slug: "garden",
    title: "Garden",
    document: document(asset.assetRef),
  });
  const refs = await s.user.query(api.webAssets.listVersionAssets, {
    projectId: created.projectId,
    version: 1,
  });
  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({ assetRef: asset.assetRef, sourceRef: original.sourceRef });
  expect(refs[0]).not.toHaveProperty("storageId");
  const preview = await s.user.action(api.webAssets.previewAsset, {
    projectId: created.projectId,
    version: 1,
    assetRef: asset.assetRef,
  });
  expect(preview.dataUrl).toBe(
    `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`,
  );
  const other = s.t.withIdentity({ subject: `${s.otherId}|session` });
  await expect(
    other.action(api.webAssets.previewAsset, {
      projectId: created.projectId,
      version: 1,
      assetRef: asset.assetRef,
    }),
  ).rejects.toThrow("WEB_PROJECT_UNAVAILABLE");
  await expect(
    other.mutation(api.webProjects.createDraft, {
      kind: "site",
      slug: "foreign",
      title: "Foreign",
      document: document(asset.assetRef),
    }),
  ).rejects.toThrow("WEB_ASSET_UNAVAILABLE");
  const route = `/p/garden/assets/${refs[0]?.assetId}/${asset.contentHash.slice(7)}`;
  expect((await s.t.fetch(route)).status).toBe(404);
  const approval = await s.user.mutation(api.webProjects.approveVersion, {
    projectId: created.projectId,
    version: 1,
    contentHash: created.contentHash,
  });
  const publication = await s.user.mutation(api.webProjects.publishVersion, {
    projectId: created.projectId,
    version: 1,
    contentHash: created.contentHash,
    expectedRevision: approval.revision,
  });
  expect(publication.ok).toBe(true);
  const response = await s.t.fetch(route);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes);
  expect(
    await s.t.query(internal.webAssets.resolvePublishedAsset, {
      host: "attacker.example",
      slug: "garden",
      assetId: refs[0]?.assetId ?? "missing",
      digest: asset.contentHash.slice(7),
    }),
  ).toBeNull();
  expect((await s.t.fetch(`${route}?tenantId=${s.tenantId}`)).status).toBe(404);
  await s.t.run(async (ctx) => {
    await ctx.db.delete(original.id);
    await ctx.storage.delete(original.storageId);
  });
  expect((await s.t.fetch(route)).status).toBe(200);
  const another = await prepared(s);
  const next = await s.user.mutation(api.webProjects.saveDraft, {
    projectId: created.projectId,
    expectedRevision: publication.revision,
    document: { ...document(another.asset.assetRef), title: "New draft" },
  });
  expect((await s.t.fetch(route)).status).toBe(200);
  const nextRefs = await s.user.query(api.webAssets.listVersionAssets, {
    projectId: created.projectId,
    version: next.version,
  });
  const nextRoute = `/p/garden/assets/${nextRefs[0]?.assetId}/${another.asset.contentHash.slice(7)}`;
  expect((await s.t.fetch(nextRoute)).status).toBe(404);
  const nextApproval = await s.user.mutation(api.webProjects.approveVersion, {
    projectId: created.projectId,
    version: next.version,
    contentHash: next.contentHash,
  });
  const nextPublished = await s.user.mutation(api.webProjects.publishVersion, {
    projectId: created.projectId,
    version: next.version,
    contentHash: next.contentHash,
    expectedRevision: nextApproval.revision,
  });
  expect(nextPublished.ok).toBe(true);
  expect((await s.t.fetch(route)).status).toBe(404);
  expect((await s.t.fetch(nextRoute)).status).toBe(200);
  await s.user.mutation(api.webProjects.unpublish, {
    projectId: created.projectId,
    expectedRevision: nextPublished.revision,
  });
  expect((await s.t.fetch(nextRoute)).status).toBe(404);
});

test("service briefs require selected matching image source revision; erasure closes intake and preview", async () => {
  const s = await setup();
  const { original, asset } = await prepared(s);
  const brief = {
    kind: "website",
    businessName: "Acme",
    headline: "Gardens designed around you",
    summary: "Garden design for homeowners.",
    audience: "Homeowners",
    sourceRefs: [s.session.sourceRef],
    media: { hero: { storageRef: asset.assetRef, alt: "A garden illustration" } },
  };
  const missing = await s.t.mutation(internal.onlinePresence.saveBrief, {
    tenantId: s.tenantId,
    planId: s.planId,
    expectedRevision: s.session.revision,
    brief,
  });
  expect(missing).toMatchObject({ ok: false, assessment: { missing: [{ field: "media" }] } });
  const accepted = await s.t.mutation(internal.onlinePresence.saveBrief, {
    tenantId: s.tenantId,
    planId: s.planId,
    expectedRevision: s.session.revision,
    brief: { ...brief, sourceRefs: [...brief.sourceRefs, original.sourceRef] },
  });
  expect(accepted.ok).toBe(true);
  await s.t.run((ctx) => ctx.db.patch(original.id, { contentHash: "source-revised" }));
  expect(
    await s.t.mutation(internal.onlinePresence.saveBrief, {
      tenantId: s.tenantId,
      planId: s.planId,
      expectedRevision: accepted.revision,
      brief: { ...brief, sourceRefs: [...brief.sourceRefs, original.sourceRef] },
    }),
  ).toMatchObject({ ok: false });
  const created = await s.user.mutation(api.webProjects.createDraft, {
    kind: "site",
    slug: "erase",
    title: "Erase",
    document: document(asset.assetRef),
  });
  await s.t.run((ctx) =>
    ctx.db.insert("authRevocations", {
      userId: s.tenantId,
      state: "deleting",
      expiresAt: Number.MAX_SAFE_INTEGER,
    }),
  );
  await expect(
    s.user.action(api.webAssets.previewAsset, {
      projectId: created.projectId,
      version: 1,
      assetRef: asset.assetRef,
    }),
  ).rejects.toThrow(/UNAUTHENTICATED|TENANT_ERASURE_IN_PROGRESS/);
  expect(
    (
      await s.t.action(internal.webAssets.prepareForPresence, {
        tenantId: s.tenantId,
        planId: s.planId,
        sourceRefs: [original.sourceRef],
      })
    ).assets,
  ).toEqual([]);
});

test("public large-image GET returns exact staged bytes and refuses changed storage identity, size and publication head", async () => {
  const s = await setup();
  const bytes = new Uint8Array(
    readFileSync(
      new URL("../../../apps/web/e2e/fixtures/online-presence/design-study.png", import.meta.url),
    ),
  );
  expect(bytes.length).toBeGreaterThan(3_000_000);
  const original = await source(s, { bytes });
  const prepared = await s.t.action(internal.webAssets.prepareForPresence, {
    tenantId: s.tenantId,
    planId: s.planId,
    sourceRefs: [original.sourceRef],
  });
  expect(prepared.rejected).toEqual([]);
  const asset = prepared.assets[0];
  if (!asset) throw new Error("Full-size fixture was not prepared");
  const created = await s.user.mutation(api.webProjects.createDraft, {
    kind: "site",
    slug: "large-image",
    title: "Large image",
    document: document(asset.assetRef),
  });
  const approval = await s.user.mutation(api.webProjects.approveVersion, {
    projectId: created.projectId,
    version: 1,
    contentHash: created.contentHash,
  });
  const published = await s.user.mutation(api.webProjects.publishVersion, {
    projectId: created.projectId,
    version: 1,
    contentHash: created.contentHash,
    expectedRevision: approval.revision,
  });
  expect(published.ok).toBe(true);
  const row = await s.t.run((ctx) => ctx.db.query("webAssets").unique());
  if (!row) throw new Error("Prepared row missing");
  const route = `/p/large-image/assets/${row._id}/${asset.contentHash.slice(7)}`;
  const start = performance.now();
  const response = await s.t.fetch(route);
  const returned = new Uint8Array(await response.arrayBuffer());
  const elapsedMs = performance.now() - start;
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
  expect(Buffer.from(returned).equals(Buffer.from(bytes))).toBe(true);
  expect(`sha256:${createHash("sha256").update(returned).digest("hex")}`).toBe(asset.contentHash);
  console.info(
    `Native immutable image GET: ${bytes.length} bytes in ${Math.round(elapsedMs)}ms (local test harness, not a hosted benchmark).`,
  );

  // A same-size substitution isolates the storage digest guard; no changed bytes reach GET.
  const substituted = new Uint8Array(bytes);
  substituted[substituted.length - 1] = (substituted[substituted.length - 1] ?? 0) ^ 1;
  const replacement = await s.t.run((ctx) =>
    ctx.storage.store(new Blob([substituted], { type: "image/png" })),
  );
  await s.t.run((ctx) => ctx.db.patch(row._id, { storageId: replacement }));
  expect((await s.t.fetch(route)).status).toBe(404);
  await s.t.run((ctx) =>
    ctx.db.patch(row._id, { storageId: row.storageId, byteLength: row.byteLength + 1 }),
  );
  expect((await s.t.fetch(route)).status).toBe(404);
  await s.t.run((ctx) => ctx.db.patch(row._id, { byteLength: row.byteLength }));

  // The real resolver/public head stays in use; only storage IO is fault-injected to exercise
  // returned-blob bounds independently of the authoritative storage metadata size check.
  const context = {
    runQuery: s.t.query.bind(s.t),
    storage: {
      get: async () => new Blob([bytes.subarray(1)], { type: "image/png" }),
    },
  } as unknown as ActionCtx;
  expect(
    (await servePublishedAsset(context, new Request(`https://some.convex.site${route}`))).status,
  ).toBe(404);

  const racing = {
    runQuery: s.t.query.bind(s.t),
    storage: {
      get: async () => {
        await s.user.mutation(api.webProjects.unpublish, {
          projectId: created.projectId,
          expectedRevision: published.revision,
        });
        return new Blob([bytes], { type: "image/png" });
      },
    },
  } as unknown as ActionCtx;
  expect(
    (await servePublishedAsset(racing, new Request(`https://some.convex.site${route}`))).status,
  ).toBe(404);
});
