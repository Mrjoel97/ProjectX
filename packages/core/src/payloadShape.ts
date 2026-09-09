/**
 * payloadShape — does a stored payload actually obey CLAUDE.md §4?
 *
 * §4 says `audit.payload` and `deadLetters.payload` carry **refs, hashes, ids and COUNTS ONLY**,
 * never raw user content or PII, with redaction happening before the write. Every guard for that
 * rule today reads SOURCE. ADR-044 T3 says that is not enough, and says why:
 *
 *   > every latent §4 defect in the history becomes permanent on arming day, and a source scan
 *   > cannot see a single already-written row. The honest check reads rows, not code.
 *
 * `audit.recentByType` states the same assumption from the other side — *"if a payload ever
 * carried content, this query would not be the bug"* — which is true, and is exactly the claim
 * nobody has ever tested against the rows.
 *
 * THIS MODULE IS THE CLASSIFIER, AND IT NEVER RETURNS A VALUE IT WAS GIVEN. A finding carries the
 * field PATH, a verdict, and a redacted fingerprint (length + character classes). That is not
 * squeamishness: the whole point is to run this over production audit rows, and a checker that
 * echoes suspected PII into a terminal, a CI log or an agent transcript has moved the leak rather
 * than found it. The fingerprint is enough to locate the writer; the row is there to read
 * deliberately by whoever owns it.
 *
 * IT IS PURE, so the live gate and the offline self-test share one implementation. `classify` runs
 * server-side inside an `internalQuery` (values never cross the wire) and offline inside
 * `check-audit-payloads.mjs --self-test`.
 */

/** How bad, in the only three grades a caller can act on. */
export type Verdict = "ok" | "suspect" | "violation";

export type Finding = {
  /** Dotted path into the payload, with `[]` for array elements: `steps[].refusal`. */
  path: string;
  verdict: Verdict;
  /** WHY, as a code-owned literal — never a message, and never the value. */
  reason: string;
  /** Redacted fingerprint: length and character classes only. Absent for `ok`. */
  fingerprint?: string;
};

/**
 * Field names that are PII by their name alone, whatever they hold. A ref may legitimately be a
 * long opaque string; a field CALLED `email` is a bridge to a person even when today's rows happen
 * to be empty — which is precisely ADR-044 C2's argument about `stripeObjectId`.
 *
 * Matched on the LAST path segment, case-insensitively, as a whole word or camelCase part, so
 * `recipientEmail` and `email` both hit while `emailsSent` (a COUNT) does not.
 */
const PII_KEYS = [
  "email",
  "name",
  "fullname",
  "firstname",
  "lastname",
  "phone",
  "address",
  "street",
  "postcode",
  "zip",
  "subject",
  "body",
  "text",
  "content",
  "message",
  "prompt",
  "snippet",
  "excerpt",
  "quote",
  "title",
  "description",
  "note",
  "comment",
];

/** Split `recipientEmailAddress` -> ["recipient","email","address"]; `snake_case` too. */
const parts = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());

/**
 * A COUNT-shaped name survives a PII-shaped stem: `emailsSent`, `messageCount`, `nameCount`.
 * Plurals matter — `emails` is a count of emails, `email` is an address. This is the one place the
 * rule is a heuristic, and it errs toward FLAGGING: an unrecognised shape is `suspect`, not `ok`.
 */
const COUNT_SUFFIXES = ["count", "total", "sent", "failed", "ok", "len", "length", "size", "n"];

/**
 * A REF-shaped name also survives a PII-shaped stem, and this is not a loophole — it is §4's own
 * words. The rule permits "refs, hashes, ids and counts", so `promptHash` is the hash OF a prompt,
 * `messageId` is an id, `bodyHash` is a digest. None of them is the thing itself.
 *
 * MEASURED 2026-09-09 on production: the first live run reported 8 suspects over 672 audit rows and
 * ALL EIGHT were this shape (`promptHash` x193, `skillBodyHash` x57, `messageId`, `bodyHash`). Zero
 * were real. A gate that is noisy for a non-reason stops being read just as surely as one that is
 * red for a non-reason, so the fix belongs in the detector — the same call as 45-06, where four of
 * five flags were the scanner's own bug.
 *
 * NOTE WHAT THIS DOES NOT EXEMPT. ADR-044 C2's `stripeObjectId` is an opaque id that still bridges
 * to a person, and it is untouched here: its stem is `stripe`/`object`, which was never on the PII
 * list, so the key rule never caught it and this change cannot release it.
 */
const REF_SUFFIXES = ["hash", "hashes", "id", "ids", "ref", "refs", "key", "keys", "digest"];

/**
 * Exact keys a human READ and cleared. Listed rather than pattern-matched, for the reason
 * `schema.test.ts` gives about its own three exceptions: "quietly widening a scan until it passes
 * is how an absence test starts lying."
 *
 *   • `skillName` — a code-owned skill slug (`revenue-crm@1`), never a person's name. It is the
 *     one `*Name` key in the production log, and `customerName` must still be caught, so this is
 *     an exact-name exception rather than a `Name` suffix rule.
 */
