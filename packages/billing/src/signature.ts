// Stripe webhook signature primitives — PURE (CLAUDE.md §1). No ctx, no fetch, no DB, no Convex.
//
// The adapter half (the HMAC and the tolerance comparison) lives in
// `packages/backend/convex/billingWebhook.ts`, because the HMAC is async Web Crypto and this
// package must stay synchronous and dependency-free.
//
// Header shape per https://docs.stripe.com/webhooks#verify-manually :
//   Stripe-Signature: t=1492774577,v1=<hex>,v0=<hex>

/**
 * How far `t` may be from now, in seconds. Stripe's own library default.
 *
 * NEVER 0: the recency window is the only thing standing between a captured-and-replayed delivery
 * and a second application of the same money event. A tolerance of 0 does not tighten the check,
 * it destroys it — the signature stays valid forever and only clock equality would pass.
 */
export const SIGNATURE_TOLERANCE_S = 300;

/**
 * Parse a `Stripe-Signature` header into its timestamp and EVERY `v1` signature.
 *
 * Two properties are load-bearing:
 * - **All `v1` values are returned.** During a secret roll Stripe signs one delivery with both the
 *   old and the new secret and puts both on the header. Keeping only the first turns the roll into
 *   an outage on whichever half we discarded.
 * - **`v0` (and any future scheme) is DROPPED.** `v0` is a fake scheme Stripe attaches to test
 *   events; accepting it would be a downgrade attack. Unknown schemes are dropped for the same
 *   reason — a new scheme must be opted into by a code change, never inherited.
 *
 * Returns `null` when the header cannot yield a usable `(t, v1[])` pair; the caller must treat
 * `null` as "reject", never as "skip verification".
 */
export function parseStripeSignature(header: string): { t: number; v1: string[] } | null {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    // Slice at the FIRST `=`, as Stripe's own reference implementation does. `eq <= 0` rejects
    // both a missing `=` and an empty key.
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") v1.push(v);
  }
  return t !== null && Number.isFinite(t) && v1.length > 0 ? { t, v1 } : null;
}

/**
 * Constant-time hex compare. `a !== b` on a digest is a timing oracle: a short-circuiting compare
 * leaks how many leading characters an attacker guessed right, which is enough to forge a
 * signature one character at a time.
 *
 * Length is compared first and non-secretly — the length of a SHA-256 hex digest is public.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
