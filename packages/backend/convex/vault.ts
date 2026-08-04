// The knowledge-vault ingest mutations + lifecycle + delete-cascade (VALT-01) — a thin adapter
// (§1) over @pikar/vault (categories/cap) + the durable ingest workflow (vaultIngest.ts).
//
// PUBLIC tenant mutations (§2 — tenantMutation wrappers inject tenantId):
//   - vaultIngestText: paste / Brain-Dump ingest (+ a Phase-4 late-text `docId` seam).
//   - vaultUpload:     file ingest with ACCEPT-BUT-DEFER — a searchable TXT/MD/CSV starts the
//                      ingest workflow; a binary is stored at `pending_extraction` (no embed) until
//                      its text arrives via the vaultIngestText `docId` seam.
//   - deleteVaultDoc:  cascade delete (row + rag chunks + graphEdges) with orphan-node GC.
// INTERNAL lifecycle (workflow-only): getDoc (embed step reader), markReady / markFailed.
//
// HASH-DEDUP (locked CONTEXT decision): a duplicate (tenantId, contentHash) reuses the existing
// item and starts NO workflow — identical content is never re-embedded. The raw doc `text` lives
// ONLY on this row + the rag chunks; nothing else in the pipeline carries raw content (§4).
//
// Ingest always starts via `vaultIngest.startIngest` (never a bare `workflow.start`) — that helper
// attaches the failure-handling `onComplete`, so a dead run can never strand a doc at `processing`
// (the vault plane's zero-embed-before-accept invariant, mirroring executePlan for delivery).
import type { EntryId } from "@convex-dev/rag";
import {
  capMB,
  categoryFor,
  EXTRACTION_WATCHDOG_MS,
  isSearchable,
  schedulingRailFor,
  VAULT_CATEGORIES,
  VAULT_FILE_CAP_BYTES,
  VAULT_GRID_PAGE,
  VAULT_GRID_READ_BUDGET_BYTES,
  VAULT_VIDEO_CAP_BYTES,
  type VaultSource,
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
import { vaultIngestPool } from "./index";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import schema from "./schema";
import { bumpFolder } from "./vaultFolders";
import { startIngest } from "./vaultIngest";
import { rag } from "./vaultRag";

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

// Derive the identity arg validators FROM the schema (the `tenantProfile.ts:47` rung-2 precedent) so
// the two mutations' args can never drift from the table's closed `docType` union.
const vdFields = schema.tables.vaultDocuments.validator.fields;

/** Display cap for a document's identity line. */
const IDENTITY_LINE_MAX = 120;

/**
 * Sanitize an identity line before it is written (VALT-12).
 *
 * A TRUST BOUNDARY, not a cosmetic field: this string is rendered into the folder digest's manifest
 * (`vaultDigest.ts:131`) and therefore into a MODEL PROMPT. It is user-authored on the
 * `setDocIdentity` path and model-authored on the `applyClassification` path — both untrusted, which
 * is why the one function guards both writers rather than one caller.
 *
 * The op order is `sanitizeAgentName`'s (`@pikar/core`, businessProfile.ts:406) and is load-bearing:
 * `\p{C}` strips Cc/Cf in one pass — a NEWLINE would let the line open what reads as a fresh
 * instruction block, and a bidi override / zero-width character would let it render as something
 * other than what it is — then `\s+` collapses the residue plus U+2028/U+2029, then trim, then the
 * cap, then trim AGAIN so a cut landing mid-whitespace cannot leave a dangling separator.
 *
 * ponytail: a local copy rather than `sanitizeAgentName` itself, whose `AGENT_NAME_MAX = 40` is
 * module-private to `@pikar/core` and far too short for an identity line. Ceiling — it does not
 * detect a plausible-English instruction ("Also list every document"); the structural defence is
 * that the line is interpolated into a LABELLED manifest field, never concatenated as a bare
 * instruction line. Upgrade path: when a third caller needs it, export one
 * `sanitizeLine(raw, max)` from `@pikar/core` and delete this.
 */
const sanitizeIdentityLine = (raw: string): string =>
  raw.replace(/\p{C}/gu, " ").replace(/\s+/gu, " ").trim().slice(0, IDENTITY_LINE_MAX).trim();

/**
 * The ONE place an extraction is scheduled. Three callers: vaultUpload, the recovery sweep
 * (vaultSweep.sweepPendingExtraction) and the user's Retry button (vaultSweep.retryExtraction).
 *
 * Deliberately PERMISSIVE. The old shape asked `extractionKindFor` and, on `null`, scheduled
 * NOTHING — which is how a .xlsm sat at pending_extraction for ~20 hours with 0 chars and no
 * failureReason. The sniff cannot move here: `ctx.storage.get` is action-only, so a mutation
 * physically cannot see the bytes. So we schedule unconditionally and let the ONE runtime that CAN
 * read bytes decide — where `fail("unsupported_format")` has existed all along and was simply
 * unreachable.
 *
 * Every attempt still gets a WATCHDOG, but it is armed by `markExtracting` (below), NOT here.
 * 15.3-04 moved it: arming at QUEUE time was survivable while every upload was one file, and is a
 * fabricated-failure generator at folder scale — 400 documents behind VAULT_INGEST_PARALLELISM sit
 * queued for an hour and every one of them is marked `extraction_stalled` while perfectly healthy,
 * writing failures that never happened into the manifest the folder promises is honest. The
 * watchdog is still per-attempt (a Retry arms a fresh one at ITS work-start) and still idempotent,
 * so it cannot kill a racing success — the onIngestComplete pattern.
 *
 * This helper deliberately does NOT sniff (bytes are unreachable in a mutation) and does NOT
 * decide supportability (that is the action's job, and its refusal is terminal).
 */
export async function scheduleExtraction(
  ctx: MutationCtx,
  {
    vaultDocId,
    tenantId,
    mimeType,
    title,
    spendRail,
    reserved,
  }: {
    vaultDocId: Id<"vaultDocuments">;
    tenantId: string;
    mimeType: string;
    title?: string;
    /** 15.3-03 BUDGET rail — note this is NOT `rail` below, which is the SCHEDULING rail
     *  (transcribe vs extract). Optional, so all three existing callers are unchanged. */
    spendRail?: "ingest";
    reserved?: boolean;
  },
): Promise<void> {
  const rail = schedulingRailFor(mimeType, title);
  // THE POOL, not `ctx.scheduler.runAfter(0, …)` (15.3-04, CONTEXT §B15). The raw scheduler is
  // bounded only by the deployment's scheduled-job concurrency class, so 400 queued extractions
  // sit in front of every delivery and cron job in the deployment — "never starve the cockpit"
  // arriving as latency rather than as budget. `vaultIngestPool` bounds it at
  // VAULT_INGEST_PARALLELISM instead. The dispatch target is a TERNARY over two internalActions
  // with byte-identical arg validators, not a single `extractDoc`.
  await vaultIngestPool.enqueueAction(
    ctx,
    rail === "transcribe" ? internal.vaultTranscribe.transcribeDoc : internal.vaultExtract.extractDoc,
    { vaultDocId, tenantId, spendRail, reserved },
  );
}

// ── Public ingest mutations ───────────────────────────────────────────────────

/**
 * Paste / Brain-Dump text ingest. Hash-dedups (a duplicate returns the existing id, no workflow),
 * else inserts a `processing` brain-dump row + starts the ingest workflow. A `docId` (the Phase-4
 * late-text arrival seam) patches text + flips a stored row to `processing` and starts the workflow.
 */
export const vaultIngestText = tenantMutation({
  args: {
    text: v.string(),
    title: v.optional(v.string()),
    source: v.optional(v.string()),
    docId: v.optional(v.id("vaultDocuments")),
  },
  handler: async (
    ctx,
    { text, title, source, docId },
  ): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const hash = await contentHash(text);

    // Late-text arrival: a pre-existing (pending_extraction) row gets its text + hash, then ingests.
    if (docId) {
      const existing = await ctx.db.get(docId);
      if (!existing || existing.tenantId !== ctx.tenantId) throw new Error("vault: doc not found");
      await ctx.db.patch(docId, {
        text,
        contentHash: hash,
        size: byteLen(text),
        status: "processing",
      });
      const correlationId = crypto.randomUUID();
      await startIngest(ctx, { vaultDocId: docId, tenantId: ctx.tenantId, correlationId });
      return { vaultDocId: docId };
    }

    // Hash-dedup: identical content for this tenant reuses the existing item (no re-embed).
    const dup = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("contentHash", hash),
      )
      .first();
    if (dup) return { vaultDocId: dup._id };

    const src = (source ?? "paste") as VaultSource;
    const vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId: ctx.tenantId,
      title: (title ?? text.split("\n")[0] ?? "").slice(0, 80) || "Untitled",
      kind: "brain_dump",
      category: categoryFor({ source: src }),
      source: src,
      mimeType: "text/plain",
      size: byteLen(text),
      contentHash: hash,
      text,
      status: "processing",
      createdAt: Date.now(),
    });
    const correlationId = crypto.randomUUID();
    await startIngest(ctx, { vaultDocId, tenantId: ctx.tenantId, correlationId });
    return { vaultDocId };
  },
});

