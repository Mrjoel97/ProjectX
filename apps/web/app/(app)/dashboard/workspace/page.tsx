"use client";

import { api } from "@pikar/backend/api";
// BEVL-03: the ONE deterministic thread the weekly review writes to, per tenant.
import { REVIEW_THREAD_ID } from "@pikar/core";
import { useQuery } from "convex/react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BrainIcon, ClockIcon, DotsIcon, TrashIcon } from "../../../(auth)/icons";
import { ChatPane } from "./ChatPane";
import { CardList } from "./cards";
import { ErrorBoundary } from "./ErrorBoundary";
import { CanvasPane } from "./MediaCanvas";
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

// BEVL-03: the weekly review lives on ONE deterministic thread per tenant, so its tab needs no
// persistence — it is seeded into the session tab strip and never closes. Seeding it as a real
// Tab (rather than rendering it separately) is what makes the ?thread= deep-link dedupe for free:
// openThread already skips ids it is already showing.
const REVIEW_TAB: Tab = { id: REVIEW_THREAD_ID, label: "Weekly review" };

// Header dropdown: an icon button that toggles a light-dismiss menu. The scrim is a real
// full-screen button so an outside click (or its focus) closes the menu — no document listener.
function HeaderMenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <>
          <button type="button" className="menu-scrim" aria-hidden tabIndex={-1} onClick={close} />
          <div className="head-menu">{children(close)}</div>
        </>
      )}
    </div>
  );
}

// Past chats for the header history menu — persisted, tenant-scoped, newest first (cockpit.ts).
// This is a NICETY; the workspace is the product. It owns its own `useQuery` so that a failing or
// slow `listThreads` (a cross-component `listThreadsByUserId` call that can exceed Convex's 1s
// query limit under memory pressure and THROW inside render) is caught by the ErrorBoundary around
// it (WorkspacePage renders it wrapped) and degrades to "no history" — chat + workspace keep working.
function PastChats({
  threadId,
  onOpen,
}: {
  threadId?: string;
  onOpen: (id: string, label: string) => void;
}) {
  const history = useQuery(api.cockpit.listThreads);
  return (
    <HeaderMenu label="Past chats" icon={<ClockIcon size={16} />}>
      {(close) => (
        <div role="menu" aria-label="Past chats">
          {history === undefined ? (
            <p className="head-menu-empty">Loading…</p>
          ) : history.length === 0 ? (
            <p className="head-menu-empty">No past chats yet.</p>
          ) : (
            history.map((t) => (
              <button
                key={t.threadId}
                type="button"
                role="menuitem"
                className={`head-menu-item${t.threadId === threadId ? " is-active" : ""}`}
                title={t.title}
                onClick={() => {
                  onOpen(t.threadId, t.title);
                  close();
                }}
              >
                {t.title}
              </button>
            ))
          )}
        </div>
      )}
    </HeaderMenu>
  );
}

// The fallback when the history query throws: keep the clock button (stable layout) but say
// history is unavailable rather than vanishing the control or crashing the page.
function PastChatsFallback() {
  return (
    <HeaderMenu label="Past chats" icon={<ClockIcon size={16} />}>
      {() => (
        <div role="menu" aria-label="Past chats">
          <p className="head-menu-empty">History unavailable.</p>
        </div>
      )}
    </HeaderMenu>
  );
}

