"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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

/**
 * BETA-01 signup. ONE public route serves both doors — an invited person redeeming a code, and a
 * stranger asking to be let in later — because a second route is a second thing to keep in sync
 * and the state that distinguishes them is a single query parameter.
 *
 * WHAT THIS PAGE IS NOT: the authorization boundary. `invites.preflight` is a COURTESY that spares
 * an invited user a pointless OAuth round trip; `admitIdentity` inside the auth transaction is what
 * actually decides. Nothing here may be relied on for admission, and nothing here should imply it.
 */
export default function SignUpRoute() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={<div className="auth-card" />}>
      <SignUp />
    </Suspense>
  );
}

function SignUp() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const params = useSearchParams();

  // The code is VISIBLE and EDITABLE, never a hidden field: a person who mistypes it, or who was
  // sent a link that wrapped in their mail client, must be able to see and fix it.
  const [code, setCode] = useState(params.get("invite") ?? "");
  // Which door is open. Derived from the URL ONCE, then owned by the user: deriving it from
  // `code` being non-empty would trap someone who clears the field to retype, and would make the
  // "Enter it" link depend on setting a non-empty placeholder.
  const [redeeming, setRedeeming] = useState(
    Boolean(params.get("invite")) || params.get("r") === "1",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const providers = useQuery(api.invites.authProviders, {});
  // Skip the round trip until there is something worth checking.
  const preflight = useQuery(api.invites.preflight, code.trim() ? { code } : "skip");
  const codeAccepted = preflight?.valid === true;

  // `r=1` means we sent this browser to a provider and it came back still signed out. That is
  // either a cancelled consent screen or a refused admission, and the page cannot tell which —
  // so the copy must be true of both.
  const returnedSignedOut = params.get("r") === "1";

  // A provider round trip loses component state, so the code has to survive in the URL.
  const oauthReturn = `/signup?invite=${encodeURIComponent(code.trim())}&r=1`;

  /**
   * These buttons were `onClick={() => void signIn(…)}`. `void` discards the promise, so a
   * rejection went nowhere — no redirect, no message, nothing in the console. A button that does
   * nothing is indistinguishable from a dead page, and the user retries instead of reporting it.
   *
   * SCOPE, HONESTLY: this reports failures raised while STARTING the flow. A failure inside
   * `/api/auth/callback/<provider>` is a server-side 500 with no redirect and no error parameter
   * (`@convex-dev/auth` rewrites the destination only on success), so it cannot surface here — the
   * browser never comes back to this page. Those live in the Convex logs.
   */
  async function onOAuth(provider: string, label: string) {
    setError(null);
    setBusy(true);
    try {
      await signIn(provider, { redirectTo: oauthReturn });
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
      // The code travels with the credentials: a password email is self-asserted, so admission
      // requires the code itself as well as a matching invited address.
      await signIn("password", { name, email, password, inviteCode: code, flow: "signUp" });
      router.push("/dashboard");
    } catch {
      // Deliberately one message for every refusal. Distinguishing "not invited" from "already
      // registered" would turn this form into a directory of who is on the list.
      setError("We couldn't create that account. Check the invite code and email address.");
      setBusy(false);
    }
  }

  // NO INVITE → the waitlist door.
  if (!redeeming) {
    return <Waitlist onHasCode={() => setRedeeming(true)} />;
  }

  return (
    <div className="auth-card">
      <div className="auth-badge">
        <StarIcon size={22} />
      </div>
      <h2 className="auth-title">Create Account</h2>
      <p className="auth-tagline">Pikar AI is in private beta</p>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {returnedSignedOut && !error && (
        <p className="auth-error" role="alert">
          You're not signed in. Either the sign-in was cancelled, or this invite doesn't match the
          account you used. An invite works only for the address it was sent to.
        </p>
      )}

      <TextField
        label="Invite code"
        icon={<StarIcon size={16} />}
        value={code}
        onChange={setCode}
        placeholder="ABCD-EFGH-JKMN-PQRS"
        autoComplete="off"
      />

      <p
        className={codeAccepted ? "auth-tagline" : "auth-error"}
        role="status"
        style={{ marginTop: "-0.4rem" }}
      >
        {preflight === undefined
          ? "Checking your invite…"
          : codeAccepted
            ? `Invite recognised for ${preflight.invitedEmailMasked}. Sign up with that address.`
            : "That invite code isn't valid. It may have been used already, or mistyped."}
      </p>

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
        {/* Disabled until preflight accepts, so an invited user is not sent through a signup that
            cannot succeed. The server still refuses independently — this is courtesy, not a gate. */}
        <button type="submit" className="auth-submit" disabled={busy || !codeAccepted}>
          {busy ? "Creating account…" : "Create Account"}
          {!busy && <ArrowIcon />}
        </button>
      </form>

      <div className="auth-or">OR</div>

      {providers?.google !== false && (
        <button
          type="button"
          className="auth-google"
          disabled={!codeAccepted || busy}
          onClick={() => void onOAuth("google", "Google")}
        >
          <GoogleIcon /> {busy ? "Connecting…" : "Continue with Google"}
        </button>
      )}

      {/* Rendered only where the deployment actually holds Entra credentials. A button that
          dead-ends at the provider is worse than no button — see beta-admission.md. */}
      {providers?.microsoft === true && (
        <button
          type="button"
          className="auth-google"
          disabled={!codeAccepted || busy}
          style={{ marginTop: "0.6rem" }}
          onClick={() => void onOAuth("microsoft-entra-id", "Microsoft")}
        >
          {busy ? "Connecting…" : "Continue with Microsoft"}
        </button>
      )}

      <p className="auth-switch" style={{ marginBottom: "0.2rem" }}>
        Sign in with the same provider you used at signup — accounts aren't linked across providers
        during the beta.
      </p>
      <p className="auth-switch">
        Already have an account? <Link href="/signin">Sign in</Link>
      </p>
    </div>
  );
}