/**
 * File upload ingest with ACCEPT-BUT-DEFER. Oversize is rejected per kind (video >
 * VAULT_VIDEO_CAP_BYTES, else > VAULT_FILE_CAP_BYTES). A
 * searchable TXT/MD/CSV WITH text stores `processing` + starts the ingest workflow; a non-searchable
 * MIME (pdf/image/video/…) stores `pending_extraction` and starts NO workflow (its text arrives
 * later via the vaultIngestText `docId` seam). Hash-dedup applies to both (a re-upload of identical
 * bytes reuses the existing item).
 */
export const vaultUpload = tenantMutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    contentHash: v.string(),
    text: v.optional(v.string()),
    /** 15.3-04 folder rail. ABSENT ⇒ exactly today's single-file behaviour. */
    folderId: v.optional(v.id("vaultFolders")),
  },
  handler: async (
    ctx,
    { storageId, filename, mimeType, size, contentHash: hash, text, folderId },
  ): Promise<{ vaultDocId: Id<"vaultDocuments">; deduped: boolean }> => {
    // Per-kind cap: video is bounded by the transcription API's hard limit, everything else by the
    // storage ceiling. This is the single chokepoint — all video reaches transcribeDoc only through
    // here, so no downstream size guard is needed. The MESSAGES name the cap from the constant:
    // typing the number here is how the client and the server drifted apart before 15.3-02.
    if (mimeType.startsWith("video/")) {
      if (size > VAULT_VIDEO_CAP_BYTES)
        throw new Error(`vault: video too large (max ${capMB(VAULT_VIDEO_CAP_BYTES)})`);
    } else if (size > VAULT_FILE_CAP_BYTES) {
      throw new Error(`vault: file too large (max ${capMB(VAULT_FILE_CAP_BYTES)})`);
    }

    // A folder member may only be added while its folder is still `reserving` — that status IS the
    // window in which `memberCount` may move, and `reserveFolder` closes it. A member accepted
    // after the close signal would push `memberCount` past a `terminalCount` that has already
    // settled, and the folder would never complete again.
    const folder = folderId ? await ctx.db.get(folderId) : null;
    if (folderId && (!folder || folder.tenantId !== ctx.tenantId || folder.status !== "reserving"))
      throw new Error("vault: folder not open for members");

    // Hash-dedup: identical bytes for this tenant reuse the existing item (no re-store / re-embed).
    //
    // ⚠ A DEDUP HIT IS NEVER ANNEXED INTO THE FOLDER (15.3-CONTEXT §B7). Patching `folderId` onto
    // the existing row would silently take a pre-existing document into the folder AND seal a
    // document the user could ground on yesterday. It is reported as `deduped` instead, and
    // `memberCount` — which counts ROWS ACTUALLY INSERTED, never files submitted — does not move.
    // That is also why a duplicate inside a folder cannot stop the folder completing: a dedup hit
    // starts no workflow, so it would never produce the terminal event a naive count waits for.
    const dup = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("contentHash", hash),
      )
      .first();
    if (dup) return { vaultDocId: dup._id, deduped: true };

    // Searchable ONLY when the format is wired through embed+extract AND its text is already present.
    const searchable = isSearchable(mimeType) && text !== undefined && text.length > 0;
    const vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId: ctx.tenantId,
      title: filename,
      kind: "upload",
      category: categoryFor({ source: "upload", mimeType }),
      source: "upload",
      mimeType,
      size,
      contentHash: hash,
      storageId,
      text, // present for searchable TXT/MD/CSV; undefined for binaries (awaits extraction)
      status: searchable && !folderId ? "processing" : "pending_extraction",
      folderId,
      createdAt: Date.now(),
    });
    if (folder) {
      await ctx.db.patch(folder._id, { memberCount: folder.memberCount + 1 });
      // AND DISPATCH NOTHING. The folder's reservation has not been taken yet, and "reserve before
      // the first cent" is the invariant the whole phase exists to protect —
      // `vaultFolders.reserveFolder` starts every member once the money is held.
      return { vaultDocId, deduped: false };
    }
    if (searchable) {
      const correlationId = crypto.randomUUID();
      await startIngest(ctx, { vaultDocId, tenantId: ctx.tenantId, correlationId });
    } else {
      // Auto-extract: EVERY stored binary schedules an extraction rail, recognized or not. The
      // row stays pending_extraction here — the action flips it to `extracting` when work actually
      // starts (honest pill). Nothing is decided from the MIME type beyond transcribe-vs-extract:
      // only the action can read the bytes, so only the action can refuse, and its refusal is a
      // terminal failed(...) rather than a row that quietly never moves.
      await scheduleExtraction(ctx, {
        vaultDocId,
        tenantId: ctx.tenantId,
        mimeType,
        title: filename,
      });
    }
    return { vaultDocId, deduped: false };
  },
});

