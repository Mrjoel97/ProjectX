"use client";

import { api } from "@pikar/backend/api";
// The pure view model (Gap 1): lede + action-first needs-you + time-grouped fyi remainder +
// collapsed-noise count. ALL the ordering/collapse/lede intelligence lives in @pikar/core — this
// card is a dumb renderer over it, never re-deriving any of it (ADR-004 / cockpit.md).
import { buildBriefingView } from "@pikar/core/briefing";
// Far-future cap (SCHD-01): the soft UI complement to executePlan's hard send_time_too_far refusal —
// one shared horizon, so the picker can't offer a time the server will reject.
import { SEND_TIME_HORIZON_MS } from "@pikar/core";
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
// Same derivation for the briefing row (CKPT-04). The card renders the row and NOTHING else:
// sender/ts/bucket are code-owned facts joined server-side by @pikar/core (ADR-004).
type Briefing = NonNullable<FunctionReturnType<typeof api.briefings.byThread>>;
type BriefingItem = Briefing["items"][number];
// Same derivation for the activity trace (CKPT-05).
type Activity = NonNullable<FunctionReturnType<typeof api.agentSteps.latestTurn>>;
export type StepView = Activity["steps"][number];

// Deferred send (SCHD-01) time helpers. The browser IS in the user's tz, so the native
// datetime-local input round-trips epoch ms ↔ local wall-clock without any tz math of our own
// (RESEARCH Pattern 6 — "don't hand-roll timezones"). `sendAt` (epoch ms) is the ONE source of truth.
const pad = (n: number) => String(n).padStart(2, "0");
/** epoch ms → the local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInputValue(epoch: number): string {
  const d = new Date(epoch);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** The absolute instant a user reads before Approve — full local date/time + the resolved tz. */
