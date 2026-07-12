"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { SplitPane } from "./SplitPane";

// SC1: the cockpit's structural shell. Two resizable panes under the existing (app) auth
// gate (inherits the 18c8442 Connect-Gmail client-token fix for free). The real chat and
// the PLAN/DRAFT/REPORT cards drop into these placeholders in plan 08.
//
// Nothing plans without a mailbox: the composer is gated behind api.gmailAuth.gmailStatus
// (the same seam connect-gmail/page.tsx uses), so an unconnected user is routed to consent
// before they can type a goal. The panels themselves always render — only the composer is
// gated — so the shell is visible while the gate is evaluated.

const panel = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  minHeight: 0,
  gap: "0.75rem",
  padding: "1rem",
  background: "var(--card)",
};
const box = { border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "0.75rem" };
const heading = { margin: 0, fontSize: "1rem" as const };

export default function WorkspacePage() {
  const status = useQuery(api.gmailAuth.gmailStatus);

  return (
    // Give the grid a concrete height so the % / 1fr columns have something to fill.
    // (app)/layout main has 1.5rem padding under a ~3.5rem header — 8rem covers both.
    <div style={{ height: "calc(100vh - 8rem)" }}>
      <SplitPane
        left={
          <section data-testid="chat-pane" style={panel}>
            <h2 style={heading}>Conversation</h2>
            {/* chat pane — plan 08 */}
            {status === undefined ? (
              <p style={{ color: "#666", margin: 0 }}>Loading…</p>
            ) : status.connected ? (
              <textarea
                placeholder="Describe your goal…"
                rows={3}
                style={{ ...box, width: "100%", fontFamily: "inherit", resize: "vertical" }}
              />
            ) : (
              <Link
                href="/connect-gmail"
                style={{
                  display: "inline-block",
                  width: "fit-content",
                  padding: "0.6rem 1.2rem",
                  borderRadius: "0.375rem",
                  background: "var(--teal-600)",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Connect Gmail to start planning
              </Link>
            )}
          </section>
        }
        right={
          <section data-testid="workspace-pane" style={panel}>
            <h2 style={heading}>Workspace</h2>
            {/* card list — plan 08 */}
            <p style={{ color: "#666", margin: 0 }}>No artifacts yet.</p>
          </section>
        }
      />
    </div>
  );
}