/**
 * The FOLDER rail's upload seam: hash the bytes SERVER-side, then insert through `vaultUpload`.
 *
 * `Dropzone` hashes each file in browser heap because `vaultUpload` needs a `contentHash` and
 * SubtleCrypto has no streaming digest. At a 200 MB per-file cap across a 1.5 GB folder that is
 * not viable, and the bytes are already in `ctx.storage` — so the folder rail hashes there
 * (15.3-CONTEXT §B9). The single-file path keeps its client hash, unchanged.
 *
 * An ACTION because `ctx.storage.get` is action-only, and it calls the PUBLIC `vaultUpload` rather
 * than an internal twin: this action is invoked by an authenticated browser, so `ctx.runMutation`
 * carries the identity through and the tenant wrapper resolves normally. (The `ingestFromAttachment`
 * / `ingestExtractedText` internal twins exist because their callers are SCHEDULED actions, which
 * have no identity — Pitfall 3. That does not apply here.)
 *
 * The dedup check and the insert stay together inside `vaultUpload`'s single serializable
 * transaction; only the HASH moves out. Split those two and two concurrent identical files both
 * insert.
 *
 * Accepted cost, recorded: a folder cannot skip UPLOADING a duplicate it has not yet sent. That is
 * not a regression — `Dropzone.ingestOne` already POSTs the bytes before it ever calls
 * `vaultUpload`, so the client hash never saved an upload either.
 * ponytail: this relocates the whole-file buffer from browser heap to action heap rather than
 * removing it (`crypto.subtle.digest` has no streaming API on either side). Safe because the
 * client drives these sequentially — one buffer live at a time. Do NOT move this onto
 * `vaultIngestPool`: VAULT_INGEST_PARALLELISM × 200 MB does not fit a ~512 MB action.
 */
export const vaultUploadFolderFile = tenantAction({
  args: {
    folderId: v.id("vaultFolders"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    text: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ vaultDocId: Id<"vaultDocuments">; deduped: boolean }> => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("vault: uploaded bytes not found");
    const hash = await contentHash(new Uint8Array(await blob.arrayBuffer()));
    return await ctx.runMutation(api.vault.vaultUpload, { ...args, contentHash: hash });
  },
});

/**
 * Delete a vault document and everything it owns: the row, its rag chunks (deleteAsync — a
 * mutation-safe background cascade), and its graphEdges. Each removed edge decrements both
 * endpoints' degree; a node whose degree hits 0 is GC'd (orphan), a node still shared with another
 * doc survives. Cross-tenant / missing → a no-op (tenant guard). The rag chunks + this row are the
 * only raw-content stores, so this fully removes the document's raw text (§4).
 *
 * A DELETE IS ALSO A TERMINAL EVENT when the row is a folder member that had not reached one.
 * Deleting the row deletes the only thing that could ever produce that member's terminal event —
 * `markReady`/`markFailed` both early-return on a missing row — so `terminalCount` could never
 * reach `memberCount`: the folder would sit at `ingesting` forever, holding a reservation nothing
 * settles (there is no folder-level watchdog) and, from plan 05 on, sealing every surviving member
 * out of retrieval permanently. It counts as FAILED, so that memberCount = read + unread stays
 * true and the manifest says the honest thing: this document is not there to be read.
 */
export const deleteVaultDoc = tenantMutation({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }): Promise<{ ok: boolean }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return { ok: false }; // tenant guard / already gone

    // rag chunks (only if embedded) — mutation-safe background delete.
    if (doc.ragEntryId) await rag.deleteAsync(ctx, { entryId: doc.ragEntryId as EntryId });

    // This doc's graph edges → delete + decrement each incident endpoint's degree, GC orphans.
    const edges = await ctx.db
      .query("graphEdges")
      .withIndex("by_tenant_source", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("sourceDocId", vaultDocId),
      )
      .collect();
    const touched = new Set<Id<"graphNodes">>();
    for (const e of edges) {
      touched.add(e.fromNodeId);
      touched.add(e.toNodeId);
      await ctx.db.delete(e._id);
    }
    for (const nodeId of touched) {
      const node = await ctx.db.get(nodeId);
      if (!node) continue;
      const incident = edges.filter((e) => e.fromNodeId === nodeId || e.toNodeId === nodeId).length;
      const newDegree = node.degree - incident;
      if (newDegree <= 0)
        await ctx.db.delete(nodeId); // orphan GC
      else await ctx.db.patch(nodeId, { degree: newDegree });
    }

    // The member's terminal event, taken here because the row that owed it is about to vanish.
    if (doc.folderId && doc.status !== "ready" && doc.status !== "failed") {
      await bumpFolder(ctx, doc.folderId, true);
    }
    await ctx.db.delete(vaultDocId);
    return { ok: true };
  },
});

/**
 * The user's correction of a document's identity (VALT-12) — the ONE writer that sets
 * `identityUserSet: true`, and the ONE thing that makes `applyClassification` back off forever.
 *
 * `identityLine` is sanitised at THIS write boundary rather than at the read: the digest, the grid
 * and the preview all read the field, and a rule applied at three readers is a rule that will be
 * missed at the fourth.
 */
export const setDocIdentity = tenantMutation({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    docType: vdFields.docType,
    identityLine: v.string(),
  },
  handler: async (ctx, { vaultDocId, docType, identityLine }): Promise<{ ok: boolean }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return { ok: false }; // tenant guard / already gone
    await ctx.db.patch(vaultDocId, {
      // `?? doc.docType`, never a bare `docType`: the schema field is optional, so the derived
      // validator accepts an omitted one, and Convex reads an explicit `undefined` in a patch as a
      // field DELETE — which would silently un-classify the row the user just named.
      docType: docType ?? doc.docType,
      identityLine: sanitizeIdentityLine(identityLine),
      identityUserSet: true,
    });
    return { ok: true };
  },
});

// ── Read plane (browse / stats / download / detail / search) — VALT-04 ────────
// All CHEAP metadata reads off `vaultDocuments` (no vectors); vaultSearch is the ONE surface that
// reuses the same `rag.search` hybrid primitive as vaultGround ("one surface, two callers").

/**
 * THE one bounded read of a tenant's `vaultDocuments` partition (15.3-02). Both browse surfaces go
 * through it, so the ceiling is stated once and cannot drift between the grid and the stat tiles.
 *
 * WHY IT EXISTS: `listVaultDocs` and `vaultStats` each used to `.collect()` the whole partition.
 * Convex has NO projection — reading a row reads the whole row, including a `text` blob of up to
 * VAULT_EXTRACT_CHAR_CAP (400,000) chars — so ~40 max-size rows already exhaust the 16 MiB
 * per-transaction read cap and the vault page hard-fails. Folder ingest does not cause that defect,
 * it merely reaches it on day one.
 *
 * A row cap alone would NOT fix it (200 × 400 KB is ~80 MB), so this streams the index and stops on
 * whichever bound hits first — VAULT_GRID_PAGE rows or VAULT_GRID_READ_BUDGET_BYTES of text. The
 * page therefore always renders; it renders fewer cards when the documents are enormous.
 *
 * `capped` is true when the stream stopped early, i.e. there is more behind the window. It is what
 * lets the stats tiles say "200+" instead of quietly reporting a wrong exact number.
 *
 * ponytail: a newest-first WINDOW, not pagination — a tenant with more documents than fit sees the
 * newest ones. Upgrade path in ascending cost: (1) `.paginate()` with a cursor, which the grid can
 * adopt with no change to what this returns; (2) move `text` to a side table keyed by docId, the
 * only change that makes a whole-partition read cheap again — a real migration, deliberately out of
 * scope for this phase.
 */
