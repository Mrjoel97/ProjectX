import { httpAction } from "./_generated/server";

/** Public TikTok URL ownership proof only; never resolves a customer media ticket. */
export const receive = httpAction(async (_ctx, request) => {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (request.method !== "GET")
    return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
  const url = new URL(request.url);
  const sandboxFile = process.env.TIKTOK_SANDBOX_VERIFICATION_FILENAME;
  const isSandbox = !!sandboxFile && url.pathname === "/social/media/" + sandboxFile;
  const filename = isSandbox ? sandboxFile : process.env.TIKTOK_URL_VERIFICATION_FILENAME;
  const content = isSandbox
    ? process.env.TIKTOK_SANDBOX_VERIFICATION_CONTENT
    : process.env.TIKTOK_URL_VERIFICATION_CONTENT;
  if (
    !filename ||
    filename.length > 160 ||
    !/^tiktok[A-Za-z0-9]+\.txt$/.test(filename) ||
    !content ||
    content.length > 4096 ||
    !content.trim() ||
    !/^[ -~]*$/.test(content.replaceAll("\r", "").replaceAll("\n", "").replaceAll("\t", "")) ||
    url.pathname !== "/social/media/" + filename ||
    url.search
  )
    return new Response(null, { status: 404, headers });
  return new Response(content, {
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
});
