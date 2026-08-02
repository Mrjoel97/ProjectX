/**
 * The Convex side of the render stage (MEDIA-01, D11, plan 20-15).
 *
 * Convex cannot encode video (D9), so the actual ffmpeg run happens in an ephemeral Vercel Sandbox
 * started by `apps/web/app/api/media/render/route.ts`. This module is the caller: it decides WHICH
 * bytes may be rendered, mints the two single-use upload URLs the runner writes back through,
 * POSTs to the route with the shared bearer, and owns the render terminal on the plan row.
 *
 * **The tenant boundary lives HERE, not on the route.** `batchToRender` reads `mediaJobs` through
 * the tenant-prefixed `by_batch` index, so every job id that reaches the runner is this tenant's by
 * construction. The blob route downstream takes ONLY a job id and reads everything else off the
 * row — it never accepts a tenant, a path or a storage id from a request (`http.ts:123-129`'s
 * rule). That is the whole containment; there is no second check on the route that would add one.
 *
 * Default runtime — NOT "use node". This needs `fetch`, `ctx.storage.generateUploadUrl`,
 * `ctx.storage.get`, `ctx.runQuery` and `ctx.runMutation`, all of which the regular action has.
 */
import { parseAssemblySidecar } from "@pikar/core/assembly";
import { buildCaptionLines, toAss } from "@pikar/core/captions";
import { renderInputName } from "@pikar/core/render";
import { v } from "convex/values";
import { internal } from "./../_generated/api";
import type { Doc, Id } from "./../_generated/dataModel";
import type { MutationCtx } from "./../_generated/server";
import { internalAction, internalMutation, internalQuery } from "./../_generated/server";
import { contentHash } from "./../lib/hash";
import { maybeBurnCaptions } from "./../mediaComplete";
import { requireEnvMedia } from "./../media";

/** Every way a render can be refused or can fail, as a CODE. `renderReason` on the plan row is a
 *  reasonCode field and never ffmpeg's prose — the schema comment says so and this union is what
 *  keeps it true from this side. The runner's own codes (`@pikar/core/render`) arrive as strings
 *  and land in the same field; both halves are closed sets. */
export type RenderRefusal =
  | "empty_batch"
  | "incomplete_blocks"
  | "not_all_succeeded"
  | "route_unreachable"
  | "route_rejected"
  | "sidecar_rejected_on_return";

type RenderInputs = {
  planId: Id<"plans">;
  blockCount: number;
  clipSeconds: number;
  inputs: Array<{ name: string; jobId: Id<"mediaJobs"> }>;
};

/**
 * The batch's renderable inputs, or a refusal — never a partial set.
 *
 * **A reel is all-or-nothing.** A batch missing one clip does not render a shorter reel: the
 * assembler asserts `--blocks N` before any work precisely so a dropped block FAILS instead of
 * silently shipping a hole. Catching it here means the failure is free, rather than a $0.02
 * sandbox that hard-errors on a missing input.
 *
 * NOTE ON A DECK THAT CANNOT RENDER: `reserveJobInner` creates a video line only `if
 * (isPaidBlock(block))`, so a deck containing a TEXT or SCREEN REC block has a voice take and NO
 * clip for that index — and `assemble_final.sh` requires both. Such a deck is refused here as
 * `incomplete_blocks` rather than discovering it inside the VM. Making those blocks renderable
 * (a generated title card, say) is a scope decision for the canvas, not a patch here.
 */
