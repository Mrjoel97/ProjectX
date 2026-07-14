"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { BrainIcon } from "../../../(auth)/icons";
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
//
// Pane chrome follows BRAND.md §4/§5 (brand-024113/024149): left = "Pikar AI / Executive
// Assistant & Orchestrator" chat header; right = AGENT WORKSPACE caps label + "Live work canvas".

const panel = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  minHeight: 0,
  gap: "0.75rem",
  padding: "1.1rem 1.25rem",
  background: "var(--card)",
  borderRadius: "1.1rem",
  boxShadow: "0 14px 40px -30px rgb(14 20 25 / 40%)",
};

const capsTeal = {
  margin: 0,
  fontSize: "0.68rem",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--teal-600)",
};

export default function WorkspacePage() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    // Concrete height so the % / 1fr grid columns have something to fill (plan 05).
    // 5rem ≈ the canvas-main padding now that the shell is a side rail, not a top bar.
    <div style={{ height: "calc(100vh - 5rem)" }}>
      <SplitPane
        left={
          <section data-testid="chat-pane" style={panel}>
            <header style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
              <span
                aria-hidden="true"
                style={{
                  width: "2.4rem",
                  height: "2.4rem",
                  borderRadius: "0.8rem",
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  background: "linear-gradient(135deg, var(--teal-400), var(--teal-600))",
                }}
              >
                <BrainIcon size={20} />
              </span>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.05rem", letterSpacing: "-0.01em" }}>Pikar AI</h2>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                  Executive Assistant &amp; Orchestrator
                </p>
              </div>
            </header>
            {status === undefined ? (
              <p style={{ color: "var(--ink-soft)", margin: 0 }}>Loading…</p>
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
            <header>
              <p style={capsTeal}>Agent workspace</p>
              <h2
                style={{
                  margin: "0.35rem 0 0.2rem",
                  fontFamily: "var(--font-display), system-ui, sans-serif",
                  fontWeight: 800,
                  fontSize: "1.5rem",
                  letterSpacing: "-0.02em",
                }}
              >
                Live work canvas
              </h2>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ink-soft)" }}>
                Plans, drafts, and delivery reports render here live as the agent works.
              </p>
            </header>
            <CardList threadId={threadId} />
          </section>
        }
      />
    </div>
  );
}
