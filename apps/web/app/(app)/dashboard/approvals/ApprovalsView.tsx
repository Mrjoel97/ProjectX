"use client";

import { api } from "@pikar/backend/api";
import { SEND_TIME_HORIZON_MS, withheldNote } from "@pikar/core";
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
type ClearedItem = FunctionReturnType<typeof api.approvals.listCleared>["items"][number];
type DecisionPage = FunctionReturnType<typeof api.approvals.listDecisions>;
type DecisionItem = DecisionPage["items"][number];
type Plan = NonNullable<FunctionReturnType<typeof api.plans.byThread>>;
type PlanKind = AwaitingItem["kind"];
type AttachmentLinks = FunctionReturnType<typeof api.plans.attachmentUrls>;

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
    daily_budget_exhausted: "Your daily budget is used up for today. Nothing was generated.",
    deployment_budget_exhausted:
      "Pikar’s shared daily budget is paused for today. Nothing was generated.",
    media_budget_exhausted: "The media budget is exhausted. Nothing was generated.",
    // 2026-08-10: `applyFinanceClaims`'s two refusals, delivered as a return instead of a throw
    // Convex would redact in production — see the function's doc comment in cash.ts.
    agent_cannot_update_figure:
      "That figure can only be updated by you for now — the agent cannot vouch for where it came from. Nothing changed.",
    malformed_figure_claim:
      "This figure update was malformed and was not applied. Nothing changed.",
  };
  // 25.2: an unmapped code is shown as words, never as the raw token.
  return (
    messages[reason] ??
    `This action was refused (${reason.replaceAll("_", " ")}). Nothing was sent.`
  );
}

/**
 * 25.1-04 (D9). `executePlan` returns `{ok: true, alreadyStarted: true}` for ANY status that is
 * not `proposed` — `discarded`, `canceled` and `done` included — because its CAS only knows that
 * it did not win the transition. The awaiting list is a reactive cache, so the click that lands
 * here is a click on a card that no longer describes reality. The old copy ("This plan already
 * started") asserted a start that may never have happened. The one thing this return CAN promise
 * is that this click created nothing.
 */
export const STALE_PLAN_MESSAGE =
  "This card was out of date — the plan it showed was already handled or replaced. Nothing new was started.";

/** How much of a plan body the held card previews. Unchanged from the shipped slice. */
export const PREVIEW_CHARS = 320;

/**
 * 25.1-05 (D11). The plan body is MARKDOWN — a specialist writes `# Findings` and `**$25**` — and
 * this card printed a raw slice of it, so the first thing a human read at the approval gate was the
 * markup rather than the words.
 *
 * STRIP, DON'T RENDER, and strip BEFORE slicing. A 320-character cut lands anywhere, including
 * mid-table and mid-`**`, so feeding the slice to `MarkdownDocument` would render a broken document
 * on some bodies and a correct one on others — a preview must not have that failure mode. Slicing
 * first would also spend the budget on characters the reader never sees.
 *
 * ponytail: four replaces and a slice, not a truncating parser. The full document is one click away
 * on the memo card, which DOES render (`MemoCardBody`); this is a glance, not a reader.
 */
