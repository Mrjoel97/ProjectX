// Explicit allow-list of convex module basenames permitted to import the raw
// builders from _generated/server. These are INTERNAL-only modules (audit,
// dead-letter, skills, review/timeout race, WORM export, smoke tests, auth,
// http) that must use `internalQuery`/`internalMutation`/`internalAction` —
// the sanctioned exception to the tenant-wrapper rule, since they run from the
// scheduler / onComplete / http layer and are never client-callable with a
// tenant identity.
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
];
