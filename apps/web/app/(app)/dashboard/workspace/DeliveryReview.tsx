"use client";

import { api } from "@pikar/backend/api";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

type Row = FunctionReturnType<typeof api.plans.reportForPlan>[number];

/** A mailbox check records a user observation; this control never sends or retries mail. */
export function DeliveryReview({ row }: { row: Row }) {
  const reconcile = useMutation(api.delivery.reconcile);
  const [outcome, setOutcome] = useState<"sent" | "not_sent" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = row.deliveryAttempt;
  if (attempt?.state !== "unknown") return null;
  if (attempt.reviewedOutcome) {
    return (
      <span>
        Mailbox check recorded by you: {attempt.reviewedOutcome === "sent" ? "sent" : "not sent"}.
      </span>
    );
  }
  async function save() {
    if (!attempt || !outcome || busy) return;
    setBusy(true);
    setError("");
    try {
      await reconcile({ requestId: row.requestId, startedAt: attempt.startedAt, outcome });
    } catch {
      setError(
        "Could not record this check. Wait until ten minutes after the send attempt, then refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details style={{ width: "100%", color: "var(--ink)" }}>
      <summary>Delivery outcome unknown — review your sending mailbox</summary>
      <p>
        Automatic resending is paused. Check the recipient, subject and time in your sending
        mailbox. You can record the result after ten minutes. This records your observation and does
        not send another email.
      </p>
      <label>
        What did you establish?
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          disabled={busy}
        >
          <option value="">Choose after checking</option>
          <option value="sent">I found the sent message</option>
          <option value="not_sent">I confirmed that it was not sent</option>
        </select>
      </label>
      <button type="button" disabled={busy || !outcome} onClick={() => void save()}>
        {busy ? "Recording…" : "Record mailbox check"}
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
