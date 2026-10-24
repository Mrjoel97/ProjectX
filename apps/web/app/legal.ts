// Shared constants for the public legal surface (/, /privacy, /terms).

export const SITE = "https://pikar-ai.com";
export const CONTACT = "joel@pikar-ai.com";
export const EFFECTIVE = "10 July 2026";

// Public business name and operating country confirmed by the owner on 2026-10-24.
// Owner confirmation does not establish qualified legal review or registration verification.
export const ENTITY = "pikar-ai";
export const OPERATING_COUNTRY = "Tanzania";
// Exact city/country address confirmed on 2026-10-24; no street or postcode was supplied.
export const ENTITY_ADDRESS = "Dar es Salaam, Tanzania";
// Draft choices confirmed by the owner on 2026-10-17; qualified review remains deferred.
export const GOVERNING_LAW = "the laws of Tanzania";
export const VENUE = "the courts in Dar es Salaam, Tanzania";
// Owner-only policy review, separate from qualified legal review and the effective date.
export const OWNER_REVIEWED_DATE = "24 October 2026";

const PLACEHOLDERS = [ENTITY, ENTITY_ADDRESS, GOVERNING_LAW, VENUE];
export const HAS_PLACEHOLDERS = PLACEHOLDERS.some((p) => p.startsWith("["));

// Owner-approved production deferral, 2026-08-12. It remains visible even when
// owner-supplied identity fields contain no placeholders. Owner review is not lawyer review.
export const LEGAL_REVIEW_DEFERRED = true;

// Keep unresolved facts and deferred review distinct. Production may render the owner-approved
// draft under the explicit deferral; filling identity fields must not silently certify review.
if (process.env.VERCEL_ENV === "production") {
  const unresolved = PLACEHOLDERS.filter((p) => p.startsWith("[")).join(", ");
  if (HAS_PLACEHOLDERS && !LEGAL_REVIEW_DEFERRED) {
    throw new Error(
      `Refusing to build for production: unresolved legal placeholders in app/legal.ts — ${unresolved}.`,
    );
  }
  if (LEGAL_REVIEW_DEFERRED) {
    console.warn(
      `LEGAL REVIEW DEFERRED: owner-only review recorded ${OWNER_REVIEWED_DATE}; qualified legal review remains deferred.${unresolved ? ` Unresolved placeholders: ${unresolved}.` : ""}`,
    );
  }
}