export const batchToRender = internalQuery({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<{ ok: true; value: RenderInputs } | { ok: false; reason: RenderRefusal }> => {
    // The index PREFIX is the tenant boundary — never a full-table scan, never a cross-tenant read.
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_batch", (q) => q.eq("tenantId", a.tenantId).eq("batchId", a.batchId))
      .collect();

    // `stt` (captions, plan 20-17) sits at blockIndex -1 and is not an assembly input.
    const renderable = rows.filter((r) => r.kind === "video" || r.kind === "tts");
    if (renderable.length === 0) return { ok: false, reason: "empty_batch" };

    const planId = renderable[0]?.planId;
    if (!planId) return { ok: false, reason: "empty_batch" };

    // Every input must have LANDED. A row that is queued, submitted, failed or blocked has no
    // bytes, and a `succeeded` row without an `assetStorageId` is the landing plane's own
    // impossible state — both refuse.
    if (renderable.some((r) => r.status !== "succeeded" || r.assetStorageId === undefined)) {
      return { ok: false, reason: "not_all_succeeded" };
    }

    // Contiguous 0..N-1, with BOTH a clip and a voice take at every index.
    const byIndex = new Map<number, { video?: Doc<"mediaJobs">; tts?: Doc<"mediaJobs"> }>();
    for (const row of renderable) {
      const slot = byIndex.get(row.blockIndex) ?? {};
      if (row.kind === "video") slot.video = row;
      else slot.tts = row;
      byIndex.set(row.blockIndex, slot);
    }
    const blockCount = byIndex.size;
    const inputs: RenderInputs["inputs"] = [];
    for (let i = 0; i < blockCount; i++) {
      const slot = byIndex.get(i);
      if (!slot?.video || !slot.tts) return { ok: false, reason: "incomplete_blocks" };
      // The filename mapping lives in ONE place (`@pikar/core/render`) so the clip and the voice
      // take cannot be numbered by two different pieces of code and drift — 20-13's whole reason
      // for dropping upstream's `--allow-mismatch` pair check.
      inputs.push({ name: renderInputName("video", i), jobId: slot.video._id });
      inputs.push({ name: renderInputName("tts", i), jobId: slot.tts._id });
    }

    // The window every block was PRICED at. Read off the row, not off a constant: the row is the
    // record of what was reserved, and `--clip-seconds` must describe the clips that were bought.
    const firstVideo = byIndex.get(0)?.video;
    const clipSeconds = firstVideo?.spec.kind === "video" ? firstVideo.spec.seconds : Number.NaN;
    if (!Number.isFinite(clipSeconds)) return { ok: false, reason: "incomplete_blocks" };

    return { ok: true, value: { planId, blockCount, clipSeconds, inputs } };
  },
});

/**
 * One landed asset, for the bearer-guarded blob route in `http.ts`.
 *
 * Takes ONLY a raw id. `normalizeId` returning null for a malformed or FOREIGN-TABLE id is the
 * fail-closed shape (`mediaComplete.resolveJob:61` carries the same three lines for the same
 * reason), and a job that is not `succeeded` has no bytes to serve.
 */
export const resolveRenderAsset = internalQuery({
  args: { raw: v.string() },
  handler: async (
    ctx,
    { raw },
  ): Promise<{ assetStorageId: Id<"_storage">; mimeType: string } | null> => {
    const jobId = ctx.db.normalizeId("mediaJobs", raw);
    if (jobId) {
      const row = await ctx.db.get(jobId);
      if (row?.status !== "succeeded" || !row.assetStorageId) return null;
      return {
        assetStorageId: row.assetStorageId,
        mimeType: row.mimeType ?? "application/octet-stream",
      };
    }
    // …or the PUBLISHED REEL itself (plan 20-17). The caption burn's input is `final.mp4`, which
    // lives on the plan row rather than on a `mediaJobs` row, so the same route serves it from the
    // same shape: an opaque id in, everything else read off the row. `normalizeId` is still the
    // fail-closed gate — a plan id that is not this deployment's, or a plan with no PUBLISHED reel,
    // resolves to nothing. A plan whose sidecar never validated has no `renderStorageId` and is
    // therefore unreachable here, which is the governance rule holding by construction.
    const planId = ctx.db.normalizeId("plans", raw);
    if (!planId) return null;
    const plan = await ctx.db.get(planId);
    if (plan?.renderStatus !== "rendered" || !plan.renderStorageId) return null;
    return { assetStorageId: plan.renderStorageId, mimeType: "video/mp4" };
  },
});

/**
 * The render terminal, on the PLAN row (the render plane is fields on `plans`, not a second table
 * — a reel is one artifact per plan, so a `mediaRenders` table would hold at most one row forever).
 *
 * A reel is publishable ONLY when BOTH ids are set and the sidecar validated, which is why the
 * success arm writes them together and every failure arm writes neither.
 */
