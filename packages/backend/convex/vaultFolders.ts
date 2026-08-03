// The folder plane (VALT-05/06/08) — a thin adapter (§1) over @pikar/vault's estimator and the
// 15.3-03 budget rail. A folder is a ROW PLUS COUNTERS, deliberately not a workflow: the workflow
// journal caps at 8 MiB, steps pass ≤1 MB total, and 400 sequential `step.runAction` calls would
// serialise the folder behind the shared pool with determinism risk on redeploy. One workflow per
// document; this file only orchestrates.
//
// THE LIFECYCLE, and the ORDER is the design:
//   1. `createFolder`  → `reserving`, zeroed counters.
//   2. the client uploads each member with `folderId` set. `vault.vaultUpload` inserts the row and
//      bumps `memberCount` and DISPATCHES NOTHING — no extraction, no ingest, no cent.
//   3. `reserveFolder` → takes the money, flips to `ingesting`, and THEN dispatches every member.
//   4. each member goes terminal through `vault.markReady` / `vault.markFailed`, which call
//      `bumpFolder` below. The last one settles the reservation and flips to `complete`.
//   5. `cancelFolder` at any point → settle, then DELETE the row. Zero `vaultDocuments` writes.
//
// ⚠ WHY RESERVE IS STEP 3 AND NOT STEP 1. Two invariants force it, and the plan text left it
// implicit. (a) "Reserve before the first cent" (15.3-CONTEXT §A4): the reservation is taken off
// the PROBED manifest, and nothing may spend before it — so no member can be dispatched at upload
// time. (b) "A folder reaches `complete` exactly once, only after its last member goes terminal":
// `memberCount` GROWS one upload at a time, so if the folder were already `ingesting` while
// members were still arriving, a 3-file folder whose first file finished before its second was
// uploaded would see `terminalCount === memberCount` at 1 === 1, settle, and synthesise a digest
// over one third of itself. A status CAS does not help — it only stops a SECOND completion.
// `reserveFolder` is therefore also the CLOSE SIGNAL: after it, `memberCount` is fixed.
import { isSearchable, VAULT_FOLDER_MEMBER_BATCH, type EstimateInput } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { type FolderReserveResult, reserveFolderInner, vFileManifest } from "./guardrails";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { scheduleExtraction } from "./vault";
import { startIngest } from "./vaultIngest";

/** What a folder read hands the UI. Refs and counts only (§4) — never a member's text. */
type FolderView = {
  _id: Id<"vaultFolders">;
  name: string;
  source: "upload" | "drive";
  status: "reserving" | "ingesting" | "complete" | "refused";
  memberCount: number;
  terminalCount: number;
  failedCount: number;
  reservedCents: number;
  digestDocId?: Id<"vaultDocuments">;
  digestBuiltAt?: number;
  createdAt: number;
};

const projectFolder = (f: Doc<"vaultFolders">): FolderView => ({
  _id: f._id,
  name: f.name,
  source: f.source,
  status: f.status,
  memberCount: f.memberCount,
  terminalCount: f.terminalCount,
  failedCount: f.failedCount,
  reservedCents: f.reservedCents,
  digestDocId: f.digestDocId,
  digestBuiltAt: f.digestBuiltAt,
  createdAt: f.createdAt,
});

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Open a folder. `reserving` means "members may be uploaded into me, and NOTHING may spend yet" —
 * it is the only status in which `memberCount` is allowed to move.
 */
export const createFolder = tenantMutation({
  args: { name: v.string(), source: v.union(v.literal("upload"), v.literal("drive")) },
  handler: async (ctx, { name, source }): Promise<{ folderId: Id<"vaultFolders"> }> => {
    const folderId = await ctx.db.insert("vaultFolders", {
      tenantId: ctx.tenantId,
      name: name.slice(0, 200) || "Untitled folder",
      source,
      status: "reserving",
      memberCount: 0,
      terminalCount: 0,
      failedCount: 0,
      reservedCents: 0,
      spentCents: 0,
      createdAt: Date.now(),
    });
    return { folderId };
  },
});

// ── Reserve (the money, the close signal, and the dispatch) ──────────────────

