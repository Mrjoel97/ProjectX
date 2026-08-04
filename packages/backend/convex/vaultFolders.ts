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
import {
  type EstimateInput,
  estimateFolderCents,
  isSearchable,
  VAULT_FOLDER_MEMBER_BATCH,
} from "@pikar/vault";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  DEPLOYMENT_INGEST_BUDGET_CENTS,
  type FolderReserveRefusal,
  type FolderReserveResult,
  getGuardrailConfig,
  INGEST_DAILY_BUDGET_CENTS,
  ingestRemainingCentsInner,
  rateLimiter,
  reserveFolderInner,
  vFileManifest,
} from "./guardrails";
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
  ): Promise<FolderReserveResult | { ok: false; reason: "not_reserving" | "manifest_short" }> => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.tenantId !== ctx.tenantId) return { ok: false, reason: "not_reserving" };
    // Idempotent by CAS on the status the create step set. A double-click cannot reserve twice, and
    // a cancelled folder (row deleted) cannot be reserved at all.
    if (folder.status !== "reserving") return { ok: false, reason: "not_reserving" };
    // THE MANIFEST IS THE CLIENT'S, AND THIS IS THE ONE THING THE SERVER CAN CHECK IT AGAINST.
    // `memberCount` counts rows this deployment actually inserted, and dedup only ever REMOVES
    // files, so a real manifest can never be shorter than the folder it describes. Without this,
    // `reserveFolder({ files: [] })` prices a 150 MB folder at 0 cents, flips it to `ingesting`,
    // and dispatches every member with `reserved: true` — i.e. the caller chooses where the wall
    // is, which is exactly what the comment below says a manifest may never do.
    // It is a LOWER BOUND, not a derivation: `pages`/`hasTextLayer` come from the client's stage-2
    // local probe (CONTEXT §A4) and no server walk can recover them — 400 member rows each
    // carrying a 400 KB `text` blob is far over the 16 MiB read cap. Above the bound the manifest
    // is still trusted; that residual is named in this phase's deferred-items.md.
    if (files.length < folder.memberCount) return { ok: false, reason: "manifest_short" };

    const result = await reserveFolderInner(ctx, {
      tenantId: ctx.tenantId,
      files: files as EstimateInput[],
    });

    if (!result.ok) {
      await ctx.db.patch(folderId, { status: "refused" });
      await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
        tenantId: ctx.tenantId,
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
      tenantId: ctx.tenantId,
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
 * `dispatch` and `refuse` re-read the folder every batch and stop if it is gone (cancel deleted it)
 * or has left the status the walk was started for. That is what makes cancel mid-dispatch cost
 * nothing.
 *
 * `cancel` is the third mode and the INVERSE of that: its parent row is already deleted, which is
 * precisely why `tenantId` is an argument rather than read off the folder. It exists because
 * cancelling a folder otherwise leaves every not-yet-dispatched member parked at
 * `pending_extraction` with a dangling `folderId`, no dispatcher (this walk stops at a missing
 * parent) and — since 15.3-04 narrowed `watchdogStalled` to `extracting` — no clock either. That is
 * the silent parking 15.2 abolished, and cancelling BEFORE reserve (the pre-flight card's "no,
 * don't start this", the likeliest cancel of all) parks 100% of the members. So they are failed
 * `folder_cancelled` — the same reason `vault.markExtracting` writes for the members that got as
 * far as work-start, terminal, honest, and individually Retry-able.
 */
export const walkFolderMembers = internalMutation({
  args: {
    tenantId: v.string(),
    folderId: v.id("vaultFolders"),
    mode: v.union(v.literal("dispatch"), v.literal("refuse"), v.literal("cancel")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { tenantId, folderId, mode, cursor }): Promise<null> => {
    if (mode !== "cancel") {
      const folder = await ctx.db.get(folderId);
      if (!folder) return null; // cancelled — the lenient join, and the cheapest possible stop
      if (folder.status !== (mode === "dispatch" ? "ingesting" : "refused")) return null;
    }

    const page = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_folder", (q) => q.eq("tenantId", tenantId).eq("folderId", folderId))
      .paginate({ cursor, numItems: VAULT_FOLDER_MEMBER_BATCH });

    for (const doc of page.page) {
      if (doc.status !== "pending_extraction") continue; // already dispatched / already terminal
      if (mode === "dispatch") {
        await dispatchMember(ctx, doc);
        continue;
      }
      await ctx.runMutation(internal.vault.markFailed, {
        vaultDocId: doc._id,
        reason: mode === "cancel" ? "folder_cancelled" : "folder_refused",
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
        tenantId,
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
 * The EXACT INVERSE of `bumpFolder`, for the one thing that un-terminalises a member:
 * `vaultSweep.retryExtraction` puts a `failed` row back to `pending_extraction`.
 *
 * The un-terminalling and the counter are ONE FACT. Without this, a retried member is counted a
 * SECOND time on its next terminal event (`countTerminal` sees a genuine non-terminal → terminal
 * transition, because the retry made the prior status non-terminal again) — so a 3-member folder
 * whose first member fails, is retried and succeeds reaches `terminalCount === memberCount` while
 * its LAST member is still queued. The folder then settles its reservation while that member has
 * yet to spend, lifts the seal early, and hands plan 06 an incomplete folder to synthesise. The
 * completion CAS does not help: it stops a SECOND completion, never an EARLY one.
 *
 * Only while the folder is still `ingesting`: a `complete` folder's counters are history — its
 * digest was built from them — and decrementing them would not re-open it.
 */
export async function unbumpFolder(
  ctx: MutationCtx,
  folderId: Id<"vaultFolders">,
  wasFailed: boolean,
): Promise<void> {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.status !== "ingesting") return;
  await ctx.db.patch(folderId, {
    terminalCount: Math.max(0, folder.terminalCount - 1),
    failedCount: Math.max(0, folder.failedCount - (wasFailed ? 1 : 0)),
  });
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
export async function tryComplete(
  ctx: MutationCtx,
  folderId: Id<"vaultFolders">,
): Promise<boolean> {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.status !== "ingesting") return false;
  if (folder.terminalCount < folder.memberCount) return false;

  await ctx.runMutation(internal.guardrails.settleFolder, { folderId });

  // (2) THE DIGEST. SCHEDULED, not awaited: it is an ACTION (a model call) and a mutation cannot
  //     run one. It therefore lands AFTER this transaction commits — i.e. after the folder is
  //     already `complete` and after `settleFolder` has zeroed the reservation — which is why
  //     `buildFolderDigest` asserts `complete` and never `ingesting`. `tenantId` is EXPLICIT
  //     because a scheduled function has no identity (Pitfall 3).
  //     STILL DEFERRED: the 17.1 Stage-2 drift call plan 04 named as a sibling here. It needs an
  //     `internalAction` sibling of `blueprint.buildBlueprintDraft` (that one is a `tenantAction`)
  //     which does not exist yet — naming it here would be a typecheck failure, not a marker.
  await ctx.scheduler.runAfter(0, internal.vaultDigest.buildFolderDigest, {
    tenantId: folder.tenantId,
    folderId,
  });

  await ctx.db.patch(folderId, { status: "complete" }); // (3) the unseal — always last
  return true;
}

// ── Cancel ────────────────────────────────────────────────────────────────────

/**
 * Cancel: settle the reservation, then DELETE the folder row. **ZERO `vaultDocuments` writes IN
 * THIS MUTATION** (the write cap is a per-TRANSACTION cap, and that is the guarantee it needs),
 * then a batched `cancel` walk terminalises the members nothing will ever dispatch — see
 * `walkFolderMembers`. Same shape as the refusal path, for the same never-silent reason.
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

    // 15.3-06: THE DIGEST DIES WITH ITS FOLDER, and it is the ONE member-ish row the walk below
    // cannot reach. There is no status guard here, so a `complete` folder — the only kind that HAS
    // a digest — is cancellable; and the digest deliberately carries NO `folderId` (that absence is
    // the recursion guard), so `walkFolderMembers` keys on an id it does not have and skips it
    // entirely. Left alone it survives as a `ready`, embedded, GROUNDABLE document that keeps
    // answering questions about a folder the user deleted — including the identity lines of members
    // the walk is about to fail as `folder_cancelled` — and is unreachable from every folder
    // surface, because the `digestDocId` pointer dies with the row on the next line. `deleteVaultDoc`
    // is the cascade (row + rag chunks + graphEdges with orphan-node GC), and it does NOT bump any
    // counter here: `bumpFolder` fires on `before.folderId`, which a digest has none of.
    if (folder.digestDocId) {
      await ctx.runMutation(api.vault.deleteVaultDoc, { vaultDocId: folder.digestDocId });
    }

    await ctx.db.delete(folderId);
    // AFTER the delete, and it carries the tenant because the row it would have read is gone.
    // Members already `ready` are untouched and become ordinary folder-less documents; members
    // still `pending_extraction` are failed `folder_cancelled` rather than left parked forever.
    await ctx.scheduler.runAfter(0, internal.vaultFolders.walkFolderMembers, {
      tenantId: ctx.tenantId,
      folderId,
      mode: "cancel",
      cursor: null,
    });
    return { ok: true };
  },
});

// ── Sealing (VALT-07) ────────────────────────────────────────────────────────

/**
 * THE seal predicate, in one place: **a document is sealed while the folder it belongs to is
 * `ingesting`.**
 *
 * Sealing cannot be done the way `origin: "agent"` exclusion is done — that works by never calling
 * `startIngest`, and a folder's members must genuinely embed and graph-extract during the sealed
 * window so the folder is groundable the instant it completes. So sealing is an explicit filter,
 * and it is applied at every site that can hand a doc id to a reader (see `docs/playbooks/vault.md`
 * § 15.3-05).
 *
 * ⚠ THE STATUS TEST IS POSITIVE, AND THAT IS THE WHOLE DESIGN. Written as
 * `folder?.status !== "complete"` it would be a one-word bug: `cancelFolder` DELETES the folder row
 * (a cancelled folder's members stay as ordinary documents carrying a dangling `folderId`), so a
 * missing row would read as `undefined !== "complete"` ⇒ sealed FOREVER. A missing folder means
 * folder-less, never sealed — the same lenient join `readVaultPage` and `getFolder` already make.
 *
 * `"reserving"` needs no seal and `"refused"` needs no special case: `vault.vaultUpload` inserts a
 * folder member at `pending_extraction` and dispatches nothing until `reserveFolder`, so members in
 * either status carry no `ragEntryId` and no graph edges — structurally unreachable by every
 * retrieval path. `ingesting` is exactly the window where a member is embedded but not yet ready to
 * be read as part of a whole folder.
 *
 * The folder lookups are BATCHED through a Map: a per-document `ctx.db.get` in a retrieval hot path
 * is the read amplification this phase has already been bitten by twice.
 */
export async function sealedIn(
  ctx: QueryCtx,
  docs: readonly { _id: Id<"vaultDocuments">; folderId?: Id<"vaultFolders"> }[],
): Promise<Set<Id<"vaultDocuments">>> {
  const byFolder = new Map<Id<"vaultFolders">, boolean>();
  for (const doc of docs) {
    if (doc.folderId && !byFolder.has(doc.folderId)) {
      byFolder.set(doc.folderId, (await ctx.db.get(doc.folderId))?.status === "ingesting");
    }
  }
  return new Set(docs.filter((d) => d.folderId && byFolder.get(d.folderId)).map((d) => d._id));
}

/**
 * The registered hop for the two ACTION call sites (`vaultGround.runVaultGround`,
 * `vault.vaultSearch`) — actions cannot read `ctx.db`. Tenant-scoped, and a foreign / missing id
 * simply drops out: it is not this query's job to report one as sealed, and saying so would be an
 * ownership oracle. `blueprint.unincorporatedFor` is a plain `QueryCtx` helper and calls `sealedIn`
 * directly, on rows it has already read — no second doc read there.
 */
export const sealedDocIds = internalQuery({
  args: { tenantId: v.string(), docIds: v.array(v.id("vaultDocuments")) },
  handler: async (ctx, { tenantId, docIds }): Promise<Id<"vaultDocuments">[]> => {
    const docs: Doc<"vaultDocuments">[] = [];
    for (const id of docIds) {
      const doc = await ctx.db.get(id);
      if (doc && doc.tenantId === tenantId) docs.push(doc);
    }
    return [...(await sealedIn(ctx, docs))];
  },
});

// ── Pre-flight (the card, which consumes NOTHING) ────────────────────────────

/** One itemised line, grouped by the extraction rail that priced it. */
type FolderEstimateLine = { label: string; qty: number; unit: string; cents: number };

/**
 * THE PRE-FLIGHT CARD'S ONLY BACKEND CALL — `media.jobEstimate`'s shape, over folders.
 *
 * **It is a query, so it CONSUMES NOTHING**, and that is the whole point: it runs
 * `reserveFolderInner`'s refusal checks in the SAME ORDER (guardrails.ts:502-555), steps 1-4, and
 * STOPS before the two `rateLimiter.limit(..., reserve: true)` calls. Same manifest in, same
 * `estimateFolderCents` out ⇒ the number on the card is the number the reserve takes.
 *
 * ⚠ THE CEILINGS MUST PRECEDE THE TWO `check` CALLS. `check()` does not return `{ok:false}` above
 * capacity — it THROWS (guardrails.ts:485-488). Reordering turns a governed refusal into a stack
 * trace on the card. `check` takes a query ctx; only `limit` needs a mutation, which is exactly the
 * line this query does not cross.
 *
 * Refs and counts only (§4): a `reason` is a code, never a filename. `perFile` is INDEX-ALIGNED
 * with `files`, so the surface zips it against its own local `File[]` for names.
 */
export const folderEstimate = tenantQuery({
  args: { files: vFileManifest },
  handler: async (
    ctx,
    { files },
  ): Promise<{
    lines: FolderEstimateLine[];
    perFile: { cents: number; reason: string }[];
    totalCents: number;
    capCents: number;
    remainingCents: number;
    refusal: { reason: FolderReserveRefusal; shortfallCents: number } | null;
  }> => {
    const capCents = INGEST_DAILY_BUDGET_CENTS;
    const empty = { lines: [], perFile: [], totalCents: 0, capCents, remainingCents: 0 };

    // 1. Kill switch first — pricing has not run, so both figures are 0 and the copy for this
    //    reason names no figure.
    const cfg = await getGuardrailConfig(ctx);
    if (cfg.killSwitch) {
      return { ...empty, refusal: { reason: "kill_switch", shortfallCents: 0 } };
    }

    // 2. Price the manifest and read the honest remaining budget.
    const { estCents, perFile } = estimateFolderCents(files as EstimateInput[]);
    const remainingCents = await ingestRemainingCentsInner(ctx, ctx.tenantId);
    const shortfallCents = Math.max(0, estCents - remainingCents);
    const priced = {
      lines: linesOf(perFile),
      perFile,
      totalCents: estCents,
      capCents,
      remainingCents,
    };
    const refuse = (reason: FolderReserveRefusal) => ({
      ...priced,
      refusal: { reason, shortfallCents },
    });

    // 3. THE CEILINGS, BEFORE THE LIMITER.
    if (estCents > INGEST_DAILY_BUDGET_CENTS) return refuse("over_folder_cap");
    if (estCents > DEPLOYMENT_INGEST_BUDGET_CENTS) return refuse("over_deployment_cap");

    // 4. Tenant window first, so a tenant that is personally out is told so rather than blamed for
    //    a global pause.
    const tenantWindow = await rateLimiter.check(ctx, "ingestSpendCents", {
      key: ctx.tenantId,
      count: estCents,
    });
    if (!tenantWindow.ok) return refuse("ingest_daily_exhausted");
    const deploymentWindow = await rateLimiter.check(ctx, "deploymentIngestSpendCents", {
      count: estCents,
    });
    if (!deploymentWindow.ok) return refuse("deployment_ingest_exhausted");

    return { ...priced, refusal: null };
  },
});

/** Fold the index-aligned per-file estimate into one line per rail. The reason IS the label — it is
 *  a stable refs-only code, and the surface owns the prose (`preflightCopy.ts`). */
function linesOf(perFile: { cents: number; reason: string }[]): FolderEstimateLine[] {
  const by = new Map<string, FolderEstimateLine>();
  for (const f of perFile) {
    const line = by.get(f.reason) ?? { label: f.reason, qty: 0, unit: "files", cents: 0 };
    line.qty += 1;
    line.cents += f.cents;
    by.set(f.reason, line);
  }
  return [...by.values()];
}

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