async function readVaultPage(
  ctx: QueryCtx,
  tenantId: string,
  folderId?: Id<"vaultFolders">,
): Promise<{ rows: Doc<"vaultDocuments">[]; capped: boolean }> {
  // A lenient join by construction: cancel DELETES the vaultFolders row, so an unresolvable
  // folderId simply matches nothing here rather than meaning "missing folder".
  const stream = folderId
    ? ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_folder", (q) =>
          q.eq("tenantId", tenantId).eq("folderId", folderId),
        )
        .order("desc")
    : ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .order("desc");

  const rows: Doc<"vaultDocuments">[] = [];
  let textBytes = 0;
  for await (const row of stream) {
    if (rows.length >= VAULT_GRID_PAGE || textBytes >= VAULT_GRID_READ_BUDGET_BYTES) {
      return { rows, capped: true };
    }
    rows.push(row);
    textBytes += row.text?.length ?? 0;
  }
  return { rows, capped: false };
}

/**
 * The browse projection — every field the vault surface actually consumes, and **NEVER `text`**.
 * `ownedDocsMeta` below is the shipped refs-only precedent; this is the same rule applied to the
 * whole grid row. The `text` blob is what made the read unbounded AND over-exposed raw content to
 * the browser (§4): a card, a status pill and a size never needed it. One document's text is
 * available on demand through `vaultDocText`.
 *
 * `tenantId` and `contentHash` are deliberately absent too — the query is already tenant-scoped by
 * the wrapper (§2), and the dedup key is not the browser's business.
 */
function projectVaultDoc(d: Doc<"vaultDocuments">) {
  return {
    _id: d._id,
    _creationTime: d._creationTime,
    title: d.title,
    kind: d.kind,
    category: d.category,
    source: d.source,
    mimeType: d.mimeType,
    size: d.size,
    status: d.status,
    failureReason: d.failureReason,
    extractionTruncated: d.extractionTruncated,
    origin: d.origin,
    createdAt: d.createdAt,
    storageId: d.storageId,
    ragEntryId: d.ragEntryId,
    folderId: d.folderId,
    docType: d.docType,
    identityLine: d.identityLine,
    identityUserSet: d.identityUserSet,
  };
}

/**
 * The tenant's vault documents as PROJECTED metadata (cheap, no vectors, no `text`), bounded by
 * `readVaultPage`, optionally scoped to one folder and/or filtered to a single category.
 *
 * ponytail: the category filter runs over the bounded window, not the partition — there is no
 * (tenantId, category) index and `schema.ts` is closed for this phase, so a tenant past the window
 * can see fewer rows on a narrow tab than exist. Upgrade path: a `by_tenant_category` index, or
 * folder drill-in (which is why `folderId` is an arg here rather than a client-side filter).
 */
export const listVaultDocs = tenantQuery({
  args: { category: v.optional(v.string()), folderId: v.optional(v.id("vaultFolders")) },
  handler: async (ctx, { category, folderId }) => {
    const { rows } = await readVaultPage(ctx, ctx.tenantId, folderId);
    const docs = rows.map(projectVaultDoc);
    return category ? docs.filter((d) => d.category === category) : docs;
  },
});

/**
 * ONE document's stored text — the on-demand companion to the projected `listVaultDocs`.
 *
 * The preview pane, the onboarding intake poll and the dropped-brief banner each need the text of
 * exactly ONE document. Shipping it on every grid row to serve those three was the whole read-cap
 * defect. Fail-closed cross-tenant by returning `null` rather than throwing — the `docContext`
 * rule: a throw would distinguish "not yours" from "no such document" (an ownership oracle).
 *
 * `status` rides along because every caller branches on it (a `failed` row has no text coming), and
 * a second subscription for one adjacent field would be silly.
 */
export const vaultDocText = tenantQuery({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (
    ctx,
    { vaultDocId },
  ): Promise<{ text: string | null; status: string } | null> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return null;
    return { text: doc.text ?? null, status: doc.status };
  },
});

/**
 * The 4 browse stats, DERIVED from the same bounded window the grid reads: TOTAL FILES, PROCESSED
 * (status === "ready"), STORAGE USED (Σ size), CATEGORIES (the fixed 6).
 *
 * THE CONTRACT: **the stats tiles must never be the reason the page fails to load.** That is why
 * they are computed off `readVaultPage` rather than a `.collect()` — and why `capped` exists. An
 * honest "200+" beats an exact figure that throws; a maintained counter row would be exact, but it
 * needs a schema field and `schema.ts` is closed for this phase.
 */
export const vaultStats = tenantQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    totalFiles: number;
    processed: number;
    storageUsedBytes: number;
    categories: number;
    capped: boolean;
  }> => {
    const { rows, capped } = await readVaultPage(ctx, ctx.tenantId);
    return {
      totalFiles: rows.length,
      processed: rows.filter((d) => d.status === "ready").length,
      storageUsedBytes: rows.reduce((sum, d) => sum + d.size, 0),
      categories: VAULT_CATEGORIES.length, // the fixed 6
      capped, // true ⇒ the numbers above describe the newest window, not the whole vault
    };
  },
});

/**
 * A short-lived signed download URL for a doc's original bytes. Mirrors `plans.ts attachmentUrls`:
 * the URL is a bearer capability, so it is returned ONLY to the owning tenant (cross-tenant / missing
 * → null) and NEVER logged (§4). Null when the doc has no stored bytes (a paste/brain-dump).
 */
export const vaultDownloadUrl = tenantQuery({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }): Promise<string | null> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return null; // never leak another tenant's URL
    return doc.storageId ? await ctx.storage.getUrl(doc.storageId) : null;
  },
});

/**
 * The graph entities extracted from THIS doc (the detail panel). Owner-guarded (cross-tenant →
 * empty). Reads the doc's edges (by_tenant_source) and resolves their endpoint nodes. Refs-only —
 * carries node type/name + edge rel, never raw document text (§4).
 */
