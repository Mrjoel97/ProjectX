import { socialHash } from "@pikar/core/social";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
/** Provider pull endpoint: opaque short-lived receipt, only for an approved customer post. */
export const receive = httpAction(async (ctx, request) => {
  const url = new URL(request.url),
    id = url.searchParams.get("postId"),
    ticket = url.searchParams.get("ticket");
  if (!id || !ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
    return new Response(null, { status: 404 });
  const storageId = await ctx.runQuery(internal.socialPublishing.mediaForTicket, {
    postId: id,
    ticketHash: await socialHash("media:" + ticket),
  });
  if (!storageId) return new Response(null, { status: 404 });
  const blob = await ctx.storage.get(storageId);
  if (!blob || blob.type !== "video/mp4" || blob.size > 20 * 1024 * 1024)
    return new Response(null, { status: 404 });
  return new Response(blob, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(blob.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
