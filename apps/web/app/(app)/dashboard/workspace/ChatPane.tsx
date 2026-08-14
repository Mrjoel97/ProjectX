"use client";

import { useThreadMessages } from "@convex-dev/agent/react";
import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  BoltIcon,
  BrainIcon,
  ChevronDownIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  UserIcon,
} from "../../../(auth)/icons";
import { MarkdownDocument } from "../MarkdownDocument";
// The verb map lives in exactly ONE module (cards.tsx) and both surfaces read it through
// stepText — a second copy WILL drift, and a drifted verb is a surface disagreeing with itself.
import { stepText, traceText } from "./cards";
import { IntakeControls } from "./IntakeControls";
import { useSendCockpitMessage } from "./useSendCockpitMessage";

// SC2 render: the left-pane conversation. The guided questions and the "review and Approve"
// copy are saved assistant turns on the agent thread (cockpit.ts is deterministic — the thread
// is a message store, the LLM only drafts the body), surfaced here via @convex-dev/agent/react
// `useThreadMessages` bound to the active threadId. The composer calls `sendCockpitMessage`
// (tenantAction → { threadId }); the first send mints the thread and lifts its id + label to
// the page so this pane, the tab strip, and the cards share it. Convex reactivity refreshes
// the list — no polling.
//
// Chrome replicates brand-024149: agent turns get the gradient avatar + "Pikar AI" name label
// and a white card bubble; user turns get the teal-900 bubble, person avatar, and a hover Copy
// chip. The composer is one rounded card — "Auto" model pill, brain/attach/mic icons, circular
// teal Send — with the brand-mandated §1 disclaimer below. Enter-to-send unchanged (the e2e
// path). Model pill / brain are disabled until their capabilities exist (their titles say so).
// Attach + mic are the Phase-4 IntakeControls (INTK-02/03 — upload/dictate → classify →
// extract → redact → merge into this thread); they need a minted threadId, so before the
// first send they render as disabled placeholders whose titles say to send a message first.
//
// ponytail: static message list (non-streaming). What DID land instead is the tool-step trace
// (`agentSteps` — CKPT-05, below): the in-progress bubble lists the steps the agent is taking as
// they happen, which is the half the user actually asked for. Assistant-TOKEN streaming ("watch
// the reply type itself") is the blocked half, and the door is WELDED SHUT — not a "later
// upgrade": `@convex-dev/agent@0.6.4` peer-requires `ai@^6`, this repo pins `ai@7`, and 0.6.4 is
// the LATEST published version, so there is nothing to bump to (and CLAUDE.md §6 forbids bumping
// these pins anyway). Revisit ONLY if an `ai@7`-compatible `@convex-dev/agent` release ships.
// (03.9-RESEARCH §Standard Stack; the same correction landed at cockpit.ts:168 in 03.9-02.)

const bubble = (mine: boolean) => ({
  padding: "0.6rem 0.85rem",
  borderRadius: mine ? "1rem 1rem 0.25rem 1rem" : "1rem 1rem 1rem 0.25rem",
  background: mine ? "var(--teal-900)" : "var(--card)",
  color: mine ? "#fff" : "var(--ink)",
  border: mine ? "none" : "1px solid var(--rule)",
  boxShadow: mine
    ? "0 10px 24px -16px rgb(11 79 74 / 70%)"
    : "0 8px 24px -20px rgb(14 20 25 / 45%)",
  whiteSpace: "pre-wrap" as const,
});

// SKILL-01 "routine v0": pinning a prompt saves the message TEXT and nothing else. The state lives
// in words on the button itself, never in colour alone (BRAND §6) — the chip is a translucent
// overlay on a teal bubble, and a colour-coded one would be unreadable there anyway.
export type PinState = "busy" | "saved" | "error";

export function pinLabel(state?: PinState): string {
  if (state === "busy") return "Pinning…";
  if (state === "saved") return "Pinned ✓";
  // Says what happened AND what to do. A failed save that still reads "Pinned" is the small
  // dishonesty BRAND §1 forbids: the user would go looking for a prompt that was never stored.
  if (state === "error") return "Pin failed — try again";
  return "Pin prompt";
}