export const docEntities = tenantQuery({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (
    ctx,
    { vaultDocId },
  ): Promise<{
    nodes: { _id: Id<"graphNodes">; type: string; name: string }[];
    edges: {
      _id: Id<"graphEdges">;
      fromNodeId: Id<"graphNodes">;
      toNodeId: Id<"graphNodes">;
      rel: string;
    }[];
  }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return { nodes: [], edges: [] };

    const edges = await ctx.db
      .query("graphEdges")
      .withIndex("by_tenant_source", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("sourceDocId", vaultDocId),
      )
      .collect();

    const nodeIds = new Set<Id<"graphNodes">>();
    for (const e of edges) {
      nodeIds.add(e.fromNodeId);
      nodeIds.add(e.toNodeId);
    }
    const nodes: { _id: Id<"graphNodes">; type: string; name: string }[] = [];
    for (const id of nodeIds) {
      const n = await ctx.db.get(id);
      if (n) nodes.push({ _id: n._id, type: n.type, name: n.name });
    }
    return {
      nodes,
      edges: edges.map((e) => ({
        _id: e._id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        rel: e.rel,
      })),
    };
  },
});

/**
 * The browse search box — the SAME `rag.search` hybrid primitive vaultGround uses, post-filtered to
 * the active folder and category tab. Tenant-scoped via `namespace = tenantId` plus the dedicated
 * `ownedSearchDocsMeta` resolve, so another tenant's doc never appears and a foreign/missing folder
 * silently matches nothing. `rag.search` is action-only (Pitfall 1) → `tenantAction`. The SMOKE::
 * seam bypasses the embedding network exactly as vaultGround's does.
 */
export const vaultSearch = tenantAction({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    folderId: v.optional(v.id("vaultFolders")),
  },
  handler: async (
    ctx,
    { query, category, folderId },
  ): Promise<{ _id: Id<"vaultDocuments">; title: string; category: string }[]> => {
    let candidateIds: Id<"vaultDocuments">[];
    if (query.startsWith("SMOKE::")) {
      candidateIds = query
        .slice("SMOKE::".length)
        .split(",")
        .filter(Boolean) as Id<"vaultDocuments">[];
    } else {
      const { entries } = await rag.search(ctx, {
        namespace: ctx.tenantId,
        query,
        limit: 8,
        searchType: "hybrid",
        vectorScoreThreshold: 0.2,
      });
      candidateIds = entries
        .map((e) => e.metadata?.vaultDocId as Id<"vaultDocuments"> | undefined)
        .filter((id): id is Id<"vaultDocuments"> => Boolean(id));
    }
    // Resolve tenant-owned metadata and validate an optional folder scope without exposing whether
    // that folder exists. The shared grounding resolver stays byte-for-byte unchanged because its
    // results are consumed index-parallel with titles.
    const owned = await ctx.runQuery(internal.vault.ownedSearchDocsMeta, {
      tenantId: ctx.tenantId,
      docIds: candidateIds,
      folderId,
    });
    // SEALING (VALT-07), site 2 of 3. The same predicate the agent's grounding applies — without it
    // the browse search surfaces documents the agent cannot see, which reads as a bug in whichever
    // of the two surfaces the user happens to check second. Applied HERE and not inside
    // `ownedDocsMeta`: `vaultGroundHydrated` keeps a titles array index-parallel to its docIds, so
    // silently dropping rows in the shared resolver would desync titles from documents.
    const sealed = new Set(
      await ctx.runQuery(internal.vaultFolders.sealedDocIds, {
        tenantId: ctx.tenantId,
        docIds: owned.map((d) => d._id),
      }),
    );
    const visible = owned.filter((d) => !sealed.has(d._id));
    const scoped = folderId ? visible.filter((d) => d.folderId === folderId) : visible;
    const matching = category ? scoped.filter((d) => d.category === category) : scoped;
    // `folderId` is resolver-only metadata; preserve the public refs-only return shape exactly.
    return matching.map(({ _id, title, category: resultCategory }) => ({
      _id,
      title,
      category: resultCategory,
    }));
  },
});

// ── Internal lifecycle (workflow-only) ────────────────────────────────────────

/**
 * The canonical doc-text reader the ingest embed step uses (supersedes vaultLlm.getDocText).
 * Fail-closed on a cross-tenant / missing read — a model/embedding call structurally cannot obtain
 * another tenant's text (VALT-03 isolation). Returns the raw fields the embed step needs.
 */
export const getDoc = internalQuery({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (
    ctx,
    { vaultDocId, tenantId },
  ): Promise<{ text: string; contentHash: string; title: string }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== tenantId) throw new Error("vault: doc not found");
    return { text: doc.text ?? "", contentHash: doc.contentHash, title: doc.title };
  },
});

/**
 * Resolve a set of doc ids to their {_id, title, category}, KEEPING ONLY the ones this tenant owns.
 * The tenant-scope seam shared by the offline grounding SMOKE path (vaultGround) and vaultSearch —
 * a cross-tenant / missing id silently drops out, mirroring how `namespace = tenantId` would never
 * surface another tenant's entry (VALT-03 isolation). Carries no raw text (§4).
 */
export const ownedDocsMeta = internalQuery({
  args: { tenantId: v.string(), docIds: v.array(v.id("vaultDocuments")) },
  handler: async (
    ctx,
    { tenantId, docIds },
  ): Promise<{ _id: Id<"vaultDocuments">; title: string; category: string }[]> => {
    const out: { _id: Id<"vaultDocuments">; title: string; category: string }[] = [];
    for (const id of docIds) {
      const doc = await ctx.db.get(id);
      if (doc && doc.tenantId === tenantId) {
        out.push({ _id: doc._id, title: doc.title, category: doc.category });
      }
    }
    return out;
  },
});

/**
 * Search-only candidate metadata. Unlike `ownedDocsMeta`, this carries folder identity so the
 * action can intersect its bounded hybrid candidates after tenant ownership and sealing. When a
 * folder scope is supplied, validate it against the tenant first and return the same empty result
 * for both a missing row and another tenant's row (no ownership oracle). Candidate order and
 * duplicates are preserved exactly.
 */
export const ownedSearchDocsMeta = internalQuery({
  args: {
    tenantId: v.string(),
    docIds: v.array(v.id("vaultDocuments")),
    folderId: v.optional(v.id("vaultFolders")),
  },
  handler: async (
    ctx,
    { tenantId, docIds, folderId },
  ): Promise<
    {
      _id: Id<"vaultDocuments">;
      title: string;
      category: string;
      folderId?: Id<"vaultFolders">;
    }[]
  > => {
    if (folderId) {
      const folder = await ctx.db.get(folderId);
      if (!folder || folder.tenantId !== tenantId) return [];
    }

    const out: {
      _id: Id<"vaultDocuments">;
      title: string;
      category: string;
      folderId?: Id<"vaultFolders">;
    }[] = [];
    for (const id of docIds) {
      const doc = await ctx.db.get(id);
      if (doc && doc.tenantId === tenantId) {
        out.push({
          _id: doc._id,
          title: doc.title,
          category: doc.category,
          folderId: doc.folderId,
        });
      }
    }
    return out;
  },
});

