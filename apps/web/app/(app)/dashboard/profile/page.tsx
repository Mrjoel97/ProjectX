"use client";

import { api } from "@pikar/backend/api";
import type { BusinessProfile } from "@pikar/core";
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { BlueprintPanel } from "./BlueprintPanel";
import { NarrativePanel } from "./NarrativePanel";
import { ShapePanel } from "./ShapePanel";
import { label } from "./styles";

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

const TABS = [
  { id: "shape", label: "Business shape" },
  { id: "business", label: "What the business is" },
  { id: "blueprint", label: "Blueprint" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTabId = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

export default function ProfilePage() {
  const current = useQuery(api.onboarding.getProfile);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);

  // Seed the editable state once the committed profile loads.
  useEffect(() => {
    if (current) setProfile(current);
  }, [current]);

  // `?tab=` read ONCE on mount, `window.location.search` deliberately — see
  // dashboard/voice/page.tsx:23-30. `useSearchParams` needs a Suspense boundary that typecheck
  // cannot see is missing; it either errors at prerender or silently deopts the page to CSR.
  // null = not read yet: the page is already showing its loading branch at that point, so the
  // resolved tab is never late enough to flash.
  const [tab, setTab] = useState<TabId | null>(null);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    setTab(isTabId(requested) ? requested : "shape");
  }, []);

  // `replaceState`, not a router push: switching tabs is not a navigation, and a push would add a
  // history entry per click and re-run the page's queries.
  function selectTab(next: TabId) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
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

  if (current === undefined || tab === null || (current && !profile)) {
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
        <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
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
        style={{ display: "flex", gap: "0.35rem", borderBottom: "1px solid var(--rule)" }}
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
        <span style={{ flex: 1 }} />
        {staleCount > 0 && (
          <span
            style={{
              alignSelf: "center",
              fontSize: "0.75rem",
              fontWeight: 700,
              /* --held-text, NOT --held: amber on light paper is 1.9:1 and fails WCAG (BRAND §2). */
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

      {/* All three stay MOUNTED and are toggled with `hidden`. That is what makes a half-typed
          narrative survive a trip to the Blueprint tab and back — no state lifting needed. The
          wrapper carries no `display` style, because an inline `display` would defeat `hidden`. */}
      <div role="tabpanel" id="panel-shape" aria-labelledby="tab-shape" hidden={tab !== "shape"}>
        <ShapePanel oneLineDescription={profile.oneLineDescription} />
      </div>
      <div role="tabpanel" id="panel-business" aria-labelledby="tab-business" hidden={tab !== "business"}>
        <NarrativePanel profile={profile} setProfile={setProfile} />
      </div>
      <div role="tabpanel" id="panel-blueprint" aria-labelledby="tab-blueprint" hidden={tab !== "blueprint"}>
        <BlueprintPanel />
      </div>
    </div>
  );
}
