// Shared constants for the public legal surface (/, /privacy, /terms).

export const SITE = "https://pikar-ai.com";
export const CONTACT = "joel@pikar-ai.com";
export const EFFECTIVE = "24 October 2026";

// Public business name and operating country confirmed by the owner on 2026-10-24.
// These are the supplied public particulars, not independent registration verification.
export const ENTITY = "pikar-ai";
export const OPERATING_COUNTRY = "Tanzania";
// Exact city/country address confirmed on 2026-10-24; no street or postcode was supplied.
export const ENTITY_ADDRESS = "Dar es Salaam, Tanzania";
// Jurisdiction choices supplied on 2026-10-17 and included in the owner's publication approval.
export const GOVERNING_LAW = "the laws of Tanzania";
export const VENUE = "the courts in Dar es Salaam, Tanzania";
export const OWNER_REVIEWED_DATE = "24 October 2026";

const PLACEHOLDERS = [ENTITY, ENTITY_ADDRESS, GOVERNING_LAW, VENUE];
export const HAS_PLACEHOLDERS = PLACEHOLDERS.some((p) => p.startsWith("["));

// Deliberate owner-approved publication, independent of whether fields contain placeholders.
// This records owner approval only; it makes no claim of lawyer review or legal certification.
export const OWNER_APPROVED_PUBLICATION = true;
// The previous publication deferral is closed by the owner's approval on 2026-10-24.
// Retain an explicit deferral control for genuinely pending future policy revisions.
export const LEGAL_REVIEW_DEFERRED = false;

if (process.env.VERCEL_ENV === "production") {
  const unresolved = PLACEHOLDERS.filter((p) => p.startsWith("[")).join(", ");
  if (HAS_PLACEHOLDERS && !LEGAL_REVIEW_DEFERRED) {
    throw new Error(
      `Refusing to build for production: unresolved legal placeholders in app/legal.ts — ${unresolved}.`,
    );
  }
  if (!OWNER_APPROVED_PUBLICATION || LEGAL_REVIEW_DEFERRED) {
    console.warn(
      `POLICY PUBLICATION DEFERRED: owner publication approval is pending or deferred.${unresolved ? ` Unresolved placeholders: ${unresolved}.` : ""}`,
    );
  }
}
