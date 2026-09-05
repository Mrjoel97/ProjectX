"use client";

/**
 * Command Center v2 (HOME-01). Five INDEPENDENT Convex subscriptions —
 * `home.summary`, `home.health`, `briefings.latestForTenant`, `agenda.current` (Phase 34),
 * `workflowPackDiscovery.listPacks` (35-02, the idea-stage card) — feeding seven sections that each
 * carry their OWN loading / empty / partial / error state. One section going dark must never
 * blank another, so no section reads another section's data and no section shares a boundary.
 *
 * Two rules this file exists to keep:
 *  1. EVERY rendered product string is code-owned — `HOME_PRIORITY_COPY` for the recommendation,
 *     `DASHBOARD_STATE_COPY` for page states, and the small local maps below. Backend prose is
 *     never rendered as product copy; only the tenant's own mailbox data (sender/subject) and
 *     Pikar's briefing synopsis are, and the synopsis is rendered under an explicit attribution.
 *  2. Health is fail-closed, and both all-clears are DERIVED, never trusted off the wire. The
 *     health verdict is `rollUpHealth(signals)` and the hero's is core's `recommendNextMove`
 *     (`move.certain`) — the same rule in one place, so the two can never contradict each other.
 *     "Unknown" is the answer for anything that is not a complete set of ok reports.
 *
 * BRAND: reuses the shipped `.cc` / `.cc-hero` / `.next-move` / `.stat-*` / `.caps-label` /
 * `.cta-dark` classes. Everything the mockup names but `globals.css` does not have is inline
 * `CSSProperties`, the ReportsView/ContentView/FinanceView convention (BRAND §8.3: no component
 * library). No colour carries meaning on its own — every state renders a word.
 */

import { api } from "@pikar/backend/api";
import {
  AGENDA_STATUS_WORD,
  type AgendaStatus,
  DASHBOARD_STATE_COPY,
  type DashboardPartialReason,
  HOME_PRIORITY_COPY,
  HOME_SIGNAL_LABEL,
  type HomeHealthState,
  type HomePriorityCode,
  type HomeSignal,
  REQUIRED_HOME_SIGNALS,
  REVIEW_THREAD_ID,
  recommendNextMove,
  rollUpHealth,
  SIGNAL_STATE_WORD,
} from "@pikar/core";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Component, type CSSProperties, type ErrorInfo, type ReactNode, useState } from "react";
import { ArrowIcon, ClockIcon, FileIcon, MailIcon, ShieldIcon } from "../../(auth)/icons";

// ── the backend contract, mirrored structurally ───────────────────────────────
// These live in `packages/backend/convex/home.ts` / `briefings.ts` as return types, not in
// `@pikar/core` (only the pure priority/health vocabulary is shared there). Declaring them here
// means a backend that drifts from the contract fails THIS file's typecheck at the `useQuery`
// call sites rather than silently rendering a different shape.

type Unavailable = { unavailable: true };

export type HomeSummary = {
  approvals:
    | { awaitingCount: number; capped: boolean; oldestWaitingAt: number | null }
    | Unavailable;
  content: { total: number; capped: boolean } | Unavailable;
  delivered: { count: number; capped: boolean } | Unavailable;
  deadLetters: { newCount: number } | Unavailable;
  pipeline:
    | {
        status: "ready";
        needingAttention: number;
        followUpsDue: number;
        consentOnRecord: number;
        suppressed: number;
      }
    | {
        status: "partial";
        reason: DashboardPartialReason;
        needingAttention: number;
        followUpsDue: number;
        consentOnRecord: number;
        suppressed: number;
      }
    | { status: "unavailable" }
    | { status: "error" };
};

export type HomeHealth = { state: HomeHealthState; signals: HomeSignal[] };

export type LatestBriefing = {
  createdAt: number;
  range: string;
  tz: string;
  listedCount: number;
  itemCount: number;
  synopsis: string | null;
  items: {
    id: string;
    bucket: "today" | "yesterday" | "thisWeek";
    sender: string;
    subject: string;
    ts: number;
    needsReply: boolean;
  }[];
  capped: boolean;
} | null;

/** `undefined` is Convex's loading value; `null` is a real "no row" answer. */
type Loading = undefined;

// ── code-owned copy ───────────────────────────────────────────────────────────

