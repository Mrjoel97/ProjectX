"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@pikar/backend/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  BellIcon,
  BoltIcon,
  BrainIcon,
  ChevronLeftIcon,
  FileIcon,
  GridIcon,
  MailIcon,
  MicIcon,
  PieIcon,
  ShieldIcon,
  SignOutIcon,
  TrendIcon,
  UserIcon,
  VaultIcon,
  WalletIcon,
} from "../(auth)/icons";
import { NotificationsBanner } from "./_components/NotificationsBanner";
import { ReconnectBanner } from "./_components/ReconnectBanner";
import { AbnormalBriefBanner } from "./dashboard/voice/AbnormalBriefBanner";

// The authenticated shell: the brand's dark-teal left nav rail + light canvas
// (BRAND.md §4, brand-024016). The rail shows the full product nav; sections whose
// pages don't exist yet render disabled with a "Soon" tag — honest, no dead links.
// Approvals is FULLY live: the owner approved its UAT on 2026-08-08 (26-05 Task 2), which is what
// unblocked its `ApprovalsBadge` count. Rollback is still one link: delete the NAV entry and the
// route goes undiscoverable without touching plan state, provenance or the read model.
// Knowledge Vault went LIVE with Phase 5 (lane-c merge): /dashboard/vault.
// The retired /submit and /review links are gone (cockpit supersession, Phase 3.1);
// the pages stay on disk and reachable by URL.
// 25.2: every entry has an href (the "Soon" placeholder is gone) and `ownerOnly` hides the
// operator surfaces from tenants — the URL still resolves for the owner.
const NAV: Array<{ label: string; icon: ReactNode; href: string; ownerOnly?: boolean }> = [
  { label: "Command Center", href: "/dashboard", icon: <GridIcon /> },
  { label: "Approvals", href: "/dashboard/approvals", icon: <BellIcon /> },
  // Activated 26-10 Task 3 on owner direction, 2026-08-09. The branch below keys off `href`, not
  // `soon`, so adding the href IS the activation. Rollback is deleting the href — the ledger
  // writers, coverage start and enforcement limiters keep running regardless (the non-negotiable
  // rule in docs/playbooks/dashboard-pages.md: a dark window is a permanent hole in the record).
  { label: "Finance", href: "/dashboard/finance", icon: <WalletIcon /> },
  // Activated 26-13 Task 3 after the owner's UAT approval, 2026-08-22 ("the page is minimalistic,
  // it works great"). Same mechanism as Finance above: the branch below keys off `href`, so adding
  // it IS the activation and ROLLBACK IS DELETING THIS href.
  //
  // What rollback does NOT touch, and must not: an artifact's `origin`. A promoted document stays
  // `agent_promoted` whether or not this page is reachable — promotion is a trust decision the user
  // made about their own reference material, not a property of a route. Silently demoting on
  // rollback would rewrite a decision the user took, and `patchCreatedDoc` would then let the agent
  // revise a document it had already been told to treat as a source.
  { label: "Content", href: "/dashboard/content", icon: <FileIcon /> },
  { label: "Sales Pipeline", href: "/dashboard/pipeline", icon: <TrendIcon /> },
  // Compliance is a TAB on the approvals page now, not its own route. `/ops` still resolves
  // (ops/page.tsx keeps a default export) so old bookmarks survive, but the rail sends people
  // to the consolidated surface. The owner gate travels with `ComplianceView` itself, so this
  // href change moves a mount point and NOT an authorization boundary.
  {
    label: "Compliance",
    href: "/dashboard/approvals?tab=compliance",
    icon: <ShieldIcon size={18} />,
    // 25.2 (G14): eval signals and dead letters are the OPERATOR's read. `ComplianceView` gates
    // only its optimizer panel on the owner, so the rail entry itself carries the gate.
    ownerOnly: true,
  },
  { label: "My Workspace", href: "/dashboard/workspace", icon: <BoltIcon size={18} /> },
  { label: "Live Voice", href: "/dashboard/voice", icon: <MicIcon size={18} /> },
  // 26-17 Task 3: LIVE on the owner UAT verdict, 2026-08-22 ("The report interface is okay").
  // The branch keys off `href`, so ROLLBACK IS DELETING IT — and rollback touches no data: a
  // generated board pack is an ordinary vault row, and nothing on that rail rewrites one.
  { label: "Reports", href: "/dashboard/reports", icon: <PieIcon /> },
  { label: "Knowledge Vault", href: "/dashboard/vault", icon: <VaultIcon /> },
];