/**
 * Take the whole folder's reservation, or refuse it intact.
 *
 * The manifest is RE-DERIVED into cents by `reserveFolderInner` — the pre-flight card computed a
 * number too, and that number is a card, never an input, or the budget wall would be client-side.
 * `reserveFolderInner` is the plain-function half of `internal.guardrails.reserveFolder` precisely
 * so the reservation and the row that records it commit in ONE transaction; a reservation in a
 * different transaction from its row is a reservation that can leak (there is no folder-level
 * watchdog).
 *
 * ON REFUSAL: the folder goes `refused` and every member it collected is failed with
 * `folder_refused`. Nothing was ingested — refuse-intact is proven by absence — but the member
 * rows exist, and leaving them at `pending_extraction` would be exactly the silent parking 15.2
 * abolished. Failing them is honest, terminal, and Retry-able one at a time if the user wants a
 * single file after all.
 */
export const reserveFolder = tenantMutation({
  args: { folderId: v.id("vaultFolders"), files: vFileManifest },
  handler: async (
    ctx,
    { folderId, files },
  ): Promise<FolderReserveResult | { ok: false; reason: "not_reserving" }> => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.tenantId !== ctx.tenantId) return { ok: false, reason: "not_reserving" };
    // Idempotent by CAS on the status the create step set. A double-click cannot reserve twice, and
    // a cancelled folder (row deleted) cannot be reserved at all.
    if (folder.status !== "reserving") return { ok: false, reason: "not_reserving" };

    const result = await reserveFolderInner(ctx, {
      tenantId: ctx.tenantId,
      files: files as EstimateInput[],
    });

    if (!result.ok) {
      await ctx.db.patch(folderId, { status: "refused" });
      await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
        folderId,
        mode: "refuse",
        cursor: null,
      });
      return result; // the governed refusal object, unchanged — it names the numbers
    }

    await ctx.db.patch(folderId, {
      status: "ingesting",
      reservedCents: result.estCents,
      reservedAt: result.reservedAt,
    });
    // The close signal has fired, so evaluate completion FIRST: an all-duplicate folder inserted
    // zero rows and would otherwise never complete, because nothing will ever call `bumpFolder`.
    if (await tryComplete(ctx, folderId)) return result;
    await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
      folderId,
      mode: "dispatch",
      cursor: null,
    });
    return result;
  },
});

/**
 * ONE bounded batch of a folder's members, self-scheduling until the folder is walked.
 *
 * Batched because a folder is up to several hundred rows and Convex has no projection: reading a
 * member reads its whole row, against a 16 MiB per-transaction read cap. `.paginate()` may be
 * called only once per execution, which is why the cursor is an argument and the continuation is a
 * fresh scheduled call rather than a loop.
 *
 * Re-reads the folder every batch and stops if it is gone (cancel deleted it) or has left the
 * status the walk was started for. That is what makes cancel mid-dispatch cost nothing.
 */
