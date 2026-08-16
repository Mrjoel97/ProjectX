import Google from "@auth/core/providers/google";
import MicrosoftEntraID from "@auth/core/providers/microsoft-entra-id";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { admitIdentity } from "./invites";

// Email + password is a real sign-in method (alongside Google and Microsoft). The `profile`
// mapping captures the sign-up Full Name onto the users row; password rules enforce a minimum
// length. Email verification + password reset are the security fast-follow — they use
// this provider's `verify`/`reset` options and need a transactional email sender.
// ponytail: length-only password rule for the closed beta; strength/breach checks +
// verify/reset land with the email sender.
// EXPORTED, like `google` and `microsoft` below, for ONE reason: `invites.test.ts` drives
// `admitIdentity` with synthetic `provider` objects, and a hand-written `{id, type}` in a test
// proves nothing about the provider the runtime actually hands the callback. The test
// materializes THESE values through the auth package's own `providerDefaults` merge. Convex
// ignores non-function module exports (the `guardrails.ts` precedent).
export const password = Password({
  profile(params) {
    const p: { email: string; name?: string; inviteCode?: string } = {
      email: params.email as string,
    };
    if (typeof params.name === "string" && params.name.trim()) p.name = params.name.trim();
    // BETA-01: a password email is SELF-ASSERTED, so the typed code is the second factor of
    // admission. It rides the profile only as far as `admitIdentity`, which strips it before any
    // users-table write — `users` has no such column, so a leak would also fail validation.
    if (typeof params.inviteCode === "string" && params.inviteCode.trim()) {
      p.inviteCode = params.inviteCode.trim();
    }
    return p;
  },
  validatePasswordRequirements: (pw) => {
    if (pw.length < 8) throw new Error("Password must be at least 8 characters.");
  },
});

/**
 * Both OAuth mappers return `id` AND a duplicate `oauthSubject`, and that is not redundancy.
 *
 * @convex-dev/auth@0.0.94 destructures the profile as
 * `const { id, ...profileFromCallback } = await provider.profile(...)` before it ever reaches
 * `createOrUpdateUser` (dist/server/implementation/index.js) — `id` becomes the account's
 * `providerAccountId` and is GONE from the profile the callback sees. Admission has to bind the
 * subject, so it needs its own copy under a name the package does not strip.
 */
export const google = Google({
  authorization: { params: { scope: "openid email profile" } },
  profile: (p) => ({
    id: p.sub,
    oauthSubject: p.sub,
    email: p.email,
    name: p.name,
    image: p.picture,
  }),
});

/**
 * ONE Microsoft app registration serves both sign-in and mailbox access (ADR-018); this provider
 * is the SIGN-IN half only and asks for no Graph scope — the mail/calendar consent is the separate
 * grant in `/connect-microsoft`.
 *
 * `/common` authority: personal and work/school accounts both sign in. Entra's `sub` is an opaque
 * pairwise identifier, NOT a GUID and NOT `oid` — do not switch to `oid` (it is tenant-scoped and
 * absent for personal accounts) and do not assert a length. The provider's default profile does a
 * Graph photo fetch for the avatar; it is deliberately not restored here, because it would need a
 * Graph scope this sign-in grant does not have.
 */
export const microsoft = MicrosoftEntraID({
  issuer: "https://login.microsoftonline.com/common/v2.0",
  authorization: { params: { scope: "openid email profile" } },
  profile: (p) => ({
    id: p.sub,
    oauthSubject: p.sub,
    // Entra omits `email` for many account shapes; `preferred_username` carries the address then.
    email: p.email ?? p.preferred_username,
    name: p.name,
  }),
});

// Three front doors: Google, Microsoft Entra ID (openid email profile ONLY — mailbox access is
// the separate consent in /connect-gmail and /connect-microsoft) and email+password. auth.ts
// stays on the raw-builder allowlist (CLAUDE.md §2) — convexAuth wires the generated fns itself.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [google, microsoft, password],
  callbacks: {
    /**
     * BETA-01 — THE admission boundary. Runs inside the single `auth:store` mutation, before
     * `createOrUpdateAccount`, so throwing rolls back the user, the account, the verification
     * code and the session together. `createOrUpdateUser` (not `afterUserCreatedOrUpdated`) is
     * the only callback early enough to have that property: the package documents that the later
     * one is skipped entirely when this one is defined.
     *
     * The logic lives in `invites.ts` so it is directly drivable by `invites.test.ts` with
     * synthetic profiles for all three providers. Keep this a one-liner.
     */
    createOrUpdateUser: (ctx, args) => admitIdentity(ctx, args),
  },
});
