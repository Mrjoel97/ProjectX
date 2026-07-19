"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  BellIcon,
  BoltIcon,
  BrainIcon,
  ChevronLeftIcon,
  FileIcon,
  GlobeIcon,
  GridIcon,
  MailIcon,
  MicIcon,
  PieIcon,
  ShieldIcon,
  SignOutIcon,
  TrendIcon,
  VaultIcon,
  WalletIcon,
} from "../(auth)/icons";
import { ReconnectBanner } from "./_components/ReconnectBanner";

// The authenticated shell: the brand's dark-teal left nav rail + light canvas
// (BRAND.md §4, brand-024016). The rail shows the full product nav; sections whose
// pages don't exist yet render disabled with a "Soon" tag — honest, no dead links.
// Knowledge Vault went LIVE with Phase 5 (lane-c merge): /dashboard/vault.
// The retired /submit and /review links are gone (cockpit supersession, Phase 3.1);
// the pages stay on disk and reachable by URL.
const NAV: Array<{ label: string; icon: ReactNode; href?: string; soon?: boolean }> = [
  { label: "Command Center", href: "/dashboard", icon: <GridIcon /> },
  { label: "Approvals", icon: <BellIcon />, soon: true },
  { label: "Finance", icon: <WalletIcon />, soon: true },
  { label: "Content", icon: <FileIcon />, soon: true },
  { label: "Sales Pipeline", icon: <TrendIcon />, soon: true },
  { label: "Compliance", href: "/ops", icon: <ShieldIcon size={18} /> },
  { label: "My Workspace", href: "/dashboard/workspace", icon: <BoltIcon size={18} /> },
  { label: "Live Voice", href: "/dashboard/voice", icon: <MicIcon size={18} /> },
  { label: "Reports", icon: <PieIcon />, soon: true },
  { label: "Knowledge Vault", href: "/dashboard/vault", icon: <VaultIcon /> },
  { label: "Join Community", icon: <GlobeIcon />, soon: true },
];

const RAIL_KEY = "pikar:rail-collapsed";

// OPSG-07: a failure nobody sees is a failure nobody fixes. This is an unread-mail
// badge, not a toast — `newCount` is a LIVE query, so the count reflects the DB and
// only falls when an operator marks the letter resolved. It never auto-clears and
// never dismisses on click. `undefined` = still loading → render nothing (no flash).
// It lives on the Compliance (/ops) rail item and stays visible when the rail collapses.
function DeadLetterBadge() {
  const count = useQuery(api.deadLetters.newCount);
  if (!count) return null;
  return (
    <span
      className="rail-badge"
      title={`${count} unresolved dead letter${count === 1 ? "" : "s"}`}
    >
      {count}
    </span>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { signOut } = useAuthActions();
  const pathname = usePathname();
  // Collapsed state persists per browser. Read after mount (SSR has no localStorage);
  // the brief expanded-first paint is acceptable.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(RAIL_KEY) === "1");
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem(RAIL_KEY, c ? "0" : "1");
      return !c;
    });

  // Exact match for /dashboard (it prefixes everything); prefix match elsewhere so
  // e.g. /review/[id]-style child routes keep their parent item lit.
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <div className="app-frame">
      <nav className={`rail${collapsed ? " is-collapsed" : ""}`} aria-label="Primary">
        <Link href="/dashboard" className="rail-brand">
          <span className="rail-logo">
            <BrainIcon size={22} />
          </span>
          <span className="rail-word">Pikar AI</span>
        </Link>

        <div className="rail-nav">
          {NAV.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className={`rail-item${isActive(item.href) ? " is-active" : ""}`}
                title={collapsed ? item.label : undefined}
              >
                {item.icon}
                <span className="rail-label">{item.label}</span>
                {item.href === "/ops" && <DeadLetterBadge />}
              </Link>
            ) : (
              <span key={item.label} className="rail-item is-soon" aria-disabled="true">
                {item.icon}
                <span className="rail-label">{item.label}</span>
                <span className="rail-soon">Soon</span>
              </span>
            ),
          )}
        </div>

        <div className="rail-foot">
          <Link
            href="/connect-gmail"
            className={`rail-item${isActive("/connect-gmail") ? " is-active" : ""}`}
            title={collapsed ? "Connect Gmail" : undefined}
          >
            <MailIcon />
            <span className="rail-label">Connect Gmail</span>
          </Link>
          <button
            type="button"
            className="rail-item"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : undefined}
          >
            <span style={{ display: "inline-flex", transform: collapsed ? "rotate(180deg)" : undefined }}>
              <ChevronLeftIcon />
            </span>
            <span className="rail-label">Collapse</span>
          </button>
          <button
            type="button"
            className="rail-item"
            onClick={() => void signOut()}
            title={collapsed ? "Sign Out" : undefined}
          >
            <SignOutIcon />
            <span className="rail-label">Sign Out</span>
          </button>
        </div>
      </nav>

      <div className="canvas-col">
        <ReconnectBanner />
        {/* The cockpit and the vault fuse full-bleed to the rail (no canvas padding — one
            surface, only the work floats); every other page stays cards-on-canvas. */}
        <main
          className={`canvas-main${
            /^\/dashboard\/(workspace|vault)/.test(pathname) ? " is-bleed" : ""
          }`}
        >
          {children}
        </main>
      </div>
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
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>Please sign in again to continue.</p>
          </>
        ) : (
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>{stalled ? "Still connecting…" : "Loading…"}</p>
        )}
        {showSignIn && (
          <Link
            href="/signin"
            style={{
              display: "inline-block",
              padding: "0.6rem 1.4rem",
              borderRadius: "0.5rem",
              background: "var(--teal-600)",
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
