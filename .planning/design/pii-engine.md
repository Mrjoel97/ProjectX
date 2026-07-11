---
title: PII Engine — v1 approach decision (de-risk record)
status: decided (feeds Phase 3 planning)
decided: 2026-07-12
decision: Pure-TS deterministic scan/redact in `packages/pii`. No Python sidecar,
  no cloud DLP API in v1. Presidio sidecar is the NAMED upgrade path.
spike: packages/pii (scanText — email/card/ssn/phone, fail-closed, tested)
---

# PII Engine — v1 Decision

GRDL-01/02 require: every request PII-scanned and redacted to `safeText` before any
external model call; unknown/null scan results fail closed; no raw PII in logs,
telemetry, or cache keys. The PRD originally assumed a Presidio Python sidecar that
was never built. This record closes that open decision.

## Options considered

| Option | Coverage | Cost / risk | Verdict |
|---|---|---|---|
| **Pure-TS regex+Luhn in `packages/pii`** | Structured PII: emails, cards (Luhn-validated), SSNs, phones. NOT person names in prose | Zero new platforms, zero per-request cost, deterministic (fail-closed is trivial), in-process latency ~0 | **CHOSEN for v1** |
| Presidio sidecar (Python) | + NER person names, i18n entities | A whole deployment plane (Convex can't host Python): hosting, auth between planes, cold starts, monitoring — for one function. Weeks of the 3 we have | Upgrade path, not v1 |
| Cloud DLP API (Google DLP / AWS Comprehend) | Comparable to Presidio | Per-request cost + **adds a data processor for restricted-scope Gmail-derived text** → bigger CASA surface + privacy-policy processor list growth. Compliance-negative | Rejected |
| npm PII libs (`redact-pii`, recognizers-text) | ≈ regex tier | Stale/unmaintained; same ceiling as own regexes with a dependency attached | Rejected (ladder: no dep for what ~100 lines do) |

The compliance angle is decisive, not just the effort angle: with `gmail.modify`
(restricted scope), every additional processor that touches mailbox-derived text
expands the CASA assessment surface and the privacy-policy disclosure list. An
in-process TS pass adds **zero** processors.

## What the spike proves (`packages/pii`)

- `scanText(input: unknown): Result<PiiScanResult, PiiScanError>` — fail-closed at the
  type level: non-string/null input or any detector throw returns `Err`, never partial
  output (GRDL-01's unknown/null → fail closed).
- Detects & redacts to stable placeholders (`[EMAIL_1]`, `[CARD_1]`, `[SSN_1]`,
  `[PHONE_1]`); same value → same placeholder; overlap-resolved single pass.
- Luhn check keeps 16-digit non-card numbers (order ids etc.) unredacted — precision
  matters because over-redaction destroys drafting utility.
- `counts` (by type) is the ONLY log-safe summary; `entities` carries raw values for
  delivery-time re-substitution and must never reach audit/telemetry/DLQ (CLAUDE.md §4).
- `safeTextHash` is NOT computed here: the package stays platform-neutral (no
  node:crypto); the convex adapter hashes `safeText` exactly like the existing
  `goalHash` pattern in requests.ts.

## Insertion points (already marked in code)

`llm.ts` `route()` and `draft()` each carry a `ponytail:` comment reserving the slot:
redact BEFORE `generateObject`. Phase 3 wires `scanText` there + the redact-then-log
step contract (GRDL-02) + cache key `tenantId + safeTextHash` (GRDL-04).

## Tensions Phase 3 planning MUST resolve (flagged, not silently decided)

1. **Names-in-prose vs drafting utility.** "Email John about the invoice" — the
   deterministic pass does not catch "John", and catching it would make the drafter
   write "Hi [NAME_1]". Recommended default: v1 sends person names to the model under
   the zero-retention/no-training contract (already a hard constraint), while logs/
   telemetry/cache stay hash-only regardless. If the owner wants name redaction later,
   that IS the Presidio trigger.
2. **Cache collision semantics (GRDL-04).** Two goals differing only in redacted
   values collapse to one `safeTextHash` → shared cached draft. This is SAFE today
   because the recipient is delivery-supplied (llm.ts never sees it) and placeholders
   are deterministic — a shared template, not a leak. Re-verify this holds when
   drafting becomes recipient-aware (cockpit personalization, CKPT-03).
3. **Fail-closed UX.** A scan `Err` stops the request; decide the user-facing message
   + audit outcome name at Phase 3 planning (mirror INTK-04's rejection pattern).

## Ceilings (ponytail)

US-formatted SSN/phone patterns only; no names/addresses/i18n. Upgrade path: extend
patterns first; adopt the Presidio sidecar ONLY when a real redaction-quality need
(names, i18n) is demonstrated — never speculatively.
