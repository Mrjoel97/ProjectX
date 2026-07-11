"use client";

import { useAuthActions } from "@convex-dev/auth/react";

// The whole front door: one button. signIn("google") hands off to Google's consent
// screen (openid email profile only — see convex/auth.ts), then Convex Auth sets the
// session cookie and the middleware stops redirecting. redirectTo brings the user to
// the app shell rather than back to a now-pointless sign-in page.
export default function SignIn() {
  const { signIn } = useAuthActions();
  return (
    <main className="prose" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <h1>Sign in to Pikar</h1>
        <p>Nothing sends without your approval. Sign in to begin.</p>
        <button
          type="button"
          onClick={() => void signIn("google", { redirectTo: "/dashboard" })}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
            borderRadius: "0.5rem",
            border: "1px solid var(--border, #d0d0d0)",
            background: "var(--surface, #fff)",
          }}
        >
          Sign in with Google
        </button>
      </div>
    </main>
  );
}
