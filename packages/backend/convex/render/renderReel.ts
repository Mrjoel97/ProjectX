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
import {
  deckStillNeedsJob,
  isRenderableCardText,
  isTransientRenderCode,
  renderInputName,
} from "@pikar/core/render";
import type { MusicMood } from "@pikar/core/storyboard";
import { categoryFor } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./../_generated/api";
import type { Doc, Id } from "./../_generated/dataModel";
import type { MutationCtx } from "./../_generated/server";
import { internalAction, internalMutation, internalQuery } from "./../_generated/server";
import { retrier } from "./../index";
import { contentHash } from "./../lib/hash";
import { requireEnvMedia } from "./../media";
import { maybeBurnCaptions } from "./../mediaComplete";
import { startIngest } from "./../vaultIngest";

/** What a finished reel's BYTES are. Drives both `storedMimeType` and the vault CATEGORY —
 *  they must never disagree, which is how a reel came to sit in the Docs tab. */
const REEL_BYTES_MIME = "video/mp4";

/** Every way a render can be refused or can fail, as a CODE. `renderReason` on the plan row is a
 *  reasonCode field and never ffmpeg's prose — the schema comment says so and this union is what
 *  keeps it true from this side. The runner's own codes (`@pikar/core/render`) arrive as strings
 *  and land in the same field; both halves are closed sets. */
export type RenderRefusal =
  | "empty_batch"
  | "incomplete_blocks"
  | "not_all_succeeded"
  | "stale_inputs"
  | "route_unreachable"
  | "route_rejected"
  | "route_bad_response" // 25.1-01: a 200 whose body is not a JSON object — not a route DECISION
  | "sidecar_rejected_on_return";

/**
 * A deck row → the kind of picture the assembler builds for it, or `null` for a row it cannot.
 *
 * The two vocabularies are deliberately different and this is the ONE place they meet. The deck
 * speaks about intent and money (`generated_video` is bought, `uploaded_video` is already owned);
 * the script speaks about what it does with the bytes (both are a clip on disk). Collapsing them
 * into one enum would make the price table and the ffmpeg branch the same decision, which is how a
 * free scene ends up billed as a paid one.
 *
 * A BLOCK row (no `visual`) is a `video` — that is what every one of them was.
 */
function assemblerKindOf(shot: {
  visual?: string;
  overlay?: string;
}): "video" | "image" | "card" | null {
  switch (shot.visual) {
    case undefined:
    case "generated_video":
    case "uploaded_video":
      return "video";
    case "animated_image":
      return "image";
    case "text_card":
      return "card";
    default:
      return null; // a VisualKind this renderer does not ship — refuse, never guess
  }
}

type RenderInputs = {
  planId: Id<"plans">;
  /** The DECLARED reel length. The scenes must sum to it — asserted here, at the route, and again
   *  inside the script, because each of the three is a cheaper failure than the one after it. */
  targetSeconds: number;
  scenes: Array<{ kind: "video" | "image" | "card"; seconds: number }>;
  /** An OPAQUE ref the blob route resolves — a `mediaJobs` row for anything that was bought, or a
   *  `vaultDocuments` row for an `uploaded_video` scene, whose bytes were already the tenant's.
   *  `resolveRenderAsset` is the single place that knows which table an id belongs to; the runner
   *  only ever appends it to our own origin. Still called `jobId` on the wire — the route's guard
   *  is "no path characters", not "is a valid id of table X". */
  inputs: Array<{ name: string; jobId: Id<"mediaJobs"> | Id<"vaultDocuments"> }>;
  /** Text cards: drawn from the deck's own words, with no job and no bytes in storage. */
  cards: Array<{ name: string; text: string }>;
  /** The music bed's mood slug, or absent. Neither an input nor a card — the bytes are baked into
   *  the sandbox snapshot, so nothing is fetched, stored or written for it. It rides here because
   *  it is a fact about the REEL (deck-wide, off the art direction) rather than about a scene. */
  music?: MusicMood;
};

