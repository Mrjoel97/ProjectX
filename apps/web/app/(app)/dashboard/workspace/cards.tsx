"use client";

import { api } from "@pikar/backend/api";
// Far-future cap (SCHD-01): the soft UI complement to executePlan's hard send_time_too_far refusal —
// one shared horizon, so the picker can't offer a time the server will reject.
// REVIEW_THREAD_ID (BEVL-03): the ONE deterministic thread the weekly cron writes to, so the card
// can tell "this is the weekly review" from "someone asked for an evaluation in a chat".
import {
  parseCrmOperations,
  RESEARCH_STALE_AFTER_MS,
  REVIEW_THREAD_ID,
  SEND_TIME_HORIZON_MS,
  withheldNote,
} from "@pikar/core";
// The pure view model (Gap 1): lede + action-first needs-you + time-grouped fyi remainder +
// collapsed-noise count. ALL the ordering/collapse/lede intelligence lives in @pikar/core — this
// card is a dumb renderer over it, never re-deriving any of it (ADR-004 / cockpit.md).
import { buildBriefingView } from "@pikar/core/briefing";
// The voice-doc framework literal, imported rather than re-typed: schema.ts, voiceDoc.ts and this
// card must agree, and one shared constant is the only way a rename cannot silently desync them.
import { DOC_REVIEW_FRAMEWORK } from "@pikar/voice";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { MarkdownDocument } from "../MarkdownDocument";
// The SHIPPED vault preview, mounted here rather than reimplemented: it already renders markdown,
// PDFs, images and video, the extraction/failure states and the entity chips. A second document
// viewer would be a second thing to keep in step with `previewState`.
import { PreviewModal } from "../vault/PreviewModal";
import { MediaCanvas, ProposalFailureCanvas } from "./MediaCanvas";
import { RevenuePackPanel } from "./RevenuePackPanel";
import { useSendCockpitMessage } from "./useSendCockpitMessage";

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

/**
 * A staged `crm_write` list, in plain language — one sentence per operation, exactly what Approve
 * will write. Parsed through `parseCrmOperations`, the SAME validator `executePlan` runs at the
 * apply boundary, so the card cannot promise something the server would refuse. THROWS on an
 * unparseable list; the caller renders that as "nothing to approve" rather than a partial promise.
 */
export function describeCrmOperations(raw: unknown): string[] {
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  return parseCrmOperations(raw).map((op) => {
    switch (op.op) {
      case "addContact":
        return `Add contact: ${op.email}${op.name ? ` (${op.name})` : ""}`;
      case "addFollowUp":
        return `Follow up with ${op.email} by ${day(op.dueAt)} — ${op.note}`;
      case "completeFollowUp":
        return "Mark a follow-up done";
      default:
        return "Cancel a follow-up";
    }
  });
}

