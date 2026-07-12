"use client";

import { api } from "@pikar/backend/api";
import type { FunctionReturnType } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";

// SC3/SC5 render: the right-pane artifact dispatcher over the live `plans` row + REPORT
// projection. Cards are plain inline-styled <div>s (the `box` style mirrors review/[id]).
// Everything here is fed by Convex `useQuery` reactivity — the PLAN card appears when the
// plan is proposed, the REPORT fills per recipient as the fan-out patches `requests` rows.
// No polling, no socket code (the DeadLetterBadge / ReconnectBanner idiom).

const box = { border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "1rem" };
const btn = { padding: "0.5rem 1rem", borderRadius: "0.375rem", cursor: "pointer" };
const label = { fontSize: "0.8rem", color: "#666", fontWeight: 700 } as const;
const dim = { color: "#666", fontSize: "0.85rem" } as const;
const muted = { color: "#666", margin: 0 } as const;
const chip = {
  padding: "0.15rem 0.6rem",
  borderRadius: "1rem",
  background: "var(--canvas, #f1f5f9)",
  border: "1px solid #e5e5e5",
  fontSize: "0.85rem",
} as const;

// Derive the plan-row shape from the api (repo convention — no dataModel import; mirrors
// AttachmentPicker/review). byThread returns the row or null; the cards want the non-null row.
type Plan = NonNullable<FunctionReturnType<typeof api.plans.byThread>>;
type PlanId = Plan["_id"];

// Live REPORT status → badge colour. Fan-out rows seed at "approved" and move
// delivering → sent | awaiting_reauth | failed (requests.status, schema.ts).
function badge(status: string) {
  const map: Record<string, { bg: string; fg: string }> = {
    sent: { bg: "#dcfce7", fg: "#166534" },
    failed: { bg: "#fee2e2", fg: "#991b1b" },
    blocked: { bg: "#fee2e2", fg: "#991b1b" },
    rejected: { bg: "#fee2e2", fg: "#991b1b" },
    expired: { bg: "#fee2e2", fg: "#991b1b" },
    awaiting_reauth: { bg: "#fef3c7", fg: "#92400e" },
  };
  const c = map[status] ?? { bg: "#f1f5f9", fg: "#334155" }; // in-progress (approved/delivering/…)
  return { ...c, padding: "0.1rem 0.5rem", borderRadius: "0.375rem", fontSize: "0.8rem", fontWeight: 700 };
}

function PlanCard({ plan }: { plan: Plan }) {
  const execute = useMutation(api.cockpit.executePlan);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recipients = plan.recipients ?? [];
  const mode = plan.mode ?? "individual";
  const body = plan.body ?? "";

  // Single Approve gate (REVW-01). The busy flag makes a second click a client-side no-op;
  // the server CAS (proposed→approved) makes a double-approve send exactly once (idempotent).
  async function approve() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await execute({ planId: plan._id });
      if (!res.ok && res.reason === "gmail_not_connected") setNote("Connect Gmail before approving.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={label}>PLAN</div>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
        {recipients.length === 0 ? <span style={dim}>No recipients yet.</span> : recipients.map((r) => <span key={r} style={chip}>{r}</span>)}
      </div>
      <div style={dim}>Mode: {mode}</div>
      <div style={{ margin: "0.5rem 0" }}>
        <strong>Subject:</strong> {plan.subject || "—"}
      </div>
      <div style={label}>PREVIEW</div>
      <p style={{ whiteSpace: "pre-wrap", margin: "0.25rem 0 0.75rem", color: "#444" }}>
        {body.slice(0, 240)}
        {body.length > 240 ? "…" : ""}
      </p>
      <ol style={{ margin: "0 0 0.75rem", paddingLeft: "1.25rem", color: "#444" }}>
        <li>Draft the email</li>
        <li>
          Send to {recipients.length} recipient{recipients.length === 1 ? "" : "s"} ({mode})
        </li>
      </ol>
      <button
        type="button"
        disabled={busy}
        onClick={() => void approve()}
        style={{ ...btn, background: "var(--teal-600)", color: "#fff", border: "none", fontWeight: 600 }}
      >
        {busy ? "Approving…" : "Approve"}
      </button>
      {note && (
        <p role="alert" style={{ color: "#dc2626", margin: "0.5rem 0 0" }}>
          {note}
        </p>
      )}
    </div>
  );
}

function DraftCard({ plan }: { plan: Plan }) {
  // "Editable via chat" = this card just re-renders the latest plan row; no inline editor.
  // ponytail: edits arrive as new plan-row versions from the guided conversation (slice 1).
  return (
    <div style={box}>
      <div style={label}>EMAIL DRAFT</div>
      <div style={{ margin: "0.5rem 0" }}>
        <strong>Subject:</strong> {plan.subject || "—"}
      </div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, color: "#333" }}>{plan.body ?? ""}</pre>
    </div>
  );
}

