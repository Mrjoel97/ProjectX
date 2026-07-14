"use client";

import { useThreadMessages } from "@convex-dev/agent/react";
import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { ArrowIcon } from "../../../(auth)/icons";
import { AttachmentPicker, type UploadedAttachment } from "../../_components/AttachmentPicker";

// SC2 render: the left-pane conversation. The guided questions and the "review and Approve"
// copy are saved assistant turns on the agent thread (cockpit.ts is deterministic — the thread
// is a message store, the LLM only drafts the body), surfaced here via @convex-dev/agent/react
// `useThreadMessages` bound to the active threadId. The composer calls `sendCockpitMessage`
// (tenantAction → { threadId }); the first send mints the thread and lifts its id to the page so
// this pane and the cards share it. Convex reactivity refreshes the list — no polling.
//
// Bubbles follow BRAND.md §5 (brand-024149): user = teal-900 fill, white text, right-aligned;
// agent = white card, ink text, left-aligned. The composer is a rounded card with a circular
// teal Send; the "can make mistakes" disclaimer below it is brand-mandated (§1).
//
// ponytail: static message list (non-streaming). Token-by-token rendering is a later upgrade to
// `useUIMessages` + a `syncStreams` query (research §4) — the deterministic control here has no
// streaming model to render, so the list is the right ceiling for slice 1.

const bubble = (mine: boolean) => ({
  alignSelf: mine ? ("flex-end" as const) : ("flex-start" as const),
  maxWidth: "85%",
  padding: "0.6rem 0.85rem",
  borderRadius: mine ? "1rem 1rem 0.25rem 1rem" : "1rem 1rem 1rem 0.25rem",
  background: mine ? "var(--teal-900)" : "var(--card)",
  color: mine ? "#fff" : "var(--ink)",
  border: mine ? "none" : "1px solid var(--rule)",
  boxShadow: mine ? "none" : "0 8px 24px -20px rgb(14 20 25 / 45%)",
  whiteSpace: "pre-wrap" as const,
});

// MessageDoc.content is a string or an array of typed parts — flatten to the text parts only.
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export function ChatPane({ threadId, onThread }: { threadId?: string; onThread: (id: string) => void }) {
  const send = useAction(api.cockpit.sendCockpitMessage);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  const messages = useThreadMessages(
    api.cockpit.listThreadMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 30 },
  );
  // Minimal live activity chip off the plan status (SC2 "Drafting…/Sending/Sent" feedback).
  // Candidates parked on the row = a name-resolution read is in flight → surface the pick prompt
  // first (it only exists during "collecting", before any status milestone).
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");
  const activity = plan?.candidates?.length
    ? "Searching your mailbox… pick a contact →"
    : plan?.status === "delivering"
      ? "Sending…"
      : plan?.status === "done"
        ? "Sent ✓"
        : plan?.status === "proposed"
          ? "Plan ready — review it →"
          : null;

  async function onSend() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await send({ threadId, text: t });
      if (!threadId) onThread(res.threadId);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  const empty = !threadId || (messages.results.length === 0 && messages.status !== "LoadingFirstPage");
  const loading = Boolean(threadId) && messages.results.length === 0 && messages.status === "LoadingFirstPage";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: "0.75rem" }}>
      {/* Message list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {loading ? (
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>Loading…</p>
        ) : empty ? (
          <p style={{ color: "var(--ink-soft)", margin: 0 }}>Tell me who to email and what to say.</p>
        ) : (
          messages.results.map((m) => (
            <div key={m.key} data-testid="chat-message" style={bubble(m.message?.role === "user")}>
              {messageText(m.message?.content)}
            </div>
          ))
        )}
        {activity && (
          <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem", fontStyle: "italic" }}>{activity}</div>
        )}
      </div>

      {/* Composer — one rounded card: textarea + attach row + circular teal Send */}
      <div style={{ display: "grid", gap: "0.4rem" }}>
        <div
          style={{
            border: "1px solid var(--rule)",
            borderRadius: "1rem",
            padding: "0.6rem 0.75rem",
            background: "var(--card)",
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
            placeholder="Describe your goal…"
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {/* ponytail: slice-1 upload only — sendCockpitMessage takes no attachments yet; wiring the
                uploaded storageIds into the plan is a later slice (INTK-02, Phase 4). */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <AttachmentPicker attachments={attachments} onChange={setAttachments} />
            </div>
            <button
              type="button"
              aria-label={busy ? "Sending" : "Send"}
              disabled={busy || text.trim() === ""}
              onClick={() => void onSend()}
              style={{
                width: "2.6rem",
                height: "2.6rem",
                flex: "none",
                borderRadius: "999px",
                background: "var(--teal-600)",
                color: "#fff",
                border: "none",
                display: "grid",
                placeItems: "center",
                cursor: busy || text.trim() === "" ? "default" : "pointer",
                opacity: busy || text.trim() === "" ? 0.5 : 1,
              }}
            >
              <ArrowIcon size={18} />
            </button>
          </div>
        </div>
        {/* Brand-mandated honesty line (BRAND.md §1) */}
        <p style={{ margin: 0, textAlign: "center", fontSize: "0.72rem", color: "var(--ink-soft)" }}>
          Pikar AI can make mistakes. Consider checking important information. Press Shift+Enter for a new line.
        </p>
      </div>
    </div>
  );
}
