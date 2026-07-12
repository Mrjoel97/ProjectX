// Shared SHA-256 hex — the one content-hash implementation (extracted from
// requests.ts). A redaction-safe fingerprint of content: audit goalHash, and the
// safeTextHash cache-key member (guardrails.prepare). One implementation, many
// callers (CLAUDE.md ladder rung 2).
export async function contentHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
