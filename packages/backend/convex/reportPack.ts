"use node";

// RPRT-01 — the board pack (plan 26-16): ONE immutable capture, rendered by the shipped PDF
// renderer and landed through the shipped non-groundable created-artifact door.
//
// "use node" for exactly one reason: `markdownToPdf` lives in `llm.ts`, which imports `node:crypto`
// at top level, so any module importing it must be a node module. `dispatch.ts` is the shipped
// precedent for the same constraint. A node module may hold ONLY actions — which is why the DB half
// (the capture internalQuery and the landing internalMutation) is the sibling `reportPackData.ts`,
// the `media.ts` / `mediaComplete.ts` split.
//
// Nothing here is a second mechanism. The window contract is `resolveDashboardWindow`, the reads
// are the 26-14/26-15 planes, the markdown is `@pikar/core`'s pure builder, the renderer is
// `markdownToPdf`, the row is `vault.insertCreatedDoc`, the hash is `lib/hash`, and the log is the
// insert-only `audit.log`. This file contains NO `.patch`, `.replace` or `.delete` against any
// table and NO ingest door — both scanned by `reportPack.test.ts`, because they are what make
// "a generated pack is immutable and non-groundable" a property of the code.
import { buildBoardPackMarkdown, formatSpec, resolveDashboardWindow } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { markdownToPdf } from "./llm";
import { MAX_WINDOW_MS } from "./reportsBusiness";

export type GenerateBoardPackResult =
  | {
      ok: true;
      vaultDocId: Id<"vaultDocuments">;
      replayed: boolean;
      asOf: number;
      window: {
        sinceMs: number;
        untilMs: number;
        timeZone: string;
        timeZoneSource: "tenant" | "browser-fallback";
      };
      bytes: number;
      partialSections: number;
    }
  | { ok: false; reason: "window_invalid" | "render_failed" };

/**
 * Render the markdown to PDF bytes and stage them in storage — or say it failed, having stored
 * nothing.
 *
 * A render failure must leave NO artifact behind: a partial or empty PDF stored under the tenant is
 * worse than no pack, because a Download button that yields a broken file reads as a working
 * feature. `markdownToPdf` already wraps its whole render so any throw becomes a rejection; this
 * catches that rejection BEFORE `ctx.storage.store` runs.
 *
 * ponytail: `render` is a DEFAULT PARAMETER, not a runtime flag and not a request field — it is the
 * seam the failure test drives, and no request can reach it (the public args are two numbers and an
 * IANA-validated timezone). Upgrade path if a real second renderer ever lands: make it an explicit
 * argument at the one call site rather than a config lookup.
 */
export async function renderAndStorePack(
  ctx: { storage: { store(blob: Blob): Promise<Id<"_storage">> } },
  title: string,
  markdown: string,
  render: (t: string, m: string) => Promise<Uint8Array> = markdownToPdf,
): Promise<{ ok: true; storageId: Id<"_storage">; bytes: number } | { ok: false }> {
  try {
    // ponytail: cast — a Uint8Array IS a valid BlobPart at runtime; the DOM lib types
    // Uint8Array<ArrayBufferLike> too strictly (it may be SharedArrayBuffer-backed).
    const bytes = (await render(title, markdown)) as Uint8Array;
    const { mimeType } = formatSpec("pdf"); // the ONE place the PDF MIME literal is written
    const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: mimeType }));
    return { ok: true, storageId, bytes: bytes.byteLength };
  } catch (error) {
    // Refs-only, and the NAME only: a render error carries no user content (§4), and a bare catch
    // here would make a hard failure read as a feature that "just didn't manage it".
    console.error(`[reportPack] render failed: ${(error as Error)?.name ?? "unknown"}`);
    return { ok: false };
  }
}

