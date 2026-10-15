"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordField, TextField } from "./fields";
import { LockIcon, MailIcon } from "./icons";

export function PasswordChallenge({
  mode,
  email: initialEmail,
  onBack,
}: {
  mode: "verify" | "reset";
  email: string;
  onBack: () => void;
}) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [requested, setRequested] = useState(mode === "verify");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email, flow: mode === "reset" ? "reset" : "email-verification" });
      setRequested(true);
    } catch {
      // Do not reveal whether a mailbox has a password account.
      setRequested(true);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!requested) return requestCode();
    setError(null);
    if (mode === "reset" && (password.length < 8 || password !== confirm)) {
      setError("Use at least 8 characters and matching passwords.");
      return;
    }
    setBusy(true);
    try {
      const result = await signIn("password", {
        email,
        code: code.trim(),
        flow: mode === "reset" ? "reset-verification" : "email-verification",
        ...(mode === "reset" ? { newPassword: password } : {}),
      });
      if (!result.signingIn) throw new Error("not verified");
      router.push("/dashboard");
    } catch {
      setError("We couldn't verify that code. Check your details or request a new code.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h2 className="auth-title">
        {mode === "verify" ? "Verify your email" : "Reset your password"}
      </h2>
      <p className="auth-tagline" role="status">
        {requested
          ? "If your account is eligible, a code has been sent. It expires in 15 minutes."
          : "Enter the email address you use to sign in."}
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <TextField
          label="Email address"
          icon={<MailIcon />}
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setCode("");
          }}
          autoComplete="email"
          required
        />
        {requested && (
          <TextField
            label="Verification code"
            icon={<LockIcon />}
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            required
          />
        )}
        {requested && mode === "reset" && (
          <>
            <PasswordField
              label="New password"
              icon={<LockIcon />}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirm new password"
              icon={<LockIcon />}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
          </>
        )}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : !requested
              ? "Send code"
              : mode === "reset"
                ? "Reset password"
                : "Verify email"}
        </button>
      </form>
      {requested && (
        <button
          className="auth-google"
          type="button"
          disabled={busy}
          onClick={() => void requestCode()}
        >
          Send a new code
        </button>
      )}
      <button className="auth-google" type="button" disabled={busy} onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}