function formatAbsolute(epoch: number): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${new Date(epoch).toLocaleString()} (${tz})`;
}

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

// Human byte size for the attachment rows (lazy: KB/MB thresholds, no lib).
function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// Shared list-row style for an attachment (mirrors the AttachmentPicker idiom).
const attRow = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.4rem 0.6rem",
  border: "1px solid #e5e5e5",
  borderRadius: "0.5rem",
  fontSize: "0.85rem",
} as const;

// The generated-attachment section of the PLAN card (CKPT-02). Reads the reactive plan row for
// filenames + the tenant-guarded signed URLs (attachmentUrls — the URL is a bearer capability,
// §4). Regenerate/Remove re-enter the agent tool-loop via sendCockpitMessage: a button is a
// precise intent, so it sends a natural-language instruction the live agent maps to the
// removeAttachment/regenerateAttachment tools. The offline E2E (Plan 06) drives the same tools
// deterministically via the composer's `SMOKE::agent::removeAttachment=<i>` / `regenerate=<i>:<topic>`
// sentinels (Plan 04). ponytail: no per-button SMOKE flag — offline determinism is composer-driven.
function PlanAttachments({ plan, threadId }: { plan: Plan; threadId?: string }) {
  const urls = useQuery(api.plans.attachmentUrls, { planId: plan._id });
  const send = useAction(api.cockpit.sendCockpitMessage);
  const [busy, setBusy] = useState(false);
  const [topics, setTopics] = useState<Record<number, string>>({});
  const attachments = plan.attachments ?? [];

  async function drive(text: string) {
    if (busy || !threadId) return;
    setBusy(true);
    try {
      await send({ threadId, text });
    } finally {
      setBusy(false);
    }
  }

  if (plan.attachmentError) {
    return (
      <div style={{ margin: "0.5rem 0" }}>
        <div style={label}>ATTACHMENT</div>
        <p role="alert" style={{ color: "#dc2626", margin: "0.3rem 0 0" }}>
          Couldn't generate the document: {plan.attachmentError}. Fix it in chat before approving —
          the plan stays unapprovable until the attachment is regenerated.
        </p>
      </div>
    );
  }
  if (attachments.length === 0) return null;

  return (
    <div style={{ margin: "0.5rem 0" }}>
      <div style={label}>ATTACHMENTS</div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", display: "grid", gap: "0.4rem" }}>
        {attachments.map((a, i) => {
          const url = urls?.[i]?.url ?? null; // urls loads async + may be null (getUrl); guard both
          return (
            <li key={a.storageId} style={attRow}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: "var(--teal-600)" }}>
                  {a.filename}
                </a>
              ) : (
                <span style={{ fontWeight: 600 }}>{a.filename}</span>
              )}
              <span style={dim}>{fmtSize(a.size)}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: "0.3rem", alignItems: "center" }}>
                <input
                  value={topics[i] ?? ""}
                  onChange={(e) => setTopics((p) => ({ ...p, [i]: e.target.value }))}
                  placeholder="new topic…"
                  aria-label={`Regenerate ${a.filename} topic`}
                  style={{ fontSize: "0.8rem", padding: "0.15rem 0.4rem", border: "1px solid #e5e5e5", borderRadius: "0.3rem" }}
                />
                <button
                  type="button"
                  disabled={busy || !(topics[i] ?? "").trim()}
                  onClick={() => void drive(`Please regenerate the "${a.filename}" attachment about: ${(topics[i] ?? "").trim()}.`)}
                  style={{ ...btn, padding: "0.2rem 0.6rem", fontSize: "0.8rem", border: "1px solid #e5e5e5", background: "#fff" }}
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void drive(`Please remove the "${a.filename}" attachment.`)}
                  aria-label={`Remove ${a.filename}`}
                  style={{ ...btn, padding: "0.2rem 0.5rem", fontSize: "0.8rem", border: "1px solid #e5e5e5", background: "#fff" }}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The per-recipient body section of the PLAN card (CKPT-03). Personalization is the INVERSE of the
// attachment fan-out: each recipient can carry a DISTINCT tailored body (recipientBodies[address])
// while sharing the subject. Read-only (slice 1 — tailoring happens in chat via the agent's
// personalizeRecipient tool, like DraftCard has no inline editor). When NO recipient has an
// override the shared PREVIEW already covers the same-content case, so this renders nothing; when
// any override exists, show each recipient's tailored/shared body so the user sees them BEFORE the
// single Approve (SC1). ponytail: reuses the existing label/dim/chip/box tokens — no new component.
function PlanRecipientBodies({ plan }: { plan: Plan }) {
  const recipients = plan.recipients ?? [];
  const overrides = plan.recipientBodies ?? {};
  const sharedBody = plan.body ?? "";
  // Only surface the breakdown when at least one recipient is actually tailored.
  if (recipients.length === 0 || Object.keys(overrides).length === 0) return null;

  return (
    <div style={{ margin: "0.5rem 0" }}>
      <div style={label}>PER-RECIPIENT BODY</div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", display: "grid", gap: "0.5rem" }}>
        {recipients.map((r) => {
          const tailored = overrides[r]; // exact-string lookup — same key executePlan seeds with
          const bodyText = tailored ?? sharedBody;
          return (
            <li key={r} style={{ border: "1px solid #e5e5e5", borderRadius: "0.5rem", padding: "0.5rem 0.6rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.3rem" }}>
                <span style={chip}>{r}</span>
                <span style={{ ...dim, fontWeight: 700 }}>{tailored ? "tailored" : "shared body"}</span>
              </div>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, color: "#444", fontSize: "0.85rem" }}>
                {bodyText.slice(0, 240)}
                {bodyText.length > 240 ? "…" : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlanCard({ plan, threadId }: { plan: Plan; threadId?: string }) {
  const execute = useMutation(api.cockpit.executePlan);
  const setSendTime = useMutation(api.plans.setPlanSendTime);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recipients = plan.recipients ?? [];
  const mode = plan.mode ?? "individual";
  const body = plan.body ?? "";
  const sendAt = plan.sendAt;

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
      <PlanRecipientBodies plan={plan} />
      <PlanAttachments plan={plan} threadId={threadId} />
      <ol style={{ margin: "0 0 0.75rem", paddingLeft: "1.25rem", color: "#444" }}>
        <li>Draft the email</li>
        <li>
          Send to {recipients.length} recipient{recipients.length === 1 ? "" : "s"} ({mode})
        </li>
      </ol>
      <div style={{ margin: "0 0 0.75rem" }}>
        <div style={label}>SEND TIME</div>
        <input
          type="datetime-local"
          value={sendAt ? toLocalInputValue(sendAt) : ""}
          min={toLocalInputValue(Date.now())}
          max={toLocalInputValue(Date.now() + SEND_TIME_HORIZON_MS)}
          onChange={(e) =>
            void setSendTime({ planId: plan._id, sendAt: e.target.value ? new Date(e.target.value).getTime() : undefined })
          }
          style={{ ...btn, cursor: "auto", border: "1px solid #e5e5e5", marginTop: "0.35rem" }}
        />
        {sendAt ? (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>
            Sends {formatAbsolute(sendAt)}{" · "}
            <button
              type="button"
              onClick={() => void setSendTime({ planId: plan._id, sendAt: undefined })}
              style={{ ...btn, padding: "0.1rem 0.5rem", border: "1px solid #e5e5e5", background: "transparent", color: "var(--teal-600)" }}
            >
              Send immediately
            </button>
          </p>
        ) : (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>Sends immediately on approve.</p>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void approve()}
        style={{ ...btn, background: "var(--teal-600)", color: "#fff", border: "none", fontWeight: 600 }}
      >
        {busy ? "Approving…" : sendAt ? "Approve & schedule" : "Approve"}
      </button>
      {note && (
        <p role="alert" style={{ color: "#dc2626", margin: "0.5rem 0 0" }}>
          {note}
        </p>
      )}
    </div>
  );
}

/** A plan that has been approved with a future send time (SC2/SC4): shows the absolute moment and a
 * Cancel that halts it until it fires. The busy flag makes a double-click a client-side no-op (the
 * server CAS on status==="scheduled" makes a double-cancel idempotent). */
function ScheduledCard({ plan }: { plan: Plan }) {
  const cancel = useMutation(api.cockpit.cancelScheduledPlan);
  const [busy, setBusy] = useState(false);

  async function doCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await cancel({ planId: plan._id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={label}>SCHEDULED</div>
      <p style={{ margin: "0.5rem 0", color: "#444" }}>
        Scheduled for <strong>{plan.sendAt ? formatAbsolute(plan.sendAt) : "—"}</strong>. Nothing sends before then.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void doCancel()}
        style={{ ...btn, border: "1px solid #dc2626", background: "transparent", color: "#dc2626", fontWeight: 600 }}
      >
        {busy ? "Canceling…" : "Cancel"}
      </button>
    </div>
  );
}

/** A scheduled send that was halted before fire — terminal UNLESS re-scheduled (SCHD-01). Setting a
 * future time and clicking Reschedule re-approves the plan (canceled→proposed→scheduled) through the
 * existing executePlan branch; the card then re-renders as ScheduledCard (Cancel available again). A
 * past/absent time surfaces an inline re-ask and does NOT send (mirrors reschedulePlan's server guard).
 * Reuses PlanCard's picker idiom + ScheduledCard's busy pattern (one source of truth: plan.sendAt). */
function CanceledCard({ plan }: { plan: Plan; threadId?: string }) {
  const reschedule = useMutation(api.cockpit.reschedulePlan);
  const execute = useMutation(api.cockpit.executePlan);
  const setSendTime = useMutation(api.plans.setPlanSendTime);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sendAt = plan.sendAt;
  const futureSet = Boolean(sendAt && sendAt > Date.now());

  async function doReschedule() {
    if (busy || !futureSet) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await reschedule({ planId: plan._id });
      if (!r.ok && r.reason === "needs_future_time") {
        setNote("Pick a future time to reschedule.");
        return;
      }
      await execute({ planId: plan._id }); // re-approve through the EXISTING scheduled branch
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={label}>CANCELED</div>
      <p style={{ ...dim, margin: "0.5rem 0 0" }}>This scheduled send was canceled. Nothing was sent.</p>
      <div style={{ margin: "0.75rem 0 0" }}>
        <div style={label}>RESCHEDULE</div>
        <input
          type="datetime-local"
          value={sendAt ? toLocalInputValue(sendAt) : ""}
          min={toLocalInputValue(Date.now())}
          max={toLocalInputValue(Date.now() + SEND_TIME_HORIZON_MS)}
          onChange={(e) =>
            void setSendTime({ planId: plan._id, sendAt: e.target.value ? new Date(e.target.value).getTime() : undefined })
          }
          style={{ ...btn, cursor: "auto", border: "1px solid #e5e5e5", marginTop: "0.35rem" }}
        />
        {futureSet ? (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>Re-sends {formatAbsolute(sendAt as number)}.</p>
        ) : (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>Pick a future time to reschedule this send.</p>
        )}
      </div>
      <button
        type="button"
        disabled={busy || !futureSet}
        onClick={() => void doReschedule()}
        style={{ ...btn, marginTop: "0.5rem", background: "var(--teal-600)", color: "#fff", border: "none", fontWeight: 600 }}
      >
        {busy ? "Rescheduling…" : "Reschedule"}
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
              {/* Delivered-with-attachment: re-download the EXACT sent bytes (immutable per storage
                  id; the signed url is a bearer capability, §4 — surfaced only from reportForPlan). */}
              {r.attachments.map((att) => (
                <span key={att.filename} style={{ ...chip, display: "inline-flex", gap: "0.3rem" }}>
                  📎
                  {att.url ? (
                    <a href={att.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-600)" }}>
                      {att.filename}
                    </a>
                  ) : (
                    att.filename
                  )}
                </span>
              ))}
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
  // Multi-select: each name maps to the SET of picked addresses (checkbox-style, not radio) — the
  // mailbox search is noisy, so let the user add every contact they actually mean. Single-match
  // sections pre-select their one chip; the "Use these contacts" click still confirms (a
  // name→address is an inference). resolveRecipients folds ALL picks (applyRecipientEdit dedupes).
  const [picked, setPicked] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const c of candidates) {
      const [only] = c.matches;
      if (c.matches.length === 1 && only) init[c.name] = [only.address];
    }
    return init;
  });

  const allPicked = candidates.every((c) => (picked[c.name]?.length ?? 0) > 0);

  async function useContacts() {
    if (busy || !allPicked) return;
    setBusy(true);
    try {
      const picks = candidates.flatMap((c) =>
        (picked[c.name] ?? []).map((address) => {
          const m = c.matches.find((x) => x.address === address);
          return { name: c.name, address, displayName: m?.displayName };
        }),
      );
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
              const sel = picked[c.name]?.includes(m.address) ?? false;
              return (
                <button
                  key={m.address}
                  type="button"
                  onClick={() =>
                    setPicked((p) => {
                      const cur = p[c.name] ?? [];
                      return {
                        ...p,
                        [c.name]: cur.includes(m.address)
                          ? cur.filter((a) => a !== m.address)
                          : [...cur, m.address],
                      };
                    })
                  }
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

// ── BRIEFING card (CKPT-04 / SC-1 + SC-4) ────────────────────────────────────────────────────
//
// The briefing row is the source of truth: the tool's loop-visible return is counts only, so
// what the user reads here NEVER passed through the tool-bearing model context (SC-2). Every
// timestamp is rendered in `briefing.tz` — the zone the server bucketed in — so the groups and
// the clock times can never disagree (display honesty; the browser's own zone is irrelevant).

// Section title + testid per bucket — the SECONDARY axis inside the fyi remainder. The order and
// the empty-skipping now come from buildBriefingView.timeSections (already [today, yesterday,
// thisWeek], empties dropped); this is only the display chrome keyed by the bucket the view emits.
const SECTION_META: Record<BriefingItem["bucket"], { title: string; testid: string }> = {
  today: { title: "TODAY", testid: "briefing-section-today" },
  yesterday: { title: "YESTERDAY", testid: "briefing-section-yesterday" },
  thisWeek: { title: "THIS WEEK", testid: "briefing-section-thisweek" },
};

/** Clock time in the briefing's zone for today/yesterday; weekday+date for the older tail. */
function fmtItemTime(ts: number, tz: string, bucket: BriefingItem["bucket"]): string {
  const opts: Intl.DateTimeFormatOptions =
    bucket === "thisWeek"
      ? { weekday: "short", month: "short", day: "numeric" }
      : { hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(ts);
}

// ponytail: the display-name strip is one line over importing an address parser — `sender` is the
// raw From header the code owns, and "Sarah Chen <sarah@x.com> — gist" reads as noise. Upgrade
// path: if the label ever needs the address too, surface it as a separate dim span.
const senderLabel = (sender: string) => sender.replace(/\s*<[^>]*>\s*$/, "").trim() || sender;

// Brand-token text styles — the legibility fix. The shared `box`/`label`/`dim` at the top of this
// file hardcode #666/#e5e5e5 and set NO background, so the old briefing was grey text on a
// transparent panel floating over the canvas's teal aura (the "words aren't clear" complaint). The
// reshaped card renders on its own OPAQUE --card sheet (briefingSheet) with --ink/--ink-soft text
// and tracked-caps --ink-soft labels — every colour a token (BRAND §8.1), never a raw hex.
const labelBrand = {
  fontSize: "0.7rem",
  color: "var(--ink-soft)",
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
} as const;
const dimBrand = { color: "var(--ink-soft)", fontSize: "0.82rem" } as const;

// ── The row grid ────────────────────────────────────────────────────────────────────────────
// The first cut rendered each row as one flex line of "time · sender · gist" — a wall of
// sentences the human verifier rejected as "crowded, hard to read". The fix is ALIGNMENT, not a
// table: BRAND §4 says content is cards on the canvas, "never dense tables-on-white". So the rows
// sit on a shared 3-column grid — sender | subject+gist | time — and the columns line up down the
// section the way a table's would, with no borders, no header row, and card-native whitespace.
//
// `minmax(0, …)` on BOTH text columns is load-bearing, NOT cosmetic: a grid child's default
// `min-width: auto` refuses to shrink below its content, so a long unbroken subject would push the
// grid wider than the card and paint outside it — the exact overflow bug fixed in the vault cards
// at 3bdea02. `minmax(0, …)` + `minWidth: 0` on the inner column is what lets ellipsis engage.
const ROW_GRID = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 9rem) minmax(0, 1fr) max-content",
  gap: "0.75rem",
  alignItems: "baseline",
  padding: "0.5rem 0", // the crowding was the complaint — let the rows breathe
} as const;

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** The subject is the row's heading. Gmail permits an empty one — say so rather than render a gap. */
function SubjectLine({ subject }: { subject: string }) {
  return subject ? (
    <div style={{ fontWeight: 600, color: "var(--ink)", ...ellipsis }} title={subject}>
      {subject}
    </div>
  ) : (
    <div style={{ ...dimBrand, fontStyle: "italic" }}>(no subject)</div>
  );
}

// `gist` and `deadline` are the two MODEL-authored strings in the row, and the model summarizes
// untrusted third-party mail — so their content is, in the limit, attacker-influenced. They wrap
// rather than ellipsis (a gist must be readable in full), which means an unbroken token has nothing
// to break on and escapes the column: measured, a 200-char run left the box at `clientWidth: 153`
// but `scrollWidth: 1964`, dragging the document scrollbar to 2137px on a 420px pane. `minWidth: 0`
// does NOT fix this — it sizes the BOX, and the box was already right; the TEXT was overflowing it.
// `overflow-wrap: anywhere` is the fix (it also feeds min-content sizing, which `break-word` does
// not). The sender/subject don't need it: `overflow: hidden` + ellipsis clips them already.
const wrapAnywhere = { overflowWrap: "anywhere" } as const;

// The category the model computes (action/fyi/newsletter/other) — finally SHOWN, not discarded
// (Gap 1.4). A muted TEXT tag, never a control (SC-4): --ink-soft on a --rule hairline, no amber
// (--held is the approval gate's alone, BRAND §2). Reuses the label/dim token idiom (no new colour).
const categoryTag = {
  flex: "none",
  fontSize: "0.65rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  color: "var(--ink-soft)",
  border: "1px solid var(--rule)",
  borderRadius: "0.35rem",
  padding: "0 0.3rem",
} as const;

/** The gist + any deadline suggestion — the flexible middle column's body. */
function RowBody({ item }: { item: BriefingItem }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SubjectLine subject={item.subject} />
        </div>
        <span data-testid="briefing-category" style={categoryTag}>
          {item.category}
        </span>
      </div>
      <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem", lineHeight: 1.5, marginTop: "0.15rem", ...wrapAnywhere }}>
        {item.gist}
      </div>
      {/* Emphasis via weight, not amber: --held is spent on the approval gate alone (BRAND §2). */}
      {item.deadline && (
        <div style={{ color: "var(--ink)", fontWeight: 700, fontSize: "0.85rem", marginTop: "0.15rem", ...wrapAnywhere }}>
          Due: {item.deadline}
        </div>
      )}
    </div>
  );
}

/** Sender cell: the unread dot (marked AND labelled — never colour alone, BRAND §6) + the name. */
function SenderCell({ item }: { item: BriefingItem }) {
  return (
    <div style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", minWidth: 0 }}>
      {item.isUnread ? (
        <span
          role="img"
          title="Unread"
          aria-label="Unread"
          style={{ width: "0.45rem", height: "0.45rem", borderRadius: "50%", background: "var(--teal-600)", flex: "none" }}
        />
      ) : (
        <span aria-hidden="true" style={{ width: "0.45rem", flex: "none" }} />
      )}
      <span style={{ fontWeight: 600, color: "var(--ink)", ...ellipsis }} title={item.sender}>
        {senderLabel(item.sender)}
      </span>
    </div>
  );
}

/** One briefing row: WHO · WHAT (subject over gist) · WHEN. Text only — see BriefingCard's SC-4 note. */
function BriefingRow({ item, tz, first }: { item: BriefingItem; tz: string; first?: boolean }) {
  return (
    <li
      data-testid="briefing-item"
      style={{ ...ROW_GRID, ...(first ? {} : { borderTop: "1px solid var(--rule)" }) }}
    >
      <SenderCell item={item} />
      <RowBody item={item} />
      <span style={{ ...dimBrand, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtItemTime(item.ts, tz, item.bucket)}</span>
    </li>
  );
}

/** A titled group of rows on the shared column grid. NO `gap` — the hairline border-top on every
 *  row after the first IS the separator, and a gap would float the rules off the rows they divide. */
function BriefingSection({ title, items, tz }: { title: string; items: readonly BriefingItem[]; tz: string }) {
  return (
    <>
      <div style={labelBrand}>{title}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0.2rem 0 0", display: "grid" }}>
        {items.map((item, i) => (
          // The Gmail message id — the row's real identity. `${ts}-${sender}` was NOT unique: an
          // automated sender ("Google <no-reply@…>") batching two messages shares both parts and
          // collided, which React reported as a duplicate-key error. Do not key on ts/sender/index.
          <BriefingRow key={item.id} item={item} tz={tz} first={i === 0} />
        ))}
      </ul>
    </>
  );
}

// ── Direction A — the executive report shell (the Gap-2 reshape) ──────────────────────────────
// The briefing renders as a standing brief, not a lede-then-rows receipt: a teal-900 masthead band
// carrying the scope + the three code-owned counts as KPIs, then the lede, a NEEDS-YOU hero block
// (each row with its recommended next move), the time-grouped ledger, and a footer. Two rules the
// shape must never break: (1) SC-4 — no button/link/onClick anywhere, so a briefing can only re-enter
// chat → PLAN → Approve; (2) BRAND §2 — no amber: --held is the approval gate's ALONE, so priority is
// a teal-900 stripe + WEIGHT, never an amber pill.

// The OPAQUE sheet — the other half of the legibility fix. `box` (a bare border, transparent) let the
// canvas aura bleed through; this is a real --card surface with a soft shadow so text reads on any bg.
const briefingSheet = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "0.9rem",
  overflow: "hidden",
  boxShadow: "0 18px 42px -30px rgb(14 20 25 / 45%), 0 2px 6px -3px rgb(14 20 25 / 12%)",
} as const;

/** One masthead KPI: a code-owned count over an uppercase caps label (BRAND §5 stat tile). White on
 *  the teal band — high contrast by construction; the "need you" count lifts to --teal-400 so the eye
 *  lands on it first. All three counts are code-owned (listedCount / needs-you / collapsed), never the
 *  model's — the same ADR-004 discipline as the lede. */
function Kpi({ value, caption, hot }: { value: number; caption: string; hot?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: hot ? "var(--teal-400)" : "#fff" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.56rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgb(255 255 255 / 70%)", marginTop: "0.28rem" }}>
        {caption}
      </div>
    </div>
  );
}

// The needs-you HERO row: a teal-900 priority stripe (frame colour, NOT the teal-600 CTA colour — a
// stripe must not read as a control, SC-4), sender, subject over gist, the recommended move (the
// chat-bridge — Direction C's idea, grafted on), and on the right the due emphasis (WEIGHT, not
// amber) over the category tag and time. Same testids as the ledger rows so the E2E holds, plus
// briefing-move. `minmax(0, …)` on the text columns is the same overflow guard the ledger grid uses.
const PRIORITY_GRID = {
  display: "grid",
  gridTemplateColumns: "3px minmax(0, 8.5rem) minmax(0, 1fr) max-content",
  gap: "0.75rem",
  padding: "0.65rem 0",
  alignItems: "start",
} as const;

function PriorityRow({ item, tz, first }: { item: BriefingItem & { move: string }; tz: string; first?: boolean }) {
  return (
    <li data-testid="briefing-item" style={{ ...PRIORITY_GRID, ...(first ? {} : { borderTop: "1px solid var(--rule)" }) }}>
      <span aria-hidden="true" style={{ width: "3px", borderRadius: "2px", background: "var(--teal-900)", alignSelf: "stretch" }} />
      <SenderCell item={item} />
      <div style={{ minWidth: 0 }}>
        <SubjectLine subject={item.subject} />
        <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem", lineHeight: 1.5, marginTop: "0.15rem", ...wrapAnywhere }}>{item.gist}</div>
        {/* The recommended next move — the bridge back to the gated action. "Recommended" is card
            chrome (teal-900, legible on white); the sentence is the code-derived suggestedMove. Text
            only, never a control. */}
        <div data-testid="briefing-move" style={{ fontSize: "0.8rem", lineHeight: 1.4, marginTop: "0.3rem", color: "var(--ink-soft)", ...wrapAnywhere }}>
          <span style={{ fontWeight: 800, color: "var(--teal-900)", letterSpacing: "0.01em" }}>Recommended</span> {item.move}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem", textAlign: "right", whiteSpace: "nowrap" }}>
        {/* Emphasis via WEIGHT, not amber (BRAND §2 — --held is the approval gate's alone). */}
        {item.deadline && <span style={{ fontWeight: 800, fontSize: "0.78rem", color: "var(--ink)" }}>Due: {item.deadline}</span>}
        <span data-testid="briefing-category" style={categoryTag}>{item.category}</span>
        <span style={{ ...dimBrand, fontVariantNumeric: "tabular-nums" }}>{fmtItemTime(item.ts, tz, item.bucket)}</span>
      </div>
    </li>
  );
}

function BriefingCard({ briefing, demoted }: { briefing: Briefing; demoted?: boolean }) {
  // Composition-active (UAT-C, 03.10-04): a demoted brief mounts COLLAPSED to its masthead so the
  // work (picker/plan) owns the pane; a masthead toggle re-expands it. Local per-session UI ONLY —
  // no plan field/mutation/query (ADR-004 dumb renderer). A fresh mount per slot, so useState(demoted)
  // is correct at mount with no effect.
  const [collapsed, setCollapsed] = useState(demoted ?? false);
  const { tz, items, listedCount } = briefing;
  // The intelligent report — lede, action-first needs-you (each with its recommended move), the
  // time-grouped fyi remainder, and the collapsed-noise count — comes ENTIRELY from the pure view
  // model. The card does not re-derive ordering, collapse, the lede, or the move (ADR-004 / cockpit.md).
  const view = buildBriefingView(briefing);
  const createdLabel = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(briefing.createdAt);
  const scope = `${briefing.range} · ${tz} · built ${createdLabel}`;

  return (
    <div data-testid="briefing-card" style={briefingSheet}>
      {/* MASTHEAD — the teal-900 frame band. White-on-teal is the legibility fix's other half, and the
          three code-owned counts give the at-a-glance executive read the old lede-then-rows lacked. */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--teal-900), #0a6a60)",
          color: "#fff",
          padding: "0.95rem 1.15rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.9rem 1.2rem",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--teal-400)" }}>Inbox Briefing</div>
          <div style={{ color: "rgb(255 255 255 / 72%)", fontSize: "0.8rem", marginTop: "0.28rem", ...wrapAnywhere }}>{scope}</div>
        </div>
        <div style={{ display: "flex", gap: "1.35rem", flex: "none", alignItems: "center" }}>
          <Kpi value={listedCount} caption="Messages" />
          <Kpi value={view.needsYou.length} caption="Need you" hot />
          <Kpi value={view.collapsedCount} caption="Automated" />
          {/* VIEW CHROME (SC-4 exception, 03.10-04): a collapse toggle on the MASTHEAD, outside the
              briefing-body content region. It acts on the view, never on email content — so the SC-4
              "zero actionable controls" invariant holds where it matters (the content). aria-expanded
              + aria-label carry the state (BRAND §6 — never colour/glyph alone). */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand briefing" : "Collapse briefing"}
            style={{
              alignSelf: "center",
              background: "transparent",
              border: "1px solid rgb(255 255 255 / 35%)",
              borderRadius: "0.375rem",
              color: "#fff",
              cursor: "pointer",
              padding: "0.3rem 0.55rem",
              fontSize: "0.8rem",
              lineHeight: 1,
            }}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        </div>
      </div>

      {!collapsed && (
      <div data-testid="briefing-body" style={{ padding: "1.05rem 1.15rem 1.2rem" }}>
        {/* LEDE first (Gap 1.1) — the executive summary line. MUST stay the first briefing-lede/-item
            element in the card (the E2E asserts lede-first); the masthead above carries no such testid. */}
        <p data-testid="briefing-lede" style={{ color: "var(--ink)", fontWeight: 500, fontSize: "1rem", lineHeight: 1.45, margin: "0 0 1rem" }}>
          {view.lede}
        </p>

        {/* SC-4: suggestions ONLY. No button, link, or onClick anywhere below — the move line, the
            category tags, and the collapsed count are TEXT. Acting on a briefing re-enters chat →
            PLAN → Approve, so nothing a third-party email says can become a one-click action. */}
        {view.needsYou.length > 0 && (
          <div data-testid="briefing-needs-you" style={{ marginBottom: "1.15rem" }}>
            <div style={{ ...labelBrand, color: "var(--teal-900)" }}>Needs you</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0.35rem 0 0", display: "grid" }}>
              {view.needsYou.map((item, i) => (
                <PriorityRow key={item.id} item={item} tz={tz} first={i === 0} />
              ))}
            </ul>
            <p style={{ ...dimBrand, margin: "0.55rem 0 0" }}>Suggestions only — ask in chat to act on any of these.</p>
          </div>
        )}

        {/* TIME-GROUPED LEDGER (the SECONDARY axis) — reuses the quiet BriefingSection/Row. Order +
            empty-skipping are the view model's; this only maps a bucket to its chrome. */}
        {view.timeSections.map(({ bucket, items: rows }) => {
          const meta = SECTION_META[bucket];
          return (
            <div key={bucket} data-testid={meta.testid} style={{ marginBottom: "1.1rem" }}>
              <BriefingSection title={meta.title} items={rows} tz={tz} />
            </div>
          );
        })}

        {/* FOOTER: the collapsed-noise count (Gap 1.3 — its own testid, the E2E asserts it) + cap
            honesty. One muted line, never N rows; text, not a clickable disclosure (SC-4). */}
        <div style={{ marginTop: "0.5rem", paddingTop: "0.8rem", borderTop: "1px dashed var(--rule)", display: "flex", flexWrap: "wrap", gap: "0.35rem 1rem", justifyContent: "space-between" }}>
          {view.collapsedCount > 0 ? (
            <p data-testid="briefing-collapsed" style={{ ...dimBrand, margin: 0 }}>
              {view.collapsedCount} automated notification{view.collapsedCount === 1 ? "" : "s"}
            </p>
          ) : (
            <span />
          )}
          {/* Cap honesty: the digest reads the newest BRIEFING_BODY_CAP bodies, never the long tail. */}
          {listedCount > items.length && (
            <p style={{ ...dimBrand, margin: 0 }}>
              Summarized {items.length} of {listedCount}
            </p>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ---------- LATEST TRACE (CKPT-05) ----------

// THE display verb map — the ONLY place in this feature where a human-readable string exists,
// and it is CODE-OWNED. Keyed off the CLOSED `tool` union from schema.ts: never model output,
// never tool output, never mail content. This is why the step row deliberately has no text field
// (§4 enforced by schema absence, 03.9-01) — there is nowhere for a subject line to hide.
// An unknown key falls back to "Working…", so a tool added later can never crash the card.
const VERB: Record<string, [running: string, done: string]> = {
  thinking: ["Thinking…", "Thought it through"],
  resolveContacts: ["Looking up a contact…", "Looked up a contact"],
  addRecipients: ["Adding recipients…", "Added recipients"],
  setRecipients: ["Setting the recipients…", "Set the recipients"],
  removeRecipient: ["Removing a recipient…", "Removed a recipient"],
  setSubject: ["Writing the subject line…", "Wrote the subject line"],
  setMode: ["Choosing how to send…", "Chose how to send"],
  setSendTime: ["Setting the send time…", "Set the send time"],
  draftBody: ["Drafting the email…", "Drafted the email"],
  proposePlan: ["Putting the plan together…", "Plan ready"],
  generateAttachment: ["Generating the document…", "Generated the document"],
  regenerateAttachment: ["Regenerating the document…", "Regenerated the document"],
  removeAttachment: ["Removing the attachment…", "Removed the attachment"],
  personalizeRecipient: ["Tailoring a message…", "Tailored a message"],
  listInbox: ["Checking your inbox…", "Checked your inbox"],
  briefInbox: ["Reading and summarizing your inbox…", "Briefed your inbox"],
};
const FALLBACK: [string, string] = ["Working…", "Done"];

/**
 * A turn is bounded at 45s per model call (llm.ts CALL_TIMEOUT_MS), so a `running` row this old
 * outlived any live turn: the action was hard-killed (deploy/OOM) and nothing server-side will
 * ever terminalize it (research Pitfall 2's one uncoverable death mode). This is the WHOLE
 * mitigation — computed from Date.now() at render, no ticker, no scheduler, no watchdog. A page
 * refresh already fixes the row; a backend cleanup would be a new failure mode to fix UI state.
 */
const STALE_MS = 90_000;

/**
 * The one place a step becomes words — shared with ChatPane's in-progress bubble so the canvas
 * and the chat can never word the same row differently (ponytail: one map, one place).
 */
export function stepText(step: StepView, now: number = Date.now()): string {
  const [running, done] = VERB[step.tool] ?? FALLBACK;
  if (step.phase === "done") return done;
  // An ERROR shows the ATTEMPT, never the done verb — "Drafted the email" on a step that failed
  // would be a lie (BRAND §5 honest zeros). No amber, no colour: the meaning is in the text (§6).
  const attempt = running.replace(/…$/, "");
  if (step.phase === "error") return `${attempt} — couldn't complete this step`;
  if (now - step.startedAt > STALE_MS) return `${attempt} — this step may have stalled; try sending again`;
  return running;
}

