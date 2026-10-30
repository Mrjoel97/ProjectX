"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordField, TextField } from "../fields";
import { ArrowIcon, GoogleIcon, LockIcon, MailIcon, StarIcon } from "../icons";
import { PasswordChallenge } from "../PasswordChallenge";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const providers = useQuery(api.invites.authProviders, {});
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<"verify" | "reset" | null>(null);
  const [codeRequested, setCodeRequested] = useState(false);

  /**
   * The OAuth buttons used to be `onClick={() => void signIn(…)}`. `void` discards the promise, so
   * a rejection went nowhere: no redirect, no message, no console entry — a button that did
   * nothing, indistinguishable from a dead page. Both auth pages show Google only after the
   * deployment's `authProviders` query confirms its credentials. That avoids a missing-provider
   * round trip; every other start-time refusal still lands here.
   *
   * SCOPE, HONESTLY: this catches failures raised while STARTING the flow. A failure inside
   * `/api/auth/callback/<provider>` is a server-side 500 with no redirect and no error parameter
   * (`@convex-dev/auth` only rewrites the destination on success), so it cannot be reported from
   * here — the browser simply never comes back. Read the Convex logs for those.
   */
  async function onOAuth(provider: string, label: string) {
    setError(null);
    setBusy(true);
    try {
      await signIn(provider, { redirectTo: "/dashboard" });
      // Deliberately NOT clearing `busy` on success: the browser is leaving for the provider, and
      // re-enabling the button would flash it live again mid-navigation.
    } catch {
      setError(`Could not start ${label} sign-in. Please try again.`);
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn("password", { email, password, flow: "signIn" });
      if (!result.signingIn) {
        setPassword("");
        setCodeRequested(true);
        setChallenge("verify");
        setBusy(false);
        return;
      }
      router.push("/dashboard");
    } catch {
      // Convex Auth doesn't distinguish "no such user" from "wrong password" to the
      // client — good, it prevents account enumeration. One honest message covers both.
      setError("Wrong email or password.");
      setBusy(false);
    }
  }

  if (challenge)
    return (
      <PasswordChallenge
        mode={challenge}
        email={email}
        codeRequested={codeRequested}
        onBack={() => {
          setChallenge(null);
          setBusy(false);
        }}
      />
    );

  return (
    <div className="auth-card">
      <div className="auth-badge">
        <StarIcon size={22} />
      </div>
      <h2 className="auth-title">Welcome back</h2>
      <p className="auth-tagline">Sign in to your workspace</p>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit}>
        <TextField
          label="Email Address"
          icon={<MailIcon />}
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@company.com"
          autoComplete="email"
          required
        />
        <PasswordField
          label="Password"
          icon={<LockIcon />}
          value={password}
          onChange={setPassword}
          placeholder="Enter your password"
          autoComplete="current-password"
        />
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign In"}
          {!busy && <ArrowIcon />}
        </button>
      </form>

      <button
        type="button"
        className="auth-google"
        disabled={busy}
        onClick={() => {
          setPassword("");
          setCodeRequested(false);
          setChallenge("verify");
        }}
      >
        Finish email verification
      </button>

      <button
        type="button"
        className="auth-google"
        disabled={busy}
        onClick={() => {
          setPassword("");
          setChallenge("reset");
        }}
      >
        Forgot your password?
      </button>

      {providers?.google === true && (
        <>
          <div className="auth-or">OR</div>
          <button
            type="button"
            className="auth-google"
            disabled={busy}
            onClick={() => void onOAuth("google", "Google")}
          >
            <GoogleIcon /> {busy ? "Connecting…" : "Continue with Google"}
          </button>
        </>
      )}

      <p className="auth-switch">
        Don&rsquo;t have an account? <Link href="/signup">Create one</Link>
      </p>
    </div>
  );
}
