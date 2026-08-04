"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

// REVW-01 + AGNT-02: the collapsed review gate. Route + the READ-ONLY step plan +
// recipient + the drafted email are shown TOGETHER, with four typed decisions:
// Approve / Edit / Ask for changes / Reject. The recipient is re-displayed
// prominently before approval — a hallucinated address is the phase's highest-severity
// failure (CONTEXT). Attempt/cap are read server-side; "Ask for changes" disappears at
// the cap because past it a regenerate would fall through to an unapproved send.
type Mode = "view" | "edit" | "regenerate" | "reject";

const box = { border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "1rem" };
const btn = { padding: "0.5rem 1rem", borderRadius: "0.375rem", cursor: "pointer" };

export default function ReviewGate() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const args = { requestId: params.id } as FunctionArgs<typeof api.requests.reviewGate>;
  const gate = useQuery(api.requests.reviewGate, args);
  const submitDecision = useMutation(api.requests.submitDecision);

  const [mode, setMode] = useState<Mode>("view");
  const [editedText, setEditedText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (gate === undefined) return <p>Loading…</p>;
  if (gate === null) return <p>Request not found.</p>;

  const { request, canRegenerate } = gate;
  const draft = request.editedBody ?? request.draft ?? "";

  async function send(
    decision: "approve" | "edit_text" | "regenerate" | "reject",
    extra: Record<string, string> = {},
  ) {
    setBusy(true);
    try {
      await submitDecision({ correlationId: request.correlationId, decision, ...extra });
      router.push("/review");
    } finally {
      setBusy(false);
    }
  }

  const awaitingReview = request.status === "awaiting_review";

  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: "48rem" }}>
      <h1>Review</h1>

      {/* Recipient — re-displayed prominently before approval. */}
      <div style={{ ...box, background: "#fffbeb", borderColor: "#f59e0b" }}>
        <div style={{ fontSize: "0.8rem", color: "#92400e", fontWeight: 700 }}>SENDING TO</div>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{request.recipient}</div>
      </div>

      {/* Route + read-only step plan. */}
      <div style={box}>
        <div style={{ fontSize: "0.8rem", color: "#666", fontWeight: 700 }}>PLAN (read-only)</div>
        <div>Route: {request.route ?? "—"}</div>
        <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", color: "#444" }}>
          <li>Draft the response to the goal</li>
          <li>Send the email to {request.recipient}</li>
        </ol>
      </div>

      {/* The drafted email. */}
      <div style={box}>
        <div style={{ fontSize: "0.8rem", color: "#666", fontWeight: 700 }}>SUBJECT</div>
        <div style={{ marginBottom: "0.75rem" }}>{request.goal}</div>
        <div style={{ fontSize: "0.8rem", color: "#666", fontWeight: 700 }}>DRAFT</div>
        {mode === "edit" ? (
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "inherit" }}
          />
        ) : (
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{draft}</pre>
        )}
      </div>

      {!awaitingReview ? (
        <p style={{ color: "#666" }}>
          This request is no longer awaiting review (status: {request.status}).
        </p>
      ) : mode === "regenerate" ? (
        <div style={{ ...box, display: "grid", gap: "0.5rem" }}>
          <label htmlFor="instruction">What should change?</label>
          <textarea
            id="instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            style={{ width: "100%", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={busy || instruction.trim() === ""}
              onClick={() => void send("regenerate", { instruction })}
              style={{ ...btn, background: "#2563eb", color: "#fff", border: "none" }}
            >
              Send changes
            </button>
            <button type="button" onClick={() => setMode("view")} style={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : mode === "reject" ? (
        <div style={{ ...box, display: "grid", gap: "0.5rem" }}>
          <label htmlFor="reason">Reason (optional)</label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            style={{ width: "100%", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send("reject", reason.trim() ? { reason } : {})}
              style={{ ...btn, background: "#dc2626", color: "#fff", border: "none" }}
            >
              Confirm reject
            </button>
            <button type="button" onClick={() => setMode("view")} style={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : mode === "edit" ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            disabled={busy || editedText.trim() === ""}
            onClick={() => void send("edit_text", { editedText })}
            style={{ ...btn, background: "#16a34a", color: "#fff", border: "none" }}
          >
            Send edited email
          </button>
          <button type="button" onClick={() => setMode("view")} style={btn}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("approve")}
            style={{ ...btn, background: "#16a34a", color: "#fff", border: "none" }}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditedText(draft);
              setMode("edit");
            }}
            style={btn}
          >
            Edit
          </button>
          {canRegenerate && (
            <button type="button" disabled={busy} onClick={() => setMode("regenerate")} style={btn}>
              Ask for changes
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("reject")}
            style={{ ...btn, color: "#dc2626" }}
          >
            Reject
          </button>
        </div>
      )}
    </section>
  );
}
