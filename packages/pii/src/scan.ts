/**
 * PII scan + redaction (GRDL-01/02 core) — deterministic, fail-closed, pure TS.
 *
 * v1 decision record: .planning/design/pii-engine.md. Structured PII only
 * (emails, Luhn-valid cards, US SSNs, phones); person names in prose are
 * deliberately out of scope — see the design doc's tension #1.
 *
 * ponytail: US-formatted SSN/phone patterns only; extend patterns first, adopt
 * the Presidio sidecar only when names/i18n coverage is actually demanded.
 *
 * No node:crypto here — safeTextHash is the convex adapter's job (same SHA-256
 * pattern as requests.ts goalHash), keeping this package platform-neutral.
 */
import { type Result, err, ok } from "@pikar/core/result";

export type PiiType = "email" | "card" | "ssn" | "phone";

export type PiiEntity = {
  /** Stable placeholder inserted into safeText, e.g. "[EMAIL_1]". */
  readonly placeholder: string;
  readonly type: PiiType;
  /** The raw matched value — PII. NEVER write this to audit/telemetry/DLQ (CLAUDE.md §4). */
  readonly value: string;
};

export type PiiScanResult = {
  /** Input with every detected entity replaced by its placeholder. */
  readonly safeText: string;
  /** Per-type match counts — the ONLY log-safe summary of a scan. */
  readonly counts: Readonly<Record<PiiType, number>>;
  /** Raw entities for delivery-time re-substitution. PII — never log. */
  readonly entities: readonly PiiEntity[];
};

export type PiiScanError = {
  readonly code: "invalid_input" | "scan_failed";
  readonly message: string;
};

// Detector order = redaction priority: an accepted earlier match suppresses any
// later match overlapping it (e.g. the phone digits inside "+15551234567@relay.com"
// belong to the email match).
const DETECTORS: readonly { type: PiiType; re: RegExp; accept?: (raw: string) => boolean }[] = [
  { type: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // 13–19 digits with optional single space/dash separators, then Luhn-checked —
  // the checksum is what keeps 16-digit order numbers unredacted (precision matters:
  // over-redaction destroys drafting utility).
  { type: "card", re: /\d(?:[ -]?\d){12,18}/g, accept: (raw) => luhn(raw.replace(/[ -]/g, "")) },
  { type: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // E.164 (+15551234567) or US formatted ((555) 123-4567 / 555-123-4567 / 555.123.4567).
  // NOTE: no \b before "(" — a word boundary can't sit between two non-word chars,
  // so the parenthesized form gets its own alternative without one.
  { type: "phone", re: /\+\d{7,15}\b|\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g },
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

type Match = { type: PiiType; start: number; end: number; value: string };

/**
 * Scan `input` and redact every detected entity to a stable placeholder
 * ([EMAIL_1], [CARD_1], …; the same raw value always maps to the same placeholder).
 *
 * Fail-closed (GRDL-01): non-string input or any detector failure returns Err —
 * never partial output. The caller stops the request on Err.
 */
export function scanText(input: unknown): Result<PiiScanResult, PiiScanError> {
  if (typeof input !== "string") {
    return err({ code: "invalid_input", message: `expected string, got ${typeof input}` });
  }
  try {
    // Collect candidate matches in detector-priority order.
    const accepted: Match[] = [];
    for (const { type, re, accept } of DETECTORS) {
      re.lastIndex = 0;
      for (const m of input.matchAll(re)) {
        const value = m[0];
        if (accept && !accept(value)) continue;
        const start = m.index;
        const end = start + value.length;
        // Earlier-priority (or earlier-position, same-priority) matches win overlaps.
        if (accepted.some((a) => start < a.end && end > a.start)) continue;
        accepted.push({ type, start, end, value });
      }
    }

    // Assign stable placeholders (same value → same placeholder), numbered per type
    // by first occurrence in the text.
    accepted.sort((a, b) => a.start - b.start);
    const byValue = new Map<string, PiiEntity>();
    const counts: Record<PiiType, number> = { email: 0, card: 0, ssn: 0, phone: 0 };
    for (const m of accepted) {
      if (byValue.has(m.value)) continue;
      counts[m.type] += 1;
      byValue.set(m.value, {
        placeholder: `[${m.type.toUpperCase()}_${counts[m.type]}]`,
        type: m.type,
        value: m.value,
      });
    }

    // Rebuild the string right-to-left so earlier offsets stay valid.
    let safeText = input;
    for (const m of [...accepted].reverse()) {
      const entity = byValue.get(m.value);
      if (!entity) continue; // unreachable: every accepted match was registered above
      safeText = safeText.slice(0, m.start) + entity.placeholder + safeText.slice(m.end);
    }

    return ok({ safeText, counts, entities: [...byValue.values()] });
  } catch (e) {
    return err({ code: "scan_failed", message: e instanceof Error ? e.message : String(e) });
  }
}
