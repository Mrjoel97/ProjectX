// Explicit allow-list of convex module basenames permitted to import the raw
// builders from _generated/server. Almost all of these are INTERNAL-only modules
// (audit, dead-letter, skills, review/timeout race, WORM export, smoke tests,
// auth, http) that must use `internalQuery`/`internalMutation`/`internalAction` —
// the sanctioned exception to the tenant-wrapper rule, since they run from the
// scheduler / onComplete / http layer and are never client-callable with a
// tenant identity.
//
// `invites.ts` (25-01) IS THE ONE EXCEPTION TO THAT SENTENCE, and it is a
// different kind of exception, so do not read the paragraph above as covering it.
// Its `requestAccess` and `preflight` are genuinely PUBLIC and UNAUTHENTICATED:
// a beta signup page is used by people who have no identity yet, which no tenant
// wrapper can express (`tenantQuery` throws UNAUTHENTICATED by design). What
// makes it safe is not internality but scope — neither function reads or returns
// tenant-owned data, and neither returns a code, an id, a subject or an unmasked
// address. Before adding another public entry here, satisfy that same bar and say
// so in its own comment; "it needed to be callable" is not the bar.
//
// NOTE: `internalQuery`/`internalMutation`/`internalAction` are NOT banned by
// the guard (the regex only matches lowercase `query`/`mutation`). This list
// exists so that if such a module ever legitimately needs the public builders,
// or lands before its final shape, the static guard still passes. Modules are
// listed by basename; entries for files not yet created are harmless.
export const RAW_BUILDER_ALLOWLIST: readonly string[] = [
  "audit.ts",
  "deadLetter.ts",
  "skills.ts",
  "review.ts",
  "worm.ts",
  "wormCursor.ts",
  "crons.ts",
  "smoke.ts",
  "smokeAssert.ts",
  "auth.ts",
  "http.ts",
  // Gmail token store + delivery readers (internalQuery/internalMutation + two
  // tenantQueries). Internal-only surfaces around the crown-jewel refresh tokens.
  "gmailAuth.ts",
  // Migration runner (component's runner) + the workflow/status stub (workflow.define
  // + internalMutation, not tenant wrappers). Both are internal-only.
  "migrations.ts",
  "pipeline.ts",
  // BETA-01 admission. Public + unauthenticated by necessity — see the note above.
  "invites.ts",
];