export const recordRender = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    batchId: v.string(),
    result: v.union(
      v.object({
        ok: v.literal(true),
        renderStorageId: v.id("_storage"),
        sidecarStorageId: v.id("_storage"),
        sidecarHash: v.string(),
        blockCount: v.number(),
        renderMs: v.number(),
        gatesPassed: v.number(),
        /** The sidecar's own facts, for the canvas (20-09). Parsed ONCE, here, because a query
         *  cannot read a blob — `ctx.storage` in a query is a `StorageReader`. */
        summary: v.object({
          durationS: v.number(),
          blockCount: v.number(),
          gates: v.array(v.string()),
        }),
      }),
      v.object({ ok: v.literal(false), reason: v.string() }),
    ),
  },
  handler: async (ctx, a): Promise<null> => {
    if (!a.result.ok) {
      await ctx.db.patch(a.planId, {
        renderStatus: "failed",
        renderReason: a.result.reason,
        renderedAt: Date.now(),
      });
      // ONE dead letter, refs and codes ONLY (CLAUDE.md §4) — no ffmpeg output, no filename, no
      // narration, no URL. A failed render does NOT retry: at 480p a structural failure repeats,
      // and the action-retrier would buy N sandboxes to learn the same thing N times.
      await ctx.db.insert("deadLetters", {
        tenantId: a.tenantId,
        correlationId: a.batchId,
        workflowId: "media.render",
        payload: { batchId: a.batchId, planId: a.planId, reasonCode: a.result.reason },
        error: a.result.reason,
        status: "new",
        createdAt: Date.now(),
      });
      // THE INTERMEDIATES ARE KEPT. They are the only debugging evidence a failed render leaves,
      // and failures are rare — see the retention note on the success arm below.
      return null;
    }
    // `renderSummary` rides in the SAME patch as the two storage ids, and both are written only
    // after `parseAssemblySidecar` accepted the bytes. That co-location is what lets `media.reel`
    // treat their presence as proof the sidecar validated, without re-reading the blob.
    await ctx.db.patch(a.planId, {
      renderStatus: "rendered",
      renderStorageId: a.result.renderStorageId,
      sidecarStorageId: a.result.sidecarStorageId,
      sidecarHash: a.result.sidecarHash,
      renderSummary: a.result.summary,
      renderedAt: Date.now(),
    });
    // ONE insert-only audit row, refs/counts ONLY (§3/§4). No filename, no narration, no URL, no
    // stderr — and no `renderReason`, because a successful render has none.
    await ctx.runMutation(internal.audit.log, {
      tenantId: a.tenantId,
      correlationId: a.batchId,
      eventType: "media.rendered",
      actor: "render",
      payload: {
        batchId: a.batchId,
        planId: a.planId,
        blockCount: a.result.blockCount,
        renderMs: a.result.renderMs,
        sidecarHash: a.result.sidecarHash,
        gatesPassed: a.result.gatesPassed,
      },
    });

    /*
     * D12(b) RETENTION — delete on success, KEEP on failure. This loop IS the whole policy: no TTL,
     * no cron, no sweep job.
     *
     * The arithmetic that forces it: ~55 MB/job (6 clips ~30 MB + 6 voice takes ~5 MB + final.mp4
     * ~10 MB + the captioned cut ~10 MB) x 2 jobs/day = **~3.3 GB/month against a Convex
     * Free/Starter allowance of 1 GB TOTAL.**
     *
     * **ORDER MATTERS.** The plan row is patched FIRST (above), so the reel is published and
     * readable, and only THEN are the intermediates deleted. A crash between the two leaves
     * orphaned blobs — 35 MB of waste. A crash in the other order leaves a published reel whose
     * tiles point at deleted blobs — a broken canvas. **Fail toward waste, not toward a lie.**
     *
     * `final.mp4` and the sidecar are KEPT: deleting them would delete the deliverable.
     *
     * ponytail: upgrade path if failed-render debris ever accumulates is a scheduled sweep of
     * `mediaJobs` older than N days — which is a cron, and this deliberately is not one.
     */
    // THE NARROWED CONDITION (plan 20-17). One `if`, and the comment on `deleteIntermediates` is
    // where the reasoning lives so the two rules read as one decision rather than two.
    if (!(await captionsStillOwed(ctx, a.tenantId, a.batchId))) {
      await deleteIntermediates(ctx, a.tenantId, a.batchId);
    }
    // The reel is published either way. The burn, if one is owed, is triggered from here because
    // the transcript may well have landed while the render was still running.
    await maybeBurnCaptions(ctx, a.planId);
    return null;
  },
});

