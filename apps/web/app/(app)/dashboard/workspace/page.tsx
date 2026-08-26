"use client";

import { api } from "@pikar/backend/api";
// BEVL-03: the ONE deterministic thread the weekly review writes to, per tenant.
import { REVIEW_THREAD_ID } from "@pikar/core";
import { useAction, useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BrainIcon, ClockIcon, DotsIcon, StarIcon, TrashIcon } from "../../../(auth)/icons";
import { ChatPane } from "./ChatPane";
import { CardList } from "./cards";
import { ErrorBoundary } from "./ErrorBoundary";
import { CanvasPane } from "./MediaCanvas";
import { SkillAuthoringPanel } from "./SkillAuthoringPanel";
import { SplitPane } from "./SplitPane";
import { useSendCockpitMessage } from "./useSendCockpitMessage";
import { WorkflowPackOwnerPreview } from "./WorkflowPackOwnerPreview";
import { WorkflowPackQuickStarts } from "./WorkflowPackQuickStarts";

// The cockpit, wired (plan 08 over the plan-05 shell). LEFT = the live chat pane (guided
// questions + drafted-plan copy via the agent thread); RIGHT = the PLAN/DRAFT/REPORT card
// dispatcher. Both share one `threadId` held here — the first `sendCockpitMessage` mints it
// (ChatPane → onThread) and it flows into both panes so the cards track the same conversation.
//
// The cockpit is the business operating surface. It is available whether or not an optional
// delivery channel is connected; a capability asks for its own connection only when the user
// chooses work that needs it. SplitPane + the (app) auth gate are untouched (plan 05).
//
// Chrome replicates brand-024113/024149: chat header ("Pikar AI / Business Operating Partner" +
// history/menu), a chat-tab strip, OPERATING WORKSPACE canvas header with the
// time-of-day greeting on an empty canvas and "Live work canvas" once a thread is active,
// and a dark "Clear workspace" pill. Tabs/Clear are thin thread-switching over the existing
// engine: a tab = a threadId; "New chat"/"Clear workspace" = fresh thread on next send.
// Workspace tabs/current thread persist for the browser session; messages remain
// durable in the Agent component until the user explicitly clears chat history.

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
const WORKSPACE_SESSION_KEY = "pikar.workspace.session.v1";

type StoredWorkspace = { tabs: Tab[]; threadId?: string };

function readStoredWorkspace(): StoredWorkspace | null {
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredWorkspace>;
    const tabs = Array.isArray(value.tabs)
      ? value.tabs.filter(
          (tab): tab is Tab =>
            Boolean(tab) && typeof tab.id === "string" && typeof tab.label === "string",
        )
      : [];
    return {
      tabs: [REVIEW_TAB, ...tabs.filter((tab) => tab.id !== REVIEW_THREAD_ID)],
      threadId: typeof value.threadId === "string" ? value.threadId : undefined,
    };
  } catch {
    return null;
  }
}

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

