"use client";

import { api } from "@pikar/backend/api";
import type { BusinessProfile } from "@pikar/core";
import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { BillingPanel } from "../settings/BillingPanel";
import { DataControls } from "../settings/DataControls";
import { ErrorBoundary } from "../workspace/ErrorBoundary";
import { BlueprintPanel } from "./BlueprintPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { NarrativePanel } from "./NarrativePanel";
import { ShapePanel } from "./ShapePanel";
import { label } from "./styles";
import { VerticalPackRecommendations } from "./VerticalPackRecommendations";

// ONBD-02 dedicated profile page — the post-onboarding EDIT surface. Editability is a locked
// decision: a user (especially an idea-stage one who onboarded sparse — only oneLineDescription)
// returns here to enrich name/offering/target-customer as the idea matures, and to correct
// anything, WITHOUT re-onboarding. It reuses the onboarding review-card shape + BRAND §5 tokens (no
// new component library, §10).
//
// Phase 15.1 (design §9) — TWO surfaces, TWO writers, and the difference is the whole point:
//
//   • The BUSINESS SHAPE card writes the tier FACTS through `api.tenantProfile.saveFacts`, which
//     RE-DERIVES the tier from them. **There is no tier argument to send and there never will be.**
//     Editing headcount to 12 moves the tier; nothing sets it directly. That is the entire
//     anti-manipulation mechanism, and it is mostly a subtraction (design §9): the three persona
//     pills were DELETED in plan 03 and a source scan in `businessProfile.test.ts` keeps them gone.
//   • The NARRATIVE card writes the Lean-core fields through `api.onboarding.updateProfile`, which
//     RE-EMBEDS the vault doc in place so grounding always reads the current profile.
//
// The tier itself is rendered READ-ONLY with `TIER_REASON` and an honest `tierSource` — deliberately
// as TEXT, never as a disabled picker, because a greyed-out control still reads as "there is a
// control here". A tier MOVE is surfaced as an EVENT (design §9: "tier change is a moment, not a
// setting"), driven off `saveFacts`'s `changed` flag.
//
// Design §10: a legacy tenant (tier carried over from markdown, no facts) sees a NON-BLOCKING
// invitation to complete the facts. Never a modal, never a redirect, never a gate —
// `onboarding.status` deliberately still returns `needsOnboarding: false` for them.

// Fills the canvas <main> leaves, which already flexes as the rail collapses (.app-frame is a flex
// row, .rail is flex:none). No max-width and no auto margins: a centred 44rem column left most of a
// wide screen empty, and the blueprint canvas in particular wants every pixel.
const page: React.CSSProperties = {
  width: "100%",
  padding: "2rem clamp(1rem, 2.5vw, 2.5rem)",
  display: "grid",
  gap: "1.5rem",
  alignContent: "start",
};

const PROFILE_TABS = [
  { id: "shape", label: "Business shape" },
  { id: "business", label: "What the business is" },
  { id: "blueprint", label: "Blueprint" },
] as const;

