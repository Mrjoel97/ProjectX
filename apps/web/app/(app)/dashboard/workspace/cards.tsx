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
// Same derivation for the briefing row (CKPT-04). The card renders the row and NOTHING else:
// sender/ts/bucket are code-owned facts joined server-side by @pikar/core (ADR-004).
type Briefing = NonNullable<FunctionReturnType<typeof api.briefings.byThread>>;
type BriefingItem = Briefing["items"][number];

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

/** A scheduled send that was halted before fire — terminal, refs-only audited server-side. */
function CanceledCard() {
  return (
    <div style={box}>
      <div style={label}>CANCELED</div>
      <p style={{ ...dim, margin: "0.5rem 0 0" }}>This scheduled send was canceled. Nothing was sent.</p>
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

// The three buckets in reading order (server-side literals — schema.ts briefings.items.bucket).
const BUCKETS = [
  { key: "today", title: "TODAY", testid: "briefing-section-today" },
  { key: "yesterday", title: "YESTERDAY", testid: "briefing-section-yesterday" },
  { key: "thisWeek", title: "THIS WEEK", testid: "briefing-section-thisweek" },
] as const;

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

/** One briefing row: unread dot + time + sender + gist. Text only — see BriefingCard's SC-4 note. */
function BriefingRow({ item, tz }: { item: BriefingItem; tz: string }) {
  return (
    <li data-testid="briefing-item" style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
      {/* Unread is marked AND labelled — never colour alone (BRAND §6). */}
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
      <span style={{ ...dim, flex: "none", fontVariantNumeric: "tabular-nums" }}>{fmtItemTime(item.ts, tz, item.bucket)}</span>
      <span style={{ fontWeight: 600, flex: "none" }}>{senderLabel(item.sender)}</span>
      <span style={{ color: "#444" }}>{item.gist}</span>
    </li>
  );
}

function BriefingCard({ briefing }: { briefing: Briefing }) {
  const { tz, items, listedCount } = briefing;
  // "Needs you" = the digest's triage (needsReply) plus anything carrying a deadline suggestion.
  const needsYou = items.filter((i) => i.needsReply || i.deadline);
  const createdLabel = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(briefing.createdAt);

  return (
    <div data-testid="briefing-card" style={box}>
      <div style={label}>INBOX BRIEFING</div>
      <div style={{ ...dim, margin: "0.25rem 0 0.75rem" }}>
        {briefing.range} · {tz} · built {createdLabel}
        {/* Cap honesty: the digest reads the newest BRIEFING_BODY_CAP bodies, never the long tail. */}
        {listedCount > items.length ? ` · summarized ${items.length} of ${listedCount}` : ""}
      </div>

      {/* SC-4: suggestions ONLY. There is deliberately no button, link, or onClick anywhere in this
          card — acting on a briefing goes back through the conversation → PLAN → Approve gate, so
          nothing a third-party email says can become a one-click action. Keep it that way. */}
      {needsYou.length > 0 && (
        <div data-testid="briefing-needs-you" style={{ marginBottom: "0.75rem" }}>
          <div style={label}>NEEDS YOU</div>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", display: "grid", gap: "0.4rem" }}>
            {needsYou.map((item) => (
              <li key={`${item.ts}-${item.sender}`} data-testid="briefing-item" style={{ display: "grid", gap: "0.1rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{senderLabel(item.sender)}</span>
                  <span style={dim}>{fmtItemTime(item.ts, tz, item.bucket)}</span>
                </div>
                <div style={{ color: "#444" }}>{item.gist}</div>
                {/* Emphasis via weight, not amber: --held is spent on the approval gate alone (BRAND §2). */}
                {item.deadline && <div style={{ color: "var(--ink)", fontWeight: 700, fontSize: "0.85rem" }}>Due: {item.deadline}</div>}
              </li>
            ))}
          </ul>
          <p style={{ ...dim, margin: "0.5rem 0 0" }}>Suggestions only — ask in chat to act on any of these.</p>
        </div>
      )}

      {BUCKETS.map(({ key, title, testid }) => {
        const rows = items.filter((i) => i.bucket === key);
        if (rows.length === 0) return null; // skip empty groups — no fake sections (BRAND §5)
        return (
          <div key={key} data-testid={testid} style={{ marginBottom: "0.6rem" }}>
            <div style={label}>{title}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", display: "grid", gap: "0.3rem" }}>
              {rows.map((item) => (
                <BriefingRow key={`${item.ts}-${item.sender}`} item={item} tz={tz} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Reads the thread's plan + briefing rows and dispatches BRIEFING / PLAN / DRAFT / REPORT cards. */
export function CardList({ threadId }: { threadId?: string }) {
  const plan = useQuery(api.plans.byThread, threadId ? { threadId } : "skip");
  // INDEPENDENT of the plan (research Pitfall 6): "what happened in my inbox?" is typically a
  // thread's FIRST message, so the briefing must render with no plan row at all. Anything gated
  // behind plan status would simply never appear for the most common briefing flow.
  const briefing = useQuery(api.briefings.byThread, threadId ? { threadId } : "skip");

  if (!threadId) return <p style={muted}>No artifacts yet.</p>;
  if (plan === undefined || briefing === undefined) return <p style={muted}>Loading…</p>;

  const brief = briefing ? <BriefingCard briefing={briefing} /> : null;
  if (plan === null)
    return brief ? (
      <div style={{ display: "grid", gap: "1rem" }}>{brief}</div>
    ) : (
      <p style={muted}>No plan yet — answer the questions to build one.</p>
    );

  const reporting = plan.status === "delivering" || plan.status === "done";
  // A scheduled/canceled plan is dominated by its own card (Open Question 3) — suppress the DraftCard.
  const halted = plan.status === "scheduled" || plan.status === "canceled";
  const hasDraft = (Boolean(plan.body) || Boolean(plan.subject)) && !halted;
  // Resolution happens during "collecting", BEFORE the PLAN — render the pick card whenever the
  // cockpit has parked candidates and the plan hasn't been proposed/delivered yet.
  const resolving = Boolean(plan.candidates?.length) && plan.status !== "proposed" && !reporting;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {brief}
      {resolving && <ResolutionCard plan={plan} threadId={threadId} />}
      {plan.status === "proposed" && <PlanCard plan={plan} threadId={threadId} />}
      {plan.status === "scheduled" && <ScheduledCard plan={plan} />}
      {plan.status === "canceled" && <CanceledCard />}
      {hasDraft && <DraftCard plan={plan} />}
      {reporting && <ReportCard planId={plan._id} />}
    </div>
  );
}