const REVIEWED_KEYS = new Set(["skillname"]);

export function keyIsPiiShaped(key: string): boolean {
  if (REVIEWED_KEYS.has(key.toLowerCase())) return false;
  const p = parts(key);
  const last = p[p.length - 1] ?? "";
  if (COUNT_SUFFIXES.includes(last) || p.some((s) => COUNT_SUFFIXES.includes(s))) return false;
  // A ref suffix means the field holds a POINTER to the thing, which §4 permits by name.
  if (REF_SUFFIXES.includes(last)) return false;
  // A plural stem reads as a count of things, not a thing.
  return p.some((s) => PII_KEYS.includes(s));
}

// ── value shapes that §4 explicitly permits ─────────────────────────────────────────────────
/** Convex document ids and other opaque lowercase refs. */
const REF_RE = /^[a-z0-9]{16,64}$/;
/** Hex digests of any common width. */
const HASH_RE = /^[0-9a-f]{8,128}$/i;
/** A code-owned literal: an eventType, a refusal class, a provider, a correlation key. No spaces. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@+/-]{0,127}$/;
/** ISO-8601, which is a timestamp and therefore a number wearing a coat. */
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** An email address anywhere in the string — the one shape that is never a ref. */
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
/** A URL carrying a query string: the query is where identity hides. */
const URL_WITH_QUERY_RE = /^[a-z][a-z0-9+.-]*:\/\/[^\s?]+\?\S/i;

/** Length + character classes. Enough to find the writer; useless to an eavesdropper. */
export function fingerprint(s: string): string {
  const cls = [
    /[a-z]/.test(s) ? "a" : "",
    /[A-Z]/.test(s) ? "A" : "",
    /[0-9]/.test(s) ? "9" : "",
    /\s/.test(s) ? "␠" : "",
    /[^\w\s]/.test(s) ? "%" : "",
  ].join("");
  return `len=${s.length} cls=${cls || "-"}`;
}

/** Classify ONE string value, ignoring its key. */
export function classifyString(s: string): { verdict: Verdict; reason: string } {
  if (s.length === 0) return { verdict: "ok", reason: "empty" };
  if (EMAIL_RE.test(s)) return { verdict: "violation", reason: "email_shaped" };
  if (URL_WITH_QUERY_RE.test(s)) return { verdict: "violation", reason: "url_with_query" };
  if (ISO_RE.test(s)) return { verdict: "ok", reason: "iso_timestamp" };
  if (HASH_RE.test(s)) return { verdict: "ok", reason: "hash" };
  if (REF_RE.test(s)) return { verdict: "ok", reason: "ref" };
  // Whitespace is the tell for prose. A slug never has any; a sentence always does.
  if (/\s/.test(s)) {
    return s.length > 40
      ? { verdict: "violation", reason: "free_text" }
      : { verdict: "suspect", reason: "short_text_with_space" };
  }
  if (SLUG_RE.test(s)) return { verdict: "ok", reason: "slug" };
  return { verdict: "suspect", reason: "unclassified_string" };
}

/**
 * Walk a payload and report every leaf that is not provably a ref, hash, id, count or code-owned
 * literal. Arrays collapse to one `[]` segment so a 500-element array yields one finding per
 * distinct shape rather than 500 identical ones — a report nobody reads is a check nobody runs.
 */
export function classifyPayload(value: unknown, rootPath = ""): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();

  const push = (f: Finding) => {
    const k = `${f.path}|${f.reason}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  const walk = (v: unknown, path: string, key: string, depth: number): void => {
    // A payload deep enough to hide in is itself the finding.
    if (depth > 12) {
      push({ path, verdict: "suspect", reason: "depth_exceeded" });
      return;
    }
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, `${path}[]`, key, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        walk(child, path ? `${path}.${k}` : k, k, depth + 1);
      }
      return;
    }
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return;
    if (typeof v !== "string") {
      push({ path, verdict: "suspect", reason: `unexpected_type_${typeof v}` });
      return;
    }

    const byValue = classifyString(v);
    // THE KEY CAN CONVICT A VALUE THAT LOOKS INNOCENT. A field named `email` holding `""` today is
    // still a bridge the moment somebody writes to it — ADR-044 C2's argument about
    // `stripeObjectId`, which is an opaque id and still resolves to a person.
    if (keyIsPiiShaped(key)) {
      push({
        path,
        verdict: byValue.verdict === "violation" ? "violation" : "suspect",
        reason: `pii_key:${byValue.reason}`,
        fingerprint: fingerprint(v),
      });
      return;
    }
    if (byValue.verdict === "ok") return;
    push({ path, verdict: byValue.verdict, reason: byValue.reason, fingerprint: fingerprint(v) });
  };

  walk(value, rootPath, rootPath, 0);
  return out;
}

/** Worst verdict in a set, for a one-line answer. */
export function worst(findings: Finding[]): Verdict {
  if (findings.some((f) => f.verdict === "violation")) return "violation";
  if (findings.some((f) => f.verdict === "suspect")) return "suspect";
  return "ok";
}