const RAIL_KEY = "pikar:rail-collapsed";

// 25.2 (G15): below 48rem the rail is hidden by CSS and these four NAV entries become a labelled
// bottom bar. Derived from NAV, so a renamed rail entry renames its tab.
const TABBAR_HREFS = [
  "/dashboard",
  "/dashboard/approvals",
  "/dashboard/workspace",
  "/dashboard/vault",
];

// OPSG-07: a failure nobody sees is a failure nobody fixes. This is an unread-mail
// badge, not a toast — `newCount` is a LIVE query, so the count reflects the DB and
// only falls when an operator marks the letter resolved. It never auto-clears and
// never dismisses on click. `undefined` = still loading → render nothing (no flash).
// It lives on the Compliance (/ops) rail item and stays visible when the rail collapses.
function DeadLetterBadge() {
  const count = useQuery(api.deadLetters.newCount);
  if (!count) return null;
  return (
    <span className="rail-badge" title={`${count} unresolved dead letter${count === 1 ? "" : "s"}`}>
      {count}
    </span>
  );
}

// 26-05 Task 3 (post owner-UAT approval). The rail count and the Approvals page read the SAME
// `approvals.summary` subscription, so the badge cannot disagree with the page it links to — the
// plan's "one shared subscription" key link. Shaped on DeadLetterBadge deliberately: `undefined`
// (still loading) and 0 both render nothing, so the rail never flashes a zero or a stale number.
// `awaitingCountCapped` is surfaced as "N+" rather than silently reporting the capped figure as
// exact — the same honesty rule the page's partial notice follows.
function ApprovalsBadge() {
  const summary = useQuery(api.approvals.summary);
  if (!summary?.awaitingCount) return null;
  const label = `${summary.awaitingCount}${summary.awaitingCountCapped ? "+" : ""}`;
  return (
    <span
      className="rail-badge"
      title={`${label} plan${summary.awaitingCount === 1 && !summary.awaitingCountCapped ? "" : "s"} awaiting your approval`}
    >
      {label}
    </span>
  );
}

// ONBD-01 first-run gate. Lives HERE in the client shell (never middleware.ts — that has no DB
// access and would re-introduce the eternal-spinner class of bug this component was built to kill).
// A tenant with no committed business_profile is force-redirected to onboarding and can't reach any
// other (app) route until they commit one; navigating away re-fires the redirect (pathname changes →
// off-onboarding again → effect runs). `undefined` = status still loading → hold the shell on the
// existing loader rather than flash the cockpit before the redirect.
const ONBOARDING_PATH = "/dashboard/onboarding";