// Mirrors page.tsx:39 — the BRAND §3 tracked-caps section label. Mirrored rather than imported
// because page.tsx imports THIS file (importing back would be a cycle).
const capsTeal = {
  margin: 0,
  fontSize: "0.68rem",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--teal-600)",
};
// A grid/flex child needs minWidth:0 before it will shrink, and minWidth:0 sizes the BOX, not the
// TEXT — a long word still needs overflow-wrap to break (vault cards 3bdea02, briefing card
// 44e95c0). The workspace divider is user-resizable, so the trace must survive a narrow pane.
export const traceText = { minWidth: 0, overflowWrap: "anywhere" as const };

/**
 * BRAND §3 names `LATEST TRACE` as a tracked-caps label example; §4 says content is CARDS on the
 * canvas (not chrome bolted onto the pane header). Rows reuse `.trace-line` (globals.css:1119) —
 * it is already exactly this look, mono/0.75rem/--ink-soft with a teal ring dot. No new CSS, and
 * deliberately NO animation: the rows arriving one by one IS the motion, and that is the point of
 * the phase (also why there is nothing to register in the reduced-motion block).
 */
function ActivityCard({ steps }: { steps: StepView[] }) {
  const now = Date.now();
  return (
    <div style={box} data-testid="activity-card">
      <p style={capsTeal}>Latest trace</p>
      {/* Progress a screen reader can HEAR — a silent progress surface would reproduce the
          original "is it stuck?" complaint for non-sighted users (BRAND §6). */}
      <div aria-live="polite" style={{ display: "grid", gap: "0.4rem", marginTop: "0.7rem" }}>
        {/* Honest zeros (BRAND §5): only steps that actually happened — no predicted "up next". */}
        {steps.map((s) => (
          <div key={s.stepKey} className="trace-line">
            <span style={traceText}>{stepText(s, now)}</span>
            {s.phase === "done" && s.durationMs !== undefined && (
              // Measured server-side by the SDK and already in the row — never a setInterval.
              <span style={{ flex: "none", opacity: 0.7 }}>· {(s.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reads the thread's plan + briefing rows and dispatches BRIEFING / PLAN / DRAFT / REPORT cards. */
export function CardList({ threadId, sending }: { threadId?: string; sending: boolean }) {
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");
  // INDEPENDENT of the plan (research Pitfall 6): "what happened in my inbox?" is typically a
  // thread's FIRST message, so the briefing must render with no plan row at all. Anything gated
  // behind plan status would simply never appear for the most common briefing flow.
  const briefing = useQuery(api.briefings.byThread, threadId ? { threadId } : "skip");
  // The THIRD independent query, on the same footing as the other two — and it takes NO ARGS on
  // purpose. On the first message there is no threadId until sendCockpitMessage RESOLVES, i.e.
  // until the wait is already over, so a byThread-keyed read is "skip" for the ENTIRE first turn:
  // blank at exactly the moment a first-time user decides the product is broken (Pitfall 1).
  const activity = useQuery(api.agentSteps.latestTurn);
  // FIX 4: with a threadId, match on it; WITHOUT one, show the latest turn ONLY while a first turn
  // is in flight (`sending`, lifted from ChatPane) — an idle/fresh chat must not leak the previous
  // thread's trace. `sending` stays true across the whole first turn, so the first-turn trap (no
  // threadId until sendCockpitMessage resolves) is still covered. Both surfaces share this gate.
  const showActivity = activity && (threadId !== undefined ? activity.threadId === threadId : sending);
  const trace = showActivity ? <ActivityCard steps={activity.steps} /> : null;
  const running = Boolean(showActivity && activity.steps.some((s) => s.phase === "running"));

  // The trace renders ABOVE every early return below — never under a plan-status branch, and
  // never gated on `activity === undefined` (that would flash "Loading…" on every render).
  // 03.7-04's lesson, verbatim from STATE.md: "a status-'collecting' row made the OLD dispatch
  // render literally nothing" — and `collecting` is where MOST of the waiting happens.
  const rest = () => {
    // Keep the idle copy for the genuinely-idle case; just don't let it swallow a live trace.
    if (!threadId) return running ? null : <p style={muted}>No artifacts yet.</p>;
    if (plan === undefined || briefing === undefined) return <p style={muted}>Loading…</p>;

    if (plan === null)
      return briefing ? <BriefingCard briefing={briefing} /> : running ? null : <p style={muted}>No plan yet — answer the questions to build one.</p>;
    return <PlanCards plan={plan} threadId={threadId} briefing={briefing} />;
  };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {trace}
      {rest()}
    </div>
  );
}

/** The existing plan-status dispatch, unchanged — lifted out so CardList can render the trace above it. */
function PlanCards({ plan, threadId, briefing }: { plan: Plan; threadId: string; briefing: Briefing | null }) {
  const reporting = plan.status === "delivering" || plan.status === "done";
  // A scheduled/canceled plan is dominated by its own card (Open Question 3) — suppress the DraftCard.
  const halted = plan.status === "scheduled" || plan.status === "canceled";
  const hasDraft = (Boolean(plan.body) || Boolean(plan.subject)) && !halted;
  // Resolution happens BEFORE the PLAN — render the pick card whenever the cockpit has parked
  // candidates. UAT-C (03.10-04): the old `status !== "proposed"` clause is DROPPED so the picker
  // SURVIVES a plan that got proposed with a pick still open (the propose-while-pending deadlock);
  // the backend guard makes that state unreachable, this is defense-in-depth for any reader.
  const resolving = Boolean(plan.candidates?.length) && !reporting;
  // Composition-active (UAT-A, 2026-07-19): the moment candidates park (or subject/body/recipients
  // are set, or the plan moves past collecting) the WORK is the story — a tall BriefingCard pinned
  // first buried the ResolutionCard and the pick stalled ("where is the list"). Demote the brief
  // BELOW the plan cards (collapsed to its masthead, UAT-C), never destroy it; the briefing-only
  // flow keeps it primary.
  const composing =
    Boolean(plan.candidates?.length || plan.subject || plan.body || plan.recipients?.length) ||
    plan.status !== "collecting";

  return (
    // ponytail: `data-plan-id` is a render-only E2E hook (NOT a plan field/mutation/query) so the
    // proposed+parked regression can force the deadlock ROW the backend guard now prevents live.
    <div data-plan-id={plan._id} style={{ display: "grid", gap: "1rem" }}>
      {!composing && briefing && <BriefingCard briefing={briefing} />}
      {resolving && <ResolutionCard plan={plan} threadId={threadId} />}
      {/* UAT-C: never the unpickable "#1 (no name)" placeholder while a pick is parked — exactly
          one card (the picker) renders in that deadlock state. */}
      {plan.status === "proposed" && !plan.candidates?.length && <PlanCard plan={plan} threadId={threadId} />}
      {plan.status === "scheduled" && <ScheduledCard plan={plan} />}
      {plan.status === "canceled" && <CanceledCard plan={plan} threadId={threadId} />}
      {hasDraft && <DraftCard plan={plan} />}
      {reporting && <ReportCard planId={plan._id} />}
      {/* demoted: collapsed to its masthead below the work — still rendered + reachable, never destroyed */}
      {composing && briefing && <BriefingCard briefing={briefing} demoted />}
    </div>
  );
}
