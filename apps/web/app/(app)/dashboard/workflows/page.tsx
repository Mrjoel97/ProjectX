"use client";

import { PinnedWorkflowButton } from "./PinnedWorkflowButton";
import { WorkflowPackCustomizer } from "./WorkflowPackCustomizer";

// /dashboard/workflows (29-07, ROUT-01) — where a tenant adapts an approved workflow pack.
//
// DELIBERATELY NOT IN THE NAV. `apps/web/app/(app)/layout.tsx`'s `NAV` array has no entry for this
// route, so it is reachable by URL only — the same posture the retired `/submit` and `/review`
// pages hold. It stays that way until plan 29-10's authenticated browser gate has actually run
// against it; adding the href IS the activation, and `WorkflowPackCustomizer.test.ts` fails if one
// appears before then.
//
// The shell (dark-teal rail + light canvas) comes from the `(app)` layout, so this page is the
// headline and the surface, nothing more (BRAND §3: one display headline per view).
export default function WorkflowsPage() {
  return (
    <div style={{ padding: "1.5rem", display: "grid", gap: "1rem", maxWidth: "56rem" }}>
      <div>
        <p className="caps-label" style={{ margin: 0 }}>
          Workflows
        </p>
        <h1
          style={{ margin: "0.25rem 0 0", fontSize: "var(--step-3, 1.75rem)", color: "var(--ink)" }}
        >
          Make a workflow fit your business
        </h1>
        <p style={{ margin: "0.4rem 0 0", color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Pikar keeps each workflow's approved steps and adds your settings to them.
        </p>
      </div>
      {/* 29-08 (ROUT-02): pin an approved workflow and run it again BY HAND. It is mounted ABOVE
          the customizer deliberately — repeating a run is the frequent act, adapting one is the
          rare one, and the pinned surface is the one that must say plainly that a saved
          customization is not what a run uses. */}
      <PinnedWorkflowButton />
      <WorkflowPackCustomizer />
    </div>
  );
}