/**
 * Generate this tenant's board pack for one window.
 *
 * THE ORDER IS LOAD-BEARING:
 *  1. validate the window HERE, in its own try — so a DB failure three steps later can never be
 *     reported to the caller as "you asked for a bad window";
 *  2. ONE `runQuery` — the capture. The only one in this file, and the atomicity claim;
 *  3. build the markdown from the captured VALUE, never from a re-read;
 *  4. hash the markdown — that hash is the replay key;
 *  5. render + store, or refuse having stored nothing;
 *  6. land it (dedup and insert in one transaction);
 *  7. delete the orphan blob if this turned out to be a replay;
 *  8. audit refs-only, and only because an artifact exists.
 *
 * `tenantId` comes from `ctx` at every step and is never an argument. A caller-supplied tenant
 * would let any authenticated tenant render another tenant's pack — the question is not what this
 * function checks but what it TRUSTS.
 *
 * There is deliberately no kill switch and no `generation_disabled` reason: a refusal nothing can
 * produce is a lie in a discriminated union. Rollback is 26-17's route/nav gate, or reverting this
 * module; existing packs are ordinary vault rows nothing on this rail rewrites.
 */
export const generateBoardPack = tenantAction({
  args: { sinceMs: v.number(), untilMs: v.number(), browserTimeZone: v.string() },
  handler: async (ctx, args): Promise<GenerateBoardPackResult> => {
    // ponytail: the window is resolved TWICE — once here for the governed refusal, once inside the
    // snapshot query so that query stays self-sufficient. Deterministic and free; the alternative
    // (passing the resolved window as an argument) makes the internalQuery trust its caller.
    try {
      resolveDashboardWindow({ ...args, maxSpanMs: MAX_WINDOW_MS });
    } catch {
      return { ok: false, reason: "window_invalid" };
    }

    const snap = await ctx.runQuery(internal.reportPackData.snapshot, {
      tenantId: ctx.tenantId,
      sinceMs: args.sinceMs,
      untilMs: args.untilMs,
      browserTimeZone: args.browserTimeZone,
    });

    const { title, markdown, partialSections } = buildBoardPackMarkdown(snap);
    const hash = await contentHash(markdown);

    const rendered = await renderAndStorePack(ctx, title, markdown);
    if (!rendered.ok) return { ok: false, reason: "render_failed" };

    const landed = await ctx.runMutation(internal.reportPackData.landPack, {
      tenantId: ctx.tenantId,
      title,
      markdown,
      contentHash: hash,
      storageId: rendered.storageId,
    });

    // The dedup is decided INSIDE the transaction, so the blob we had already staged is cleaned up
    // here rather than pre-checked in a second roundtrip that could not close the race anyway.
    if (landed.replayed) await ctx.storage.delete(rendered.storageId);

    // THE CALLER AUDITS. The vault content plane is log-free BY CONSTRUCTION —
    // `vaultRedaction.test.ts` scans `vault.ts` for any audit call, because that module is where
    // raw document text lives and a carefully-shaped payload there is one careless edit away from
    // carrying `doc.title`. The precedents are `llm.ts`'s `document.created` and `contentAudit`'s
    // `vault.promoted`. This is also the only place that knows the byte length.
    // Refs, ids, counts, the window and the result — nothing else (§4).
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: `report:pack:${landed.vaultDocId}`,
      eventType: "report.pack_generated",
      actor: "system",
      payload: {
        vaultDocId: String(landed.vaultDocId),
        packHash: hash,
        sinceMs: snap.window.sinceMs,
        untilMs: snap.window.untilMs,
        timeZone: snap.window.timeZone,
        timeZoneSource: snap.window.timeZoneSource,
        result: landed.replayed ? "replayed" : "generated",
        bytes: rendered.bytes,
        partialSections,
        sentCount: snap.operations.delivery.sentCount,
        reviewCount: snap.operations.review.terminals,
        deadLetterCount: snap.operations.deadLetters.openNow,
        feedbackCount: snap.operations.feedback.rated,
        auditRowCount: snap.audit.rows.length,
      },
    });

    return {
      ok: true,
      vaultDocId: landed.vaultDocId,
      replayed: landed.replayed,
      asOf: snap.asOf,
      window: snap.window,
      bytes: rendered.bytes,
      partialSections,
    };
  },
});
