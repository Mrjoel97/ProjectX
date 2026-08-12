// Shared constants for the public legal surface (/, /privacy, /terms).

export const SITE = "https://pikar-ai.com";
export const CONTACT = "joel@pikar-ai.com";
export const EFFECTIVE = "10 July 2026";

// Unresolved until a legal entity exists. Rendered verbatim, so nobody can mistake
// a draft for real terms.
export const ENTITY = "[LEGAL ENTITY — NOT YET FORMED]";
export const ENTITY_ADDRESS = "[REGISTERED ADDRESS — TBD]";
export const GOVERNING_LAW = "[GOVERNING LAW — TBD]";
export const VENUE = "[COURTS / VENUE — TBD]";
export const LEAD_AUTHORITY = "[LEAD EU SUPERVISORY AUTHORITY — TBD]";

const PLACEHOLDERS = [ENTITY, ENTITY_ADDRESS, GOVERNING_LAW, VENUE, LEAD_AUTHORITY];

export const HAS_PLACEHOLDERS = PLACEHOLDERS.some((p) => p.startsWith("["));

// Owner-approved production deferral, 2026-08-12. Keep this explicit and visible so the
// unresolved legal work cannot be mistaken for completion. The public pages continue to render
// the placeholders verbatim; this flag only permits a production build while formation details
// are pending.
export const LEGAL_REVIEW_DEFERRED = true;

// A Terms of Service naming "[LEGAL ENTITY — NOT YET FORMED]" is unenforceable, and a
// privacy policy with no named controller fails GDPR Art. 13 and Google's OAuth review.
// The owner explicitly deferred this production gate on 2026-08-12. Emit a production-build
// warning instead of failing, but do not hide or replace any placeholder. Remove the deferral and
// fill every value above before representing the legal surface as complete.
if (HAS_PLACEHOLDERS && process.env.VERCEL_ENV === "production") {
  const unresolved = PLACEHOLDERS.filter((p) => p.startsWith("[")).join(", ");
  if (!LEGAL_REVIEW_DEFERRED) {
    throw new Error(
      `Refusing to build for production: unresolved legal placeholders in app/legal.ts — ${unresolved}.`,
    );
  }
  console.warn(
    `LEGAL REVIEW DEFERRED: production contains unresolved placeholders in app/legal.ts — ${unresolved}. Owner-approved deferral recorded 2026-08-12.`,
  );
}