/**
 * The batch's renderable inputs, or a refusal — never a partial set.
 *
 * **A reel is all-or-nothing.** A batch missing one input does not render a shorter reel: the
 * assembler asserts the scene list before any work precisely so a dropped scene FAILS instead of
 * silently shipping a hole. Catching it here means the failure is free, rather than a $0.02
 * sandbox that hard-errors on a missing input.
 *
 * **This reads the DECK, not just the jobs (20.2 wave 5).** On the block contract the jobs were a
 * complete description of the reel — one clip per index, every clip the same length. On a scene
 * timeline they are not: a `text_card` has no job at all, and a silent scene has no voice take. So
 * the shape comes off `plans.shots` and the jobs are checked AGAINST it, index by index. Two rules
 * follow, and both replace an unconditional demand that used to live here:
 *   * a picture is required per scene, but WHICH one depends on the kind — and a card needs none;
 *   * a voice take is required only where the deck declares a line. Demanding one everywhere is
 *     what made a deck with a silent card unrenderable, which is the state wave 5 removes.
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

    // `stt` (captions, plan 20-17) sits at blockIndex -1 and is not an assembly input. `image` is
    // (20.2 wave 5): an `animated_image` scene buys ONE still and the assembler pans across it.
    const renderable = rows.filter(
      (r) => r.kind === "video" || r.kind === "image" || r.kind === "tts",
    );
    if (renderable.length === 0) return { ok: false, reason: "empty_batch" };

    const planId = renderable[0]?.planId;
    if (!planId) return { ok: false, reason: "empty_batch" };

    // Every input must have LANDED. A batch still in flight has rows with no bytes yet — refuse
    // unconditionally; the next landing re-fires the trigger.
    if (renderable.some((r) => r.status === "queued" || r.status === "submitted")) {
      return { ok: false, reason: "not_all_succeeded" };
    }

    // THE DECK is what says how long each scene is and what kind of picture it wants. It could be
    // inferred from the job rows on the block contract — every index had a clip, every clip was
    // the same length — and it cannot be on a scene one: a card has no job at all, so the jobs no
    // longer describe the reel. Read the row.
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== a.tenantId || !plan.shots?.length) {
      return { ok: false, reason: "incomplete_blocks" };
    }
    const deck = [...plan.shots].sort((l, r) => l.index - r.index);

    // 33-04 — a TERMINAL non-success row (failed/blocked, or succeeded with no bytes: the landing
    // plane's own impossible state) refuses the render ONLY while the deck still needs what it was
    // buying. The fix-menu changes the DECK, never the batch: after a failed clip's scene becomes
    // a text card (or a vault pick), that row is history, not a hole in the reel. The predicate is
    // the SAME `deckStillNeedsJob` the re-armed trigger uses, so the two cannot disagree — a
    // trigger that schedules and a builder that refuses would strand the plan at `rendering`.
    if (
      renderable.some(
        (r) =>
          deckStillNeedsJob(
            deck.find((s) => s.index === r.blockIndex),
            r.kind as "video" | "image" | "tts",
          ) &&
          (r.status !== "succeeded" || r.assetStorageId === undefined),
      )
    ) {
      return { ok: false, reason: "not_all_succeeded" };
    }

    // **THE INPUTS COME FROM THE PLAN, NOT FROM THE BATCH ALONE (20.2 wave 6).**
    //
    // `regenerateBlock` has shipped since 20-09 and buys ONE scene into a NEW batch. Reading the
    // inputs off that batch meant every scene it did not re-buy had no job, so the render refused
    // `incomplete_blocks` — the user paid for a clip AND lost the published reel, because the
    // reservation clears the render in the same transaction. The batch is the TRIGGER (it is what
    // just landed, and `maybeStartRender` fires on its last landing); the INPUTS are whatever this
    // plan most recently landed at each index. Sorting oldest-first and letting later rows
    // overwrite makes "most recent" the selection rule, so a re-bought scene wins over the take it
    // replaced while its untouched neighbours stay exactly as they were.
    //
    // A failed or blocked attempt is history and is skipped here — `not_all_succeeded` above is
    // what refuses a batch still in flight, and that check stays on the batch's OWN rows.
    const landed = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", a.tenantId).eq("planId", planId))
      .collect();

    const byIndex = new Map<
      number,
      { video?: Doc<"mediaJobs">; image?: Doc<"mediaJobs">; tts?: Doc<"mediaJobs"> }
    >();
    for (const row of landed
      .filter((r) => r.status === "succeeded" && r.assetStorageId !== undefined)
      .sort((l, r) => l.createdAt - r.createdAt || l._creationTime - r._creationTime)) {
      const slot = byIndex.get(row.blockIndex) ?? {};
      if (row.kind === "video") slot.video = row;
      else if (row.kind === "image") slot.image = row;
      else if (row.kind === "tts") slot.tts = row;
      else continue; // `stt` sits at index -1 and is not an assembly input
      byIndex.set(row.blockIndex, slot);
    }

    /** An asset may be reused only while the deck it was bought against still stands. Every write
     *  to `shots` dates itself (`media.patchShots`, `plans.persistDeck`), so this one comparison
     *  covers reorder, delete, a re-proposed deck and an edit made while a job was in flight. The
     *  refusal is BY NAME because the cure differs from every other one: nothing is missing and
     *  nothing failed — the footage on hand belongs to a deck that no longer exists, and the only
     *  way forward is to buy the reel again. */
    const changedAt = plan.shotsChangedAt ?? 0;
    const fresh = (row: Doc<"mediaJobs">): boolean => row.createdAt >= changedAt;

    const scenes: RenderInputs["scenes"] = [];
    const inputs: RenderInputs["inputs"] = [];
    const cards: RenderInputs["cards"] = [];
    for (const [i, shot] of deck.entries()) {
      if (shot.index !== i) return { ok: false, reason: "incomplete_blocks" }; // not contiguous
      const slot = byIndex.get(i);
      const kind = assemblerKindOf(shot);
      if (!kind) return { ok: false, reason: "incomplete_blocks" };
      if (!Number.isInteger(shot.seconds) || shot.seconds < 1) {
        return { ok: false, reason: "incomplete_blocks" };
      }
      scenes.push({ kind, seconds: shot.seconds });

      // THE PICTURE. A `card` is drawn from text and has no job — which is the whole reason the
      // `unrenderable_block` refusal at `media.reserveJobInner` could finally be narrowed. The
      // other two must have LANDED bytes at their own index.
      if (kind === "card") {
        const text = (shot.overlay ?? "").trim();
        if (!isRenderableCardText(text)) return { ok: false, reason: "incomplete_blocks" };
        cards.push({ name: renderInputName("card", i), text });
      } else if (kind === "image") {
        if (!slot?.image) return { ok: false, reason: "incomplete_blocks" };
        if (!fresh(slot.image)) return { ok: false, reason: "stale_inputs" };
        inputs.push({ name: renderInputName("image", i), jobId: slot.image._id });
      } else if (shot.visual === "uploaded_video") {
        // THE VAULT BRIDGE (20.2 wave 5). An upload buys nothing, so it has no `mediaJobs` row and
        // no job id — its bytes are already the tenant's, sitting on a `vaultDocuments` row.
        //
        // **`asset.docId` IS MODEL-AUTHORED TEXT.** It reaches this line off `plans.shots`, which
        // the specialist wrote, so it is a caller-supplied id in every sense that matters — and
        // the id it is compared against downstream is opaque. The tenant check is therefore HERE,
        // on the row, and it is the whole containment: `normalizeId` fails closed for a malformed
        // or foreign-table id, and a doc belonging to another tenant is refused before its id is
        // ever handed to the runner. Without this line a deck could name any vault document in
        // the deployment and have the render fetch it.
        const docId = ctx.db.normalizeId("vaultDocuments", shot.asset?.docId ?? "");
        if (!docId) return { ok: false, reason: "incomplete_blocks" };
        const doc = await ctx.db.get(docId);
        if (!doc || doc.tenantId !== a.tenantId || !doc.storageId) {
          return { ok: false, reason: "incomplete_blocks" };
        }
        // A vault document whose BYTES are not video has no business in a reel, and refusing it
        // here is also what keeps the blob route's vault branch narrow — see `resolveRenderAsset`.
        // 33-05: `storedMimeType ?? mimeType`, so a SAVED REEL (markdown row, mp4 bytes) is
        // renderable footage — the same fallback the picker's `isPickableVideo` applies.
        if (!(doc.storedMimeType ?? doc.mimeType).startsWith("video/")) {
          return { ok: false, reason: "incomplete_blocks" };
        }
        inputs.push({ name: renderInputName("video", i), jobId: docId });
      } else {
        if (!slot?.video) return { ok: false, reason: "incomplete_blocks" };
        if (!fresh(slot.video)) return { ok: false, reason: "stale_inputs" };
        inputs.push({ name: renderInputName("video", i), jobId: slot.video._id });
      }

      // THE VOICE TAKE, and this is the half wave 4 changed: narration is OPTIONAL now, so a
      // missing take is only a failure for a scene that declared a line. Demanding one at every
      // index — which this did until wave 5 — refuses every deck containing a silent card, which
      // is exactly the deck the rest of this wave exists to make renderable.
      const wantsVoice = shot.narration.trim() !== "";
      if (wantsVoice && !slot?.tts) return { ok: false, reason: "incomplete_blocks" };
      if (wantsVoice && slot?.tts && !fresh(slot.tts)) {
        return { ok: false, reason: "stale_inputs" };
      }
      if (wantsVoice && slot?.tts) {
        // The filename mapping lives in ONE place (`@pikar/core/render`) so the picture and the
        // voice take cannot be numbered by two different pieces of code and drift — 20-13's whole
        // reason for dropping upstream's `--allow-mismatch` pair check.
        inputs.push({ name: renderInputName("tts", i), jobId: slot.tts._id });
      }
    }

    // A job at an index the deck does not have is a batch and a deck that disagree about what was
    // bought. Refuse rather than render the shorter of the two.
    //
    // Checked over the BATCH's rows, not the plan's history: a deck that shrank leaves landed jobs
    // at indices that no longer exist, and those are simply history — `shotsChangedAt` has already
    // moved past them, so they can never be selected as an input. What must still agree is what
    // was just BOUGHT.
    for (const row of renderable) {
      if (row.blockIndex < 0 || row.blockIndex >= deck.length) {
        return { ok: false, reason: "incomplete_blocks" };
      }
    }

    // THE DECLARED LENGTH. A scene deck carries it on the row; a block deck's length is still the
    // accident `shots.length × clipSeconds`, and computing it here is what lets the uniform
    // contract keep rendering through the same path rather than a second one.
    const summed = scenes.reduce((n, s) => n + s.seconds, 0);
    const targetSeconds = plan.targetDurationSeconds ?? summed;
    if (summed !== targetSeconds) return { ok: false, reason: "incomplete_blocks" };

    // THE BED, read off the SAME `artDirection.music` the reservation priced. Read here rather
    // than passed in, for the reason every other fact in this function is read here: the deck row
    // is the record of what the owner approved, and a render that took the bed from anywhere else
    // could lay down a mood the estimate never showed and the reserve never priced.
    //
    // Unvalidated on purpose at THIS layer — `parseBody` in the route holds the closed set, on the
    // side of the trust boundary where the value is about to become a path. Restating it here
    // would be a third copy whose only distinguishing behaviour is failing earlier and quieter.
    const music = plan.artDirection?.music as MusicMood | undefined;

    return { ok: true, value: { planId, targetSeconds, scenes, inputs, cards, music } };
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
    // …or a VAULT DOCUMENT (20.2 wave 5), for an `uploaded_video` scene. Those bytes are already
    // the tenant's and were never bought, so there is no `mediaJobs` row to serve them from.
    //
    // **NARROWED TO VIDEO, deliberately.** This branch widens what a compromised runner could
    // read, and the vault is where a tenant's briefs, contracts and business documents live —
    // serving "any vault document by id" would be a far larger capability than a render needs.
    // A reel input is a video, so that is the only thing this serves. The TENANT check is not here
    // and must not be: this query takes a raw id with no tenant to check it against, exactly as
    // the `mediaJobs` branch does. `batchToRender` is the boundary, and it verifies the doc's
    // tenant before the id ever reaches the runner.
    const docId = ctx.db.normalizeId("vaultDocuments", raw);
    if (docId) {
      const doc = await ctx.db.get(docId);
      // 33-05: judged and served by WHAT THE BYTES ARE (`storedMimeType ?? mimeType`) — a saved
      // reel's row is markdown but its `storageId` is the final mp4. Still video-only: the widen
      // admits exactly the reel shape, never "any vault document by id".
      const bytesMime = doc?.storedMimeType ?? doc?.mimeType ?? "";
      if (!doc?.storageId || !bytesMime.startsWith("video/")) return null;
      return { assetStorageId: doc.storageId, mimeType: bytesMime };
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
        sceneCount: v.number(),
        renderMs: v.number(),
        gatesPassed: v.number(),
        /** The sidecar's own facts, for the canvas (20-09). Parsed ONCE, here, because a query
         *  cannot read a blob — `ctx.storage` in a query is a `StorageReader`. */
        summary: v.object({
          durationS: v.number(),
          sceneCount: v.number(),
          gates: v.array(v.string()),
        }),
      }),
      v.object({ ok: v.literal(false), reason: v.string() }),
    ),
  },
  handler: async (ctx, a): Promise<null> => {
    if (!a.result.ok) {
      // 33-04 — the ONE automatic retry, a narrow supersession of 20-16's no-retry rule (the
      // playbook carries the dated note). Only a code in the CLOSED transient set, and only while
      // this plan's retry is unspent. `renderRetriedAt` is checked AND set inside this same
      // serializable mutation — the `pending → rendering` CAS idiom — so two racing terminals
      // cannot both schedule, and a second failure structurally cannot re-enter this arm.
      // `renderStatus` is deliberately NOT touched: the canvas keeps saying "assembling" through
      // the retry, and the retried attempt writes the terminal. Its sandbox is already reserved —
      // the render line is doubled at `MEDIA_SANDBOX_USD_PER_RENDER` for exactly this.
      const plan = await ctx.db.get(a.planId);
      if (plan && isTransientRenderCode(a.result.reason) && plan.renderRetriedAt === undefined) {
        // 25.1-01 (D2): under the retrier, never a bare runAfter — the run id rides the SAME
        // patch as the CAS, so a crashed retry still terminalizes (`onRenderComplete`).
        const runId = await retrier.run(
          ctx,
          internal.render.renderReel.renderReel,
          { tenantId: a.tenantId, planId: a.planId, batchId: a.batchId },
          { onComplete: internal.mediaComplete.onRenderComplete },
        );
        await ctx.db.patch(a.planId, { renderRetriedAt: Date.now(), renderRunId: String(runId) });
        // Refs and codes ONLY (§4). No dead letter on the retried attempt — an operator page for
        // a failure the system is about to handle itself would be noise; the SECOND failure pages.
        await ctx.runMutation(internal.audit.log, {
          tenantId: a.tenantId,
          correlationId: a.batchId,
          eventType: "media.render_retried",
          actor: "render",
          payload: { batchId: a.batchId, planId: a.planId, reasonCode: a.result.reason },
        });
        return null;
      }
      await ctx.db.patch(a.planId, {
        renderStatus: "failed",
        renderReason: a.result.reason,
        renderedAt: Date.now(),
      });
      // ONE dead letter, refs and codes ONLY (CLAUDE.md §4) — no ffmpeg output, no filename, no
      // narration, no URL. A failed render does NOT retry past this point: at 480p a structural
      // failure repeats, and the action-retrier would buy N sandboxes to learn the same thing N
      // times. 33-04 narrowed this rule to "after the one transient retry above", nothing more.
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
    // 33-05: the OLD final (held through the regenerate by `clearRender`) is captured BEFORE the
    // repoint — it becomes deletable only once neither the plan nor the vault doc points at it.
    const before = await ctx.db.get(a.planId);
    const oldFinal = before?.renderStorageId ?? null;
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
        // `sceneCount` from wave 6 on. The audit log is append-only (§3), so rows written before
        // this carry `blockCount` for the same number and a reader must know both names — renaming
        // forward is the only rename an insert-only log allows.
        sceneCount: a.result.sceneCount,
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
    // 33-05: SAVE AT THIS TERMINAL. 25.1-03 (D6) REMOVED the `!captionsComing` gate that used to
    // wrap this: captions are pinned on for every reel (`cockpit.ts`, `media.ts`), so
    // `captionsComing` was TRUE at every render terminal that has ever run — the gate never opened
    // once in production, and a caption pass that stalls, fails its transcript or is swept by the
    // 25.1-02 watchdog never reaches the burn terminal. The result was a published reel that
    // reached the vault only if its captions happened to succeed.
    //
    // The reel is a deliverable the moment it is published, so it is saved the moment it is
    // published. The burn terminal's own save still runs and the upsert converges: it PATCHES this
    // same doc onto the captioned cut and hands the uncaptioned blob back for deletion.
    const orphanedDoc = await saveReelToVault(ctx, {
      tenantId: a.tenantId,
      planId: a.planId,
      correlationId: a.batchId,
    });
    // Repoint plan (the patch above) → repoint vault doc (the save) → delete what nothing
    // references.
    await deleteOrphanedFinals(ctx, a.planId, [oldFinal, orphanedDoc]);
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

/**
 * THE VAULT SAVE (33-05) — the finished reel becomes a durable, groundable tenant asset.
 *
 * The `persistFindings` idiom (research.ts:134), applied to the reel: a system-authored
 * `vaultDocuments` row whose `text` is the narration transcript ALREADY IN HAND (zero paid work —
 * `mimeType: "text/markdown"` puts it on the normal embed rail, and NO upload-ingest stage runs),
 * whose `storageId` is the final mp4 (`storedMimeType: "video/mp4"` — the createDocument
 * two-mime precedent), and whose `reelMeta` is refs-only citation metadata (§4).
 *
 * **UPSERT, keyed by `plans.reelVaultDocId`.** One vault doc per plan, forever: the first
 * completion inserts, every re-render PATCHES the same row. Called from exactly one terminal per
 * pipeline completion — the caption terminal (both arms, since a failed burn still leaves a
 * degraded deliverable), or the render terminal when no captions will ever come.
 *
 * Returns the doc's PREVIOUS storage id when the patch arm repointed it — the caller owns orphan
 * deletion (one `deleteOrphanedFinals` pass per terminal, so two candidates can never double-free).
 */
export async function saveReelToVault(
  ctx: MutationCtx,
  a: { tenantId: string; planId: Id<"plans">; correlationId: string },
): Promise<Id<"_storage"> | null> {
  const plan = await ctx.db.get(a.planId);
  if (!plan || plan.tenantId !== a.tenantId || !plan.renderStorageId) return null;

  // The transcript: the picked deck's narration lines, in scene order. Content plane — it lives
  // in `text` and NOWHERE else (never in reelMeta, never in an audit payload).
  const deck = [...(plan.shots ?? [])].sort((l, r) => l.index - r.index);
  const text = deck
    .map((s) => s.narration.trim())
    .filter((line) => line !== "")
    .join("\n\n");

  // Citations: `shot.source.docId` is MODEL-AUTHORED text (the `asset.docId` rule), so ownership
  // is verified HERE, at the write — a malformed or foreign id is skipped, never persisted as if
  // it verified. `claimHash` ties the citation to the exact narration line it grounds.
  const citations: Array<{
    sceneIndex: number;
    docId: string;
    claimHash: string;
    confirmedAt?: number;
  }> = [];
  for (const s of deck) {
    const raw = s.source?.docId;
    if (!raw) continue;
    const srcId = ctx.db.normalizeId("vaultDocuments", raw);
    if (!srcId) continue;
    const src = await ctx.db.get(srcId);
    if (!src || src.tenantId !== a.tenantId) continue;
    citations.push({
      sceneIndex: s.index,
      docId: String(srcId),
      claimHash: await contentHash(s.narration.trim()),
      ...(s.confirmedAt === undefined ? {} : { confirmedAt: s.confirmedAt }),
    });
  }

  const reelMeta = { planId: a.planId, citations };
  const hash = await contentHash(text);
  const size = new TextEncoder().encode(text).length;
  // A fully SILENT deck has no transcript: nothing to embed, so nothing rides the rail —
  // `pending_extraction` says "stored, text not yet available" honestly rather than pushing an
  // empty string through the chunker.
  const status = text === "" ? ("pending_extraction" as const) : ("processing" as const);

  let docId: Id<"vaultDocuments">;
  let orphaned: Id<"_storage"> | null = null;
  const existing = plan.reelVaultDocId ? await ctx.db.get(plan.reelVaultDocId) : null;
  if (existing && existing.tenantId === a.tenantId) {
    orphaned = existing.storageId ?? null;
    await ctx.db.patch(existing._id, {
      storageId: plan.renderStorageId,
      text,
      contentHash: hash,
      size,
      reelMeta,
      status,
      // Also on the PATCH path: a row written before the category fix is misfiled under
      // workspace-docs, and a re-render is the natural moment to correct it.
      category: categoryFor({ source: "agent", mimeType: REEL_BYTES_MIME }),
    });
    docId = existing._id;
  } else {
    docId = await ctx.db.insert("vaultDocuments", {
      tenantId: a.tenantId,
      title: `Reel: ${(plan.brief?.topic ?? plan.subject ?? "untitled").trim()}`,
      kind: "reel", // the queryable class marker (`kind` is v.string() — a code-owned token)
      // The category describes the BYTES, not the author. `categoryFor`'s own contract is that
      // image and video mime types win over the source; passing no mimeType at all fell through
      // to source:"agent" and filed a 30s mp4 under workspace-docs (owner-reported 2026-08-21).
      // NB: do not write the mime globs literally here — a slash-star in a line comment reads as
      // a block-comment opener to llmRedaction.test.ts's stripCode, which silently swallows the
      // audit sites below it and weakens the SS4 scan.
      category: categoryFor({ source: "agent", mimeType: REEL_BYTES_MIME }),
      source: "media",
      mimeType: "text/markdown", // SEARCHABLE_MIME ⇒ the transcript is chunked + embedded
      storedMimeType: REEL_BYTES_MIME, // what the BYTES are — the final mp4 in `storageId`
      storageId: plan.renderStorageId,
      size,
      contentHash: hash,
      text,
      status,
      sourcePlanId: a.planId, // Phase-26 provenance: this IS an authoritative write site
      sourceThreadId: plan.threadId, // 26-11: the pair -- see mediaComplete.ts for why
      reelMeta,
      createdAt: Date.now(),
    });
    await ctx.db.patch(a.planId, { reelVaultDocId: docId });
  }
  // The SOLE legal way to start ingest (it wires the onComplete that prevents a stranded
  // `processing` row) — exactly as persistFindings does. Skipped for a silent deck: there is no
  // text to embed and the row already says so.
  if (status === "processing") {
    await startIngest(ctx, {
      vaultDocId: docId,
      tenantId: a.tenantId,
      correlationId: a.correlationId,
    });
  }
  // Refs and counts ONLY (§4) — no title, no transcript, no citation text.
  await ctx.runMutation(internal.audit.log, {
    tenantId: a.tenantId,
    correlationId: a.correlationId,
    eventType: "media.reel_saved",
    actor: "render",
    payload: { planId: a.planId, docId: String(docId), citations: citations.length },
  });
  return orphaned !== null && orphaned !== plan.renderStorageId ? orphaned : null;
}

/**
 * Delete finished-reel blobs that NOTHING references any more (33-05).
 *
 * The live set is read fresh — the plan's current final and the vault doc's current bytes — so
 * the ordering contract "repoint plan → repoint vault doc → delete orphan" cannot be violated by
 * a call site getting the sequence wrong: a blob still referenced is simply skipped. Candidates
 * are deduped because `storage.delete` THROWS on an id that is already gone, and one aborted
 * terminal is worse than one leaked blob.
 */
async function deleteOrphanedFinals(
  ctx: MutationCtx,
  planId: Id<"plans">,
  candidates: Array<Id<"_storage"> | null | undefined>,
): Promise<void> {
  const plan = await ctx.db.get(planId);
  const doc = plan?.reelVaultDocId ? await ctx.db.get(plan.reelVaultDocId) : null;
  const live = new Set<string>();
  if (plan?.renderStorageId) live.add(plan.renderStorageId);
  if (doc?.storageId) live.add(doc.storageId);
  const seen = new Set<string>();
  for (const id of candidates) {
    if (!id || live.has(id) || seen.has(id)) continue;
    seen.add(id);
    await ctx.storage.delete(id);
  }
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
  // `planId` (25.1-01, D1): the schedule sites all know it, and the refusal terminal below needs it
  // even when the batch has no rows at all — `batchToRender` cannot name a plan for `empty_batch`.
  args: { tenantId: v.string(), planId: v.id("plans"), batchId: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const secret = requireEnvMedia("MEDIA_RENDER_SECRET");
    const routeUrl = requireEnvMedia("MEDIA_RENDER_URL");

    const batch = await ctx.runQuery(internal.render.renderReel.batchToRender, {
      tenantId: a.tenantId,
      batchId: a.batchId,
    });
    if (!batch.ok) {
      // 25.1-01 (D1): a refusal is a TERMINAL, never a silent return. Before this, the plan sat at
      // "rendering" forever — the canvas said "assembling" and `retryRender` refused `not_failed`.
      // `recordRender`'s failure arm is the ONE terminal writer (failed + reason + dead letter);
      // refusal codes are outside `TRANSIENT_RENDER_CODES`, so none of them buys the auto-retry.
      await ctx.runMutation(internal.render.renderReel.recordRender, {
        tenantId: a.tenantId,
        planId: a.planId,
        batchId: a.batchId,
        result: { ok: false, reason: batch.reason },
      });
      return { ok: false, reason: batch.reason };
    }
    const { planId, targetSeconds, scenes, inputs, cards, music } = batch.value;

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
      // NOTHING FORBIDDEN CROSSES IN. This body is the complete list: no media-provider key, no
      // OPENAI_API_KEY, no Vercel credential, no tenantId, no fal URL, no `storage.getUrl` result,
      // no prompt and no narration. The job ids are opaque refs the runner appends to OUR OWN
      // blob origin — it is handed no URL to fetch at all.
      //
      // ONE THING CHANGED IN 20.2 WAVE 5, and it is stated rather than buried: a text card's WORDS
      // now cross. They have to — a card is drawn, so there is no job, no asset and no storage id
      // to hand over instead, and the alternative was minting a storage object per card to carry
      // forty characters. It is deck content, so it is bounded on both sides
      // (`isRenderableCardText`) and it is never logged, never audited and never echoed in a
      // failure. Narration and prompts still do NOT cross; a card's overlay is the only exception,
      // and adding a second one is a decision, not a patch.
      const response = await fetch(routeUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: a.batchId,
          targetSeconds,
          scenes,
          inputs: inputs.map((i) => ({ name: i.name, jobId: i.jobId })),
          cards,
          // A MOOD SLUG from a four-member closed set — no tenant bytes, no content, nothing that
          // could carry a name, a figure or a line of narration. The "nothing forbidden crosses in"
          // list above is unchanged by it, which is why it is not a second exception alongside the
          // card's words.
          ...(music === undefined ? {} : { music }),
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
      // 25.1-01 (D2): a 200 whose body is not a JSON object used to THROW here unguarded —
      // swallowed by the bare scheduler, plan stuck at "rendering". Terminalize inline instead:
      // the sandbox already ran, so a retrier retry would buy a second one to learn the same thing.
      try {
        const parsed: unknown = await response.json();
        outcome =
          parsed !== null && typeof parsed === "object"
            ? (parsed as RouteSuccess | { ok: false; code: string })
            : { ok: false, code: "route_bad_response" };
      } catch {
        outcome = { ok: false, code: "route_bad_response" };
      }
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
        sceneCount: reparsed.value.sceneCount,
        renderMs: outcome.renderMs,
        gatesPassed: reparsed.value.gates.length,
        // From the RE-VALIDATED parse, never from what the route claimed.
        summary: {
          durationS: reparsed.value.totalDurationS,
          sceneCount: reparsed.value.sceneCount,
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
      // 33-05: a failed burn is still a pipeline COMPLETION — the uncaptioned cut is the
      // (degraded) deliverable, and it is saved as such. Only when a reel actually stands.
      if (plan.renderStatus === "rendered" && plan.renderStorageId) {
        const orphaned = await saveReelToVault(ctx, {
          tenantId: a.tenantId,
          planId: a.planId,
          correlationId: a.batchId,
        });
        await deleteOrphanedFinals(ctx, a.planId, [orphaned]);
      }
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
    // 33-05 ORDERING CONTRACT: repoint plan (above) → repoint vault doc (the save) → only then
    // delete what nothing references. The captioned cut is the artifact of record, so the save
    // happens HERE, after the repoint; the uncaptioned cut and the vault doc's previous final
    // become deletable only once both the plan and the doc have moved off them.
    const orphaned = await saveReelToVault(ctx, {
      tenantId: a.tenantId,
      planId: a.planId,
      correlationId: a.batchId,
    });
    await deleteOrphanedFinals(ctx, a.planId, [uncaptioned, orphaned]);
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
