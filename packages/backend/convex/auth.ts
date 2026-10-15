import Google from "@auth/core/providers/google";
import MicrosoftEntraID from "@auth/core/providers/microsoft-entra-id";
import {
  ConvexCredentials,
  type ConvexCredentialsUserConfig,
} from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { AUTH_JWT_DURATION_MS } from "@pikar/core/authLifetime";
import { internal } from "./_generated/api";
import { admitIdentity } from "./invites";
import {
  authEmailProvider,
  requireAuthEmailConfiguration,
  reserveAuthEmail,
} from "./lib/authEmail";

// Verification is always required: missing sender configuration fails closed. Existing
// password accounts verify on their next sign-in; OAuth admission is unchanged.
const passwordBase = Password({
  verify: authEmailProvider("verify"),
  reset: authEmailProvider("reset"),
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
    if (typeof pw !== "string" || pw.length < 8)
      throw new Error("Password must be at least 8 characters.");
  },
});

// The pinned provider stores its implementation in options (Auth.js providerDefaults
// materializes it). Preserve token replay/expiry checks and reset session invalidation,
// while hiding account-existence errors at the public boundary.
const passwordOptions = (passwordBase as unknown as { options: ConvexCredentialsUserConfig })
  .options;
export const password = ConvexCredentials({
  ...passwordOptions,
  async authorize(params, ctx) {
    const resetRequest = params.flow === "reset";
    try {
      requireAuthEmailConfiguration();
      if (resetRequest) {
        if (typeof params.email !== "string" || params.email.length > 320) return null;
        await reserveAuthEmail(ctx, params.email);
      }
      const result = await passwordOptions.authorize(params, ctx);
      if (params.flow === "reset-verification" && result) {
        await ctx.runMutation(internal.authRevocations.requireLiveSessions, {
          userId: result.userId,
        });
      }
      return result;
    } catch {
      // Same result for missing account, throttling, provider outage, and successful
      // request. Never expose the installed provider's InvalidAccountId error.
      if (resetRequest) return null;
      throw new Error("AUTHENTICATION_FAILED");
    }
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
    // Admission matches an invite on this address, so whether the PROVIDER vouches for it is part
    // of the security decision and has to travel with it. Google sets `email_verified` on its own
    // accounts; comparing to `true` rather than coercing means a missing claim reads as NOT
    // verified. See the refusal in `admitIdentity`.
    emailVerified: p.email_verified === true,
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
    /**
     * **ENTRA DOES NOT VERIFY `email` OR `preferred_username`, AND THIS IS THE nOAuth CLASS.**
     * The `email` claim is settable by a user or a tenant admin on accounts they control, so an
     * address here is a CLAIM, not a proof — treating it as proof lets someone who knows an
     * invited address redeem that invite. `xms_edov` ("email domain owner verified") is the only
     * claim that answers it, it is OPTIONAL, and it must be turned on per app registration
     * (Token configuration → add optional claim → `xms_edov`, for both ID and access tokens).
     *
     * So this is `false` until that claim is configured AND true, and `admitIdentity` refuses
     * OAuth admission without it. That fails CLOSED: with Entra sign-in enabled but `xms_edov`
     * unconfigured, an invited user signs up with Google or with password + code instead. Do NOT
     * "fix" a refusal here by defaulting this to true.
     */
    emailVerified: (p as { xms_edov?: boolean }).xms_edov === true,
    name: p.name,
  }),
});

// Three front doors: Google, Microsoft Entra ID (openid email profile ONLY — mailbox access is
// the separate consent in /connect-gmail and /connect-microsoft) and email+password. auth.ts
// stays on the raw-builder allowlist (CLAUDE.md §2) — convexAuth wires the generated fns itself.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [google, microsoft, password],
  jwt: { durationMs: AUTH_JWT_DURATION_MS },
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
