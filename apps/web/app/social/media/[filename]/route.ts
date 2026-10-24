import { convexHttpOrigin, empty, ownedOrigin, RELAY_HEADERS } from "../../_relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only the fixed backend can supply its exact configured public ownership proof. */
export async function GET(request: Request): Promise<Response> {
  if (request.method !== "GET") return empty(405);
  const here = new URL(request.url),
    origin = convexHttpOrigin();
  const filename = here.pathname.slice("/social/media/".length);
  if (
    ownedOrigin(request) === null ||
    origin === null ||
    here.search ||
    !here.pathname.startsWith("/social/media/") ||
    filename.length > 160 ||
    !/^tiktok[A-Za-z0-9]+\.txt$/.test(filename)
  )
    return empty(404);
  try {
    const upstream = await fetch(new URL(`/social/media/${filename}`, origin), {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (
      upstream.status !== 200 ||
      upstream.body === null ||
      !/^text\/plain(?:;[^\r\n]*)?$/.test(upstream.headers.get("content-type") ?? "")
    ) {
      await upstream.body?.cancel();
      return empty(upstream.status === 404 ? 404 : 502);
    }
    const reader = upstream.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return empty(502);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim() || !/^[\x20-\x7e\r\n\t]+$/.test(text)) return empty(502);
    return new Response(text, {
      headers: { ...RELAY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return empty(502);
  }
}