export const walkFolderMembers = internalMutation({
  args: {
    folderId: v.id("vaultFolders"),
    mode: v.union(v.literal("dispatch"), v.literal("refuse")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { folderId, mode, cursor }): Promise<null> => {
    const folder = await ctx.db.get(folderId);
    if (!folder) return null; // cancelled — the lenient join, and the cheapest possible stop
    if (folder.status !== (mode === "dispatch" ? "ingesting" : "refused")) return null;

    const page = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_folder", (q) =>
        q.eq("tenantId", folder.tenantId).eq("folderId", folderId),
      )
      .paginate({ cursor, numItems: VAULT_FOLDER_MEMBER_BATCH });

    for (const doc of page.page) {
      if (doc.status !== "pending_extraction") continue; // already dispatched / already terminal
      if (mode === "refuse") {
        await ctx.runMutation(internal.vault.markFailed, {
          vaultDocId: doc._id,
          reason: "folder_refused",
        });
        continue;
      }
      await dispatchMember(ctx, doc);
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
        folderId,
        mode,
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

/**
 * Start ONE member's ingest on the pre-paid ingest rail.
 *
 * The branch is `vaultUpload`'s, verbatim in meaning: a searchable format whose text already
 * arrived rides the ingest workflow directly; everything else rides `scheduleExtraction` (which
 * enqueues on `vaultIngestPool` and lets the ONE runtime that can read bytes decide).
 * `rail: "ingest"` + `reserved: true` on BOTH sides is what keeps a folder off the cockpit's $5
 * window and unrefusable by a drained one — the money is already taken.
 */
async function dispatchMember(ctx: MutationCtx, doc: Doc<"vaultDocuments">): Promise<void> {
  if (isSearchable(doc.mimeType) && doc.text !== undefined && doc.text.length > 0) {
    await ctx.db.patch(doc._id, { status: "processing" });
    await startIngest(ctx, {
      vaultDocId: doc._id,
      tenantId: doc.tenantId,
      correlationId: crypto.randomUUID(),
      rail: "ingest",
      reserved: true,
    });
    return;
  }
  await scheduleExtraction(ctx, {
    vaultDocId: doc._id,
    tenantId: doc.tenantId,
    mimeType: doc.mimeType,
    title: doc.title,
    spendRail: "ingest",
    reserved: true,
  });
}

// ── Completion ────────────────────────────────────────────────────────────────

/**
 * THE hook the two terminal writers call. `vault.markReady` and `vault.markFailed` are the ONLY
 * two terminal writers for every rail, so this one function covers all nine of their call sites.
 *
 * ⚠ CALL IT WITH THE PRIOR STATUS, and only on a genuine non-terminal → terminal TRANSITION.
 * Neither writer is idempotent (both are a bare `patch`), and a workflow mutation whose journal
 * write fails is re-run — so counting after the patch would count a replay twice, push
 * `terminalCount` PAST `memberCount`, jump straight over an `=== memberCount` test and strand the
 * reservation forever. That is why the completion test below is `>=` and not `===`.
 *
 * A dangling `folderId` (cancel deleted the row) is a NO-OP, not an error: `ctx.db.patch` on a
 * deleted id throws, and these two writers run on every document on every rail, so an unguarded
 * bump would turn one cancel into a repo-wide ingest failure.
 */
export async function bumpFolder(
  ctx: MutationCtx,
  folderId: Id<"vaultFolders">,
  failed: boolean,
): Promise<void> {
  const folder = await ctx.db.get(folderId);
  if (!folder) return; // cancelled — an unresolvable folderId means "no folder", never "missing"
  await ctx.db.patch(folderId, {
    terminalCount: folder.terminalCount + 1,
    failedCount: folder.failedCount + (failed ? 1 : 0),
  });
  await tryComplete(ctx, folderId);
}

/**
 * The completion transition, exactly three things in this order:
 *   1. settle the reservation (refund the unspent remainder),
 *   2. hand off to the digest build,
 *   3. flip to `complete` — WHICH IS WHAT UNSEALS THE MEMBERS, so it must be last.
 *
 * Guarded by a CAS on `status === "ingesting"` read in this same transaction (Convex mutations are
 * serializable), so it can fire at most once per folder however many terminal events race.
 *
 * `settleFolder` runs IN this transaction, never scheduled: its own CAS is `reservedCents > 0` read
 * here, and the very next step flips the folder to `complete`. Scheduling it would open a window in
 * which a folder is complete while still holding a live reservation, and there is no folder-level
 * watchdog to notice.
 */
async function tryComplete(ctx: MutationCtx, folderId: Id<"vaultFolders">): Promise<boolean> {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.status !== "ingesting") return false;
  if (folder.terminalCount < folder.memberCount) return false;

  await ctx.runMutation(internal.guardrails.settleFolder, { folderId });

  // (2) THE DIGEST SLOT. Plan 15.3-06 owns the build and fills this in as
  //     `ctx.scheduler.runAfter(0, internal.vaultDigest.buildFolderDigest, { folderId })`, plus the
  //     17.1 Stage-2 drift call beside it — which needs an `internalAction` sibling of
  //     `blueprint.buildBlueprintDraft`, because that one is a `tenantAction` and a scheduled
  //     function has no identity (Pitfall 3). Deliberately NOT a dangling reference here: naming a
  //     function that does not exist yet is a typecheck failure, not a marker.

  await ctx.db.patch(folderId, { status: "complete" }); // (3) the unseal — always last
  return true;
}

// ── Cancel ────────────────────────────────────────────────────────────────────

/**
 * Cancel: settle the reservation, then DELETE the folder row. **ZERO `vaultDocuments` writes.**
 *
 * WHY DELETE RATHER THAN MARK. The seal is read THROUGH the folder row, so a `cancelled` status
 * would keep every member sealed forever — the exact inverse of the locked "cancelled documents
 * become groundable immediately". Members keep a dangling `folderId`; every folder read treats an
 * unresolvable id as "no folder" (a lenient join). Get that wrong and cancelled documents become
 * invisible instead of ordinary.
 *
 * WHY NOT CLEAR `folderId` ON THE MEMBERS. A `patch` rewrites the whole document, `text` blob
 * included. A member row carries up to VAULT_EXTRACT_CHAR_CAP (400,000) chars, so the 16 MiB
 * written-per-transaction cap is reached at 41 rows and a 400-member folder is ~9.5× over it. It
 * would need a batched `scheduler.runAfter(0, self)` loop to achieve exactly what the dangling id
 * already achieves for free.
 *
 * ⚠ WHAT CANCEL DOES *NOT* DO, and why there is no `pool.cancelAll` here even though the plan text
 * named one. `Workpool.cancelAll` takes `{ before?, limit? }` and NOTHING else — it pages the
 * pool's entire `work` table and cancels every pending item in it, for every folder and every
 * tenant, including single-file uploads queued in the same instant. Per-item `pool.cancel` needs
 * the `WorkId` the enqueue returns, and nothing persists one (schema.ts is closed for this phase).
 * So the stop is taken one layer down instead, where it is exactly folder-scoped and free:
 * `vault.markExtracting` refuses to start work whose folder row has vanished and fails the row
 * `folder_cancelled`. That is a STRICTLY better "no NEW spend" than `cancelAll` — it cannot touch
 * another tenant's queue, and it cannot leave a foreign member parked with no watchdog.
 *
 * ⚠ THE REFUND SETTLES AT THE CLICK, and the plan's "the refund settles after the last in-flight
 * action" is not implementable alongside deleting the row (`settleFolder` returns `no_folder` once
 * it is gone). Settling here is nonetheless arithmetically safe: `reserveFolderInner` debited the
 * window by the estimate, `recordSpend` debits the ACTUAL cents per document as they happen, and
 * `refundableCents` clamps the credit to `capacity - currentValue` — which at this instant is
 * exactly the estimate minus what has already been spent. Trailing in-flight spend then debits the
 * window normally. The residual cost, stated: a second folder reserved in that gap shrinks the
 * clamp, so the first tenant can be UNDER-refunded. Fail-closed; money is never minted.
 */
export const cancelFolder = tenantMutation({
  args: { folderId: v.id("vaultFolders") },
  handler: async (ctx, { folderId }): Promise<{ ok: boolean }> => {
    const folder = await ctx.db.get(folderId);
    // `settleFolder` takes a bare folderId and has NO tenant guard of its own — it reads
    // `folder.tenantId` for the limiter key. The guard has to be here, or a foreign id refunds and
    // deletes another tenant's folder.
    if (!folder || folder.tenantId !== ctx.tenantId) return { ok: false };
    await ctx.runMutation(internal.guardrails.settleFolder, { folderId }); // BEFORE the delete
    await ctx.db.delete(folderId);
    return { ok: true };
  },
});

// ── Reads (the drill-in surface) ─────────────────────────────────────────────

/** The tenant's folders, newest first — the cards that sit in the same grid as documents. */
export const listFolders = tenantQuery({
  args: {},
  handler: async (ctx): Promise<FolderView[]> => {
    const rows = await ctx.db
      .query("vaultFolders")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(VAULT_FOLDER_MEMBER_BATCH * 5);
    return rows.map(projectFolder);
  },
});

/**
 * ONE folder, or `null`. THE LENIENT JOIN, and the whole reason drill-in survives a cancel: a
 * deleted row is `null` here, and the caller routes back to the flat grid rather than rendering a
 * folder that no longer exists. `listVaultDocs({ folderId })` deliberately still returns the
 * members — they are ordinary documents now.
 */
export const getFolder = tenantQuery({
  args: { folderId: v.id("vaultFolders") },
  handler: async (ctx, { folderId }): Promise<FolderView | null> => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.tenantId !== ctx.tenantId) return null;
    return projectFolder(folder);
  },
});
