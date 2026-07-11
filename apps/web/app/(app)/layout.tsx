"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ReconnectBanner } from "./_components/ReconnectBanner";

// The authenticated shell. Nav targets Submit/Requests/Review/Ops/Connect Gmail land in
// plans 02-08/09 — the links exist now, the pages arrive with them.
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
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

export default function AppShell({ children }: { children: ReactNode }) {
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
