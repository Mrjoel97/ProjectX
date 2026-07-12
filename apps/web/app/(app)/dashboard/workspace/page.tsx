"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { CardList } from "./cards";
import { ChatPane } from "./ChatPane";
import { SplitPane } from "./SplitPane";

// The cockpit, wired (plan 08 over the plan-05 shell). LEFT = the live chat pane (guided
// questions + drafted-plan copy via the agent thread); RIGHT = the PLAN/DRAFT/REPORT card
// dispatcher. Both share one `threadId` held here — the first `sendCockpitMessage` mints it
// (ChatPane → onThread) and it flows into both panes so the cards track the same conversation.
//
// Nothing plans without a mailbox: the composer stays gated behind api.gmailAuth.gmailStatus
// (unconnected → teal Connect-Gmail CTA). The panels always render (shell independent of mailbox
// state). SplitPane + the (app) auth gate are untouched (plan 05).

const panel = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  minHeight: 0,
  gap: "0.75rem",
  padding: "1rem",
  background: "var(--card)",
};
const heading = { margin: 0, fontSize: "1rem" as const };

export default function WorkspacePage() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    // Concrete height so the % / 1fr grid columns have something to fill (plan 05).
    <div style={{ height: "calc(100vh - 8rem)" }}>
      <SplitPane
        left={
          <section data-testid="chat-pane" style={panel}>
            <h2 style={heading}>Conversation</h2>
            {status === undefined ? (
              <p style={{ color: "#666", margin: 0 }}>Loading…</p>
            ) : status.connected ? (
              <ChatPane threadId={threadId} onThread={setThreadId} />
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
            <CardList threadId={threadId} />
          </section>
        }
      />
    </div>
  );
}
