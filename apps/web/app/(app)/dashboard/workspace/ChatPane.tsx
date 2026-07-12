"use client";

import { useThreadMessages } from "@convex-dev/agent/react";
import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { AttachmentPicker, type UploadedAttachment } from "../../_components/AttachmentPicker";

// SC2 render: the left-pane conversation. The guided questions and the "review and Approve"
// copy are saved assistant turns on the agent thread (cockpit.ts is deterministic — the thread
// is a message store, the LLM only drafts the body), surfaced here via @convex-dev/agent/react
// `useThreadMessages` bound to the active threadId. The composer calls `sendCockpitMessage`
// (tenantAction → { threadId }); the first send mints the thread and lifts its id to the page so
// this pane and the cards share it. Convex reactivity refreshes the list — no polling.
//
// ponytail: static message list (non-streaming). Token-by-token rendering is a later upgrade to
// `useUIMessages` + a `syncStreams` query (research §4) — the deterministic control here has no
// streaming model to render, so the list is the right ceiling for slice 1.

const box = { border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "0.75rem" };
const bubble = (mine: boolean) => ({
  alignSelf: mine ? ("flex-end" as const) : ("flex-start" as const),
  maxWidth: "85%",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.75rem",
  background: mine ? "var(--teal-600)" : "var(--card)",
  color: mine ? "#fff" : "#222",
  border: mine ? "none" : "1px solid #e5e5e5",
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
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");
  const activity =
    plan?.status === "delivering" ? "Sending…" : plan?.status === "done" ? "Sent ✓" : plan?.status === "proposed" ? "Plan ready — review it →" : null;

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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {loading ? (
          <p style={{ color: "#666", margin: 0 }}>Loading…</p>
        ) : empty ? (
          <p style={{ color: "#666", margin: 0 }}>Tell me who to email and what to say.</p>
        ) : (
          messages.results.map((m) => (
            <div key={m.key} style={bubble(m.message?.role === "user")}>
              {messageText(m.message?.content)}
            </div>
          ))
        )}
        {activity && <div style={{ color: "#666", fontSize: "0.85rem", fontStyle: "italic" }}>{activity}</div>}
      </div>

      {/* Composer */}
      <div style={{ display: "grid", gap: "0.5rem" }}>
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
          rows={3}
          style={{ ...box, width: "100%", fontFamily: "inherit", resize: "vertical" }}
        />
        {/* ponytail: slice-1 upload only — sendCockpitMessage takes no attachments yet; wiring the
            uploaded storageIds into the plan is a later slice (INTK-02, Phase 4). */}
        <AttachmentPicker attachments={attachments} onChange={setAttachments} />
        <button
          type="button"
          disabled={busy || text.trim() === ""}
          onClick={() => void onSend()}
          style={{
            justifySelf: "start",
            padding: "0.5rem 1.2rem",
            borderRadius: "0.375rem",
            background: "var(--teal-600)",
            color: "#fff",
            border: "none",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
