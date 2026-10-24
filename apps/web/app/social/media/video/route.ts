import { convexHttpOrigin, empty, OPAQUE, ownedOrigin, RELAY_HEADERS } from "../../_relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PATH = "/social/media/video";
const MAX_BYTES = 20 * 1024 * 1024;

type ByteRange = { start: number; end?: number } | { suffix: number };
function byteRange(value: string): ByteRange | null {
  const match = /^bytes=(\d{1,8})?-(\d{1,8})?$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 && suffix <= MAX_BYTES ? { suffix } : null;
  }
  const start = Number(match[1]),
    end = match[2] ? Number(match[2]) : undefined;
  return start < MAX_BYTES && (end === undefined || (end >= start && end < MAX_BYTES))
    ? { start, end }
    : null;
}
function contentRange(value: string | null, requested: ByteRange, length: number): boolean {
  const match = /^bytes (\d{1,8})-(\d{1,8})\/(\d{1,8})$/.exec(value ?? "");
  if (!match) return false;
  const start = Number(match[1]),
    end = Number(match[2]),
    total = Number(match[3]);
  if (total < 1 || total > MAX_BYTES || end >= total || end < start || end - start + 1 !== length)
    return false;
  const expectedStart =
    "suffix" in requested ? Math.max(0, total - requested.suffix) : requested.start;
  const expectedEnd =
    "suffix" in requested ? total - 1 : Math.min(requested.end ?? total - 1, total - 1);
  return start === expectedStart && end === expectedEnd;
}

export async function GET(request: Request): Promise<Response> {
  if (request.method !== "GET") return empty(405);
  const here = new URL(request.url),
    origin = convexHttpOrigin();
  if (ownedOrigin(request) === null || here.pathname !== PATH || origin === null) return empty(404);
  const params = here.searchParams;
  const postId = params.get("postId"),
    ticket = params.get("ticket");
  if (
    [...params.keys()].some((key) => key !== "postId" && key !== "ticket") ||
    params.getAll("postId").length !== 1 ||
    params.getAll("ticket").length !== 1 ||
    !postId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(postId) ||
    !ticket ||
    !OPAQUE.test(ticket)
  )
    return empty(404);
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader === null ? null : byteRange(rangeHeader);
  if (rangeHeader !== null && range === null) return empty(416);
  const target = new URL(PATH, origin);
  target.searchParams.set("postId", postId);
  target.searchParams.set("ticket", ticket);
  try {
    const upstream = await fetch(target, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: rangeHeader === null ? undefined : { Range: rangeHeader },
      signal: AbortSignal.timeout(60000),
    });
    const fail = async (status: number) => {
      await upstream.body?.cancel();
      return empty(status);
    };
    if (upstream.status === 404 || upstream.status === 416) return fail(upstream.status);
    if (upstream.status !== 200 && upstream.status !== 206) return fail(502);
    const rawLength = upstream.headers.get("content-length") ?? "";
    const length = Number(rawLength);
    const encoding = upstream.headers.get("content-encoding");
    if (
      upstream.headers.get("content-type") !== "video/mp4" ||
      !/^[1-9]\d{0,7}$/.test(rawLength) ||
      length > MAX_BYTES ||
      (encoding !== null && encoding !== "identity") ||
      upstream.body === null ||
      (upstream.status === 200 && upstream.headers.has("content-range")) ||
      (upstream.status === 206 &&
        (range === null || !contentRange(upstream.headers.get("content-range"), range, length)))
    )
      return fail(502);
    const headers = new Headers({
      ...RELAY_HEADERS,
      "Content-Type": "video/mp4",
      "Content-Length": String(length),
    });
    if (upstream.status === 206)
      headers.set("Content-Range", upstream.headers.get("content-range") ?? "");
    if (upstream.headers.get("accept-ranges") === "bytes") headers.set("Accept-Ranges", "bytes");
    const reader = upstream.body.getReader();
    let bytes = 0;
    // Stream, but never allow an upstream to exceed either its declared length or the upload cap.
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) {
            if (bytes !== length) controller.error(new Error("MEDIA_LENGTH"));
            else controller.close();
            return;
          }
          bytes += part.value.byteLength;
          if (bytes > length || bytes > MAX_BYTES) {
            await reader.cancel();
            controller.error(new Error("MEDIA_LENGTH"));
            return;
          }
          controller.enqueue(part.value);
        } catch {
          await reader.cancel().catch(() => {});
          controller.error(new Error("MEDIA_UNAVAILABLE"));
        }
      },
      async cancel() {
        await reader.cancel();
      },
    });
    return new Response(body, { status: upstream.status, headers });
  } catch {
    return empty(502);
  }
}
