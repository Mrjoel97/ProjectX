import {
  APPROVED_FIELDWORK_REFERENCE,
  getApprovedPresenceReferenceIdentity,
} from "@pikar/contracts/approvedPresenceReference";
import { sha256Bytes } from "@pikar/core/webRuntime";

type FilePin = { readonly path: string; readonly byteLength: number; readonly sha256: string };
/** Fetch only fixed code-owned paths. Never execute reference HTML/scripts or use them as factual authority. */
export async function loadApprovedPresenceReference(args: {
  referenceId: unknown;
  siteUrl: string;
  fetch?: typeof fetch;
}) {
  const identity = getApprovedPresenceReferenceIdentity(args.referenceId);
  if (!identity) throw Error("APPROVED_REFERENCE_UNKNOWN");
  let origin: URL;
  try {
    origin = new URL(args.siteUrl);
  } catch {
    throw Error("APPROVED_REFERENCE_ORIGIN_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw Error("APPROVED_REFERENCE_ORIGIN_INVALID");
  const fetcher = args.fetch ?? globalThis.fetch;
  async function read(pin: FilePin): Promise<Uint8Array> {
    if (pin.byteLength > 3_000_000) throw Error("APPROVED_REFERENCE_TOO_LARGE");
    const response = await fetcher(new URL(pin.path, origin.origin), {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || response.redirected || !response.body)
      throw Error("APPROVED_REFERENCE_UNAVAILABLE");
    if (response.url && new URL(response.url).origin !== origin.origin)
      throw Error("APPROVED_REFERENCE_ORIGIN_MISMATCH");
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== pin.byteLength)
      throw Error("APPROVED_REFERENCE_SIZE_MISMATCH");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > pin.byteLength) throw Error("APPROVED_REFERENCE_SIZE_MISMATCH");
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (total !== pin.byteLength) throw Error("APPROVED_REFERENCE_SIZE_MISMATCH");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (sha256Bytes(bytes) !== pin.sha256) throw Error("APPROVED_REFERENCE_HASH_MISMATCH");
    if (
      pin.path.endsWith(".png") &&
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    )
      throw Error("APPROVED_REFERENCE_IMAGE_INVALID");
    if (
      pin.path.endsWith(".webp") &&
      (new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" ||
        new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP")
    )
      throw Error("APPROVED_REFERENCE_IMAGE_INVALID");
    return bytes;
  }
  const manifest = APPROVED_FIELDWORK_REFERENCE;
  if (manifest.html.byteLength > 65536) throw Error("APPROVED_REFERENCE_TOO_LARGE");
  const htmlBytes = await read(manifest.html);
  const desktop = await read(manifest.desktop),
    mobile = await read(manifest.mobile);
  for (const asset of manifest.assets) await read(asset);
  return {
    identity,
    html: new TextDecoder("utf-8", { fatal: true }).decode(htmlBytes),
    desktopImage: {
      bytes: desktop,
      mimeType: "image/png" as const,
      sha256: manifest.desktop.sha256,
    },
    mobileImage: { bytes: mobile, mimeType: "image/png" as const, sha256: manifest.mobile.sha256 },
  };
}
