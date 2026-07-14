"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { BrainIcon, ClockIcon, DotsIcon, TrashIcon } from "../../../(auth)/icons";
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
// Chrome replicates brand-024113/024149: chat header ("Pikar AI / Executive Assistant &
// Orchestrator" + history/menu), a chat-tab strip, AGENT WORKSPACE canvas header with the
// time-of-day greeting on an empty canvas and "Live work canvas" once a thread is active,
// and a dark "Clear workspace" pill. Tabs/Clear are thin thread-switching over the existing
// engine: a tab = a threadId; "New chat"/"Clear workspace" = fresh thread on next send.
// ponytail: tabs are session-state only — persist them once a real thread-list query exists.

// Anchored surfaces, not floating cards: square corners, no shadow — the pane classes
// (.pane-chat / .pane-canvas) own the backgrounds; only the artifacts inside float.
const panel = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100%",
  minHeight: 0,
  gap: "0.75rem",
  padding: "1.1rem 1.25rem",
};

const capsTeal = {
  margin: 0,
  fontSize: "0.68rem",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--teal-600)",
};

type Tab = { id: string; label: string };

export default function WorkspacePage() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  // First send on a fresh chat mints the thread — register its tab, labeled by the message.
  const registerThread = (id: string, firstText: string) => {
    setTabs((t) => [...t, { id, label: firstText.trim().slice(0, 24) || "New chat" }]);
    setThreadId(id);
  };
  const newChat = () => setThreadId(undefined);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    // Full-bleed: <main> is the is-bleed scroll-locked frame, so 100% fills it exactly —
    // the panes touch the rail, the top, and the bottom of the viewport (plan 05's
    // concrete-height requirement, now supplied by the fixed-height shell chain).
    <div style={{ height: "100%" }}>
      <SplitPane
        left={
          <section data-testid="chat-pane" className="pane-chat" style={panel}>
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
                  boxShadow: "0 6px 14px -6px rgb(0 150 137 / 60%), inset 0 1px 2px rgb(255 255 255 / 40%)",
                }}
              >
                <BrainIcon size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "1.02rem",
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Pikar AI
                </h2>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.74rem",
                    color: "var(--ink-soft)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Executive Assistant &amp; Orchestrator
                </p>
              </div>
              <div className="chat-head-icons">
                <button type="button" className="icon-btn" disabled title="Chat history — coming soon">
                  <ClockIcon size={17} />
                </button>
                <button type="button" className="icon-btn" disabled title="Options — coming soon">
                  <DotsIcon size={17} />
                </button>
              </div>
            </header>

            {/* Chat tabs: one per minted thread this session + the New-chat pill. */}
            <div className="chat-tabs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chat-tab${t.id === threadId ? " is-active" : ""}`}
                  title={t.label}
                  onClick={() => setThreadId(t.id)}
                >
                  {t.label}
                </button>
              ))}
              <button
                type="button"
                className={`chat-tab${threadId === undefined ? " is-active" : ""}`}
                aria-label="New chat"
                onClick={newChat}
              >
                {tabs.length === 0 ? "+ New chat" : "+"}
              </button>
            </div>

            {status === undefined ? (
              <p style={{ color: "var(--ink-soft)", margin: 0 }}>Loading…</p>
            ) : status.connected ? (
              <ChatPane threadId={threadId} onThread={registerThread} />
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
          <section data-testid="workspace-pane" className="pane-canvas" style={{ ...panel, padding: "1.25rem 1.6rem" }}>
            <header style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
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
                  {threadId ? "Live work canvas" : `${greeting}, Executive.`}
                </h2>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ink-soft)" }}>
                  {threadId
                    ? "Plans, drafts, and delivery reports render here live as the agent works."
                    : "Start from chat and the agent will stream its work here — plans, drafts, and delivery reports."}
                </p>
              </div>
              <button
                type="button"
                className="cta-dark"
                style={{ margin: 0, padding: "0.55rem 1rem", fontSize: "0.85rem", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                title="Clears this canvas by starting a new chat"
                onClick={newChat}
              >
                <TrashIcon size={15} /> Clear workspace
              </button>
            </header>
            <CardList threadId={threadId} />
          </section>
        }
      />
    </div>
  );
}