/**
 * The D12(b) cleanup, as a function because plan 20-17 gave it a SECOND caller.
 *
 * **NARROWED BY PLAN 20-17.** Plan 20-16's rule was *"delete once final.mp4 is published"*. The
 * clean voice takes are the CAPTION transcript's source, so with captions in the pipeline they must
 * survive past the assemble step — the condition below moves the deletion from "the reel exists" to
 * "the FINAL artifact exists". Cut captions and this reverts to 20-16's simpler rule automatically:
 * a deck with no `stt` line has nothing to wait for and is deleted at the render terminal exactly
 * as before.
 */
async function deleteIntermediates(
  ctx: MutationCtx,
  tenantId: string,
  batchId: string,
): Promise<void> {
  const spent = await ctx.db
    .query("mediaJobs")
    .withIndex("by_batch", (q) => q.eq("tenantId", tenantId).eq("batchId", batchId))
    .collect();
  const deleted = new Set<string>();
  for (const row of spent) {
    // Idempotent: a second pass over an already-cleaned batch finds no id and does nothing.
    if (!row.assetStorageId) continue;
    // …and `storage.delete` THROWS on an id that is already gone, so a blob referenced by two
    // rows would abort this loop AFTER the reel was published — leaving the rest of the batch
    // undeleted forever. Deduping is one line and removes the whole class.
    if (!deleted.has(row.assetStorageId)) {
      deleted.add(row.assetStorageId);
      await ctx.storage.delete(row.assetStorageId);
    }
    // Nulled in the SAME iteration as the delete. A nulled field pointing at a live blob is a
    // leak; a live field pointing at a deleted blob is a broken tile.
    await ctx.db.patch(row._id, { assetStorageId: undefined });
  }
}

/** Is a caption pass still owed on this batch? If so the takes STAY — deleting the transcript's
 *  source between the render and the burn is the one ordering this plan had to get right. */
async function captionsStillOwed(
  ctx: MutationCtx,
  tenantId: string,
  batchId: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query("mediaJobs")
    .withIndex("by_batch", (q) => q.eq("tenantId", tenantId).eq("batchId", batchId))
    .collect();
  const stt = rows.find((r) => r.kind === "stt");
  if (!stt) return false; // captions were never reserved — 20-16's behaviour, unchanged
  const plan = await ctx.db.get(stt.planId);
  // A FAILED caption pass keeps them too, for the same reason a failed render does: they are the
  // debugging evidence, and failures are rare. 20-16's "keep on failure" is not narrowed, only
  // "delete on success" is.
  return plan?.captionStatus !== "captioned";
}

/** The committed offline stub pair, used when `MEDIA_SANDBOX_FIXTURE` is set. */
type RouteSuccess = {
  ok: true;
  mp4StorageId: string;
  sidecarStorageId: string;
  renderMs: number;
  gates: string[];
  blockCount: number;
};

/**
 * Render a reserved, fully-landed batch into ONE finished mp4.
 *
 * Order is load-bearing: both env reads come FIRST so a missing secret refuses before any fetch
 * exists (the plan-20-05 `requireEnv` rule — `media.test.ts` asserts a fetch-call-count of ZERO,
 * not merely that the message was right), and the offline seam sits AFTER them so "no secret" is
 * the same refusal in fixture mode as in production.
 */