/** The binding-constraint section speaks for three signal states and nothing else. */
const CONSTRAINT_COPY = {
  triggered: {
    // NOT `HOME_PRIORITY_COPY["binding-constraint"].label`: when this code is also the top signal
    // the hero renders that imperative as an <h2>, and a second identical <h2> makes heading
    // navigation ambiguous (WCAG 2.4.6). This card states the FACT; the hero issues the move.
    heading: "Nothing on record about what is holding you back",
    body: HOME_PRIORITY_COPY["binding-constraint"].reason,
  },
  ok: {
    heading: "What is holding you back is on record",
    // Says only what is true. Nothing on this page reads the constraint: the ranking is the fixed
    // `HOME_PRIORITY_ORDER`, and the signal carries a state and nothing else — no bottleneck text
    // ever crosses the wire, so no ranking can be "against" it.
    body: "It is recorded in your business profile. This page ranks what is blocked or waiting, not the bottleneck itself.",
  },
  insufficient: {
    heading: "Not enough information",
    body: "Nothing on record says what is holding you back yet, so this page cannot rank against it.",
  },
} as const;

/**
 * Code-owned prose for every legal `DashboardPartialReason`. The enum slug is a WIRE value, not
 * product copy — "the scan hit its coverage-gap limit" is not a sentence. `Record<…>` (not a
 * partial map) is what makes a new reason a TYPE error here instead of a slug leaking into prose.
 */
const PARTIAL_REASON_COPY: Record<DashboardPartialReason, string> = {
  "row-cap": "the scan stopped at its row limit, so these are floors.",
  "time-cap": "the scan ran out of time, so these are floors.",
  "legacy-window": "older records fall outside the window this scan can read, so these are floors.",
  "coverage-gap": "some records could not be read, so these are floors.",
  "source-unavailable": "a source could not be reached, so these are floors.",
};

/**
 * The hero CTA names its DESTINATION. "Open" alone is the loudest control on the page with no link
 * purpose — a screen reader listing the links hears one bare verb. `HOME_PRIORITY_COPY.label` is
 * the imperative headline, which reads as "Open Connect your mailbox", so this is its own map.
 */
const CTA_DESTINATION: Record<HomePriorityCode, string> = {
  "connection-failure": "Open mailbox connection",
  "unresolved-dead-letters": "Open the work that stopped",
  "stale-approval": "Open approvals",
  "scheduled-risk": "Open scheduled sends",
  "diagnostic-blocker": "Open reports",
  "binding-constraint": "Open your business profile",
  workspace: "Open the workspace",
};

/**
 * Rendered beside a TRIGGERED move whose signal set is incomplete. Core still ranks the triggered
 * move first (a real blocker outranks an unread source), but a higher-priority source that could
 * not be read may hold something worse — so the caveat is stated rather than the move suppressed.
 */
const UNCERTAIN_CAVEAT =
  "At least one source did not report, so something higher than this may also be waiting.";

const HEALTH_COPY: Record<HomeHealthState, { word: string; body: string }> = {
  // The ONLY all-clear sentence in this file, reachable from exactly one state.
  healthy: { word: "Healthy", body: "Nothing is blocked." },
  degraded: { word: "Needs attention", body: "At least one thing needs you." },
  unknown: {
    word: "Unknown",
    body: "At least one source did not report, so Pikar cannot tell you whether anything is blocked.",
  },
};

const BUCKET_WORD: Record<LatestBriefingItem["bucket"], string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
};

type LatestBriefingItem = NonNullable<LatestBriefing>["items"][number];

// ── shared presentation ───────────────────────────────────────────────────────

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1.25rem",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 7%, transparent)",
  minWidth: 0,
  display: "grid",
  gap: "0.75rem",
  alignContent: "start",
};

const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, fontSize: "0.95rem" };

const heading: CSSProperties = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.25rem",
  letterSpacing: "-0.02em",
  margin: 0,
  color: "var(--ink)",
};

/**
 * Page-state prose is code-owned (`DASHBOARD_STATE_COPY`), the `PipelineStateNotice` convention.
 * `data-cc-state` makes the state assertable without asserting on a colour.
 *
 * It deliberately does NOT emit `data-cc-section`: its own section container already carries that
 * attribute, and emitting it here too made every section's marker resolve to 2 (three for the
 * briefing), which is what the browser gate's `toHaveCount(1)` mount discriminator counts.
 */
export function CommandCenterState({
  state,
  children,
}: {
  state: keyof typeof DASHBOARD_STATE_COPY;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-cc-state={state}
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.85rem 1rem",
        color: "var(--ink-soft)",
        background: "color-mix(in srgb, var(--card) 70%, transparent)",
        fontSize: "0.95rem",
      }}
    >
      {children ?? DASHBOARD_STATE_COPY[state].label}
    </div>
  );
}