function ReportCard({ planId }: { planId: PlanId }) {
  // LIVE projection (plans.reportForPlan): one row per recipient, filling as the fan-out
  // patches requests.status and the gmail.sent audit lands the messageId. Reactive — no polling.
  const rows = useQuery(api.plans.reportForPlan, { planId });
  return (
    <div style={box}>
      <div style={label}>REPORT</div>
      {rows === undefined ? (
        <p style={{ ...dim, marginTop: "0.5rem" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ ...dim, marginTop: "0.5rem" }}>No recipients yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0", display: "grid", gap: "0.5rem" }}>
          {rows.map((r) => (
            <li key={r.correlationId} style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={badge(r.status)}>{r.status}</span>
              <span style={{ fontWeight: 600 }}>{r.recipient}</span>
              {r.messageId && <span style={dim}>msg {r.messageId}</span>}
              {/* Audit ref: the row's correlationId keys its append-only audit trail (refs only,
                  CLAUDE.md §4). ponytail: a dedicated per-correlation audit-trail view is a later
                  slice — surfacing the id (selectable) is the honest link target for now. */}
              <code style={{ ...dim, marginLeft: "auto" }}>audit: {r.correlationId}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ContactMatch = NonNullable<Plan["candidates"]>[number]["matches"][number];

// A resolved contact hint (USER-only display — never sent to the LLM, CLAUDE.md §4).
function matchHint(m: ContactMatch): string {
  const parts = [`${m.count} msg${m.count === 1 ? "" : "s"}`];
  if (m.lastDateMs) parts.push(new Date(m.lastDateMs).toLocaleDateString());
  return parts.join(", ");
}

function ResolutionCard({ plan, threadId }: { plan: Plan; threadId: string }) {
  const resolve = useAction(api.cockpit.resolveRecipients);
  const candidates = plan.candidates ?? [];
  const pendingValid = plan.pendingValid ?? [];
  const [busy, setBusy] = useState(false);
  // Selection = one address per name. Single-match sections pre-select their only chip, but the
  // "Use these contacts" click is still required to confirm (a name→address is an inference).
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of candidates) {
      const [only] = c.matches;
      if (c.matches.length === 1 && only) init[c.name] = only.address;
    }
    return init;
  });

  const allPicked = candidates.every((c) => picked[c.name]);

  async function useContacts() {
    if (busy || !allPicked) return;
    setBusy(true);
    try {
      const picks = candidates.flatMap((c) => {
        const address = picked[c.name];
        if (!address) return [];
        const m = c.matches.find((x) => x.address === address);
        return [{ name: c.name, address, displayName: m?.displayName }];
      });
      await resolve({ threadId, picks });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={label}>PICK A CONTACT</div>
      {candidates.map((c) => (
        <div key={c.name} style={{ margin: "0.5rem 0" }}>
          <div style={{ ...dim, fontWeight: 600, marginBottom: "0.3rem" }}>{c.name}</div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {c.matches.map((m) => {
              const sel = picked[c.name] === m.address;
              return (
                <button
                  key={m.address}
                  type="button"
                  onClick={() => setPicked((p) => ({ ...p, [c.name]: m.address }))}
                  style={{
                    ...chip,
                    cursor: "pointer",
                    textAlign: "left",
                    borderColor: sel ? "var(--teal-600)" : "#e5e5e5",
                    background: sel ? "var(--teal-50, #f0fdfa)" : "var(--canvas, #f1f5f9)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{m.displayName ?? m.address}</span>
                  <span style={dim}> · {m.address} · {matchHint(m)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {pendingValid.length > 0 && (
        <div style={{ margin: "0.5rem 0" }}>
          <div style={{ ...dim, fontWeight: 600, marginBottom: "0.3rem" }}>Already valid</div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {pendingValid.map((a) => (
              <span key={a} style={{ ...chip, borderColor: "var(--teal-600)", background: "var(--teal-50, #f0fdfa)" }}>{a}</span>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !allPicked}
        onClick={() => void useContacts()}
        style={{ ...btn, marginTop: "0.5rem", background: "var(--teal-600)", color: "#fff", border: "none", fontWeight: 600, opacity: allPicked ? 1 : 0.5 }}
      >
        {busy ? "Resolving…" : "Use these contacts"}
      </button>
    </div>
  );
}

/** Reads the thread's single plan row and dispatches PLAN / DRAFT / REPORT cards. */
export function CardList({ threadId }: { threadId?: string }) {
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");

  if (!threadId) return <p style={muted}>No artifacts yet.</p>;
  if (plan === undefined) return <p style={muted}>Loading…</p>;
  if (plan === null) return <p style={muted}>No plan yet — answer the questions to build one.</p>;

  const hasDraft = Boolean(plan.body) || Boolean(plan.subject);
  const reporting = plan.status === "delivering" || plan.status === "done";
  // Resolution happens during "collecting", BEFORE the PLAN — render the pick card whenever the
  // cockpit has parked candidates and the plan hasn't been proposed/delivered yet.
  const resolving = Boolean(plan.candidates?.length) && plan.status !== "proposed" && !reporting;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {resolving && <ResolutionCard plan={plan} threadId={threadId} />}
      {plan.status === "proposed" && <PlanCard plan={plan} />}
      {hasDraft && <DraftCard plan={plan} />}
      {reporting && <ReportCard planId={plan._id} />}
    </div>
  );
}