/**
 * Terminal success: the doc is embedded + extracted → groundable.
 *
 * Clears `failureReason` so a row that succeeded stops reporting a PREVIOUS attempt's error. It is
 * the backstop half — `markExtracting` is where a new attempt normally drops the old state — but it
 * is still needed because the late-text `docId` seam in `vaultIngestText` reaches
 * `processing` → `markReady` WITHOUT passing through `markExtracting`, so a previously-failed doc
 * rescued that way would otherwise keep its stale reason.
 *
 * DELIBERATE DIVERGENCE from 15.2-CONTEXT.md, which reads "markReady clears failureReason +
 * extractionTruncated": clearing `extractionTruncated` HERE is a defect. It is written by
 * `ingestExtractedText` on the CURRENT attempt (below), moments before the ingest workflow reaches
 * this mutation — so clearing it here would erase a TRUE truncation flag on every successful
 * large-document ingest, and that flag is what tells a downstream consumer (voiceDoc's digest,
 * voiceToken's readiness check) that the grounded text is only a head slice. The user-visible
 * intent is fully satisfied by clearing `failureReason` here and clearing BOTH at `markExtracting`.
 * Pinned by "markReady does NOT clear a TRUE extractionTruncated" in vault.test.ts.
 */
export const markReady = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments"), ragEntryId: v.string() },
  handler: async (ctx, { vaultDocId, ragEntryId }) => {
    const before = await ctx.db.get(vaultDocId);
    if (!before) return; // deleted mid-flight — `patch` on a missing id throws
    await ctx.db.patch(vaultDocId, { status: "ready", ragEntryId, failureReason: undefined });
    await countTerminal(ctx, before, false);
  },
});

/** Terminal failure: a governed stop or a step error marks the row failed with a refs-only reason. */
export const markFailed = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments"), reason: v.string() },
  handler: async (ctx, { vaultDocId, reason }) => {
    const before = await ctx.db.get(vaultDocId);
    if (!before) return;
    await ctx.db.patch(vaultDocId, { status: "failed", failureReason: reason });
    await countTerminal(ctx, before, true);
  },
});

/**
 * The classifier's write (VALT-12), called by the `classifyDoc` step of the ingest workflow.
 *
 * **THE USER'S LABEL WINS, AND THAT IS AN ABSENCE, NOT A RULE.** There is deliberately NO branch in
 * this function — or anywhere else in the codebase — that writes `docType`/`identityLine` over a row
 * with `identityUserSet === true`. That absence is the guarantee, in the exact sense
 * `packages/core/src/blueprint.ts:356-374` records for `mergeBlueprint`: a precedence rule in a
 * prompt is a request, a function with no overwrite branch is a guarantee. The classifier is never
 * told what the user typed and is never asked to preserve it.
 *
 * It is load-bearing because re-classification of an already-corrected document is REACHABLE, not
 * hypothetical: `vault.ingestExtractedText` and `vaultSweep.retryExtraction` both restart `ingestDoc`
 * on an EXISTING row, so a corrected label meets a fresh classifier run every time a user retries a
 * document. A wrong guess left standing would be a permanent lie in the grounding corpus.
 *
 * NOT a terminal event, so it deliberately does NOT call `countTerminal` — the label is cosmetic and
 * must never move a folder's read/unread manifest. A missing row is a silent no-op for the same
 * reason `markReady` early-returns: a throw here would exhaust the step's retries and fail the whole
 * document (embedding and graph included) for a label.
 */
export const applyClassification = internalMutation({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    tenantId: v.string(),
    docType: vdFields.docType,
    identityLine: v.string(),
  },
  handler: async (ctx, { vaultDocId, tenantId, docType, identityLine }): Promise<null> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== tenantId) return null; // deleted mid-flight / cross-tenant
    if (doc.identityUserSet === true) return null;
    await ctx.db.patch(vaultDocId, {
      docType: docType ?? doc.docType, // an explicit `undefined` in a patch DELETES the field
      // Model output is untrusted too, and it lands in the same digest prompt field the user's own
      // line does — one sanitiser, both writers.
      identityLine: sanitizeIdentityLine(identityLine),
    });
    return null;
  },
});

/**
 * The ONE folder hook, in the ONE pair of handlers that terminate every rail — extract fail,
 * transcribe fail, unsupported_format, pii_scan_failed, empty_extraction, watchdogStalled,
 * onIngestComplete's failed arm, and workflow success. Nine call sites, one place.
 *
 * ⚠ IT TAKES THE PRIOR ROW, NOT THE ID, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT. Neither writer
 * is idempotent (both are a bare `patch`) and a workflow mutation whose journal write fails is
 * re-run, so a post-state test ("is it terminal now?") is TRUE on every replay and would count the
 * same member twice. Counting only the non-terminal → terminal TRANSITION is what makes "a folder
 * reaches complete exactly once" hold under replay.
 *
 * A counter, not a status-index probe over `by_tenant_folder`: O(1), and it never reads a `text`
 * blob — the schema's own warning is that ~40 max-size member rows exhaust the 16 MiB read cap.
 * The one extra read this costs (`ctx.db.get` on the doc, whole row, `text` included) is
 * unavoidable — Convex has no projection and `folderId` cannot be learned any other way.
 *
 * THE OTHER HALF OF THIS FUNCTION LIVES IN `vaultSweep.retryExtraction`. Retry un-terminalises a
 * `failed` row, and because the transition guard above reads the PRIOR status, that row would be
 * counted a second time on its next terminal event — completing the folder EARLY, over members
 * still in flight (settle while they must still spend, seal lifted, digest over a partial folder).
 * The CAS stops a second completion, never an early one. So retry calls `unbumpFolder`, which is
 * this counter's exact inverse and is guarded to the `ingesting` window. What remains known and
 * accepted is only the historical case: a folder that has already COMPLETED keeps its `failedCount`
 * if the user later rescues a member by hand — its digest was built from those numbers.
 */
async function countTerminal(
  ctx: MutationCtx,
  before: Doc<"vaultDocuments">,
  failed: boolean,
): Promise<void> {
  if (!before.folderId) return;
  if (before.status === "ready" || before.status === "failed") return; // already counted
  await bumpFolder(ctx, before.folderId, failed);
}

// ── Phase-3.8 extraction lifecycle (Wave-0 seam — called by vaultExtract/vaultTranscribe) ─────

/**
 * The extraction action flips the visible pill when work actually starts (honest pill).
 *
 * This is ALSO where the previous attempt's state dies, because this runs at the START of every
 * attempt (vaultExtract.ts / vaultTranscribe.ts, before any parsing): a new attempt has neither a
 * failure nor a truncation yet, so carrying either forward would report the last attempt's outcome
 * against this one.
 *
 * AND IT IS WHERE THE WATCHDOG IS ARMED (15.3-04, CONTEXT §B2). It used to be armed by
 * `scheduleExtraction`, i.e. when the attempt was QUEUED, which at folder scale marks healthy
 * queued documents `extraction_stalled`. This mutation is the ONE point every extraction rail
 * passes through when work actually starts — `vaultExtract.extractDoc:321` and
 * `vaultTranscribe.transcribeDoc:67` are its only non-test callers, and `scheduleExtraction` can
 * only ever dispatch those two — so no rail loses its backstop by the move.
 *
 * ponytail: the armed watchdog's scheduled-function id is NOT persisted, so arms accumulate (one
 * per attempt, and a Retry is another attempt). Every fire is status-idempotent, so extras are
 * harmless. Upgrade path if the volume ever matters: store the id on the row and cancel it, the
 * `voice.ts` `watchdogFnId` pattern — which needs a schema field this phase does not have.
 */