/**
 * One boundary PER SECTION. A thrown Convex error unwinds to the nearest boundary, so a shared
 * page-wide one would take every section down with the first failure (the 26-10 FinanceTabs bug).
 * ponytail: `renderToStaticMarkup` never invokes `getDerivedStateFromError`, so the component
 * suite proves subscription independence and the composition by source scan; the browser gate is
 * where a live throw gets exercised.
 */
class SectionBoundary extends Component<
  { section: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Command Center section failed", this.props.section, error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // The failed section's container went down with it, so the fallback carries the marker.
    return (
      <div data-cc-section={this.props.section}>
        <CommandCenterState state="error" />
      </div>
    );
  }
}

/** A capped count renders as a FLOOR, never as a confidently wrong integer. */
const floorCount = (value: number, capped: boolean) => (capped ? `${value}+` : String(value));

const isUnavailable = (source: unknown): source is Unavailable =>
  typeof source === "object" && source !== null && (source as Unavailable).unavailable === true;

/** Anything that is not the contract shape is a failure, not a zero. */
const healthOf = (health: HomeHealth | Loading | null): HomeHealth | null =>
  health && Array.isArray(health.signals) && typeof health.state === "string" ? health : null;

function StatTile({
  label,
  value,
  icon,
  text,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  text?: boolean;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-head">
        <span className="stat-badge">{icon}</span>
        <p className="caps-label">{label}</p>
      </div>
      <div className={`stat-value${text ? " is-text" : ""}`}>{value}</div>
    </div>
  );
}

// ── section a: recommended next move ──────────────────────────────────────────

export function RecommendationCard({ health }: { health: HomeHealth | Loading | null }) {
  const resolved = healthOf(health);

  return (
    <div className="next-move" data-cc-section="recommendation">
      <p className="caps-label">Recommended next move</p>
      {health === undefined ? (
        <CommandCenterState state="loading" />
      ) : resolved === null ? (
        <CommandCenterState state="error" />
      ) : (
        <Recommendation signals={resolved.signals} />
      )}
    </div>
  );
}

function Recommendation({ signals }: { signals: HomeSignal[] }) {
  // Every string below is code-owned. The backend supplies only codes and numbers.
  //
  // The all-clear guarantee is CORE'S, not this component's: `recommendNextMove` already refuses
  // to hand back the workspace all-clear copy over an incomplete signal set (`move.certain`
  // mirrors `rollUpHealth(signals) !== "unknown"`), so restating the rule here would be a second
  // definition that can drift from the health verdict below. All this file adds is the caveat.
  const move = recommendNextMove(signals);
  return (
    <>
      <h2 data-cc-priority={move.code}>{move.label}</h2>
      <p>{move.reason}</p>
      {move.certain || move.code === "workspace" ? null : (
        // `workspace` is excluded because core already swapped its label/reason for the uncertain
        // copy — the caveat would be the same sentence twice.
        <p data-cc-uncertain="true">{UNCERTAIN_CAVEAT}</p>
      )}
      <Link className="cta-dark" href={move.route}>
        {CTA_DESTINATION[move.code]} <ArrowIcon size={16} />
      </Link>
    </>
  );
}

// ── section a2: your agenda (Phase 34, Goal Engine v0, ADR-033) ───────────────

/** Mirrors `packages/backend/convex/agenda.ts`'s `AgendaView`, the same way the types above do. */
export type AgendaView = {
  reviewedAt: number;
  items: {
    key: string;
    label: string;
    reason: string | null;
    proofMetric: string | null;
    status: AgendaStatus;
    gapIndex: number;
    citations: string[];
    goal: string | null;
  }[];
  asks: { section: string; needs: string }[];
} | null;

/**
 * Everything the agenda card says on its own behalf. What it renders FROM the wire is either
 * `diagnose()`'s own code-owned prose (the gap label, reason, proof metric, the ask) or the
 * tenant's own words (document titles, a goal) — never model output.
 */
const AGENDA_COPY = {
  noReview: "Your first weekly review runs Monday. The agenda fills from it.",
  clear: "Nothing is waiting. The last review found no blocking constraint.",
  lede: "From your weekly review. Nothing here runs until you approve it.",
  ask: "Pikar needs one fact from you",
  staged: "Staged. It is waiting in approvals.",
  plan_busy: "The weekly review already has a step in flight. Answer that one first.",
  gap_not_found: "That step is no longer on the latest review.",
} as const;

const REVIEW_HREF = `/dashboard/workspace?thread=${REVIEW_THREAD_ID}`;

