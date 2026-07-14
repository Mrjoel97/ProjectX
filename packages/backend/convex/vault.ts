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
// This module is the ingest workflow's SOLE starter (the vault plane's zero-embed-before-accept
// invariant, mirroring executePlan for delivery).
import type { EntryId } from "@convex-dev/rag";
import { categoryFor, isSearchable, VAULT_FILE_CAP_BYTES, type VaultSource } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { workflow } from "./index";
import { contentHash } from "./lib/hash";
import { tenantMutation } from "./lib/functions";
import { rag } from "./vaultRag";

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

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
  handler: async (ctx, { text, title, source, docId }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const hash = await contentHash(text);

    // Late-text arrival: a pre-existing (pending_extraction) row gets its text + hash, then ingests.
    if (docId) {
      const existing = await ctx.db.get(docId);
      if (!existing || existing.tenantId !== ctx.tenantId) throw new Error("vault: doc not found");
      await ctx.db.patch(docId, { text, contentHash: hash, size: byteLen(text), status: "processing" });
      const correlationId = crypto.randomUUID();
      await workflow.start(ctx, internal.vaultIngest.ingestDoc, {
        vaultDocId: docId,
        tenantId: ctx.tenantId,
        correlationId,
      });
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
    await workflow.start(ctx, internal.vaultIngest.ingestDoc, {
      vaultDocId,
      tenantId: ctx.tenantId,
      correlationId,
    });
    return { vaultDocId };
  },
});

/**
 * File upload ingest with ACCEPT-BUT-DEFER. Oversize (> VAULT_FILE_CAP_BYTES) is rejected. A
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
    if (size > VAULT_FILE_CAP_BYTES) throw new Error("vault: file too large");

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
      await workflow.start(ctx, internal.vaultIngest.ingestDoc, {
        vaultDocId,
        tenantId: ctx.tenantId,
        correlationId,
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
      if (newDegree <= 0) await ctx.db.delete(nodeId); // orphan GC
      else await ctx.db.patch(nodeId, { degree: newDegree });
    }

    await ctx.db.delete(vaultDocId);
    return { ok: true };
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

/** Terminal success: the doc is embedded + extracted → groundable. */
export const markReady = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments"), ragEntryId: v.string() },
  handler: async (ctx, { vaultDocId, ragEntryId }) => {
    await ctx.db.patch(vaultDocId, { status: "ready", ragEntryId });
  },
});

/** Terminal failure: a governed stop or a step error marks the row failed with a refs-only reason. */
export const markFailed = internalMutation({
  args: { vaultDocId: v.id("vaultDocuments"), reason: v.string() },
  handler: async (ctx, { vaultDocId, reason }) => {
    await ctx.db.patch(vaultDocId, { status: "failed", failureReason: reason });
  },
});
