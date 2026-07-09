import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Password provider ONLY for the single-owner beta. Invite gating is Phase 9.
export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Password],
});