const agendaRow: CSSProperties = {
  borderTop: "1px solid var(--rule)",
  paddingTop: "0.6rem",
  display: "grid",
  gap: "0.3rem",
  minWidth: 0,
};
const strong: CSSProperties = { ...muted, fontWeight: 600, color: "var(--ink)" };
const small: CSSProperties = { ...muted, fontSize: "0.85rem" };

/**
 * PROPOSE-ONLY, by construction: the only mutations a row can reach are `evaluations.actOnGap`
 * (stages a proposal that waits at the Approve gate — the review card's own button) and
 * `agenda.dismiss`. No row can send, schedule or execute anything.
 */
export function AgendaCard({
  agenda,
  note,
  onStage,
  onDismiss,
}: {
  agenda: AgendaView | Loading;
  note: string | null;
  onStage: (gapIndex: number) => void;
  onDismiss: (key: string) => void;
}) {
  return (
    <section style={card} aria-labelledby="cc-agenda-label" data-cc-section="agenda">
      <p className="caps-label" id="cc-agenda-label">
        Your agenda
      </p>
      {agenda === undefined ? (
        <CommandCenterState state="loading" />
      ) : agenda === null ? (
        <CommandCenterState state="empty">{AGENDA_COPY.noReview}</CommandCenterState>
      ) : !Array.isArray(agenda.items) || !Array.isArray(agenda.asks) ? (
        <CommandCenterState state="error" />
      ) : agenda.items.length + agenda.asks.length === 0 ? (
        <CommandCenterState state="empty">{AGENDA_COPY.clear}</CommandCenterState>
      ) : (
        <>
          <p style={muted}>{AGENDA_COPY.lede}</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
            {agenda.items.map((item) => (
              <li key={item.key} style={agendaRow} data-cc-agenda={item.status}>
                <p style={strong}>{item.label}</p>
                <p style={small}>{AGENDA_STATUS_WORD[item.status]}</p>
                {item.reason ? <p style={muted}>{item.reason}</p> : null}
                {item.citations.length > 0 ? (
                  <p style={small}>Grounded in: {item.citations.join(" · ")}</p>
                ) : null}
                {item.goal ? <p style={small}>Toward your goal: {item.goal}</p> : null}
                {item.proofMetric ? <p style={small}>Done when: {item.proofMetric}</p> : null}
                {item.status === "proposed" ? (
                  <Link href="/dashboard/approvals" style={linkStyle}>
                    Review in approvals <ArrowIcon size={14} />
                  </Link>
                ) : item.status === "acted" ? (
                  <Link href={REVIEW_HREF} style={linkStyle}>
                    Open the weekly review <ArrowIcon size={14} />
                  </Link>
                ) : (
                  <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="cta-dark"
                      onClick={() => onStage(item.gapIndex)}
                    >
                      Stage for approval
                    </button>
                    <button type="button" className="cta-ghost" onClick={() => onDismiss(item.key)}>
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
            {agenda.asks.map((ask) => (
              <li key={`${ask.section}:${ask.needs}`} style={agendaRow} data-cc-agenda="ask">
                <p style={strong}>{AGENDA_COPY.ask}</p>
                <p style={muted}>{ask.needs}</p>
                <Link href="/dashboard/workspace" style={linkStyle}>
                  Answer in the workspace <ArrowIcon size={14} />
                </Link>
              </li>
            ))}
          </ol>
          {note ? (
            <p role="status" style={muted} data-cc-agenda-note="true">
              {note}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ── section b: binding constraint ─────────────────────────────────────────────

export function ConstraintCard({ health }: { health: HomeHealth | Loading | null }) {
  const resolved = healthOf(health);
  const signal = resolved?.signals.find((entry) => entry?.code === "binding-constraint");
  // Absent, unknown, or off-contract all mean the same honest thing: nothing types it.
  const key =
    signal?.state === "triggered" ? "triggered" : signal?.state === "ok" ? "ok" : "insufficient";
  const copy = CONSTRAINT_COPY[key];

  return (
    // `aria-labelledby` the VISIBLE caps-label rather than a second `aria-label` string: the two
    // had diverged ("Binding constraint" announced, "Your binding constraint" shown) and every
    // other section announced its own title twice.
    <section style={card} aria-labelledby="cc-constraint-label" data-cc-section="constraint">
      <p className="caps-label" id="cc-constraint-label">
        What is holding you back
      </p>
      {health === undefined ? (
        <CommandCenterState state="loading" />
      ) : resolved === null ? (
        <CommandCenterState state="error" />
      ) : (
        <>
          <h2 style={heading} data-cc-constraint={key}>
            {copy.heading}
          </h2>
          <p style={muted}>{copy.body}</p>
          <Link href={HOME_PRIORITY_COPY["binding-constraint"].route} style={linkStyle}>
            Open your business profile <ArrowIcon size={14} />
          </Link>
        </>
      )}
    </section>
  );
}

const linkStyle: CSSProperties = {
  color: "var(--ink)",
  fontWeight: 600,
  fontSize: "0.9rem",
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  justifySelf: "start",
};

// ── section c: source stats (incl. the narrow pipeline summary) ───────────────

export function SourceStats({ summary }: { summary: HomeSummary | Loading | null }) {
  if (summary === undefined) {
    return (
      <section aria-labelledby="cc-stats-label" data-cc-section="stats">
        <p className="caps-label" id="cc-stats-label">
          Key numbers
        </p>
        <CommandCenterState state="loading" />
      </section>
    );
  }
  if (summary === null || typeof summary !== "object") {
    return (
      <section aria-labelledby="cc-stats-label" data-cc-section="stats">
        <p className="caps-label" id="cc-stats-label">
          Key numbers
        </p>
        <CommandCenterState state="error" />
      </section>
    );
  }

  const { approvals, content, delivered, deadLetters } = summary;

  return (
    <section
      aria-labelledby="cc-stats-label"
      data-cc-section="stats"
      style={{ display: "grid", gap: "1rem" }}
    >
      <p className="caps-label" id="cc-stats-label">
        Key numbers
      </p>
      <div className="stat-grid">
        <StatTile
          label="Awaiting approval"
          icon={<ClockIcon size={16} />}
          text={isUnavailable(approvals)}
          value={
            isUnavailable(approvals)
              ? "Unavailable"
              : floorCount(approvals.awaitingCount, approvals.capped)
          }
        />
        <StatTile
          label="Content artifacts"
          icon={<FileIcon size={16} />}
          text={isUnavailable(content)}
          value={isUnavailable(content) ? "Unavailable" : floorCount(content.total, content.capped)}
        />
        <StatTile
          label="Emails delivered"
          icon={<MailIcon size={16} />}
          text={isUnavailable(delivered)}
          value={
            isUnavailable(delivered) ? "Unavailable" : floorCount(delivered.count, delivered.capped)
          }
        />
        <StatTile
          label="Work that stopped"
          icon={<ShieldIcon size={16} />}
          text={isUnavailable(deadLetters)}
          value={isUnavailable(deadLetters) ? "Unavailable" : String(deadLetters.newCount)}
        />
      </div>
      <PipelineSummary pipeline={summary.pipeline} />
    </section>
  );
}

const PIPELINE_TILES = [
  { key: "needingAttention", label: "Contacts needing attention" },
  { key: "followUpsDue", label: "Follow-ups due" },
  { key: "consentOnRecord", label: "Consent on record" },
  { key: "suppressed", label: "Suppressed contacts" },
] as const;

/**
 * The narrow Phase 19 pipeline roll-up. A failure NEVER renders as 0 — `unavailable` and `error`
 * render a word, and `partial` renders floors plus the code-owned partial notice, because a
 * row-capped scan cannot honestly claim an exact integer.
 */
function PipelineSummary({ pipeline }: { pipeline: HomeSummary["pipeline"] }) {
  if (pipeline?.status === "unavailable") {
    return (
      <div style={card} data-cc-section="pipeline" data-cc-pipeline="unavailable">
        <p className="caps-label">Sales pipeline</p>
        <CommandCenterState state="empty">
          Pipeline numbers are unavailable right now. This is not a count of zero.
        </CommandCenterState>
      </div>
    );
  }
  if (!pipeline || pipeline.status === "error") {
    return (
      <div style={card} data-cc-section="pipeline" data-cc-pipeline="error">
        <p className="caps-label">Sales pipeline</p>
        <CommandCenterState state="error" />
      </div>
    );
  }

  const partial = pipeline.status === "partial";
  return (
    <div style={card} data-cc-section="pipeline" data-cc-pipeline={pipeline.status}>
      <p className="caps-label">Sales pipeline</p>
      {pipeline.status === "partial" ? (
        <CommandCenterState state="partial">
          {DASHBOARD_STATE_COPY.partial.label} — {PARTIAL_REASON_COPY[pipeline.reason]}
        </CommandCenterState>
      ) : null}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
          gap: "0.85rem",
          margin: 0,
        }}
      >
        {PIPELINE_TILES.map((tile) => (
          <div key={tile.key} style={{ minWidth: 0 }}>
            <dt className="caps-label" style={{ margin: 0 }}>
              {tile.label}
            </dt>
            <dd className="stat-value" style={{ margin: 0, fontSize: "1.5rem" }}>
              {floorCount(pipeline[tile.key], partial)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── section d: latest briefing ────────────────────────────────────────────────

/**
 * Bounded rows, WORKSPACE LINKS ONLY. No row offers to reply, send or schedule — opening the
 * workspace is the only thing a row can do, and its label says exactly that.
 */
export function LatestBriefingCard({ briefing }: { briefing: LatestBriefing | Loading }) {
  return (
    <section style={card} aria-labelledby="cc-briefing-label" data-cc-section="briefing">
      <p className="caps-label" id="cc-briefing-label">
        Latest briefing
      </p>
      {briefing === undefined ? (
        <CommandCenterState state="loading" />
      ) : briefing === null ? (
        <CommandCenterState state="empty" />
      ) : !Array.isArray(briefing.items) ? (
        <CommandCenterState state="error" />
      ) : (
        <>
          <h2 style={heading}>
            {briefing.range} · {briefing.tz}
          </h2>
          {/* `itemCount` is how many were SUMMARIZED; `listedCount` is how many the mailbox listing
              RETURNED. They were rendered swapped and mislabelled, which read "7 listed of 2" — a
              smaller total than its own part. schema.ts states the intended phrasing verbatim:
              "summarized N of M". Caught by owner UAT 2026-08-23; the live render was the only
              place it was visible, because both fixtures used numbers that read plausibly. */}
          <p style={muted}>
            Summarized {briefing.itemCount} of {briefing.listedCount} in this window.
          </p>
          {briefing.synopsis ? (
            <div>
              {/* Attributed, so a model-written sentence is never mistaken for the owner's own. */}
              <p className="caps-label" style={{ margin: "0 0 0.3rem" }}>
                Pikar summary
              </p>
              <p style={muted}>{briefing.synopsis}</p>
            </div>
          ) : null}
          {briefing.capped ? (
            <CommandCenterState state="partial">
              {DASHBOARD_STATE_COPY.partial.label} — this briefing lists more than the rows below.
            </CommandCenterState>
          ) : null}
          {briefing.items.length === 0 ? (
            <CommandCenterState state="empty" />
          ) : (
            <ul
              style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}
            >
              {briefing.items.slice(0, 5).map((item) => (
                <li
                  key={item.id}
                  style={{ borderTop: "1px solid var(--rule)", paddingTop: "0.5rem", minWidth: 0 }}
                >
                  <p style={{ ...muted, fontWeight: 600, color: "var(--ink)" }}>{item.subject}</p>
                  <p style={{ ...muted, fontSize: "0.85rem" }}>
                    {item.sender} · {BUCKET_WORD[item.bucket]}
                    {item.needsReply ? " · Unanswered" : ""}
                  </p>
                  <Link href="/dashboard/workspace" style={linkStyle}>
                    Open in workspace <ArrowIcon size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ── section e: health ─────────────────────────────────────────────────────────

/**
 * Fail-closed. `health === undefined` (loading), a malformed payload, and a roll-up of "unknown"
 * all land on the SAME word — Unknown — and none of them can reach the all-clear sentence.
 *
 * The verdict is DERIVED from the signals this card is about to list, never read off the wire.
 * `healthOf` accepts any object with a string `state`, so trusting that string let
 * `{ state: "healthy", signals: [] }` render "Nothing is blocked." directly above six rows that
 * all read Unknown. `rollUpHealth` is the same rule the backend applies — recomputing it here
 * costs one call and makes the heading and the rows structurally unable to contradict each other.
 */
export function HealthCard({ health }: { health: HomeHealth | Loading | null }) {
  const resolved = healthOf(health);
  const signals = resolved?.signals ?? [];
  const state: HomeHealthState = resolved ? rollUpHealth(signals) : "unknown";
  const copy = HEALTH_COPY[state] ?? HEALTH_COPY.unknown;

  return (
    <section style={card} aria-labelledby="cc-health-label" data-cc-section="health">
      <p className="caps-label" id="cc-health-label">
        System health
      </p>
      {health === undefined ? (
        <CommandCenterState state="loading" />
      ) : (
        <>
          <h2 style={heading} data-cc-health={state}>
            {copy.word}
          </h2>
          <p style={muted}>{copy.body}</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.35rem" }}>
            {REQUIRED_HOME_SIGNALS.map((code) => {
              const signal = signals.find((entry) => entry?.code === code);
              const word = SIGNAL_STATE_WORD[signal?.state ?? "unknown"] ?? "Unknown";
              return (
                <li
                  key={code}
                  style={{ display: "flex", gap: "0.6rem", justifyContent: "space-between" }}
                >
                  {/* The NEUTRAL noun phrase, not `HOME_PRIORITY_COPY.label`: those are the
                      imperative next-move headlines, and a status list built from them reads
                      "Clear the blocked work — Clear" under "Nothing is blocked." */}
                  <span style={muted}>{HOME_SIGNAL_LABEL[code]}</span>
                  <span style={{ ...muted, fontWeight: 600 }} data-cc-signal={code}>
                    {word}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

// ── connected wrappers ────────────────────────────────────────────────────────
// ponytail: `api.home.health` is read at three call sites rather than lifted into one parent.
// Convex dedupes identical subscriptions, so this costs nothing on the wire and buys three
// independent failure domains — lifting it would put the hero, the constraint and health back
// under one boundary, which is the failure this file is shaped to avoid.
//
// Exported because `renderToStaticMarkup` never runs an error boundary: the component suite
// proves subscription INDEPENDENCE by rendering these one at a time (a throwing `home.summary`
// leaves `briefings.latestForTenant` rendering), and proves the boundary COMPOSITION by scanning
// this file's source. A live throw is the browser gate's job.

export function ConnectedRecommendation() {
  return <RecommendationCard health={useQuery(api.home.health, {})} />;
}

export function ConnectedConstraint() {
  return <ConstraintCard health={useQuery(api.home.health, {})} />;
}

export function ConnectedHealth() {
  return <HealthCard health={useQuery(api.home.health, {})} />;
}

export function ConnectedStats() {
  return <SourceStats summary={useQuery(api.home.summary, {})} />;
}

export function ConnectedBriefing() {
  return <LatestBriefingCard briefing={useQuery(api.briefings.latestForTenant, {})} />;
}

export function ConnectedAgenda() {
  const agenda = useQuery(api.agenda.current, {});
  const actOnGap = useMutation(api.evaluations.actOnGap);
  const dismiss = useMutation(api.agenda.dismiss);
  const [note, setNote] = useState<string | null>(null);
  return (
    <AgendaCard
      agenda={agenda}
      note={note}
      onStage={(gapIndex) =>
        void actOnGap({ threadId: REVIEW_THREAD_ID, gapIndex }).then((res) =>
          setNote(res.ok ? AGENDA_COPY.staged : AGENDA_COPY[res.reason]),
        )
      }
      onDismiss={(key) => void dismiss({ key })}
    />
  );
}

// ── section a3: the first finished thing (35-02, G23 half B) ──────────────────

/**
 * The ONE pack an idea-stage tenant is offered from the home page, by id. Code-owned: this card can
 * render exactly this pack and no other, and only while ACTIVE-only `listPacks` returns it — so
 * while the pack is a candidate (dark) the card does not exist, by construction, with no flag.
 */
export const FIRST_THING_PACK_ID = "offer-and-lead-plan";

const FIRST_THING_COPY = {
  label: "Your first finished thing",
  heading: "Your offer and a 30-day lead plan, written for you",
  // Honest about the trigger (the review has nothing to rank yet) and about the boundary (a saved
  // document; nothing sent). BRAND §1: outcome first, never a claim a send happened.
  body: "The weekly review has nothing to rank yet, and this does not wait for it. Pikar writes your offer and the first 30 days of finding leads from what your profile already says, and saves it as one document you can edit. Nothing is sent.",
  cta: "Write it now",
  busy: "Writing…",
  started: "Started. It is being written in your workspace now.",
  open: "Open it in the workspace",
  failed: "That could not be started. Nothing ran — try again.",
} as const;

/** The subset of a `listPacks` row this card needs. */
export type FirstThingPack = { packId: string; title: string; opener: string };

export type FirstThingState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "started"; threadId: string; title: string }
  | { kind: "failed" };

/**
 * Is the diagnosis unable to rank anything yet? `null` = no review has run; an empty `items` list
 * = the review ran and found nothing grounded to act on (the sparse-start case, where only the
 * interview `asks` exist). Loading stays loading so the card never flashes in before the answer.
 */
export function agendaHasNothingToRank(agenda: AgendaView | Loading): boolean | Loading {
  if (agenda === undefined) return undefined;
  if (agenda === null) return true;
  return Array.isArray(agenda.items) && agenda.items.length === 0;
}

/**
 * Renders NOTHING unless both facts are in: the pack is offered (active) AND the agenda has nothing
 * to rank. It starts the pack through `cockpit.startWorkflowPack` — a different agent from the
 * conversation (allow-listed, structurally unable to dispatch a specialist), the same seam the
 * workspace quick starts use — and then LINKS to the thread rather than navigating, so the person
 * decides when to leave this page. No `previewVersion` is ever sent from here.
 */
export function FirstThingCard({
  pack,
  nothingToRank,
  state,
  onStart,
}: {
  pack: FirstThingPack | null | Loading;
  nothingToRank: boolean | Loading;
  state: FirstThingState;
  onStart: () => void;
}) {
  if (pack === undefined || pack === null || nothingToRank !== true) return null;
  if (pack.packId !== FIRST_THING_PACK_ID) return null;
  const threadHref = (threadId: string, title: string) =>
    `/dashboard/workspace?thread=${encodeURIComponent(threadId)}&label=${encodeURIComponent(title)}`;
  return (
    <section style={card} aria-labelledby="cc-first-thing-label" data-cc-section="first-thing">
      <p className="caps-label" id="cc-first-thing-label">
        {FIRST_THING_COPY.label}
      </p>
      <h2 style={heading}>{FIRST_THING_COPY.heading}</h2>
      <p style={muted}>{FIRST_THING_COPY.body}</p>
      {state.kind === "started" ? (
        <>
          <p role="status" style={small}>
            {FIRST_THING_COPY.started}
          </p>
          <Link href={threadHref(state.threadId, state.title)} style={linkStyle}>
            {FIRST_THING_COPY.open} <ArrowIcon size={14} />
          </Link>
        </>
      ) : (
        <>
          {state.kind === "failed" ? (
            <p role="status" style={small}>
              {FIRST_THING_COPY.failed}
            </p>
          ) : null}
          <button
            type="button"
            className="cta-dark"
            style={{ justifySelf: "start" }}
            disabled={state.kind === "busy"}
            onClick={onStart}
          >
            {state.kind === "busy" ? FIRST_THING_COPY.busy : FIRST_THING_COPY.cta}
          </button>
        </>
      )}
    </section>
  );
}

export function ConnectedFirstThing() {
  const packs = useQuery(api.workflowPackDiscovery.listPacks, {});
  const agenda = useQuery(api.agenda.current, {});
  const startPack = useAction(api.cockpit.startWorkflowPack);
  const [state, setState] = useState<FirstThingState>({ kind: "idle" });
  const pack =
    packs === undefined ? undefined : (packs.find((p) => p.packId === FIRST_THING_PACK_ID) ?? null);
  return (
    <FirstThingCard
      pack={pack}
      nothingToRank={agendaHasNothingToRank(agenda)}
      state={state}
      onStart={() => {
        if (pack === undefined || pack === null || state.kind === "busy") return;
        setState({ kind: "busy" });
        // The opener is code-owned in `@pikar/core` and sent as the USER's first message, because
        // pressing the button IS the request — identical to the workspace quick start.
        void startPack({ packId: pack.packId, text: pack.opener })
          .then((res) => setState({ kind: "started", threadId: res.threadId, title: pack.title }))
          .catch(() => setState({ kind: "failed" }));
      }}
    />
  );
}

export default function CommandCenter() {
  // BRAND §3's signature tracked-caps context label, verbatim from the surface this replaces
  // (`LegacyDashboard.tsx`) and from `docs/design/mockups/pending-pages.html`. "Command Center" is
  // the rail's own nav item for this route, so as an eyebrow it only restates where you already are.
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="cc">
      <section className="cc-hero">
        <div>
          <p className="caps-label">Solopreneur • {dateLabel}</p>
          <h1>Run the next revenue move</h1>
          <p className="cc-lede">
            Your next move, the numbers behind it, and a straight answer on what needs you.
          </p>
        </div>
        <SectionBoundary section="recommendation">
          <ConnectedRecommendation />
        </SectionBoundary>
      </section>

      <SectionBoundary section="agenda">
        <ConnectedAgenda />
      </SectionBoundary>

      <SectionBoundary section="first-thing">
        <ConnectedFirstThing />
      </SectionBoundary>

      <SectionBoundary section="constraint">
        <ConnectedConstraint />
      </SectionBoundary>

      <SectionBoundary section="stats">
        <ConnectedStats />
      </SectionBoundary>

      <SectionBoundary section="briefing">
        <ConnectedBriefing />
      </SectionBoundary>

      <SectionBoundary section="health">
        <ConnectedHealth />
      </SectionBoundary>
    </div>
  );
}
