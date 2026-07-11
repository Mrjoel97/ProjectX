import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Email + password is a real sign-in method (alongside Google). The `profile` mapping
// captures the sign-up Full Name onto the users row; password rules enforce a minimum
// length. Email verification + password reset are the security fast-follow — they use
// this provider's `verify`/`reset` options and need a transactional email sender.
// ponytail: length-only password rule for the closed beta; strength/breach checks +
// verify/reset land with the email sender.
const password = Password({
  profile(params) {
    const p: { email: string; name?: string } = { email: params.email as string };
    if (typeof params.name === "string" && params.name.trim()) p.name = params.name.trim();
    return p;
  },
  validatePasswordRequirements: (pw) => {
    if (pw.length < 8) throw new Error("Password must be at least 8 characters.");
  },
});

// Two front doors: Google (openid email profile ONLY — mailbox access is the separate
// gmail.modify consent in /connect-gmail) and email+password. auth.ts stays on the
// raw-builder allowlist (CLAUDE.md §2) — convexAuth wires the generated fns itself.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google({ authorization: { params: { scope: "openid email profile" } } }), password],
});