export const renderReel = internalAction({
  args: { tenantId: v.string(), batchId: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const secret = requireEnvMedia("MEDIA_RENDER_SECRET");
    const routeUrl = requireEnvMedia("MEDIA_RENDER_URL");

    const batch = await ctx.runQuery(internal.render.renderReel.batchToRender, a);
    if (!batch.ok) return { ok: false, reason: batch.reason };
    const { planId, blockCount, clipSeconds, inputs } = batch.value;

    await ctx.runMutation(internal.render.renderReel.markRendering, { planId });

    // Single-use, WRITE-ONLY, short-lived. Deliberately weaker than a read URL.
    // ponytail: Convex-minted upload URLs are the shipped file-ingest idiom and are a strictly
    // weaker capability than a read URL — write-only, one-shot, short-lived. Returning 10 MB in
    // the HTTP response instead would run into the platform's response-body limit. The ceiling:
    // these URLs are minted per render and must never be logged.
    const uploadUrls = {
      mp4: await ctx.storage.generateUploadUrl(),
      sidecar: await ctx.storage.generateUploadUrl(),
    };

    /* ponytail: MEDIA_SANDBOX_FIXTURE is the offline seam that keeps this whole path at $0 (the
     * `llm.ts:922` / `FAL_FIXTURE` precedent). **It MUST be the default in every test suite** —
     * on Hobby an accidental real `Sandbox.create` burns a shared monthly Active-CPU allotment
     * whose exhaustion PAUSES creation for 30 days: an OUTAGE, not a bill. Remove it only when a
     * hermetic sandbox mock exists. */
    const fixture = process.env.MEDIA_SANDBOX_FIXTURE;

    let outcome: RouteSuccess | { ok: false; code: string };
    if (fixture) {
      outcome = JSON.parse(fixture) as RouteSuccess | { ok: false; code: string };
    } else {
      // NOTHING FORBIDDEN CROSSES IN. This body is the complete list: no FAL_KEY, no
      // OPENAI_API_KEY, no Vercel credential, no tenantId, no fal URL, no `storage.getUrl` result,
      // no prompt and no narration. The job ids are opaque refs the runner appends to OUR OWN
      // blob origin — it is handed no URL to fetch at all.
      const response = await fetch(routeUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: a.batchId,
          blockCount,
          clipSeconds,
          inputs: inputs.map((i) => ({ name: i.name, jobId: i.jobId })),
          uploadUrls,
        }),
      }).catch(() => null);
      if (!response?.ok) {
        await ctx.runMutation(internal.render.renderReel.recordRender, {
          tenantId: a.tenantId,
          planId,
          batchId: a.batchId,
          result: { ok: false, reason: "route_unreachable" },
        });
        return { ok: false, reason: "route_unreachable" };
      }
      outcome = (await response.json()) as RouteSuccess | { ok: false; code: string };
    }

    if (!outcome.ok) {
      await ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: a.tenantId,
        planId,
        batchId: a.batchId,
        result: { ok: false, reason: outcome.code },
      });
      return { ok: false, reason: outcome.code };
    }

    // DEFENCE IN DEPTH, not duplication. The runner already validated this sidecar; doing it again
    // here — from the bytes that actually landed in OUR storage, with the same shipped validator —
    // means a compromised or buggy route cannot publish an ungoverned reel. It costs one function
    // call and one ~2 KB read.
    const sidecarStorageId = outcome.sidecarStorageId as Id<"_storage">;
    const blob = await ctx.storage.get(sidecarStorageId);
    const raw = blob ? await blob.text() : "";
    const reparsed = parseAssemblySidecar(raw);
    if (!reparsed.ok) {
      await ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: a.tenantId,
        planId,
        batchId: a.batchId,
        result: { ok: false, reason: "sidecar_rejected_on_return" },
      });
      return { ok: false, reason: "sidecar_rejected_on_return" };
    }

    await ctx.runMutation(internal.render.renderReel.recordRender, {
      tenantId: a.tenantId,
      planId,
      batchId: a.batchId,
      result: {
        ok: true,
        renderStorageId: outcome.mp4StorageId as Id<"_storage">,
        sidecarStorageId,
        sidecarHash: await contentHash(raw),
        blockCount: reparsed.value.blockCount,
        renderMs: outcome.renderMs,
        gatesPassed: reparsed.value.gates.length,
        // From the RE-VALIDATED parse, never from what the route claimed.
        summary: {
          durationS: reparsed.value.totalDurationS,
          blockCount: reparsed.value.blockCount,
          gates: [...reparsed.value.gates],
        },
      },
    });
    return { ok: true };
  },
});