export const markExtracting = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }): Promise<{ ok: boolean }> => {
    // THE CANCEL GATE, and the only place a cancelled folder's queued work is actually stopped.
    // `vaultFolders.cancelFolder` deletes the folder row and writes nothing to any document, so a
    // member whose `folderId` no longer resolves was cancelled mid-flight. Refusing to start here
    // is what "cancel means no NEW spend" actually costs: one `db.get` per attempt, folder-scoped
    // and tenant-scoped by construction. See cancelFolder for why `pool.cancelAll` is not usable.
    // The row is failed rather than left at `pending_extraction`: it is a real, honest outcome
    // (the work was killed) and it is terminal, so nothing parks silently.
    // ⚠ THE DANGLING ID IS DROPPED BY RETRY, NOT HERE, and that is what makes "cancelled documents
    // become ordinary documents" true rather than a claim: this gate is unconditional, so a member
    // whose folder is gone would otherwise be refused on EVERY attempt for ever —
    // retry → pending_extraction → scheduleExtraction → markExtracting → failed(folder_cancelled),
    // a loop the user can never win. `vaultSweep.retryExtraction` resolves `folderId` and patches
    // it away when it resolves to nothing, so the retried row arrives here folder-less.
    const doc = await ctx.db.get(vaultDocId);
    if (doc?.folderId && !(await ctx.db.get(doc.folderId))) {
      await ctx.runMutation(internal.vault.markFailed, {
        vaultDocId,
        reason: "folder_cancelled",
      });
      return { ok: false };
    }

    await ctx.db.patch(vaultDocId, {
      status: "extracting",
      failureReason: undefined,
      extractionTruncated: undefined,
    });
    await ctx.scheduler.runAfter(EXTRACTION_WATCHDOG_MS, internal.vaultSweep.watchdogStalled, {
      vaultDocId,
    });
    return { ok: true };
  },
});

/**
 * The INTERNAL seam every extraction lane calls (the public vaultIngestText throws
 * UNAUTHENTICATED for scheduler-invoked actions — Pitfall 3). Mirrors the docId late-text path
 * above: patch text/hash/size, flip to processing, start the ingest workflow. Stores the RAW
 * extracted text (consistent with TXT uploads — the content plane holds the user's own data;
 * scanText at extraction time is the lanes' fail-closed gate + audit-counts source, and every
 * downstream model path re-scans). Fail-closed tenant guard, like getDoc.
 */
/** A profile-shaped doc is recognised by the marker `serializeProfile` always writes. */
const PROFILE_MARKER = "- **Persona:**";
/** Enough to carry a profile's front-matter AND its figures; these docs are small by construction. */
const PROFILE_SEED_CHAR_CAP = 4000;

/**
 * The AUTHORITATIVE seed for a business evaluation: the tenant's own profile-shaped docs.
 *
 * Pure similarity search cannot answer "evaluate MY business". A reference book ABOUT business
 * (e.g. a marketing PDF) out-ranks a two-paragraph description OF a business on generic business
 * vocabulary, and since `rag.search` takes its top-K by CHUNK, one large PDF can occupy every seed
 * slot — observed live: the evaluation's grounding returned exactly ONE doc, a 300-page book, so
 * the engine saw zero facts about the user and reported "not enough data". The user's own profile
 * is authoritative here regardless of its score, so the engine seeds it directly.
 *
 * Cheap by construction: the metadata pre-filter (`business_profile` kind, or markdown) keeps big
 * PDFs out, so this never loads a book's text just to test it for the marker.
 */
export const profileSeedDocs = internalQuery({
  args: { tenantId: v.string() },
  handler: async (
    ctx,
    { tenantId },
  ): Promise<{ docId: string; title: string; text: string }[]> => {
    const rows = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(40);
    return rows
      .filter(
        (d) =>
          d.status === "ready" &&
          !!d.text &&
          (d.kind === "business_profile" || d.mimeType === "text/markdown") &&
          (d.kind === "business_profile" || (d.text ?? "").includes(PROFILE_MARKER)),
      )
      .slice(0, 3)
      .map((d) => ({
        docId: d._id,
        title: d.title,
        text: (d.text ?? "").slice(0, PROFILE_SEED_CHAR_CAP),
      }));
  },
});

/**
 * The cockpit-attachment seam: a file attached in a thread ALSO becomes a vault doc, so it is
 * embedded, graph-extracted, browsable, and able to ground a LATER turn — instead of being
 * one-shot prompt context that vanishes with the thread (the Phase-2/Phase-5 seam; see
 * docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md).
 *
 * An INTERNAL twin of `vaultIngestText` rather than a caller of it: the public mutation throws
 * UNAUTHENTICATED from an action (Pitfall 3, same as `ingestExtractedText` below) and accepts no
 * `storageId`. Explicit `tenantId`, mirroring the `recordScorecardAnswerInternal` precedent —
 * no public tenantMutation is loosened.
 *
 * Stores the RAW extracted text, consistent with every other vault doc; the redacted `safeText`
 * is what `runIntake` merges into the conversation. Hash-dedup means re-attaching a file already
 * in the vault reuses that row — no duplicate, no re-embed, no second embedding spend.
 */
export const ingestFromAttachment = internalMutation({
  args: {
    tenantId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    text: v.string(),
  },
  handler: async (
    ctx,
    { tenantId, storageId, filename, mimeType, size, text },
  ): Promise<{ vaultDocId: Id<"vaultDocuments">; deduped: boolean }> => {
    const hash = await contentHash(text);
    const dup = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) => q.eq("tenantId", tenantId).eq("contentHash", hash))
      .first();
    if (dup) return { vaultDocId: dup._id, deduped: true };

    const source: VaultSource = "upload";
    const vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: filename.slice(0, 80) || "Untitled",
      kind: "upload",
      // categoryFor already routes docs to my-uploads and lets an image/video mimeType win into
      // images/videos — so an attachment lands in the same category as the identical direct upload.
      category: categoryFor({ source, mimeType }),
      source,
      mimeType,
      size,
      contentHash: hash,
      storageId,
      text,
      status: "processing",
      createdAt: Date.now(),
    });
    await startIngest(ctx, { vaultDocId, tenantId, correlationId: crypto.randomUUID() });
    return { vaultDocId, deduped: false };
  },
});

// ── Phase-18 (ACTN-04): the created-artifact write plane ─────────────────────
// Mirrors ingestFromAttachment above — explicit tenantId, internal-only, refs in, one row out.
// The "use node" cockpit action cannot ctx.db.insert, so the tool (plan 18-06) runs through here.