export default function WorkspacePage() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const [tabs, setTabs] = useState<Tab[]>([REVIEW_TAB]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  // "A turn is in flight" — lifted here so BOTH trace surfaces (ChatPane's bubble + CardList's
  // ActivityCard) share ONE signal (FIX 4). It is the difference between "no thread, nothing sent"
  // (a fresh chat — show NO trace, or a previous thread's LATEST turn leaks in) and "no thread, a
  // first turn is in flight" (sendCockpitMessage hasn't resolved the threadId yet — the trace MUST
  // show, the first-turn trap). ChatPane owns the send, so it toggles this via onSending.
  const [sending, setSending] = useState(false);

  // First send on a fresh chat mints the thread — register its tab, labeled by the message.
  const registerThread = (id: string, firstText: string) => {
    setTabs((t) => [...t, { id, label: firstText.trim().slice(0, 24) || "New chat" }]);
    setThreadId(id);
  };
  // Open a past chat from the history menu — add a session tab if it isn't already showing.
  const openThread = useCallback((id: string, label: string) => {
    setTabs((t) =>
      t.some((x) => x.id === id) ? t : [...t, { id, label: label.slice(0, 24) || "New chat" }],
    );
    setThreadId(id);
  }, []);

  // The voice brief→plan handoff (VOIC-04) navigates here as /workspace?thread=<id> — sendCockpitMessage
  // already minted the thread + its PLAN card, so we just re-open it at the existing Approve gate. Read
  // once on mount (client-only — avoids the useSearchParams Suspense boundary for a redirect-only value,
  // the connect-gmail precedent). Nothing sends: the user still crosses the same single Approve.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("thread");
    if (id) openThread(id, "Voice brief");
  }, [openThread]);
  // THE CANVAS VIEW (20-10 follow-up). The right pane shows either the agent's work stream or the
  // media canvas, full-width. It is a VIEWPORT, not a route: the thread, the tab strip and every
  // in-flight cockpit subscription are untouched by the toggle, which is the whole reason it is
  // local state and not a `<Link>` to a second page.
  //
  // `?view=canvas` is read from `window.location.search` — the repo idiom, never `useSearchParams`
  // (which forces a Suspense boundary on this page for a value that never changes after mount).
  const [view, setView] = useState<"work" | "canvas">("work");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "canvas") setView("canvas");
  }, []);
  const newChat = () => setThreadId(undefined);
  // Close a session tab. The tab strip is view state, so this only stops SHOWING the chat — the
  // thread and its messages are untouched and stay reopenable from the "Past chats" menu, which
  // reads the persisted `cockpit.listThreads`. Closing the ACTIVE tab falls back to its neighbour
  // (right first, then left); closing the last one lands on a fresh New chat. Closing a background
  // tab never moves the user. Computed outside the setState updater so it stays side-effect free.
  const closeTab = (id: string) => {
    if (id === REVIEW_THREAD_ID) return; // pinned — defence in depth, its × button is not rendered
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (id === threadId) setThreadId(next[idx]?.id ?? next[idx - 1]?.id);
  };

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
            <header
              className="chat-head"
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span aria-hidden="true" className="chat-logo">
                <BrainIcon size={12} />
              </span>
              {/* Explicit tight line-heights: the global body `line-height: 1.6` was costing this
                  two-line block ~40px on its own — more than the icon buttons beside it. */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "0.78rem",
                    lineHeight: 1.15,
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
                    fontSize: "0.56rem",
                    lineHeight: 1.15,
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
                {/* Clock → past chats (persisted history); kebab → chat options. The history
                    query is isolated behind an ErrorBoundary — a slow/failed listThreads must
                    never take the cockpit down (FIX 1), it degrades to "History unavailable". */}
                <ErrorBoundary label="past-chats" fallback={<PastChatsFallback />}>
                  <PastChats threadId={threadId} onOpen={openThread} />
                </ErrorBoundary>
                <HeaderMenu label="Chat options" icon={<DotsIcon size={16} />}>
                  {(close) => (
                    <div role="menu" aria-label="Chat options">
                      <button
                        type="button"
                        role="menuitem"
                        className="head-menu-item"
                        onClick={() => {
                          newChat();
                          close();
                        }}
                      >
                        + New chat
                      </button>
                    </div>
                  )}
                </HeaderMenu>
              </div>
            </header>

            {/* Chat tabs: one per minted thread this session + the compact New-chat pill. */}
            <div className="chat-tabs">
              {/* A tab is a label button + its own close button, so the wrapper is a span — a
                  button cannot legally nest another button. */}
              {tabs.map((t) => {
                // The review tab is PINNED: no × (and the wrapper drops has-close so the label
                // reclaims the gutter). It is always present, so there is nothing to reopen it with.
                const pinned = t.id === REVIEW_THREAD_ID;
                return (
                  <span
                    key={t.id}
                    className={`chat-tab${pinned ? "" : " has-close"}${t.id === threadId ? " is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="chat-tab-label"
                      title={t.label}
                      onClick={() => setThreadId(t.id)}
                    >
                      {t.label}
                    </button>
                    {!pinned && (
                      <button
                        type="button"
                        className="chat-tab-close"
                        aria-label={`Close ${t.label}`}
                        title={`Close ${t.label}`}
                        onClick={() => closeTab(t.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              <button
                type="button"
                className={`chat-tab is-new${threadId === undefined ? " is-active" : ""}`}
                aria-label="New chat"
                title="New chat"
                onClick={newChat}
              >
                +
              </button>
            </div>

            {/* The review thread is synthetic — it has no `plans` row, and sendCockpitMessage throws
                "cockpit: plan row missing for thread" (cockpit.ts:93) on any send. Reading degrades
                gracefully (listThreadMessages returns an empty page), so only the COMPOSER is
                suppressed. Do NOT loosen that backend guard instead — it protects the real cockpit.
                Checked BEFORE the gmail-status branch on purpose: the review has nothing to do with
                a mailbox, so a disconnected user must still see it (SC#2). */}
            {threadId === REVIEW_THREAD_ID ? (
              <p style={{ color: "var(--ink-soft)", margin: 0, fontSize: "0.9rem" }}>
                This is your weekly business review. Start a new chat to act on anything here.
              </p>
            ) : status === undefined ? (
              <p style={{ color: "var(--ink-soft)", margin: 0 }}>Loading…</p>
            ) : status.connected ? (
              <ChatPane
                threadId={threadId}
                onThread={registerThread}
                sending={sending}
                onSending={setSending}
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
          <section
            data-testid="workspace-pane"
            className="pane-canvas"
            style={{ ...panel, padding: "1.25rem 1.6rem" }}
          >
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
                  {view === "canvas"
                    ? "Media canvas"
                    : threadId
                      ? "Live work canvas"
                      : `${greeting}, Executive.`}
                </h2>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ink-soft)" }}>
                  {view === "canvas"
                    ? "The storyboard, the blocks and the finished reel for this thread. Nothing generates until you approve the cost."
                    : threadId
                      ? "Plans, drafts, and delivery reports render here live as the agent works."
                      : "Start from chat and the agent will stream its work here — plans, drafts, and delivery reports."}
                </p>
              </div>
              {/* The canvas toggle, beside Clear workspace. A BUTTON, not a link: it swaps what the
                  pane renders and leaves the thread, the tabs and every open subscription alone —
                  a navigation would put the conversation a back-button away. `aria-pressed` is what
                  makes a two-state button legible to a screen reader; the LABEL also changes, so
                  the state is never carried by styling alone (BRAND §6). */}
              <button
                type="button"
                aria-pressed={view === "canvas"}
                data-testid="canvas-toggle"
                style={{
                  margin: 0,
                  padding: "0.55rem 1rem",
                  fontSize: "0.85rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--rule)",
                  background: view === "canvas" ? "var(--canvas)" : "var(--paper)",
                  color: "var(--ink)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
                title={
                  view === "canvas"
                    ? "Back to the agent's work stream"
                    : "Show the storyboard and reel for this thread"
                }
                onClick={() => setView((v) => (v === "canvas" ? "work" : "canvas"))}
              >
                {view === "canvas" ? "Back to workspace" : "Open canvas"}
              </button>
              <button
                type="button"
                className="cta-dark"
                style={{
                  margin: 0,
                  padding: "0.55rem 1rem",
                  fontSize: "0.85rem",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                title="Clears this canvas by starting a new chat"
                onClick={newChat}
              >
                <TrashIcon size={15} /> Clear workspace
              </button>
            </header>
            {view === "canvas" ? (
              <CanvasPane threadId={threadId} />
            ) : (
              <CardList threadId={threadId} sending={sending} />
            )}
          </section>
        }
      />
    </div>
  );
}
