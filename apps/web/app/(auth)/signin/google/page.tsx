"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

export default function GoogleReturnPage() {
  return (
    <Suspense fallback={<p>Checking your account…</p>}>
      <GoogleReturn />
    </Suspense>
  );
}

function GoogleReturn() {
  const router = useRouter();
  const mustMatch = useSearchParams().get("match") === "1";
  const { isAuthenticated, isLoading } = useConvexAuth();
  const actual = useQuery(api.invites.signedInEmail, isAuthenticated ? {} : "skip");
  const { signIn } = useAuthActions();
  const [expected, setExpected] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      setExpected(sessionStorage.getItem("pikar.google.expectedEmail"));
    } catch {
      setExpected(null);
    }
  }, []);
  const matches = mustMatch && !!expected && actual?.trim().toLowerCase() === expected;
  useEffect(() => {
    if (matches) router.replace("/dashboard");
  }, [matches, router]);
  if (!isLoading && !isAuthenticated)
    return <Link href="/signin">Sign in again to choose your Google account</Link>;
  if (actual === undefined || expected === undefined || matches)
    return <p role="status">Checking your account…</p>;
  return (
    <div className="auth-card">
      <h2 className="auth-title">Confirm your workspace</h2>
      <p className="auth-tagline">
        {actual ? (
          <>
            Google signed you in as <strong>{actual}</strong>.
          </>
        ) : (
          "We couldn't confirm this workspace's email."
        )}
      </p>
      {mustMatch && (
        <p role="alert">
          {expected ? (
            <>
              You requested <strong>{expected}</strong>. Choose that Google account to continue.
            </>
          ) : (
            "Return to sign-in and enter the email you want to use."
          )}
        </p>
      )}
      {!mustMatch && actual && (
        <button className="auth-submit" type="button" onClick={() => router.replace("/dashboard")}>
          Open workspace for {actual}
        </button>
      )}
      {(!mustMatch || expected) && (
        <button
          className="auth-google"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await signIn("google", {
                redirectTo: mustMatch ? "/signin/google?match=1" : "/signin/google",
              });
            } catch {
              setError("Google sign-in could not start. Try again.");
              setBusy(false);
            }
          }}
        >
          Choose another Google account
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <Link href="/signin" className="auth-switch">
        Back to sign in
      </Link>
    </div>
  );
}
