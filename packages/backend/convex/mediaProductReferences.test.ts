// @vitest-environment node
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import { nativeProductReferenceHash, nativeReelReviewHash } from "./media";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const tenantId = "reference_owner";

async function fixture() {
  const t = convexTest(schema, modules);
  const planId = await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "reference_chat",
      status: "proposed",
      mediaAudioMode: "native",
      createdAt: Date.now(),
    }),
  );
  const image = async (owner = tenantId) =>
    t.run(async (ctx) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFe0AAAAASUVORK5CYII=",
        ),
        (char) => char.charCodeAt(0),
      );
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
      const hash = await contentHash(bytes);
      const metadata = await ctx.db.system.get(storageId);
      if (!metadata) throw new Error("missing_fixture_storage");
      const docId = await ctx.db.insert("vaultDocuments", {
        tenantId: owner,
        title: "Approved product front",
        kind: "upload",
        category: "reference",
        source: "upload",
        mimeType: "image/png",
        size: metadata.size,
        contentHash: metadata.sha256,
        storageId,
        status: "ready",
        createdAt: Date.now(),
      });
      return { docId, storageId, metadata, hash };
    });
  return { t, planId, image, human: t.withIdentity({ subject: tenantId }) };
}

test("a same-millisecond product-reference change cannot reuse the previous product clip", async () => {
  const { t, human, planId, image } = await fixture();
  const first = await image();
  const second = await image();
  await human.mutation(api.media.setProductReferences, { planId, docIds: [first.docId] });
  const stamp = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, {
      targetDurationSeconds: 15,
      shotsChangedAt: stamp,
      shots: [
        {
          index: 0,
          type: "AI",
          seconds: 15,
          windowStartMs: 0,
          visual: "generated_video",
          description: "One approved product",
          prompt: "A deliberate product reveal",
          narration: "",
        },
      ],
    });
    const plan = await ctx.db.get(planId);
    if (!plan) throw new Error("missing_fixture_plan");
    const assetStorageId = await ctx.storage.store(
      new Blob(["fixture clip"], { type: "video/mp4" }),
    );
    await ctx.db.insert("mediaJobs", {
      tenantId,
      planId,
      batchId: "same_stamp_batch",
      blockIndex: 0,
      provider: "openai",
      kind: "video",
      model: "bytedance/seedance-2.0",
      spec: { kind: "video", resolution: "720p", seconds: 15, generateAudio: true },
      promptHash: await contentHash("fixture prompt"),
      nativeReviewHash: await nativeReelReviewHash(plan),
      nativeProductReferenceHash: await nativeProductReferenceHash(plan),
      status: "succeeded",
      assetStorageId,
      assetHash: await contentHash("fixture clip"),
      mimeType: "video/mp4",
      bytes: 12,
      estUsd: 2.4192,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
  expect(
    (
      await t.query(internal.render.renderReel.batchToRender, {
        tenantId,
        batchId: "same_stamp_batch",
      })
    ).ok,
  ).toBe(true);
  await human.mutation(api.media.setProductReferences, { planId, docIds: [second.docId] });
  // Force the timestamp tie: the reference identity must independently invalidate the old clip.
  await t.run((ctx) => ctx.db.patch(planId, { shotsChangedAt: stamp }));
  expect(
    await t.query(internal.render.renderReel.batchToRender, {
      tenantId,
      batchId: "same_stamp_batch",
    }),
  ).toEqual({ ok: false, reason: "stale_inputs" });
});

test("human picks pin actual immutable storage bytes and change only that product's review", async () => {
  const { t, human, planId, image } = await fixture();
  const picked = await image();
  const before = await t.run(async (ctx) => nativeReelReviewHash((await ctx.db.get(planId))!));
  expect(
    await human.mutation(api.media.setProductReferences, { planId, docIds: [picked.docId] }),
  ).toEqual({ ok: true });
  const plan = await t.run((ctx) => ctx.db.get(planId));
  expect(plan?.mediaProductReferences).toEqual([
    {
      docId: picked.docId,
      storageId: picked.storageId,
      contentHash: picked.hash,
      mimeType: "image/png",
      size: picked.metadata.size,
    },
  ]);
  expect(await nativeReelReviewHash(plan!)).not.toBe(before);
  const options = await human.query(api.media.productReferenceOptions, { planId });
  expect(options.selectedDocIds).toEqual([picked.docId]);
  expect(options.images[0]).toMatchObject({ docId: picked.docId, title: "Approved product front" });
  expect(await t.run((ctx) => ctx.db.query("mediaJobs").collect())).toEqual([]);
});

test("another customer's images and duplicate or excessive picks cannot attach", async () => {
  const { human, planId, image } = await fixture();
  const foreign = await image("another_owner");
  const own = await image();
  expect(
    await human.mutation(api.media.setProductReferences, { planId, docIds: [foreign.docId] }),
  ).toEqual({ ok: false, reason: "reference_unavailable" });
  expect(
    await human.mutation(api.media.setProductReferences, {
      planId,
      docIds: [own.docId, own.docId],
    }),
  ).toEqual({ ok: false, reason: "too_many_references" });
  expect(
    (await human.query(api.media.productReferenceOptions, { planId })).images.map((r) => r.docId),
  ).toEqual([own.docId]);
});

test("reserved references resolve to owned URLs, and stale or deleted source bytes refuse submission", async () => {
  const { t, human, planId, image } = await fixture();
  const picked = await image();
  await human.mutation(api.media.setProductReferences, { planId, docIds: [picked.docId] });
  const jobId = await t.run(async (ctx) => {
    const plan = (await ctx.db.get(planId))!;
    return ctx.db.insert("mediaJobs", {
      tenantId,
      planId,
      batchId: "reference_batch",
      blockIndex: 0,
      provider: "openai",
      kind: "video",
      model: "bytedance/seedance-2.0",
      spec: { kind: "video", resolution: "720p", seconds: 15, generateAudio: true },
      promptHash: await contentHash("approved prompt"),
      nativeReviewHash: await nativeReelReviewHash(plan),
      status: "submitted",
      estUsd: 2.4192,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  expect(await t.query(internal.media.productReferencesForSubmit, { jobId })).toEqual([
    expect.objectContaining({
      docId: picked.docId,
      contentHash: picked.hash,
      url: expect.stringMatching(/^https:\/\//),
    }),
  ]);
  await t.run((ctx) => ctx.db.patch(planId, { mediaProductReferences: [] }));
  expect(await t.query(internal.media.productReferencesForSubmit, { jobId })).toBeNull();
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, {
      mediaProductReferences: [
        {
          docId: picked.docId,
          storageId: picked.storageId,
          contentHash: picked.hash,
          mimeType: "image/png",
          size: picked.metadata.size,
        },
      ],
    });
    await ctx.storage.delete(picked.storageId);
  });
  expect(await t.query(internal.media.productReferencesForSubmit, { jobId })).toBeNull();
  const options = await human.query(api.media.productReferenceOptions, { planId });
  expect(options.images).toEqual([
    { docId: picked.docId, title: "Unavailable reference", url: null, mimeType: "", size: 0 },
  ]);
});