// ── THE CAPTION BURN (plan 20-17) ──────────────────────────────────────────────────────────────
//
// The second sandbox pass, over an already-published reel. Everything structural is `renderReel`'s,
// reused rather than re-derived: the same bearer, the same route, the same fixture seam, the same
// upload-URL idiom. What differs is what a FAILURE means — a failed render leaves no reel, and a
// failed burn leaves the reel exactly as it was.

/** Everything the burn needs, read through the tenant boundary. `sourceId` is the STT job row's own
 *  id and the plan id; the blob route resolves both without being told which is which. */
export const captionsToBurn = internalQuery({
  args: { tenantId: v.string(), planId: v.id("plans") },
  handler: async (
    ctx,
    a,
  ): Promise<{
    transcriptStorageId: Id<"_storage">;
    sidecarStorageId: Id<"_storage">;
    offsetsS: number[];
    batchId: string;
  } | null> => {
    const plan = await ctx.db.get(a.planId);
    // The tenant check is HERE, on the row, because this query takes a plan id from an action
    // rather than from an authenticated caller.
    if (!plan || plan.tenantId !== a.tenantId) return null;
    if (plan.renderStatus !== "rendered" || !plan.renderStorageId) return null;
    if (!plan.captionOffsetsS || !plan.sidecarStorageId) return null;
    const stt = (
      await ctx.db
        .query("mediaJobs")
        .withIndex("by_plan", (q) => q.eq("tenantId", a.tenantId).eq("planId", a.planId))
        .collect()
    ).find((r) => r.kind === "stt");
    if (stt?.status !== "succeeded" || !stt.assetStorageId) return null;
    return {
      transcriptStorageId: stt.assetStorageId,
      sidecarStorageId: plan.sidecarStorageId,
      offsetsS: plan.captionOffsetsS,
      batchId: stt.batchId,
    };
  },
});

/**
 * The caption terminal.
 *
 * **A caption failure does NOT fail the reel.** `renderStatus` is never touched here: the
 * uncaptioned cut stays published and a `captionReason` code records why the track is missing. A
 * missing caption track is a degraded deliverable; an unpublished reel is no deliverable.
 *
 * On success `renderStorageId` is REPOINTED at the captioned cut and the uncaptioned blob is
 * deleted — same "publish then delete" ordering as 20-16, for the same reason: a crash between them
 * costs an orphaned blob, and the reverse order costs a reel pointing at nothing.
 */
export const recordCaptionBurn = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    batchId: v.string(),
    result: v.union(
      v.object({ ok: v.literal(true), captionedStorageId: v.id("_storage"), renderMs: v.number() }),
      v.object({ ok: v.literal(false), reason: v.string() }),
    ),
  },
  handler: async (ctx, a): Promise<null> => {
    const plan = await ctx.db.get(a.planId);
    if (!plan || plan.tenantId !== a.tenantId) return null;
    if (!a.result.ok) {
      await ctx.db.patch(a.planId, { captionStatus: "failed", captionReason: a.result.reason });
      await ctx.db.insert("deadLetters", {
        tenantId: a.tenantId,
        correlationId: a.batchId,
        workflowId: "media.captions",
        payload: { batchId: a.batchId, planId: a.planId, reasonCode: a.result.reason },
        error: a.result.reason,
        status: "new",
        createdAt: Date.now(),
      });
      return null;
    }

    const uncaptioned = plan.renderStorageId;
    await ctx.db.patch(a.planId, {
      renderStorageId: a.result.captionedStorageId,
      captionStatus: "captioned",
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: a.tenantId,
      correlationId: a.batchId,
      eventType: "media.captioned",
      actor: "render",
      payload: { batchId: a.batchId, planId: a.planId, renderMs: a.result.renderMs },
    });
    // The uncaptioned cut is now unreferenced. Deleted AFTER the repoint, never before.
    if (uncaptioned && uncaptioned !== a.result.captionedStorageId) {
      await ctx.storage.delete(uncaptioned);
    }
    // …and only NOW may the takes go: the transcript's source outlived the reel it captioned,
    // which is the whole retention narrowing.
    await deleteIntermediates(ctx, a.tenantId, a.batchId);
    return null;
  },
});

