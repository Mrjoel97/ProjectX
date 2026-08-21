"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { AdminView } from "./AdminView";

/**
 * BETA-01 owner admin route.
 *
 * THE WHOLE VIEW IS CONDITIONAL, and that is the security property, not a style choice — the same
 * reasoning `/ops` records for its optimizer section. `AdminView` owns the `invites.pending`
 * subscription, so MOUNTING it is what subscribes to the waitlist. Hiding it with CSS, `hidden`,
 * opacity, or an early return *inside* the view would each still run the hook and leak through the
 * subscription, the loading state, or an error boundary.
 *
 * `undefined` is the loading state and renders NOTHING admin-shaped: fail closed, so a slow query
 * cannot flash the surface.
 *
 * Presentation only. `invites.pending` and `invites.approve` are `ownerQuery`/`ownerMutation`, and
 * those wrappers are the actual boundary — `isolation.test.ts` proves both refuse a non-owner
 * directly, independently of anything rendered here.
 */
export default function AdminPage() {
  const viewer = useQuery(api.owner.viewer, {});

  if (viewer?.isOwner !== true) {
    return (
      <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.75rem)",
            letterSpacing: "-0.03em",
            color: "var(--ink)",
          }}
        >
          Admin
        </h1>
        {/* Deliberately identical for "still loading" and "not the owner". A distinct
            "you are not the owner" message would confirm the page exists to anyone probing it. */}
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          This area isn't available on your account.
        </p>
      </div>
    );
  }

  return <AdminView />;
}