const TABS = [
  { id: "profile", label: "Business Profile" },
  { id: "connections", label: "Connections" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

const isTabId = (v: string | null): v is TabId => TABS.some((t) => t.id === v);
const isProfileTabId = (v: string | null): v is ProfileTabId =>
  PROFILE_TABS.some((t) => t.id === v);

/**
 * Both tab levels, derived from the query string alone — no component state, no mount-time
 * snapshot. Exported because this is the only branching part of the page's navigation and it
 * carries the back-compat contract: before the navigation consolidation `shape`/`business`/
 * `blueprint` WERE top-level tab ids, so a link minted then must still land on that section of
 * the Business Profile tab rather than falling back to the default.
 */
export function resolveProfileTabs(params: URLSearchParams): {
  tab: TabId;
  profileTab: ProfileTabId;
} {
  const requestedTab = params.get("tab");
  const requestedSection = params.get("section");
  const legacySection = isProfileTabId(requestedTab) ? requestedTab : null;
  return {
    tab: legacySection ? "profile" : isTabId(requestedTab) ? requestedTab : "profile",
    profileTab: legacySection ?? (isProfileTabId(requestedSection) ? requestedSection : "shape"),
  };
}

function ProfileSurface() {
  const current = useQuery(api.onboarding.getProfile);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);

  // Seed the editable state once the committed profile loads.
  useEffect(() => {
    if (current) setProfile(current);
  }, [current]);

  // BOTH tab levels are DERIVED from the URL on every render, never snapshotted at mount. The rail
  // links straight to `?tab=settings` and `?tab=connections`, and a same-route `<Link>` is a soft
  // navigation that does not remount this page — a mount-time read left the URL and the panel
  // disagreeing. See the long note in dashboard/approvals/page.tsx; the Suspense boundary at the
  // bottom of this file is what the App Router charges for `useSearchParams`.
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tab, profileTab } = resolveProfileTabs(new URLSearchParams(searchParams));

  // `router.replace`, not `history.replaceState`: a manual history write does not re-run
  // `useSearchParams`, so the panel would stop tracking the URL. `replace` still adds no history
  // entry per tab click, which is why `replaceState` was chosen here originally.
  function selectTab(next: TabId) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    router.replace(`/dashboard/profile?${params}`, { scroll: false });
  }

  function selectProfileTab(next: ProfileTabId) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", "profile");
    params.set("section", next);
    router.replace(`/dashboard/profile?${params}`, { scroll: false });
  }

  const blueprintState = useQuery(api.blueprint.blueprintState);
  const staleCount =
    blueprintState?.state === "live_stale" ? blueprintState.unincorporatedCount : 0;

  // Roving-tabindex fix: changing a button's `tabIndex` to -1 does not move DOM focus off it, so
  // arrow-key navigation must move focus itself or a subsequent Tab press exits the tablist instead
  // of landing in the new panel. Click already focuses the clicked button natively, so this ref is
  // only consulted on the keyboard path. The map is a ref (not state) so re-renders never lose the
  // button elements it points at.
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement>>>({});
  const profileTabRefs = useRef<Partial<Record<ProfileTabId, HTMLButtonElement>>>({});

  if (current === undefined || (current && !profile)) {
    return (
      <div style={page}>
        <p role="status" aria-live="polite" style={{ color: "var(--ink-soft)" }}>
          Loading your business profile…
        </p>
      </div>
    );
  }

  if (current === null || !profile) {
    return (
      <div style={page}>
        <header style={{ display: "grid", gap: "0.5rem" }}>
          <span style={label}>Business profile</span>
          <h1
            style={{
              fontSize: "clamp(1.5rem, 4vw, 2rem)",
              fontWeight: 700,
              color: "var(--ink)",
              margin: 0,
            }}
          >
            No profile yet
          </h1>
        </header>
        <p style={{ color: "var(--ink-soft)", margin: 0 }}>
          Set up your business first, then come back here to keep it current.{" "}
          <a href="/dashboard/onboarding" style={{ color: "var(--teal-600)", fontWeight: 600 }}>
            Start onboarding
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div style={page}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <span style={label}>Business profile</span>
        <h1
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            fontWeight: 700,
            color: "var(--ink)",
            margin: 0,
          }}
        >
          Your business profile
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Every agent turn reads this. Keep it current — saving updates what Pikar AI knows about
          your business.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Business profile sections"
        style={{
          display: "flex",
          gap: "0.35rem",
          borderBottom: "1px solid var(--rule)",
          overflowX: "auto",
        }}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (delta === 0) return;
          e.preventDefault();
          const i = TABS.findIndex((t) => t.id === tab);
          const next = TABS[(i + delta + TABS.length) % TABS.length];
          if (!next) return;
          selectTab(next.id);
          tabRefs.current[next.id]?.focus();
        }}
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.id)}
              style={{
                appearance: "none",
                border: "none",
                background: "none",
                font: "inherit",
                cursor: "pointer",
                padding: "0.55rem 0.9rem",
                marginBottom: "-1px",
                fontWeight: 600,
                fontSize: "0.92rem",
                color: active ? "var(--ink)" : "var(--ink-soft)",
                borderBottom: `2px solid ${active ? "var(--teal-600)" : "transparent"}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="panel-profile"
        aria-labelledby="tab-profile"
        hidden={tab !== "profile"}
        style={{ minWidth: 0 }}
      >
        <div style={{ display: "grid", gap: "1.25rem" }}>
          <div
            role="tablist"
            aria-label="Business Profile details"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              borderBottom: "1px solid var(--rule)",
              overflowX: "auto",
            }}
            onKeyDown={(e) => {
              const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (delta === 0) return;
              e.preventDefault();
              const i = PROFILE_TABS.findIndex((t) => t.id === profileTab);
              const next = PROFILE_TABS[(i + delta + PROFILE_TABS.length) % PROFILE_TABS.length];
              if (!next) return;
              selectProfileTab(next.id);
              profileTabRefs.current[next.id]?.focus();
            }}
          >
            {PROFILE_TABS.map((t) => {
              const active = t.id === profileTab;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    if (el) profileTabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`profile-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls={`profile-panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectProfileTab(t.id)}
                  style={{
                    appearance: "none",
                    border: "none",
                    background: "none",
                    font: "inherit",
                    cursor: "pointer",
                    padding: "0.5rem 0.75rem",
                    marginBottom: "-1px",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    color: active ? "var(--ink)" : "var(--ink-soft)",
                    borderBottom: `2px solid ${active ? "var(--teal-600)" : "transparent"}`,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
            <span style={{ flex: 1 }} />
            {staleCount > 0 && (
              <span
                style={{
                  alignSelf: "center",
                  whiteSpace: "nowrap",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "var(--held-text)",
                  background: "color-mix(in srgb, var(--held) 16%, transparent)",
                  padding: "0.2rem 0.55rem",
                  borderRadius: "999px",
                }}
              >
                {staleCount} new {staleCount === 1 ? "document" : "documents"}
              </span>
            )}
          </div>

          {/* Profile detail panels stay mounted so half-typed edits survive switching sections. */}
          <div
            role="tabpanel"
            id="profile-panel-shape"
            aria-labelledby="profile-tab-shape"
            hidden={profileTab !== "shape"}
          >
            <ShapePanel oneLineDescription={profile.oneLineDescription} />
            <ErrorBoundary
              fallback={
                <p style={{ color: "var(--ink-soft)" }}>
                  Workflow suggestions are temporarily unavailable.
                </p>
              }
            >
              <VerticalPackRecommendations />
            </ErrorBoundary>
          </div>
          <div
            role="tabpanel"
            id="profile-panel-business"
            aria-labelledby="profile-tab-business"
            hidden={profileTab !== "business"}
          >
            <NarrativePanel profile={profile} setProfile={setProfile} />
          </div>
          <div
            role="tabpanel"
            id="profile-panel-blueprint"
            aria-labelledby="profile-tab-blueprint"
            hidden={profileTab !== "blueprint"}
          >
            <BlueprintPanel />
          </div>
        </div>
      </div>
      <div
        role="tabpanel"
        id="panel-connections"
        aria-labelledby="tab-connections"
        hidden={tab !== "connections"}
      >
        <ConnectionsPanel />
      </div>
      <div
        role="tabpanel"
        id="panel-settings"
        aria-labelledby="tab-settings"
        hidden={tab !== "settings"}
      >
        <div style={{ display: "grid", gap: "1.25rem" }}>
          <BillingPanel />
          <DataControls />
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div style={page}>
          <p role="status" aria-live="polite" style={{ color: "var(--ink-soft)" }}>
            Loading your business profile…
          </p>
        </div>
      }
    >
      <ProfileSurface />
    </Suspense>
  );
}
