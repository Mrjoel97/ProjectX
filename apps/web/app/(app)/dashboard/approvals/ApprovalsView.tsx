"use client";

import { api } from "@pikar/backend/api";
import { SEND_TIME_HORIZON_MS } from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import React, {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useMemo,
  useState,
} from "react";

type AwaitingPage = FunctionReturnType<typeof api.approvals.listAwaiting>;
type AwaitingItem = AwaitingPage["items"][number];
type ScheduledPage = FunctionReturnType<typeof api.approvals.listScheduled>;
type ScheduledItem = ScheduledPage["items"][number];
type InFlightPage = FunctionReturnType<typeof api.approvals.listInFlight>;
type InFlightItem = InFlightPage["items"][number];
type ClearedPage = FunctionReturnType<typeof api.approvals.listCleared>;
type DecisionPage = FunctionReturnType<typeof api.approvals.listDecisions>;
type DecisionItem = DecisionPage["items"][number];
type Plan = NonNullable<FunctionReturnType<typeof api.plans.byThread>>;
type PlanKind = AwaitingItem["kind"];

const PAGE_SIZE = 25;
const CLEARED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1rem",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 7%, transparent)",
};
const stack: CSSProperties = { display: "grid", gap: "0.75rem" };
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "0.65rem",
};
const button: CSSProperties = {
  // `font: inherit` alone lands at the 1rem body size; the mockup's .btn is a .86rem PILL.
  // minHeight stays at the 2.5rem touch target (BRAND §6) — shrinking type must not shrink the hit
  // area.
  minHeight: "2.5rem",
  borderRadius: "999px",
  padding: "0.5rem 1.1rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
};
const primary: CSSProperties = {
  ...button,
  borderColor: "var(--teal-600)",
  background: "var(--teal-600)",
  color: "var(--card)",
};
const destructive: CSSProperties = {
  ...button,
  color: "var(--danger-text)",
  borderColor: "color-mix(in srgb, var(--danger-text) 45%, var(--rule))",
};
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
/** The mockup's .gate-title — card headings, so a bare <h3> does not fall back to browser 1.17em. */
const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--ink)",
};

export function formatAbsoluteInstant(epochMs: number, requestedZone?: string): string {
  const zone = requestedZone || "UTC";
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: zone,
    }).format(epochMs)} (${zone})`;
  } catch {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: "UTC",
    }).format(epochMs)} (UTC)`;
  }
}

export function parseScheduleInput(
  value: string,
  now = Date.now(),
): { state: "invalid" | "past" | "too-far" } | { state: "ready"; epochMs: number } {
  const epochMs = new Date(value).getTime();
  if (!value || !Number.isFinite(epochMs)) return { state: "invalid" };
  if (epochMs <= now) return { state: "past" };
  if (epochMs > now + SEND_TIME_HORIZON_MS) return { state: "too-far" };
  return { state: "ready", epochMs };
}

export function refusalMessage(reason: string): string {
  const messages: Record<string, string> = {
    gmail_not_connected: "Gmail is not connected. Nothing was sent and nothing was spent.",
    send_time_too_far: "That time is outside the safe scheduling window. Nothing was sent.",
    review_escalated: "This plan cannot be approved until its review issue is resolved.",
    no_deck: "This media plan has no generation-ready deck. Nothing was generated or spent.",
    // 19-05. This page is the SECOND approve surface (the cockpit plan card is the other), so the
    // two CAN-SPAM refusals need an entry here too — the fallback below would print the raw enum.
    no_postal_address:
      "Add your postal address on your profile before sending — the law requires it in every email's footer. Nothing was sent.",
    all_recipients_suppressed:
      "Nobody on this list can be emailed: every recipient has unsubscribed. Nothing was sent.",
    daily_budget_exhausted: "This tenant’s daily budget is exhausted. Nothing was generated.",
    deployment_budget_exhausted: "The deployment budget is paused. Nothing was generated.",
    media_budget_exhausted: "The media budget is exhausted. Nothing was generated.",
  };
  return messages[reason] ?? `The governed action refused (${reason}). Nothing was sent.`;
}

