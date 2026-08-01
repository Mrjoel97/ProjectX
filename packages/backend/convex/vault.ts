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
  categoryFor,
  EXTRACTION_WATCHDOG_MS,
  isSearchable,
  schedulingRailFor,
  VAULT_CATEGORIES,
  VAULT_FILE_CAP_BYTES,
  VAULT_VIDEO_CAP_BYTES,
  type VaultSource,
} from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { startIngest } from "./vaultIngest";
import { rag } from "./vaultRag";

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

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
 * Every attempt also ARMS A WATCHDOG. That is what makes silent parking impossible rather than
 * merely rarer: format coverage only reduces how often the guarantee is needed. The watchdog is
 * per-attempt (a Retry arms a fresh one) and idempotent, so it cannot kill a racing success — the
 * onIngestComplete pattern. It is a scheduled function, NOT a cron over a table scan: no "status
 * began at" timestamp exists (createdAt is UPLOAD time, and a Retry on a 20-hour-old row would be
 * instantly killed by a createdAt-based cutoff), and no schema change is permitted.
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
  }: { vaultDocId: Id<"vaultDocuments">; tenantId: string; mimeType: string; title?: string },
): Promise<void> {
  const rail = schedulingRailFor(mimeType, title);
  await ctx.scheduler.runAfter(
    0,
    rail === "transcribe" ? internal.vaultTranscribe.transcribeDoc : internal.vaultExtract.extractDoc,
    { vaultDocId, tenantId },
  );
  await ctx.scheduler.runAfter(EXTRACTION_WATCHDOG_MS, internal.vaultSweep.watchdogStalled, {
    vaultDocId,
  });
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
 * File upload ingest with ACCEPT-BUT-DEFER. Oversize is rejected per kind (video > 25 MB, else
 * > 100 MiB). A
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
  },
  handler: async (
    ctx,
    { storageId, filename, mimeType, size, contentHash: hash, text },
  ): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    // Per-kind cap: video is bounded by the transcription API's 25 MB limit; everything else by
    // the 100 MiB storage ceiling. This is the single chokepoint — all video reaches transcribeDoc
    // only through here, so no downstream size guard is needed.
    if (mimeType.startsWith("video/")) {
      if (size > VAULT_VIDEO_CAP_BYTES) throw new Error("vault: video too large (max 25 MB)");
    } else if (size > VAULT_FILE_CAP_BYTES) {
      throw new Error("vault: file too large (max 100 MB)");
    }

    // Hash-dedup: identical bytes for this tenant reuse the existing item (no re-store / re-embed).
    const dup = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("contentHash", hash),
      )
      .first();
    if (dup) return { vaultDocId: dup._id };

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
      status: searchable ? "processing" : "pending_extraction",
      createdAt: Date.now(),
    });
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
    return { vaultDocId };
  },
});

/**
 * Delete a vault document and everything it owns: the row, its rag chunks (deleteAsync — a
 * mutation-safe background cascade), and its graphEdges. Each removed edge decrements both
 * endpoints' degree; a node whose degree hits 0 is GC'd (orphan), a node still shared with another
 * doc survives. Cross-tenant / missing → a no-op (tenant guard). The rag chunks + this row are the
 * only raw-content stores, so this fully removes the document's raw text (§4).
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

    await ctx.db.delete(vaultDocId);
    return { ok: true };
  },
});

// ── Read plane (browse / stats / download / detail / search) — VALT-04 ────────
// All CHEAP metadata reads off `vaultDocuments` (no vectors); vaultSearch is the ONE surface that
// reuses the same `rag.search` hybrid primitive as vaultGround ("one surface, two callers").

/** The tenant's vault documents (cheap, no vectors), optionally filtered to a single category. */
export const listVaultDocs = tenantQuery({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category }) => {
    const docs = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    return category ? docs.filter((d) => d.category === category) : docs;
  },
});

/**
 * The 4 browse stats, all DERIVED from the cheap metadata query (no vectors): TOTAL FILES,
 * PROCESSED (status === "ready"), STORAGE USED (Σ size), CATEGORIES (the fixed 6).
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
  }> => {
    const docs = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    return {
      totalFiles: docs.length,
      processed: docs.filter((d) => d.status === "ready").length,
      storageUsedBytes: docs.reduce((sum, d) => sum + d.size, 0),
      categories: VAULT_CATEGORIES.length, // the fixed 6
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
 * the active category tab (Open-Q1: post-filter on the joined vaultDocuments.category). Tenant-scoped
 * via `namespace = tenantId` + the tenant-scoped `ownedDocsMeta` resolve, so another tenant's doc
 * never appears. `rag.search` is action-only (Pitfall 1) → `tenantAction`. The SMOKE:: seam bypasses
 * the embedding network exactly as vaultGround's does.
 */
export const vaultSearch = tenantAction({
  args: { query: v.string(), category: v.optional(v.string()) },
  handler: async (
    ctx,
    { query, category },
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
    // Resolve tenant-owned metadata, then post-filter to the active category tab.
    const owned = await ctx.runQuery(internal.vault.ownedDocsMeta, {
      tenantId: ctx.tenantId,
      docIds: candidateIds,
    });
    return category ? owned.filter((d) => d.category === category) : owned;
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
    await ctx.db.patch(vaultDocId, { status: "ready", ragEntryId, failureReason: undefined });
  },
});

/** Terminal failure: a governed stop or a step error marks the row failed with a refs-only reason. */
export const markFailed = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments"), reason: v.string() },
  handler: async (ctx, { vaultDocId, reason }) => {
    await ctx.db.patch(vaultDocId, { status: "failed", failureReason: reason });
  },
});

// ── Phase-3.8 extraction lifecycle (Wave-0 seam — called by vaultExtract/vaultTranscribe) ─────

/**
 * The extraction action flips the visible pill when work actually starts (honest pill).
 *
 * This is ALSO where the previous attempt's state dies, because this runs at the START of every
 * attempt (vaultExtract.ts / vaultTranscribe.ts, before any parsing): a new attempt has neither a
 * failure nor a truncation yet, so carrying either forward would report the last attempt's outcome
 * against this one.
 */
export const markExtracting = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments") },
  handler: async (ctx, { vaultDocId }) => {
    await ctx.db.patch(vaultDocId, {
      status: "extracting",
      failureReason: undefined,
      extractionTruncated: undefined,
    });
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
