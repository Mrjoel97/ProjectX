"use client";

import { api } from "@pikar/backend/api";
import { type RejectionReason, validateSubmit } from "@pikar/core/validateSubmit";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AttachmentPicker, type UploadedAttachment } from "../_components/AttachmentPicker";

// Human-readable copy for each server/client rejection reason. The server is the trust
// boundary (INTK-04) — these same reasons come back from requests.submit; client checks
// only spare a round trip.
const REJECTION_COPY: Record<RejectionReason, string> = {
  empty_goal: "Describe what you want Pikar to do.",
  goal_too_long: "That goal is too long.",
  bad_recipient: "Enter a valid recipient email address.",
  bad_mime: "One attachment is an unsupported file type.",
  attachment_too_large: "One attachment is too large.",
  too_many_attachments: "Too many attachments.",
};

// Recipient FIRST (CONTEXT): To: is the field with the irreversible, outward-facing
// consequence, so it leads the form. Attachments upload as picked; submit sends ready
// storageIds. On success we route to the live requests list where status animates.
export default function Submit() {
  const submit = useMutation(api.requests.submit);
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [goal, setGoal] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const local = validateSubmit({ goal, recipient, attachments });
    if (!local.ok) {
      setError(REJECTION_COPY[local.reason]);
      return;
    }

    setSubmitting(true);
    try {
      const result = await submit({ goal, recipient, attachments });
      if (!result.ok) {
        setError(REJECTION_COPY[result.reason as RejectionReason]);
        return;
      }
      router.push("/requests");
    } catch {
      setError("Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={{ maxWidth: "40rem" }}>
      <h1>New request</h1>
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "1.25rem" }}>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>To</span>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="recipient@example.com"
            autoComplete="off"
            style={{ padding: "0.6rem", fontSize: "1rem" }}
          />
        </label>

        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>Goal</span>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Draft a short note letting them know…"
            rows={6}
            style={{ padding: "0.6rem", fontSize: "1rem", resize: "vertical" }}
          />
        </label>

        <div style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>Attach</span>
          <AttachmentPicker attachments={attachments} onChange={setAttachments} />
        </div>

        {error && (
          <p role="alert" style={{ color: "#dc2626", margin: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            justifySelf: "start",
            padding: "0.7rem 1.5rem",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: submitting ? "default" : "pointer",
            borderRadius: "0.5rem",
            border: "1px solid var(--border, #d0d0d0)",
          }}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </section>
  );
}
