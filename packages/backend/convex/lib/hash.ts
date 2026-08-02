// Shared SHA-256 hex — the one content-hash implementation (extracted from
// requests.ts). A redaction-safe fingerprint of content: audit goalHash, and the
// safeTextHash cache-key member (guardrails.prepare). One implementation, many
// callers (CLAUDE.md ladder rung 2).
//
// Widened to BYTES for plan 20-06: a landed media asset needs `assetHash` over its downloaded
// bytes, and a second SHA-256 implementation three lines long is exactly the duplication this
// module exists to prevent. Every shipped string caller is byte-identical — the widening is
// additive at the type level and unreachable from them.
// `BufferSource`, not `Uint8Array`: a bare `Uint8Array` is `Uint8Array<ArrayBufferLike>` under
// TS 5.7+ and may be SharedArrayBuffer-backed, which `crypto.subtle.digest` does not accept.
export async function contentHash(s: string | BufferSource): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    typeof s === "string" ? new TextEncoder().encode(s) : s,
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