function Shell({ children }: { children: ReactNode }) {
  const { signOut } = useAuthActions();
  const pathname = usePathname();
  const router = useRouter();

  const onboarding = useQuery(api.onboarding.status);
  // 25.2: the one client owner flag (admin, finance tabs and the workspace menu use the same query).
  const viewer = useQuery(api.owner.viewer, {});
  const isOwner = viewer?.isOwner === true;
  const onOnboarding = pathname === ONBOARDING_PATH;
  useEffect(() => {
    if (onboarding?.needsOnboarding && !onOnboarding) router.replace(ONBOARDING_PATH);
  }, [onboarding, onOnboarding, router]);
  // Loading the gate signal, or a redirect is in flight: show the shell's own loader, not children.
  const gateBusy = onboarding === undefined || (onboarding.needsOnboarding && !onOnboarding);
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
  // e.g. /review/[id]-style child routes keep their parent item lit. A nav href may carry a
  // `?tab=` deep link, but `usePathname()` never does — so compare the path portion only,
  // otherwise such an item can never light up.
  // ponytail: "Business Profile" and "Connections" both strip to /dashboard/profile, so both
  // light up at once (known, PARKED — 2026-08-02 whole-branch review MED 3). Fixing it cleanly
  // needs either useSearchParams or a layout-level `?tab=` mirror that goes stale the moment the
  // user switches tabs in-page without a navigation; cosmetic only, not worth either cost yet.
  // Upgrade path: once useSearchParams (or an equivalent live signal) is adopted elsewhere, drive
  // this off the actual selected tab instead of the path prefix.
  const isActive = (href: string) => {
    // ponytail: pathname-only match, so entries that differ ONLY by `?tab=` all highlight
    // together — "Approvals" + "Compliance" now, and "Business Profile" + "Connections" +
    // "Settings" (the profile pair already behaved this way before the consolidation). Making
    // exactly one win needs the live query string in this shell, i.e. `useSearchParams` here plus
    // a Suspense boundary around the rail; that is a shell refactor, not a nav-wiring change, so
    // it is deliberately not done here. Upgrade path: extract <RailNav> and give it that boundary.
    // String.split always returns at least one element, so this index is never undefined.
    const path = href.split("?")[0] ?? "";
    return path === "/dashboard" ? pathname === path : pathname.startsWith(path);
  };

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
          {NAV.filter((item) => !item.ownerOnly || isOwner).map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`rail-item${isActive(item.href) ? " is-active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              <span className="rail-label">{item.label}</span>
              {item.href === "/dashboard/approvals?tab=compliance" && <DeadLetterBadge />}
              {item.href === "/dashboard/approvals" && <ApprovalsBadge />}
            </Link>
          ))}
        </div>

        <div className="rail-foot">
          <Link
            href="/dashboard/profile"
            className={`rail-item${isActive("/dashboard/profile") ? " is-active" : ""}`}
            title={collapsed ? "Business Profile" : undefined}
          >
            <UserIcon />
            <span className="rail-label">Business Profile</span>
          </Link>
          {/* Back to <Link> (was a plain <a> that forced a full document reload). That workaround
              existed only because profile/page.tsx snapshotted `?tab=` at mount and a same-route
              soft navigation does not remount. That page now derives both tab levels from
              `useSearchParams` on every render, so soft navigation is correct again and the reload
              is no longer needed. Do NOT reintroduce the <a> without first re-breaking that page. */}
          <Link
            href="/dashboard/profile?tab=connections"
            className={`rail-item${isActive("/dashboard/profile?tab=connections") ? " is-active" : ""}`}
            title={collapsed ? "Connections" : undefined}
          >
            <MailIcon />
            <span className="rail-label">Connections</span>
          </Link>
          <Link
            href="/dashboard/profile?tab=settings"
            className={`rail-item${isActive("/dashboard/profile?tab=settings") ? " is-active" : ""}`}
            title={collapsed ? "Settings" : undefined}
          >
            <ShieldIcon size={18} />
            <span className="rail-label">Settings</span>
          </Link>
          <button
            type="button"
            className="rail-item"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : undefined}
          >
            <span
              style={{
                display: "inline-flex",
                transform: collapsed ? "rotate(180deg)" : undefined,
              }}
            >
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

      <nav className="tabbar" aria-label="Primary (compact)">
        {NAV.filter((item) => TABBAR_HREFS.includes(item.href)).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`tabbar-item${isActive(item.href) ? " is-active" : ""}`}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            {item.icon}
            <span className="tabbar-label">{item.label}</span>
            {item.href === "/dashboard/approvals" && <ApprovalsBadge />}
          </Link>
        ))}
      </nav>

      <div className="canvas-col">
        <ReconnectBanner />
        {/* A voice session dropped on a closed tab was auto-briefed with no one present to review
            it — surface it here on next app open (VOIC-03, dropped-session half). */}
        <AbnormalBriefBanner />
        {/* OPSG-05 in-app half: the general failure-notification matrix (timeouts, escalations,
            retry-limit breaches, dead-letter). gmail_reconnect stays with ReconnectBanner above. */}
        <NotificationsBanner />
        {/* The cockpit and the vault fuse full-bleed to the rail (no canvas padding — one
            surface, only the work floats); every other page stays cards-on-canvas. */}
        <main
          className={`canvas-main${
            /^\/dashboard\/(workspace|vault)/.test(pathname) ? " is-bleed" : ""
          }`}
        >
          {gateBusy ? (
            <p style={{ color: "var(--ink-soft)", margin: "2rem" }}>Loading…</p>
          ) : (
            children
          )}
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
      <div
        style={{
          textAlign: "center",
          maxWidth: "22rem",
          display: "grid",
          gap: "0.75rem",
          justifyItems: "center",
        }}
      >
        {variant === "signedout" ? (
          <>
            <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Your session ended</h1>
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>Please sign in again to continue.</p>
          </>
        ) : (
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>
            {stalled ? "Still connecting…" : "Loading…"}
          </p>
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
