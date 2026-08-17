"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordField, TextField } from "../fields";
import {
  ArrowIcon,
  CheckCircleIcon,
  GoogleIcon,
  LockIcon,
  MailIcon,
  StarIcon,
  UserIcon,
} from "../icons";

export default function SignUp() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The OAuth button used to be `onClick={() => void signIn(…)}`. `void` discards the promise, so a
   * rejection went nowhere: no redirect, no message, no console entry — a button that did nothing,
   * which a user cannot tell apart from a dead page.
   *
   * SCOPE, HONESTLY: this reports failures raised while STARTING the flow. A failure inside
   * `/api/auth/callback/<provider>` is a server-side 500 with no redirect and no error parameter
   * (`@convex-dev/auth` rewrites the destination only on success), so it cannot surface here — the
   * browser never comes back to this page. Those are found in the Convex logs.
   */
  async function onOAuth(provider: string, label: string) {
    setError(null);
    setBusy(true);
    try {
      await signIn(provider, { redirectTo: "/dashboard" });
      // `busy` deliberately stays set on success: the browser is leaving for the provider, and
      // re-enabling the button would flash it live again mid-navigation.
    } catch {
      setError(`Could not start ${label} sign-in. Please try again.`);
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Client-side guards mirror the server: the server is still the trust boundary
    // (validatePasswordRequirements + the "password" flow), these just spare a round trip.
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await signIn("password", { name, email, password, flow: "signUp" });
      router.push("/dashboard");
    } catch {
      setError("Could not create the account — that email may already be registered.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-badge">
        <StarIcon size={22} />
      </div>
      <h2 className="auth-title">Create Account</h2>
      <p className="auth-tagline">Start your AI journey today</p>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit}>
        <TextField
          label="Full Name"
          icon={<UserIcon />}
          value={name}
          onChange={setName}
          placeholder="John Doe"
          autoComplete="name"
          required
        />
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
          placeholder="Create a password"
          autoComplete="new-password"
        />
        <PasswordField
          label="Confirm Password"
          icon={<CheckCircleIcon />}
          value={confirm}
          onChange={setConfirm}
          placeholder="Confirm password"
          autoComplete="new-password"
        />
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "Creating account…" : "Create Account"}
          {!busy && <ArrowIcon />}
        </button>
      </form>

      <div className="auth-or">OR</div>

      <button
        type="button"
        className="auth-google"
        disabled={busy}
        onClick={() => void onOAuth("google", "Google")}
      >
        <GoogleIcon /> {busy ? "Connecting…" : "Continue with Google"}
      </button>

      <p className="auth-switch">
        Already have an account? <Link href="/signin">Sign in</Link>
      </p>
    </div>
  );
}