// SKILL-01 "routine v0" — the pinned-prompt menu. A pinned prompt is INERT SAVED TEXT: it does
// nothing at rest, and pressing Run starts an ORDINARY FRESH cockpit turn through the same hook a
// typed message uses. There is no schedule here and none may be added — see cockpit.md.
//
// It owns its own `useQuery` for the same reason `PastChats` does: a failing saved-prompt read must
// degrade this menu, not the cockpit around it (WorkspacePage renders it inside an ErrorBoundary).
// `onRun` belongs to the page because the page owns the tab strip and the shared in-flight signal.
function PinnedPrompts({ onRun, busy }: { onRun: (text: string) => Promise<void>; busy: boolean }) {
  const pins = useQuery(api.savedPrompts.list);
  const unpin = useMutation(api.savedPrompts.remove);
  type Pin = NonNullable<typeof pins>[number];
  const [running, setRunning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Returns whether the run started a thread, so the caller can close the menu on success and
  // leave it OPEN on failure — a menu that closes on error dismisses its own notice.
  const run = async (p: Pin): Promise<boolean> => {
    setNotice(null);
    setRunning(p.id);
    try {
      await onRun(p.text);
      return true;
    } catch {
      setNotice("That prompt could not be run. Nothing was sent — try again.");
      return false;
    } finally {
      setRunning(null);
    }
  };
  // Deletes the SAVED ROW and only the saved row. The chat the prompt was pinned from, its tab and
  // its plan are all untouched — a pin has no thread to own in the first place.
  const del = async (p: Pin) => {
    setNotice(null);
    setDeleting(p.id);
    try {
      await unpin({ id: p.id });
    } catch {
      setNotice("That pinned prompt could not be deleted. Try again.");
    } finally {
      setDeleting(null);
    }
  };
  // One turn at a time: `busy` is the page's shared in-flight signal, so a pinned run cannot race
  // a typed one, and a second Run cannot fire while the first is still resolving its thread.
  const disabled = busy || running !== null || deleting !== null;

  return (
    <HeaderMenu label="Pinned prompts" icon={<StarIcon size={16} />}>
      {(close) => (
        <div role="menu" aria-label="Pinned prompts">
          {pins === undefined ? (
            <p className="head-menu-empty">Loading…</p>
          ) : pins.length === 0 ? (
            <p className="head-menu-empty" style={{ whiteSpace: "normal" }}>
              No pinned prompts yet. Pin one from a message you have sent.
            </p>
          ) : (
            pins.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                <button
                  type="button"
                  role="menuitem"
                  className="head-menu-item"
                  style={{ flex: 1, minWidth: 0 }}
                  aria-label={`Run pinned prompt: ${p.title}`}
                  aria-busy={running === p.id}
                  title={p.text}
                  disabled={disabled}
                  onClick={() => void run(p).then((ok) => ok && close())}
                >
                  {running === p.id ? "Running…" : p.title}
                </button>
                <button
                  type="button"
                  className="head-menu-item"
                  style={{ width: "auto", flex: "none", color: "var(--ink-soft)" }}
                  aria-label={`Delete pinned prompt: ${p.title}`}
                  aria-busy={deleting === p.id}
                  title="Removes the saved prompt only — your chats are untouched"
                  disabled={disabled}
                  onClick={() => void del(p)}
                >
                  {deleting === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))
          )}
          {/* Announced and inline, in the menu the user is looking at. Grey `--ink-soft`, never
              amber: BRAND §2 spends `--held` on the approval gate alone. */}
          {notice !== null && (
            <p role="status" className="head-menu-empty" style={{ whiteSpace: "normal" }}>
              {notice}
            </p>
          )}
        </div>
      )}
    </HeaderMenu>
  );
}

// The fallback when the saved-prompt query throws: keep the control (stable layout) and say the
// menu is unavailable, rather than vanishing it or taking the cockpit down. The `PastChats`
// precedent, verbatim.
function PinnedPromptsFallback() {
  return (
    <HeaderMenu label="Pinned prompts" icon={<StarIcon size={16} />}>
      {() => (
        <div role="menu" aria-label="Pinned prompts">
          <p className="head-menu-empty">Pinned prompts unavailable.</p>
        </div>
      )}
    </HeaderMenu>
  );
}

