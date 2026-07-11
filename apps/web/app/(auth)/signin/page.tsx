"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordField, TextField } from "../fields";
import { ArrowIcon, GoogleIcon, LockIcon, MailIcon, StarIcon } from "../icons";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn("password", { email, password, flow: "signIn" });
      router.push("/dashboard");
    } catch {
      // Convex Auth doesn't distinguish "no such user" from "wrong password" to the
      // client — good, it prevents account enumeration. One honest message covers both.
      setError("Wrong email or password.");
      setBusy(false);
    }
  }

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

      <div className="auth-or">OR</div>

      <button
        type="button"
        className="auth-google"
        onClick={() => void signIn("google", { redirectTo: "/dashboard" })}
      >
        <GoogleIcon /> Continue with Google
      </button>

      <p className="auth-switch">
        Don&rsquo;t have an account? <Link href="/signup">Create one</Link>
      </p>
    </div>
  );
}