/** The no-code door: ask to be let in. Never promises a timeline. */
function Waitlist({ onHasCode }: { onHasCode: (code: string) => void }) {
  const requestAccess = useMutation(api.invites.requestAccess);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [referral, setReferral] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestAccess({ email, name: name || undefined, referral: referral || undefined });
      setSent(true);
    } catch {
      setError("That doesn't look like an email address we can reach.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="auth-card">
        <div className="auth-badge">
          <CheckCircleIcon size={22} />
        </div>
        <h2 className="auth-title">You're on the list</h2>
        {/* No timeline, and no claim about position or ordering — neither is knowable here. */}
        <p className="auth-tagline">
          We've recorded your request. If a place opens up you'll get an invite link by email.
        </p>
        <p className="auth-switch">
          Already have an invite code?{" "}
          <button
            type="button"
            className="auth-linklike"
            onClick={() => {
              setSent(false);
              onHasCode(" ");
            }}
          >
            Enter it
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div className="auth-badge">
        <StarIcon size={22} />
      </div>
      <h2 className="auth-title">Request access</h2>
      <p className="auth-tagline">Pikar AI is in private beta — signup is by invite.</p>

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
        <TextField
          label="Full Name"
          icon={<UserIcon />}
          value={name}
          onChange={setName}
          placeholder="John Doe"
          autoComplete="name"
        />
        <TextField
          label="How did you hear about us?"
          icon={<StarIcon size={16} />}
          value={referral}
          onChange={setReferral}
          placeholder="Optional"
          autoComplete="off"
        />
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "Sending…" : "Request access"}
          {!busy && <ArrowIcon />}
        </button>
      </form>

      <p className="auth-switch" style={{ marginBottom: "0.2rem" }}>
        Have an invite code?{" "}
        <button type="button" className="auth-linklike" onClick={() => onHasCode(" ")}>
          Enter it
        </button>
      </p>
      <p className="auth-switch">
        Already have an account? <Link href="/signin">Sign in</Link>
      </p>
    </div>
  );
}