export function previewText(body: string): string {
  const flat = body
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings — the marker, never the words
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // bullets (`**bold**` is untouched: no space after the *)
    .replace(/\*\*([^*]+)\*\*/g, "$1") // emphasis
    .replace(/\s+/g, " ") // the blank lines that separated the blocks are now noise
    .trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/**
 * 25.1-04 (D10). `executePlan`'s media arm reserves against a SHOT DECK (`sceneDeckOf` /
 * `deckOf`); a standalone image plan has neither, so the arm returns `no_deck` on every click that
 * has ever been made here. Images are produced by `api.media.generateImage`, which only the
 * workspace canvas calls. An Approve button on this card is structurally incapable of succeeding,
 * so the card says where the working route is instead of offering a mute one.
 */
export const IMAGE_CANVAS_NOTE =
  "Images are generated from the workspace canvas, not from this gate. Open the thread to generate or re-generate this image.";

/**
 * 25.1-04 (D9). A successful approve IS the `proposed → approved` transition, and
 * `approvals.listAwaiting` paginates `proposed` only — so the card that produced the message is
 * unmounted by the very mutation that produced it, and the user sees a row vanish with no outcome
 * (indistinguishable from a broken button). The outcome is therefore held by the SECTION, keyed by
 * plan, and rendered as a standalone card once its row has left the list. While the row is still
 * live its own card shows the message, which is why a live id is filtered out here rather than
 * shown twice. `null` means "cleared before a retry" and must not resurrect.
 */
export function persistentOutcomes(
  outcomes: Record<string, string | null>,
  liveIds: ReadonlySet<string>,
): [string, string][] {
  return Object.entries(outcomes).filter(
    (entry): entry is [string, string] => entry[1] !== null && !liveIds.has(entry[0]),
  );
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
    finance_write: "Figure update",
    // 17-05 (ACTN-02 gap closure). The `Record<PlanKind, string>` bind is exhaustive on purpose,
    // so the seventh action type could not be added without visiting this badge.
    calendar_manage: "Calendar change",
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

export type EmailApprovalPresentation = {
  recipients?: string[];
  recipientNames?: Record<string, string>;
  subject?: string;
  replyToMessageId?: string;
  replyThreadId?: string;
  mode?: "individual" | "group";
};

function compactSubject(subject?: string): string {
  const normalized = subject?.replace(/\s+/g, " ").trim() ?? "";
  if (normalized.length <= 90) return normalized;
  return `${normalized.slice(0, 89).trimEnd()}…`;
}

function recipientName(plan: EmailApprovalPresentation, address: string): string {
  return plan.recipientNames?.[address.toLowerCase()]?.trim() || address;
}

/**
 * The approval headline describes the business outcome, while EmailApprovalDetails below keeps
 * the exact transport and addresses visible at the safety gate. Names are content-plane hints on
 * the plan row; this derived copy is never persisted to audit or dashboard summary records.
 */
export function emailBusinessAction(plan: EmailApprovalPresentation): string {
  const recipients = plan.recipients ?? [];
  const first = recipients[0] ? recipientName(plan, recipients[0]) : "the recipient";
  const audience =
    recipients.length <= 1
      ? first
      : recipients.length === 2
        ? `${first} and ${recipientName(plan, recipients[1] ?? "the other recipient")}`
        : `${first} and ${recipients.length - 1} others`;
  const subject = compactSubject(plan.subject);
  const isReply = Boolean(plan.replyToMessageId || plan.replyThreadId);

  if (isReply) {
    const topic = subject.replace(/^(?:re\s*:\s*)+/i, "").trim();
    return topic ? `Reply to ${audience} about “${topic}”` : `Reply to ${audience}`;
  }
  if (subject) return `Send “${subject}” to ${audience}`;
  return `Send an email to ${audience}`;
}

export function emailApprovalActionLabel(plan: EmailApprovalPresentation): string {
  const recipients = plan.recipients ?? [];
  const onlyRecipient = recipients[0];
  if (recipients.length === 1 && onlyRecipient)
    return `Approve & send to ${recipientName(plan, onlyRecipient)}`;
  if (recipients.length > 1) return `Approve & send to ${recipients.length} recipients`;
  return "Approve & send email";
}

function titleFor(plan: Plan): string {
  if (plan.kind === "calendar_event") return plan.eventTitle || "Calendar plan";
  if (plan.kind === "calendar_manage")
    return plan.calendarOperation === "delete"
      ? "Remove an event from your calendar"
      : "Update an event on your calendar";
  // 25.1-05 (D11): the memo's own first line, which is a MARKDOWN HEADING — so the card headline
  // read `# Pricing findings`. The same strip as the preview below, because it is the same defect
  // one element up; found by the preview test failing on this string.
  if (plan.kind === "memo") return previewText(plan.body?.split("\n")[0] ?? "") || "Next-step memo";
  if (plan.kind === "crm_write") {
    const count = Array.isArray(plan.crmOperations) ? plan.crmOperations.length : 0;
    return `${count} change${count === 1 ? "" : "s"} to your records`;
  }
  // The COUNT, never the figure: this string is the card headline and §4's rule about a tenant's
  // revenue applies to a screenshot as much as to the audit log.
  if (plan.kind === "finance_write") {
    const count = Array.isArray(plan.financeClaims) ? plan.financeClaims.length : 0;
    return `${count} figure update${count === 1 ? "" : "s"}`;
  }
  if (plan.kind === "media") {
    const artDirection =
      typeof plan.artDirection === "string" ? plan.artDirection : plan.artDirection?.mood;
    return plan.imagePrompt || artDirection || "Media generation plan";
  }
  return emailBusinessAction(plan);
}

export function actionLabel(kind: PlanKind, plan?: EmailApprovalPresentation): string {
  if (kind === "memo") return "Approve & file to vault";
  if (kind === "calendar_event") return "Approve & create event";
  // 17-05: kind-only, so it cannot name update vs delete — the cockpit card can (it reads
  // `plan.calendarOperation`) and does. What matters here is that it never says "send".
  if (kind === "calendar_manage") return "Approve calendar change";
  // 19-06 ACTN-05: every label on this surface must name what Approve DOES. "Approve & send" on a
  // CRM write would promise an email the inline arm structurally cannot produce.
  if (kind === "crm_write") return "Approve & save to records";
  // Same rule, same arm: approving a figure update writes a number into the user's own finance
  // panel. "Approve & send" here would promise an email nothing in the inline arm can produce.
  if (kind === "finance_write") return "Approve & update the figure";
  if (kind === "reel" || kind === "image") return "Approve governed generation";
  return plan ? emailApprovalActionLabel(plan) : "Approve & send";
}

/** The three lane rows all satisfy this; stated structurally so `AwaitingCardBody` can be rendered
 *  from a test fixture without minting Convex ids. */
type PlanMetaFields = { createdAt: number; recipientCount: number; attachmentCount: number };

function PlanMeta({ item }: { item: PlanMetaFields }) {
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

function EmailApprovalDetails({ plan }: { plan: Plan }) {
  if (plan.kind !== undefined) return null;
  const recipients = plan.recipients ?? [];
  return (
    <dl
      aria-label="Email delivery details"
      style={{
        display: "grid",
        gridTemplateColumns: "max-content minmax(0, 1fr)",
        gap: "0.35rem 0.75rem",
        margin: 0,
        padding: "0.75rem",
        border: "1px solid var(--rule)",
        borderRadius: "0.75rem",
        background: "var(--canvas)",
      }}
    >
      <dt style={caps}>Channel</dt>
      <dd style={{ ...muted, margin: 0 }}>Email via Gmail</dd>
      <dt style={caps}>To</dt>
      <dd style={{ ...muted, margin: 0, overflowWrap: "anywhere" }}>
        {recipients.length === 0
          ? "No recipient set"
          : recipients
              .map((address) => {
                const name = recipientName(plan, address);
                return name === address ? address : `${name} (${address})`;
              })
              .join(", ")}
      </dd>
      <dt style={caps}>Delivery</dt>
      <dd style={{ ...muted, margin: 0 }}>
        {plan.mode === "group" ? "One group email" : "Individual email delivery"}
      </dd>
    </dl>
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
        <fieldset
          aria-label="Confirm absolute schedule"
          style={{ ...stack, border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <legend style={{ marginBottom: "0.75rem" }}>
            Confirm <strong>{formatAbsoluteInstant(reviewed, zone)}</strong>. Nothing runs before
            this instant.
          </legend>
          <button
            type="button"
            style={primary}
            disabled={busy}
            onClick={() => void onConfirm(reviewed)}
          >
            {busy ? "Working…" : label}
          </button>
        </fieldset>
      )}
    </div>
  );
}

/**
 * The presentational half of the awaiting card, split out of the connected component below so the
 * two guarantees 25.1-04 closed can be asserted against RENDERED MARKUP rather than a regex over a
 * 130-line JSX blob: the outcome notice is the FIRST child of the article (it used to sit under
 * the discard fieldset, off the bottom of a card nobody scrolls), and an image plan renders no
 * Approve button at all. `apps/web` has no jsdom, but `renderToStaticMarkup` needs none — the only
 * thing it cannot run is `useQuery`, which is the whole reason the hooks stayed upstairs.
 */
export function AwaitingCardBody({
  item,
  plan,
  busy,
  result,
  attachments,
  attachmentsOpen,
  scheduleOpen,
  confirmDiscard,
  onApprove,
  onSchedule,
  onDiscard,
  onToggleAttachments,
  onToggleSchedule,
  onRequestDiscard,
}: {
  item: PlanMetaFields & { planId: string; threadId: string; kind: PlanKind };
  plan: Plan;
  busy: boolean;
  result: string | null;
  attachments: AttachmentLinks | undefined;
  attachmentsOpen: boolean;
  scheduleOpen: boolean;
  confirmDiscard: boolean;
  onApprove: () => void;
  onSchedule: (epochMs: number) => Promise<void>;
  onDiscard: () => void;
  onToggleAttachments: () => void;
  onToggleSchedule: () => void;
  onRequestDiscard: (open: boolean) => void;
}) {
  // D10's ONE discriminator. `approvals.ts`'s `planKind` splits `plans.kind === "media"` into
  // reel/image on `mediaMode` alone, so a reel is unaffected here by construction.
  const imagePlan = item.kind === "image";
  const threadHref = `/dashboard/workspace?thread=${encodeURIComponent(item.threadId)}`;
  return (
    <article
      style={{ ...card, borderLeft: "0.3rem solid var(--held-text)", ...stack }}
      data-plan-id={item.planId}
    >
      {/* D9: the FIRST child of the card. This notice used to render below the discard fieldset —
          the last thing in a card the eye never reaches — and on a SUCCESS it never rendered at
          all, because the approve unmounted the card (see `persistentOutcomes`). */}
      {result && (
        <ApprovalsStateNotice state={result.includes("Nothing") ? "refusal" : "partial"}>
          {result}
        </ApprovalsStateNotice>
      )}

      <div style={row}>
        <div style={{ ...stack, gap: "0.35rem", minWidth: 0 }}>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            <span style={{ ...caps, color: "var(--held-text)" }}>Held · awaiting release</span>
            <ApprovalKindBadge kind={item.kind} />
          </div>
          <h3 style={{ ...cardTitle, overflowWrap: "anywhere" }}>{titleFor(plan)}</h3>
          <PlanMeta item={item} />
        </div>
        <Link href={threadHref} style={{ ...button, textDecoration: "none" }}>
          Open in cockpit ↗
        </Link>
      </div>

      {plan.body && <p style={muted}>{previewText(plan.body)}</p>}
      <EmailApprovalDetails plan={plan} />
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
          <button type="button" style={button} onClick={onToggleAttachments}>
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

      {/* D10: the honest route, in place of a button whose only possible answer is `no_deck`. */}
      {imagePlan && <p style={{ ...muted, fontSize: "0.86rem" }}>{IMAGE_CANVAS_NOTE}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {!imagePlan && (
          <button type="button" style={primary} disabled={busy} onClick={onApprove}>
            {busy ? "Working…" : actionLabel(item.kind, plan)}
          </button>
        )}
        {item.kind === "email" && (
          <button type="button" style={button} disabled={busy} onClick={onToggleSchedule}>
            Schedule…
          </button>
        )}
        <Link href={threadHref} style={{ ...button, textDecoration: "none" }}>
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
          onClick={() => onRequestDiscard(true)}
        >
          Discard
        </button>
      </div>

      {scheduleOpen && <ScheduleComposer busy={busy} onConfirm={onSchedule} />}
      {confirmDiscard && (
        <fieldset
          aria-label="Confirm discard"
          style={{
            ...stack,
            padding: "0.75rem",
            border: "1px solid var(--rule)",
            borderRadius: "0.75rem",
            margin: 0,
            minWidth: 0,
          }}
        >
          <legend>
            <strong>Discard this plan permanently?</strong>
          </legend>
          <p style={muted}>It will not be eligible for rescheduling.</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" style={destructive} disabled={busy} onClick={onDiscard}>
              Yes, discard it
            </button>
            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={() => onRequestDiscard(false)}
            >
              Keep plan
            </button>
          </div>
        </fieldset>
      )}
    </article>
  );
}

/** D9: what is left on screen once the approved row has dropped off `listAwaiting`. Green stripe
 *  (BRAND §2 `--released` = cleared), never amber — amber is the gate's alone — and the label is
 *  `--ink-soft` text rather than `--released` text, which is only ~3.3:1 on paper (BRAND §6). */
export function ResolvedOutcomeCard({ planId, message }: { planId: string; message: string }) {
  return (
    <article
      style={{ ...card, borderLeft: "0.3rem solid var(--released)", ...stack }}
      data-plan-id={planId}
    >
      <p style={caps}>Cleared from the gate</p>
      <ApprovalsStateNotice state="partial">{message}</ApprovalsStateNotice>
    </article>
  );
}

function AwaitingCard({
  item,
  result,
  onOutcome,
}: {
  item: AwaitingItem;
  result: string | null;
  /** D9: the message belongs to the SECTION, because the card is what disappears. */
  onOutcome: (message: string | null) => void;
}) {
  const plan = useQuery(api.plans.byThread, { threadId: item.threadId });
  const execute = useMutation(api.cockpit.executePlan);
  const discard = useMutation(api.cockpit.discardPlan);
  const setSendTime = useMutation(api.plans.setPlanSendTime);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
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
    onOutcome(null);
    try {
      const response = await execute({ planId: item.planId });
      if (!response.ok) onOutcome(refusalMessage(response.reason));
      else if (response.alreadyStarted) onOutcome(STALE_PLAN_MESSAGE);
      else if (response.scheduled)
        onOutcome(
          `The absolute schedule is armed. Nothing runs before it fires.${withheldSuffix(response.withheld)}`,
        );
      // finance_write, `applied: 0`: every claim was older than the figure already stored, so the
      // approval succeeded and NOTHING moved. "The governed action is now in flight" would imply a
      // write that did not happen.
      else if (response.applied === 0)
        onOutcome("Your figures were already up to date, so nothing changed.");
      else
        onOutcome(
          `Approval accepted. The governed action is now in flight.${withheldSuffix(response.withheld)}`,
        );
    } catch (error) {
      onOutcome(error instanceof Error ? error.message : "Approval failed. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  async function schedule(epochMs: number) {
    if (busy) return;
    setBusy(true);
    onOutcome(null);
    try {
      await setSendTime({ planId: item.planId, sendAt: epochMs });
      const response = await execute({ planId: item.planId });
      if (!response.ok) onOutcome(refusalMessage(response.reason));
      else if (response.alreadyStarted)
        onOutcome("This plan already moved. No duplicate schedule was created.");
      else
        onOutcome(
          `Scheduled for ${formatAbsoluteInstant(epochMs, browserTimeZone())}.${withheldSuffix(response.withheld)}`,
        );
    } catch (error) {
      onOutcome(error instanceof Error ? error.message : "Scheduling failed. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  async function doDiscard() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await discard({ planId: item.planId });
      onOutcome(
        response.discarded
          ? "Discarded. This plan cannot be re-armed."
          : "This plan already moved; no second discard was written.",
      );
    } catch (error) {
      onOutcome(error instanceof Error ? error.message : "Discard failed.");
    } finally {
      setBusy(false);
      setConfirmDiscard(false);
    }
  }

  return (
    <AwaitingCardBody
      item={item}
      plan={plan}
      busy={busy}
      result={result}
      attachments={attachments}
      attachmentsOpen={attachmentsOpen}
      scheduleOpen={scheduleOpen}
      confirmDiscard={confirmDiscard}
      onApprove={() => void approve()}
      onSchedule={schedule}
      onDiscard={() => void doDiscard()}
      onToggleAttachments={() => setAttachmentsOpen((open) => !open)}
      onToggleSchedule={() => setScheduleOpen((open) => !open)}
      onRequestDiscard={setConfirmDiscard}
    />
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
            ? "This email had already started sending, so its time could not be moved."
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
      {plan && <EmailApprovalDetails plan={plan} />}
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
        <fieldset
          aria-label="Confirm scheduled cancel"
          style={{
            ...stack,
            padding: "0.75rem",
            border: "1px solid var(--rule)",
            borderRadius: "0.75rem",
            margin: 0,
            minWidth: 0,
          }}
        >
          <legend>
            <strong>Cancel before this schedule fires?</strong>
          </legend>
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
        </fieldset>
      )}
      {result && <ApprovalsStateNotice state="partial">{result}</ApprovalsStateNotice>}
    </article>
  );
}

function InFlightRow({ item }: { item: InFlightItem }) {
  const plan = useQuery(api.plans.byThread, { threadId: item.threadId });
  const progress = item.progress;
  const completed = progress.state === "exact" ? progress.sent + progress.failed : null;
  const withheld = plan ? withheldNote(plan.recipients ?? [], plan.withheldRecipients) : null;
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
      {plan && <EmailApprovalDetails plan={plan} />}
      {/* SC#5's withheld report, DURABLY. `withheldSuffix` on the approve handler above still
          appends it to the transient result sentence, but nobody can read that: `listAwaiting`
          paginates `proposed` only, so the AwaitingCard that set it unmounts on the very approve
          that produced it (phase-19 UAT step 9b). This row is where the same plan lands one
          instant later, and it reads the note off the persisted row. `status`, never `alert`;
          `--ink-soft`, never amber — a partial send is information, not failure. */}
      {withheld && (
        <p role="status" data-testid="withheld-report" style={muted}>
          {withheld}
        </p>
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
            title={`${count} items`}
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
  // D9. Held HERE and not in the card, because a successful approve IS the transition that drops
  // the row out of `listAwaiting` — the card that produced the message is unmounted by the very
  // mutation that produced it. See `persistentOutcomes`.
  const [outcomes, setOutcomes] = useState<Record<string, string | null>>({});
  const page = useQuery(api.approvals.listAwaiting, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
  const liveIds = new Set<string>(page?.items.map((item) => item.planId) ?? []);
  const resolved = persistentOutcomes(outcomes, liveIds);
  return (
    <Section label="Awaiting you" count={total}>
      {page === undefined ? (
        <ApprovalsStateNotice state="loading" />
      ) : page.items.length === 0 && resolved.length === 0 ? (
        <ApprovalsStateNotice state="empty" />
      ) : (
        page.items.map((item) => (
          <AwaitingCard
            key={item.planId}
            item={item}
            result={outcomes[item.planId] ?? null}
            onOutcome={(message) => setOutcomes((prev) => ({ ...prev, [item.planId]: message }))}
          />
        ))
      )}
      {resolved.map(([planId, message]) => (
        <ResolvedOutcomeCard key={planId} planId={planId} message={message} />
      ))}
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
              href="/dashboard/approvals?tab=compliance"
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

function ClearedRow({ item }: { item: ClearedItem }) {
  const plan = useQuery(api.plans.byThread, { threadId: item.threadId });
  const status =
    item.status === "done"
      ? "Completed"
      : item.cancellation?.state === "known" && item.cancellation.kind === "discarded"
        ? "Discarded"
        : item.cancellation?.state === "known"
          ? "Canceled before fire"
          : "Canceled · legacy reason unknown";

  return (
    <article style={{ ...card, ...stack }} data-plan-id={item.planId}>
      <div style={row}>
        <div style={{ ...stack, gap: "0.35rem", minWidth: 0 }}>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            <ApprovalKindBadge kind={item.kind} />
            <span style={caps}>{status}</span>
          </div>
          <h3 style={{ ...cardTitle, overflowWrap: "anywhere" }}>
            {plan === undefined ? "Loading action…" : plan ? titleFor(plan) : "Unavailable action"}
          </h3>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={muted}>{formatAbsoluteInstant(item.createdAt, browserTimeZone())}</p>
          <p style={muted}>Cost not recorded</p>
        </div>
      </div>
      {plan && <EmailApprovalDetails plan={plan} />}
    </article>
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
            <ClearedRow key={item.planId} item={item} />
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

function ConnectedApprovals({ headingLevel = "h1" }: { headingLevel?: "h1" | "h2" }) {
  const summary = useQuery(api.approvals.summary);
  const Heading = headingLevel;
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
          <Heading
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
          </Heading>
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

export function ApprovalsView({ headingLevel = "h1" }: { headingLevel?: "h1" | "h2" }) {
  return (
    <ApprovalsErrorBoundary>
      <ConnectedApprovals headingLevel={headingLevel} />
    </ApprovalsErrorBoundary>
  );
}