/** Burn the transcript onto the published reel. Scheduled by `mediaComplete.maybeBurnCaptions`,
 *  which only fires when BOTH the transcript and the reel exist. */
export const burnCaptions = internalAction({
  args: { tenantId: v.string(), planId: v.id("plans") },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const secret = requireEnvMedia("MEDIA_RENDER_SECRET");
    const routeUrl = requireEnvMedia("MEDIA_RENDER_URL");

    const job = await ctx.runQuery(internal.render.renderReel.captionsToBurn, a);
    const fail = async (reason: string) => {
      await ctx.runMutation(internal.render.renderReel.recordCaptionBurn, {
        tenantId: a.tenantId,
        planId: a.planId,
        batchId: job?.batchId ?? "",
        result: { ok: false, reason },
      });
      return { ok: false, reason };
    };
    if (!job) return await fail("caption_inputs_missing");

    // The sidecar is re-read and RE-VALIDATED rather than trusted from `renderSummary`: the rebase
    // is arithmetic on its per-block anchors, and `parseAssemblySidecar` is the only thing that
    // certifies those anchors are present and monotonic. Read in the ACTION because a Convex query
    // cannot read a blob at all — `ctx.storage` there is a `StorageReader` with `getUrl` and
    // nothing else, which is the same constraint that put `renderSummary` on the row.
    const sidecarBlob = await ctx.storage.get(job.sidecarStorageId);
    if (!sidecarBlob) return await fail("sidecar_missing");
    const report = parseAssemblySidecar(await sidecarBlob.text());
    if (!report.ok) return await fail("sidecar_rejected_on_return");

    const transcriptBlob = await ctx.storage.get(job.transcriptStorageId);
    if (!transcriptBlob) return await fail("transcript_missing");
    let words: unknown;
    try {
      words = (JSON.parse(await transcriptBlob.text()) as { words?: unknown }).words;
    } catch {
      return await fail("transcript_unreadable");
    }
    if (!Array.isArray(words)) return await fail("transcript_unreadable");

    const ass = toAss(
      buildCaptionLines({
        words: words as Array<{ text: string; start: number; end: number; type: string }>,
        report: report.value,
        offsetsS: job.offsetsS,
      }),
    );
    // An empty track means the transcript held no words for any block. `burn_caps.sh` refuses an
    // empty track, but refusing here saves a whole sandbox to learn that.
    if (!ass.includes("Dialogue:")) return await fail("caption_track_empty");

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const fixture = process.env.MEDIA_SANDBOX_FIXTURE;
    let outcome: { ok: true; mp4StorageId: string; renderMs: number } | { ok: false; code: string };
    if (fixture) {
      outcome = JSON.parse(fixture) as typeof outcome;
    } else {
      // NARRATION CROSSES HERE, as the escaped `.ass` track, and it is the only content this
      // system sends into the VM. Everything else on the forbidden list still holds: no key, no
      // tenantId, no fal URL, no signed storage read-URL.
      const response = await fetch(routeUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "caption",
          renderId: job.batchId,
          sourceId: a.planId,
          ass,
          uploadUrls: { mp4: uploadUrl },
        }),
      }).catch(() => null);
      if (!response?.ok) return await fail("route_unreachable");
      outcome = (await response.json()) as typeof outcome;
    }
    if (!outcome.ok) return await fail(outcome.code);

    await ctx.runMutation(internal.render.renderReel.recordCaptionBurn, {
      tenantId: a.tenantId,
      planId: a.planId,
      batchId: job.batchId,
      result: {
        ok: true,
        captionedStorageId: outcome.mp4StorageId as Id<"_storage">,
        renderMs: outcome.renderMs,
      },
    });
    return { ok: true };
  },
});

/** `pending -> rendering`, so the canvas can show the stage before a 60-150 s wait. Separate from
 *  `recordRender` because it runs BEFORE the POST and must not be able to write a terminal. */
export const markRendering = internalMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }): Promise<null> => {
    await ctx.db.patch(planId, { renderStatus: "rendering" });
    return null;
  },
});