/** 19-05 SC#5: a partial send comes back `ok: true` and must STILL name who was dropped and why.
 *  Appended to whichever success sentence the caller already shows — a suppressed recipient is not
 *  a second outcome, it is a footnote on the one that happened. */
export function withheldSuffix(withheld?: string[]): string {
  if (!withheld || withheld.length === 0) return "";
  return ` Withheld ${withheld.length} who unsubscribed: ${withheld.join(", ")}.`;
}

export function ApprovalKindBadge({ kind }: { kind: PlanKind }) {
  const labels: Record<PlanKind, string> = {
    email: "Email",
    reel: "Reel",
    image: "Image",
    calendar_event: "Calendar event",
    memo: "Next-step memo",
    crm_write: "CRM update",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "999px",
        padding: "0.2rem 0.55rem",
        background: "var(--canvas)",
        border: "1px solid var(--rule)",
        color: "var(--ink)",
        fontSize: "0.68rem",
        fontWeight: 700,
      }}
    >
      {labels[kind]}
    </span>
  );
}

export function ApprovalsStateNotice({
  state,
  children,
}: {
  state: "loading" | "empty" | "partial" | "error" | "refusal";
  children?: ReactNode;
}) {
  const defaults = {
    loading: "Loading approvals…",
    empty: "Nothing waiting on you.",
    partial: "More approvals exist beyond this bounded page.",
    error: "Couldn’t load approvals. Retry when the connection is ready.",
    refusal: "The governed action refused. Nothing was sent.",
  };
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        color: "var(--ink-soft)",
        background: "var(--canvas)",
      }}
    >
      {children ?? defaults[state]}
    </div>
  );
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function ageLabel(epoch: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - epoch) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.floor(hours / 24)} days`;
}

function titleFor(plan: Plan): string {
  if (plan.kind === "calendar_event") return plan.eventTitle || "Calendar plan";
  if (plan.kind === "memo") return plan.body?.split("\n")[0] || "Next-step memo";
  if (plan.kind === "crm_write") {
    const count = Array.isArray(plan.crmOperations) ? plan.crmOperations.length : 0;
    return `${count} change${count === 1 ? "" : "s"} to your records`;
  }
  if (plan.kind === "media") {
    const artDirection =
      typeof plan.artDirection === "string" ? plan.artDirection : plan.artDirection?.mood;
    return plan.imagePrompt || artDirection || "Media generation plan";
  }
  return plan.subject || "Email plan";
}

export function actionLabel(kind: PlanKind): string {
  if (kind === "memo") return "Approve & file to vault";
  if (kind === "calendar_event") return "Approve & create event";
  // 19-06 ACTN-05: every label on this surface must name what Approve DOES. "Approve & send" on a
  // CRM write would promise an email the inline arm structurally cannot produce.
  if (kind === "crm_write") return "Approve & save to records";
  if (kind === "reel" || kind === "image") return "Approve governed generation";
  return "Approve & send";
}

function PlanMeta({ item }: { item: AwaitingItem | ScheduledItem | InFlightItem }) {
  return (
    <div
      style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", ...muted, fontSize: "0.82rem" }}
    >
      <span>Staged {ageLabel(item.createdAt)} ago</span>
      <span>
        {item.recipientCount} recipient{item.recipientCount === 1 ? "" : "s"}
      </span>
      <span>
        {item.attachmentCount} attachment{item.attachmentCount === 1 ? "" : "s"}
      </span>
      <span>Cost not recorded</span>
    </div>
  );
}

function ScheduleComposer({
  onConfirm,
  busy,
  label = "Confirm schedule",
}: {
  onConfirm: (epochMs: number) => Promise<void>;
  busy: boolean;
  label?: string;
}) {
  const [value, setValue] = useState("");
  const [reviewed, setReviewed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zone = useMemo(browserTimeZone, []);

  const review = () => {
    const parsed = parseScheduleInput(value);
    if (parsed.state !== "ready") {
      setReviewed(null);
      setError(
        parsed.state === "past"
          ? "Choose a future time."
          : parsed.state === "too-far"
            ? "Choose a time inside the safe scheduling window."
            : "Enter a valid date and time.",
      );
      return;
    }
    setError(null);
    setReviewed(parsed.epochMs);
  };

  return (
    <div
      style={{
        ...stack,
        padding: "0.75rem",
        border: "1px solid var(--rule)",
        borderRadius: "0.75rem",
      }}
    >
      <label style={{ fontWeight: 700 }}>
        Local date and time
        <input
          aria-label="Local date and time"
          type="datetime-local"
          value={value}
          min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
          onChange={(event) => {
            setValue(event.target.value);
            setReviewed(null);
            setError(null);
          }}
          style={{ ...button, display: "block", width: "100%", marginTop: "0.35rem" }}
        />
      </label>
      <p style={{ ...muted, fontSize: "0.82rem" }}>Browser timezone: {zone}</p>
      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", margin: 0 }}>
          {error}
        </p>
      )}
      {reviewed === null ? (
        <button type="button" style={button} onClick={review} disabled={busy}>
          Review absolute time
        </button>
      ) : (
        <div role="group" aria-label="Confirm absolute schedule" style={stack}>
          <p style={{ margin: 0 }}>
            Confirm <strong>{formatAbsoluteInstant(reviewed, zone)}</strong>. Nothing runs before
            this instant.
          </p>
          <button
            type="button"
            style={primary}
            disabled={busy}
            onClick={() => void onConfirm(reviewed)}
          >
            {busy ? "Working…" : label}
          </button>
        </div>
      )}
    </div>
  );
}

function AwaitingCard({ item }: { item: AwaitingItem }) {
  const plan = useQuery(api.plans.byThread, { threadId: item.threadId });
  const execute = useMutation(api.cockpit.executePlan);
  const discard = useMutation(api.cockpit.discardPlan);
  const setSendTime = useMutation(api.plans.setPlanSendTime);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const attachments = useQuery(
    api.plans.attachmentUrls,
    attachmentsOpen ? { planId: item.planId } : "skip",
  );

  if (plan === undefined)
    return <ApprovalsStateNotice state="loading">Loading plan details…</ApprovalsStateNotice>;
  if (plan === null)
    return (
      <ApprovalsStateNotice state="error">
        This plan is stale or no longer available.
      </ApprovalsStateNotice>
    );

  async function approve() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await execute({ planId: item.planId });
      if (!response.ok) setResult(refusalMessage(response.reason));
      else if (response.alreadyStarted)
        setResult("This plan already started. No duplicate action was created.");
      else if (response.scheduled)
        setResult(
          `The absolute schedule is armed. Nothing runs before it fires.${withheldSuffix(response.withheld)}`,
        );
      else
        setResult(
          `Approval accepted. The governed action is now in flight.${withheldSuffix(response.withheld)}`,
        );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Approval failed. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  async function schedule(epochMs: number) {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      await setSendTime({ planId: item.planId, sendAt: epochMs });
      const response = await execute({ planId: item.planId });
      if (!response.ok) setResult(refusalMessage(response.reason));
      else if (response.alreadyStarted)
        setResult("This plan already moved. No duplicate schedule was created.");
      else
        setResult(
          `Scheduled for ${formatAbsoluteInstant(epochMs, browserTimeZone())}.${withheldSuffix(response.withheld)}`,
        );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Scheduling failed. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  async function doDiscard() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await discard({ planId: item.planId });
      setResult(
        response.discarded
          ? "Discarded. This plan cannot be re-armed."
          : "This plan already moved; no second discard was written.",
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Discard failed.");
    } finally {
      setBusy(false);
      setConfirmDiscard(false);
    }
  }

  return (
    <article
      style={{ ...card, borderLeft: "0.3rem solid var(--held-text)", ...stack }}
      data-plan-id={item.planId}
    >
      <div style={row}>
        <div style={{ ...stack, gap: "0.35rem", minWidth: 0 }}>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            <span style={{ ...caps, color: "var(--held-text)" }}>Held · awaiting release</span>
            <ApprovalKindBadge kind={item.kind} />
          </div>
          <h3 style={{ ...cardTitle, overflowWrap: "anywhere" }}>{titleFor(plan)}</h3>
          <PlanMeta item={item} />
        </div>
        <Link
          href={`/dashboard/workspace?thread=${encodeURIComponent(item.threadId)}`}
          style={{ ...button, textDecoration: "none" }}
        >
          Open in cockpit ↗
        </Link>
      </div>

      {plan.body && (
        <p style={{ ...muted, whiteSpace: "pre-wrap" }}>
          {plan.body.slice(0, 320)}
          {plan.body.length > 320 ? "…" : ""}
        </p>
      )}
      {plan.kind === "calendar_event" && (
        <p style={muted}>
          {plan.eventStartMs
            ? formatAbsoluteInstant(plan.eventStartMs, plan.eventTz || browserTimeZone())
            : "Event time is incomplete."}
          {plan.eventDurationMs ? ` · ${Math.round(plan.eventDurationMs / 60_000)} minutes` : ""}
        </p>
      )}

      {item.attachmentCount > 0 && (
        <div style={stack}>
          <button type="button" style={button} onClick={() => setAttachmentsOpen((open) => !open)}>
            {attachmentsOpen
              ? "Hide attachments"
              : `Open ${item.attachmentCount} attachment${item.attachmentCount === 1 ? "" : "s"}`}
          </button>
          {attachmentsOpen && attachments === undefined && (
            <ApprovalsStateNotice state="loading">Signing attachment links…</ApprovalsStateNotice>
          )}
          {attachmentsOpen && attachments && (
            <ul style={{ margin: 0 }}>
              {attachments.map((attachment) => (
                <li key={`${attachment.filename}:${attachment.url ?? "missing"}`}>
                  {attachment.url ? (
                    <a href={attachment.url}>{attachment.filename}</a>
                  ) : (
                    `${attachment.filename} — unavailable`
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" style={primary} disabled={busy} onClick={() => void approve()}>
          {busy ? "Working…" : actionLabel(item.kind)}
        </button>
        {item.kind === "email" && (
          <button
            type="button"
            style={button}
            disabled={busy}
            onClick={() => setScheduleOpen((open) => !open)}
          >
            Schedule…
          </button>
        )}
        <Link
          href={`/dashboard/workspace?thread=${encodeURIComponent(item.threadId)}`}
          style={{ ...button, textDecoration: "none" }}
        >
          {item.kind === "calendar_event"
            ? "Change time in cockpit"
            : item.kind === "email"
              ? "Revise in cockpit"
              : "Edit in cockpit"}
        </Link>
        <button
          type="button"
          style={destructive}
          disabled={busy}
          onClick={() => setConfirmDiscard(true)}
        >
          Discard
        </button>
      </div>

      {scheduleOpen && <ScheduleComposer busy={busy} onConfirm={schedule} />}
      {confirmDiscard && (
        <div
          role="group"
          aria-label="Confirm discard"
          style={{
            ...stack,
            padding: "0.75rem",
            border: "1px solid var(--rule)",
            borderRadius: "0.75rem",
          }}
        >
          <strong>Discard this plan permanently?</strong>
          <p style={muted}>It will not be eligible for rescheduling.</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              style={destructive}
              disabled={busy}
              onClick={() => void doDiscard()}
            >
              Yes, discard it
            </button>
            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={() => setConfirmDiscard(false)}
            >
              Keep plan
            </button>
          </div>
        </div>
      )}
      {result && (
        <ApprovalsStateNotice state={result.includes("Nothing") ? "refusal" : "partial"}>
          {result}
        </ApprovalsStateNotice>
      )}
    </article>
  );
}

function ScheduledRow({ item }: { item: ScheduledItem }) {
  const plan = useQuery(api.plans.byThread, { threadId: item.threadId });
  const cancel = useMutation(api.cockpit.cancelScheduledPlan);
  const move = useMutation(api.cockpit.moveScheduledPlan);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"idle" | "cancel" | "move">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function doCancel() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await cancel({ planId: item.planId });
      setResult(
        response.canceled
          ? "Canceled before fire. Repeating cancel cannot create another transition."
          : "The scheduler already fired or this plan already resolved; it was not reported as canceled.",
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Cancel failed.");
    } finally {
      setBusy(false);
      setMode("idle");
    }
  }

  async function doMove(epochMs: number) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await move({ planId: item.planId, sendAt: epochMs });
      setResult(
        response.result === "moved"
          ? `Schedule moved to ${formatAbsoluteInstant(epochMs, browserTimeZone())}. Replaying the same instant is idempotent.`
          : response.result === "already_fired"
            ? "The scheduler won the race. Delivery is already in flight; this was not reported as moved."
            : "This plan no longer has a live schedule.",
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Move failed.");
    } finally {
      setBusy(false);
      setMode("idle");
    }
  }

  return (
    <article style={{ ...card, ...stack }} data-plan-id={item.planId}>
      <div style={row}>
        <div>
          <h3 style={cardTitle}>
            {plan === undefined ? "Loading plan…" : plan ? titleFor(plan) : "Unavailable plan"}
          </h3>
          <PlanMeta item={item} />
        </div>
        <ApprovalKindBadge kind={item.kind} />
      </div>
      <p style={muted}>
        {item.scheduleState === "known" && item.scheduledAt
          ? `Fires ${formatAbsoluteInstant(item.scheduledAt, browserTimeZone())}`
          : "Scheduled time is unknown on this legacy row."}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" style={button} onClick={() => setMode("move")} disabled={busy}>
          Reschedule
        </button>
        <button type="button" style={destructive} onClick={() => setMode("cancel")} disabled={busy}>
          Cancel
        </button>
        <Link
          href={`/dashboard/workspace?thread=${encodeURIComponent(item.threadId)}`}
          style={{ ...button, textDecoration: "none" }}
        >
          Open thread
        </Link>
      </div>
      {mode === "move" && (
        <ScheduleComposer busy={busy} label="Confirm new schedule" onConfirm={doMove} />
      )}
      {mode === "cancel" && (
        <div
          role="group"
          aria-label="Confirm scheduled cancel"
          style={{
            ...stack,
            padding: "0.75rem",
            border: "1px solid var(--rule)",
            borderRadius: "0.75rem",
          }}
        >
          <strong>Cancel before this schedule fires?</strong>
          <p style={muted}>
            If the scheduler already won the race, the result will say In flight instead of
            canceled.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              style={destructive}
              disabled={busy}
              onClick={() => void doCancel()}
            >
              Yes, cancel it
            </button>
            <button type="button" style={button} disabled={busy} onClick={() => setMode("idle")}>
              Keep schedule
            </button>
          </div>
        </div>
      )}
      {result && <ApprovalsStateNotice state="partial">{result}</ApprovalsStateNotice>}
    </article>
  );
}

function InFlightRow({ item }: { item: InFlightItem }) {
  const plan = useQuery(api.plans.byThread, { threadId: item.threadId });
  const progress = item.progress;
  const completed = progress.state === "exact" ? progress.sent + progress.failed : null;
  return (
    <article style={{ ...card, ...stack }}>
      <div style={row}>
        <div>
          <h3 style={cardTitle}>
            {plan === undefined ? "Loading plan…" : plan ? titleFor(plan) : "Unavailable plan"}
          </h3>
          <PlanMeta item={item} />
        </div>
        <ApprovalKindBadge kind={item.kind} />
      </div>
      {progress.state === "exact" ? (
        <>
          <p style={{ margin: 0, fontWeight: 700 }}>
            Delivering · {completed} of {progress.total}
          </p>
          <progress
            value={completed ?? 0}
            max={progress.total}
            aria-label="Delivery progress"
            style={{ width: "100%" }}
          />
          <p style={muted}>
            {progress.sent} sent · {progress.failed} failed · {progress.queued} queued
          </p>
        </>
      ) : (
        <ApprovalsStateNotice state="partial">
          Delivery is in flight. Exact counters are unavailable for this legacy plan.
        </ApprovalsStateNotice>
      )}
    </article>
  );
}

function DecisionCard({ item }: { item: DecisionItem }) {
  const answer = useMutation(api.approvals.answerDecision);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    const typed = item.valueType === "boolean" ? value === "yes" : Number(value);
    if (
      item.valueType === "boolean"
        ? !["yes", "no"].includes(value)
        : !Number.isFinite(typed) || Number(typed) < 0
    ) {
      setResult("Enter a valid non-negative answer.");
      return;
    }
    setBusy(true);
    try {
      const payload =
        item.valueType === "boolean"
          ? { field: "modelCard.thirtyDayPayback" as const, value: typed as boolean }
          : {
              field: item.field as
                | "financials.cac"
                | "financials.ltgp"
                | "financials.thirtyDayCashPerCustomer",
              value: typed as number,
            };
      await answer({ threadId: item.threadId, answer: payload });
      setResult("Decision saved to the current scorecard.");
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Decision could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article style={{ ...card, ...stack }}>
      <p style={caps}>Diagnostic question</p>
      <h3 style={cardTitle}>{item.prompt}</h3>
      {item.valueType === "boolean" ? (
        <select
          aria-label={item.label}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={button}
        >
          <option value="">Choose…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : (
        <input
          aria-label={item.label}
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={button}
        />
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" style={primary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <Link
          href={`/dashboard/workspace?thread=${encodeURIComponent(item.threadId)}`}
          style={{ ...button, textDecoration: "none" }}
        >
          Open source thread
        </Link>
      </div>
      {result && <ApprovalsStateNotice state="partial">{result}</ApprovalsStateNotice>}
    </article>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`approvals-${label.replace(/\W+/g, "-").toLowerCase()}`}
      style={stack}
    >
      <div style={row}>
        <h2
          id={`approvals-${label.replace(/\W+/g, "-").toLowerCase()}`}
          style={{ ...caps, color: "var(--ink)" }}
        >
          {label}
        </h2>
        {count !== undefined && (
          <span
            aria-label={`${count} items`}
            style={{
              ...caps,
              border: "1px solid var(--rule)",
              borderRadius: "999px",
              padding: "0.2rem 0.5rem",
            }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Pager({
  nextCursor,
  cursor,
  onNext,
  onFirst,
}: {
  nextCursor: string | null;
  cursor: string | null;
  onNext: () => void;
  onFirst: () => void;
}) {
  if (!nextCursor && !cursor) return null;
  return (
    <nav aria-label="Lane pages" style={{ display: "flex", gap: "0.5rem" }}>
      {cursor && (
        <button type="button" style={button} onClick={onFirst}>
          First page
        </button>
      )}
      {nextCursor && (
        <button type="button" style={button} onClick={onNext}>
          Next page
        </button>
      )}
    </nav>
  );
}

function AwaitingSection({ total }: { total: number }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useQuery(api.approvals.listAwaiting, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
  return (
    <Section label="Awaiting you" count={total}>
      {page === undefined ? (
        <ApprovalsStateNotice state="loading" />
      ) : page.items.length === 0 ? (
        <ApprovalsStateNotice state="empty" />
      ) : (
        page.items.map((item) => <AwaitingCard key={item.planId} item={item} />)
      )}
      {page?.bound.partial && <ApprovalsStateNotice state="partial" />}
      {page && (
        <Pager
          cursor={cursor}
          nextCursor={page.nextCursor}
          onFirst={() => setCursor(null)}
          onNext={() => setCursor(page.nextCursor)}
        />
      )}
    </Section>
  );
}

function ScheduledSection() {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useQuery(api.approvals.listScheduled, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
  return (
    <Section label="Scheduled — approved, not yet fired" count={page?.items.length}>
      {page === undefined ? (
        <ApprovalsStateNotice state="loading" />
      ) : page.items.length === 0 ? (
        <ApprovalsStateNotice state="empty">
          No approved schedules are waiting to fire.
        </ApprovalsStateNotice>
      ) : (
        page.items.map((item) => <ScheduledRow key={item.planId} item={item} />)
      )}
      {page?.bound.partial && <ApprovalsStateNotice state="partial" />}
      {page && (
        <Pager
          cursor={cursor}
          nextCursor={page.nextCursor}
          onFirst={() => setCursor(null)}
          onNext={() => setCursor(page.nextCursor)}
        />
      )}
    </Section>
  );
}

function InFlightSection() {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useQuery(api.approvals.listInFlight, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
  return (
    <Section label="In flight" count={page?.items.length}>
      {page === undefined ? (
        <ApprovalsStateNotice state="loading" />
      ) : page.items.length === 0 ? (
        <ApprovalsStateNotice state="empty">
          No governed actions are in flight.
        </ApprovalsStateNotice>
      ) : (
        page.items.map((item) => <InFlightRow key={item.planId} item={item} />)
      )}
      {page?.bound.partial && <ApprovalsStateNotice state="partial" />}
      {page && (
        <Pager
          cursor={cursor}
          nextCursor={page.nextCursor}
          onFirst={() => setCursor(null)}
          onNext={() => setCursor(page.nextCursor)}
        />
      )}
    </Section>
  );
}

function DecisionsAndBlocked() {
  const decisions = useQuery(api.approvals.listDecisions, { limit: 20 });
  const blocked = useQuery(api.approvals.blockedSummary);
  return (
    <Section label="Other decisions waiting on you">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
          gap: "0.75rem",
        }}
      >
        {decisions === undefined ? (
          <ApprovalsStateNotice state="loading" />
        ) : decisions.items.length === 0 ? (
          <ApprovalsStateNotice state="empty">
            No diagnostic decisions are waiting.
          </ApprovalsStateNotice>
        ) : (
          decisions.items.map((item) => (
            <DecisionCard key={`${item.evaluationId}:${item.field}`} item={item} />
          ))
        )}
        {blocked === undefined ? (
          <ApprovalsStateNotice state="loading" />
        ) : blocked.count === 0 ? (
          <ApprovalsStateNotice state="empty">
            No blocked operations need review.
          </ApprovalsStateNotice>
        ) : (
          <article style={{ ...card, ...stack }}>
            <p style={{ ...caps, color: "var(--danger-text)" }}>Blocked</p>
            <h3 style={cardTitle}>
              {blocked.count}
              {blocked.countCapped ? "+" : ""} stopped operation{blocked.count === 1 ? "" : "s"}
            </h3>
            <p style={muted}>
              Sensitive details stay in Compliance. This page receives counts and timestamps only.
            </p>
            <Link
              href={blocked.href}
              style={{ ...button, textDecoration: "none", justifySelf: "start" }}
            >
              Review in Compliance ↗
            </Link>
          </article>
        )}
      </div>
      {decisions?.bound.partial && (
        <ApprovalsStateNotice state="partial">
          More diagnostic questions exist beyond this bounded result.
        </ApprovalsStateNotice>
      )}
    </Section>
  );
}

function ClearedSection() {
  const sinceMs = useMemo(() => Date.now() - CLEARED_WINDOW_MS, []);
  const page = useQuery(api.approvals.listCleared, { sinceMs, limit: 50 });
  return (
    <Section label="Cleared — recent window" count={page?.items.length}>
      {page === undefined ? (
        <ApprovalsStateNotice state="loading" />
      ) : page.items.length === 0 ? (
        <ApprovalsStateNotice state="empty">
          No completed or canceled plans in this window.
        </ApprovalsStateNotice>
      ) : (
        <div style={stack}>
          {page.items.map((item) => (
            <article key={item.planId} style={{ ...card, ...row }}>
              <div>
                <ApprovalKindBadge kind={item.kind} />
                <p style={{ margin: "0.45rem 0 0", fontWeight: 700 }}>
                  {item.status === "done"
                    ? "Completed"
                    : item.cancellation?.state === "known" && item.cancellation.kind === "discarded"
                      ? "Discarded"
                      : item.cancellation?.state === "known"
                        ? "Canceled before fire"
                        : "Canceled · legacy reason unknown"}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={muted}>{formatAbsoluteInstant(item.createdAt, browserTimeZone())}</p>
                <p style={muted}>Cost not recorded</p>
              </div>
            </article>
          ))}
        </div>
      )}
      {page?.bound.partial && (
        <ApprovalsStateNotice state="partial">
          Recent results hit the 50-row cap.
        </ApprovalsStateNotice>
      )}
    </Section>
  );
}

class ApprovalsErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Approvals route failed", {
      name: error.name,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ ...card, ...stack }}>
        <ApprovalsStateNotice state="error" />
        <button type="button" style={primary} onClick={() => window.location.reload()}>
          Retry
        </button>
        <Link href="/dashboard/workspace">Return to workspace</Link>
      </div>
    );
  }
}

function ConnectedApprovals() {
  const summary = useQuery(api.approvals.summary);
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div
      style={{
        display: "grid",
        gap: "2rem",
        maxWidth: "76rem",
        margin: "0 auto",
        paddingBottom: "3rem",
      }}
    >
      <header style={{ ...row, alignItems: "stretch" }}>
        <div style={{ ...stack, alignContent: "center", maxWidth: "48rem" }}>
          <p style={caps}>Governance gate · {dateLabel}</p>
          {/* The ONE display headline, at the SAME clamp as `.vault-header h1` and the mockup's
              .display. The prior `clamp(2rem, 5vw, 3.6rem)` grew nearly twice as fast per viewport
              width and topped out 1rem larger than every other dashboard page. */}
          <h1
            style={{
              margin: 0,
              color: "var(--ink)",
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            Clear the gate
          </h1>
          <p style={{ ...muted, fontSize: "0.94rem" }}>
            Everything Pikar staged and cannot do without you. Approve once; guarded execution,
            audit and honest outcome states follow.
          </p>
        </div>
        <aside style={{ ...card, minWidth: "14rem" }} aria-label="Oldest waiting">
          <p style={caps}>Oldest waiting</p>
          {/* A TEXT stat ("3 days"), so it takes the mockup's .stat-value.is-text 1.05rem, not the
              2rem numeral size — 1.65rem was reading as a second headline beside the h1. */}
          <p
            style={{
              margin: "0.45rem 0",
              fontSize: "1.05rem",
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            {summary === undefined
              ? "—"
              : summary.oldestWaitingAt === null
                ? "None"
                : ageLabel(summary.oldestWaitingAt)}
          </p>
          <p style={{ ...muted, fontSize: "0.82rem" }}>
            Plans do not expire, but their context can become stale.
          </p>
        </aside>
      </header>

      {summary === undefined ? (
        <ApprovalsStateNotice state="loading" />
      ) : (
        <>
          {summary.awaitingCountCapped && (
            <ApprovalsStateNotice state="partial">
              Awaiting count is capped at {summary.awaitingCount}+.
            </ApprovalsStateNotice>
          )}
          <AwaitingSection total={summary.awaitingCount} />
        </>
      )}
      <ScheduledSection />
      <InFlightSection />
      <DecisionsAndBlocked />
      <ClearedSection />
    </div>
  );
}

export function ApprovalsView() {
  return (
    <ApprovalsErrorBoundary>
      <ConnectedApprovals />
    </ApprovalsErrorBoundary>
  );
}
