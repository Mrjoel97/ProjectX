"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { ReconnectBanner } from "./_components/ReconnectBanner";

// The authenticated shell. Nav targets Submit/Requests/Review/Ops/Connect Gmail land in
// plans 02-08/09 — the links exist now, the pages arrive with them.
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/workspace", label: "Workspace" },
  { href: "/submit", label: "Submit" },
  { href: "/requests", label: "Requests" },
  { href: "/review", label: "Review queue" },
  { href: "/ops", label: "Ops" },
  { href: "/connect-gmail", label: "Connect Gmail" },
];

// OPSG-07: a failure nobody sees is a failure nobody fixes. This is an unread-mail
// badge, not a toast — `newCount` is a LIVE query, so the count reflects the DB and
// only falls when an operator marks the letter resolved. It never auto-clears and
// never dismisses on click. `undefined` = still loading → render nothing (no flash).
function DeadLetterBadge() {
  const count = useQuery(api.deadLetters.newCount);
  if (!count) return null;
  return (
    <Link
      href="/ops"
      title={`${count} unresolved dead letter${count === 1 ? "" : "s"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "1.5rem",
        height: "1.5rem",
        padding: "0 0.4rem",
        borderRadius: "999px",
        background: "#dc2626",
        color: "#fff",
        fontSize: "0.8rem",
        fontWeight: 700,
        textDecoration: "none",
      }}
    >
      {count}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { signOut } = useAuthActions();
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid var(--border, #e5e5e5)",
        }}
      >
        <Link href="/dashboard" style={{ fontWeight: 800, textDecoration: "none" }}>
          Pikar
        </Link>
        <nav style={{ display: "flex", gap: "1rem", flex: 1 }}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              {item.label}
            </Link>
          ))}
        </nav>
        <DeadLetterBadge />
        <button type="button" onClick={() => void signOut()} style={{ cursor: "pointer" }}>
          Sign out
        </button>
      </header>
      <ReconnectBanner />
      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  );
}

// Auth-state gate. Every page under (app) issues tenant-scoped queries that fail closed
// without an identity — so if the Convex CLIENT has no auth token yet, those queries hang
// `undefined` forever and the page shows an eternal "Loading…" (the connect-gmail bug: the
// server cookie let the route through, but the client token wasn't attached). Rendering
// children ONLY inside <Authenticated> guarantees a token exists before any query mounts;
// the loading/signed-out branches give a real re-auth path instead of a silent spinner.
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Authenticated>
        <Shell>{children}</Shell>
      </Authenticated>
      <AuthLoading>
        <AuthGate variant="loading" />
      </AuthLoading>
      <Unauthenticated>
        <AuthGate variant="signedout" />
      </Unauthenticated>
    </>
  );
}

function AuthGate({ variant }: { variant: "loading" | "signedout" }) {
  // A token that never resolves must not strand the user on a spinner — after a short wait
  // even the loading state offers a manual re-sign-in. This is what makes the infinite
  // "Loading…" impossible: it always resolves to content, a prompt, or a re-auth link.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (variant !== "loading") return;
    const t = setTimeout(() => setStalled(true), 6000);
    return () => clearTimeout(t);
  }, [variant]);

  const showSignIn = variant === "signedout" || stalled;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <div style={{ textAlign: "center", maxWidth: "22rem", display: "grid", gap: "0.75rem", justifyItems: "center" }}>
        {variant === "signedout" ? (
          <>
            <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Your session ended</h1>
            <p style={{ color: "#555", margin: 0 }}>Please sign in again to continue.</p>
          </>
        ) : (
          <p style={{ color: "#555", margin: 0 }}>{stalled ? "Still connecting…" : "Loading…"}</p>
        )}
        {showSignIn && (
          <Link
            href="/signin"
            style={{
              display: "inline-block",
              padding: "0.6rem 1.4rem",
              borderRadius: "0.5rem",
              background: "#009689",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Sign in again
          </Link>
        )}
      </div>
    </main>
  );
}