export default function WorkspacePage() {
  const [tabs, setTabs] = useState<Tab[]>([REVIEW_TAB]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [workspaceRestored, setWorkspaceRestored] = useState(false);
  // "A turn is in flight" — lifted here so BOTH trace surfaces (ChatPane's bubble + CardList's
  // ActivityCard) share ONE signal (FIX 4). It is the difference between "no thread, nothing sent"
  // (a fresh chat — show NO trace, or a previous thread's LATEST turn leaks in) and "no thread, a
  // first turn is in flight" (sendCockpitMessage hasn't resolved the threadId yet — the trace MUST
  // show, the first-turn trap). ChatPane owns the send, so it toggles this via onSending.
  const [sending, setSending] = useState(false);

  // First send on a fresh chat mints the thread — register its tab, labeled by the message.
  const registerThread = (id: string, firstText: string) => {
    setTabs((t) =>
      t.some((tab) => tab.id === id)
        ? t
        : [...t, { id, label: firstText.trim().slice(0, 24) || "New chat" }],
    );
    setThreadId(id);
  };
  // Open a past chat from the history menu — add a session tab if it isn't already showing.
  const openThread = useCallback((id: string, label: string) => {
    setTabs((t) =>
      t.some((x) => x.id === id) ? t : [...t, { id, label: label.slice(0, 24) || "New chat" }],
    );
    setThreadId(id);
  }, []);

  // Preserve the open conversation and tab strip across reloads and route changes in this browser
  // tab. The durable message history itself remains in Convex; sessionStorage only remembers which
  // persisted threads were open. It is removed only by the two explicit clearing controls below.
  useEffect(() => {
    const stored = readStoredWorkspace();
    if (stored) {
      setTabs(stored.tabs);
      setThreadId(stored.threadId);
    }
    setWorkspaceRestored(true);
  }, []);
  useEffect(() => {
    if (!workspaceRestored) return;
    window.sessionStorage.setItem(
      WORKSPACE_SESSION_KEY,
      JSON.stringify({ tabs: tabs.filter((tab) => tab.id !== REVIEW_THREAD_ID), threadId }),
    );
  }, [tabs, threadId, workspaceRestored]);

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
  // SKILL-01: the skill-authoring card, opened from the existing Chat options menu. Session state,
  // not a route — the thread, the tabs and every open subscription survive the toggle.
  const [authoring, setAuthoring] = useState(false);

  // SKILL-01 "routine v0": replay a pinned prompt as an ORDINARY FRESH cockpit turn.
  //
  // No `threadId` is passed, so `sendCockpitMessage` mints a new thread exactly as a first typed
  // message does — the prompt does not land in whatever conversation happens to be open, and no
  // prior plan is cloned. It goes through `useSendCockpitMessage`, never the raw action: the hook
  // supplies the trusted IANA timezone and the call-time clock that every phase-17 calendar and
  // phase-19 CRM tool refuses to act without. Guardrails, spend, activity, plan and approval
  // behaviour are therefore unchanged by construction — this is the same door, not a second one.
  //
  // It throws on failure on purpose: the menu catches and renders the notice next to the control
  // the user pressed, which is closer to their attention than anything this component could show.
  const send = useSendCockpitMessage();
  const clearHistoryAction = useMutation(api.cockpit.clearChatHistory);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const runPinned = async (text: string) => {
    setSending(true);
    try {
      const res = await send({ text });
      registerThread(res.threadId, text);
    } finally {
      setSending(false);
    }
  };

  // 27-09 (PACK-02/PACK-04): the curated workflow quick starts.
  //
  // `listPacks` is ACTIVE-ONLY on the server, so during the dark pilot this list is empty and the
  // section renders nothing at all. There is no client-side filter to get wrong.
  //
  // It goes through `cockpit.startWorkflowPack`, NOT `useSendCockpitMessage`: a pack turn is a
  // different agent — allow-listed, structurally unable to dispatch a specialist — and folding it
  // into the conversation action would put that distinction behind an argument a caller can forget.
  // No `previewVersion` is ever sent from here; the owner's candidate preview is a separate,
  // server-checked path and this surface must never be able to reach a dark row.
  //
  // The opener is code-owned in `@pikar/core` and sent as the USER's first message, because pressing
  // Start IS the request. The conversation continues normally afterwards.
  const packs = useQuery(api.workflowPackDiscovery.listPacks);
  const startPack = useAction(api.cockpit.startWorkflowPack);
  const [startingPack, setStartingPack] = useState<string | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const onStartPack = (packId: string) => {
    const pack = packs?.find((p) => p.packId === packId);
    if (pack === undefined || sending || startingPack !== null) return;
    setPackNotice(null);
    setSending(true);
    setStartingPack(packId);
    void startPack({ packId, text: pack.opener })
      .then((res) => registerThread(res.threadId, pack.title))
      // The notice lands next to the control the user pressed. It never names the pack id — an id
      // the server refused is an id this surface must not echo back.
      .catch(() => setPackNotice("That workflow could not be started. Nothing ran — try again."))
      .finally(() => {
        setSending(false);
        setStartingPack(null);
      });
  };

  // 27-11: THE OWNER'S CANDIDATE PREVIEW, and the only surface that may send `previewVersion`.
  //
  // Skipped entirely for a non-owner — `listPackCandidates` is an `ownerQuery` and would throw, so
  // the `isOwner ? {} : "skip"` idiom (the same one `FinanceView` uses for its owner-only reads) is
  // what keeps the workspace working for everybody else. The server check is the real one; this is
  // only about not asking a question the caller is not allowed to ask.
  //
  // The version comes FROM THE CARD the owner is looking at, so the run pins the exact row that was
  // shown. Without that pin a preview would run whatever the newest candidate happened to be by the
  // time the click landed — and the browser evidence would name a version nobody watched.
  const viewer = useQuery(api.owner.viewer, {});
  const packCandidates = useQuery(
    api.workflowPackDiscovery.listPackCandidates,
    viewer?.isOwner === true ? {} : "skip",
  );
  const onPreviewPack = (packId: string) => {
    const pack = packCandidates?.find((p) => p.packId === packId);
    if (pack === undefined || sending || startingPack !== null) return;
    setPackNotice(null);
    setSending(true);
    setStartingPack(packId);
    void startPack({ packId, text: pack.opener, previewVersion: pack.version })
      .then((res) => registerThread(res.threadId, pack.title))
      .catch(() => setPackNotice("That workflow could not be started. Nothing ran — try again."))
      .finally(() => {
        setSending(false);
        setStartingPack(null);
      });
  };

  const newChat = () => setThreadId(undefined);
  const clearWorkspace = () => {
    window.sessionStorage.removeItem(WORKSPACE_SESSION_KEY);
    setTabs([REVIEW_TAB]);
    setThreadId(undefined);
    setAuthoring(false);
    setView("work");
  };
  const clearChatHistory = async (): Promise<boolean> => {
    if (
      !window.confirm("Clear all workspace chat history? Documents saved to the vault will remain.")
    ) {
      return false;
    }
    setClearingHistory(true);
    setHistoryNotice(null);
    try {
      await clearHistoryAction({});
      clearWorkspace();
      return true;
    } catch {
      setHistoryNotice("Chat history could not be cleared. Nothing was removed.");
      return false;
    } finally {
      setClearingHistory(false);
    }
  };
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
                  Business Operating Partner
                </p>
              </div>
              <div className="chat-head-icons">
                {/* Clock → past chats (persisted history); kebab → chat options. The history
                    query is isolated behind an ErrorBoundary — a slow/failed listThreads must
                    never take the cockpit down (FIX 1), it degrades to "History unavailable". */}
                <ErrorBoundary label="past-chats" fallback={<PastChatsFallback />}>
                  <PastChats threadId={threadId} onOpen={openThread} />
                </ErrorBoundary>
                {/* SKILL-01: pinned prompts, boundaried for the same reason as the history menu —
                    a failing saved-prompt read degrades this control, never the cockpit. */}
                <ErrorBoundary label="pinned-prompts" fallback={<PinnedPromptsFallback />}>
                  <PinnedPrompts onRun={runPinned} busy={sending} />
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
                      <button
                        type="button"
                        role="menuitem"
                        className="head-menu-item"
                        onClick={() => {
                          setAuthoring((a) => !a);
                          close();
                        }}
                      >
                        Adapt a business skill
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="head-menu-item"
                        disabled={clearingHistory}
                        onClick={() => void clearChatHistory().then((ok) => ok && close())}
                      >
                        {clearingHistory ? "Clearing…" : "Clear chat history"}
                      </button>
                      {historyNotice && (
                        <p
                          role="status"
                          className="head-menu-empty"
                          style={{ whiteSpace: "normal" }}
                        >
                          {historyNotice}
                        </p>
                      )}
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

            {/* SKILL-01. Above the conversation and inside the SAME pane: the card is part of the
                cockpit, not a destination. It renders regardless of mailbox state — adapting a
                skill has nothing to do with a connected inbox. */}
            {authoring && <SkillAuthoringPanel onClose={() => setAuthoring(false)} />}

            {/* The review thread is synthetic — it has no `plans` row, and sendCockpitMessage throws
                "cockpit: plan row missing for thread" (cockpit.ts:93) on any send. Reading degrades
                gracefully (listThreadMessages returns an empty page), so only the COMPOSER is
                suppressed. Do NOT loosen that backend guard instead — it protects the real cockpit.
                Gmail is deliberately absent from this gate: the cockpit is useful before any
                delivery channel is connected. */}
            {/* Discovery belongs to a FRESH workspace: once a conversation is open, six cards above
                it are clutter competing with the thread the user is already in. The section renders
                nothing at all when no pack is active, which is every deployment until 27-09's gate
                passes — so this is invisible rather than empty during the pilot. */}
            {threadId === undefined && (
              <ErrorBoundary label="workflow-packs" fallback={null}>
                <WorkflowPackQuickStarts
                  packs={packs}
                  onStart={onStartPack}
                  busy={sending}
                  starting={startingPack}
                />
                {/* Renders nothing for a non-owner (the query is skipped, so it stays `undefined`)
                    and nothing once every pack is active. It is a preview, not a second menu. */}
                <WorkflowPackOwnerPreview
                  candidates={packCandidates}
                  onPreview={onPreviewPack}
                  busy={sending}
                  starting={startingPack}
                />
                {packNotice !== null && (
                  <p role="status" style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                    {packNotice}
                  </p>
                )}
              </ErrorBoundary>
            )}
            {threadId === REVIEW_THREAD_ID ? (
              <p style={{ color: "var(--ink-soft)", margin: 0, fontSize: "0.9rem" }}>
                This is your weekly business review. Start a new chat to act on anything here.
              </p>
            ) : (
              <ChatPane
                threadId={threadId}
                onThread={registerThread}
                sending={sending}
                onSending={setSending}
              />
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
                <p style={capsTeal}>Operating workspace</p>
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
                      : `${greeting}. What should we move forward?`}
                </h2>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ink-soft)" }}>
                  {view === "canvas"
                    ? "The storyboard, the blocks and the finished reel for this thread. Nothing generates until you approve the cost."
                    : threadId
                      ? "Plans, drafts, and delivery reports render here live as the agent works."
                      : "Set a business goal in chat. Pikar will reason across your knowledge, shape the work, and bring plans and outputs here for review."}
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
                onClick={clearWorkspace}
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