// Business-first starting points for an empty cockpit. These populate the composer for review;
// they never execute on click, so the user stays in control of the exact instruction that starts
// a turn. Email is intentionally not the default framing — it is one execution channel the agent
// can select when the work actually calls for it.
export const COCKPIT_STARTERS = [
  "Review my business and identify the highest-leverage next move.",
  "Turn my current strategy into a focused 30-day operating plan.",
  "Analyze my offer, pipeline, and finances for the biggest risk and opportunity.",
] as const;

// MessageDoc.content is a string or an array of typed parts — flatten to the text parts only.
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

export function ChatPane({
  threadId,
  onThread,
  sending,
  onSending,
}: {
  threadId?: string;
  onThread: (id: string, firstText: string) => void;
  // Lifted to the page (FIX 4) so the workspace ActivityCard sees the same in-flight signal — it is
  // this pane's send-button `busy` AND the "a first turn is in flight" flag the trace gate needs.
  sending: boolean;
  onSending: (v: boolean) => void;
}) {
  // Carries the browser's trusted clock on every turn (§2-D) — see useSendCockpitMessage.
  const send = useSendCockpitMessage();
  // SKILL-01: pinning is a tenant-owned preference write, not a turn. It takes no thread, mints no
  // plan and spends nothing, so it is a plain mutation and deliberately NOT routed through the
  // send hook. Keyed by message key so two bubbles never share one chip's state.
  const savePrompt = useMutation(api.savedPrompts.save);
  const [pinned, setPinned] = useState<Record<string, PinState>>({});
  const [text, setText] = useState("");
  const busy = sending;
  const setBusy = onSending;

  const messages = useThreadMessages(
    api.cockpit.listThreadMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 30 },
  );
  // Minimal MILESTONE chip off the plan status (SC2 "Drafting…/Sending/Sent" feedback).
  // Candidates parked on the row = a name-resolution read is in flight → surface the pick prompt
  // first (it only exists during "collecting", before any status milestone).
  // This is COMPLEMENTARY to the step trace below, not redundant: it reports milestones and only
  // lights AFTER the wait is over, whereas the trace is the live one. Both are kept.
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");
  const milestone = plan?.candidates?.length
    ? "Searching your mailbox… pick a contact →"
    : plan?.status === "delivering"
      ? "Sending…"
      : plan?.status === "done"
        ? "Sent ✓"
        : plan?.status === "proposed"
          ? "Plan ready — review it →"
          : null;

  // The in-progress agent bubble (CKPT-05). The SAME query the workspace ActivityCard subscribes
  // to — one query feeds both surfaces, so the bubble and the canvas can never disagree. NO args:
  // on the first message there is no threadId until send() resolves (research Pitfall 1).
  const activity = useQuery(api.agentSteps.latestTurn);
  // FIX 4: the no-thread case is gated on `sending`, not shown unconditionally. With a threadId we
  // match on it (a settled turn's LATEST TRACE); WITHOUT one we show the latest turn ONLY while a
  // first turn is in flight (sending) — otherwise a brand-new/idle chat leaks the PREVIOUS thread's
  // trace + a phantom "Thought process" bubble. `sending` stays true for the whole first turn (it
  // is the send-button busy flag), so this does NOT regress the first-turn trap it protects.
  const steps =
    activity && (threadId !== undefined ? activity.threadId === threadId : sending)
      ? activity.steps
      : [];
  // `latestTurn` returns steps ascending by startedAt, so the LAST running row is the current one.
  const current = [...steps].reverse().find((s) => s.phase === "running");
  // null = follow the turn (expanded while running, collapsed once settled — research Open
  // Question 2, on Plan 04's human-verify list); true/false = the user overrode it via the brain
  // button. BRAND §5 specifies this exact affordance: agent bubble + collapsible "Thought Process".
  const [traceOpen, setTraceOpen] = useState<boolean | null>(null);
  const open = traceOpen ?? Boolean(current);

  async function onSend() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    // Clear the box IMMEDIATELY (FIX 2) so the turn reads as sent — send() awaits 10-30s and the
    // old order (setText after the await) left the text sitting there the whole time, looking
    // unsent. On a throw we RESTORE it: never eat what the user typed (that guarantee is why the
    // clear was ordered last originally; keep the guarantee, fix the UX).
    setText("");
    try {
      const res = await send({ threadId, text: t });
      if (!threadId) onThread(res.threadId, t);
    } catch (err) {
      setText(t);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Deliberately swallows the failure into a label instead of rethrowing (unlike `onSend`, which
  // rethrows after restoring the user's text). A pin is a convenience: a failed one must cost the
  // user a chip that says so, never the conversation they are in the middle of.
  async function pin(key: string, body: string) {
    if (pinned[key] === "busy") return;
    setPinned((p) => ({ ...p, [key]: "busy" }));
    try {
      await savePrompt({ text: body });
      setPinned((p) => ({ ...p, [key]: "saved" }));
    } catch {
      // The user's own words never reach an error string or a log (CLAUDE.md §4). The server's
      // refusals here are "empty" and "too long", and the message is already on screen above.
      setPinned((p) => ({ ...p, [key]: "error" }));
    }
  }

  const empty =
    !threadId || (messages.results.length === 0 && messages.status !== "LoadingFirstPage");
  const loading =
    Boolean(threadId) && messages.results.length === 0 && messages.status === "LoadingFirstPage";

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: "0.75rem" }}
    >
      {/* Message list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.7rem",
        }}
      >
        {loading ? (
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>Loading…</p>
        ) : empty ? (
          <div
            data-testid="cockpit-empty-state"
            style={{
              color: "var(--ink-soft)",
              display: "grid",
              gap: "0.65rem",
              alignContent: "start",
            }}
          >
            <fieldset
              aria-label="Suggested business prompts"
              style={{
                border: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                margin: 0,
                padding: 0,
              }}
            >
              {COCKPIT_STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="composer-pill"
                  onClick={() => setText(starter)}
                  style={{
                    height: "auto",
                    maxWidth: "100%",
                    padding: "0.45rem 0.65rem",
                    textAlign: "left",
                    whiteSpace: "normal",
                  }}
                >
                  {starter}
                </button>
              ))}
            </fieldset>
          </div>
        ) : (
          messages.results.map((m) => {
            const mine = m.message?.role === "user";
            const body = messageText(m.message?.content);
            return (
              <div key={m.key} className={`msg-row${mine ? " is-user" : ""}`}>
                {!mine && (
                  <span className="msg-avatar agent" aria-hidden="true">
                    <BrainIcon size={14} />
                  </span>
                )}
                <div className="msg-col">
                  {!mine && <span className="msg-name">Pikar AI</span>}
                  <div className="bubble-wrap">
                    <div data-testid="chat-message" style={bubble(mine)}>
                      {mine ? body : <MarkdownDocument markdown={body} compact />}
                    </div>
                    {/* The hover chips. `.msg-copy` is absolutely positioned on its own, so two of
                        them would stack — this wrapper takes the position and the chips go static
                        inside it, reusing the existing chip look rather than adding a class. A pin
                        that has a state is forced visible: a "Pin failed" chip that vanishes when
                        the pointer leaves has not told the user anything. */}
                    {mine && (
                      <div
                        className="bubble-actions"
                        style={{
                          position: "absolute",
                          top: "0.35rem",
                          right: "0.45rem",
                          display: "flex",
                          gap: "0.25rem",
                        }}
                      >
                        <button
                          type="button"
                          className="msg-copy"
                          style={{ position: "static" }}
                          onClick={() => void navigator.clipboard?.writeText(body)}
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          className="msg-copy"
                          style={{ position: "static", opacity: pinned[m.key] ? 1 : undefined }}
                          aria-label={pinLabel(pinned[m.key])}
                          aria-busy={pinned[m.key] === "busy"}
                          disabled={pinned[m.key] === "busy"}
                          title="Save this prompt so you can run it again from Pinned prompts"
                          onClick={() => void pin(m.key, body)}
                        >
                          {pinLabel(pinned[m.key])}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {mine && (
                  <span className="msg-avatar user" aria-hidden="true">
                    <UserIcon size={14} />
                  </span>
                )}
              </div>
            );
          })
        )}
        {/* The in-progress agent bubble — BRAND §5's specified pattern: agent = white card,
            --ink text, left-aligned, with an optional collapsible "Thought Process" trace.
            Reuses the real agent-turn chrome so it reads as a turn, not a foreign widget. */}
        {steps.length > 0 && (
          <div className="msg-row" data-testid="agent-activity">
            <span className="msg-avatar agent" aria-hidden="true">
              <BrainIcon size={14} />
            </span>
            <div className="msg-col">
              <span className="msg-name">Pikar AI</span>
              <div className="bubble-wrap">
                <div style={{ ...bubble(false), display: "grid", gap: "0.4rem" }}>
                  {/* No aria-live here on purpose: the workspace ActivityCard is always on
                      screen (the cockpit is two-pane) and already announces these exact rows.
                      A second live region would read every step TWICE. */}
                  {open ? (
                    steps.map((s) => (
                      <div key={s.stepKey} className="trace-line">
                        <span style={traceText}>{stepText(s)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="trace-line">
                      <span style={traceText}>
                        {current
                          ? stepText(current)
                          : `Thought process · ${steps.length} step${steps.length === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {milestone && <div className="trace-line">{milestone}</div>}
      </div>

      {/* Composer — one rounded glass card: textarea, then Auto pill + brain/attach/mic + Send */}
      <div style={{ display: "grid", gap: "0.4rem" }}>
        <div
          style={{
            border: "1px solid var(--rule)",
            borderRadius: "1rem",
            padding: "0.6rem 0.75rem",
            background: "rgb(255 255 255 / 88%)",
            boxShadow: "0 10px 30px -24px rgb(14 20 25 / 45%)",
            display: "grid",
            gap: "0.5rem",
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="What business outcome should we work on?"
            rows={2}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              resize: "none",
              fontFamily: "inherit",
              fontSize: "0.95rem",
              background: "transparent",
              color: "var(--ink)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="composer-pill"
              disabled
              title="Model routing is automatic"
            >
              <BoltIcon size={13} /> Auto <ChevronDownIcon size={12} />
            </button>
            <span style={{ flex: 1 }} />
            {/* This phase IS the feature this button was waiting for, so its title no longer
                promises a future one — shipping the trace while the button still called it
                unbuilt is exactly the small dishonesty BRAND §5's honest-zeros rule prevents
                (the literal old string is left out so a grep guard stays meaningful). It toggles
                the bubble's collapsible "Thought Process" trace (BRAND §5, verbatim), and is
                disabled only while there is genuinely no trace to show. */}
            <button
              type="button"
              className="icon-btn"
              disabled={steps.length === 0}
              aria-pressed={open}
              onClick={() => setTraceOpen(!open)}
              title={
                steps.length === 0
                  ? "Thought process — send a message and the agent's steps show here"
                  : open
                    ? "Hide the agent's thought process"
                    : "Show the agent's thought process"
              }
            >
              <BrainIcon size={17} />
            </button>
            {threadId ? (
              <IntakeControls threadId={threadId} />
            ) : (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  disabled
                  title="Send a message first — then attach files"
                >
                  <PaperclipIcon size={17} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled
                  title="Send a message first — then dictate"
                >
                  <MicIcon size={17} />
                </button>
              </>
            )}
            {/* Busy affordance (FIX 3): while a turn is in flight the button shows a spinning ring,
                stays disabled, and says "Working…" (title + aria-label + aria-busy) — visible at a
                glance and not colour-dependent (BRAND §6). Deliberately NOT red: BRAND reserves amber
                for the approval gate alone and defines no busy/red token, and red means destructive. */}
            <button
              type="button"
              aria-label={busy ? "Working…" : "Send"}
              title={busy ? "Working…" : "Send"}
              aria-busy={busy}
              disabled={busy || text.trim() === ""}
              onClick={() => void onSend()}
              style={{
                width: "2.5rem",
                height: "2.5rem",
                flex: "none",
                borderRadius: "999px",
                background: "var(--teal-600)",
                color: "#fff",
                border: "none",
                display: "grid",
                placeItems: "center",
                cursor: busy || text.trim() === "" ? "default" : "pointer",
                opacity: busy || text.trim() === "" ? 0.5 : 1,
                boxShadow:
                  "0 8px 18px -8px rgb(0 150 137 / 70%), inset 0 1px 1px rgb(255 255 255 / 35%)",
              }}
            >
              {busy ? <span className="btn-spinner" aria-hidden="true" /> : <SendIcon size={16} />}
            </button>
          </div>
        </div>
        {/* Brand-mandated honesty line (BRAND.md §1) */}
        <p
          style={{ margin: 0, textAlign: "center", fontSize: "0.72rem", color: "var(--ink-soft)" }}
        >
          Pikar AI can make mistakes. Consider checking important information. Press Shift+Enter for
          a new line.
        </p>
      </div>
    </div>
  );
}