/**
 * Insert ONE agent-authored artifact as a tenant-scoped vault row (SC1).
 *
 * ⛔ THIS MUTATION DELIBERATELY DOES NOT CALL `startIngest`, AND THE ABSENCE *IS* THE FEATURE.
 * A row with no rag entry and no graph nodes is structurally unreachable by BOTH halves of
 * `runVaultGround` (vector search joined on `entry.metadata.vaultDocId`, then the hop-capped graph
 * expand) — so the locked retrieval exclusion needs no filter anywhere, and there is nothing to
 * forget to apply at a future call site. Do NOT "fix" this omission. The shipped precedent is
 * `blueprint.ts` confirmBlueprint, which likewise inserts at `status: "ready"` without ingest.
 * Promotion later = patch `origin` to "agent_promoted" + call the already-exported `startIngest`:
 * a UI addition, not a migration — which is why both literals already exist in the schema.
 *
 * ponytail: the honest cost is that created docs are also invisible to the vault UI's SEARCH box
 * (`vault.vaultSearch` is the same rag primitive), though they DO appear in the browse grid for
 * free — `listVaultDocs` collects the tenant partition with no kind/status/origin filter. Accepted
 * for beta; upgrade path is a ~3-line title-substring fallback in DocGrid's filter. Owner question,
 * raised in plan 18-09's gate.
 *
 * Renders NOTHING: `storageId` (the derived PDF, long-form only) is written STRAIGHT THROUGH from
 * args. The PDF is produced in the tool — pdf-lib is not usable from a non-"use node" mutation.
 */
export const insertCreatedDoc = internalMutation({
  args: {
    tenantId: v.string(),
    title: v.string(),
    form: v.union(v.literal("short"), v.literal("long")),
    markdown: v.string(),
    contentHash: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (
    ctx,
    { tenantId, title, form, markdown, contentHash: hash, storageId },
  ): Promise<Id<"vaultDocuments">> =>
    await ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      // Free-string `kind`. NOT "document" — smoke.ts seedVoiceDocSession already writes that.
      kind: form === "long" ? "created_document" : "created_content",
      category: categoryFor({ source: "agent" }), // → workspace-docs, like every generated doc
      source: "agent",
      // LOCKED: markdown is the artifact of record for BOTH forms. "application/pdf" would land the
      // row at pending_extraction and round-trip it through vaultExtract to recover text we wrote.
      mimeType: "text/markdown",
      size: byteLen(markdown),
      contentHash: hash,
      text: markdown,
      storageId, // absent ⇒ PreviewModal's canDownload is false ⇒ no Download button, for free
      origin: "agent", // the provenance + deferred-promotion discriminator
      status: "ready", // ready WITHOUT ingest — see the block comment above
      createdAt: Date.now(),
    }),
});

/**
 * Revise a created artifact IN PLACE (SC7) — the locked contract: ONE row, latest content wins,
 * patching the SAME `_id`. No version history, no second row, no `versions` field.
 *
 * The `#index → docId` resolution happens INSIDE the mutation, off the per-thread Output-card row,
 * so no raw `_id` ever reaches the model and no extra internalQuery is needed. The model addresses
 * "#1" — it cannot address another tenant's row even by guessing.
 *
 * Refuses with `{ ok: false }`; it never throws. The caller turns a refusal into a sentence.
 * Returns `oldStorageId` so the tool can delete the SUPERSEDED PDF *after* this patch persists
 * (the regenerateAttachment ordering — never orphan a live ref).
 */
export const patchCreatedDoc = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    index: v.number(), // 1-based, straight off the tool arg
    title: v.string(),
    form: v.union(v.literal("short"), v.literal("long")),
    markdown: v.string(),
    contentHash: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, a): Promise<{ ok: false } | { ok: true; oldStorageId?: Id<"_storage"> }> => {
    // ⚠ THE role FILTER IS LOAD-BEARING — do NOT simplify it back to .first(). vaultSources is
    // DUAL-PURPOSE: a grounding row has no `role`, a created row carries role: "created". The table
    // is append-only per thread and by_thread is latest-wins, so a bare .first() returns whatever
    // the LAST turn wrote — one searchVault turn between a create and a revise and docIds[index-1]
    // resolves to a USER-UPLOADED doc, the origin guard below correctly refuses, and the locked
    // "make that one shorter" silently stops working. It fails safe, but it fails.
    const card = (
      await ctx.db
        .query("vaultSources")
        .withIndex("by_thread", (q) => q.eq("tenantId", a.tenantId).eq("threadId", a.threadId))
        .order("desc")
        // ponytail: 20-row window; raise only if a thread can exceed 20 turns between revises.
        .take(20)
    ).find((r) => r.role === "created");

    const docId = card?.docIds[a.index - 1];
    if (!docId) return { ok: false }; // no such #index → the tool returns a sentence

    const doc = await ctx.db.get(docId);
    // BOTH guards, not one: tenant (isolation) AND origin (never let a revise overwrite an UPLOAD,
    // and never silently rewrite a doc the user PROMOTED to reference material).
    if (!doc || doc.tenantId !== a.tenantId || doc.origin !== "agent") return { ok: false };

    const oldStorageId = doc.storageId;
    await ctx.db.patch(docId, {
      title: a.title,
      kind: a.form === "long" ? "created_document" : "created_content",
      text: a.markdown,
      size: byteLen(a.markdown),
      contentHash: a.contentHash,
      storageId: a.storageId, // undefined REMOVES it ⇒ long→short drops the Download button
    });
    return { ok: true, oldStorageId };
  },
});

export const ingestExtractedText = internalMutation({
  args: {
    docId: v.id("vaultDocuments"),
    tenantId: v.string(),
    text: v.string(),
    truncated: v.boolean(),
  },
  handler: async (ctx, { docId, tenantId, text, truncated }): Promise<null> => {
    const doc = await ctx.db.get(docId);
    if (!doc || doc.tenantId !== tenantId) throw new Error("vault: doc not found");
    await ctx.db.patch(docId, {
      text,
      contentHash: await contentHash(text),
      size: byteLen(text),
      status: "processing",
      extractionTruncated: truncated || undefined,
    });
    const correlationId = crypto.randomUUID();
    await startIngest(ctx, { vaultDocId: docId, tenantId, correlationId });
    return null;
  },
});

/**
 * The metadata an extraction action needs BEFORE loading bytes. Fail-closed tenant guard.
 * Bytes are loaded via ctx.storage.get(storageId) INSIDE the action — never passed as args
 * (node-action args cap at 5 MiB; vault files go to 8 MiB).
 */
export const getDocForExtraction = internalQuery({
  args: { vaultDocId: v.id("vaultDocuments"), tenantId: v.string() },
  handler: async (
    ctx,
    { vaultDocId, tenantId },
  ): Promise<{
    storageId: Id<"_storage"> | undefined;
    mimeType: string;
    title: string;
    status: string;
  }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== tenantId) throw new Error("vault: doc not found");
    return {
      storageId: doc.storageId,
      mimeType: doc.mimeType,
      title: doc.title,
      status: doc.status,
    };
  },
});
