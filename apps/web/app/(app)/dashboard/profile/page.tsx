"use client";

import { api } from "@pikar/backend/api";
import { type BusinessProfile } from "@pikar/core";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
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

const page: React.CSSProperties = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "2rem 1.25rem",
  display: "grid",
  gap: "1.5rem",
};

export default function ProfilePage() {
  const current = useQuery(api.onboarding.getProfile);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);

  // Seed the editable state once the committed profile loads.
  useEffect(() => {
    if (current) setProfile(current);
  }, [current]);

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
        <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
          Your business profile
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Every agent turn reads this. Keep it current — saving updates what Pikar AI knows about
          your business.
        </p>
      </header>

      <ShapePanel oneLineDescription={profile.oneLineDescription} />
      <NarrativePanel profile={profile} setProfile={setProfile} />
      <BlueprintPanel />
    </div>
  );
}
