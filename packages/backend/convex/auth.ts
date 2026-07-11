import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// Google is the sign-in provider for the beta. The front door asks for ONLY
// `openid email profile` — identity, nothing more. The restricted `gmail.modify`
// scope is a separate, later, explicit consent (the /connect-gmail flow, plan 02-05):
// signing in must never silently hand an agent your mailbox.
// auth.ts stays on the raw-builder allowlist (CLAUDE.md §2) — convexAuth wires the
// generated query/mutation/action itself.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google({ authorization: { params: { scope: "openid email profile" } } })],
});
