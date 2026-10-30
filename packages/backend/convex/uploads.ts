import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { contentHash } from "./lib/hash";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const TICKET_TTL_MS = 15 * 60 * 1000;

export function boundedUploadBody(body: ReadableStream<Uint8Array>, maximum = MAX_UPLOAD_BYTES) {
  let bytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maximum) throw new Error("UPLOAD_SIZE_INVALID");
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Preserve the URL contract, but only the server observes the underlying storage response. */
export async function issueUpload(ctx: MutationCtx & { tenantId: string }) {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("UPLOAD_ENDPOINT_NOT_CONFIGURED");
  const token = crypto.randomUUID() + crypto.randomUUID();
  await ctx.db.insert("uploadReceipts", {
    tenantId: ctx.tenantId,
    ticketHash: await contentHash(token),
    expiresAt: Date.now() + TICKET_TTL_MS,
    state: "issued",
  });
  return `${site}/uploads?ticket=${encodeURIComponent(token)}`;
}

export async function assertOwnedUpload(
  ctx: QueryCtx,
  tenantId: string,
  storageId: Id<"_storage">,
) {
  const receipt = await ctx.db
    .query("uploadReceipts")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
  if (
    !receipt ||
    receipt.tenantId !== tenantId ||
    receipt.state !== "complete" ||
    receipt.expiresAt < Date.now()
  )
    throw new Error("UPLOAD_NOT_OWNED");
  return receipt;
}

export async function claimOwnedUpload(
  ctx: MutationCtx,
  tenantId: string,
  storageId: Id<"_storage">,
) {
  const receipt = await assertOwnedUpload(ctx, tenantId, storageId);
  await ctx.db.patch(receipt._id, { expiresAt: Number.MAX_SAFE_INTEGER });
  return receipt;
}

export const bindOwned = internalMutation({
  args: { tenantId: v.string(), storageId: v.id("_storage") },
  handler: (ctx, args) => claimOwnedUpload(ctx, args.tenantId, args.storageId),
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100);
    for (const row of rows) {
      if (row.storageId) await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
    }
    return rows.length;
  },
});

export const requireOwned = internalQuery({
  args: { tenantId: v.string(), storageId: v.id("_storage") },
  handler: (ctx, args) => assertOwnedUpload(ctx, args.tenantId, args.storageId),
});

export const claim = internalMutation({
  args: { ticketHash: v.string() },
  handler: async (ctx, { ticketHash }) => {
    const receipt = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_ticket", (q) => q.eq("ticketHash", ticketHash))
      .unique();
    if (!receipt || receipt.state !== "issued" || receipt.expiresAt < Date.now())
      throw new Error("UPLOAD_TICKET_INVALID");
    await assertTenantWritable(ctx, receipt.tenantId);
    await ctx.db.patch(receipt._id, { state: "uploading" });
    return { receiptId: receipt._id, tenantId: receipt.tenantId };
  },
});

export const complete = internalMutation({
  args: { receiptId: v.id("uploadReceipts"), storageId: v.id("_storage") },
  handler: async (ctx, { receiptId, storageId }) => {
    const receipt = await ctx.db.get(receiptId);
    if (!receipt || receipt.state !== "uploading") throw new Error("UPLOAD_TICKET_INVALID");
    await assertTenantWritable(ctx, receipt.tenantId);
    const metadata = await ctx.db.system.get(storageId);
    if (!metadata || metadata.size > MAX_UPLOAD_BYTES) throw new Error("UPLOAD_SIZE_INVALID");
    await ctx.db.patch(receiptId, {
      state: "complete",
      storageId,
      size: metadata.size,
      mimeType: metadata.contentType,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
  },
});

function uploadHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const configured = process.env.SITE_URL;
  if (!origin || !configured || origin !== new URL(configured).origin) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export const uploadHttp = httpAction(async (ctx, request) => {
  const headers = uploadHeaders(request);
  if (!headers) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  let stored: Id<"_storage"> | undefined;
  let phase: "validate" | "claim" | "storage_url" | "forward" | "response" | "complete" =
    "validate";
  try {
    const token = new URL(request.url).searchParams.get("ticket");
    if (!token || token.length > 100 || !request.body) throw new Error("UPLOAD_TICKET_INVALID");
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > MAX_UPLOAD_BYTES) throw new Error("UPLOAD_SIZE_INVALID");
    phase = "claim";
    const ticket = await ctx.runMutation(internal.uploads.claim, {
      ticketHash: await contentHash(token),
    });
    phase = "storage_url";
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const body = boundedUploadBody(request.body);
    // Raw-body streaming avoids the 20MiB multipart limit and does not buffer a 200MiB video.
    phase = "forward";
    const response = await fetch(uploadUrl, {
      method: "POST",
      body,
      headers: {
        "Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream",
      },
    });
    if (!response.ok) throw new Error("UPLOAD_FAILED");
    phase = "response";
    const result = await response.json();
    if (typeof result.storageId !== "string") throw new Error("UPLOAD_FAILED");
    stored = result.storageId as Id<"_storage">;
    phase = "complete";
    await ctx.runMutation(internal.uploads.complete, {
      receiptId: ticket.receiptId,
      storageId: stored,
    });
    return Response.json({ storageId: stored }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["UPLOAD_TICKET_INVALID", "UPLOAD_SIZE_INVALID", "UPLOAD_FAILED"].includes(message)
      ? message
      : "UPLOAD_INTERNAL_FAILURE";
    console.warn(code, { phase });
    // Only a storage id returned directly by our own upload may be compensating-deleted.
    if (stored) await ctx.storage.delete(stored);
    return Response.json(
      { error: "Upload failed. Request a new upload and try again." },
      { status: 400, headers },
    );
  }
});