// Live REPORT status → badge colour. Fan-out rows seed at "approved" and move
// delivering → sent | awaiting_reauth | failed (requests.status, schema.ts).
// 25.2 (G14): the status is an enum for the badge COLOUR and a sentence for the reader. A status the
// map has not met is shown with its underscores turned into spaces, never raw.
const DELIVERY_STATUS: Record<string, string> = {
  proposed: "Proposed",
  approved: "Approved",
  scheduled: "Scheduled",
  delivering: "Sending…",
  sent: "Sent",
  failed: "Failed",
  blocked: "Blocked",
  rejected: "Rejected",
  expired: "Expired",
  awaiting_reauth: "Waiting for you to reconnect Gmail",
};
export const deliveryStatusLabel = (status: string): string =>
  DELIVERY_STATUS[status] ?? status.replaceAll("_", " ");

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
  return {
    ...c,
    padding: "0.1rem 0.5rem",
    borderRadius: "0.375rem",
    fontSize: "0.8rem",
    fontWeight: 700,
  };
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
  const send = useSendCockpitMessage(); // carries the browser's trusted clock (§2-D)
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
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0.4rem 0 0",
          display: "grid",
          gap: "0.4rem",
        }}
      >
        {attachments.map((a, i) => {
          const url = urls?.[i]?.url ?? null; // urls loads async + may be null (getUrl); guard both
          return (
            <li key={a.storageId} style={attRow}>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontWeight: 600, color: "var(--teal-600)" }}
                >
                  {a.filename}
                </a>
              ) : (
                <span style={{ fontWeight: 600 }}>{a.filename}</span>
              )}
              <span style={dim}>{fmtSize(a.size)}</span>
              <span
                style={{ marginLeft: "auto", display: "flex", gap: "0.3rem", alignItems: "center" }}
              >
                <input
                  value={topics[i] ?? ""}
                  onChange={(e) => setTopics((p) => ({ ...p, [i]: e.target.value }))}
                  placeholder="new topic…"
                  aria-label={`Regenerate ${a.filename} topic`}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.15rem 0.4rem",
                    border: "1px solid #e5e5e5",
                    borderRadius: "0.3rem",
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !(topics[i] ?? "").trim()}
                  onClick={() =>
                    void drive(
                      `Please regenerate the "${a.filename}" attachment about: ${(topics[i] ?? "").trim()}.`,
                    )
                  }
                  style={{
                    ...btn,
                    padding: "0.2rem 0.6rem",
                    fontSize: "0.8rem",
                    border: "1px solid #e5e5e5",
                    background: "#fff",
                  }}
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void drive(`Please remove the "${a.filename}" attachment.`)}
                  aria-label={`Remove ${a.filename}`}
                  style={{
                    ...btn,
                    padding: "0.2rem 0.5rem",
                    fontSize: "0.8rem",
                    border: "1px solid #e5e5e5",
                    background: "#fff",
                  }}
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
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0.4rem 0 0",
          display: "grid",
          gap: "0.5rem",
        }}
      >
        {recipients.map((r) => {
          const tailored = overrides[r]; // exact-string lookup — same key executePlan seeds with
          const bodyText = tailored ?? sharedBody;
          return (
            <li
              key={r}
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: "0.5rem",
                padding: "0.5rem 0.6rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "0.4rem",
                  alignItems: "center",
                  marginBottom: "0.3rem",
                }}
              >
                <span style={chip}>{r}</span>
                <span style={{ ...dim, fontWeight: 700 }}>
                  {tailored ? "tailored" : "shared body"}
                </span>
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

/** One note, one optional lever. `tone` is set at the call site (a refusal is an error, the
 *  withheld report is not), so the map below carries only what is refusal-specific. */
type PlanNote = { text: string; tone?: "error" | "info"; link?: { href: string; label: string } };

/**
 * Every governed refusal this card can show, and the lever the user can pull for it. Module-scope
 * and EXPORTED so the set is assertable — it used to be a local const inside `approve()`, where a
 * missing key was undetectable: unlike the Approvals page's `refusalMessage`, which falls back to
 * printing the raw enum, `if (refusal) setNote(...)` below renders NOTHING AT ALL for a reason
 * that is not here. A silent no-op on the second approve surface is the worse failure mode.
 *
 * A reason with no entry here is one the canvas or the picker already surfaces (media/scheduling).
 * Copy is kept WORD-FOR-WORD in step with `approvals/ApprovalsView.tsx`'s `refusalMessage` — the
 * same stop must not read as two different rules on the two surfaces.
 */
export const PLAN_REFUSALS: Record<string, PlanNote> = {
  gmail_not_connected: {
    text: "This email is ready, but Gmail is not connected. Connect it to send this approved message.",
    link: { href: "/connect-gmail", label: "Connect Gmail" },
  },
  no_postal_address: {
    text: "Add your postal address before sending — the law requires it in every email's footer.",
    // href and label travel TOGETHER (Task 8 review). They used to be an optional `href` beside a
    // HARDCODED "Open your profile" label, so the first entry pointing anywhere else would have
    // rendered the wrong words over the right link.
    link: { href: "/dashboard/profile", label: "Open your profile" },
  },
  all_recipients_suppressed: {
    text: "Nobody on this list can be emailed: every recipient has unsubscribed.",
  },
  // Task 8 (live-finance-inputs): `applyFinanceClaims`'s two refusals, which reach this card as a
  // RETURN rather than a throw Convex would redact in production. Without these entries a rejected
  // figure approval would set no note and the click would look like it simply did nothing.
  agent_cannot_update_figure: {
    text: "That figure can only be updated by you for now — the agent cannot vouch for where it came from. Nothing changed.",
    link: { href: "/dashboard/finance", label: "Open your finance figures" },
  },
  malformed_figure_claim: {
    text: "This figure update was malformed and was not applied. Nothing changed.",
  },
};

/**
 * WHICH MAILBOXES THIS TENANT MAY SEND THROUGH, and what the picker should say about it.
 *
 * Pure and exported so the branching is testable without a Convex transport — the same reason
 * `reconnectLines` is.
 *
 * THE LOAD-BEARING RULE: Microsoft is offered on `mailReady`, NEVER on `connected`. A 17-05-era
 * grant is connected, refreshable and real, and simply cannot send mail (ADR-018 put Calendar and
 * Mail on ONE grant, so a pre-widening consent carries only the calendar half). Offering it would
 * walk the user into `mail_scope_missing` at approve time instead of into re-consent now.
 *
 * There is deliberately no "active provider" anywhere: the choice is per-plan, so a second plan
 * never inherits what someone clicked on a different one.
 */
export function mailboxOptions(input: {
  googleConnected: boolean;
  microsoftConnected: boolean;
  microsoftMailReady: boolean;
}): {
  options: ("google" | "microsoft")[];
  /** Shown when a Microsoft grant exists but predates the mail scope. */
  microsoftNeedsReconsent: boolean;
} {
  const options: ("google" | "microsoft")[] = [];
  if (input.googleConnected) options.push("google");
  if (input.microsoftMailReady) options.push("microsoft");
  return {
    options,
    microsoftNeedsReconsent: input.microsoftConnected && !input.microsoftMailReady,
  };
}

const MAILBOX_LABEL: Record<"google" | "microsoft", string> = {
  google: "Gmail",
  microsoft: "Outlook",
};

/** The per-plan mailbox choice. Renders nothing when there is only one option and it is already
 *  the plan's — a picker with one entry is noise. */
function MailboxPicker({ plan }: { plan: Plan }) {
  const gmail = useQuery(api.gmailAuth.gmailStatus, {});
  const microsoft = useQuery(api.microsoftAuth.microsoftStatus, {});
  const setProvider = useMutation(api.plans.setPlanMailProvider);

  if (gmail === undefined || microsoft === undefined) return null;

  const { options, microsoftNeedsReconsent } = mailboxOptions({
    googleConnected: gmail.connected,
    microsoftConnected: microsoft.connected,
    microsoftMailReady: microsoft.mailReady,
  });
  // Absence means Google — the same default `delivery.send` applies to the row itself.
  const chosen = plan.mailProvider ?? "google";

  // Nothing to choose between, and nothing to warn about.
  if (options.length < 2 && !microsoftNeedsReconsent) return null;

  return (
    <div style={{ margin: "0 0 0.75rem" }}>
      <div style={label}>SEND FROM</div>
      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
        {options.map((provider) => (
          <button
            key={provider}
            type="button"
            aria-pressed={chosen === provider}
            onClick={() => void setProvider({ planId: plan._id, mailProvider: provider })}
            style={{
              ...btn,
              border: chosen === provider ? "1px solid var(--teal-600)" : "1px solid #e5e5e5",
              background: chosen === provider ? "var(--teal-50, #f0fdfa)" : "#fff",
              fontWeight: chosen === provider ? 700 : 500,
            }}
          >
            {MAILBOX_LABEL[provider]}
          </button>
        ))}
      </div>
      {microsoftNeedsReconsent && (
        <p style={{ ...dim, margin: "0.35rem 0 0" }}>
          Your Microsoft connection covers calendar only.{" "}
          <Link href="/connect-microsoft">Reconnect Microsoft</Link> to send mail from Outlook.
        </p>
      )}
    </div>
  );
}

/** One page a research specialist actually retrieved (`plans.sources`, written at landing). */
type MemoSource = NonNullable<Plan["sources"]>[number];

/** The retrieval stamp, in the card's own words. Mirrored by `memoCard.test.ts` — changing the
 *  format is a deliberate act, not a silent one. */
// Phase 39: past the shared staleness window the stamp SAYS so — words, not colour (BRAND §6; amber
// is reserved for the approval gate). The same constant decides when research is re-bought.
const retrievedLabel = (ms: number) =>
  `Retrieved ${new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}${
    Date.now() - ms > RESEARCH_STALE_AFTER_MS ? " — may be out of date" : ""
  }`;

/**
 * The memo card's READABLE half: the specialist's document, rendered, and the pages it read.
 *
 * TWO DEFECTS, ONE COMPONENT (D11). The body used to print through a `white-space: pre-wrap`
 * paragraph, so the product of a paid specialist turn showed the reader literal `#` and `**` —
 * finished work looking broken. And the sources, which were retrieved, deduped, billed for and
 * written into the vault document, never reached the card at all, so the findings were unverifiable
 * exactly where the human decides.
 *
 * Hook-free and EXPORTED so `renderToStaticMarkup` can assert against real markup (the
 * `GroundedSources` / `AwaitingCardBody` precedent): a regex over this file cannot tell a rendered
 * heading from a printed `#`.
 *
 * ponytail: `MarkdownDocument` in its existing `compact` form (the same renderer the chat bubbles
 * and the artifact preview use) — no second renderer, no tokenizer change. The references are a
 * plain always-visible list rather than a `<details>` fold: a research turn returns a handful of
 * URLs, and `GroundedSources`' fold exists for a list that accumulates across a whole thread.
 * Upgrade path if a real memo ever carries dozens: reuse that fold verbatim.
 */
export function MemoCardBody({ body, sources }: { body: string; sources?: readonly MemoSource[] }) {
  return (
    <>
      <div style={{ margin: "0.5rem 0 0.75rem", color: "var(--ink)", fontSize: "0.9rem" }}>
        <MarkdownDocument markdown={body} compact />
      </div>
      {sources && sources.length > 0 && (
        <section
          aria-label="Sources"
          style={{
            margin: "0 0 0.75rem",
            paddingTop: "0.6rem",
            borderTop: "1px solid var(--rule)",
          }}
        >
          {/* BRAND §3's tracked-caps section label. `--ink-soft`, not `--teal-600`: §6 bars teal-600
              as small text on white (~2.9:1). */}
          <div
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-soft)",
            }}
          >
            Sources
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: "0.4rem 0 0",
              padding: 0,
              display: "grid",
              gap: "0.4rem",
            }}
          >
            {sources.map((source) => (
              <li key={source.url} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {/* `--teal-900` for link text (BRAND §6). `noopener` because these are pages the
                    MODEL chose to fetch, not links the product vouches for. */}
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-testid="memo-source"
                  style={{ color: "var(--teal-900)", fontWeight: 600, fontSize: "0.85rem" }}
                >
                  {source.title.trim() || source.url}
                </a>
                {/* The URL is READ, not merely hovered — checking a finding must not need a mouse.
                    Suppressed when the title fell back to it, so it is never printed twice. */}
                <div style={{ ...dim, fontSize: "0.75rem" }}>
                  {source.title.trim() ? `${source.url} · ` : ""}
                  {retrievedLabel(source.retrievedAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PlanCard({ plan, threadId }: { plan: Plan; threadId?: string }) {
  const execute = useMutation(api.cockpit.executePlan);
  const setSendTime = useMutation(api.plans.setPlanSendTime);
  const managedEvent = useQuery(
    api.calendarEvents.forCard,
    plan.kind === "calendar_manage" && plan.calendarManagedEventId
      ? { managedEventId: plan.calendarManagedEventId }
      : "skip",
  );
  const [busy, setBusy] = useState(false);
  // The governed-refusal note, typed off `PlanNote` so the entry's own `link.label` rides along.
  // A refusal LEAVES the plan `proposed`, which is the only reason a note in this component's
  // state is visible at all — see the withheld report in `PlanCards`, which is the same
  // information about a SUCCESS and therefore cannot live here. Amber is deliberately not used:
  // BRAND §2 reserves `--held` for the approval gate alone.
  const [note, setNote] = useState<(PlanNote & { tone: "error" | "info" }) | null>(null);
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
      if (!res.ok) {
        // Every governed stop names the lever the user can pull; the map is module-scope so the
        // set of stops is assertable (see PLAN_REFUSALS). A reason with no entry there is a
        // media/scheduling refusal the canvas or the picker already surfaces.
        const refusal = PLAN_REFUSALS[res.reason];
        if (refusal) setNote({ ...refusal, tone: "error" });
      }
      // NO success branch here — neither `res.withheld` nor finance's `res.applied === 0`.
      // Merge note (2026-08-10, lane/live-finance-inputs): the lane predates 19-12 and re-added
      // both. Both are DEAD for one reason: `cockpit.ts:752` patches a successful finance apply to
      // `done`, and `PlanCards` at :2608 renders this component only while `status === "proposed"`,
      // so the card unmounts before `execute()` resolves and `setNote` runs on a dead component.
      // The "already up to date" copy is NOT lost — `ApprovalsView.tsx:405` carries it word-for-word
      // on the surface that survives the transition. Anything to say about a SUCCESS belongs on the
      // plan row, like the withheld set below.
      // NO `res.withheld` branch here. It was one (19-05) and it was DEAD: this component only
      // renders while `plan.status === "proposed"`, and a successful approve is exactly the
      // transition off `proposed` — the reactive subscription unmounts the card before `execute()`
      // resolves, so `setNote` ran on a dead component and nobody ever saw SC#5's report. The
      // withheld set is persisted on the plan row instead and rendered by `PlanCards` below, where
      // it survives the transition that creates it. (Phase-19 UAT step 9b.)
    } finally {
      setBusy(false);
    }
  }

  // THE note element, built ONCE and rendered by EVERY branch below (Task 8 review, finding 1).
  // It used to live only inside the final email return, while `memo`, `crm_write`, `finance_write`
  // and `calendar_event` all EARLY-RETURN their own JSX — so on those four cards `setNote` ran, the
  // component re-rendered, and NOTHING was displayed. That was invisible for years because the
  // three original reasons (`gmail_not_connected`, `no_postal_address`, `all_recipients_suppressed`)
  // only fire on EMAIL plans, which do reach the final return; `finance_write` is the first branch
  // whose refusals actually fire. Rendered as one shared element rather than copied into each
  // branch, so a NEW branch that forgets it is the only way to regress — and crmCard.test.ts
  // scans this file for exactly that.
  const planNote = note && (
    // `alert` interrupts for a refusal; `status` is polite for the withheld report, which
    // reports something that already succeeded. `--teal-900`, not `--teal-600`: BRAND §6 bars
    // teal-600 as small text on white (~2.9:1).
    <p
      role={note.tone === "error" ? "alert" : "status"}
      style={{
        color: note.tone === "error" ? "#dc2626" : "var(--ink-soft)",
        margin: "0.5rem 0 0",
      }}
    >
      {note.text}
      {note.link && (
        <>
          {" "}
          <Link href={note.link.href} style={{ color: "var(--teal-900)", fontWeight: 600 }}>
            {note.link.label}
          </Link>
        </>
      )}
    </p>
  );

  // A REFUSED REEL PROPOSAL (33-13) — ahead of the memo branch, because that is the branch it was
  // wrongly falling into. The row IS `kind: "memo"` (no deck parsed, so `persistStoryboard` never
  // moved it), and the memo card offered Approve and Save over a reel that does not exist. What
  // this needs is the media surface's own failure card, with the retry that re-asks the specialist.
  if (plan.proposalRefusal) {
    return <ProposalFailureCanvas refusal={plan.proposalRefusal} threadId={threadId} />;
  }

  // MEMO plan (12-05, BEVL-02): same single Approve gate, a different promise. Everything below
  // this branch is email chrome — recipients, mode, a send-time picker, "Send to N recipients" —
  // and every word of it would be a lie on a memo (it is saved to the vault, never sent). Reuses
  // the approve()/busy/note handler above verbatim; executePlan takes the persist terminal.
  if (plan.kind === "memo") {
    return (
      <div style={box} data-testid="memo-plan-card">
        <div style={label}>NEXT-STEP MEMO</div>
        <MemoCardBody body={body} sources={plan.sources} />
        <p style={{ ...dim, margin: "0 0 0.75rem" }}>
          Approving saves this to your knowledge vault. Nothing is sent to anyone.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void approve()}
          style={{
            ...btn,
            background: "var(--teal-600)",
            color: "#fff",
            border: "none",
            fontWeight: 600,
          }}
        >
          {busy ? "Saving…" : "Approve & save"}
        </button>
        {planNote}
      </div>
    );
  }

  // CRM plan (19-06, ACTN-05): same single Approve gate, a different promise again. Approving
  // applies EVERY operation below or none of them (one serializable mutation); nothing is emailed
  // and no Gmail connection is needed. Ahead of the email chrome for the memo/calendar reason —
  // recipients, mode, the send-time picker and "Send to N recipients" are all lies on a CRM write.
  if (plan.kind === "crm_write") {
    // Read through the SAME validator the applier runs (@pikar/core). An unparseable list is
    // unapprovable, so the card must not offer an Approve button for it — a card that renders a
    // list the server will refuse is worse than one that says so.
    let lines: string[] | null;
    try {
      lines = describeCrmOperations(plan.crmOperations);
    } catch {
      lines = null;
    }
    return (
      <div style={box} data-testid="crm-plan-card">
        <div style={label}>CRM UPDATE</div>
        {lines === null ? (
          <p role="alert" style={{ color: "#dc2626", margin: "0.5rem 0 0" }}>
            This plan's records list is incomplete, so there is nothing to approve. Ask for it
            again.
          </p>
        ) : (
          <>
            <ul
              style={{
                listStyle: "none",
                margin: "0.5rem 0 0.75rem",
                padding: 0,
                display: "grid",
                gap: "0.35rem",
              }}
            >
              {lines.map((line, i) => (
                <li
                  // Two operations can legitimately render the SAME sentence (the same contact
                  // named twice), so the line alone is not unique. The list is frozen at stage
                  // time and this card never reorders, filters or inserts into it.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the identity here
                  key={`${i}-${line}`}
                  style={{
                    ...chip,
                    // BRAND §6: the teal goes in the FILL, never in 0.85rem text (`--teal-600` on
                    // white is ~2.9:1). Zero `--held` — amber is the approval gate's alone (§2).
                    background: "color-mix(in srgb, var(--teal-400) 30%, var(--card))",
                    borderColor: "var(--rule)",
                    color: "var(--ink)",
                    display: "block",
                    borderRadius: "0.5rem",
                  }}
                >
                  {line}
                </li>
              ))}
            </ul>
            <p style={{ ...dim, margin: "0 0 0.75rem" }}>
              Approving saves all {lines.length} {lines.length === 1 ? "change" : "changes"} to your
              records. Nothing is sent to anyone.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void approve()}
              style={{
                ...btn,
                background: "var(--teal-600)",
                color: "#fff",
                border: "none",
                fontWeight: 600,
              }}
            >
              {busy ? "Saving…" : "Approve & save to records"}
            </button>
          </>
        )}
        {planNote}
      </div>
    );
  }

  // FINANCE plan (Task 8, live-finance-inputs): same single Approve gate, a different promise
  // again. Approving writes the staged figures into the user's OWN numbers — the same `inline`
  // arm the CRM branch uses, so nothing is emailed and no Gmail connection is needed. Ahead of the
  // email chrome for the memo/CRM reason: recipients, mode, the send-time picker and "Send to N
  // recipients" are all lies on a figure update.
  //
  // The COUNT, never the figures. `approvals/ApprovalsView.tsx`'s `titleFor` made this call for
  // the primary approve surface and §4's rule about a tenant's revenue applies to a screenshot as
  // much as to the audit log; the two surfaces must not disagree about what a figure card shows.
  // The figures themselves are on /dashboard/finance, which is where Approve writes them.
  if (plan.kind === "finance_write") {
    const count = Array.isArray(plan.financeClaims) ? plan.financeClaims.length : 0;
    return (
      <div style={box} data-testid="finance-plan-card">
        <div style={label}>FIGURE UPDATE</div>
        <p style={{ margin: "0.5rem 0 0.75rem", color: "var(--ink)", fontSize: "0.9rem" }}>
          {count} figure {count === 1 ? "update is" : "updates are"} waiting on your approval.
        </p>
        <p style={{ ...dim, margin: "0 0 0.75rem" }}>
          Approving saves {count === 1 ? "it" : "them"} to your finance figures. Nothing is sent to
          anyone.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void approve()}
          style={{
            ...btn,
            background: "var(--teal-600)",
            color: "#fff",
            border: "none",
            fontWeight: 600,
          }}
        >
          {/* Word-for-word `approvals/ApprovalsView.tsx`'s actionLabel — one act, one promise. */}
          {busy ? "Saving…" : "Approve & update the figure"}
        </button>
        {planNote}
      </div>
    );
  }

  // MEDIA plan (20-10, MEDIA-01): NOT an approve gate at all — the canvas owns its own itemised
  // estimate and its own Generate button, because what is being bought is four cost lines rather
  // than one send. Same reason the two branches above exist: everything below is email chrome
  // (recipients, mode, a send-time picker, "Send to N recipients") and every word of it would be a
  // lie on a storyboard and a reel.
  if (plan.kind === "media") {
    return <MediaCanvas plan={plan} threadId={threadId} />;
  }

  // CALENDAR plan (17-01, ACTN-02): same single Approve gate, a different promise. Approving
  // creates ONE event on the user's Google Calendar; nothing is emailed and no attendee is
  // invited. Same reason the memo branch exists — everything below is email chrome (recipients,
  // mode, a send-time picker, "Send to N recipients") and every word of it is a lie on an event.
  // Reuses formatAbsolute (the picker's own formatter) and the approve()/busy handler verbatim.
  if (plan.kind === "calendar_event") {
    const startMs = plan.eventStartMs;
    const durationMs = plan.eventDurationMs;
    // 17-07: the card must name the calendar the event will actually land on — this is the last
    // surface before an irreversible write, and "Google" on a Microsoft event is a false promise at
    // exactly the moment the user is deciding. ABSENT means Google (`plans.calendarProvider`'s
    // documented rule), so every row staged before this phase still reads correctly.
    const calendarName = plan.calendarProvider === "microsoft" ? "Microsoft" : "Google";
    return (
      <div style={box} data-testid="calendar-plan-card">
        <div style={label}>CALENDAR EVENT</div>
        <div style={{ margin: "0.5rem 0" }}>
          <strong>{plan.eventTitle || "—"}</strong>
        </div>
        {/* A partially-staged row may carry none of these — render a dash, never NaN. */}
        <div style={dim}>When: {startMs ? formatAbsolute(startMs) : "—"}</div>
        <div style={dim}>
          Duration: {durationMs ? `${Math.round(durationMs / 60000)} min` : "—"}
        </div>
        <div style={dim} data-testid="calendar-plan-provider">
          Calendar: {calendarName}
        </div>
        <p style={{ ...dim, margin: "0.75rem 0" }}>
          Approving adds this to your {calendarName} Calendar. No one is invited and nothing is
          emailed.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void approve()}
          style={{
            ...btn,
            background: "var(--teal-600)",
            color: "#fff",
            border: "none",
            fontWeight: 600,
          }}
        >
          {busy ? "Adding…" : "Approve & add to calendar"}
        </button>
        {planNote}
      </div>
    );
  }

  // CALENDAR CHANGE (17-05, the ACTN-02 gap closure). A DIFFERENT promise from the create card
  // above, which is the whole reason `calendar_manage` is a separate action type: approving here
  // moves or removes an event that already exists on a real calendar. Ahead of the email chrome for
  // the memo/CRM/calendar reason — recipients, mode, the send-time picker and "Send to N
  // recipients" are all lies on a calendar change.
  //
  // The registry snapshot was refreshed in the SAME transaction that proposed this plan. It is the
  // exact before-state the fresh etag names; reading it here avoids reconstructing an original from
  // desired values (provenance laundering) and avoids adding duplicate snapshot fields to schema.
  if (plan.kind === "calendar_manage") {
    const removing = plan.calendarOperation === "delete";
    const providerName =
      plan.calendarProvider === "microsoft" ? "Microsoft Outlook" : "Google Calendar";
    // A delete carries NO desired content — @pikar/core's `buildManageIntent` refuses one that
    // does — so the "new value" rows must not render for it, or the card would offer a change the
    // server would refuse.
    const changes: [string, string][] = removing
      ? []
      : (
          [
            ["Title", plan.eventTitle],
            ["Time", plan.eventStartMs ? formatAbsolute(plan.eventStartMs) : undefined],
            [
              "Duration",
              plan.eventDurationMs ? `${Math.round(plan.eventDurationMs / 60000)} min` : undefined,
            ],
          ] as [string, string | undefined][]
        ).filter((row): row is [string, string] => Boolean(row[1]));
    return (
      <div style={box} data-testid="calendar-manage-plan-card">
        <div style={label}>CALENDAR MANAGEMENT</div>
        <div style={{ margin: "0.5rem 0" }}>
          <strong>
            {removing ? "Remove an event from your calendar" : "Update an event on your calendar"}
          </strong>
        </div>
        <div style={dim}>Calendar: {providerName}</div>
        <div
          data-testid="calendar-manage-original"
          style={{ margin: "0.75rem 0", padding: "0.65rem", borderLeft: "3px solid var(--rule)" }}
        >
          <div style={label}>CURRENT EVENT</div>
          {managedEvent === undefined ? (
            <div style={dim}>Loading the event you are changing…</div>
          ) : managedEvent === null ? (
            <div style={dim}>
              This managed event is no longer available. Ask Pikar to list it again.
            </div>
          ) : (
            <>
              <div style={{ marginTop: "0.25rem" }}>
                <strong>{managedEvent.title || "(untitled event)"}</strong>
              </div>
              <div style={dim}>Time: {formatAbsolute(managedEvent.startMs)}</div>
              <div style={dim}>Duration: {Math.round(managedEvent.durationMs / 60000)} min</div>
            </>
          )}
        </div>
        {!removing && changes.length > 0 && (
          <div data-testid="calendar-manage-proposed" style={{ margin: "0.75rem 0" }}>
            <div style={label}>PROPOSED CHANGES</div>
            {changes.map(([name, value]) => (
              <div key={name} style={dim}>
                {name}: {value}
              </div>
            ))}
          </div>
        )}
        {!removing && changes.length === 0 && (
          <div style={dim}>No change has been staged yet, so there is nothing to approve.</div>
        )}
        <p style={{ ...dim, margin: "0.75rem 0" }}>
          {removing
            ? `This event remains on your ${providerName}. Approve to remove exactly this event; ` +
              "Pikar makes no additional delivery promises."
            : `The current event stays unchanged until you Approve these exact changes on ${providerName}.`}
        </p>
        <button
          type="button"
          disabled={busy || managedEvent == null || (!removing && changes.length === 0)}
          onClick={() => void approve()}
          style={{
            ...btn,
            background: removing ? "transparent" : "var(--teal-600)",
            color: removing ? "var(--danger-text)" : "var(--card)",
            border: removing
              ? "1px solid color-mix(in srgb, var(--danger-text) 45%, var(--rule))"
              : "none",
            fontWeight: 600,
          }}
        >
          {busy
            ? "Working…"
            : removing
              ? "Approve & remove from calendar"
              : "Approve & update calendar"}
        </button>
        {planNote}
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={label}>PLAN</div>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
        {recipients.length === 0 ? (
          <span style={dim}>No recipients yet.</span>
        ) : (
          recipients.map((r) => (
            <span key={r} style={chip}>
              {r}
            </span>
          ))
        )}
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
      <MailboxPicker plan={plan} />
      <div style={{ margin: "0 0 0.75rem" }}>
        <div style={label}>SEND TIME</div>
        <input
          type="datetime-local"
          value={sendAt ? toLocalInputValue(sendAt) : ""}
          min={toLocalInputValue(Date.now())}
          max={toLocalInputValue(Date.now() + SEND_TIME_HORIZON_MS)}
          onChange={(e) =>
            void setSendTime({
              planId: plan._id,
              sendAt: e.target.value ? new Date(e.target.value).getTime() : undefined,
            })
          }
          style={{ ...btn, cursor: "auto", border: "1px solid #e5e5e5", marginTop: "0.35rem" }}
        />
        {sendAt ? (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>
            Sends {formatAbsolute(sendAt)}
            {" · "}
            <button
              type="button"
              onClick={() => void setSendTime({ planId: plan._id, sendAt: undefined })}
              style={{
                ...btn,
                padding: "0.1rem 0.5rem",
                border: "1px solid #e5e5e5",
                background: "transparent",
                color: "var(--teal-600)",
              }}
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
        style={{
          ...btn,
          background: "var(--teal-600)",
          color: "#fff",
          border: "none",
          fontWeight: 600,
        }}
      >
        {busy ? "Approving…" : sendAt ? "Approve & schedule" : "Approve"}
      </button>
      {planNote}
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
        Scheduled for <strong>{plan.sendAt ? formatAbsolute(plan.sendAt) : "—"}</strong>. Nothing
        sends before then.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void doCancel()}
        style={{
          ...btn,
          border: "1px solid #dc2626",
          background: "transparent",
          color: "#dc2626",
          fontWeight: 600,
        }}
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

  if (plan.kind === "calendar_manage" && plan.calendarFailureCode) {
    const reconnectHref =
      plan.calendarProvider === "microsoft" ? "/connect-microsoft" : "/connect-gmail";
    const reason = (() => {
      switch (plan.calendarFailureCode) {
        case "conflict":
          return (
            "The event changed after this proposal was staged. Pikar did not overwrite it. " +
            "List managed events again, then restage the change."
          );
        case "attendees_present":
          return "The event now has attendees, so Pikar refused to change it. Nothing was removed or updated.";
        case "reauth":
          return (
            "The calendar connection needs attention. Reconnect it, list the event again, then " +
            "restage the change."
          );
        case "provider_unsupported":
          return "Microsoft event removal is not supported safely. The event is still on the calendar.";
        case "not_found":
        case "not_managed":
          return (
            "That managed event is no longer available. List managed events again before " +
            "proposing another change."
          );
        case "needs_inspection":
          return "The event needs a fresh calendar snapshot. List it again, then restage the change.";
        default:
          return (
            "The calendar provider refused this change. The event was not changed; list it again " +
            "before restaging."
          );
      }
    })();
    return (
      <div style={box} data-testid="calendar-manage-refusal">
        <div style={label}>CALENDAR CHANGE REFUSED</div>
        <p role="alert" style={{ color: "var(--danger-text)", margin: "0.5rem 0" }}>
          {reason}
        </p>
        {plan.calendarFailureCode === "reauth" && (
          <Link href={reconnectHref} style={{ color: "var(--teal-900)", fontWeight: 600 }}>
            Reconnect calendar →
          </Link>
        )}
      </div>
    );
  }

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
      <p style={{ ...dim, margin: "0.5rem 0 0" }}>
        This scheduled send was canceled. Nothing was sent.
      </p>
      <div style={{ margin: "0.75rem 0 0" }}>
        <div style={label}>RESCHEDULE</div>
        <input
          type="datetime-local"
          value={sendAt ? toLocalInputValue(sendAt) : ""}
          min={toLocalInputValue(Date.now())}
          max={toLocalInputValue(Date.now() + SEND_TIME_HORIZON_MS)}
          onChange={(e) =>
            void setSendTime({
              planId: plan._id,
              sendAt: e.target.value ? new Date(e.target.value).getTime() : undefined,
            })
          }
          style={{ ...btn, cursor: "auto", border: "1px solid #e5e5e5", marginTop: "0.35rem" }}
        />
        {futureSet ? (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>
            Re-sends {formatAbsolute(sendAt as number)}.
          </p>
        ) : (
          <p style={{ ...dim, margin: "0.35rem 0 0" }}>
            Pick a future time to reschedule this send.
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={busy || !futureSet}
        onClick={() => void doReschedule()}
        style={{
          ...btn,
          marginTop: "0.5rem",
          background: "var(--teal-600)",
          color: "#fff",
          border: "none",
          fontWeight: 600,
        }}
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
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, color: "#333" }}>
        {plan.body ?? ""}
      </pre>
    </div>
  );
}

// A delivered ReportCard row (plans.reportForPlan) — the shape the feedback control keys off.
type ReportRow = FunctionReturnType<typeof api.plans.reportForPlan>[number];
type RequestId = ReportRow["requestId"];

// IMPR-01 feedback on the delivered response: thumbs up/down (+ an optional single-line "why"
// on thumbs-down), editable/undoable. ponytail: no debounce/optimistic cache — Convex
// reactivity re-renders myFeedback after every mutation; two buttons + one input wired to the
// three Plan-02 mutations is the laziest correct control. Selected state is NOT colour-only
// (aria-pressed + a filled/outlined weight + the ✓ affordance), per BRAND §6 a11y.
function FeedbackControl({ requestId }: { requestId: RequestId }) {
  const current = useQuery(api.feedback.myFeedback, { requestId });
  const submit = useMutation(api.feedback.submitFeedback);
  const undo = useMutation(api.feedback.undoFeedback);
  const [comment, setComment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (current === undefined) return null; // first load — render nothing rather than a flicker
  const rating = current?.rating ?? null;
  // Reveal the comment field on thumbs-down (the qualitative "why" SkillOpt needs) or whenever a
  // comment already exists; `comment` state is the in-flight edit, falling back to the stored one.
  const showComment = rating === "down" || (current?.comment ?? "") !== "";
  const commentValue = comment ?? current?.comment ?? "";

  async function choose(next: "up" | "down") {
    if (busy) return;
    setBusy(true);
    try {
      // Clicking the SELECTED thumb again UNDOES (a mis-tap is reversible); the other thumb EDITS.
      if (rating === next) {
        await undo({ requestId });
        setComment(null);
      } else {
        await submit({ requestId, rating: next, comment: commentValue || undefined });
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveComment() {
    if (busy || !rating) return; // a comment without a rating has nothing to attribute to
    setBusy(true);
    try {
      await submit({ requestId, rating, comment: commentValue || undefined });
    } finally {
      setBusy(false);
    }
  }

  const thumb = (value: "up" | "down", glyph: string, aria: string) => {
    const active = rating === value;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={aria}
        disabled={busy}
        onClick={() => void choose(value)}
        style={{
          ...btn,
          padding: "0.25rem 0.6rem",
          fontSize: "0.95rem",
          lineHeight: 1,
          border: active ? "1px solid var(--teal-600)" : "1px solid var(--rule, #d8dbe0)",
          background: active ? "var(--teal-600)" : "var(--card, #fff)",
          color: active ? "#fff" : "var(--ink-soft, #55606c)",
          fontWeight: active ? 700 : 500,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {glyph}
        {active ? " ✓" : ""}
      </button>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "0.4rem",
        alignItems: "center",
        flexWrap: "wrap",
        width: "100%",
      }}
    >
      <span style={{ ...dim, fontSize: "0.78rem" }}>Rate this reply:</span>
      {thumb("up", "👍", "Helpful")}
      {thumb("down", "👎", "Not helpful")}
      {showComment && (
        <input
          type="text"
          value={commentValue}
          disabled={busy}
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => void saveComment()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveComment();
          }}
          placeholder="What was off? (optional)"
          aria-label="Optional feedback comment"
          style={{
            flex: "1 1 12rem",
            minWidth: "10rem",
            padding: "0.3rem 0.55rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--rule, #d8dbe0)",
            fontSize: "0.82rem",
            fontFamily: "inherit",
          }}
        />
      )}
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
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0.5rem 0 0",
            display: "grid",
            gap: "0.5rem",
          }}
        >
          {rows.map((r) => (
            <li
              key={r.correlationId}
              style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}
            >
              <span style={badge(r.status)}>{deliveryStatusLabel(r.status)}</span>
              <span style={{ fontWeight: 600 }}>{r.recipient}</span>
              {r.messageId && <span style={dim}>msg {r.messageId}</span>}
              {/* Delivered-with-attachment: re-download the EXACT sent bytes (immutable per storage
                  id; the signed url is a bearer capability, §4 — surfaced only from reportForPlan). */}
              {r.attachments.map((att) => (
                <span key={att.filename} style={{ ...chip, display: "inline-flex", gap: "0.3rem" }}>
                  📎
                  {att.url ? (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--teal-600)" }}
                    >
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
              {/* IMPR-01: feedback lives on the DELIVERED response — only a sent row is a real
                  outcome to rate (and only a sent row has an attributable skillVersion to score). */}
              {r.status === "sent" && <FeedbackControl requestId={r.requestId} />}
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

  async function applyContacts() {
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
                  aria-pressed={sel}
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
                  <span style={dim}>
                    {" "}
                    · {m.address} · {matchHint(m)}
                  </span>
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
              <span
                key={a}
                style={{
                  ...chip,
                  borderColor: "var(--teal-600)",
                  background: "var(--teal-50, #f0fdfa)",
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !allPicked}
        onClick={() => void applyContacts()}
        style={{
          ...btn,
          marginTop: "0.5rem",
          background: "var(--teal-600)",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          opacity: allPicked ? 1 : 0.5,
        }}
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
      <div
        style={{
          color: "var(--ink-soft)",
          fontSize: "0.85rem",
          lineHeight: 1.5,
          marginTop: "0.15rem",
          ...wrapAnywhere,
        }}
      >
        {item.gist}
      </div>
      {/* Emphasis via weight, not amber: --held is spent on the approval gate alone (BRAND §2). */}
      {item.deadline && (
        <div
          style={{
            color: "var(--ink)",
            fontWeight: 700,
            fontSize: "0.85rem",
            marginTop: "0.15rem",
            ...wrapAnywhere,
          }}
        >
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
          style={{
            width: "0.45rem",
            height: "0.45rem",
            borderRadius: "50%",
            background: "var(--teal-600)",
            flex: "none",
          }}
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
      <span style={{ ...dimBrand, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {fmtItemTime(item.ts, tz, item.bucket)}
      </span>
    </li>
  );
}

/** A titled group of rows on the shared column grid. NO `gap` — the hairline border-top on every
 *  row after the first IS the separator, and a gap would float the rules off the rows they divide. */
function BriefingSection({
  title,
  items,
  tz,
}: {
  title: string;
  items: readonly BriefingItem[];
  tz: string;
}) {
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
export const briefingSheet = {
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
      <div
        style={{
          fontSize: "1.45rem",
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: hot ? "var(--teal-400)" : "#fff",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "0.56rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "rgb(255 255 255 / 70%)",
          marginTop: "0.28rem",
        }}
      >
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

function PriorityRow({
  item,
  tz,
  first,
}: {
  item: BriefingItem & { move: string };
  tz: string;
  first?: boolean;
}) {
  return (
    <li
      data-testid="briefing-item"
      style={{ ...PRIORITY_GRID, ...(first ? {} : { borderTop: "1px solid var(--rule)" }) }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "3px",
          borderRadius: "2px",
          background: "var(--teal-900)",
          alignSelf: "stretch",
        }}
      />
      <SenderCell item={item} />
      <div style={{ minWidth: 0 }}>
        <SubjectLine subject={item.subject} />
        <div
          style={{
            color: "var(--ink-soft)",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            marginTop: "0.15rem",
            ...wrapAnywhere,
          }}
        >
          {item.gist}
        </div>
        {/* The recommended next move — the bridge back to the gated action. "Recommended" is card
            chrome (teal-900, legible on white); the sentence is the code-derived suggestedMove. Text
            only, never a control. */}
        <div
          data-testid="briefing-move"
          style={{
            fontSize: "0.8rem",
            lineHeight: 1.4,
            marginTop: "0.3rem",
            color: "var(--ink-soft)",
            ...wrapAnywhere,
          }}
        >
          <span style={{ fontWeight: 800, color: "var(--teal-900)", letterSpacing: "0.01em" }}>
            Recommended
          </span>{" "}
          {item.move}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "0.35rem",
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {/* Emphasis via WEIGHT, not amber (BRAND §2 — --held is the approval gate's alone). */}
        {item.deadline && (
          <span style={{ fontWeight: 800, fontSize: "0.78rem", color: "var(--ink)" }}>
            Due: {item.deadline}
          </span>
        )}
        <span data-testid="briefing-category" style={categoryTag}>
          {item.category}
        </span>
        <span style={{ ...dimBrand, fontVariantNumeric: "tabular-nums" }}>
          {fmtItemTime(item.ts, tz, item.bucket)}
        </span>
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
          <div
            style={{
              fontSize: "0.66rem",
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--teal-400)",
            }}
          >
            Inbox Briefing
          </div>
          <div
            style={{
              color: "rgb(255 255 255 / 72%)",
              fontSize: "0.8rem",
              marginTop: "0.28rem",
              ...wrapAnywhere,
            }}
          >
            {scope}
          </div>
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
          <p
            data-testid="briefing-lede"
            style={{
              color: "var(--ink)",
              fontWeight: 500,
              fontSize: "1rem",
              lineHeight: 1.45,
              margin: "0 0 1rem",
            }}
          >
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
              <p style={{ ...dimBrand, margin: "0.55rem 0 0" }}>
                Suggestions only — ask in chat to act on any of these.
              </p>
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
          <div
            style={{
              marginTop: "0.5rem",
              paddingTop: "0.8rem",
              borderTop: "1px dashed var(--rule)",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem 1rem",
              justifyContent: "space-between",
            }}
          >
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
  searchVault: ["Searching your knowledge vault…", "Grounded in the vault"],
  evaluateBusiness: ["Assessing your business…", "Assessed your business"],
  // Both literals were MISSING from agentSteps.tool until 2026-08-08, so neither step could record
  // at all — the trace never showed them and the parity test never saw them. Now that the union
  // carries them, they need real verbs or they render the generic "Working…"/"Done" fallback.
  recordScorecardAnswer: ["Noting that figure…", "Noted that figure"],
  resetPlan: ["Clearing the draft…", "Cleared the draft"],
  dispatchOfferArchitect: ["Working with the offer architect…", "Offer architect finished"],
  dispatchMoneyModelDesigner: [
    "Working with the money-model designer…",
    "Money-model designer finished",
  ],
  dispatchLeadEngine: ["Working with the lead engine…", "Lead engine finished"],
  dispatchResearch: ["Researching…", "Research finished"],
  // The individual web search INSIDE a research run (llm.ts `webResearch`). It emits step rows only
  // since 2026-08-07, when it stopped being a provider-executed hosted tool and became a local
  // Tavily call — a hosted tool never fired onToolExecutionStart, so there was nothing to label.
  webResearch: ["Searching the web…", "Search finished"],
  // Phase 39: the page read inside a research run (llm.ts `readPage`).
  readPage: ["Reading a page…", "Read the page"],
  checkAvailability: ["Checking your calendar…", "Checked your calendar"],
  proposeCalendarEvent: ["Putting the event together…", "Event ready to approve"],
  // 17-05 (ACTN-02 gap closure): the two management trace verbs, RESERVED here in the same commit
  // as their `agentSteps.tool` literals because traceParity.test.ts asserts the two sets equal BOTH
  // ways and either half alone is RED. The TOOLS themselves land in Plan 17-09 — the literal has to
  // exist first, or the step insert throws inside an AI-SDK callback the SDK silently swallows and
  // prod loses the row while every offline test stays green (Research Pitfall 4).
  listManagedCalendarEvents: ["Finding events I can change…", "Found events I can change"],
  proposeCalendarChange: ["Preparing the calendar change…", "Calendar change ready to approve"],
  listDriveFolders: ["Looking through your Drive…", "Looked through your Drive"],
  findInDrive: ["Searching your Drive…", "Searched your Drive"],
  // PRE-EXISTING GAP, unrelated to Phase 17 (RPLY-01, Phase 3.11): this live tool (llm.ts
  // `replyToMessage: tool({`) has been in the agentSteps.tool union with no VERB entry since it
  // shipped, so every inbox-reply trace row rendered the generic "Working…"/"Done" FALLBACK.
  // Fixed here because 17-01 is the only Phase-17 plan permitted to touch this file, and because
  // traceParity.test.ts asserts set equality BOTH ways — leaving the gap would make that new test
  // RED on arrival inside a freeze commit no later plan may reopen.
  replyToMessage: ["Drafting the reply…", "Drafted the reply"],
  // 22.1b: the research specialist declaring that what it retrieved does not SUPPORT the claim.
  // MANDATORY beside the schema literal — traceParity.test.ts asserts set equality BOTH ways.
  declareUnsupported: ["Weighing the evidence…", "Reported an evidence gap"],
  // Phase-18 (ACTN-04): MANDATORY beside the schema literal — traceParity.test.ts asserts set
  // equality BOTH ways, so either half alone is RED.
  createDocument: ["Writing it up…", "Saved it to your vault"],
  // 27-10 (PACK): MANDATORY beside the schema literal — traceParity.test.ts asserts set equality
  // BOTH ways. The done copy is a PROMISE the binding keeps after the turn, which is the whole
  // mechanism: the tool records the decision, the code writes the reply.
  saveAsDocument: ["Setting it aside to keep…", "Saved it to your vault"],
  // Phase-20 (MEDIA-01): MANDATORY beside the schema literal — traceParity.test.ts asserts set
  // equality BOTH ways, so either half alone is RED. The copy is the done-state PROMISE: the media
  // specialist PROPOSES — it does not generate, does not voice and does not render (D2) — so this
  // must never read "Generated" or "Reel ready".
  dispatchMedia: ["Writing the script and art direction…", "Storyboard ready"],
  proposeImage: ["Composing the image prompt…", "Image proposal ready"],
  // Phase-19 (ACTN-05): MANDATORY beside the schema literal — traceParity.test.ts asserts set
  // equality BOTH ways, so either half alone is RED. The done state is the PROMISE the tool keeps:
  // it STAGES a card and applies nothing, so this must never read "Saved" or "Updated your
  // records" — the write happens on Approve, and BRAND §1 forbids claiming an action that did not
  // happen. "Records", not "CRM", matches the card's own "changes to your records" voice.
  stageCrmWrite: ["Preparing a records update…", "Records update ready to approve"],
  // Task 7 (live-finance-inputs): MANDATORY beside the schema literal — traceParity.test.ts
  // asserts set equality both ways. Read-only, matches the evaluateBusiness voice above.
  readFinance: ["Reading your finances…", "Read your finances"],
  // Task 8: MANDATORY beside the schema literal — traceParity.test.ts asserts set equality BOTH
  // ways, so either half alone is RED. The done state is the PROMISE the tool keeps: it STAGES a
  // card and applies nothing, so this must never read "Saved" or "Updated your figures" — the
  // write happens on Approve, and BRAND §1 forbids claiming an action that did not happen.
  stageFinanceWrite: ["Preparing a figure update…", "Figure update ready to approve"],
  // Phase-23 (SKILL-02): MANDATORY beside the schema literal — traceParity.test.ts asserts set
  // equality BOTH ways, so either half alone is RED. The done state is the PROMISE the tool keeps:
  // it writes a CANDIDATE that is structurally incapable of going live, so this must never read
  // "Learned", "Updated how I work" or anything implying the change took effect. Activation needs
  // a passing eval AND the owner's own click; BRAND §1 forbids claiming an action that did not
  // happen, and "it changed how I work" would be exactly that claim.
  authorSkillCandidate: ["Drafting a skill update…", "Skill update ready for review"],
  // Phase-28 (REVN): MANDATORY beside the four schema literals 28-03 pre-declared —
  // traceParity.test.ts asserts set equality BOTH ways, so either half alone is RED. No tool
  // writes these yet; 28-12 and 28-13 do.
  //
  // The done states are deliberately READS, not results. These tools reach a tenant's HubSpot,
  // QuickBooks, Stripe and PayPal accounts, and a coverage window can be partial, so nothing here
  // may read "Your cash flow is X" or imply completeness — the honest partial/unavailable state
  // lives in the card body, and BRAND §1 forbids claiming an action that did not happen.
  dispatchRevenue: ["Looking at your revenue…", "Reviewed your revenue"],
  readRevenueCrm: ["Reading your CRM…", "Read your CRM"],
  readBusinessFinance: ["Reading your business finances…", "Read your business finances"],
  // STAGES a draft and sends nothing. REVN-06 stops at the existing human Approve gate, so this
  // must never read "Sent" or "Reminded" — the send happens on Approve, if at all.
  stageInvoiceReminder: ["Preparing a payment reminder…", "Payment reminder ready to approve"],
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
  if (now - step.startedAt > STALE_MS)
    return `${attempt} — this step may have stalled; try sending again`;
  return running;
}

// Mirrors page.tsx:39 — the BRAND §3 tracked-caps section label. Mirrored rather than imported
// because page.tsx imports THIS file (importing back would be a cycle).
export const capsTeal = {
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
              <span style={{ flex: "none", opacity: 0.7 }}>
                · {(s.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- VAULT SOURCES (VGND-01) ----------

// The read-side of Plan 02's vaultSources content-plane row. Derive the shape from the api (repo
// convention — no dataModel import); the row carries refs-only labels: titles + docIds + count,
// never a query string or chunk text (§4, vaultSources.ts writes NO log-plane row).
type VaultSources = NonNullable<FunctionReturnType<typeof api.vaultSources.byThread>>;

// ---------- IN-PLACE DOCUMENT VIEWING (the deferred `getVaultDoc(byId)` upgrade) ----------

/**
 * Open ONE vault document over the workspace, without leaving it.
 *
 * Every document reference in this file used to be `<Link href="/dashboard/vault">` — a
 * whole-route jump that dropped the reader into an unfiltered grid and left the conversation
 * behind. It was a deliberate stopgap (`SourceCard`'s own comment named the upgrade: "add a
 * getVaultDoc(byId) tenant query + import PreviewModal"), and `api.vault.vaultDoc` is that query.
 *
 * The doc id is the ONLY thing a workspace card holds — `vaultSources` rows carry ids and titles,
 * never rows — so the fetch happens here and nowhere else. `null` (deleted, or another tenant's)
 * renders nothing and closes: a card must not assert a document exists because a stale row names it.
 */
function VaultDocModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const doc = useQuery(api.vault.vaultDoc, { vaultDocId: docId });
  if (doc === undefined || doc === null) return null;
  return <PreviewModal doc={doc} onClose={onClose} />;
}

/** A document TITLE that opens the document. A button, never a link: it opens a dialog in place,
 *  and dressing that as navigation is the lie the route-jump version told.
 *
 *  EXPORTED for `MediaCanvas.tsx` (33-08): a scene's citation is the same thing this renders — a
 *  vault document reached from a card that holds only its id — and `api.vault.vaultDoc` returning
 *  `null` for another tenant's id is exactly the guarantee a citation click-through needs. A second
 *  copy over there would be a second place for that null-check to be forgotten. */
export function VaultDocButton({
  docId,
  children,
  testId,
  style,
}: {
  docId: string | undefined;
  children: React.ReactNode;
  testId?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  // No id (a row written before ids were carried) ⇒ plain text, never a control that does nothing.
  if (!docId) {
    return (
      <span data-testid={testId} style={style}>
        {children}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(true)}
        style={{
          border: 0,
          padding: 0,
          background: "transparent",
          font: "inherit",
          color: "var(--teal-600)",
          cursor: "pointer",
          textAlign: "left",
          ...style,
        }}
      >
        {children}
      </button>
      {open && <VaultDocModal docId={docId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * "📚 Grounded in N documents" — a DUMB renderer over vaultSources.byThread (the briefing precedent):
 * self-queries on threadId, returns null when a turn wasn't grounded, so an ungrounded/compose turn
 * shows no card. Titles are labels-to-UI (BRAND §3 tracked-caps label + §2 opaque --card sheet, no
 * amber). Each links to the vault — the lazy, context-sanctioned click-through.
 */
/**
 * How many grounding sources render inline before the list folds away.
 *
 * Owner's words: the link list "is just clouding the workspace". Grounding is PROVENANCE — it
 * answers "what did you read?" when asked, and most turns are never asked. The count in the header
 * is the part that always matters; the titles are the audit trail behind it.
 *
 * Three, not zero: a one- or two-source turn reads as a fact about the answer, and hiding that
 * behind a click would cost more than it saves. The cap only bites when the list is actually long
 * enough to crowd — which is the complaint.
 *
 * NOTE this is deliberately NOT applied to the OUTPUT card. That list looks similar and is not:
 * its `#index` ordering is the addressing grammar `createDocument`'s replace flow depends on
 * ("make the second one shorter"), so folding it away would hide a control, not noise.
 */
export const SOURCE_INLINE_CAP = 3;

/**
 * Hook-free so `renderToStaticMarkup` can test it (the ApprovalsStateNotice/ImportDone precedent).
 * `VaultDocButton`'s `useState` is fine under SSR — its Convex query only mounts once opened.
 *
 * THE INVARIANT: collapsing must never DROP a source. Every title is always in the markup; the
 * disclosure changes what is visible, never what exists. A `.slice(0, CAP)` here would silently
 * destroy provenance, which is the one thing this card is for.
 */
export function GroundedSources({
  titles,
  docIds,
}: {
  titles: readonly string[];
  docIds: readonly (string | undefined)[];
}) {
  const list = (
    <ul
      style={{
        listStyle: "none",
        margin: "0.7rem 0 0",
        padding: 0,
        display: "grid",
        gap: "0.4rem",
      }}
    >
      {titles.map((title, i) => (
        // The deferred upgrade, taken: the docId the row already carried now opens the document
        // in place instead of navigating to an unfiltered /dashboard/vault.
        <li key={docIds[i] ?? title} style={traceText}>
          <VaultDocButton docId={docIds[i]} testId="source-title">
            {title}
          </VaultDocButton>
        </li>
      ))}
    </ul>
  );
  if (titles.length <= SOURCE_INLINE_CAP) return list;
  // Native <details>, not a useState toggle: keyboard operable, screen-reader announced and
  // Ctrl+F-findable for free (ponytail rung 4 — the platform already does this).
  return (
    <details data-testid="source-disclosure">
      <summary
        style={{
          ...traceText,
          cursor: "pointer",
          color: "var(--ink-soft)",
          fontSize: "0.85rem",
          marginTop: "0.6rem",
        }}
      >
        Show the {titles.length} documents
      </summary>
      {list}
    </details>
  );
}

function SourceCard({ threadId }: { threadId?: string }) {
  const sources: VaultSources | null | undefined = useQuery(
    api.vaultSources.byThread,
    threadId ? { threadId } : "skip",
  );
  if (!sources || sources.count === 0) return null;
  return (
    <div style={{ ...briefingSheet, padding: "1rem 1.15rem" }} data-testid="source-card">
      <p style={capsTeal}>
        📚 Grounded in {sources.count} document{sources.count === 1 ? "" : "s"}
      </p>
      <GroundedSources titles={sources.titles} docIds={sources.docIds} />
    </div>
  );
}

// ---------- OUTPUT CARD (ACTN-04) ----------

// BRAND §5 specifies an "Output card": a titled card with an UPPERCASE type badge pill, a subline
// and the rendered artifact. This is SourceCard's shape with one extra arg on the SAME query
// (`role: "created"`) — zero new Convex surface, zero new tables, and it returns null on a turn
// that created nothing, exactly like SourceCard. The dual-purpose vaultSources table makes the
// role filter load-bearing: a bare read would hand this card a GROUNDING row.
//
// The row ACCUMULATES over the conversation (18-06): `titles`/`docIds` carry every artifact this
// thread has created, while `snippet` and `form` belong to the MOST RECENT write. So the titles
// render as the #index list that createDocument's `replace` grammar addresses ("make the second
// one shorter"), and the badge + preview describe the newest artifact only.
// ⛔ No amber anywhere: --held is the approval gate's ALONE (BRAND §2). A created artifact is not held.

/** `form` → the UPPERCASE badge word. `form` is the row's own field (written on every create AND
 *  every revise) and is the ONLY thing this card can read for the type: byThread returns a
 *  vaultSources row, and the short/long discriminator otherwise lives on vaultDocuments.kind,
 *  which this card deliberately never queries. */
const FORM_LABEL = { long: "DOCUMENT", short: "POST", sheet: "SPREADSHEET" } as const;

// The type badge pill. Token-only (the DocGrid icon-badge tint + --ink text): --teal-600 on white
// is ~2.9:1 and BRAND §6 bans it for small text, so the teal lives in the FILL and the label stays
// --ink. Never --held.
export const typeBadge = {
  flex: "none",
  fontSize: "0.62rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  padding: "0.1rem 0.5rem",
  borderRadius: "1rem",
  color: "var(--ink)",
  background: "color-mix(in srgb, var(--teal-400) 30%, var(--card))",
  border: "1px solid var(--teal-400)",
} as const;

// The rendered artifact uses the shared safe MarkdownDocument surface, matching the vault preview
// and chat without evaluating model-authored HTML. Neutral --canvas sheet, the insufficientBox
// idiom below.
export const snippetSheet = {
  margin: "0.7rem 0 0",
  border: "1px solid var(--rule)",
  borderRadius: "0.6rem",
  background: "var(--canvas)",
  padding: "0.7rem 0.85rem",
  color: "var(--ink-soft)",
  fontSize: "0.85rem",
  overflowWrap: "anywhere" as const,
} as const;

/**
 * Which artifact the Output card previews: the user's explicit click, else THE NEWEST.
 *
 * This was `useState(0)` inline, which pinned the preview to document #1 for the life of the
 * thread. `titles`/`docIds` ACCUMULATE over the conversation (18-06), so a thread that created
 * three artifacts previewed the OLDEST while the user was asking where the newest one was. The
 * titles are clickable so it was recoverable — but only by someone who already knew to click, and
 * the one thing a user who just asked for a document wants to see is the document they just asked
 * for.
 *
 * Exported and pure so the RULE is testable rather than merely present: a source scan for
 * `picked ?? newest` would pass with the arithmetic wrong (the 19.1 `ImportDone` lesson — move the
 * arithmetic somewhere a test can call it).
 *
 * `picked` out of range falls back to the newest rather than to nothing: the row can shrink when a
 * `replace` supersedes an entry, and a stale index must not blank the preview.
 */
export const previewIndex = (count: number, picked: number | null): number => {
  const newest = Math.max(count - 1, 0);
  return picked !== null && picked >= 0 && picked < count ? picked : newest;
};

// ── CALENDAR card (ACTN-02) ──────────────────────────────────────────────────────────────────
// The calendar sibling of BriefingCard, and it sits on the SourceCard/OutputCard footing for the
// same reason they do: an availability read is a pure-advice turn that carries NO plan row, so a
// card gated behind plan status would simply never appear.
//
// THE EMPTY STATE IS THE POINT, not a fallback. "Nothing scheduled" is the answer to "what's on my
// calendar this week?", and rendering nothing for it is what made the agent feel detached from the
// workspace — the user could not tell an empty calendar from a broken one.
type CalendarView = NonNullable<FunctionReturnType<typeof api.calendarViews.byThread>>;

const CAL_PROVIDER_LABEL: Record<CalendarView["provider"], string> = {
  google: "Google Calendar",
  microsoft: "Microsoft Calendar",
};

// `range` is the tool's closed enum literal ("today" | "tomorrow" | "week"), which reads fine as a
// caps label but NOT inside a sentence — the first live paint said "you're free for week". The row
// stores a `string`, not the union (the enum lives in the tool's inputSchema), so an unknown value
// falls back to the literal rather than throwing or rendering "undefined".
const CAL_RANGE_PHRASE: Record<string, string> = {
  today: "today",
  tomorrow: "tomorrow",
  week: "this week",
};
export const rangePhrase = (range: string): string => CAL_RANGE_PHRASE[range] ?? range;

/**
 * One busy window in the zone the READ was bucketed in (`view.tz`), never the browser's — display
 * honesty, the same rule fmtItemTime follows for briefings. Same-day blocks (the overwhelming
 * case) print the date once: "Mon 18 Aug · 09:00 – 10:30".
 */
export function fmtBusyBlock(startMs: number, endMs: number, tz: string): string {
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const startDay = day.format(startMs);
  const endDay = day.format(endMs);
  return startDay === endDay
    ? `${startDay} · ${clock.format(startMs)} – ${clock.format(endMs)}`
    : `${startDay} ${clock.format(startMs)} – ${endDay} ${clock.format(endMs)}`;
}

function CalendarCard({ threadId }: { threadId?: string }) {
  const view: CalendarView | null | undefined = useQuery(
    api.calendarViews.byThread,
    threadId ? { threadId } : "skip",
  );
  // `undefined` = still loading, `null` = no availability read on this thread. Neither is a
  // calendar state, so neither renders — unlike `busy: []`, which IS one and renders below.
  if (!view) return null;
  const clear = view.busy.length === 0;
  return (
    <div style={{ ...briefingSheet, padding: "1rem 1.15rem" }} data-testid="calendar-card">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <p style={capsTeal}>📅 Calendar · {view.range}</p>
        <span style={typeBadge} data-testid="calendar-provider">
          {CAL_PROVIDER_LABEL[view.provider]}
        </span>
      </div>
      {clear ? (
        // Stated positively and unambiguously: the user asked a question and this is the answer.
        <p style={{ ...traceText, margin: "0.7rem 0 0" }} data-testid="calendar-clear">
          Nothing scheduled — you're free {rangePhrase(view.range)}.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: "0.7rem 0 0",
            padding: 0,
            display: "grid",
            gap: "0.4rem",
          }}
        >
          {view.busy.map((block) => (
            <li
              key={`${block.startMs}-${block.endMs}`}
              style={{ ...traceText, fontWeight: 600 }}
              data-testid="calendar-busy-block"
            >
              {fmtBusyBlock(block.startMs, block.endMs, view.tz)}
            </li>
          ))}
        </ul>
      )}
      {/* Cap honesty, mirroring briefings' "summarized N of M": a truncated read must never be
          readable as a complete one. Microsoft-only today — Google's freeBusy does not cap. */}
      {view.truncated && (
        <p
          style={{ ...traceText, margin: "0.6rem 0 0", color: "var(--ink-soft)" }}
          data-testid="calendar-truncated"
        >
          More busy blocks exist in this window than are shown.
        </p>
      )}
    </div>
  );
}

function OutputCard({ threadId }: { threadId?: string }) {
  const created: VaultSources | null | undefined = useQuery(
    api.vaultSources.byThread,
    threadId ? { threadId, role: "created" } : "skip",
  );
  // `null` means FOLLOW THE NEWEST; a number is an explicit click. See `previewIndex`.
  const [picked, setPicked] = useState<number | null>(null);
  const selected = previewIndex(created?.docIds.length ?? 0, picked);
  const selectedId = created?.docIds[selected];
  const artifact = useQuery(
    api.vault.vaultDocText,
    selectedId ? { vaultDocId: selectedId } : "skip",
  );
  // Phase 40 (DOC-01), and the ONE place in this file that mints a storage URL.
  //
  // A Convex storage URL does not expire (`ctx.storage.getUrl` takes no expiry), so it is a
  // durable bearer capability and the project rule is that one is never minted for a row nobody is
  // looking at (content.ts, and contentView.test.ts pins the shelf's half of it). The rule the
  // owner accepted for an INLINE document narrows that to the thread in front of the user: this
  // subscribes for the SELECTED created artifact of the OPEN thread — the newest by default, an
  // older one only after the user clicks its title — and only when its bytes are a PDF a browser
  // can frame. A shelf of documents still subscribes to nothing.
  const pdfBytes = artifact?.storedMimeType === "application/pdf";
  const pdfUrl = useQuery(
    api.vault.vaultDownloadUrl,
    selectedId && pdfBytes ? { vaultDocId: selectedId } : "skip",
  );
  if (!created || created.count === 0) return null;
  // Absent `form` ⇒ DOCUMENT: rows written before this phase carry no form, and guessing from
  // `count` would be a heuristic where a stored closed enum already exists.
  const kind = FORM_LABEL[created.form ?? "long"];
  const many = created.count > 1;
  return (
    <div style={{ ...briefingSheet, padding: "1rem 1.15rem" }} data-testid="output-card">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        {/* BRAND §3 tracked-caps section label; count-aware because one turn may create several. */}
        <p style={capsTeal}>✍️ Created{many ? ` · ${created.count}` : ""}</p>
        <span style={typeBadge}>{kind}</span>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: "0.7rem 0 0",
          padding: 0,
          display: "grid",
          gap: "0.4rem",
        }}
      >
        {created.titles.map((title, i) => (
          <li key={created.docIds[i] ?? title} style={{ ...traceText, fontWeight: 600 }}>
            {many && <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>#{i + 1} </span>}
            <button
              type="button"
              data-testid="output-title"
              aria-pressed={selected === i}
              onClick={() => setPicked(i)}
              style={{
                border: 0,
                padding: 0,
                background: "transparent",
                color: "var(--teal-600)",
                font: "inherit",
                fontWeight: "inherit",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {title}
            </button>
          </li>
        ))}
      </ul>
      {/* Honest about what happened (BRAND §1): createDocument SAVES, it never sends. */}
      <p style={{ margin: "0.55rem 0 0", fontSize: "0.8rem", color: "var(--ink-soft)" }}>
        Saved to your vault. Nothing was sent.
      </p>
      <section
        aria-label="Created artifact preview"
        style={{ ...snippetSheet, color: "var(--ink)" }}
      >
        {/* `pdfBytes && pdfUrl === undefined` is still LOADING: the URL query cannot even be
            registered until `artifact` resolves, so without this the card renders the extracted
            markdown for one round trip and then swaps it for the frame. */}
        {artifact === undefined || (pdfBytes && pdfUrl === undefined) ? (
          "Loading document…"
        ) : pdfUrl ? (
          // The document AS IT WILL BE READ. The browser's own PDF viewer, the same bare iframe the
          // vault modal uses (ADR-036: a `sandbox` attribute disables the viewer plugin and frames
          // nothing). ONE scroll region — the viewer's — so a phone does not nest two.
          <iframe
            src={pdfUrl}
            title={created.titles[selected] ?? "Document"}
            data-testid="output-pdf"
            style={{
              width: "100%",
              height: "min(70vh, 32rem)",
              border: "1px solid var(--rule)",
              borderRadius: "0.5rem",
              background: "var(--card)",
            }}
          />
        ) : artifact?.text ? (
          <div style={{ maxHeight: "32rem", overflowY: "auto" }}>
            <MarkdownDocument markdown={artifact.text} />
          </div>
        ) : created.snippet ? (
          <MarkdownDocument markdown={created.snippet} compact />
        ) : (
          "This artifact has no text preview."
        )}
      </section>
      {/* The full document, HERE. The inline preview above is the text; this opens the shipped
          vault viewer over the workspace for the rest of it — the stored PDF, download, entities,
          rename/delete — without leaving the conversation that produced it. */}
      <VaultDocButton
        docId={selectedId}
        testId="output-open"
        style={{ display: "inline-block", marginTop: "0.6rem", fontSize: "0.82rem" }}
      >
        Open full document
      </VaultDocButton>
    </div>
  );
}

// ── EVALUATION card (BEVL-01) ───────────────────────────────────────────────────────────────────
type Evaluation = NonNullable<FunctionReturnType<typeof api.evaluations.byThread>>;

const FRAMEWORK_LABEL: Record<Evaluation["framework"], string> = {
  swot: "SWOT",
  lean: "Lean Canvas",
  bmc: "Business Model Canvas",
  "growth-os": "Growth",
  // Phase 14 (DOCV-01). This map is `Record<Evaluation["framework"], string>`, so the schema
  // widening and this entry MUST land in the same commit or web typecheck goes red.
  "document-review": "Document review",
};

const evalSection = {
  fontSize: "0.68rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--ink-soft)",
  margin: "0.9rem 0 0.4rem",
} as const;

// Distinct thin-data sheet: dashed + neutral --canvas, informational. Deliberately NOT a gap look
// and NOT amber (--held is the Approve gate ONLY, BRAND §2) — "add X to assess", never an alarm.
const insufficientBox = {
  marginTop: "0.7rem",
  border: "1px dashed var(--rule)",
  borderRadius: "0.6rem",
  background: "var(--canvas)",
  padding: "0.7rem 0.85rem",
} as const;

// Affirmative HEALTHY banner: the --released "cleared/success" token (BRAND §2), never a gap sheet.
const healthyBox = {
  marginTop: "0.9rem",
  border: "1px solid var(--released)",
  borderRadius: "0.6rem",
  background: "color-mix(in srgb, var(--released) 10%, transparent)",
  color: "var(--ink)",
  fontWeight: 600,
  padding: "0.7rem 0.85rem",
} as const;

// H/M/L confidence pill — teal/released/ink tokens ONLY (color-mix tint, globals.css:474 idiom).
function ConfChip({ c }: { c: Evaluation["findings"][number]["confidence"] }) {
  const m = {
    high: { fg: "var(--released)", label: "High" },
    medium: { fg: "var(--teal-600)", label: "Med" },
    low: { fg: "var(--ink-soft)", label: "Low" },
  }[c];
  return (
    <span
      title={`${m.label} confidence`}
      style={{
        flex: "none",
        fontSize: "0.62rem",
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "0.05rem 0.4rem",
        borderRadius: "1rem",
        color: m.fg,
        border: `1px solid ${m.fg}`,
        background: `color-mix(in srgb, ${m.fg} 12%, transparent)`,
      }}
    >
      {m.label}
    </span>
  );
}

// One leverage-ranked gap. "Act on this" (12-05, BEVL-02) is the ONE control on the otherwise
// read-only review that writes: it stages a next-step MEMO as a proposed plan, which the existing
// PLAN card below then renders behind the single Approve gate (shape 2 of the two-shapes rule).
// No new surface — the reactive plans.byThread subscription already in this file paints the result.
function GapRow({
  gap,
  gapIndex,
  threadId,
}: {
  gap: Evaluation["gaps"][number];
  gapIndex: number;
  threadId?: string;
}) {
  const actOnGap = useMutation(api.evaluations.actOnGap);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function act() {
    if (busy || !threadId) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await actOnGap({ threadId, gapIndex });
      // plan_busy: a specialist is STILL RUNNING on this chat's open row, so staging a second memo
      // over it would race two runs onto one row. Say so plainly rather than failing silently
      // (§1 voice). ADR-037 narrowed this from "the row is mid-send or already delivered" — a
      // finished plan no longer blocks anything, so the old copy ("start a new chat to act on
      // this") named a workaround for a refusal the user can no longer hit.
      if (!res.ok)
        setNote(
          res.reason === "plan_busy"
            ? "Something is still running on this chat. I'll be able to act on this once it finishes."
            : "That gap is no longer on the latest evaluation.",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "0.6rem",
        border: "1px solid var(--rule)",
        borderLeft: "3px solid var(--teal-600)",
        borderRadius: "0.5rem",
        padding: "0.5rem 0.7rem",
      }}
    >
      <span style={{ ...traceText, flex: 1, color: "var(--ink)", fontWeight: 500 }}>
        {gap.label}
        {note && (
          <span
            role="alert"
            style={{
              display: "block",
              marginTop: "0.3rem",
              color: "var(--ink-soft)",
              fontSize: "0.8rem",
            }}
          >
            {note}
          </span>
        )}
      </span>
      <button
        type="button"
        disabled={busy || !threadId}
        onClick={() => void act()}
        title="Draft a next-step memo for this gap — you approve it before anything is saved."
        style={{
          ...btn,
          flex: "none",
          padding: "0.25rem 0.6rem",
          fontSize: "0.8rem",
          border: "none",
          background: "var(--teal-600)", // primary action on a white-text CTA (BRAND §2/§6)
          color: "#fff",
          fontWeight: 600,
        }}
      >
        {busy ? "Drafting…" : "Act on this"}
      </button>
    </li>
  );
}

// "What changed since last week" (BEVL-03), from the persisted `delta` — never re-derived here.
// Only a cron run writes one, so an on-demand evaluation has none and the line simply never
// appears. Every-term-zero returns null too: a hollow "no change" line is noise, and the engine
// emits no score or percentage, so the card must not invent one.
// ponytail: plain interpolation, not Intl.PluralRules — copy is en-only today; swap if it localises.
function deltaLine(delta: Evaluation["delta"]): string | null {
  if (!delta) return null;
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (delta.newFindings > 0) parts.push(plural(delta.newFindings, "new finding"));
  if (delta.gapsClosed.length > 0) parts.push(`${plural(delta.gapsClosed.length, "gap")} closed`);
  if (delta.gapsOpened.length > 0) parts.push(plural(delta.gapsOpened.length, "new gap"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The EVALUATION card (BEVL-01): a DUMB renderer over evaluations.byThread (the SourceCard/briefing
 * precedent — self-queries on threadId, null when the thread has no evaluation). Renders the honest
 * states the engine emits: cited findings + H/M/L confidence, a leverage-ranked gap list (≤5 + a
 * "more" disclosure, each with a plan-05 "Act on this" placeholder), the affirmative HEALTHY banner,
 * and a VISUALLY DISTINCT not-enough-data nudge (dashed/neutral — never styled as a gap). No numeric
 * score anywhere (the engine never emits one; the card never invents one).
 */
function EvaluationCard({ threadId }: { threadId?: string }) {
  const evaluation: Evaluation | null | undefined = useQuery(
    api.evaluations.byThread,
    threadId ? { threadId } : "skip",
  );
  const isReview = threadId === REVIEW_THREAD_ID;
  if (!evaluation) {
    // Pre-first-run: only on the pinned review tab, and only once the query has RESOLVED to null
    // (undefined is still loading — no flash). Everywhere else this stays the original `return null`,
    // so an on-demand thread never gains a card it did not have before.
    if (!isReview || evaluation === undefined) return null;
    return (
      <div style={{ ...briefingSheet, padding: "1rem 1.15rem" }} data-testid="evaluation-empty">
        <p style={capsTeal}>Weekly review</p>
        <p style={{ margin: "0.45rem 0 0", color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Your first weekly review runs Monday. It reads your vault — nothing to do.
        </p>
      </div>
    );
  }
  const { framework, findings, gaps, notEnoughData, verdict } = evaluation;
  const frameworkLabel = FRAMEWORK_LABEL[framework];
  // Keyed off the SHARED constant, never a re-typed "document-review" string — the literal lives in
  // @pikar/voice and is also what schema.ts and voiceDoc.ts write, so a rename can only break in one
  // place. Drives the three copy branches below (healthy banner, thin-data CTA, nothing else): a
  // document review is not a business diagnosis and must not borrow its sentences.
  const isDocReview = framework === DOC_REVIEW_FRAMEWORK;
  const thin = findings.length === 0;

  // Carry each gap's ORIGINAL row index through the sort — actOnGap indexes the persisted gaps[]
  // array, so handing it the display position would act on the wrong gap once ranks differ.
  const rankedGaps = gaps
    .map((gap, gapIndex) => ({ gap, gapIndex }))
    .sort((a, b) => a.gap.leverageRank - b.gap.leverageRank);
  const topGaps = rankedGaps.slice(0, 5);
  const moreGaps = rankedGaps.slice(5);
  const sections = [...new Set(findings.map((f) => f.section))];
  const changed = isReview ? deltaLine(evaluation.delta) : null;

  return (
    <div style={{ ...briefingSheet, padding: "1rem 1.15rem" }} data-testid="evaluation-card">
      {/* On the review thread the DATE is the freshness signal — that is why there is no unread dot
          or badge (deferred by decision). The framework stays visible so the user compares like with
          like week over week. A non-review thread renders exactly the header it always did. */}
      <p style={capsTeal}>
        {isReview &&
          `Weekly review · ${new Date(evaluation.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · `}
        Evaluation · {frameworkLabel}
      </p>
      {changed && (
        <p
          data-testid="evaluation-delta"
          style={{ margin: "0.3rem 0 0", color: "var(--ink-soft)", fontSize: "0.85rem" }}
        >
          {changed}
        </p>
      )}

      {thin ? (
        // Thin-data ONLY: the distinct dashed nudge, no fabricated findings or gaps (SC #1).
        <div data-testid="evaluation-insufficient" style={insufficientBox}>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>Not enough data to assess yet</div>
          <ul
            style={{
              margin: "0.5rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--ink-soft)",
              fontSize: "0.85rem",
              ...traceText,
            }}
          >
            {notEnoughData.map((n) => (
              <li key={n.section}>{n.needs}</li>
            ))}
          </ul>
          {/* The one action that unblocks the one dead-end state: /dashboard/profile is the Phase-11
              enrichment surface, and its save re-embeds the profile doc so the next run grounds on it.
              --teal-900, not --teal-600: BRAND §6 — teal-600 is ~2.9:1 on light paper, fine for a
              white-text button fill but not for small teal TEXT ("darken it" is the doc's own rule). */}
          {/* Suppressed on a document review: enriching the business PROFILE does nothing for a
              report that could not be assessed, so offering it would be a dead link dressed as a
              fix. The box's honest "not enough data" message is exactly right and stays. */}
          {!isDocReview && (
            <Link
              href="/dashboard/profile"
              data-testid="evaluation-enrich"
              style={{
                display: "inline-block",
                marginTop: "0.55rem",
                color: "var(--teal-900)",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              Add more about your business →
            </Link>
          )}
        </div>
      ) : (
        <>
          {sections.map((section) => (
            <div key={section}>
              <p style={evalSection}>{section}</p>
              <ul
                style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem" }}
              >
                {findings
                  .filter((f) => f.section === section)
                  .map((f) => (
                    <li
                      key={`${f.section}:${f.label}:${f.citationDocId ?? "uncited"}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        ...traceText,
                      }}
                    >
                      <ConfChip c={f.confidence} />
                      <span style={{ ...traceText, flex: 1, color: "var(--ink)" }}>
                        {f.label}{" "}
                        {f.citationDocId ? (
                          <VaultDocButton
                            docId={f.citationDocId}
                            testId="evaluation-citation"
                            style={{ fontSize: "0.8rem" }}
                          >
                            [{f.citationTitle}]
                          </VaultDocButton>
                        ) : (
                          <span
                            data-testid="evaluation-citation"
                            style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}
                          >
                            [{f.citationTitle}]
                          </span>
                        )}
                        {/* The QUOTED PASSAGE half of the locked citation decision — "document-level
                            always, PLUS a quoted passage where available" (14-CONTEXT.md).
                            FRAMEWORK-AGNOSTIC on purpose: `citationExcerpt` is optional on every
                            evaluations row, so Phase-12 business evaluations (which never set it)
                            render byte-identically and need no second branch.
                            ABSENT MUST RENDER EXACTLY AS BEFORE — no empty block, no placeholder,
                            no reserved space: "where available" means absent is the normal case.
                            §4: an excerpt is report content on the PRODUCT surface only — never add
                            it to a telemetry, analytics or logging call from this component. */}
                        {f.citationExcerpt && (
                          <blockquote
                            data-testid="evaluation-excerpt"
                            style={{
                              margin: "0.3rem 0 0",
                              paddingLeft: "0.6rem",
                              borderLeft: "2px solid var(--rule)",
                              color: "var(--ink-soft)",
                              fontSize: "0.8rem",
                              fontStyle: "italic",
                              // Value is capped server-side (EXCERPT_CHAR_CAP), but wrap anyway so a
                              // long single token can never widen the card.
                              overflowWrap: "anywhere",
                            }}
                          >
                            “{f.citationExcerpt}”
                          </blockquote>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}

          {verdict === "healthy" ? (
            <div data-testid="evaluation-healthy" style={healthyBox}>
              {/* A document review is not a business diagnosis. "Your business is solid here" is
                  simply the wrong claim when the user asked about a report — so the document branch
                  states what was actually established: this report shows no gaps, and the strengths
                  above are what it DID show. Same testid and styling (both asserted elsewhere). */}
              {isDocReview
                ? `No gaps in this report — what's above is what it does establish.`
                : `No gaps found on ${frameworkLabel} — your business is solid here.`}
            </div>
          ) : (
            topGaps.length > 0 && (
              <>
                <p style={evalSection}>Highest-leverage gaps</p>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "grid",
                    gap: "0.5rem",
                  }}
                >
                  {topGaps.map(({ gap, gapIndex }) => (
                    <GapRow
                      key={`gap-${gapIndex}`}
                      gap={gap}
                      gapIndex={gapIndex}
                      threadId={threadId}
                    />
                  ))}
                </ul>
                {moreGaps.length > 0 && (
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary
                      style={{ cursor: "pointer", color: "var(--teal-600)", fontSize: "0.85rem" }}
                    >
                      {moreGaps.length} more
                    </summary>
                    <ul
                      style={{
                        listStyle: "none",
                        margin: "0.5rem 0 0",
                        padding: 0,
                        display: "grid",
                        gap: "0.5rem",
                      }}
                    >
                      {moreGaps.map(({ gap, gapIndex }) => (
                        <GapRow
                          key={`more-gap-${gapIndex}`}
                          gap={gap}
                          gapIndex={gapIndex}
                          threadId={threadId}
                        />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )
          )}

          {/* Residual not-enough-data alongside real findings — same DISTINCT dashed neutral look. */}
          {notEnoughData.length > 0 && (
            <div
              data-testid="evaluation-partial-nudge"
              style={{ ...insufficientBox, marginTop: "0.8rem" }}
            >
              <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: "0.85rem" }}>
                To assess more, add:
              </div>
              <ul
                style={{
                  margin: "0.4rem 0 0",
                  paddingLeft: "1.1rem",
                  color: "var(--ink-soft)",
                  fontSize: "0.85rem",
                  ...traceText,
                }}
              >
                {notEnoughData.map((n) => (
                  <li key={n.section}>{n.needs}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Reads the thread's plan + briefing rows and dispatches BRIEFING / PLAN / DRAFT / REPORT cards. */
export function CardList({
  threadId,
  sending,
  // OPT-IN copy override for the no-plan fallback. Defaults to the cockpit wording, so every
  // existing caller is behaviourally unchanged. Exists because "answer the questions to build one"
  // is wrong on a surface with no composer — the voice-doc post-call screen (14-08).
  noPlanHint = "No plan yet — answer the questions to build one.",
}: {
  threadId?: string;
  sending: boolean;
  noPlanHint?: string;
}) {
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
  const showActivity =
    activity && (threadId !== undefined ? activity.threadId === threadId : sending);
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
      return briefing ? (
        <BriefingCard briefing={briefing} />
      ) : running ? null : (
        <p style={muted}>{noPlanHint}</p>
      );
    return <PlanCards plan={plan} threadId={threadId} briefing={briefing} />;
  };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {trace}
      {/* Renders above the plan-status branches like the trace — grounding happens on pure advice
          turns with no plan row, so it must not sit under any plan-status gate. Self-reads its data. */}
      <SourceCard threadId={threadId} />
      {/* Same footing as SourceCard (ACTN-04 SC#6): createDocument saves and never sends, so a
          creating turn carries no plan row at all — the Output card must not sit under a plan gate. */}
      <OutputCard threadId={threadId} />
      {/* Like SourceCard: evaluation happens on advice turns that may carry no plan row, so it
          renders above the plan-status branches and self-reads its own latest-row data. */}
      <EvaluationCard threadId={threadId} />
      {/* Same footing, same reason (ACTN-02): checking availability is a read, so an availability
          turn carries no plan row and the CALENDAR card must not sit under a plan gate. */}
      <CalendarCard threadId={threadId} />
      {/* Revenue discovery is the passed-provider + active-pin server projection. Parked, failed,
          expired and inactive workflows never reach this renderer. */}
      <RevenuePackPanel threadId={threadId} />
      {rest()}
    </div>
  );
}

/** The existing plan-status dispatch, unchanged — lifted out so CardList can render the trace above it. */
function PlanCards({
  plan,
  threadId,
  briefing,
}: {
  plan: Plan;
  threadId: string;
  briefing: Briefing | null;
}) {
  const reporting = plan.status === "delivering" || plan.status === "done";
  // A scheduled/canceled plan is dominated by its own card (Open Question 3) — suppress the DraftCard.
  const halted = plan.status === "scheduled" || plan.status === "canceled";
  // A memo's body IS the card above it — a DRAFT card would just print the same memo twice.
  // `media` excluded for the same reason `memo` is: a DRAFT card printing an email body beside the
  // canvas would be email chrome on a reel. `crm_write` likewise (19-06): a plan row can carry a
  // leftover subject/body from an earlier compose in the same thread, and a DRAFT card would print
  // an email beside a card that promises nothing is sent.
  const hasDraft =
    (Boolean(plan.body) || Boolean(plan.subject)) &&
    !halted &&
    plan.kind !== "memo" &&
    plan.kind !== "media" &&
    plan.kind !== "crm_write" &&
    // Task 8: `finance_write` for the same reason as `crm_write` — a plan row can carry a leftover
    // subject/body from an earlier compose in the same thread, and a DRAFT card would print an
    // email beside a card that promises nothing is sent.
    plan.kind !== "finance_write";
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
  // SC#5's withheld report, read off the PLAN ROW so it survives the approve that creates it
  // (19-05 shipped it in the approve card's `useState`, where it was unreachable — UAT step 9b).
  // Gated to the states where "Sent to N" is TRUE: the send was accepted and the fan-out owns it.
  // ponytail: a `scheduled` plan is deliberately excluded — nothing has been sent yet, so the
  // sentence would be a lie; its note appears when the schedule fires and the row moves to
  // delivering. Upgrade to a tense-aware sentence only if deferred partial sends need one.
  const withheld =
    plan.status === "approved" || reporting
      ? withheldNote(plan.recipients ?? [], plan.withheldRecipients)
      : null;

  return (
    // ponytail: `data-plan-id` is a render-only E2E hook (NOT a plan field/mutation/query) so the
    // proposed+parked regression can force the deadlock ROW the backend guard now prevents live.
    <div data-plan-id={plan._id} style={{ display: "grid", gap: "1rem" }}>
      {!composing && briefing && <BriefingCard briefing={briefing} />}
      {resolving && <ResolutionCard plan={plan} threadId={threadId} />}
      {/* UAT-C: never the unpickable "#1 (no name)" placeholder while a pick is parked — exactly
          one card (the picker) renders in that deadlock state. */}
      {plan.status === "proposed" && !plan.candidates?.length && (
        <PlanCard plan={plan} threadId={threadId} />
      )}
      {plan.status === "scheduled" && <ScheduledCard plan={plan} />}
      {plan.status === "canceled" && <CanceledCard plan={plan} threadId={threadId} />}
      {hasDraft && <DraftCard plan={plan} />}
      {/* INFORMATION, not failure: `status` (polite), never `alert`; `--ink-soft`, never the error
          red and never amber — BRAND §2 reserves `--held` for the approval gate alone. Placed
          ABOVE the report so the "and one address is missing from this list" explanation is read
          before the list it explains. */}
      {withheld && (
        <p
          role="status"
          data-testid="withheld-report"
          style={{ color: "var(--ink-soft)", margin: 0, fontSize: "0.9rem" }}
        >
          {withheld}
        </p>
      )}
      {reporting && <ReportCard planId={plan._id} />}
      {/* demoted: collapsed to its masthead below the work — still rendered + reachable, never destroyed */}
      {composing && briefing && <BriefingCard briefing={briefing} demoted />}
    </div>
  );
}
