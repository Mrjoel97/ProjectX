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

// A Terms of Service naming "[LEGAL ENTITY — NOT YET FORMED]" is unenforceable, and a
// privacy policy with no named controller fails GDPR Art. 13 and Google's OAuth review.
// Fail the production build rather than publish either. VERCEL_ENV is set only on Vercel
// deploys, so local `pnpm build` and preview builds are unaffected and drafting continues.
if (HAS_PLACEHOLDERS && process.env.VERCEL_ENV === "production") {
  throw new Error(
    `Refusing to build for production: unresolved legal placeholders in app/legal.ts — ${PLACEHOLDERS.filter(
      (p) => p.startsWith("["),
    ).join(", ")}. Form the entity, fill these in, then deploy.`,
  );
}
